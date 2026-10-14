// Cliente do zenie-api. Sessão por cookie httpOnly (o JS nunca vê o token).

export type Role = "atendente" | "noc" | "admin";

export interface Me {
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  permissions: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Liberação manual (docs/HOMOLOGACAO.md): quando a API barra um recurso não homologado e o usuário é
// admin, pergunta (diálogo global, components/OverrideDialog) e repete a chamada liberada.
let overrideAsk: ((reason: string) => Promise<boolean>) | null = null;
export function setOverrideHandler(fn: ((reason: string) => Promise<boolean>) | null) {
  overrideAsk = fn;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; override?: boolean } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.override ? { "X-Zenie-Override": "1" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 403 && data?.code === "capability" && data?.overridable && !init.override && overrideAsk && (await overrideAsk(data.error))) {
      return api<T>(path, { ...init, override: true });
    }
    throw new ApiError(res.status, data?.error ?? `erro ${res.status}`, data?.code);
  }
  return data as T;
}

export const ROLE_LABEL: Record<Role, string> = { atendente: "Atendente", noc: "NOC", admin: "Administrador" };

export type OnlineState = "online" | "late" | "offline" | "unknown";
export type Level = "ok" | "warn" | "bad";

export interface DeviceRow {
  id: string;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  pppoe: string | null;
  ponSerial: string | null;
  macs: string[];
  wanIp: string | null;
  wanStatus: string | null;
  accessType: string | null;
  firmware: string | null;
  wifiGeneration: string | null;
  profileId: string | null;
  homologated: boolean;
  /** registro antigo do mesmo equipamento: id do registro atual */
  staleOf: string | null;
  rx: number | null;
  rxLevel: Level | null;
  tx: number | null;
  ponStatus: string | null;
  uptimeSec: number | null;
  tags: string[];
  lastInform: string | null;
  status: OnlineState;
  match: { field: string; exact: boolean } | null;
}

export interface WifiClient {
  band: string | null;
  ssid: number;
  mac: string;
  ip: string | null;
  name: string | null;
  rssi: number | null;
  rateMbps: number | null;
  connectedSec: number | null;
  quality: "excelente" | "bom" | "fraco" | "muito fraco" | null;
  vendor?: string | null;
  /** "hosts": modelo sem lista de associados — montado pela tabela DHCP, sem sinal */
  source?: "hosts";
}

export interface DhcpHost {
  name: string | null;
  ip: string | null;
  mac: string;
  iface: string | null;
  active: boolean | null;
  source: string | null;
  leaseSec: number | null;
  vendor?: string | null;
}

export interface WifiBand {
  band: "2.4" | "5";
  ssid: string | null;
  enabled: boolean | null;
  channel: string | null;
  bandwidth: string | null;
  standard: string | null;
  wifi6: boolean;
  security: string | null;
  txPower: string | null;
  clients: number | null;
  options: { channels: number[]; powers: number[]; bandwidths: string[] } | null;
}

export interface DeviceClients {
  wifi: WifiClient[] | null;
  wifiUpdatedAt: string | null;
  hosts: DhcpHost[] | null;
  hostsUpdatedAt: string | null;
}

export type CapStatus = "homologado" | "a-validar" | "nao-suportado" | "nao-homologado" | "somente-leitura";
export interface CapabilityCheck {
  allowed: boolean;
  status: CapStatus;
  reason?: string;
}
export interface HomologationProgress {
  complete: boolean;
  resolved: number;
  total: number;
  pending: string[];
}

export interface DeviceProfile {
  progress: HomologationProgress;
  id: string;
  commercialName: string;
  kind: string;
  hasImage: boolean;
  notes: string | null;
  homologation: { status: string; date?: string; by?: string };
}

/** Rede unificada pelo adaptador do modelo (zte-bandsteering, same-ssid...). */
export interface UnifyInfo {
  source: string;
  label: string;
  unified: boolean | null;
  rules: { passwordOnUnify: boolean; separateNeeds: "ssid" | "ssid+password"; mainWritesBoth: boolean };
}

/**
 * Como a tela trata um recurso do perfil: "ok" = liberado; "admin" = só admin vê e, ao usar, a API pede
 * liberação manual (auditada); "off" = escondido (não suportado, ou não homologado para quem não é admin).
 */
export function capMode(d: DeviceDetail, cap: string, role: Role | undefined): "ok" | "admin" | "off" {
  const c = d.capabilities?.[cap];
  if (!c || c.allowed) return "ok";
  if (c.status === "nao-suportado" || c.status === "somente-leitura") return "off";
  return role === "admin" ? "admin" : "off";
}

/** URL da foto do modelo no catálogo (id = "fabricante/modelo"); "v" força recarregar após troca. */
export const profileImage = (id: string, v?: number | string) => `/api/catalog/${id}/image${v ? `?v=${v}` : ""}`;

