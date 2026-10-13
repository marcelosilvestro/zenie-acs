// Banco do Zenie ("zenie" no mesmo MongoDB do GenieACS). Coleções e índices.

import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";
import { config } from "./config.js";
import type { Profile } from "./catalog.js";
import type { Role } from "./permissions.js";

export interface User {
  _id?: ObjectId;
  username: string; // minúsculo, único
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

export interface Session {
  _id: string; // sha256 do token (o token em si só existe no cookie)
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date; // índice TTL
  ip: string;
  userAgent: string;
}

export interface AuditEntry {
  _id?: ObjectId;
  ts: Date;
  userId?: ObjectId;
  username?: string;
  action: string; // ex.: "auth.login", "user.create", "device.reboot"
  target?: string; // ex.: id do equipamento ou do usuário
  ok: boolean;
  details?: Record<string, unknown>;
  ip?: string;
}

/** Rascunho de perfil do modo homologação (docs/HOMOLOGACAO.md); _id = "fabricante/modelo". */
export interface CatalogDraft {
  _id: string;
  profile: Profile;
  thumb?: Buffer; // WebP ≤ 200 KB
  /** Rascunho só com a foto: o perfil vem sempre do catálogo oficial (não congela uma cópia antiga). */
  photoOnly?: boolean;
  updatedAt: Date;
  updatedBy: string;
}

/** Índice de busca/listagem montado a partir dos virtual parameters (inventory.ts). */
export interface InventoryItem {
  _id: string; // id do dispositivo no GenieACS
  vendor: string | null;
  model: string | null; // ProductClass, ou ModelName quando o ProductClass é genérico
  productClass: string | null;
  modelName: string | null;
  oui: string | null;
  serial: string | null;
  serialKey: string; // maiúsculo, para busca
  pppoe: string | null;
  pppoeKey: string; // minúsculo, para busca
  ponSerial: string | null;
  ponSerialKey: string; // maiúsculo
  /** "olt" = o equipamento não publica o serial GPON; veio do inventário da OLT, casado pelo login PPPoE. */
  ponSerialSource?: "cpe" | "olt";
  macs: string[]; // hex sem separador, minúsculo
  wanIp: string | null;
  wanStatus: string | null;
  /** Do VP WanDetails (lido a cada hora): tempo da conexão WAN, último erro e link físico, e quando foi lido. */
  wanUptimeSec?: number | null;
  wanLastError?: string | null;
  wanLink?: string | null;
  wanReadAt?: Date | null;
  accessType: string | null; // "ONU" | "Roteador"
  firmware: string | null;
  hardwareVersion?: string | null;
  wifiGeneration: string | null; // "1".."7"
  profileId: string | null; // perfil do catálogo (docs/HOMOLOGACAO.md)
  homologated: boolean;
  /**
   * Registro antigo do MESMO equipamento (mesmo fabricante + serial, outro id): o GenieACS cria um id novo quando
   * o ProductClass muda (ex.: troca TR-181 "Device" <-> TR-098 "IGD"). Aponta para o registro atual.
   */
  staleOf?: string | null;
  rx: number | null;
  tx: number | null;
  ponStatus: string | null;
  uptimeSec: number | null;
  tags: string[];
  lastInform: Date | null;
  lastBoot: Date | null;
  registered: Date | null;
  syncedAt: Date;
  /** Estado dos eventos (events.ts): último contato antes de ficar offline (null = em contato). */
  offlineSince?: Date | null;
  /** Faixa do RX com histerese (events.ts). */
  rxBand?: "sat" | "ok" | "warn" | "bad" | null;
  /** Quando o Zenie viu a WAN voltar (events.ts). */
  wanUpSeenAt?: Date | null;
}

export type EventLevel = "info" | "ok" | "warn" | "bad";

/** Log do ACS (acslog.ts): ocorrência agrupada por tipo + equipamento + IP + detalhe + hora. Expira em 7 dias. */
export interface AcsLogEntry {
  _id: string;
  kind: string;
  level: "ok" | "info" | "warn" | "bad";
  title: string;
  help: string;
  detail: string | null;
  deviceId: string | null;
  ip: string | null;
  hour: Date;
  first: Date;
  last: Date;
  count: number;
}

/** Estado do Log do ACS: cursor da leitura ("cursor") e informs por hora ("informs:<epoch>"). */
export interface AcsLogState {
  _id: string;
  since?: string | null;
  lastKey?: string | null;
  at?: Date;
  hour?: Date;
  n?: number;
  devices?: string[];
}

/** Evento derivado pelo Zenie (events.ts). Expira após ZENIE_EVENTS_DAYS (índice TTL em ts). */
export interface DeviceEvent {
  _id?: ObjectId;
  deviceId: string;
  ts: Date;
  type: string; // ex.: "reboot", "offline", "wan.down", "rx.level"
  level: EventLevel;
  title: string;
  details?: Record<string, unknown>;
}

/** Credencial que as CPEs usam para autenticar no ACS (docs/SEGURANCA-ACS.md). Senha cifrada (secrets.ts). */
export interface AcsCredential {
  _id?: ObjectId;
  username: string;
  passwordEnc: string;
  /** active = a que é distribuída; transition = antiga, ainda aceita; retired = não aceita mais. */
  status: "active" | "transition" | "retired";
  createdAt: Date;
  createdBy: string;
  retiredAt?: Date;
  retiredBy?: string;
}

/** Estado da exigência de autenticação (documento único, _id "auth"). */
export interface AcsSettings {
  _id: "auth";
  mode: "off" | "enforced";
  updatedAt: Date;
  updatedBy: string;
}

/** Chave da coleção "config" do GenieACS (banco "genieacs" no mesmo MongoDB). */
export interface GenieacsConfigEntry {
  _id: string;
  value: string;
}

/** Etapa do teste de acesso a uma OLT. */
export interface OltStep {
  key: string;
  title: string;
  result: "ok" | "aviso" | "erro";
  detail: string;
  ms: number;
}

export interface OltTestResult {
  at: Date;
  result: "ok" | "aviso" | "erro";
  code: string;
  by: string;
  summary: string;
  steps: OltStep[];
}

/** OLT cadastrada (docs/OLT.md). Senhas cifradas (secrets.ts). */
export interface Olt {
  _id?: ObjectId;
  name: string;
  vendor: string;
  model: string;
  driverId: string;
  protocol: "telnet" | "ssh" | "simulado";
  host: string;
  port: number;
  username: string;
  passwordEnc: string | null;
  enableEnc: string | null;
  connectTimeoutSec: number;
  commandTimeoutSec: number;
  note: string;
  active: boolean;
  rev: number; // controle de alteração concorrente
  compatibility: "desconhecida" | "validada" | "somente_leitura" | "nao_suportada";
  detected?: { identifier: string; version: string; boards: { local: string; slot: number; type: string; versions: Record<string, string> }[]; at: Date } | null;
  lastTest?: OltTestResult | null;
  authFailures: number;
  blockedUntil?: Date | null;
  /** PONs descobertas na última leitura do inventário. */
  pons?: { slot: number; pon: number; onus: number; at: Date }[];
  inventoryAt?: Date | null;
  /** Último "Salvar configuração da OLT" (write). Envios depois disso ainda não estão na flash. */
  savedAt?: Date | null;
  savedBy?: string | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

/** ONU vista numa OLT (inventário O2). _id = "<oltId>:<slot>/<pon>:<onu>". Só campos de TR-069, nunca senhas. */
export interface OltOnu {
  _id: string;
  oltId: ObjectId;
  slot: number;
  pon: number;
  onu: number;
  sn: string | null;
  vendor: string | null; // prefixo do SN (ZTEG, FRKW...)
  type: string | null; // perfil de cadastro na OLT (HRT, HBR...), não é o modelo
  admin: string;
  omcc: string;
  phase: string; // working, LOS, DyingGasp, OffLine...
  online: boolean;
  tr069: { configured: boolean; state: "lock" | "unlock" | null; acsUrl: string | null; validate: string | null; username: string | null; passwordMatches?: boolean | null; pppoeUser?: string | null; readAt: Date } | null;
  tr069Error: string | null;
  /** Login PPPoE da WAN configurada pela OLT (minúsculo). Chave alternativa ao SN para achar a ONU no Zenie. */
  pppoe?: string | null;
  seenAt: Date;
  absentSince: Date | null;
  /** Última leitura do histórico de quedas (olt/history.ts). */
  historyReadAt?: Date;
}

/** Envio do tr069-mgmt a uma ONU pela OLT (O3). Nunca guarda a senha. */
export interface Tr069Job {
  _id?: ObjectId;
  oltId: ObjectId;
  onuId: string; // _id de olt_onus
  position: string; // "slot/pon:onu"
  sn: string | null;
  pppoe?: string | null;
  vendor: string | null;
  url: string;
  username: string;
  state: "enviando" | "aguardando_acs" | "concluido" | "falha" | "nao_chegou";
  by: string;
  createdAt: Date;
  sentAt: Date | null;
  finishedAt: Date | null;
  deviceId: string | null;
  crOk: boolean | null;
  error: string | null;
  steps: { at: Date; text: string }[];
}

let client: MongoClient;
let db: Db;

export async function connect(): Promise<Db> {
  client = new MongoClient(config.mongoUrl);
  await client.connect();
  db = client.db();
  await users().createIndex({ username: 1 }, { unique: true });
  await sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await sessions().createIndex({ userId: 1 });
  await audit().createIndex({ ts: -1 });
  await audit().createIndex({ target: 1, ts: -1 });
  for (const key of ["pppoeKey", "ponSerialKey", "serialKey", "macs", "wanIp", "lastInform", "syncedAt", "homologated", "profileId", "staleOf"]) {
    await inventory().createIndex({ [key]: 1 });
  }
  await acsCredentials().createIndex({ status: 1 });
  await olts().createIndex({ name: 1 }, { unique: true });
  await oltTests().createIndex({ oltId: 1, at: -1 });
  await oltOnus().createIndex({ oltId: 1, slot: 1, pon: 1, onu: 1 });
  await oltOnus().createIndex({ sn: 1 });
  await oltOnus().createIndex({ pppoe: 1 });
  await tr069Jobs().createIndex({ onuId: 1, createdAt: -1 });
  await tr069Jobs().createIndex({ state: 1 });
  await tr069Jobs().createIndex({ oltId: 1, createdAt: -1 });
  await deviceEvents().createIndex({ deviceId: 1, ts: -1 });
  await acsLog().createIndex({ last: -1 });
  await acsLog().createIndex({ deviceId: 1, last: -1 });
  await ensureTtl("acs_log", "hour", 7 * 86400);
  await ensureTtl("acs_log_state", "hour", 7 * 86400); // só os contadores por hora; o cursor não tem "hour"
  await ensureTtl("device_events", "ts", config.eventsDays * 86400);
  return db;
}

/** Índice TTL; se já existe com outro prazo (ZENIE_EVENTS_DAYS mudou), ajusta com collMod. */
async function ensureTtl(collection: string, field: string, seconds: number): Promise<void> {
  const existing = (await db.collection(collection).indexes().catch(() => [])).find((i) => i.key[field] === 1 && Object.keys(i.key).length === 1);
  if (!existing) {
    await db.collection(collection).createIndex({ [field]: 1 }, { expireAfterSeconds: seconds });
  } else if (existing.expireAfterSeconds !== seconds) {
    await db.command({ collMod: collection, index: { keyPattern: { [field]: 1 }, expireAfterSeconds: seconds } });
  }
}

export async function close(): Promise<void> {
  await client?.close();
}

export const users = (): Collection<User> => db.collection<User>("users");
export const sessions = (): Collection<Session> => db.collection<Session>("sessions");
export const audit = (): Collection<AuditEntry> => db.collection<AuditEntry>("audit");
export const inventory = (): Collection<InventoryItem> => db.collection<InventoryItem>("inventory");
export const olts = (): Collection<Olt> => db.collection<Olt>("olts");
export const oltTests = (): Collection<OltTestResult & { oltId: ObjectId }> => db.collection<OltTestResult & { oltId: ObjectId }>("olt_tests");
export const oltOnus = (): Collection<OltOnu> => db.collection<OltOnu>("olt_onus");
export const tr069Jobs = (): Collection<Tr069Job> => db.collection<Tr069Job>("tr069_jobs");
export const acsCredentials = (): Collection<AcsCredential> => db.collection<AcsCredential>("acs_credentials");
export const acsSettings = (): Collection<AcsSettings> => db.collection<AcsSettings>("acs_settings");
/** Config do GenieACS: a NBI 1.2 não grava esta coleção, então o Zenie escreve direto (o GenieACS relê em segundos). */
export const genieacsConfig = (): Collection<GenieacsConfigEntry> => client.db("genieacs").collection<GenieacsConfigEntry>("config");
export const acsLog = (): Collection<AcsLogEntry> => db.collection<AcsLogEntry>("acs_log");
export const acsLogState = (): Collection<AcsLogState> => db.collection<AcsLogState>("acs_log_state");
export const deviceEvents = (): Collection<DeviceEvent> => db.collection<DeviceEvent>("device_events");
export const catalogDrafts = (): Collection<CatalogDraft> => db.collection<CatalogDraft>("catalog_drafts");
