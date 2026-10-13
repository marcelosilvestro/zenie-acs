// Catálogo oficial de equipamentos homologados (docs/HOMOLOGACAO.md).
// Lê catalog/<fabricante>/<modelo>/profile.json (montado no container) e reconhece cada equipamento
// por fabricante + modelo (_ProductClass/ModelName) e, quando o perfil pede, pela versão de hardware
// (ex.: F670L V1 x V9: mesmo ProductClass, firmwares diferentes). Recarrega quando os arquivos mudam (release nova).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { vp, type NbiDevice } from "./nbi.js";

export const CATALOG_DIR = process.env.ZENIE_CATALOG_DIR ?? "/app/catalog";

export type CapStatus = "homologado" | "a-validar" | "nao-suportado";

/** Tag do GenieACS: equipamento só para leitura (ex.: cliente em produção em avaliação). Nada que grave nele. */
export const READONLY_TAG = "somente_leitura";
export type CapKind = "leitura" | "escrita" | "diagnostico";

/** Recursos do painel que um modelo pode ou não suportar. A escrita exige "homologado" (decisão do usuário). */
export const CAPABILITIES: Record<string, { label: string; kind: CapKind }> = {
  optical: { label: "Sinal óptico", kind: "leitura" },
  wan: { label: "WAN / PPPoE", kind: "leitura" },
  wanLink: { label: "Velocidade da porta WAN", kind: "leitura" },
  lanPorts: { label: "Portas LAN", kind: "leitura" },
  ipv6: { label: "IPv6", kind: "leitura" },
  wifiRead: { label: "Wi-Fi (leitura)", kind: "leitura" },
  wifiClients: { label: "Aparelhos no Wi-Fi", kind: "leitura" },
  dhcpHosts: { label: "Dispositivos DHCP", kind: "leitura" },
  system: { label: "CPU e memória", kind: "leitura" },
  traffic: { label: "Tráfego atual", kind: "leitura" },
  mesh: { label: "Topologia mesh", kind: "leitura" },
  ping: { label: "Teste de conectividade", kind: "diagnostico" },
  wifiWrite: { label: "Alterar nome/senha do Wi-Fi", kind: "escrita" },
  wifiRadio: { label: "Alterar canal/largura/potência", kind: "escrita" },
  wifiPower: { label: "Ligar/desligar Wi-Fi", kind: "escrita" },
  wifiUnify: { label: "Unificar/separar redes", kind: "escrita" },
  reboot: { label: "Reiniciar", kind: "escrita" },
};

export interface Capability {
  status: CapStatus;
  source?: string;
  notes?: string;
}

export interface Profile {
  id: string;
  vendor: string;
  model: string;
  commercialName: string;
  kind: string; // onu-gpon | onu-epon | router | ap
  /**
   * hardwareVersion (opcional): prefixos de DeviceInfo.HardwareVersion ("V1.", "V9."). Com ele o perfil só
   * reconhece essas revisões; perfil sem ele reconhece qualquer uma, mas perde para um perfil específico.
   */
  match: { manufacturer: string[]; productClass: string[]; hardwareVersion?: string[] };
  wifi?: { generation?: number; bands?: string[] };
  ports?: { lan?: number; wan?: string };
  notes?: string;
  firmwaresSeen?: { version: string; sample?: string; notes?: string }[];
  capabilities: Record<string, Capability>;
  homologation: { status: string; date?: string; by?: string };
  history?: { date: string; by: string; note: string }[];
  hasImage?: boolean;
  /** Rascunho do modo homologação (ainda não está em catalog/ do repositório). */
  draft?: boolean;
}

/** Rascunho do servidor de testes (coleção catalog_drafts). */
export interface DraftInput {
  _id: string;
  profile: Profile;
  thumb?: { buffer: ArrayBufferLike } | Buffer | null;
  photoOnly?: boolean;
}

let drafts: DraftInput[] = [];
let draftStamp = 0;
const official = new Map<string, Profile>();

/** Rascunhos valem por cima do catálogo oficial (só no modo homologação — quem chama decide). */
export function setDrafts(list: DraftInput[]): void {
  drafts = list;
  draftStamp++;
}

export const officialProfile = (id: string) => (catalog(), official.get(id) ?? null);