export interface DeviceDetail {
  id: string;
  profile: DeviceProfile | null;
  capabilities: Record<string, CapabilityCheck>;
  /** tag somente_leitura: nada que grave no equipamento */
  readonly: boolean;
  /** registro antigo do mesmo equipamento: id do registro atual */
  staleOf: string | null;
  identity: {
    vendor: string | null;
    model: string | null;
    serial: string | null;
    ponSerial: string | null;
    /** "olt": o equipamento não publica o serial GPON; veio da OLT (mesmo login PPPoE). */
    ponSerialSource?: "olt";
    pppoe: string | null;
    firmware: string | null;
    accessType: string | null;
    wifiGeneration: string | null;
    macs: { base: string | null; wan: string[]; lan: string | null };
    tags: string[];
  };
  status: { state: OnlineState; lastInform: string | null; lastBoot: string | null; registered: string | null; uptimeSec: number | null; updatedAt: string | null };
  system: { cpu: number | null; cpuLevel: Level | null; memory: number | null; memoryLevel: Level | null; updatedAt: string | null };
  optical: {
    rx: number | null; rxLevel: Level | null; tx: number | null; txLevel: Level | null;
    temperature: number | null; temperatureLevel: Level | null; voltage: number | null; biasCurrent: number | null;
    ponStatus: string | null; updatedAt: string | null;
  } | null;
  wan: {
    status: string | null; ip: string | null; pppoe: string | null; type?: string; gateway?: string | null; dns?: string[];
    mtu?: number | null; lastError?: string | null; uptimeSec?: number | null; vlan?: number | null; services?: string | null;
    ipv6?: string | null; ipv6Prefix?: string | null; ipv6Dns?: string[]; ipv6Status?: string | null;
    link?: { access: string | null; status: string | null; downMbps: number | null; upMbps: number | null };
    updatedAt: string | null;
  };
  lan: {
    ip?: string | null; mask?: string | null; dhcp?: boolean | null; dhcpStart?: string | null; dhcpEnd?: string | null; dns?: string[]; leaseSec?: number | null;
    ipv6Delegated?: string | null; ipv6Prefix?: string | null; ipv6Address?: string | null;
    ipv6Dns?: { manual: boolean; servers: string[] } | null; updatedAt: string | null;
  };
  ports: { list: { port: number; name: string; up: boolean; speedMbps: number | null }[]; updatedAt: string | null };
  wifi: { bandSteering: boolean | null; unify: UnifyInfo | null; bands: WifiBand[]; updatedAt: string | null };
  clients: DeviceClients;
  rules: {
    rx: { goodAbove: number; badAtOrBelow: number; saturationAbove: number };
    tx: { min: number; max: number };
    temperature: { warnAbove: number; badAbove: number };
    informIntervalSec: number;
  };
}

export interface PingResult {
  target: string;
  host: string | null;
  ok: boolean;
  state: string | null;
  sent: number;
  received: number;
  lossPct: number | null;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  error?: string;
}

export interface MeshStation {
  mac: string;
  name: string | null;
  ip: string | null;
  band: string | null;
  signal: number | null;
  quality: "excelente" | "bom" | "fraco" | "muito fraco" | null;
  active: boolean | null;
  associatedAt: string | null;
  vendor: string | null;
}

export interface MeshNode {
  key: string; // "controller" | "agent-N"
  role: "principal" | "satélite";
  mac: string | null;
  model: string | null;
  manufacturer: string | null;
  serial: string | null;
  firmware: string | null;
  active: boolean | null;
  hop: number | null;
  parentMac: string | null;
  backhaul: { media: string | null; kind: "cabo" | "wifi" | null; phyMbps: number | null; signal: number | null; errorsRx: number | null; errorsTx: number | null } | null;
  clientCount: number | null;
  deviceId: string | null;
  /** Firmware do principal não identifica este satélite (F6201B): sem MAC/modelo/serial/backhaul. */
  identityUnknown?: boolean;
  /** IP do satélite na LAN do principal (quando identificado pela tabela DHCP). */
  ip?: string | null;
}

/** Aparelhos de todos os nós da mesh (aba Clientes). */
/** Situação da mesh na lista de clientes (GET clients): ver readMeshClients na API. */
export type MeshListStatus = "ok" | "desatualizada" | "falhou" | "desligada" | "sem-satelites";

export interface MeshClients {
  source: string;
  refreshed: boolean;
  nodes: Pick<MeshNode, "key" | "role" | "model" | "serial" | "deviceId">[];
  stations: (MeshStation & { node: string })[];
}

export interface MeshTopology {
  enabled: boolean | null;
  version?: string | null;
  nodes?: MeshNode[];
  /** Satélites vistos na tabela DHCP do principal que ele não identifica por nó. */
  unassignedSatellites?: { mac: string; ip: string | null; manufacturer: string | null; link: string | null }[];
  self?: {
    hop: number;
    controller: { model: string | null; serial: string | null };
    parent: { model: string | null; serial: string | null };
  } | null;
}

export interface TaskResult {
  ok: boolean;
  outcome: "done" | "unreachable" | "fault";
  message?: string;
  ms: number;
}

