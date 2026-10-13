// GERADO por scripts/gen-wifi-vps.py — não editar à mão.
// VirtualParameters.Wifi24Channel — canal (com marcação de automático; gravável) do SSID principal de 2,4 GHz.
//
// SSID principal da faixa = menor instância de WLANConfiguration daquela faixa
// (nos 8 modelos ZTE dos samples: 1 = 2,4 GHz, 5 = 5 GHz). Faixa deduzida de
// X_ZTE-COM_OperatingFrequencyBand -> X_ZTE-COM_RFBand -> Standard (token "a"/"ac" = 5 GHz).
// Ver docs/MODELOS.md (seções Wi-Fi) e docs/PLANO.md 4.1.
//
// Retorno: ["11 (auto)", "xsd:string"], ["36", "xsd:string"] ou "" (rádio desligado reporta canal 0 -> "").
// Escrita: "auto" -> AutoChannelEnable=true; "36" -> AutoChannelEnable=false + Channel=36
// (testado na F6201B; canais válidos em PossibleChannels — ver Wifi*Options).

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
const v = newValue();
if (v !== null) {
  if (String(v).trim().toLowerCase() === "auto") {
    declare(radio + ".AutoChannelEnable", null, { value: true });
  } else {
    const n = parseInt(v, 10);
    if (!isFinite(n) || n < 1 || n > 196) throw new Error("canal inválido");
    declare(radio + ".AutoChannelEnable", null, { value: false });
    declare(radio + ".Channel", null, { value: n });
  }
  return { writable: true, value: [v, "xsd:string"] };
}
const ch = get(radio + ".Channel", now);
const auto = get(radio + ".AutoChannelEnable", now);
const n = parseInt(ch, 10);
let out = "";
if (isFinite(n) && n > 0) out = String(n) + (auto === true || String(auto) === "true" || String(auto) === "1" ? " (auto)" : "");
return { writable: true, value: [out, "xsd:string"] };
