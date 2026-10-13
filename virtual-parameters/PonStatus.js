// VirtualParameters.PonStatus — status do link PON ("Up", "Down"...), como a CPE reporta.
//
// ZTE F6201B fw V9.3.10P7N9 — VALIDADO: X_ZTE-COM_WANPONInterfaceConfig.Status = "Up".
// Valores possíveis além de "Up": A VALIDAR (desconectar a fibra da ONU de bancada).
// Obs.: o estado OMCI (O1..O5) aparece na tela web da ONU mas não foi achado na árvore TR-069.
//
// Retorno: [status, "xsd:string"] ou ["", "xsd:string"] sem PON (ex.: H196A/H199A).

const CANDIDATES = [
  "InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.Status",
];

let result = "";
const now = Date.now();
for (const path of CANDIDATES) {
  const d = declare(path, { value: now });
  if (d.size && d.value && String(d.value[0]).trim() !== "") {
    result = String(d.value[0]).trim();
    break;
  }
}

return { writable: false, value: [result, "xsd:string"] };
