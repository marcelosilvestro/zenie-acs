// Leitura das saídas da CLI do ZTE C320 V2.1.x (porte de Parser.php do addon zte_onu).
//
// Escrito contra as saídas REAIS da OLT de referência (fixtures/zte_c320_v2.1.0). Regra de ouro: saída fora do
// formato conhecido vira OltFailure("formato") — nunca um resultado "vazio" ou "ok" presumido. Erro da própria
// OLT (%Error ...) vira OltFailure("comando").

import { OltFailure } from "../transport.js";

/** Estados de fase que contam como ONU online. */
export const ONLINE_PHASES = ["working"];

export interface Board { local: string; slot: number; type: string; versions: Record<string, string> }
export interface VersionInfo { version: string; versions: string[]; boards: Board[] }
export interface OnuState { shelf: number; slot: number; pon: number; onu: number; admin: string; omcc: string; phase: string; online: boolean }
export interface PonState { onus: OnuState[]; total: number; online: number; warning: string | null }
export interface OnuBase { onu: number; type: string; mode: string; sn: string; vendor: string; state: string }

/** "No related information to show.", com ou sem o prefixo "%Code 62310-GPONSRV :" (PON vazia/desativada). */
function noInformation(t: string): boolean {
  return /^\s*(%Code\s+\d+-[A-Z]+\s*:\s*)?No related information to show\.?\s*$/i.test(t.trim());
}

export function requireNoError(t: string): void {
  const m = t.match(/^\s*%(Error|Code)\b[^\n]*/im);
  if (m) throw new OltFailure("comando", m[0].trim());
}

