// VirtualParameters.WanDetails — detalhes da WAN principal para a aba Rede do painel (JSON em texto).
//
// Escolha da WAN principal: mesma regra de WanStatus.js (pickWan).
// Formato: {"type":"PPPoE","gateway":"100.64.0.1","dns":["10.0.0.53","10.0.0.54"],"mtu":1492,
//           "lastError":"ERROR_NONE","uptimeSec":124516,"vlan":1016,"services":"INTERNET_TR069_VoIP",
//           "ipv6":"2804:...","ipv6Prefix":"2804:...::/64","ipv6Dns":["fd00::10:10:10:10"],"ipv6Status":"Connected"}
// Campos ausentes no modelo = null. Caminhos (8 samples, docs/MODELOS.md):
//   gateway   DefaultGateway (todos) -> RemoteIPAddress
//   dns       DNSServers (todos)
//   mtu       MaxMRUSize (7 modelos) -> MaxMTUSize (F670L V9)
//   lastError LastConnectionError (F670L V9 não tem) — "ERROR_AUTHENTICATION_FAILURE" etc. ajuda o NOC
//   vlan      X_ZTE-COM_VLANID (0 nos roteadores atrás de ONU bridge -> null)
//   ipv6      X_ZTE-COM_IPv6IPAddress (F6201B, F6600P) -> X_ZTE-COM_ExternalIPv6Address (F670L V9,
//             H196A, H198A, H199A, H3601P) -> X_ZTE-COM_IPv6ExternalAddress (F670L V1.1)
//             -> X_TP_ExternalIPv6Address (TP-Link EC230-G1)
//   ipv6Prefix prefixo /64 da WAN: X_ZTE-COM_Prefix.*.Prefix (o global; 7 modelos) -> calculado do
//             endereço IPv6 da WAN (F670L V1.1). O /56 delegado é da LAN (LanDetails).
//   ipv6Dns   X_ZTE-COM_IPv6DNSServers ("a,b"; 7 modelos) -> X_TP_IPv6DNSServers ("a,b"; EC230-G1)
//             -> X_ZTE-COM_IPv6DNSServers1..3 (F670L V1.1)
//   ipv6Status X_ZTE-COM_IPv6ConnStatus (todos)
//   link      porta física da WAN (WANDevice da conexão principal, WANCommonInterfaceConfig):
//             PhysicalLinkStatus + Layer1Down/UpstreamMaxBitRate (bit/s -> Mbps). Roteadores (Ethernet):
//             1000/1000 nos samples; ONUs: taxa da linha GPON 2500/1250. VALIDADO (2026-10-07): H196A com
//             a WAN forçada a 100 Mbps -> Layer1 = 100 Mbps (= X_ZTE-COM_DownlinkAdaptRate); já
//             X_ZTE-COM_DownlinkPHYRate continuou 1000 (é a capacidade da porta, não usar).
//             {"access":"Ethernet","status":"Up","downMbps":1000,"upMbps":1000}
//
// Retorno: [json, "xsd:string"]; "{}" sem WAN.

const BASE = "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.";
const TYPES = ["WANPPPConnection", "WANIPConnection"];
const now = Date.now();
const hourly = Date.now(3600000);

function field(type, name) {
  const out = {};
  for (const p of declare(BASE + type + ".*." + name, { path: hourly, value: now })) {
    if (p.value) out[p.path.slice(0, -(name.length + 1))] = p.value[0];
  }
  return out;
}

function pickWan(types) {
  let best = null;
  let bestScore = -1;
  for (const type of types) {
    const status = field(type, "ConnectionStatus");
    const ip = field(type, "ExternalIPAddress");
    const services = field(type, "X_ZTE-COM_ServiceList");
    for (const conn of Object.keys(status)) {
      let score = 0;
      if (status[conn] === "Connected") score += 4;
      if (ip[conn] && ip[conn] !== "0.0.0.0") score += 2;
      if (/INTERNET/i.test(String(services[conn] || ""))) score += 1;
      if (score > bestScore) {
        best = { path: conn, type: type, status: status[conn], ip: ip[conn] };
        bestScore = score;
      }
    }
  }
  return best;
}

function get(path) {
  const d = declare(path, { value: now });
  if (!d.size || !d.value || d.value[0] === null) return null;
  const s = String(d.value[0]).trim();
  return s === "" ? null : d.value[0];
}

