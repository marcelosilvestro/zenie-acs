// Eventos dos equipamentos (coleção "device_events"): derivados pelo Zenie comparando o estado anterior do
// inventário com o novo a cada sincronização — sem mexer no equipamento, vale para todos os fabricantes.
// Ações do NOC (auditoria) e falhas de task do GenieACS entram na mesma linha do tempo na leitura (eventsFor).

import { audit, deviceEvents, type DeviceEvent, type EventLevel, type InventoryItem } from "./db.js";
import { nbiGet } from "./nbi.js";
import { onlineState, rules } from "./rules.js";

/** Faixa do RX para eventos: igual à do NOC (rules.ts), com saturação separada. */
export type RxBand = "sat" | "ok" | "warn" | "bad";
const RX_HYSTERESIS = 0.5; // dB: só muda de faixa a 0,5 dB além da borda (não oscila no limite)

function rxBandOf(rx: number): RxBand {
  if (rx > rules.rxSaturationAbove) return "sat";
  if (rx > rules.rxGoodAbove) return "ok";
  if (rx > rules.rxBadAtOrBelow) return "warn";
  return "bad";
}

/** Faixa nova com histerese: fica na anterior enquanto o RX estiver a menos de 0,5 dB de uma borda. */
export function nextRxBand(rx: number | null, prev: RxBand | null | undefined): RxBand | null {
  if (rx === null) return prev ?? null;
  const band = rxBandOf(rx);
  if (!prev || band === prev) return band;
  return rxBandOf(rx + RX_HYSTERESIS) === band && rxBandOf(rx - RX_HYSTERESIS) === band ? band : prev;
}

const RX_EVENT: Record<RxBand, { level: EventLevel; title: string }> = {
  ok: { level: "ok", title: "Sinal óptico normalizado" },
  warn: { level: "warn", title: "Sinal óptico em atenção" },
  bad: { level: "bad", title: "Sinal óptico ruim" },
  sat: { level: "bad", title: "Sinal óptico saturado (forte demais)" },
};

/** Estado que passa de uma sincronização para a outra (o replaceOne do inventário apagaria). */
export interface CarriedState {
  /** null = em contato; Date = último contato antes de ficar offline; undefined = ainda sem referência. */
  offlineSince?: Date | null;
  rxBand?: RxBand | null;
  /** Quando o Zenie viu a WAN voltar (evento wan.up): a leitura seguinte da conexão não vira "reconectou". */
  wanUpSeenAt?: Date | null;
}

type NewEvent = Omit<DeviceEvent, "_id">;

/** LastConnectionError (TR-098) em português, para a causa da queda da WAN. */
const WAN_ERRORS: Record<string, string> = {
  ERROR_AUTHENTICATION_FAILURE: "falha de autenticação PPPoE (usuário/senha)",
  ERROR_ISP_TIME_OUT: "sem resposta do servidor PPPoE",
  ERROR_ISP_DISCONNECT: "o servidor PPPoE encerrou a conexão",
  ERROR_IDLE_DISCONNECT: "desconectado por inatividade",
  ERROR_USER_DISCONNECT: "desconectado no próprio equipamento",
  ERROR_FORCED_DISCONNECT: "desconexão forçada",
  ERROR_SERVER_OUT_OF_RESOURCES: "servidor PPPoE sem recursos",
  ERROR_ACCOUNT_DISABLED: "conta PPPoE desativada",
  ERROR_ACCOUNT_EXPIRED: "conta PPPoE expirada",
  ERROR_PASSWORD_EXPIRED: "senha PPPoE expirada",
  ERROR_RESTRICTED_LOGON_HOURS: "fora do horário permitido",
  ERROR_NO_CARRIER: "sem portadora (link)",
  ERROR_IP_CONFIGURATION: "falha na configuração de IP",
  ERROR_NOT_ENABLED_FOR_INTERNET: "conexão não habilitada para internet",
  ERROR_COMMAND_ABORTED: "conexão abortada",
  ERROR_UNKNOWN: "erro desconhecido",
};

/** Causa da queda da WAN: porta física sem link ou último erro informado pelo equipamento (null = nada útil). */
export function wanCause(it: Pick<InventoryItem, "wanLink" | "wanLastError">): string | null {
  if (has(it.wanLink) && !isUp(it.wanLink)) return "porta WAN sem link (cabo ou equipamento ligado na WAN)";
  if (has(it.wanLastError) && it.wanLastError !== "ERROR_NONE") return WAN_ERRORS[it.wanLastError] ?? it.wanLastError;
  return null;
}

/** Início da conexão WAN atual (leitura do WanDetails - tempo conectado); null sem dado. */
const wanStart = (it: Pick<InventoryItem, "wanReadAt" | "wanUptimeSec">) =>
  it.wanReadAt && typeof it.wanUptimeSec === "number" ? it.wanReadAt.getTime() - it.wanUptimeSec * 1000 : null;

const WAN_START_TOLERANCE = 120_000; // relógio/atraso de leitura: mesma conexão varia alguns segundos
const PANEL_REBOOT_WINDOW = 15 * 60_000; // pedido do painel até 15 min antes do boot

