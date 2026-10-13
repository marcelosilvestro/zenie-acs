// Adaptador de mesh "zte-easymesh" (X_ZTE-COM_EasyMesh): topologia e detalhes por nó.
//
// Exceção à regra "normalização nos virtual parameters": o VP MeshInfo estourava
// cwmp.maxCommitIterations do GenieACS ao ler as listas de aparelhos de cada nó (no H196A,
// F6600P e H198A reais), embora cada parte isolada funcionasse. Aqui a API pede a subárvore ao
// equipamento (task refreshObject — poucas RPCs) e interpreta o JSON da NBI.
//
// Visto nos samples: o CONTROLADOR expõe a rede inteira em NetworkTopology (Controller + Agent.*),
// inclusive satélites que não estão no ACS. Ex.: H196A V9 -> Agent.1 = ZXHN H199A, backhaul
// "IEEE 802.3ab" 1000 Mbps, 6 aparelhos. MeshAgent.* = visão de satélite (HopToController >= 1) — A VALIDAR.

import { inventory } from "../../db.js";
import { nbiGet, type NbiDevice } from "../../nbi.js";
import { vendorOf } from "../../oui.js";
import { rssiQuality } from "../../rules.js";

export const EM = "InternetGatewayDevice.X_ZTE-COM_EasyMesh";
const T = `${EM}.NetworkTopology`;

type Node = Record<string, unknown>;

/** Valor de "a.b.c" num nó da árvore da NBI (null se ausente ou vazio). */
function val(node: unknown, path: string): unknown {
  let cur: unknown = node;
  for (const k of path.split(".")) cur = (cur as Node | undefined)?.[k];
  const v = (cur as { _value?: unknown } | undefined)?._value;
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;
}
const str = (node: unknown, path: string) => {
  const v = val(node, path);
  return v === null ? null : String(v);
};
const num = (node: unknown, path: string) => {
  const v = Number(val(node, path));
  return val(node, path) === null || !Number.isFinite(v) ? null : v;
};
const bool = (node: unknown, path: string) => {
  const v = val(node, path);
  return v === null ? null : v === true || v === "true" || v === "1" || v === 1;
};
const mac = (v: string | null) => (v ? v.toLowerCase() : null);
const children = (node: unknown) =>
  Object.entries((node as Node | undefined) ?? {}).filter(([k, v]) => /^\d+$/.test(k) && typeof v === "object").sort((a, b) => Number(a[0]) - Number(b[0]));

/** Lê uma subárvore do equipamento no banco do GenieACS. */
export async function readTree(id: string, path: string): Promise<unknown> {
  const q = encodeURIComponent(JSON.stringify({ _id: id }));
  const [d] = await nbiGet<NbiDevice[]>(`/devices/?query=${q}&projection=${encodeURIComponent(path)}`);
  let cur: unknown = d;
  for (const k of path.split(".")) cur = (cur as Node | undefined)?.[k];
  return cur ?? null;
}

function backhaul(node: unknown) {
  const media = str(node, "Backhaul.MediaType");
  const signal = num(node, "Backhaul.SignalStrength");
  return {
    media,
    kind: media ? (/802\.3/.test(media) ? "cabo" : /802\.11/.test(media) ? "wifi" : null) : null,
    phyMbps: num(node, "Backhaul.PHYRate"),
    // Backhaul por cabo reporta -1: sinal só vale em backhaul Wi-Fi.
    signal: signal !== null && signal < -10 ? signal : null,
    errorsRx: num(node, "Backhaul.PacketErrorsRX"),
    errorsTx: num(node, "Backhaul.PacketErrorsTX"),
  };
}

/**
 * Aparelhos ativos de um nó: pela lista STA quando ela já foi lida, mesmo vazia (o contador da F6201B não bate com
 * a lista: 0 com 2 aparelhos no cabo, 1 com a lista vazia no Wi-Fi); senão pelo contador.
 */
function staCount(node: unknown): number | null {
  const sta = (node as Node | undefined)?.STA;
  if (sta && typeof sta === "object") return children(sta).filter(([, s]) => bool(s, "Active") !== false).length;
  return num(node, "TotalSTANumberOfEntries");
}

