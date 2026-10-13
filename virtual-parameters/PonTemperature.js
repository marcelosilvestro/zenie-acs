// VirtualParameters.PonTemperature — temperatura do módulo óptico (°C).
//
// Conversão escolhida pelo tipo do valor (texto -> "text", inteiro -> "raw" SFF-8472):
//   X_ZTE-COM_WANPONInterfaceConfig.TransceiverTemperature
//     F6201B V9.3.10P7N9, F670L V9.0.11P3N10: "48.86" (xsd:string, °C) — VALIDADO (tela web da ONU)
//     F670L V1.1.20P3N12:                      11499 (xsd:int, 1/256 °C -> 44.9 °C) — plausível
//   ...OpticalTransceiver.Temperature: 12508 (xsd:int, 1/256 °C) — só F6201B; reserva.
// DeviceInfo.TemperatureStatus.TemperatureSensor.2 ("Optical module", F6201B) traz o
// mesmo dado arredondado — não usado.
//
// Retorno: ["48.9", "xsd:string"] ou ["", "xsd:string"].

const ZTE_PON = "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.";
// SFF-8472: inteiro com sinal de 16 bits em 1/256 °C.
const fromRaw = (n) => (n > 32767 ? n - 65536 : n) / 256;
const CANDIDATES = [
  { path: ZTE_PON + "TransceiverTemperature", text: (n) => n, raw: fromRaw },
  { path: ZTE_PON + "OpticalTransceiver.Temperature", raw: fromRaw },
];
const MIN = -40;
const MAX = 125;
const DECIMALS = 1;

function convert(c, value, type) {
  const n = parseFloat(String(value).replace(",", "."));
  if (!isFinite(n)) return null;
  const f = type === "xsd:string" ? c.text : c.raw;
  return f ? f(n) : null;
}

let result = null;
const now = Date.now();
for (const c of CANDIDATES) {
  const d = declare(c.path, { value: now });
  if (!d.size || !d.value) continue;
  const v = convert(c, d.value[0], d.value[1]);
  if (v !== null && v >= MIN && v <= MAX) {
    result = v.toFixed(DECIMALS);
    break;
  }
}

return { writable: false, value: [result === null ? "" : result, "xsd:string"] };