function first(conn, names) {
  for (const n of names) {
    const v = get(conn + "." + n);
    if (v !== null) return v;
  }
  return null;
}

const isGlobal6 = (v) => /^[23][0-9a-f]{3}:/i.test(String(v || "").trim());
const isSet6 = (v) => !!v && String(v).trim() !== "" && String(v).trim() !== "::";

// "2804:478c:4000:6efc:5a72:c9ff:fe3e:52e0/64" -> "2804:478c:4000:6efc::/64"
function prefix64(addr) {
  const a = String(addr || "").split("/")[0].trim();
  if (!isGlobal6(a)) return null;
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = tail === undefined ? h : h.concat(Array(8 - h.length - t.length).fill("0"), t);
  if (groups.length !== 8) return null;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const wan = pickWan(TYPES);
if (!wan) return { writable: false, value: ["{}", "xsd:string"] };

const c = wan.path;
const dns = first(c, ["DNSServers"]);
const mtu = parseInt(first(c, ["MaxMRUSize", "MaxMTUSize"]), 10);
const vlan = parseInt(first(c, ["X_ZTE-COM_VLANID"]), 10);
const uptime = parseInt(first(c, ["Uptime"]), 10);
let type = wan.type === "WANPPPConnection" ? first(c, ["TransportType"]) || "PPPoE" : null;
if (!type) type = first(c, ["AddressingType"]) ? "IPoE (" + first(c, ["AddressingType"]) + ")" : "IPoE";

const ipv6 = first(c, ["X_ZTE-COM_IPv6IPAddress", "X_ZTE-COM_ExternalIPv6Address", "X_ZTE-COM_IPv6ExternalAddress", "X_TP_ExternalIPv6Address"]);
let wanPrefix = null;
for (const p of declare(c + ".X_ZTE-COM_Prefix.*.Prefix", { path: hourly, value: now })) {
  if (p.value && isGlobal6(p.value[0])) {
    wanPrefix = String(p.value[0]).trim();
    break;
  }
}
if (!wanPrefix) wanPrefix = prefix64(ipv6);
let ipv6Dns = [];
const dnsList = first(c, ["X_ZTE-COM_IPv6DNSServers", "X_TP_IPv6DNSServers"]);
if (dnsList !== null) ipv6Dns = String(dnsList).split(",").map((s) => s.trim()).filter(isSet6);
else ipv6Dns = ["X_ZTE-COM_IPv6DNSServers1", "X_ZTE-COM_IPv6DNSServers2", "X_ZTE-COM_IPv6DNSServers3"].map((n) => first(c, [n])).filter(isSet6).map(String);

const wanDevice = c.split(".WANConnectionDevice.")[0];
const common = wanDevice + ".WANCommonInterfaceConfig.";
const toMbps = (v) => {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n / 1e6) : null;
};
const link = {
  access: first(common.slice(0, -1), ["WANAccessType"]),
  // PhysicalLinkStatus (ZTE); TP-Link EC230-G1: WANEthernetInterfaceConfig.Status ("Up"), sem velocidade
  // negociada (MaxBitRate=1000 é configuração -> não usado).
  status: first(common.slice(0, -1), ["PhysicalLinkStatus"]) || first(wanDevice + ".WANEthernetInterfaceConfig", ["Status"]),
  downMbps: toMbps(first(common.slice(0, -1), ["Layer1DownstreamMaxBitRate"])),
  upMbps: toMbps(first(common.slice(0, -1), ["Layer1UpstreamMaxBitRate"])),
};

const details = {
  type: String(type),
  gateway: first(c, ["DefaultGateway", "RemoteIPAddress"]),
  dns: dns === null ? [] : String(dns).split(",").map((s) => s.trim()).filter((s) => s),
  mtu: isFinite(mtu) && mtu > 0 ? mtu : null,
  lastError: first(c, ["LastConnectionError"]),
  uptimeSec: isFinite(uptime) ? uptime : null,
  vlan: isFinite(vlan) && vlan > 0 ? vlan : null,
  services: first(c, ["X_ZTE-COM_ServiceList"]),
  ipv6: ipv6,
  ipv6Prefix: wanPrefix,
  ipv6Dns: ipv6Dns,
  ipv6Status: first(c, ["X_ZTE-COM_IPv6ConnStatus"]),
  link: link,
};

return { writable: false, value: [JSON.stringify(details), "xsd:string"] };
