// Índice de busca (coleção "inventory" do banco zenie), montado a partir dos virtual parameters do
// GenieACS — o painel não usa caminhos TR-069. Atualizado a cada ZENIE_SYNC_SECONDS e sob demanda.

import type { FastifyBaseLogger } from "fastify";
import { displayModel, HW_PATHS, hwOf, matchProfile } from "./catalog.js";
import { audit, deviceEvents, inventory, oltOnus, type InventoryItem } from "./db.js";
import { diffDevice } from "./events.js";
import { queueOnuHistory } from "./olt/history.js";
import { nbiDevices, vp, type NbiDevice } from "./nbi.js";

const VPS = [
  "PPPoEUsername", "PonSerial", "DeviceMacs", "WanIP", "WanStatus", "RXPower", "TXPower",
  "PonStatus", "FirmwareVersion", "AccessType", "Uptime", "WifiGeneration", "ModelName", "WanDetails",
];

const PROJECTION = ["_deviceId", "_lastInform", "_lastBoot", "_registered", "_tags", ...HW_PATHS, ...VPS.map((v) => `VirtualParameters.${v}`)];

/** MAC sem separadores e minúsculo ("f00c51d308a4"), para busca com ou sem ":"/"-". */
export const macKey = (v: string) => v.replace(/[^0-9a-fA-F]/g, "").toLowerCase();

const toDate = (v?: string) => (v ? new Date(v) : null);
const toNum = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

/** Campos da WAN usados pelos eventos (tempo de conexão, último erro, link físico), do VP WanDetails. */
function wanExtra(d: NbiDevice): Pick<InventoryItem, "wanUptimeSec" | "wanLastError" | "wanLink" | "wanReadAt"> {
  try {
    const w = JSON.parse(vp(d, "WanDetails") ?? "{}") as { uptimeSec?: unknown; lastError?: unknown; link?: { status?: unknown } };
    const ts = d.VirtualParameters?.WanDetails?._timestamp;
    return {
      wanUptimeSec: toNum(w.uptimeSec),
      wanLastError: typeof w.lastError === "string" && w.lastError ? w.lastError : null,
      wanLink: typeof w.link?.status === "string" && w.link.status ? w.link.status : null,
      wanReadAt: ts ? new Date(ts) : null,
    };
  } catch {
    return { wanUptimeSec: null, wanLastError: null, wanLink: null, wanReadAt: null };
  }
}

export function normalize(d: NbiDevice, now: Date): InventoryItem {
  const pppoe = vp(d, "PPPoEUsername");
  const ponSerial = vp(d, "PonSerial");
  let macs: string[] = [];
  try {
    const m = JSON.parse(vp(d, "DeviceMacs") ?? "{}") as { base?: string; wan?: string[]; lan?: string };
    macs = [m.base, ...(m.wan ?? []), m.lan].filter((x): x is string => !!x).map(macKey);
  } catch {
    macs = [];
  }
  return {
    _id: d._id,
    vendor: d._deviceId?._Manufacturer ?? null,
    // Modelo exibido/agrupado: ProductClass, ou ModelName quando o ProductClass é genérico (TP-Link "IGD").
    model: displayModel(d._deviceId?._ProductClass, vp(d, "ModelName")),
    productClass: d._deviceId?._ProductClass ?? null,
    modelName: vp(d, "ModelName"),
    oui: d._deviceId?._OUI ?? null,
    serial: d._deviceId?._SerialNumber ?? null,
    serialKey: (d._deviceId?._SerialNumber ?? "").toUpperCase(),
    pppoe,
    pppoeKey: (pppoe ?? "").toLowerCase(),
    ponSerial,
    ponSerialKey: (ponSerial ?? "").toUpperCase(),
    ponSerialSource: ponSerial ? "cpe" : undefined,
    macs: [...new Set(macs)],
    wanIp: vp(d, "WanIP"),
    wanStatus: vp(d, "WanStatus"),
    ...wanExtra(d),
    accessType: vp(d, "AccessType"),
    firmware: vp(d, "FirmwareVersion"),
    hardwareVersion: hwOf(d),
    wifiGeneration: vp(d, "WifiGeneration"),
    ...(() => {
      const p = matchProfile(d._deviceId?._Manufacturer, d._deviceId?._ProductClass, vp(d, "ModelName"), hwOf(d));
      return { profileId: p?.id ?? null, homologated: !!p };
    })(),
    rx: toNum(vp(d, "RXPower")),
    tx: toNum(vp(d, "TXPower")),
    ponStatus: vp(d, "PonStatus"),
    uptimeSec: toNum(vp(d, "Uptime")),
    tags: d._tags ?? [],
    lastInform: toDate(d._lastInform),
    lastBoot: toDate(d._lastBoot),
    registered: toDate(d._registered),
    syncedAt: now,
  };
}

