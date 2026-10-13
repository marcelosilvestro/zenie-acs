// VirtualParameters.FirmwareVersion — versão de firmware.
//
// TR-098: InternetGatewayDevice.DeviceInfo.SoftwareVersion (parâmetro padrão,
// enviado em todo Inform). VALIDADO na ZTE F6201B ("V9.3.10P7N9").
// TR-181 (Device.DeviceInfo.SoftwareVersion) entra quando houver sample de
// MikroTik/TP-Link.
//
// Retorno: [versão, "xsd:string"] ou ["", "xsd:string"].

const CANDIDATES = [
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
];

let result = "";
// Chega a cada Inform; a consulta extra é no máximo de hora em hora.
const hourly = Date.now(3600000);
for (const path of CANDIDATES) {
  const d = declare(path, { value: hourly });
  if (d.size && d.value && String(d.value[0]).trim() !== "") {
    result = String(d.value[0]).trim();
    break;
  }
}

return { writable: false, value: [result, "xsd:string"] };
