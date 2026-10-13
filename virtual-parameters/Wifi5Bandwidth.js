// GERADO por scripts/gen-wifi-vps.py — não editar à mão.
// VirtualParameters.Wifi5Bandwidth — largura de canal (configurada, com a de operação quando automática; gravável) do SSID principal de 5 GHz.
//
// SSID principal da faixa = menor instância de WLANConfiguration daquela faixa
// (nos 8 modelos ZTE dos samples: 1 = 2,4 GHz, 5 = 5 GHz). Faixa deduzida de
// X_ZTE-COM_OperatingFrequencyBand -> X_ZTE-COM_RFBand -> Standard (token "a"/"ac" = 5 GHz).
// Ver docs/MODELOS.md (seções Wi-Fi) e docs/PLANO.md 4.1.
//
// Retorno: ["Auto (160MHz)", "xsd:string"], ["80MHz", "xsd:string"] ou "".
// Configurada: BandWidth (ONUs) ou X_ZTE-COM_BandWidth (roteadores); em operação:
// X_ZTE-COM_OperatingChannelBandwidth (só ONUs). Escrita: "Auto", "20MHz", "40MHz", "80MHz",
// "160MHz" (testados na F6201B no campo BandWidth; roteadores: mesmo formato, A VALIDAR).
// TP-Link EC230-G1: X_TP_Bandwidth ("20M") — só leitura (escrita A VALIDAR).

const BAND = "5";
const OTHER_BAND = "2.4";
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
const ALLOWED = ["Auto", "20MHz", "40MHz", "80MHz", "160MHz"];
let field = null;
for (const f of ["BandWidth", "X_ZTE-COM_BandWidth"]) {
  if (declare(radio + "." + f, { path: daily }).size) {
    field = f;
    break;
  }
}
const v = newValue();
if (v !== null) {
  if (!field) throw new Error("este equipamento não permite alterar a largura de canal");
  if (ALLOWED.indexOf(String(v)) < 0) throw new Error("largura inválida (use Auto, 20MHz, 40MHz, 80MHz ou 160MHz)");
  declare(radio + "." + field, null, { value: String(v) });
  return { writable: true, value: [v, "xsd:string"] };
}
const configured = field ? get(radio + "." + field, now) : null;
const operating = get(radio + ".X_ZTE-COM_OperatingChannelBandwidth", now);
let out = "";
if (configured !== null && String(configured).trim() !== "") {
  out = String(configured).trim();
  if (/^auto$/i.test(out) && operating && !/^auto$/i.test(String(operating))) out = "Auto (" + String(operating).trim() + ")";
} else if (operating) {
  out = String(operating).trim();
} else if (!field) {
  const tp = get(radio + ".X_TP_Bandwidth", now);
  if (tp !== null && String(tp).trim() !== "") out = String(tp).trim().replace(/^(\d+)M$/i, "$1MHz");
}
return { writable: field !== null, value: [out, "xsd:string"] };
