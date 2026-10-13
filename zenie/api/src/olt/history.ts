// Histórico de quedas da ONU lido na OLT (show gpon onu detail-info) -> eventos do equipamento (events.ts).
//
// A OLT sabe POR QUE a ONU caiu: DyingGasp = a ONU avisou que ia ficar sem energia; LOS/LOF = perdeu o sinal
// óptico (fibra, conector, splitter). Somente leitura na OLT: um comando por ONU.
// Lido automaticamente depois de um reinício/volta detectado pelo Zenie (fila curta, uma OLT por vez) e pelo botão
// da aba Eventos. Os horários da OLT não têm fuso: corrigidos pelo "Online Duration" (ou pelo fuso configurado).

import type { FastifyBaseLogger } from "fastify";
import type { ObjectId } from "mongodb";
import { config } from "../config.js";
import { deviceEvents, inventory, oltOnus, olts, type DeviceEvent, type EventLevel, type InventoryItem, type OltOnu } from "../db.js";
import { OltError, withSession } from "./service.js";
import { savingOlts } from "./tr069.js";
import { jobOf } from "./inventory.js";
import type { OnuDetail } from "./zte-c320-v21/parser.js";

// --------------------------------------------------------------------------------------- horário da OLT

/** Deslocamento (ms) do fuso `tz` no instante `at`: hora local - UTC. */
function zoneOffset(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at.getTime();
}

/** "2026-10-01 07:40:56" lido como se fosse UTC (o relógio da OLT não tem fuso). */
const naive = (v: string) => Date.parse(v.replace(" ", "T") + "Z");

/**
 * Converte os horários da OLT para instantes reais.
 * Online: o último Authpass + "Online Duration" = "agora" no relógio da OLT -> a diferença para o agora real cobre
 * fuso e relógio da OLT adiantado/atrasado. Offline: usa o fuso configurado (ZENIE_OLT_TZ).
 */
export function oltClock(d: OnuDetail, now: Date, tz = config.oltTimeZone): { toDate: (v: string) => Date; method: "online" | "fuso" } {
  const last = d.history.at(-1);
  if (last?.authpass && !last.offline && d.onlineSec !== null) {
    const shift = now.getTime() - (naive(last.authpass) + d.onlineSec * 1000);
    return { toDate: (v) => new Date(naive(v) + shift), method: "online" };
  }
  return { toDate: (v) => new Date(naive(v) - zoneOffset(new Date(naive(v)), tz)), method: "fuso" };
}

// --------------------------------------------------------------------------------------- causa

export interface OltCause { kind: "energia" | "fibra" | "outra"; level: EventLevel; title: string; text: string }

/** Causa da queda informada pela OLT. Vistos na C320 real (13/10/2026): "DyingGasp" e "LOSi". LOF por analogia. */
export function oltCause(raw: string | null): OltCause {
  const c = (raw ?? "").trim();
  if (/^dying\s*gasp$/i.test(c)) {
    return { kind: "energia", level: "warn", title: "Caiu na OLT: falta de energia na ONU", text: "a ONU avisou a OLT que ia ficar sem energia (dying gasp)" };
  }
  if (/^lo[sf]i?$/i.test(c)) {
    return { kind: "fibra", level: "bad", title: "Caiu na OLT: perda de sinal óptico", text: "a OLT perdeu o sinal da ONU (fibra, conector ou splitter)" };
  }
  return { kind: "outra", level: "warn", title: c ? `Caiu na OLT (${c})` : "Caiu na OLT", text: c ? `causa informada pela OLT: ${c}` : "a OLT não informou a causa" };
}

// --------------------------------------------------------------------------------------- eventos

type NewEvent = Omit<DeviceEvent, "_id">;

