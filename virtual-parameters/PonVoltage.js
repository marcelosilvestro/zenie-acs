// VirtualParameters.PonVoltage — tensão de alimentação do módulo óptico (V).
//
// Conversão escolhida pelo tipo do valor (texto -> "text", inteiro -> "raw" SFF-8472):
//   X_ZTE-COM_WANPONInterfaceConfig.SupplyVoltage
//     F6201B V9.3.10P7N9, F670L V9.0.11P3N10: "3221" (xsd:string, mV) — VALIDADO (tela web da ONU)
//     F670L V1.1.20P3N12:                      32600 (xsd:int, 100 µV -> 3.26 V) — plausível
//   ...OpticalTransceiver.Vcc: 32210 (xsd:unsignedInt, 100 µV) — só F6201B; reserva.
//
// Retorno: ["3.22", "xsd:string"] (volts) ou ["", "xsd:string"].

const ZTE_PON = "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.";
const fromRaw = (n) => n / 10000; // 100 µV
const CANDIDATES = [
  { path: ZTE_PON + "SupplyVoltage", text: (n) => n / 1000, raw: fromRaw },
  { path: ZTE_PON + "OpticalTransceiver.Vcc", raw: fromRaw },
];
const MIN = 2.5;
const MAX = 4.0;
const DECIMALS = 2;

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
