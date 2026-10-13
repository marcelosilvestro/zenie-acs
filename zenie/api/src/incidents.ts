// Desconexões do equipamento (gráfico da aba Eventos) e quedas em massa.
//
// Uma queda gera vários eventos (a OLT registra a queda, o equipamento reinicia, volta a falar com o ACS…): eles são
// agrupados num INCIDENTE, que é o que o gráfico conta. Queda em massa: outros clientes da mesma PON/OLT tiveram
// um incidente no mesmo horário — o problema não é do cliente (energia no bairro, fibra rompida antes do splitter).

import { deviceEvents, inventory, oltOnus } from "./db.js";
import type { TimelineEntry } from "./events.js";
import { onuForDevice } from "./olt/history.js";

export type IncidentCategory = "energia" | "fibra" | "internet" | "equipamento";

export interface Incident {
  start: Date;
  end: Date;
  category: IncidentCategory;
  /** Índices em `items` (linha do tempo) dos eventos que formam o incidente. */
  members: number[];
  mass?: MassInfo | null;
}

export interface MassInfo {
  pon: number; // outros clientes da mesma PON no mesmo horário
  olt: number; // outros clientes da mesma OLT (inclui a PON)
  position: string; // "1/4" (slot/PON)
}

const RANK: Record<IncidentCategory, number> = { fibra: 4, energia: 3, internet: 2, equipamento: 1 };
const JOIN_AFTER = 15 * 60_000; // eventos até 15 min depois da volta são a mesma queda (reinício, volta ao ACS)
const JOIN_GAP = 10 * 60_000; // sem queda na OLT: eventos a menos de 10 min um do outro
const MASS_WINDOW = 5 * 60_000;
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const massRules = { pon: num("ZENIE_MASS_PON", 3), olt: num("ZENIE_MASS_OLT", 10) };

/** Evento que conta como desconexão: categoria e intervalo [início, fim]. Reinício pedido pelo painel não conta. */
export function asDisconnection(e: Pick<TimelineEntry, "type" | "ts" | "details" | "source">): { category: IncidentCategory; start: Date; end: Date } | null {
  if (e.source !== "zenie") return null;
  const d = e.details ?? {};
  const t = e.ts;
  switch (e.type) {
    case "olt.down": {
      const back = d.voltou ? new Date(d.voltou as string | Date) : t;
      return { category: d.causa === "fibra" ? "fibra" : d.causa === "energia" ? "energia" : "equipamento", start: t, end: back };
    }
    case "reboot":
      if (d.causa === "painel" || d.causa === "firmware") return null;
      return { category: d.causa === "energia" ? "energia" : "equipamento", start: t, end: t };
    case "offline": {
      const last = d.ultimoContato ? new Date(d.ultimoContato as string | Date) : t;
      return { category: "equipamento", start: last, end: last };
    }
    case "wan.down":
    case "wan.reconnect":
      return { category: "internet", start: t, end: t };
    default:
      return null;
  }
}

/** Agrupa os eventos de desconexão em incidentes (do mais recente para o mais antigo, como a linha do tempo). */
export function buildIncidents(items: Pick<TimelineEntry, "type" | "ts" | "details" | "source">[]): Incident[] {
  const list = items
    .map((e, i) => ({ i, d: asDisconnection(e) }))
    .filter((x): x is { i: number; d: NonNullable<ReturnType<typeof asDisconnection>> } => x.d !== null)
    // Quedas na OLT primeiro (trazem o intervalo real), depois por horário.
    .sort((a, b) => Number(items[b.i]!.type === "olt.down") - Number(items[a.i]!.type === "olt.down") || a.d.start.getTime() - b.d.start.getTime());
  const incidents: Incident[] = [];
  for (const x of list) {
    const s = x.d.start.getTime();
    const host = incidents.find((inc) =>
      items[inc.members[0]!]!.type === "olt.down"
        ? s >= inc.start.getTime() - 2 * 60_000 && s <= inc.end.getTime() + JOIN_AFTER
        : Math.abs(s - inc.end.getTime()) <= JOIN_GAP || (s >= inc.start.getTime() && s <= inc.end.getTime()),
    );
    // Duas quedas na OLT são sempre incidentes diferentes.
    if (host && !(items[host.members[0]!]!.type === "olt.down" && items[x.i]!.type === "olt.down")) {
      host.members.push(x.i);
      if (RANK[x.d.category] > RANK[host.category]) host.category = x.d.category;
      if (x.d.end > host.end) host.end = x.d.end;
      if (x.d.start < host.start) host.start = x.d.start;
    } else {
      incidents.push({ start: x.d.start, end: x.d.end, category: x.d.category, members: [x.i] });
    }
  }
  return incidents.sort((a, b) => b.start.getTime() - a.start.getTime());
}

