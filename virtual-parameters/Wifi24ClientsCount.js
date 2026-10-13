// GERADO por scripts/gen-wifi-vps.py — não editar à mão.
// VirtualParameters.Wifi24ClientsCount — número de clientes associados do SSID principal de 2,4 GHz.
//
// SSID principal da faixa = menor instância de WLANConfiguration daquela faixa
// (nos 8 modelos ZTE dos samples: 1 = 2,4 GHz, 5 = 5 GHz). Faixa deduzida de
// X_ZTE-COM_OperatingFrequencyBand -> X_ZTE-COM_RFBand -> Standard (token "a"/"ac" = 5 GHz).
// Ver docs/MODELOS.md (seções Wi-Fi) e docs/PLANO.md 4.1.
//
// Retorno: [n, "xsd:unsignedInt"] ou ["", "xsd:string"]. TotalAssociations do SSID principal
// (clientes em SSIDs secundários, ex.: convidados, não entram).
// Sem TotalAssociations (TP-Link EC230-G1): hosts ativos com Layer2Interface neste rádio.

const BAND = "2.4";
const OTHER_BAND = "5";
const WLAN = "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.";
const now = Date.now();
const daily = Date.now(86400000);

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

function radioPath(band) {
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
  const inst = (b) => parseInt(b.slice(b.lastIndexOf(".") + 1), 10);
  const found = Object.keys(bands).filter((b) => bands[b] === band).sort((x, y) => inst(x) - inst(y));
  return found.length ? found[0] : null;
}

function get(path, ts) {
  const d = declare(path, { value: ts });
  return d.size && d.value ? d.value[0] : null;
}

// Bandsteering ligado = 2,4 e 5 GHz unificados (D6: escrita de SSID/senha vai para as duas faixas).
// Mesmos caminhos de WifiBandSteering.js (bool nas ONUs, 1/0 nos roteadores).
function steeringOn() {
  for (const path of ["InternetGatewayDevice.X_ZTE-COM_Bandsteering.Enable",
                      "InternetGatewayDevice.LANDevice.1.X_ZTE-COM_BandSteering.Enable"]) {
    const v = get(path, now);
    if (v !== null && String(v).trim() !== "") return v === true || String(v) === "true" || String(v) === "1";
  }
  return false;
}

// Rádios que recebem uma escrita: a faixa pedida e, com Bandsteering ligado, a outra também.
function writeTargets() {
  const targets = [radio];
  if (steeringOn()) {
    const other = radioPath(OTHER_BAND);
    if (other) targets.push(other);
  }
  return targets;
}

function newValue() {
  return args[1] && args[1].value ? String(args[1].value[0]) : null;
}

const radio = radioPath(BAND);
if (!radio) return { writable: false, value: ["", "xsd:string"] };
const n = parseInt(get(radio + ".TotalAssociations", now), 10);
if (isFinite(n) && n >= 0) return { writable: false, value: [n, "xsd:unsignedInt"] };
// Sem TotalAssociations: conta os hosts ativos cujo Layer2Interface aponta para este rádio.
const H = "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.";
const l2 = {};
for (const p of declare(H + "Layer2Interface", { path: now, value: now })) {
  if (p.value) l2[parent(p.path)] = String(p.value[0]).replace(/\.$/, "");
}
if (!Object.keys(l2).length) return { writable: false, value: ["", "xsd:string"] };
let count = 0;
for (const p of declare(H + "Active", { path: now, value: now })) {
  const on = p.value && (p.value[0] === true || String(p.value[0]) === "true" || String(p.value[0]) === "1");
  if (on && l2[parent(p.path)] === radio) count++;
}
return { writable: false, value: [count, "xsd:unsignedInt"] };
