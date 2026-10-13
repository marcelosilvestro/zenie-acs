// VirtualParameters.DhcpHosts — tabela de hosts da LAN/DHCP (JSON em texto, D1).
//
// SOB DEMANDA: não está em nenhum provision de refresh (ver docs/PLANO.md 4.2).
// Caminhos TR-098 padrão, presentes nos 8 modelos dos samples (LANDevice.*.Hosts.Host.*):
//   HostName, IPAddress, MACAddress, InterfaceType ("802.11"/"Ethernet"), Active,
//   AddressSource ("DHCP"/"Static"), LeaseTimeRemaining (s)
// Sem hosts no sample: F6201B (validar quando houver).
// Layer2Interface ("...WLANConfiguration.N." ou "...LANEthernetInterfaceConfig.N") manda sobre InterfaceType:
// o TP-Link EC230-G1 informa InterfaceType "Ethernet" para TODOS (inclusive celulares no Wi-Fi), mas o
// Layer2Interface aponta para o WLANConfiguration. ZTE roteadores: aponta para LANEthernetInterfaceConfig.
//
// Formato: [{"name":"notebook","ip":"192.168.0.10","mac":"aa:bb:...","iface":"wifi"|"cabo"|<texto>,
//            "active":true,"source":"DHCP","leaseSec":5891}, ...] — ativos primeiro, depois por IP.
// Observação: algumas CPEs mantêm hosts antigos com active=false; o painel decide se mostra.
//
// Retorno: [json, "xsd:string"]; "[]" sem hosts.

const HOST = "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.";
const now = Date.now();

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

function collect(field) {
  const out = {};
  for (const p of declare(HOST + field, { path: now, value: now })) {
    if (p.value) out[parent(p.path)] = p.value[0];
  }
  return out;
}

const mac = collect("MACAddress");
const name = collect("HostName");
const ip = collect("IPAddress");
const iface = collect("InterfaceType");
const active = collect("Active");
const source = collect("AddressSource");
const lease = collect("LeaseTimeRemaining");
const layer2 = collect("Layer2Interface");

function ifaceLabel(v) {
  const s = String(v || "");
  if (/802\.11|wlan|wi-?fi/i.test(s)) return "wifi";
  if (/ethernet|lan/i.test(s)) return "cabo";
  return s || null;
}

function ipKey(v) {
  return String(v || "").split(".").map((o) => ("00" + o).slice(-3)).join(".");
}

const hosts = [];
for (const h of Object.keys(mac)) {
  if (!mac[h] || !String(mac[h]).trim()) continue;
  const l = parseInt(lease[h], 10);
  hosts.push({
    name: name[h] && String(name[h]).trim() ? String(name[h]).trim() : null,
    ip: ip[h] && String(ip[h]).trim() && String(ip[h]).trim() !== "0.0.0.0" ? String(ip[h]).trim() : null,
    mac: String(mac[h]).toLowerCase(),
    iface: /WLANConfiguration\.\d+/.test(String(layer2[h] || "")) ? "wifi" : ifaceLabel(iface[h]),
    active: active[h] === undefined ? null : active[h] === true || String(active[h]) === "true" || String(active[h]) === "1",
    source: source[h] ? String(source[h]) : null,
    leaseSec: isFinite(l) && l > 0 ? l : null,
  });
}

hosts.sort((a, b) => (b.active === true) - (a.active === true) || ipKey(a.ip).localeCompare(ipKey(b.ip)));

return { writable: false, value: [JSON.stringify(hosts), "xsd:string"] };
