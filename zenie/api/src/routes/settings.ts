// Configurações do servidor (admin): rede (IP, máscara, gateway, DNS, VLAN) e túnel Cloudflare, pelo agente do host.
// Toda mudança vai para a auditoria (o token do túnel nunca: só os últimos caracteres).

import type { FastifyInstance, FastifyReply } from "fastify";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { hostd, HostdError } from "../hostd.js";

interface NetworkState {
  backend: "ifupdown" | "netplan" | null;
  interfaces: { name: string; mac: string | null; state: string; vlan: { parent: string; id: number } | null; addresses: string[]; dhcp: boolean }[];
  gateway: { address: string; dev: string } | null;
  dns: string[];
  pending: { token: string; deadline: number } | null;
  confirmSeconds: number;
}

const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof HostdError) return reply.code(e.status).send({ error: e.message, code: e.code ?? null });
  throw e;
};

export async function settingsRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireAuth("settings.manage") };

  app.get("/api/settings/network", admin, async (_request, reply) => {
    try {
      const s = await hostd<NetworkState>("network.get");
      // O código de confirmação só vai para a tela de quem aplicou (resposta do POST); aqui só o prazo.
      return {
        ...s,
        pending: s.pending ? { deadline: s.pending.deadline } : null,
        acsHost: process.env.GENIEACS_FS_HOSTNAME || null,
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Aplica a rede. O agente responde antes de mexer (2 s) e reverte sozinho se não houver confirmação no prazo.
  app.post<{ Body: { config: unknown } }>("/api/settings/network", admin, async (request, reply) => {
    try {
      const r = await hostd<{ token: string; deadline: number; confirmSeconds: number; config: unknown }>("network.apply", { config: request.body?.config });
      await record(request, "settings.network.apply", { details: { config: r.config, prazo: r.confirmSeconds } });
      return r;
    } catch (e) {
      await record(request, "settings.network.apply", { ok: false, details: { erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });

  // Confirmação: com o código (link do novo endereço) ou, sem ele, por qualquer admin logado durante o prazo — a
  // página que aplicou pode ter sido recarregada ou aberta por outro endereço (ex.: túnel Cloudflare).
  app.post<{ Body: { token?: string } }>("/api/settings/network/confirm", admin, async (request, reply) => {
    try {
      let token = String(request.body?.token ?? "");
      if (!token) token = (await hostd<NetworkState>("network.get")).pending?.token ?? "";
      const r = await hostd<{ confirmed: boolean }>("network.confirm", { token });
      await record(request, "settings.network.confirm");
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Horário do servidor: fuso e servidores NTP (padrão NTP.br), com teste de um servidor.
  app.get("/api/settings/time", admin, async (_request, reply) => {
    try {
      return await hostd("time.get");
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put<{ Body: { timezone?: string; servers?: string[] } }>("/api/settings/time", admin, async (request, reply) => {
    const { timezone, servers } = request.body ?? {};
    try {
      const r = await hostd("time.set", { timezone, servers }, 120_000);
      await record(request, "settings.time", { details: { fuso: timezone ?? null, ntp: servers ?? null } });
      return r;
    } catch (e) {
      await record(request, "settings.time", { ok: false, details: { fuso: timezone ?? null, ntp: servers ?? null, erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });

  app.post<{ Body: { server: string } }>("/api/settings/time/test", admin, async (request, reply) => {
    try {
      return await hostd("time.test", { server: String(request.body?.server ?? "") }, 15_000);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Atualização do Zenie (canal no .env: releases = versões marcadas; main = servidor de testes).
  // GET = última verificação guardada (o agente verifica 1x/dia); POST check = consulta o GitHub agora.
  app.get("/api/settings/update", admin, async (_request, reply) => {
    try {
      return await hostd("update.check", { fetch: false });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/settings/update/check", admin, async (_request, reply) => {
    try {
      return await hostd("update.check", { fetch: true }, 200_000);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/settings/update/run", admin, async (request, reply) => {
    try {
      const r = await hostd<{ run: { from: unknown; to: unknown } | null }>("update.run", { by: request.user?.username }, 200_000);
      await record(request, "settings.update", { details: { de: r.run?.from ?? null, para: r.run?.to ?? null } });
      return r;
    } catch (e) {
      await record(request, "settings.update", { ok: false, details: { erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });

  app.get("/api/settings/update/status", admin, async (_request, reply) => {
    try {
      return await hostd("update.status");
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/settings/tunnel", admin, async (_request, reply) => {
    try {
      return await hostd("tunnel.get");
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put<{ Body: { enabled: boolean; token?: string } }>("/api/settings/tunnel", admin, async (request, reply) => {
    const enabled = request.body?.enabled === true;
    try {
      const r = await hostd<{ tokenHint: string | null }>("tunnel.set", { enabled, token: request.body?.token || undefined }, 300_000);
      await record(request, "settings.tunnel", { details: { ativado: enabled, tokenNovo: !!request.body?.token, final: r.tokenHint } });
      return r;
    } catch (e) {
      await record(request, "settings.tunnel", { ok: false, details: { ativado: enabled, erro: e instanceof Error ? e.message : String(e) } });
      return fail(reply, e);
    }
  });
}
