// VirtualParameters.TXPower — potência óptica transmitida (dBm).
//
// Conversão escolhida pelo tipo do valor (texto -> "text", inteiro -> "raw" SFF-8472):
//   X_ZTE-COM_WANPONInterfaceConfig.TXPower
//     F6201B V9.3.10P7N9, F670L V9.0.11P3N10: "2.28" (xsd:string, dBm) — VALIDADO (tela web da ONU)
//     F670L V1.1.20P3N12:                      18032 (xsd:int, 0,1 µW -> 2.56 dBm) — plausível
//   ...OpticalTransceiver.TXPower: 16814 (xsd:int, 0,1 µW) — só F6201B; reserva.
//
// Retorno: ["2.28", "xsd:string"] ou ["", "xsd:string"].

const ZTE_PON = "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.";
const fromRaw = (n) => (n > 0 ? 10 * Math.log10(n / 10000) : null); // 0,1 µW
const CANDIDATES = [
  { path: ZTE_PON + "TXPower", text: (n) => n, raw: fromRaw },
  { path: ZTE_PON + "OpticalTransceiver.TXPower", raw: fromRaw },
];
const MIN = -10;
const MAX = 10;
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
