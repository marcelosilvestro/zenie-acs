// Log do ACS (NOC/admin): resumo agrupado do que o GenieACS registrou, com o equipamento identificado quando ele
// está em Dispositivos — e o id/IP quando não está (ex.: senha recusada de quem nunca entrou).

import type { FastifyInstance } from "fastify";
import type { Filter } from "mongodb";
import { requireAuth } from "../auth.js";
import { acsLog, acsLogState, inventory, type AcsLogEntry } from "../db.js";
import { pollAcsLog } from "../acslog.js";
import { HostdError } from "../hostd.js";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "0C014B-F6201B-ZTEPQ0000001" -> OUI, modelo e serial (o id do GenieACS vem com %XX no lugar de espaço etc.). */
function parseDeviceId(id: string): { oui: string; productClass: string; serial: string } | null {
  const parts = id.split("-");
  if (parts.length < 3) return null;
  const dec = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return { oui: parts[0]!, productClass: dec(parts.slice(1, -1).join("-")), serial: dec(parts.at(-1)!) };
}

export async function acsLogRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { hours?: string; kind?: string; level?: string; q?: string } }>("/api/acs-log", { preHandler: requireAuth("acslog.view") }, async (request, reply) => {
    // Lê o que chegou desde a última passada (a tela não espera 15 s); sem o agente, mostra o que já foi guardado.
    let reader: string | null = null;
    await pollAcsLog(request.log).catch((e) => {
      reader = e instanceof HostdError && e.code === "no_hostd" ? "no_hostd" : "erro";
    });
    const hours = Math.min(168, Math.max(1, Number(request.query.hours) || 24));
    const since = new Date(Date.now() - hours * 3600_000);
    const filter: Filter<AcsLogEntry> = { last: { $gte: since } };
    if (request.query.kind) filter.kind = request.query.kind;
    if (request.query.level) filter.level = request.query.level as AcsLogEntry["level"];
    const q = (request.query.q ?? "").trim();
    if (q) {
      // Procura no id (serial/modelo), no IP e no login PPPoE de quem está em Dispositivos.
      const devs = await inventory().find({ pppoeKey: { $regex: escapeRegex(q.toLowerCase()) } }, { projection: { _id: 1 } }).limit(200).toArray();
      filter.$or = [{ deviceId: { $regex: escapeRegex(q), $options: "i" } }, { ip: { $regex: "^" + escapeRegex(q) } }, { deviceId: { $in: devs.map((d) => d._id) } }];
    }
    const rows = await acsLog().find(filter).sort({ last: -1 }).limit(500).toArray();

    // Equipamento: dados de Dispositivos quando ele existe lá.
    const ids = [...new Set(rows.map((r) => r.deviceId).filter((x): x is string => !!x))];
    const inv = new Map((await inventory().find({ _id: { $in: ids } }, { projection: { _id: 1, pppoe: 1, model: 1, serial: 1 } }).toArray()).map((d) => [d._id, d]));

    // Resumo do período (sem os filtros de tipo/busca): por tipo, somando as ocorrências.
    const byKind = await acsLog()
      .aggregate<{ _id: { kind: string; level: string; title: string }; count: number; devices: (string | null)[] }>([
        { $match: { last: { $gte: since } } },
        { $group: { _id: { kind: "$kind", level: "$level", title: "$title" }, count: { $sum: "$count" }, devices: { $addToSet: "$deviceId" } } },
        { $sort: { count: -1 } },
      ])
      .toArray();
    const informDocs = await acsLogState().find({ hour: { $gte: since } }).toArray();
    const informDevices = new Set(informDocs.flatMap((d) => d.devices ?? []));
    const cursor = await acsLogState().findOne({ _id: "cursor" });

    return reply.send({
      hours,
      reader, // null = leitura ok; "no_hostd" = agente ausente; "erro" = falha na leitura
      readAt: cursor?.at ?? null,
      informs: { sessions: informDocs.reduce((s, d) => s + (d.n ?? 0), 0), devices: informDevices.size },
      summary: byKind.map((k) => ({ kind: k._id.kind, level: k._id.level, title: k._id.title, count: k.count, devices: k.devices.filter(Boolean).length })),
      items: rows.map((r) => {
        const d = r.deviceId ? inv.get(r.deviceId) : undefined;
        return {
          id: r._id,
          kind: r.kind,
          level: r.level,
          title: r.title,
          help: r.help,
          detail: r.detail,
          first: r.first,
          last: r.last,
          count: r.count,
          ip: r.ip,
          device: r.deviceId
            ? { id: r.deviceId, known: !!d, pppoe: d?.pppoe ?? null, model: d?.model ?? parseDeviceId(r.deviceId)?.productClass ?? null, serial: d?.serial ?? parseDeviceId(r.deviceId)?.serial ?? null }
            : null,
        };
      }),
    });
  });
}