/** Foto do rascunho, se houver. */
export function draftImage(id: string): Buffer | null {
  const t = drafts.find((d) => d._id === id)?.thumb;
  if (!t) return null;
  return Buffer.isBuffer(t) ? t : Buffer.from(t.buffer as ArrayBuffer);
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

/**
 * ProductClass que não identifica o modelo: a TP-Link manda "IGD" (TR-098) e "Device" (TR-181) em todos.
 * Nesses casos o modelo vem do VP ModelName (DeviceInfo.ModelName).
 */
const GENERIC_PRODUCT_CLASS = new Set(["", "IGD", "DEVICE", "INTERNETGATEWAYDEVICE", "CPE", "ROUTER"]);
export const isGenericProductClass = (pc: string | null | undefined) => GENERIC_PRODUCT_CLASS.has(norm(pc));

/** Modelo para exibir/agrupar: o ProductClass, ou o ModelName quando o ProductClass é genérico. */
export function displayModel(productClass: string | null | undefined, modelName: string | null | undefined): string | null {
  if (isGenericProductClass(productClass) && modelName && modelName.trim()) return modelName.trim();
  return productClass?.trim() || modelName?.trim() || null;
}

let cache: { version: string; profiles: Profile[]; stamp: string } = { version: "", profiles: [], stamp: "" };

/** Assinatura barata (mtimes) para recarregar só quando o catálogo mudar. */
function stampOf(): string {
  if (!existsSync(CATALOG_DIR)) return "";
  const parts: string[] = [];
  for (const vendor of readdirSync(CATALOG_DIR)) {
    const vd = join(CATALOG_DIR, vendor);
    if (!statSync(vd).isDirectory()) {
      parts.push(`${vendor}:${statSync(vd).mtimeMs}`);
      continue;
    }
    for (const model of readdirSync(vd)) {
      for (const f of ["profile.json", "thumb.webp"]) {
        const p = join(vd, model, f);
        if (existsSync(p)) parts.push(`${p}:${statSync(p).mtimeMs}`);
      }
    }
  }
  return parts.join("|") + `|drafts:${draftStamp}`;
}

export function catalog(): { version: string; profiles: Profile[] } {
  const stamp = stampOf();
  if (stamp === cache.stamp) return cache;
  const profiles: Profile[] = [];
  let version = "";
  if (existsSync(CATALOG_DIR)) {
    try {
      version = JSON.parse(readFileSync(join(CATALOG_DIR, "index.json"), "utf8")).version ?? "";
    } catch {
      version = "";
    }
    for (const vendor of readdirSync(CATALOG_DIR)) {
      const vd = join(CATALOG_DIR, vendor);
      if (!statSync(vd).isDirectory()) continue;
      for (const model of readdirSync(vd)) {
        const file = join(vd, model, "profile.json");
        if (!existsSync(file)) continue;
        try {
          const p = JSON.parse(readFileSync(file, "utf8")) as Profile;
          p.hasImage = existsSync(join(vd, model, "thumb.webp"));
          profiles.push(p);
        } catch (e) {
          console.error(`catálogo: ${file} inválido: ${(e as Error).message}`);
        }
      }
    }
  }
  official.clear();
  for (const p of profiles) official.set(p.id, p);
  for (const d of drafts) {
    const i = profiles.findIndex((p) => p.id === d._id);
    const base = i >= 0 ? profiles[i]! : null;
    // Rascunho só da foto: perfil do catálogo oficial (homologação feita no repositório depois da foto continua
    // valendo — F670L V1, 2026-10-09: a foto tinha congelado o perfil 0/17 por cima do oficial 17/17).
    const profile = d.photoOnly && base ? base : d.profile;
    const merged: Profile = { ...profile, id: d._id, draft: true, hasImage: !!d.thumb || !!base?.hasImage };
    if (i >= 0) profiles[i] = merged;
    else profiles.push(merged);
  }
  cache = { version, profiles, stamp };
  return cache;
}

/** O perfil aceita esta versão de hardware? Sem filtro: qualquer uma. Com filtro e sem versão: não. */
export function hardwareMatches(p: Pick<Profile, "match">, hardwareVersion: string | null | undefined): boolean {
  const prefixes = p.match.hardwareVersion?.filter((h) => h.trim()) ?? [];
  if (!prefixes.length) return true;
  const hw = norm(hardwareVersion);
  return !!hw && prefixes.some((h) => hw.startsWith(norm(h)));
}

/**
 * Perfil do equipamento (fabricante + _ProductClass ou ModelName [+ versão de hardware]), ou null se não
 * homologado. Perfil com filtro de hardware que casa vence o perfil genérico do mesmo modelo.
 */
export function matchProfile(manufacturer: string | null | undefined, productClass: string | null | undefined, modelName?: string | null, hardwareVersion?: string | null): Profile | null {
  const man = norm(manufacturer);
  // ProductClass genérico ("IGD") não reconhece modelo nenhum: só o ModelName vale.
  const names = [isGenericProductClass(productClass) ? "" : norm(productClass), norm(modelName)].filter(Boolean);
  let generic: Profile | null = null;
  for (const p of catalog().profiles) {
    if (!p.match.manufacturer.some((m) => norm(m) === man)) continue;
    if (!p.match.productClass.some((c) => names.includes(norm(c)))) continue;
    if (!hardwareMatches(p, hardwareVersion)) continue;
    if (p.match.hardwareVersion?.some((h) => h.trim())) return p;
    generic ??= p;
  }
  return generic;
}

/** DeviceInfo.HardwareVersion (vem em todo Inform; TR-098 ou TR-181). */
export function hwOf(d: NbiDevice): string | null {
  const root = d as unknown as Record<string, { DeviceInfo?: { HardwareVersion?: { _value?: unknown } } } | undefined>;
  const v = root.InternetGatewayDevice?.DeviceInfo?.HardwareVersion?._value ?? root.Device?.DeviceInfo?.HardwareVersion?._value;
  return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim();
}

/** Caminhos que precisam vir na projeção da NBI para o hwOf. */
export const HW_PATHS = ["InternetGatewayDevice.DeviceInfo.HardwareVersion", "Device.DeviceInfo.HardwareVersion"];

export function imagePath(profileId: string): string | null {
  // "fabricante/modelo", sem segmentos começando com ponto (nada de "..").
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(profileId)) return null;
  const p = join(CATALOG_DIR, profileId, "thumb.webp");
  return existsSync(p) ? p : null;
}