/** show version-running */
export function versionRunning(t: string): VersionInfo {
  requireNoError(t);
  if (!/PhyLoc\s+FileType\s+VerType\s+VerTag/.test(t)) throw new OltFailure("formato", "version-running sem cabeçalho");
  const boards = new Map<string, Board>();
  const mvr = new Set<string>();
  for (const l of t.split("\n")) {
    const m = l.match(/^\s*(\d+)\/(\d+)\/(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\s+\d+\s*$/);
    if (!m) continue;
    const local = `${m[1]}/${m[2]}/${m[3]}`;
    if (!boards.has(local)) boards.set(local, { local, slot: Number(m[3]), type: m[4]!, versions: {} });
    boards.get(local)!.versions[m[5]!] = m[6]!;
    if (m[5] === "MVR") mvr.add(m[6]!);
  }
  if (!boards.size || !mvr.size) throw new OltFailure("formato", "version-running sem placas/MVR");
  const versions = [...mvr].sort();
  // Placas com MVR diferente: a versão vira "V1/V2" e não bate com nenhuma testada (somente leitura, de propósito).
  return { version: versions.join("/"), versions, boards: [...boards.values()] };
}

/** show gpon onu state gpon-olt_S/s/p */
export function ponState(t: string): PonState {
  if (noInformation(t)) return { onus: [], total: 0, online: 0, warning: null };
  requireNoError(t);
  if (!/OnuIndex\s+Admin State\s+OMCC State\s+Phase State/.test(t)) throw new OltFailure("formato", "onu state sem cabeçalho");
  const onus: OnuState[] = [];
  for (const l of t.split("\n")) {
    const m = l.match(/^\s*(\d+)\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (m) onus.push({ shelf: +m[1]!, slot: +m[2]!, pon: +m[3]!, onu: +m[4]!, admin: m[5]!, omcc: m[6]!, phase: m[7]!, online: ONLINE_PHASES.includes(m[7]!) });
  }
  const n = t.match(/ONU Number:\s*(\d+)\/(\d+)/);
  if (!n) throw new OltFailure("formato", "onu state sem totalizador");
  // A contagem das linhas TEM de bater com o total que a própria OLT informa (paginação/corte = inventário errado).
  if (onus.length !== Number(n[2])) throw new OltFailure("formato", `onu state: ${onus.length} linhas, OLT informa ${n[2]}`);
  const online = onus.filter((o) => o.online).length;
  return {
    onus,
    total: Number(n[2]),
    online,
    warning: online !== Number(n[1]) ? `A OLT informa ${n[1]} ONUs ativas e o estado de fase indica ${online} online.` : null,
  };
}

/** show gpon onu baseinfo gpon-olt_S/s/p — SN e perfil de todas as ONUs da PON, indexado pelo número da ONU. */
export function baseInfo(t: string): Map<number, OnuBase> {
  const out = new Map<number, OnuBase>();
  if (noInformation(t)) return out;
  requireNoError(t);
  if (!/OnuIndex\s+Type\s+Mode\s+AuthInfo\s+State/.test(t)) throw new OltFailure("formato", "baseinfo sem cabeçalho");
  for (const l of t.split("\n")) {
    const m = l.match(/^\s*gpon-onu_\d+\/\d+\/\d+:(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
    if (!m) continue;
    const sn = m[4]!.match(/^SN:([A-Za-z0-9]{12,16})$/)?.[1]?.toUpperCase() ?? "";
    out.set(+m[1]!, { onu: +m[1]!, type: m[2]!, mode: m[3]!, sn, vendor: sn ? sn.slice(0, 4) : "", state: m[5]! });
  }
  return out;
}

/** TR-069 configurado na ONU pela OLT (OMCI). A senha NUNCA sai daqui. */
export interface OnuTr069 {
  configured: boolean;
  state: "unlock" | "lock" | null;
  acsUrl: string | null;
  validate: string | null; // "basic" etc.
  username: string | null;
  /** A senha gravada na OLT é a esperada? null = não foi pedido comparar (ou não há senha na linha). */
  passwordMatches: boolean | null;
  /**
   * Login PPPoE da WAN criada pela OLT (wan-ip ... mode pppoe username X). Segunda chave para achar a ONU no Zenie
   * quando o firmware não publica o serial GPON (ex.: F670L V9.0.11P3N10). A senha nunca sai daqui.
   */
  pppoeUser: string | null;
}

/**
 * A C320 quebra a saída em 80 colunas: a continuação vem na linha seguinte, na coluna 0 (as linhas de configuração
 * da ONU começam com espaço). Ex. real (2026-10-09): "...username zenie pass" + "word <senha>" — sem desfazer, a
 * senha nunca era comparada (passwordMatches ficava null em todas as ONUs).
 */
export function unwrap80(t: string): string {
  const out: string[] = [];
  for (const l of t.replace(/\r/g, "").split("\n")) {
    const prev = out.at(-1);
    const continues = prev !== undefined && prev.length > 0 && prev.length % 80 === 0 && l !== "" && !/^\s/.test(l) && !/^(!|pon-onu-mng\b)/.test(l);
    if (continues) out[out.length - 1] = prev + l;
    else out.push(l);
  }
  return out.join("\n");
}

/**
 * show onu running config gpon-onu_S/s/p:o — extrai só as linhas "tr069-mgmt 1 ...".
 * A saída traz senhas de PPPoE em texto puro: o texto não é guardado; nenhuma senha é devolvida.
 */
export function onuTr069(t: string, expectedPassword?: string | null): OnuTr069 {
  requireNoError(t);
  if (!/^\s*pon-onu-mng\s+gpon-onu_\d+\/\d+\/\d+:\d+\s*$/m.test(t)) {
    // Sem bloco de configuração da ONU: só aceita saída vazia (ONU sem nada configurado).
    if (t.trim() === "" || t.trim() === "!") return { configured: false, state: null, acsUrl: null, validate: null, username: null, passwordMatches: null, pppoeUser: null };
    throw new OltFailure("formato", "running config da ONU sem o bloco pon-onu-mng");
  }
  let state: OnuTr069["state"] = null;
  let acsUrl: string | null = null;
  let validate: string | null = null;
  let username: string | null = null;
  let passwordMatches: boolean | null = null;
  let pppoeUser: string | null = null;
  for (const raw of unwrap80(t).split("\n")) {
    const l = raw.trim();
    const wan = l.match(/^wan-ip\s+\d+\s+mode\s+pppoe\s+username\s+(\S+)/);
    if (wan && pppoeUser === null) pppoeUser = wan[1]!;
    const st = l.match(/^tr069-mgmt\s+1\s+state\s+(lock|unlock)\s*$/);
    if (st) state = st[1] as "lock" | "unlock";
    const acs = l.match(/^tr069-mgmt\s+1\s+acs\s+(\S+)(?:\s+validate\s+(\S+)(?:\s+username\s+(\S+)(?:\s+password\s+(\S+))?)?)?/);
    if (acs) {
      acsUrl = acs[1]!;
      validate = acs[2] ?? null;
      username = acs[3] ?? null;
      // Só a comparação sai daqui: a senha lida não é devolvida nem guardada.
      passwordMatches = expectedPassword && acs[4] !== undefined ? acs[4] === expectedPassword : null;
    }
  }
  return { configured: acsUrl !== null, state, acsUrl, validate, username, passwordMatches, pppoeUser };
}

/** Um registro do histórico de autenticação da ONU: entrou (Authpass) e caiu (OfflineTime) — horário da OLT, sem fuso. */
export interface OnuAuthRecord { authpass: string | null; offline: string | null; cause: string | null }
export interface OnuDetail {
  name: string | null;
  phase: string | null;
  /** "Online Duration" em segundos (null se ausente ou em formato desconhecido). */
  onlineSec: number | null;
  /** Do mais antigo para o mais recente, sem as posições vazias (a C320 guarda os últimos 10, em buffer circular). */
  history: OnuAuthRecord[];
}

const OLT_TIME = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}`;
const ZERO_TIME = "0000-00-00 00:00:00";

/** "9h 52m 52s", "3d 2h 1m 0s"... -> segundos; null fora do formato. */
export function parseDuration(v: string): number | null {
  const t = v.trim();
  if (!/^(\d+d\s*)?(\d+h\s*)?(\d+m\s*)?(\d+s)?$/.test(t) || !t) return null;
  const n = (re: RegExp) => Number(t.match(re)?.[1] ?? 0);
  return n(/(\d+)d/) * 86400 + n(/(\d+)h/) * 3600 + n(/(\d+)m/) * 60 + n(/(\d+)s/);
}

const DETAIL_FIELD = /^\s*([A-Za-z][A-Za-z ]*?):[ \t]*(.*)$/;
const AUTH_ROW = new RegExp(String.raw`^\s*\d+\s+(${OLT_TIME})\s+(${OLT_TIME})(?:\s+(\S+))?\s*$`);

/**
 * show gpon onu detail-info gpon-onu_S/s/p:o — estado e histórico de quedas (Authpass/OfflineTime/Cause).
 * Formato da saída real em fixtures/zte_c320_v2.1.0/show_gpon_onu_detail_info.txt (só "DyingGasp" visto ali).
 */
export function onuDetail(t: string): OnuDetail {
  requireNoError(t);
  if (!/^\s*ONU interface:\s*gpon-onu_\d+\/\d+\/\d+:\d+/m.test(t)) throw new OltFailure("formato", 'detail-info sem "ONU interface"');
  const fields = new Map<string, string>();
  const history: OnuAuthRecord[] = [];
  const header = /Authpass Time\s+OfflineTime\s+Cause/.test(t);
  for (const l of t.replace(/\r/g, "").split("\n")) {
    const row = header ? l.match(AUTH_ROW) : null;
    if (row) {
      const rec = { authpass: row[1] === ZERO_TIME ? null : row[1]!, offline: row[2] === ZERO_TIME ? null : row[2]!, cause: row[3] ?? null };
      if (rec.authpass || rec.offline) history.push(rec); // posição ainda não usada do buffer
      continue;
    }
    const f = l.match(DETAIL_FIELD);
    if (f && !fields.has(f[1]!)) fields.set(f[1]!, f[2]!.trim());
  }
  // A tabela é um buffer circular de 10 posições (visto na OLT real em 13/10/2026: sessão atual na linha 1, linhas
  // 2-10 zeradas): a ordem das linhas não é a do tempo. "AAAA-MM-DD hh:mm:ss" ordena como texto.
  history.sort((a, b) => (a.authpass ?? a.offline ?? "").localeCompare(b.authpass ?? b.offline ?? ""));
  const online = fields.get("Online Duration");
  return { name: fields.get("Name") || null, phase: fields.get("Phase state") || null, onlineSec: online ? parseDuration(online) : null, history };
}