export interface DiffOptions {
  /** Anunciar equipamento novo (falso na carga inicial do inventário). */
  announceNew?: boolean;
  /** Último reinício pedido pelo painel para este equipamento (auditoria). */
  panelReboot?: { ts: Date; username?: string } | null;
}

/** Causa provável do reinício, deduzida do que o Zenie sabe (nenhum equipamento informa o motivo). */
function rebootCause(prev: InventoryItem, next: InventoryItem, boot: Date, opts: DiffOptions): { title: string; details: Record<string, unknown> } {
  const pr = opts.panelReboot;
  if (pr && pr.ts.getTime() <= boot.getTime() + 60_000 && boot.getTime() - pr.ts.getTime() <= PANEL_REBOOT_WINDOW) {
    return { title: "Reiniciado pelo painel", details: { causa: "painel", usuario: pr.username ?? null } };
  }
  if (has(prev.firmware) && has(next.firmware) && prev.firmware !== next.firmware) {
    return { title: "Reiniciou para atualizar o firmware", details: { causa: "firmware", de: prev.firmware, para: next.firmware } };
  }
  // Sem inform por mais de 2 ciclos antes do boot: o equipamento estava desligado (ONU sem energia ou desligada).
  const silentSec = prev.lastInform ? Math.round((boot.getTime() - prev.lastInform.getTime()) / 1000) : null;
  if (silentSec !== null && silentSec > rules.informIntervalSec * 2 + 60) {
    return { title: "Reiniciou depois de ficar sem contato", details: { causa: "desligado", foraSegundos: silentSec, explicacao: "provável falta de energia ou equipamento desligado" } };
  }
  return { title: "Reiniciou sem pedido do painel", details: { causa: "local", explicacao: "botão, app do cliente, travamento ou queda rápida de energia" } };
}

const has = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";
const isUp = (s: string) => /^(connected|up)$/i.test(s.trim());

/**
 * Compara o item anterior com o novo. Devolve os eventos e o estado a gravar no item novo.
 * Sem item anterior: equipamento novo (evento só se `announceNew`). Dado ausente (null/"") nunca é mudança.
 */
export function diffDevice(
  prev: (InventoryItem & CarriedState) | null,
  next: InventoryItem,
  now: Date,
  opts: DiffOptions = {},
): { events: NewEvent[]; state: CarriedState } {
  const announceNew = opts.announceNew ?? true;
  const events: NewEvent[] = [];
  const ev = (type: string, level: EventLevel, title: string, details?: Record<string, unknown>, ts = now) =>
    events.push({ deviceId: next._id, ts, type, level, title, ...(details ? { details } : {}) });

  const offline = onlineState(next.lastInform, now.getTime()) === "offline";
  const state: CarriedState = {
    offlineSince: offline ? (prev?.offlineSince ?? next.lastInform) : null,
    rxBand: nextRxBand(next.rx, prev?.rxBand),
    wanUpSeenAt: prev?.wanUpSeenAt ?? null,
  };

  if (!prev) {
    if (announceNew) ev("registered", "info", "Equipamento registrado no ACS", { modelo: next.model, firmware: next.firmware });
    return { events, state };
  }
  // Registro antigo do mesmo equipamento (troca TR-098 <-> TR-181): os eventos ficam no registro atual.
  if (prev.staleOf) return { events: [], state };

  // Contato com o ACS. Sem referência anterior (primeira sincronização com eventos): só registra o estado.
  if (prev.offlineSince !== undefined) {
    if (offline && !prev.offlineSince) {
      ev("offline", "bad", "Sem contato com o ACS", { ultimoContato: next.lastInform });
    } else if (!offline && prev.offlineSince) {
      const sec = next.lastInform ? Math.max(0, Math.round((next.lastInform.getTime() - prev.offlineSince.getTime()) / 1000)) : null;
      ev("online", "ok", "Voltou a falar com o ACS", { foraSegundos: sec, desde: prev.offlineSince });
    }
  }

  // Reinício: o GenieACS marca _lastBoot no inform com o evento BOOT. A causa é deduzida (rebootCause).
  if (next.lastBoot && prev.lastBoot && next.lastBoot.getTime() > prev.lastBoot.getTime()) {
    const c = rebootCause(prev, next, next.lastBoot, opts);
    ev("reboot", c.details.causa === "local" || c.details.causa === "desligado" ? "warn" : "info", c.title, c.details, next.lastBoot);
  }

  // WAN (status "Connected"/"Up" = no ar).
  const wanUpNow = has(next.wanStatus) && isUp(next.wanStatus);
  if (has(prev.wanStatus) && has(next.wanStatus) && isUp(prev.wanStatus) !== isUp(next.wanStatus)) {
    if (wanUpNow) {
      ev("wan.up", "ok", "Internet (WAN) conectada", { ip: next.wanIp });
      state.wanUpSeenAt = now;
    }
    else ev("wan.down", "bad", "Internet (WAN) desconectada", { status: next.wanStatus, causa: wanCause(next) });
  } else if (wanUpNow) {
    // Reconexão entre duas leituras: a conexão atual começou depois da anterior (início = leitura - tempo conectado).
    // Pega quedas curtas que o status não mostra; o horário é o do início da nova conexão.
    const before = wanStart(prev);
    const start = wanStart(next);
    const boot = next.lastBoot?.getTime() ?? null;
    const fromBoot = start !== null && boot !== null && start >= boot - 5 * 60_000 && start <= boot + 10 * 60_000;
    // Volta já anunciada pelo status (wan.up): a conexão começou até ~30 min antes de o Zenie ver (leitura a cada 15 min).
    const seen = state.wanUpSeenAt?.getTime() ?? null;
    const announced = start !== null && seen !== null && start <= seen && start >= seen - 30 * 60_000;
    if (before !== null && start !== null && start - before > WAN_START_TOLERANCE && !fromBoot && !announced && start <= now.getTime()) {
      const ip = has(prev.wanIp) && has(next.wanIp) && prev.wanIp !== next.wanIp ? { de: prev.wanIp, para: next.wanIp } : {};
      ev("wan.reconnect", "warn", "Internet (WAN) reconectou", { causa: wanCause(next), ...ip }, new Date(start));
    } else if (has(prev.wanIp) && has(next.wanIp) && prev.wanIp !== next.wanIp) {
      ev("wan.ip", "info", "IP da WAN mudou (reconexão)", { de: prev.wanIp, para: next.wanIp });
    }
  }

  // Sinal óptico: só na mudança de faixa (com histerese).
  if (prev.rxBand && state.rxBand && prev.rxBand !== state.rxBand) {
    ev("rx.level", RX_EVENT[state.rxBand].level, RX_EVENT[state.rxBand].title, { rx: next.rx, antes: prev.rx });
  }

  if (has(prev.ponStatus) && has(next.ponStatus) && prev.ponStatus !== next.ponStatus) {
    ev("pon.status", isUp(next.ponStatus) ? "ok" : "warn", `Status PON: ${next.ponStatus}`, { antes: prev.ponStatus });
  }
  if (has(prev.firmware) && has(next.firmware) && prev.firmware !== next.firmware) {
    ev("firmware", "info", "Firmware mudou", { de: prev.firmware, para: next.firmware });
  }
  if (has(prev.pppoe) && has(next.pppoe) && prev.pppoe !== next.pppoe) {
    ev("pppoe", "info", "Login PPPoE mudou", { de: prev.pppoe, para: next.pppoe });
  }
  return { events, state };
}

