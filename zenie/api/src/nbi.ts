// Cliente da NBI do GenieACS (rede interna do compose; a NBI não tem autenticação e nunca é exposta).

import { config } from "./config.js";

export interface NbiValue<T = unknown> {
  _value?: T;
  _timestamp?: string;
  _type?: string;
  _writable?: boolean;
}

export interface NbiDevice {
  _id: string;
  _deviceId?: { _Manufacturer?: string; _OUI?: string; _ProductClass?: string; _SerialNumber?: string };
  _lastInform?: string;
  _lastBoot?: string;
  _registered?: string;
  _tags?: string[];
  VirtualParameters?: Record<string, NbiValue>;
}

export async function nbiGet<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`${config.nbiUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`NBI ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Apaga o REGISTRO de um equipamento no banco do GenieACS (não envia nada ao equipamento). */
export async function nbiDeleteDevice(id: string): Promise<void> {
  const res = await fetch(`${config.nbiUrl}/devices/${encodeURIComponent(id)}`, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  if (!res.ok && res.status !== 404) throw new Error(`NBI DELETE /devices/${id}: HTTP ${res.status}`);
}

/** Apaga as tarefas e falhas pendentes de um equipamento (antes de removê-lo: não deixar órfãs no GenieACS). */
export async function nbiDeletePending(id: string): Promise<{ tasks: number; faults: number }> {
  const q = encodeURIComponent(JSON.stringify({ device: id }));
  const tasks = await nbiGet<{ _id: string }[]>(`/tasks/?query=${q}&projection=_id`);
  for (const t of tasks) await fetch(`${config.nbiUrl}/tasks/${encodeURIComponent(t._id)}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
  const faults = await nbiGet<{ _id: string }[]>(`/faults/?query=${q}&projection=_id`);
  for (const f of faults) await fetch(`${config.nbiUrl}/faults/${encodeURIComponent(f._id)}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
  return { tasks: tasks.length, faults: faults.length };
}

/** Lê todos os dispositivos em páginas, com a projeção pedida. */
export async function nbiDevices(projection: string[], pageSize = 500): Promise<NbiDevice[]> {
  const out: NbiDevice[] = [];
  for (let skip = 0; ; skip += pageSize) {
    const page = await nbiGet<NbiDevice[]>(`/devices/?projection=${encodeURIComponent(projection.join(","))}&limit=${pageSize}&skip=${skip}`);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

/** Valor de um virtual parameter ("" e ausência viram null). */
export function vp<T = string>(device: NbiDevice, name: string): T | null {
  const v = device.VirtualParameters?.[name]?._value;
  return v === undefined || v === null || v === "" ? null : (v as T);
}

/** Booleano TR-069 ("1"/"true"/1/true); vazio ou ausente = null. */
export const toBool = (v: unknown): boolean | null => (v === null || v === undefined || v === "" ? null : v === true || v === "true" || v === 1 || v === "1");
