// VirtualParameters.Uptime — tempo desde o último boot da CPE (segundos).
//
// TR-098: InternetGatewayDevice.DeviceInfo.UpTime (parâmetro padrão).
// VALIDADO na ZTE F6201B (124699 s).
//
// Retorno: [segundos, "xsd:unsignedInt"] ou ["", "xsd:string"].

const CANDIDATES = [
  "InternetGatewayDevice.DeviceInfo.UpTime",
];

const now = Date.now();
for (const path of CANDIDATES) {
  const d = declare(path, { value: now });
  if (d.size && d.value) {
    const n = parseInt(d.value[0], 10);
    if (isFinite(n) && n >= 0) return { writable: false, value: [n, "xsd:unsignedInt"] };
  }
}

return { writable: false, value: ["", "xsd:string"] };
