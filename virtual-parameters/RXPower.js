// VirtualParameters.RXPower — potência óptica recebida (dBm).
//
// O MESMO caminho muda de formato conforme o firmware ZTE; a conversão é escolhida
// pelo tipo do valor (texto -> "text", inteiro -> "raw", padrão SFF-8472):
//   X_ZTE-COM_WANPONInterfaceConfig.RXPower
//     F6201B V9.3.10P7N9, F670L V9.0.11P3N10: "-11.27" (xsd:string, dBm)  — VALIDADO (tela web da ONU)
//     F670L V1.1.20P3N12:                      240 (xsd:int, 0,1 µW -> -16.20 dBm) — plausível, falta conferir
//   ...OpticalTransceiver.RXPower: 746 (xsd:int, 0,1 µW) — só F6201B; reserva.
//   X_GponInterafceConfig / X_GponInterfaceConfig: grafias citadas pela equipe, ainda
//     não vistas em nenhum sample — A VALIDAR.
//
// Retorno: ["-11.27", "xsd:string"] ou ["", "xsd:string"] (sem PON, LOS ou leitura inválida).
// Decimais como texto: o GenieACS 1.2 não aceita xsd:double em virtual parameters.

const ZTE_PON = "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.";
const fromRaw = (n) => (n > 0 ? 10 * Math.log10(n / 10000) : null); // 0,1 µW; 0 = sem luz
const CANDIDATES = [
  { path: ZTE_PON + "RXPower", text: (n) => n, raw: fromRaw },
  { path: ZTE_PON + "OpticalTransceiver.RXPower", raw: fromRaw },
  { path: "InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower", text: (n) => (n < 0 ? n : fromRaw(n)), raw: fromRaw },
  { path: "InternetGatewayDevice.WANDevice.1.X_GponInterfaceConfig.RXPower", text: (n) => (n < 0 ? n : fromRaw(n)), raw: fromRaw },
];
const MIN = -50;
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
