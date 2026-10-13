// Adaptador de diagnóstico "tr098-ipping": teste de ping executado PELO equipamento
// (InternetGatewayDevice.IPPingDiagnostics — existe nos 8 modelos ZTE dos samples).
// Diagnóstico é comando, não dado normalizável: o caminho TR-069 fica só aqui. O TR-181
// (Device.IP.Diagnostics.IPPing) vira outro adaptador quando chegar o primeiro sample TR-181.

import { runTask } from "../../device.js";
import { nbiGet, type NbiDevice } from "../../nbi.js";
import type { PingAdapter, PingResult } from "../types.js";

const PING = "InternetGatewayDevice.IPPingDiagnostics.";
const PING_RESULTS = ["DiagnosticsState", "SuccessCount", "FailureCount", "AverageResponseTime", "MinimumResponseTime", "MaximumResponseTime"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readRaw(id: string, paths: string[]): Promise<Record<string, unknown>> {
  const q = encodeURIComponent(JSON.stringify({ _id: id }));
  const [d] = await nbiGet<NbiDevice[]>(`/devices/?query=${q}&projection=${encodeURIComponent(paths.join(","))}`);
  const out: Record<string, unknown> = {};
  for (const p of paths) {
    let node: unknown = d;
    for (const part of p.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    out[p.slice(p.lastIndexOf(".") + 1)] = (node as { _value?: unknown } | undefined)?._value ?? null;
  }
  return out;
}


/**
 * WAN conectada (PPP ou IP) para o campo Interface: a F670L V1 (V1.1.20P3N12) não executa o ping sem ele — volta
 * DiagnosticsState "None" sem nenhuma resposta (bancada 2026-10-09; com a WAN PPPoE preenchida: 4/4, 18 ms).
 * Prefere a conexão com o IP da WAN atual.
 */
async function connectedWan(id: string): Promise<string | null> {
  const q = encodeURIComponent(JSON.stringify({ _id: id }));
  const [d] = await nbiGet<NbiDevice[]>(`/devices/?query=${q}&projection=InternetGatewayDevice.WANDevice,VirtualParameters.WanIP`);
  const wanIp = (d?.VirtualParameters?.WanIP?._value as string | undefined) ?? null;
  type N = Record<string, unknown>;
  const kids = (n: unknown) => Object.entries((n as N | undefined) ?? {}).filter(([k, v]) => /^\d+$/.test(k) && typeof v === "object") as [string, N][];
  const val = (n: N, k: string) => (n[k] as { _value?: unknown } | undefined)?._value;
  const found: { path: string; ip: unknown }[] = [];
  for (const [wd, w] of kids((d as unknown as N)?.InternetGatewayDevice && ((d as unknown as N).InternetGatewayDevice as N).WANDevice)) {
    for (const [cd, c] of kids(w.WANConnectionDevice)) {
      for (const kind of ["WANPPPConnection", "WANIPConnection"]) {
        for (const [i, x] of kids(c[kind])) {
          if (val(x, "ConnectionStatus") === "Connected") found.push({ path: `InternetGatewayDevice.WANDevice.${wd}.WANConnectionDevice.${cd}.${kind}.${i}`, ip: val(x, "ExternalIPAddress") });
        }
      }
    }
  }
  return (found.find((f) => wanIp && f.ip === wanIp) ?? found[0])?.path ?? null;
}

async function ping(id: string, target: string, host: string | null): Promise<PingResult> {
  const first = await pingOnce(id, target, host, null);
  // "None" sem resposta = o firmware não executou (F670L V1 exige a interface): repete pela WAN conectada.
  if (first.state === "None" && first.received === 0) {
    const wan = await connectedWan(id);
    if (wan) return pingOnce(id, target, host, wan);
  }
  return first;
}

async function pingOnce(id: string, target: string, host: string | null, iface: string | null): Promise<PingResult> {
  const base: PingResult = { target, host, ok: false, state: null, sent: 4, received: 0, lossPct: null, avgMs: null, minMs: null, maxMs: null };
  if (!host) return { ...base, error: "sem endereço IPv4 para testar" };
  const set = await runTask(id, {
    name: "setParameterValues",
    parameterValues: [
      ...(iface ? [[`${PING}Interface`, iface, "xsd:string"] as [string, string, string]] : []),
      [`${PING}Host`, host, "xsd:string"],
      [`${PING}NumberOfRepetitions`, 4, "xsd:unsignedInt"],
      [`${PING}Timeout`, 1000, "xsd:unsignedInt"],
      [`${PING}DataBlockSize`, 64, "xsd:unsignedInt"],
      [`${PING}DiagnosticsState`, "Requested", "xsd:string"],
    ],
  });
  if (!set.ok) return { ...base, error: set.message ?? set.outcome };

  // A CPE executa e avisa com "8 DIAGNOSTICS COMPLETE"; consultamos até terminar (máx. ~25 s).
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 5000 : 4000);
    const get = await runTask(id, { name: "getParameterValues", parameterNames: PING_RESULTS.map((p) => PING + p) });
    if (!get.ok) continue;
    const r = await readRaw(id, PING_RESULTS.map((p) => PING + p));
    const state = r.DiagnosticsState === null ? null : String(r.DiagnosticsState);
    if (state === "Requested") continue;
    const received = Number(r.SuccessCount ?? 0);
    const failed = Number(r.FailureCount ?? 0);
    const sent = received + failed || 4;
    const ms = (v: unknown) => (v === null || Number(v) <= 0 && received === 0 ? null : Number(v));
    return {
      ...base,
      ok: state === "Complete" && received > 0,
      state,
      sent,
      received,
      lossPct: Math.round(((sent - received) / sent) * 100),
      avgMs: ms(r.AverageResponseTime),
      minMs: ms(r.MinimumResponseTime),
      maxMs: ms(r.MaximumResponseTime),
      ...(state !== "Complete"
        ? { error: /resolve/i.test(state ?? "") ? "o equipamento não conseguiu resolver o nome (DNS)" : `diagnóstico terminou com "${state}"` }
        : {}),
    };
  }
  return { ...base, error: "o equipamento não concluiu o teste a tempo" };
}

export const tr098IpPing: PingAdapter = { id: "tr098-ipping", label: "IPPing TR-098", ping };
