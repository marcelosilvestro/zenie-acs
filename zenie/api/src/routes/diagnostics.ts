// Diagnósticos executados PELO equipamento (resultado real, nada simulado):
//  - tráfego atual: duas leituras do VP WanCounters com intervalo
//  - teste de conectividade: adaptador de ping escolhido pelo perfil do modelo (adapters/diag).

import type { FastifyInstance } from "fastify";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { pingAdapter } from "../adapters/index.js";
import type { PingResult } from "../adapters/types.js";
import { buildDevice, fetchDevice, nbiPath, runTask } from "../device.js";
import { guard } from "../guard.js";
import { config } from "../config.js";
import { nbiGet, type NbiDevice } from "../nbi.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function diagnosticsRoutes(app: FastifyInstance): Promise<void> {
  // Teste de conectividade: DNS do provedor, internet por IP e nomes (resolvidos pelo DNS do equipamento), em
  // sequência (a CPE faz um por vez). Sem o gateway: se o ACS alcança o equipamento, a rota existe (usuário, 2026-10-09).
  app.post<{ Params: { id: string } }>("/api/devices/:id/ping", { preHandler: requireAuth("diag.run") }, async (request, reply) => {
    const id = request.params.id;
    const raw = await fetchDevice(id);
    if (!raw) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, raw, ["ping"]))) return reply;
    const adapter = pingAdapter(raw);
    if (!adapter) return reply.code(400).send({ error: "sem método de teste para este modelo" });
    const wan = buildDevice(raw).wan as { gateway?: string | null; dns?: string[] };
    const targets: [string, string | null][] = [
      // IPPing (TR-098) só faz IPv4: usa o primeiro DNS IPv4 da WAN (há WAN só com DNS IPv6, ex.: TP-Link EC230-G1).
      ["DNS", wan.dns?.find((s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s)) ?? null],
      ["Internet", config.pingInternetHost],
      ...config.pingNames.map((n): [string, string] => [n, n]),
    ];
    const results: PingResult[] = [];
    for (const [label, host] of targets) results.push(await adapter.ping(id, label, host));
    await record(request, "diag.ping", {
      target: id,
      ok: results.every((r) => r.ok),
      details: Object.fromEntries(results.map((r) => [r.target, r.ok ? `ok ${r.avgMs ?? "?"} ms, perda ${r.lossPct}%` : `falhou: ${r.error ?? r.state}`])),
    });
    return { results };
  });

  // Tráfego atual da WAN: duas leituras dos contadores com ~5 s de intervalo.
  app.post<{ Params: { id: string } }>("/api/devices/:id/traffic", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const id = request.params.id;
    const raw = await fetchDevice(id);
    if (!raw) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, raw, ["traffic"]))) return reply;
    const read = async () => {
      const res = await runTask(id, { name: "getParameterValues", parameterNames: ["VirtualParameters.WanCounters"] });
      if (!res.ok) return { res, c: null };
      const q = encodeURIComponent(JSON.stringify({ _id: id }));
      const [dev] = await nbiGet<NbiDevice[]>(`/devices/?query=${q}&projection=VirtualParameters.WanCounters`);
      const v = dev?.VirtualParameters?.WanCounters;
      const c = JSON.parse(String(v?._value ?? "{}")) as { rxBytes?: number; txBytes?: number };
      return { res, c: { ...c, t: v?._timestamp ? Date.parse(v._timestamp) : Date.now() } };
    };
    const a = await read();
    if (!a.c) return { ok: false, message: a.res.message ?? "o equipamento não respondeu" };
    await sleep(5000);
    const b = await read();
    if (!b.c) return { ok: false, message: b.res.message ?? "o equipamento não respondeu" };
    const secs = Math.max(1, (b.c.t - a.c.t) / 1000);
    // Contadores de 32 bits voltam a zero: diferença negativa = deu a volta.
    const delta = (x?: number, y?: number) => (x === undefined || y === undefined ? null : y >= x ? y - x : y + 2 ** 32 - x);
    const mbps = (bytes: number | null) => (bytes === null ? null : Math.round(((bytes * 8) / secs / 1e6) * 10) / 10);
    return {
      ok: true,
      intervalSec: Math.round(secs * 10) / 10,
      downloadMbps: mbps(delta(a.c.rxBytes, b.c.rxBytes)),
      uploadMbps: mbps(delta(a.c.txBytes, b.c.txBytes)),
    };
  });
}

export { nbiPath };
