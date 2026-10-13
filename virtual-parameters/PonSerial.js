// VirtualParameters.PonSerial — serial GPON (o que a OLT mostra, ex.: "ZTEGD0000001").
// Diferente do DeviceInfo.SerialNumber (serial de fábrica, ex.: "ZTEPQ0000001").
// Útil para o atendimento cruzar o equipamento com a OLT.
//
// ZTE F6201B fw V9.3.10P7N9 — VALIDADO: DeviceInfo.X_ZTE-COM_GPONSN.
// Outros modelos: sem sample ainda.
//
// Retorno: [serial, "xsd:string"] ou ["", "xsd:string"].

const CANDIDATES = [
  "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_GPONSN",
];

let result = "";
// Não muda: basta ter algum valor (timestamp 1).
for (const path of CANDIDATES) {
  const d = declare(path, { value: 1 });
  if (d.size && d.value && String(d.value[0]).trim() !== "") {
    result = String(d.value[0]).trim().toUpperCase();
    break;
  }
}

return { writable: false, value: [result, "xsd:string"] };
