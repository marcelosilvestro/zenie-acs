// VirtualParameters.PonBiasCurrent — corrente de polarização do laser (mA).
//
// Conversão escolhida pelo tipo do valor (texto -> "text", inteiro -> "raw" SFF-8472):
//   X_ZTE-COM_WANPONInterfaceConfig.BiasCurrent
//     F6201B V9.3.10P7N9, F670L V9.0.11P3N10: "12.10" (xsd:string, mA) — VALIDADO (tela web da ONU)
//     F670L V1.1.20P3N12:                      7975 (xsd:int, 2 µA -> 15.95 mA) — plausível
//   ...OpticalTransceiver.TXBias: 6050 (xsd:unsignedInt, 2 µA) — só F6201B; reserva.
//
// Retorno: ["12.10", "xsd:string"] ou ["", "xsd:string"].

const ZTE_PON = "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.";
const fromRaw = (n) => n * 0.002; // 2 µA
const CANDIDATES = [
  { path: ZTE_PON + "BiasCurrent", text: (n) => n, raw: fromRaw },
  { path: ZTE_PON + "OpticalTransceiver.TXBias", raw: fromRaw },
];
const MIN = 0;
const MAX = 150;
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
