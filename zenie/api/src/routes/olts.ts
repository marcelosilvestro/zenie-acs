// OLTs (docs/OLT.md): cadastro, teste de acesso (só leitura) e drivers/compatibilidade.
// Ver: olt.view (noc, admin). Cadastrar/alterar/testar/remover: olt.manage (admin). Senhas nunca na auditoria.

import type { FastifyInstance, FastifyReply } from "fastify";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { manifests, models } from "../olt/driver.js";
import { get, history, list, OltError, PROTOCOLS, remove, save, setActive, test, type OltInput } from "../olt/service.js";
import { jobOf, listOnus, startRead, type OnuFilter } from "../olt/inventory.js";
import { jobsOf, saveOltConfig, sendTr069, startBatch } from "../olt/tr069.js";
import { secretsReady } from "../secrets.js";

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof OltError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

const BODY = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 80 },
    vendor: { type: "string", maxLength: 40 },
    model: { type: "string", maxLength: 40 },
    protocol: { type: "string", maxLength: 20 },
    host: { type: "string", maxLength: 253 },
    port: { type: ["integer", "string"] },
    username: { type: "string", maxLength: 60 },
    password: { type: "string", maxLength: 128 },
    enablePassword: { type: "string", maxLength: 128 },
    clearEnable: { type: "boolean" },
    connectTimeoutSec: { type: ["integer", "string"] },
    commandTimeoutSec: { type: ["integer", "string"] },
    note: { type: "string", maxLength: 500 },
    rev: { type: "integer" },
  },
} as const;

export async function oltRoutes(app: FastifyInstance): Promise<void> {
  const view = { preHandler: requireAuth("olt.view") };
  const manage = { preHandler: requireAuth("olt.manage") };

  app.get("/api/olts", view, async () => ({ olts: await list(), secretsReady: secretsReady() }));

  app.get("/api/olts/drivers", view, async () => ({
    models: models(),
    protocols: Object.entries(PROTOCOLS).map(([id, p]) => ({ id, ...p })),
    manifests: manifests(),
  }));

  app.get<{ Params: { id: string } }>("/api/olts/:id/tests", view, async (request, reply) => {
    try {
      return await history(request.params.id);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Body: OltInput }>("/api/olts", { ...manage, schema: { body: BODY } }, async (request, reply) => {
    try {
      const res = await save(null, request.body, request.user!.username);
      await record(request, "olt.cadastro", { target: res.olt.id, details: res.audit });
      return res.olt;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put<{ Params: { id: string }; Body: OltInput }>("/api/olts/:id", { ...manage, schema: { body: BODY } }, async (request, reply) => {
    try {
      const res = await save(request.params.id, request.body, request.user!.username);
      await record(request, "olt.cadastro", { target: res.olt.id, details: res.audit });
      return res.olt;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string }; Body: { active: boolean } }>("/api/olts/:id/active", {
    ...manage,
    schema: { body: { type: "object", required: ["active"], additionalProperties: false, properties: { active: { type: "boolean" } } } },
  }, async (request, reply) => {
    try {
      const olt = await setActive(request.params.id, request.body.active, request.user!.username);
      await record(request, "olt.cadastro", { target: olt.id, details: { acao: request.body.active ? "ativada" : "desativada", nome: olt.name } });
      return olt;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string }; Body: { confirmName: string } }>("/api/olts/:id/remove", {
    ...manage,
    schema: { body: { type: "object", required: ["confirmName"], additionalProperties: false, properties: { confirmName: { type: "string", maxLength: 80 } } } },
  }, async (request, reply) => {
    try {
      const s = await remove(request.params.id, request.body.confirmName);
      await record(request, "olt.cadastro", { target: request.params.id, details: { acao: "removida", ...s } });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Teste de acesso: só lê (login, show version-running, compatibilidade). Nada é alterado na OLT.
  app.post<{ Params: { id: string } }>("/api/olts/:id/test", manage, async (request, reply) => {
    try {
      const res = await test(request.params.id, request.user!.username);
      await record(request, "olt.teste", { target: request.params.id, ok: res.result !== "erro", details: { codigo: res.code, resultado: res.result, compatibilidade: res.compatibility, resumo: res.summary } });
      return res;
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------------------------------------------------------------- ONUs (inventário, O2)

  // Lista com o cruzamento com o Zenie (SN GPON = PonSerial) e a situação do TR-069 na OLT.
  app.get<{ Params: { id: string }; Querystring: OnuFilter }>("/api/olts/:id/onus", view, async (request, reply) => {
    try {
      const o = await get(request.params.id);
      return { ...(await listOnus(o, request.query)), job: jobOf(request.params.id) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Leitura das ONUs na OLT (só leitura; em segundo plano). A tela acompanha por GET .../inventory.
  app.post<{ Params: { id: string } }>("/api/olts/:id/inventory", manage, async (request, reply) => {
    try {
      await get(request.params.id);
      const job = await startRead(request.params.id, request.user!.username);
      await record(request, "olt.inventario", { target: request.params.id, details: { acao: "leitura iniciada" } });
      return job;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Params: { id: string } }>("/api/olts/:id/inventory", view, async (request) => ({ job: jobOf(request.params.id) }));

  // ---------------------------------------------------------------- ativação do TR-069 (O3) — ALTERA a OLT

  app.post<{ Params: { id: string; onuId: string }; Body: { allowExperimental?: boolean } }>("/api/olts/:id/onus/:onuId/tr069", {
    preHandler: requireAuth("olt.tr069"),
    schema: { body: { type: "object", additionalProperties: false, properties: { allowExperimental: { type: "boolean" } } } },
  }, async (request, reply) => {
    try {
      const job = await sendTr069(request.params.id, request.params.onuId, request.user!.username, { allowExperimental: request.body?.allowExperimental });
      await record(request, "olt.tr069.envio", {
        target: request.params.onuId, ok: job.state !== "falha",
        details: { posicao: job.position, sn: job.sn, url: job.url, usuario: job.username, resultado: job.state, ...(job.error ? { erro: job.error } : {}) },
      });
      return job;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get<{ Params: { id: string; onuId: string } }>("/api/olts/:id/onus/:onuId/tr069", view, async (request) => jobsOf(request.params.onuId));

  // Lote (O4): até ZENIE_TR069_BATCH_MAX ONUs, confirmadas digitando a quantidade.
  app.post<{ Params: { id: string }; Body: { onuIds: string[]; confirmCount: number; allowExperimental?: boolean } }>("/api/olts/:id/tr069/batch", {
    preHandler: requireAuth("olt.tr069"),
    schema: {
      body: {
        type: "object", required: ["onuIds", "confirmCount"], additionalProperties: false,
        properties: { onuIds: { type: "array", maxItems: 100, items: { type: "string", maxLength: 100 } }, confirmCount: { type: "integer" }, allowExperimental: { type: "boolean" } },
      },
    },
  }, async (request, reply) => {
    try {
      return await startBatch(request.params.id, request.body.onuIds, request.body.confirmCount, request.user!.username, { allowExperimental: request.body.allowExperimental });
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Salvar configuração da OLT (write): grava na flash o que foi enviado. Botão explícito, auditado.
  app.post<{ Params: { id: string } }>("/api/olts/:id/save", { preHandler: requireAuth("olt.tr069") }, async (request, reply) => {
    try {
      const res = await saveOltConfig(request.params.id, request.user!.username);
      await record(request, "olt.salvar_config", { target: request.params.id, details: { resultado: "gravado na flash ([OK])" } });
      return res;
    } catch (e) {
      await record(request, "olt.salvar_config", { target: request.params.id, ok: false, details: { erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });
}
