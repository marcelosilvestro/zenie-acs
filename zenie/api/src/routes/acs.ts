// Segurança do ACS (docs/SEGURANCA-ACS.md): credencial das CPEs e exigência de autenticação no GenieACS.
// Só admin (acs.manage). Senhas nunca vão para a auditoria.

import type { FastifyInstance, FastifyReply } from "fastify";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { AcsError, createCredential, retireCredential, revealPassword, setMode, state } from "../acs/service.js";
import { secretsReady } from "../secrets.js";

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof AcsError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export async function acsRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: requireAuth("acs.manage") };

  app.get("/api/acs/security", admin, async () => ({ ...(await state()), secretsReady: secretsReady() }));

  app.post<{ Body: { username?: string; password?: string } }>("/api/acs/credentials", {
    ...admin,
    schema: { body: { type: "object", additionalProperties: false, properties: { username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: 64 } } } },
  }, async (request, reply) => {
    try {
      const res = await createCredential(request.user!.username, request.body ?? {});
      await record(request, "acs.credencial", { target: res.credential.username, details: { acao: "criada", senha: request.body?.password ? "informada" : "gerada" } });
      return res;
    } catch (e) {
      await record(request, "acs.credencial", { ok: false, details: { erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });

  // Revelar a senha (para configurar CPE/OLT à mão): auditado.
  app.post<{ Params: { id: string } }>("/api/acs/credentials/:id/reveal", admin, async (request, reply) => {
    try {
      const res = await revealPassword(request.params.id);
      await record(request, "acs.credencial", { target: res.username, details: { acao: "senha revelada" } });
      return res;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>("/api/acs/credentials/:id/retire", admin, async (request, reply) => {
    try {
      const res = await retireCredential(request.params.id, request.user!.username);
      await record(request, "acs.aposentar", { target: res.username });
      return res;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Body: { mode: "off" | "enforced" } }>("/api/acs/mode", {
    ...admin,
    schema: {
      body: {
        type: "object",
        required: ["mode"],
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["off", "enforced"] },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const res = await setMode(request.body.mode, request.user!.username);
      await record(request, "acs.modo", { details: { modo: res.mode } });
      return res;
    } catch (e) {
      await record(request, "acs.modo", { ok: false, details: { modo: request.body.mode, erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });
}
