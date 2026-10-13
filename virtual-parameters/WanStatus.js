// VirtualParameters.WanStatus — status da conexão WAN principal ("Connected", "Disconnected"...).
//
// Escolha da WAN principal (mesma lógica em WanIP e PPPoEUsername):
//   +4 ConnectionStatus == "Connected", +2 tem ExternalIPAddress, +1 serviço INTERNET (ZTE).
// Caminhos TR-098 padrão (WANPPPConnection/WANIPConnection). X_ZTE-COM_ServiceList é ZTE.
// VALIDADO na ZTE F6201B: 1 WAN PPPoE via OMCI, serviço "INTERNET_TR069_VoIP", VLAN 1016.
// A VALIDAR: modelos com WAN TR-069 separada da WAN de internet.
// TP-Link EC230-G1 (sample): ConnectionStatus "Enabled" (fora da norma TR-098) mesmo conectado e com IP;
// status fora da norma + IP válido -> "Connected".
//
// Retorno: [status, "xsd:string"] ou ["", "xsd:string"].

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
        best = { path: conn, status: status[conn], ip: ip[conn] };
        bestScore = score;
      }
    }
  }
  return best;
}

const STANDARD = ["Unconfigured", "Connecting", "Authenticating", "Connected", "PendingDisconnect", "Disconnecting", "Disconnected"];
const wan = pickWan(TYPES);
let st = wan && wan.status ? String(wan.status) : "";
if (st && STANDARD.indexOf(st) < 0 && wan.ip && wan.ip !== "0.0.0.0") st = "Connected";
return { writable: false, value: [st, "xsd:string"] };
