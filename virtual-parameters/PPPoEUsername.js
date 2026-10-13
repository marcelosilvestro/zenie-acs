// VirtualParameters.PPPoEUsername — usuário PPPoE da WAN principal (busca do atendimento).
//
// Escolha da WAN: ver WanStatus.js (pickWan), restrita a WANPPPConnection.
// VALIDADO na ZTE F6201B (WANPPPConnection.1.Username, WAN criada via OMCI).
// Somente leitura por enquanto; escrita entra com o provisionamento zero-touch.
//
// Retorno: [usuario, "xsd:string"] ou ["", "xsd:string"] (ex.: WAN DHCP/bridge).

const BASE = "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.";
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

let result = "";
const wan = pickWan(["WANPPPConnection"]);
if (wan) {
  const d = declare(wan.path + ".Username", { value: hourly });
  if (d.size && d.value) result = String(d.value[0]).trim();
}

return { writable: false, value: [result, "xsd:string"] };