/**
 * Mesmo fabricante + serial em mais de um registro: vale o de inform mais recente; os outros são "registro
 * antigo" (troca de modelo de dados TR-098 <-> TR-181 muda o ProductClass e, com ele, o id no GenieACS).
 */
async function markStale(items: InventoryItem[]): Promise<void> {
  const groups = new Map<string, InventoryItem[]>();
  for (const it of items) {
    if (!it.serialKey) continue;
    const key = `${(it.vendor ?? "").toUpperCase()}|${it.serialKey}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const ops: { updateOne: { filter: { _id: string }; update: { $set: { staleOf: string | null } } } }[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => (b.lastInform?.getTime() ?? 0) - (a.lastInform?.getTime() ?? 0));
    const current = sorted[0]!;
    for (const it of sorted) ops.push({ updateOne: { filter: { _id: it._id }, update: { $set: { staleOf: it === current ? null : current._id } } } });
  }
  if (ops.length) await inventory().bulkWrite(ops, { ordered: false });
}

/**
 * Equipamento que não publica o serial GPON (ex.: F670L V9.0.11P3N10): usa o SN que a OLT mostra
 * para a ONU com o mesmo login PPPoE (inventário do módulo OLT). Marca a origem ("olt") para a ficha avisar.
 */
export async function fillPonSerialFromOlt(): Promise<number> {
  // Só ONU (ou tipo desconhecido): roteador não tem SN PON e, atrás de ONU em bridge, usa o mesmo login da ONU.
  const missing = await inventory().find({ ponSerialKey: "", pppoeKey: { $ne: "" }, accessType: { $ne: "Roteador" } }, { projection: { _id: 1, pppoeKey: 1 } }).toArray();
  if (!missing.length) return 0;
  const onus = await oltOnus().find({ pppoe: { $in: missing.map((m) => m.pppoeKey) }, sn: { $ne: null }, absentSince: null }, { projection: { pppoe: 1, sn: 1 } }).toArray();
  const snByLogin = new Map(onus.map((o) => [o.pppoe!, o.sn!]));
  const ops = missing
    .filter((m) => snByLogin.has(m.pppoeKey))
    .map((m) => ({ updateOne: { filter: { _id: m._id }, update: { $set: { ponSerial: snByLogin.get(m.pppoeKey)!, ponSerialKey: snByLogin.get(m.pppoeKey)!.toUpperCase(), ponSerialSource: "olt" as const } } } }));
  if (ops.length) await inventory().bulkWrite(ops, { ordered: false });
  return ops.length;
}

/** Atualiza um item do índice (após ler o equipamento na hora), com a mesma detecção de eventos do sync. */
export async function upsertInventoryItem(d: NbiDevice, log?: FastifyBaseLogger): Promise<void> {
  const it = normalize(d, new Date());
  await detectEvents([it], it.syncedAt, false, log).catch((e) => log?.error({ err: e }, "falha ao detectar eventos"));
  await inventory().replaceOne({ _id: it._id }, it, { upsert: true });
}

let running: Promise<{ total: number; removed: number }> | null = null;

/** Campos do item anterior usados para detectar eventos (events.ts). */
const DIFF_PROJECTION = {
  lastInform: 1, lastBoot: 1, uptimeSec: 1, wanStatus: 1, wanIp: 1, wanUptimeSec: 1, wanLastError: 1, wanLink: 1, wanReadAt: 1, rx: 1, ponStatus: 1, firmware: 1, pppoe: 1, staleOf: 1, offlineSince: 1, rxBand: 1, wanUpSeenAt: 1,
} as const;

/**
 * Compara com o estado anterior, grava os eventos e passa o estado dos eventos para os itens novos.
 * `all`: sincronização completa (lê o inventário inteiro); senão, só os itens passados (botão Atualizar).
 */
async function detectEvents(items: InventoryItem[], now: Date, all: boolean, log?: FastifyBaseLogger): Promise<number> {
  const filter = all ? {} : { _id: { $in: items.map((i) => i._id) } };
  const prev = new Map((await inventory().find(filter, { projection: DIFF_PROJECTION }).toArray()).map((p) => [p._id, p]));
  // Inventário vazio (instalação nova / banco restaurado sem índice): não anuncia todos como "registrado".
  const announceNew = all ? prev.size > 0 : (await inventory().estimatedDocumentCount()) > 0;
  // Reinícios pedidos pelo painel (auditoria) nas últimas horas: causa do reboot.
  const panelReboots = new Map<string, { ts: Date; username?: string }>();
  const rebootFilter = { action: "device.reboot", ts: { $gte: new Date(now.getTime() - 3 * 3600_000) }, ...(all ? {} : { target: { $in: items.map((i) => i._id) } }) };
  for (const a of await audit().find(rebootFilter).sort({ ts: 1 }).toArray()) {
    if (a.target) panelReboots.set(a.target, { ts: a.ts, username: a.username });
  }
  const events = [];
  for (const it of items) {
    const r = diffDevice(prev.get(it._id) ?? null, it, now, { announceNew, panelReboot: panelReboots.get(it._id) ?? null });
    Object.assign(it, r.state);
    events.push(...r.events);
  }
  if (events.length) {
    try {
      await deviceEvents().insertMany(events, { ordered: false });
    } catch (e) {
      log?.error({ err: e }, "falha ao gravar eventos dos equipamentos");
    }
  }
  // Reinício sem causa conhecida ou volta depois de ficar sem contato: a OLT diz se foi energia ou fibra.
  for (const e of events) {
    const cause = e.details?.causa;
    if (e.type === "online" || (e.type === "reboot" && (cause === "desligado" || cause === "local"))) queueOnuHistory(e.deviceId, log);
  }
  return events.length;
}

/** Sincroniza o índice com o GenieACS (uma execução por vez). */
export function syncInventory(log?: FastifyBaseLogger): Promise<{ total: number; removed: number }> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    const now = new Date();
    const devices = await nbiDevices(PROJECTION);
    const items = devices.map((d) => normalize(d, now));
    const events = await detectEvents(items, now, true, log).catch((e) => {
      log?.error({ err: e }, "falha ao detectar eventos");
      return 0;
    });
    if (items.length) {
      await inventory().bulkWrite(items.map((it) => ({ replaceOne: { filter: { _id: it._id }, replacement: it, upsert: true } })), { ordered: false });
    }
    // Equipamento apagado do GenieACS sai do índice.
    const removed = (await inventory().deleteMany({ syncedAt: { $lt: now } })).deletedCount;
    await markStale(items);
    await fillPonSerialFromOlt();
    log?.info({ total: items.length, removed, events, ms: Date.now() - started }, "inventário sincronizado");
    return { total: items.length, removed };
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startInventorySync(seconds: number, log: FastifyBaseLogger): NodeJS.Timeout {
  const run = () => syncInventory(log).catch((e) => log.error({ err: e }, "falha ao sincronizar inventário"));
  void run();
  return setInterval(run, seconds * 1000);
}