/** Uma queda por registro com OfflineTime, dentro da retenção; duração até a volta (próximo Authpass). */
export function historyEvents(deviceId: string, d: OnuDetail, now: Date, where: Record<string, unknown>, tz?: string): NewEvent[] {
  const clock = oltClock(d, now, tz);
  const since = now.getTime() - config.eventsDays * 86400_000;
  const out: NewEvent[] = [];
  d.history.forEach((r, i) => {
    if (!r.offline) return;
    const ts = clock.toDate(r.offline);
    if (ts.getTime() < since || ts.getTime() > now.getTime() + 5 * 60_000) return;
    const back = d.history[i + 1]?.authpass ? clock.toDate(d.history[i + 1]!.authpass!) : null;
    const c = oltCause(r.cause);
    out.push({
      deviceId,
      ts,
      type: "olt.down",
      level: c.level,
      title: c.title,
      details: {
        causa: c.kind,
        causaOlt: r.cause,
        explicacao: c.text,
        foraSegundos: back ? Math.max(0, Math.round((back.getTime() - ts.getTime()) / 1000)) : null,
        voltou: back,
        relogio: clock.method,
        ...where,
      },
    });
  });
  return out;
}

// --------------------------------------------------------------------------------------- ONU do equipamento

/**
 * OLTs prontas para consulta: ativas, com o teste de acesso feito (placas detectadas), driver compatível e o
 * inventário de ONUs já lido. Sem nenhuma (Zenie sem OLT, ou cadastrada e ainda não testada), nada consulta a OLT.
 */
export async function readyOltIds(): Promise<ObjectId[]> {
  const list = await olts()
    .find({ active: true, "detected.boards.0": { $exists: true }, compatibility: { $in: ["validada", "somente_leitura"] }, inventoryAt: { $ne: null } }, { projection: { _id: 1 } })
    .toArray();
  return list.map((o) => o._id!);
}

/** ONU da OLT ligada ao equipamento: pelo SN GPON e, sem ele, pelo login PPPoE (roteador atrás de ONU em bridge). */
export async function onuForDevice(item: Pick<InventoryItem, "ponSerialKey" | "pppoeKey" | "accessType">, ready?: ObjectId[]): Promise<{ onu: OltOnu; via: "sn" | "login" } | null> {
  const oltId = { $in: ready ?? (await readyOltIds()) };
  if (item.ponSerialKey) {
    const onu = await oltOnus().findOne({ oltId, sn: item.ponSerialKey, absentSince: null });
    if (onu) return { onu, via: "sn" };
  }
  if (item.pppoeKey) {
    const onu = await oltOnus().findOne({ oltId, pppoe: item.pppoeKey, absentSince: null });
    if (onu) return { onu, via: "login" };
  }
  return null;
}

export interface HistoryResult {
  position: string;
  olt: string;
  via: "sn" | "login";
  phase: string | null;
  records: number;
  added: number;
  confirmedReboots: number;
}