/** Nós da topologia a partir da subárvore X_ZTE-COM_EasyMesh da NBI (puro, sem banco). */
export function parseNodes(id: string, em: unknown) {
  const topo = (em as Node).NetworkTopology;
  const controllerMac = mac(str(topo, "Controller.AL_MAC")) ?? mac(str(em, "AL_MAC"));
  return [
    {
      key: "controller",
      role: "principal" as const,
      mac: controllerMac,
      model: str(topo, "Controller.ModelName"),
      manufacturer: str(topo, "Controller.Manufacturer"),
      serial: str(topo, "Controller.SerialNumber"),
      firmware: null as string | null,
      active: true as boolean | null,
      hop: 0 as number | null,
      parentMac: null as string | null,
      backhaul: null as ReturnType<typeof backhaul> | null,
      clientCount: staCount((topo as Node | undefined)?.Controller),
      deviceId: id as string | null,
      identityUnknown: false,
      ip: null as string | null,
    },
    ...children((topo as Node | undefined)?.Agent).map(([i, a]) => {
      // F6201B V9.3.10P7N9 (bancada, 2026-10-09, satélite H199A no cabo): o Agent do satélite vem com a
      // identidade do CONTROLADOR (AL_MAC/modelo/serial/Parent iguais, hop 0, backhaul vazio), mas a lista
      // STA é a do satélite (notebook movido do H199A para a F6201B passou de Agent.1.STA para Controller.STA).
      const unknown = controllerMac !== null && mac(str(a, "AL_MAC")) === controllerMac;
      return {
        key: `agent-${i}`,
        role: "satélite" as const,
        mac: unknown ? null : mac(str(a, "AL_MAC")),
        model: unknown ? null : str(a, "ModelName"),
        manufacturer: unknown ? null : str(a, "Manufacturer"),
        serial: unknown ? null : str(a, "SerialNumber"),
        firmware: unknown ? null : str(a, "SoftwareVersion"),
        active: bool(a, "Active"),
        hop: unknown ? null : num(a, "HopToController"),
        parentMac: unknown ? controllerMac : mac(str(a, "Parent.AL_MAC")) ?? controllerMac,
        backhaul: unknown ? null : backhaul(a),
        clientCount: staCount(a),
        deviceId: null as string | null,
        identityUnknown: unknown,
        ip: null as string | null,
      };
    }),
  ];
}

export const HOSTS = "InternetGatewayDevice.LANDevice.1.Hosts.Host";

/**
 * Satélites sem identidade (F6201B): casa cada Agent com um host DHCP de satélite (VendorClassID
 * "MULTIAP_SLAVE") pela porta da LAN do principal que ele divide com os próprios aparelhos (Layer2Interface
 * do host). Visto na bancada em 2026-10-09: H199A e Redmi-A5 na LAN 4, H3601P e notebook na LAN 1.
 * Só atribui quando a porta aponta UM satélite; sobrando um Agent e um satélite, atribui por eliminação.
 * Backhaul Wi-Fi (vários satélites na mesma interface) fica sem identificação. Modelo/serial não existem aqui.
 */
export type SatelliteHost = { mac: string; ip: string | null; manufacturer: string | null; link: string | null };

/** Devolve os satélites da tabela DHCP que não puderam ser atribuídos a um nó (ex.: 2 satélites pelo Wi-Fi). */
export function identifySatellites(nodes: ReturnType<typeof parseNodes>, em: unknown, hosts: unknown): SatelliteHost[] {
  const unknown = nodes.filter((n) => n.identityUnknown);
  if (!unknown.length) return [];
  const list = children(hosts).map(([, h]) => ({
    mac: mac(str(h, "MACAddress")),
    ip: str(h, "IPAddress"),
    l2: str(h, "Layer2Interface")?.replace(/\.$/, "") ?? null,
    sat: str(h, "VendorClassID") === "MULTIAP_SLAVE",
    active: bool(h, "Active") !== false,
  })).filter((h) => h.mac && h.active);
  const sats = list.filter((h) => h.sat);
  const l2Of = new Map(list.map((h) => [h.mac, h.l2]));
  const agents = (em as Node | undefined)?.NetworkTopology as Node | undefined;
  const used = new Set<string>();
  const assign = (n: (typeof unknown)[number], h: (typeof sats)[number]) => {
    used.add(h.mac!);
    const port = /LANEthernetInterfaceConfig\.(\d+)$/.exec(h.l2 ?? "")?.[1];
    n.mac = h.mac;
    n.ip = h.ip;
    n.manufacturer = vendorOf(h.mac);
    n.backhaul = port
      ? { media: `LAN ${port} do principal`, kind: "cabo", phyMbps: null, signal: null, errorsRx: null, errorsTx: null }
      : /WLANConfiguration/.test(h.l2 ?? "") ? { media: "Wi-Fi", kind: "wifi", phyMbps: null, signal: null, errorsRx: null, errorsTx: null } : null;
  };
  for (const n of unknown) {
    const agent = (agents?.Agent as Node | undefined)?.[n.key.replace("agent-", "")];
    const ports = new Set(children((agent as Node | undefined)?.STA).map(([, st]) => l2Of.get(mac(str(st, "MAC")))).filter(Boolean));
    const match = sats.filter((h) => !used.has(h.mac!) && h.l2 && ports.has(h.l2));
    if (match.length === 1) assign(n, match[0]!);
  }
  const left = unknown.filter((n) => !n.mac);
  const free = sats.filter((h) => !used.has(h.mac!));
  if (left.length === 1 && free.length === 1) assign(left[0]!, free[0]!);
  return sats.filter((h) => !used.has(h.mac!)).map((h) => {
    const port = /LANEthernetInterfaceConfig\.(\d+)$/.exec(h.l2 ?? "")?.[1];
    return { mac: h.mac!, ip: h.ip, manufacturer: vendorOf(h.mac), link: port ? `cabo, LAN ${port}` : /WLANConfiguration/.test(h.l2 ?? "") ? "Wi-Fi" : null };
  });
}