/** Horários-âncora de um incidente: quando caiu e quando voltou. */
const anchors = (start: Date, end: Date) => (end.getTime() - start.getTime() > 60_000 ? [start.getTime(), end.getTime()] : [start.getTime()]);

/**
 * Marca os incidentes em massa: quantos OUTROS equipamentos da mesma PON / OLT tiveram uma desconexão com início ou
 * volta a até 5 min de um dos horários deste incidente. Precisa da ONU do equipamento no inventário da OLT.
 */
export async function markMass(deviceId: string, incidents: Incident[], since: Date): Promise<void> {
  if (!incidents.length) return;
  const item = await inventory().findOne({ _id: deviceId }, { projection: { ponSerialKey: 1, pppoeKey: 1, accessType: 1 } });
  const own = item ? await onuForDevice(item) : null;
  if (!own) return;
  const onus = await oltOnus().find({ oltId: own.onu.oltId, absentSince: null }, { projection: { slot: 1, pon: 1, sn: 1, pppoe: 1 } }).toArray();
  const samePon = (o: { slot: number; pon: number }) => o.slot === own.onu.slot && o.pon === own.onu.pon;
  const sns = new Map<string, boolean>();
  const logins = new Map<string, boolean>();
  for (const o of onus) {
    if (o.sn) sns.set(o.sn, samePon(o));
    if (o.pppoe) logins.set(o.pppoe, samePon(o));
  }
  // Equipamentos do ACS nessas ONUs (pelo SN GPON ou pelo login), sem o próprio.
  const devs = await inventory().find(
    { _id: { $ne: deviceId }, staleOf: null, $or: [{ ponSerialKey: { $in: [...sns.keys()] } }, { pppoeKey: { $in: [...logins.keys()] } }] },
    { projection: { _id: 1, ponSerialKey: 1, pppoeKey: 1 } },
  ).toArray();
  const ponOf = new Map(devs.map((d) => [d._id, sns.get(d.ponSerialKey) ?? logins.get(d.pppoeKey) ?? false]));
  if (!ponOf.size) {
    for (const inc of incidents) inc.mass = null;
    return;
  }
  const evs = await deviceEvents()
    .find({ deviceId: { $in: [...ponOf.keys()] }, ts: { $gte: new Date(since.getTime() - 86400_000) }, type: { $in: ["olt.down", "reboot", "offline", "wan.down", "wan.reconnect"] } })
    .project<{ deviceId: string; type: string; ts: Date; details?: Record<string, unknown> }>({ deviceId: 1, type: 1, ts: 1, details: 1 })
    .toArray();
  const theirs = evs
    .map((e) => ({ id: e.deviceId, d: asDisconnection({ ...e, source: "zenie" }) }))
    .filter((x) => x.d !== null)
    .map((x) => ({ id: x.id, times: anchors(x.d!.start, x.d!.end) }));
  for (const inc of incidents) {
    const mine = anchors(inc.start, inc.end);
    const hit = new Set<string>();
    for (const t of theirs) {
      if (t.times.some((a) => mine.some((m) => Math.abs(a - m) <= MASS_WINDOW))) hit.add(t.id);
    }
    const pon = [...hit].filter((id) => ponOf.get(id)).length;
    inc.mass = pon >= massRules.pon || hit.size >= massRules.olt ? { pon, olt: hit.size, position: `${own.onu.slot}/${own.onu.pon}` } : null;
  }
}
