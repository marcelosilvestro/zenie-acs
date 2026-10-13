// Registro de adaptadores: o perfil do modelo (catalog/) diz a fonte de cada capacidade.
// Sem perfil (modelo não homologado) usa a fonte padrão — só leitura/diagnóstico chegam aqui, pois a
// escrita em modelo não homologado é barrada pelo guard (salvo liberação manual do admin).

import { profileOf, type Profile } from "../catalog.js";
import { toBool, vp, type NbiDevice } from "../nbi.js";
import { tr098IpPing } from "./diag/tr098-ipping.js";
import { zteEasyMesh } from "./mesh/zte-easymesh.js";
import type { MeshAdapter, PingAdapter, UnifyAdapter } from "./types.js";
import { sameSsid, zteBandsteering } from "./wifi/unify.js";

const MESH: Record<string, MeshAdapter> = { [zteEasyMesh.id]: zteEasyMesh };
const PING: Record<string, PingAdapter> = { [tr098IpPing.id]: tr098IpPing };
const UNIFY: Record<string, UnifyAdapter> = { [zteBandsteering.id]: zteBandsteering, [sameSsid.id]: sameSsid };

/** Fontes possíveis por capacidade (as demais leem dos virtual parameters: "vp"). */
export const SOURCES: Record<string, string[]> = {
  mesh: Object.keys(MESH),
  ping: Object.keys(PING),
  wifiUnify: Object.keys(UNIFY),
  reboot: ["tr069"],
};

const source = (profile: Profile | null, cap: string) => profile?.capabilities[cap]?.source;

export function meshAdapter(d: NbiDevice): MeshAdapter | null {
  return MESH[source(profileOf(d), "mesh") ?? zteEasyMesh.id] ?? null;
}

export function pingAdapter(d: NbiDevice): PingAdapter | null {
  return PING[source(profileOf(d), "ping") ?? tr098IpPing.id] ?? null;
}

/** Unificação: fonte do perfil; sem perfil, Bandsteering ZTE se o VP existir. Nenhuma = modelo não unifica. */
export function unifyAdapter(d: NbiDevice, profile: Profile | null = profileOf(d)): UnifyAdapter | null {
  if (profile?.capabilities.wifiUnify?.status === "nao-suportado") return null;
  const src = source(profile, "wifiUnify");
  if (src && UNIFY[src]) return UNIFY[src]!;
  return toBool(vp(d, "WifiBandSteering")) !== null ? zteBandsteering : null;
}