/** Lê o histórico da ONU na OLT, grava as quedas (sem duplicar) e confirma a causa dos reinícios por energia. */
export async function readOnuHistory(deviceId: string): Promise<HistoryResult> {
  const item = await inventory().findOne({ _id: deviceId });
  if (!item) throw new OltError("equipamento não encontrado", 404);
  const ready = await readyOltIds();
  if (!ready.length) throw new OltError("nenhuma OLT cadastrada e testada no Zenie", 404, "no_olt");
  const found = await onuForDevice(item, ready);
  if (!found) {
    // Roteador (WAN Ethernet) sem ONU casada pelo login: não há histórico de fibra para ele.
    if (item.accessType === "Roteador") throw new OltError("este equipamento não é uma ONU", 404, "not_onu");
    throw new OltError("ONU não encontrada no inventário das OLTs", 404, "not_found");
  }
  const { onu, via } = found;
  const oltId = String(onu.oltId);
  if (jobOf(oltId)?.running) throw new OltError("a leitura das PONs desta OLT está em andamento: tente depois", 409);
  if (savingOlts.has(oltId)) throw new OltError("a configuração desta OLT está sendo salva: tente depois", 409);

  const now = new Date();
  const { detail, oltName } = await withSession(oltId, async (drv, o) => ({ detail: await drv.onuDetail(onu.slot, onu.pon, onu.onu), oltName: o.name }));
  const position = `${onu.slot}/${onu.pon}:${onu.onu}`;
  const events = historyEvents(deviceId, detail, now, { olt: oltName, posicao: position, via });

  let added = 0;
  for (const e of events) {
    // Mesma queda relida: casa pelo horário (o relógio corrigido pode variar alguns segundos entre leituras).
    const dup = await deviceEvents().findOne({ deviceId, type: "olt.down", ts: { $gte: new Date(e.ts.getTime() - 120_000), $lte: new Date(e.ts.getTime() + 120_000) } });
    if (dup) continue;
    await deviceEvents().insertOne(e);
    added++;
  }

  // Reinício que o Zenie deduziu (sem contato / sem pedido do painel) logo depois de uma volta por falta de energia.
  let confirmedReboots = 0;
  for (const e of events.filter((x) => x.details?.causa === "energia" && x.details.voltou)) {
    const back = (e.details!.voltou as Date).getTime();
    const r = await deviceEvents().updateMany(
      { deviceId, type: "reboot", "details.causa": { $in: ["desligado", "local"] }, ts: { $gte: new Date(back - 10 * 60_000), $lte: new Date(back + 15 * 60_000) } },
      { $set: { title: "Reiniciou depois de falta de energia (confirmado pela OLT)", level: "warn", "details.causa": "energia", "details.explicacao": "a OLT registrou dying gasp (falta de energia na ONU)" } },
    );
    confirmedReboots += r.modifiedCount;
  }
  await oltOnus().updateOne({ _id: onu._id }, { $set: { phase: detail.phase ?? onu.phase, historyReadAt: now } });
  return { position, olt: oltName, via, phase: detail.phase, records: detail.history.length, added, confirmedReboots };
}

// --------------------------------------------------------------------------------------- fila automática

const MIN_INTERVAL = 10 * 60_000; // a mesma ONU no máximo a cada 10 min
const MAX_QUEUE = 200;
const PAUSE = 3_000; // entre leituras (uma sessão telnet por ONU)
const queue = new Map<string, number>(); // deviceId -> tentativas
const lastRead = new Map<string, number>();
let working = false;

/** Pede a leitura do histórico na OLT (depois de reinício/volta). Ignora se não há OLT ativa ou já leu há pouco. */
export function queueOnuHistory(deviceId: string, log?: FastifyBaseLogger): void {
  if (queue.has(deviceId) || queue.size >= MAX_QUEUE) return;
  if (Date.now() - (lastRead.get(deviceId) ?? 0) < MIN_INTERVAL) return;
  queue.set(deviceId, 0);
  if (!working) void work(log);
}

async function work(log?: FastifyBaseLogger): Promise<void> {
  working = true;
  try {
    if (!(await readyOltIds()).length) {
      queue.clear();
      return;
    }
    while (queue.size) {
      const [deviceId, tries] = queue.entries().next().value as [string, number];
      queue.delete(deviceId);
      try {
        const r = await readOnuHistory(deviceId);
        lastRead.set(deviceId, Date.now());
        if (r.added || r.confirmedReboots) log?.info({ deviceId, ...r }, "histórico de quedas lido na OLT");
      } catch (e) {
        const status = e instanceof OltError ? e.status : 500;
        // OLT ocupada (outra leitura/gravação): tenta de novo mais tarde, até 5 vezes. Sem ONU: não insiste.
        if (status === 409 && tries < 5) {
          setTimeout(() => {
            queue.set(deviceId, tries + 1);
            if (!working) void work(log);
          }, 60_000);
        } else if (status !== 404) {
          lastRead.set(deviceId, Date.now());
          log?.warn({ deviceId, err: e instanceof Error ? e.message : String(e) }, "falha ao ler o histórico de quedas na OLT");
        } else {
          lastRead.set(deviceId, Date.now());
        }
      }
      await new Promise((r) => setTimeout(r, PAUSE));
    }
  } finally {
    working = false;
  }
}
