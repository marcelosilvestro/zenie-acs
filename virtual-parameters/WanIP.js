// VirtualParameters.WanIP — IPv4 da conexão WAN principal.
//
// Escolha da WAN principal: ver WanStatus.js (mesma função pickWan).
// VALIDADO na ZTE F6201B (PPPoE).
//
// Retorno: [ip, "xsd:string"] ou ["", "xsd:string"].

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

const wan = pickWan(TYPES);
const ip = wan && wan.ip && wan.ip !== "0.0.0.0" ? String(wan.ip) : "";
return { writable: false, value: [ip, "xsd:string"] };
