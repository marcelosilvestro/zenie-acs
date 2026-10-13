// VirtualParameters.WifiClients — lista de aparelhos conectados no Wi-Fi (JSON em texto, D1).
//
// SOB DEMANDA: não está em nenhum provision de refresh. O painel pede este VP com
// connection request quando o atendente abre o equipamento / clica em Atualizar.
// Custa redescobrir as instâncias (clientes entram e saem) — ver docs/PLANO.md 4.2.
//
// Formato: [{"band":"5","ssid":5,"mac":"aa:bb:cc:dd:ee:ff","ip":"192.168.0.10",
//            "name":"iPhone","rssi":-45,"rateMbps":433.5,"connectedSec":2548}, ...]
// ordenado por faixa e RSSI (melhor primeiro). Campos ausentes no modelo ficam null.
//
// Caminhos (docs/MODELOS.md "Wi-Fi (cliente associado)"):
//   MAC   AssociatedDeviceMACAddress | X_ZTE-COM_MACAddress
//   IP    AssociatedDeviceIPAddress
//   Nome  X_ZTE-COM_AssociatedDeviceName | X_ZTE-COM_DeviceName | (fallback) Hosts.Host.*.HostName pelo MAC
//   RSSI  AssociatedDeviceRssi | X_ZTE-COM_RSSI | X_ZTE-COM_Rssi | X_ZTE-COM_WLAN_RSSI |
//         X_ZTE-COM_SignalStrength | X_ZTE-COM_SigalStrength (sic) — 6 nomes conforme modelo
//   Taxa  AssociatedDeviceRate | LastDataTransmitRate — inteiro = kbps, texto = Mbps (roteadores)
//   Tempo X_ZTE-COM_StayTime | X_ZTE-COM_UpTime | X_ZTE-COM_Uptime (segundos)
// Sem cliente nos samples: F6201B, H198A (validar quando houver).
// Modelo SEM AssociatedDevice/TotalAssociations (TP-Link EC230-G1 em TR-098): a lista sai da tabela de
// hosts — ativos cujo Layer2Interface aponta para um WLANConfiguration. Sem sinal/taxa (rssi null) e
// "source":"hosts". Faixa pelo Standard do WLAN apontado; WLAN que não existe na árvore (o EC230-G1
// aponta "WLANConfiguration.2", que não existe) fica com faixa null.
//
// Retorno: [json, "xsd:string"]; "[]" sem clientes.

const IGD = "InternetGatewayDevice.";
const WLAN = IGD + "LANDevice.*.WLANConfiguration.*.";
const ASSOC = WLAN + "AssociatedDevice.*.";
const now = Date.now();
const daily = Date.now(86400000);

const F = {
  mac: ["AssociatedDeviceMACAddress", "X_ZTE-COM_MACAddress"],
  ip: ["AssociatedDeviceIPAddress"],
  name: ["X_ZTE-COM_AssociatedDeviceName", "X_ZTE-COM_DeviceName"],
  rssi: ["AssociatedDeviceRssi", "X_ZTE-COM_RSSI", "X_ZTE-COM_Rssi", "X_ZTE-COM_WLAN_RSSI",
         "X_ZTE-COM_SignalStrength", "X_ZTE-COM_SigalStrength"],
  // Taxa negociada do link primeiro; LastDataTransmitRate cai quando o aparelho está ocioso.
  rate: ["AssociatedDeviceRate", "LastDataTransmitRate"],
  time: ["X_ZTE-COM_StayTime", "X_ZTE-COM_UpTime", "X_ZTE-COM_Uptime"],
};

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

function inst(path) {
  return parseInt(path.slice(path.lastIndexOf(".") + 1), 10);
}

// Faixa de cada WLANConfiguration (mesma regra dos VPs Wifi24*/Wifi5*).
const bands = {};
for (const field of ["X_ZTE-COM_OperatingFrequencyBand", "X_ZTE-COM_RFBand"]) {
  for (const p of declare(WLAN + field, { path: daily, value: daily })) {
    const b = parent(p.path);
    if (p.value && String(p.value[0]).trim() && bands[b] === undefined) {
      bands[b] = String(p.value[0]).trim().charAt(0) === "5" ? "5" : "2.4";
    }
  }
}
for (const p of declare(WLAN + "Standard", { path: daily, value: daily })) {
  const b = parent(p.path);
  if (p.value && bands[b] === undefined) {
    const tokens = String(p.value[0]).split(",").map((t) => t.trim());
    bands[b] = tokens.indexOf("a") >= 0 || tokens.indexOf("ac") >= 0 ? "5" : "2.4";
  }
}