// ------------------------------------------------------------------------------------------- leitura

export type EventSource = "zenie" | "noc" | "acs";

export interface TimelineEntry {
  ts: Date;
  source: EventSource;
  type: string;
  level: EventLevel;
  title: string;
  details?: Record<string, unknown>;
  username?: string;
}

const AUDIT_TITLE: Record<string, string> = {
  "device.reboot": "Reinício pedido pelo painel",
  "device.refresh": "Dados atualizados pelo painel",
  "device.remove": "Registro removido pelo painel",
  "wifi.update": "Wi-Fi alterado pelo painel",
  "diag.ping": "Teste de conectividade",
};

interface NbiFault {
  _id: string;
  device: string;
  channel: string;
  code: string;
  message: string;
  timestamp: string;
  retries: number;
}

/** Linha do tempo do equipamento: eventos do Zenie + auditoria (alvo = equipamento) + falhas atuais do GenieACS. */
export async function eventsFor(deviceId: string, since: Date, limit: number): Promise<TimelineEntry[]> {
  const [own, actions, faults] = await Promise.all([
    deviceEvents().find({ deviceId, ts: { $gte: since } }).sort({ ts: -1 }).limit(limit).toArray(),
    audit().find({ target: deviceId, ts: { $gte: since } }).sort({ ts: -1 }).limit(limit).toArray(),
    nbiGet<NbiFault[]>(`/faults/?query=${encodeURIComponent(JSON.stringify({ device: deviceId }))}`, 10_000).catch(() => [] as NbiFault[]),
  ]);
  const list: TimelineEntry[] = [
    ...own.map((e) => ({ ts: e.ts, source: "zenie" as const, type: e.type, level: e.level, title: e.title, details: e.details })),
    ...actions.map((a) => ({
      ts: a.ts,
      source: "noc" as const,
      type: a.action,
      level: (a.ok ? "info" : "bad") as EventLevel,
      title: (AUDIT_TITLE[a.action] ?? a.action) + (a.ok ? "" : " — falhou"),
      details: a.details,
      username: a.username,
    })),
    ...faults
      .filter((f) => new Date(f.timestamp) >= since)
      .map((f) => ({
        ts: new Date(f.timestamp),
        source: "acs" as const,
        type: "fault",
        level: "bad" as EventLevel,
        title: `Falha no ACS (${f.channel})`,
        details: { codigo: f.code, mensagem: f.message, tentativas: f.retries },
      })),
  ];
  return list.sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limit);
}