export type EventLevel = "info" | "ok" | "warn" | "bad";

/** Item da linha do tempo do equipamento (GET /api/devices/:id/events). */
export interface DeviceEvent {
  ts: string;
  source: "zenie" | "noc" | "acs";
  type: string;
  level: EventLevel;
  title: string;
  details?: Record<string, unknown>;
  username?: string;
}

export type IncidentCategory = "energia" | "fibra" | "internet" | "equipamento";

/** Desconexão: eventos agrupados (a queda, o reinício e a volta contam uma vez). members = índices em items. */
export interface Incident {
  start: string;
  end: string;
  category: IncidentCategory;
  members: number[];
  /** Outros clientes da mesma PON/OLT caíram no mesmo horário. */
  mass?: { pon: number; olt: number; position: string } | null;
}

export interface DeviceEvents {
  days: number;
  retentionDays: number;
  items: DeviceEvent[];
  incidents: Incident[];
}

export function timeAgo(v: string | null | undefined): string {
  if (!v) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

export function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR");
}

/** Padrão 802.11 -> geração Wi-Fi (nomenclatura Wi-Fi Alliance). */
const WIFI_GEN: Record<string, number> = { b: 1, a: 2, g: 3, n: 4, ac: 5, ax: 6, be: 7 };

/** Maior geração anunciada em "b,g,n,ax" -> 6 (null se nada reconhecido). */
export function wifiGeneration(standard: string | null | undefined): number | null {
  let best = 0;
  for (const t of String(standard ?? "").split(",")) best = Math.max(best, WIFI_GEN[t.trim().toLowerCase()] ?? 0);
  return best || null;
}

/** "b,g,n,ax" -> "802.11 b/g/n/ax". */
export function describeStandard(standard: string | null | undefined): string | null {
  const parts = String(standard ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? `802.11 ${parts.join("/")}` : null;
}

// ------------------------------------------------------------------ Homologação (docs/HOMOLOGACAO.md)

export type ProfileCapStatus = "homologado" | "a-validar" | "nao-suportado";
export interface CapDef { label: string; kind: "leitura" | "escrita" | "diagnostico" }
export interface ProfileCap { status: ProfileCapStatus; source?: string; notes?: string }

export interface CatalogProfile {
  id: string;
  vendor: string;
  model: string;
  commercialName: string;
  kind: string;
  /** hardwareVersion: prefixos de DeviceInfo.HardwareVersion (ex.: "V1."); vazio = qualquer revisão. */
  match: { manufacturer: string[]; productClass: string[]; hardwareVersion?: string[] };
  wifi?: { generation?: number; bands?: string[] };
  ports?: { lan?: number; wan?: string };
  notes?: string;
  firmwaresSeen?: { version: string; sample?: string; notes?: string }[];
  capabilities: Record<string, ProfileCap>;
  homologation: { status: string; date?: string; by?: string };
  history?: { date: string; by: string; note: string }[];
  hasImage?: boolean;
  draft?: boolean;
}

export interface ProfileSummary {
  id: string;
  commercialName: string;
  kind: string;
  hasImage: boolean;
  draft: boolean;
  status: string;
  caps: Record<ProfileCapStatus, number>;
  progress: HomologationProgress;
}

export interface FleetModel {
  vendor: string | null;
  model: string | null;
  count: number;
  accessType: string | null;
  lastInform: string | null;
  firmwares: { version: string; count: number }[];
  hardwareVersions?: string[];
  hardwareFamily?: string | null;
  profile: ProfileSummary | null;
}

export interface Fleet {
  homologationMode: boolean;
  version: string;
  models: FleetModel[];
  unused: ProfileSummary[];
}

export interface ProfilePage {
  homologationMode: boolean;
  profile: CatalogProfile;
  progress: HomologationProgress;
  official: boolean;
  draft: { updatedAt: string; updatedBy: string } | null;
  devices: { id: string; pppoe: string | null; firmware: string | null; lastInform: string | null; pilot: boolean }[];
  capabilities: Record<string, CapDef>;
  sources: Record<string, string[]>;
}

export const KIND_LABEL: Record<string, string> = {
  "onu-gpon": "ONU GPON",
  "onu-epon": "ONU EPON",
  "onu-xpon": "ONU XPON",
  router: "Roteador",
  ap: "Access point",
  outro: "Outro",
};

export const CAP_STATUS: Record<ProfileCapStatus, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  homologado: { label: "Homologado", tone: "ok" },
  "a-validar": { label: "A validar", tone: "warn" },
  "nao-suportado": { label: "Não suportado", tone: "neutral" },
};

export const SOURCE_LABEL: Record<string, string> = {
  vp: "Virtual parameters",
  tr069: "RPC TR-069",
  "zte-easymesh": "EasyMesh ZTE",
  "tr098-ipping": "IPPing TR-098",
  "zte-bandsteering": "Bandsteering ZTE",
  "same-ssid": "Mesmo nome nas 2 faixas",
};