/** Topologia (sem as listas de aparelhos): nós em árvore pelo MAC do "pai". */
export async function topology(id: string) {
  const em = await readTree(id, EM);
  if (!em || val(em, "Enable") === null) return { enabled: null as boolean | null };
  const nodes = parseNodes(id, em);
  const unassigned = nodes.some((n) => n.identityUnknown) ? identifySatellites(nodes, em, await readTree(id, HOSTS)) : [];

  // Satélite que também está no ACS: link para a ficha dele.
  const serials = nodes.slice(1).map((n) => (n.serial ?? "").toUpperCase()).filter(Boolean);
  if (serials.length) {
    const found = await inventory().find({ serialKey: { $in: serials } }, { projection: { _id: 1, serialKey: 1 } }).toArray();
    const bySerial = new Map(found.map((f) => [f.serialKey, f._id]));
    for (const n of nodes.slice(1)) n.deviceId = bySerial.get((n.serial ?? "").toUpperCase()) ?? null;
  }

  const hop = num(em, "MeshAgent.HopToController");
  return {
    enabled: bool(em, "Enable"),
    version: str(em, "Version"),
    nodes,
    // Satélites que o principal vê (tabela DHCP) mas não diz em qual nó estão (F6201B com 2+ satélites pelo Wi-Fi).
    unassignedSatellites: unassigned,
    // Este equipamento é satélite de outro controlador (A VALIDAR — nenhum satélite no ACS ainda).
    self: hop !== null && hop >= 1
      ? {
          hop,
          controller: { model: str(em, "MeshAgent.Controller.ModelName"), serial: str(em, "MeshAgent.Controller.SerialNumber") },
          parent: { model: str(em, "MeshAgent.Parent.ModelName"), serial: str(em, "MeshAgent.Parent.SerialNumber") },
          backhaul: backhaul((em as Node).MeshAgent),
        }
      : null,
  };
}

/** Caminho da lista de aparelhos de um nó ("controller" ou "agent-N"). */
export function stationsPath(key: string): string | null {
  if (key === "controller") return `${T}.Controller.STA`;
  const m = /^agent-(\d+)$/.exec(key);
  return m ? `${T}.Agent.${m[1]}.STA` : null;
}

/** Aparelhos conectados a um nó. */
export async function stations(id: string, key: string) {
  const path = stationsPath(key);
  if (!path) return null;
  const tree = await readTree(id, path);
  return children(tree)
    .map(([, s]) => {
      const m = mac(str(s, "MAC"));
      const host = str(s, "HostName");
      const access = str(s, "AccessType") ?? "";
      const signal = num(s, "SignalStrength");
      const ip = str(s, "IPv4Address");
      // AssociationTime: hora da (última) associação; firmwares com relógio zerado mandam 1970 -> ignora.
      const assoc = str(s, "AssociationTime");
      return {
        mac: m,
        name: host && mac(host) !== m ? host : null,
        ip: ip && ip !== "0.0.0.0" ? ip : null,
        band: /^2/.test(access) ? "2.4" : /^5/.test(access) ? "5" : /eth/i.test(access) ? "cabo" : access || null,
        signal: signal !== null && signal < 0 ? signal : null,
        quality: rssiQuality(signal !== null && signal < 0 ? signal : null),
        // Active=0: entrada antiga que a ZTE mantém na tabela (aparelho saiu ou migrou de nó).
        active: bool(s, "Active"),
        associatedAt: assoc && !assoc.startsWith("1970") ? assoc : null,
        vendor: vendorOf(m),
      };
    })
    .filter((s) => s.mac);
}

export const zteEasyMesh = {
  id: "zte-easymesh",
  label: "EasyMesh ZTE",
  /** Subárvore pedida ao equipamento (refreshObject) para atualizar a topologia. */
  root: EM,
  /** Tabela de hosts: identifica os satélites que o firmware não identifica (identifySatellites). */
  extraRoots: [HOSTS.replace(/\.Host$/, "")],
  topology,
  stationsPath,
  stations,
};