// Coleta campo -> {caminhoDoCliente: [valor, tipo]} respeitando a ordem dos candidatos.
function collect(names) {
  const out = {};
  for (const name of names) {
    for (const p of declare(ASSOC + name, { path: now, value: now })) {
      const c = parent(p.path);
      if (p.value && out[c] === undefined && p.value[0] !== null && String(p.value[0]).trim() !== "") {
        out[c] = p.value;
      }
    }
  }
  return out;
}

const mac = collect(F.mac);
const ip = collect(F.ip);
const name = collect(F.name);
const rssi = collect(F.rssi);
const rate = collect(F.rate);
const time = collect(F.time);

// Hostname pela tabela DHCP, para quando o nome do cliente Wi-Fi vier vazio.
const hostNames = {};
const hostMacs = {};
for (const p of declare(IGD + "LANDevice.*.Hosts.Host.*.MACAddress", { path: now, value: now })) {
  if (p.value) hostMacs[parent(p.path)] = String(p.value[0]).toLowerCase();
}
for (const p of declare(IGD + "LANDevice.*.Hosts.Host.*.HostName", { path: now, value: now })) {
  const m = hostMacs[parent(p.path)];
  if (m && p.value && String(p.value[0]).trim()) hostNames[m] = String(p.value[0]).trim();
}

function num(v) {
  const n = parseFloat(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
}

const clients = [];
for (const c of Object.keys(mac)) {
  const wlan = parent(parent(c)); // ...WLANConfiguration.N
  const m = String(mac[c][0]).toLowerCase();
  let r = rssi[c] ? num(rssi[c][0]) : null;
  if (r !== null && (r >= 0 || r < -120)) r = null;
  let mbps = null;
  if (rate[c]) {
    const n = num(rate[c][0]);
    if (n !== null) mbps = rate[c][1] === "xsd:string" ? n : n / 1000; // texto = Mbps, inteiro = kbps
  }
  const t = time[c] ? num(time[c][0]) : null;
  clients.push({
    band: bands[wlan] || null,
    ssid: inst(wlan),
    mac: m,
    ip: ip[c] && String(ip[c][0]) !== "0.0.0.0" ? String(ip[c][0]) : null,
    name: name[c] ? String(name[c][0]) : hostNames[m] || null,
    rssi: r,
    rateMbps: mbps === null ? null : Math.round(mbps * 10) / 10,
    connectedSec: t === null ? null : Math.round(t),
  });
}

if (!clients.length && !declare(WLAN + "TotalAssociations", { path: daily }).size) {
  const hostLayer2 = {};
  const hostActive = {};
  const hostIp = {};
  for (const p of declare(IGD + "LANDevice.*.Hosts.Host.*.Layer2Interface", { path: now, value: now })) {
    if (p.value) hostLayer2[parent(p.path)] = String(p.value[0]).replace(/\.$/, "");
  }
  for (const p of declare(IGD + "LANDevice.*.Hosts.Host.*.Active", { path: now, value: now })) {
    if (p.value) hostActive[parent(p.path)] = p.value[0] === true || String(p.value[0]) === "true" || String(p.value[0]) === "1";
  }
  for (const p of declare(IGD + "LANDevice.*.Hosts.Host.*.IPAddress", { path: now, value: now })) {
    if (p.value) hostIp[parent(p.path)] = String(p.value[0]);
  }
  for (const h of Object.keys(hostMacs)) {
    const l2 = hostLayer2[h] || "";
    if (!/WLANConfiguration\.\d+$/.test(l2) || hostActive[h] === false) continue;
    const m = hostMacs[h];
    clients.push({
      band: bands[l2] || null,
      ssid: inst(l2),
      mac: m,
      ip: hostIp[h] && hostIp[h] !== "0.0.0.0" ? hostIp[h] : null,
      name: hostNames[m] || null,
      rssi: null,
      rateMbps: null,
      connectedSec: null,
      source: "hosts",
    });
  }
}

clients.sort((a, b) => String(a.band).localeCompare(String(b.band)) || (b.rssi || -999) - (a.rssi || -999));

return { writable: false, value: [JSON.stringify(clients), "xsd:string"] };
