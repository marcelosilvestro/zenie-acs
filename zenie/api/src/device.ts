// Modelo do equipamento para a ficha do painel, montado SÓ a partir dos virtual parameters
// (docs/PLANO.md seção 4). Nada de caminho TR-069 aqui: o que o modelo não tiver vira null.

import { unifyAdapter } from "./adapters/index.js";
import { CAPABILITIES, capabilityFor, HW_PATHS, isReadonly, modelOf, profileOf, profileProgress } from "./catalog.js";
import { config } from "./config.js";
import { upsertInventoryItem } from "./inventory.js";
import { nbiGet, toBool, vp, type NbiDevice } from "./nbi.js";
import { vendorOf } from "./oui.js";
import { extraRules, loadLevel, onlineState, rssiQuality, rules, rxLevel, tempLevel, txLevel } from "./rules.js";

/** Escalares lidos no "Atualizar" (as listas WifiClients/DhcpHosts são lidas à parte, sob demanda). */
export const SCALAR_VPS = [
  "PPPoEUsername", "PonSerial", "DeviceMacs", "AccessType", "FirmwareVersion", "Uptime",
  "RXPower", "TXPower", "PonTemperature", "PonVoltage", "PonBiasCurrent", "PonStatus",
  "WanStatus", "WanIP", "WanDetails", "LanDetails", "LanPorts",
  "WifiBandSteering", "WifiGeneration", "CpuUsage", "MemUsage", "ModelName",
  ...["24", "5"].flatMap((b) => ["SSID", "Enabled", "Channel", "Bandwidth", "Standard", "Security", "TxPower", "ClientsCount", "Options"].map((f) => `Wifi${b}${f}`)),
];
export const LIST_VPS = ["WifiClients", "DhcpHosts"];