/**
 * Progresso da homologação do modelo: "Homologado" só com 100% — nenhuma capacidade "a validar"
 * (cada uma homologada ou não suportada). Senão é "em homologação".
 */
export function profileProgress(p: Profile): { complete: boolean; resolved: number; total: number; pending: string[] } {
  const keys = Object.keys(CAPABILITIES);
  const pending = keys.filter((k) => (p.capabilities[k]?.status ?? "a-validar") === "a-validar");
  return { complete: pending.length === 0, resolved: keys.length - pending.length, total: keys.length, pending: pending.map((k) => CAPABILITIES[k]!.label) };
}

/** Pode usar o recurso? Leitura/diagnóstico: tudo menos "não suportado". Escrita: só "homologado". */
export function capabilityAllowed(profile: Profile | null, cap: string): { allowed: boolean; status: CapStatus | "nao-homologado"; reason?: string } {
  const def = CAPABILITIES[cap];
  if (!profile) {
    return def?.kind === "escrita"
      ? { allowed: false, status: "nao-homologado", reason: "modelo não homologado: alterações bloqueadas" }
      : { allowed: true, status: "nao-homologado" };
  }
  const c = profile.capabilities[cap];
  const status = c?.status ?? "a-validar";
  if (status === "nao-suportado") return { allowed: false, status, reason: `${def?.label ?? cap}: não suportado por este modelo` };
  if (def?.kind === "escrita" && status !== "homologado") return { allowed: false, status, reason: `${def.label}: ainda não homologado para ${profile.commercialName}` };
  return { allowed: true, status };
}

/** Perfil de um equipamento do GenieACS. */
export const profileOf = (d: NbiDevice) => matchProfile(d._deviceId?._Manufacturer, d._deviceId?._ProductClass, vp(d, "ModelName"), hwOf(d));

/** Modelo do equipamento para exibir (ver displayModel). */
export const modelOf = (d: NbiDevice) => displayModel(d._deviceId?._ProductClass, vp(d, "ModelName"));

export const isReadonly = (d: NbiDevice) => (d._tags ?? []).includes(READONLY_TAG);

type CapCheck = { allowed: boolean; status: CapStatus | "nao-homologado" | "somente-leitura"; reason?: string };

/**
 * Capacidade para ESTE equipamento: perfil do modelo + tag somente_leitura. Com a tag, tudo que grava no
 * equipamento (alterações e diagnósticos, que gravam os parâmetros do teste) fica bloqueado, sem liberação manual.
 */
export function capabilityFor(d: NbiDevice, cap: string, profile = profileOf(d)): CapCheck {
  if (isReadonly(d) && CAPABILITIES[cap]?.kind !== "leitura") {
    return { allowed: false, status: "somente-leitura", reason: `equipamento marcado como somente leitura (tag ${READONLY_TAG}): ${CAPABILITIES[cap]?.label ?? cap} bloqueado` };
  }
  return capabilityAllowed(profile, cap);
}
