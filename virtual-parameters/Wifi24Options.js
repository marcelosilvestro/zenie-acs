// GERADO por scripts/gen-wifi-vps.py — não editar à mão.
// VirtualParameters.Wifi24Options — opções válidas do rádio para o editor do painel do SSID principal de 2,4 GHz.
//
// SSID principal da faixa = menor instância de WLANConfiguration daquela faixa
// (nos 8 modelos ZTE dos samples: 1 = 2,4 GHz, 5 = 5 GHz). Faixa deduzida de
// X_ZTE-COM_OperatingFrequencyBand -> X_ZTE-COM_RFBand -> Standard (token "a"/"ac" = 5 GHz).
// Ver docs/MODELOS.md (seções Wi-Fi) e docs/PLANO.md 4.1.
//
// Retorno: [json, "xsd:string"]: {"channels":[1,...,13],"powers":[20,40,60,80,100],"bandwidths":["Auto","20MHz","40MHz"]}
// channels = PossibleChannels; powers = TransmitPowerSupported; bandwidths: 2,4 GHz Auto/20/40;
// 5 GHz Auto/20/40/80 (+160 se o rádio for Wi-Fi 6 — "ax" em Standard).

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
if (!radio) return { writable: false, value: ["{}", "xsd:string"] };
const nums = (v) => String(v || "").split(",").map((s) => parseInt(s, 10)).filter((n) => isFinite(n) && n > 0);
const std = String(get(radio + ".Standard", daily) || "").split(",").map((s) => s.trim());
const bandwidths = BAND === "2.4" ? ["Auto", "20MHz", "40MHz"] : ["Auto", "20MHz", "40MHz", "80MHz"].concat(std.indexOf("ax") >= 0 ? ["160MHz"] : []);
const opts = {
  channels: nums(get(radio + ".PossibleChannels", daily)),
  powers: nums(get(radio + ".TransmitPowerSupported", daily)),
  bandwidths: bandwidths,
};
return { writable: false, value: [JSON.stringify(opts), "xsd:string"] };
