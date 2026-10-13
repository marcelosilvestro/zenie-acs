// VirtualParameters.ModelName — nome do modelo informado pelo próprio equipamento (DeviceInfo.ModelName).
// Necessário para reconhecer o modelo no catálogo quando o ProductClass é genérico: a TP-Link usa "IGD"
// (TR-098) e "Device" (TR-181) em todos os modelos; o modelo de verdade só vem no ModelName.
//
// Candidatos:
//   InternetGatewayDevice.DeviceInfo.ModelName  TR-098 padrão — samples: 8 ZTE e TP-Link EC230-G1 ("EC230-G1")
//   Device.DeviceInfo.ModelName                 TR-181 padrão — A VALIDAR (nenhum sample TR-181 completo ainda)
//
// Muda só com troca de firmware: lido uma vez por dia. Retorno: ["EC230-G1", "xsd:string"] ou "".

const daily = Date.now(86400000);
for (const path of ["InternetGatewayDevice.DeviceInfo.ModelName", "Device.DeviceInfo.ModelName"]) {
  const d = declare(path, { path: daily, value: daily });
  if (d.size && d.value && d.value[0] !== null && String(d.value[0]).trim() !== "") {
    return { writable: false, value: [String(d.value[0]).trim(), "xsd:string"] };
  }
}
return { writable: false, value: ["", "xsd:string"] };