const PROJECTION = ["_deviceId", "_lastInform", "_lastBoot", "_registered", "_tags", ...HW_PATHS, ...[...SCALAR_VPS, ...LIST_VPS].map((v) => `VirtualParameters.${v}`)];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};
const bool = toBool;
const json = <T>(v: string | null, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
const ts = (d: NbiDevice, name: string) => d.VirtualParameters?.[name]?._timestamp ?? null;

export const nbiPath = (id: string) => encodeURIComponent(id);

export async function fetchDevice(id: string): Promise<NbiDevice | null> {
  const query = encodeURIComponent(JSON.stringify({ _id: id }));
  const list = await nbiGet<NbiDevice[]>(`/devices/?query=${query}&projection=${encodeURIComponent(PROJECTION.join(","))}`);
  return list[0] ?? null;
}

interface WifiClient { band: string | null; ssid: number; mac: string; ip: string | null; name: string | null; rssi: number | null; rateMbps: number | null; connectedSec: number | null }
interface DhcpHost { name: string | null; ip: string | null; mac: string; iface: string | null; active: boolean | null; source: string | null; leaseSec: number | null }

export function buildDevice(d: NbiDevice) {
  const now = Date.now();
  const accessType = vp(d, "AccessType");
  const macs = json<{ base?: string; wan?: string[]; lan?: string }>(vp(d, "DeviceMacs"), {});
  const rx = num(vp(d, "RXPower"));
  const tx = num(vp(d, "TXPower"));
  const temp = num(vp(d, "PonTemperature"));
  const hasPon = rx !== null || vp(d, "PonStatus") !== null || accessType === "ONU";
  const lastInform = d._lastInform ? new Date(d._lastInform) : null;

  const band = (b: "24" | "5") => ({
    band: b === "24" ? "2.4" : "5",
    ssid: vp(d, `Wifi${b}SSID`),
    enabled: bool(vp(d, `Wifi${b}Enabled`)),
    channel: vp(d, `Wifi${b}Channel`),
    bandwidth: vp(d, `Wifi${b}Bandwidth`),
    standard: vp(d, `Wifi${b}Standard`),
    wifi6: (vp(d, `Wifi${b}Standard`) ?? "").split(",").map((s) => s.trim()).includes("ax"),
    security: vp(d, `Wifi${b}Security`),
    txPower: vp(d, `Wifi${b}TxPower`),
    // H198A V3.0: TotalAssociations fica em 0 com aparelho conectado; se a lista lida tem aparelhos na faixa, vale ela.
    clients: Math.max(num(vp(d, `Wifi${b}ClientsCount`)) ?? 0, wifiClients?.filter((c) => c.band === (b === "24" ? "2.4" : "5")).length ?? 0) || num(vp(d, `Wifi${b}ClientsCount`)),
    options: json<{ channels: number[]; powers: number[]; bandwidths: string[] } | null>(vp(d, `Wifi${b}Options`), null),
  });

  const wifiClients = json<WifiClient[] | null>(vp(d, "WifiClients"), null)?.map((c) => ({ ...c, quality: rssiQuality(c.rssi), vendor: vendorOf(c.mac) })) ?? null;
  // Entrada sem IP e sem nome não identifica aparelho (H3601P: interface interna do satélite, 5e:78:f0:..., IP 0.0.0.0).
  const hosts = json<DhcpHost[] | null>(vp(d, "DhcpHosts"), null)?.filter((h) => h.ip || h.name).map((h) => ({ ...h, vendor: vendorOf(h.mac) })) ?? null;

  const profile = profileOf(d);
  const unify = unifyAdapter(d, profile);
  const wifiState = { bandSteering: bool(vp(d, "WifiBandSteering")), ssid24: vp(d, "Wifi24SSID"), ssid5: vp(d, "Wifi5SSID") };
  const capabilities = Object.fromEntries(Object.keys(CAPABILITIES).map((k) => [k, capabilityFor(d, k, profile)]));
  return {
    id: d._id,
    profile: profile
      ? { id: profile.id, commercialName: profile.commercialName, kind: profile.kind, hasImage: !!profile.hasImage, notes: profile.notes ?? null, homologation: profile.homologation, progress: profileProgress(profile) }
      : null,
    capabilities,
    readonly: isReadonly(d),
    identity: {
      vendor: d._deviceId?._Manufacturer ?? null,
      model: modelOf(d),
      oui: d._deviceId?._OUI ?? null,
      serial: d._deviceId?._SerialNumber ?? null,
      ponSerial: vp(d, "PonSerial"),
      pppoe: vp(d, "PPPoEUsername"),
      firmware: vp(d, "FirmwareVersion"),
      accessType,
      wifiGeneration: vp(d, "WifiGeneration"),
      macs: { base: macs.base ?? null, wan: macs.wan ?? [], lan: macs.lan ?? null },
      tags: d._tags ?? [],
    },
    status: {
      state: onlineState(lastInform, now),
      lastInform: d._lastInform ?? null,
      lastBoot: d._lastBoot ?? null,
      registered: d._registered ?? null,
      uptimeSec: num(vp(d, "Uptime")),
      updatedAt: ts(d, "Uptime"),
    },
    system: {
      cpu: num(vp(d, "CpuUsage")),
      cpuLevel: loadLevel(num(vp(d, "CpuUsage"))),
      memory: num(vp(d, "MemUsage")),
      memoryLevel: loadLevel(num(vp(d, "MemUsage"))),
      updatedAt: ts(d, "CpuUsage") ?? ts(d, "MemUsage"),
    },
    optical: hasPon
      ? {
          rx, rxLevel: rxLevel(rx), tx, txLevel: txLevel(tx),
          temperature: temp, temperatureLevel: tempLevel(temp),
          voltage: num(vp(d, "PonVoltage")), biasCurrent: num(vp(d, "PonBiasCurrent")),
          ponStatus: vp(d, "PonStatus"), updatedAt: ts(d, "RXPower"),
        }
      : null,
    wan: {
      status: vp(d, "WanStatus"),
      ip: vp(d, "WanIP"),
      pppoe: vp(d, "PPPoEUsername"),
      ...json<Record<string, unknown>>(vp(d, "WanDetails"), {}),
      updatedAt: ts(d, "WanDetails") ?? ts(d, "WanStatus"),
    },
    lan: { ...json<Record<string, unknown>>(vp(d, "LanDetails"), {}), updatedAt: ts(d, "LanDetails") },
    ports: { list: json<{ port: number; name: string; up: boolean; speedMbps: number | null }[]>(vp(d, "LanPorts"), []), updatedAt: ts(d, "LanPorts") },
    wifi: {
      bandSteering: wifiState.bandSteering,
      // Rede unificada pelo adaptador do modelo (null = o modelo não unifica). "unified" = estado atual.
      unify: unify ? { source: unify.id, label: unify.label, unified: unify.state(wifiState), rules: unify.rules } : null,
      bands: [band("24"), band("5")],
      updatedAt: ts(d, "Wifi24SSID"),
    },
    clients: {
      wifi: wifiClients,
      wifiUpdatedAt: ts(d, "WifiClients"),
      hosts,
      hostsUpdatedAt: ts(d, "DhcpHosts"),
    },
    rules: {
      rx: { goodAbove: rules.rxGoodAbove, badAtOrBelow: rules.rxBadAtOrBelow, saturationAbove: rules.rxSaturationAbove },
      tx: { min: extraRules.txMin, max: extraRules.txMax },
      temperature: { warnAbove: extraRules.tempWarnAbove, badAbove: extraRules.tempBadAbove },
      informIntervalSec: rules.informIntervalSec,
    },
  };
}

export interface TaskResult {
  ok: boolean;
  /** "done" = executada agora; "unreachable" = CPE não respondeu ao connection request; "fault" = deu erro. */
  outcome: "done" | "unreachable" | "fault";
  message?: string;
  ms: number;
}

/**
 * Executa uma task no equipamento com connection request. Se não executar na hora, a task é
 * CANCELADA (não fica na fila): um reboot pendente que dispara horas depois é pior que falhar.
 */
export async function runTask(id: string, task: Record<string, unknown>, timeoutMs = 60_000): Promise<TaskResult> {
  const started = Date.now();
  const res = await fetch(`${config.nbiUrl}/devices/${nbiPath(id)}/tasks?connection_request&timeout=${timeoutMs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
    signal: AbortSignal.timeout(timeoutMs + 15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { _id?: string };
  const ms = Date.now() - started;
  if (res.status === 200) return { ok: true, outcome: "done", ms };
  if (res.status !== 202 || !body._id) return { ok: false, outcome: "fault", message: `NBI HTTP ${res.status}`, ms };

  // 202: ficou pendente — CPE não respondeu ou a task gerou fault. Descobre qual e limpa.
  const faultId = `${id}:task_${body._id}`;
  const faults = await nbiGet<{ _id: string; code: string; message: string }[]>(`/faults/?query=${encodeURIComponent(JSON.stringify({ _id: faultId }))}`);
  await fetch(`${config.nbiUrl}/tasks/${body._id}`, { method: "DELETE" }).catch(() => undefined);
  if (faults[0]) {
    await fetch(`${config.nbiUrl}/faults/${encodeURIComponent(faultId)}`, { method: "DELETE" }).catch(() => undefined);
    return { ok: false, outcome: "fault", message: `${faults[0].code}: ${faults[0].message}`, ms };
  }
  return { ok: false, outcome: "unreachable", message: "o equipamento não respondeu ao pedido de conexão", ms };
}

/** Atualiza a linha do equipamento no índice de busca depois de uma leitura. */
export async function refreshInventory(d: NbiDevice): Promise<void> {
  await upsertInventoryItem(d);
}
