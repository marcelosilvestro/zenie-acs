// VirtualParameters.CpuUsage — uso de CPU do equipamento (%).
//
// Candidatos (samples, docs/MODELOS.md):
//   DeviceInfo.ProcessStatus.CPUUsage  int (TR-098 padrão)   F6201B, F6600P, F670L V9, H196A, H199A, H3601P
//   DeviceInfo.X_ZTE-COM_CpuUsed       "32%;31%" (por núcleo -> média)  ONUs (única opção na F670L V1.1)
//   X_ZTE-COM_Alarm.CpuUsed            int                    F6201B, F6600P, H196A, H199A, H3601P
//   H198A: não tem -> "".
// A VALIDAR: no mesmo equipamento os três divergem (F6201B: 1 / "32%;31%" / 2). Usamos o padrão TR-098
// primeiro; conferir contra a tela da ONU antes de usar em alerta.
//
// SOB DEMANDA (botão Atualizar da ficha). Retorno: [n, "xsd:unsignedInt"] ou ["", "xsd:string"].

const IGD = "InternetGatewayDevice.";
const now = Date.now();

function value(path) {
  const d = declare(path, { value: now });
  return d.size && d.value && d.value[0] !== null && String(d.value[0]).trim() !== "" ? d.value[0] : null;
}

function percent(v) {
  // "32%;31%" -> média 31.5; "22" -> 22
  const parts = String(v).split(/[;,\s]+/).map((p) => parseFloat(p)).filter((n) => isFinite(n));
  if (!parts.length) return null;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return avg >= 0 && avg <= 100 ? Math.round(avg) : null;
}

for (const path of [IGD + "DeviceInfo.ProcessStatus.CPUUsage", IGD + "DeviceInfo.X_ZTE-COM_CpuUsed", IGD + "X_ZTE-COM_Alarm.CpuUsed"]) {
  const v = value(path);
  const n = v === null ? null : percent(v);
  if (n !== null) return { writable: false, value: [n, "xsd:unsignedInt"] };
}

return { writable: false, value: ["", "xsd:string"] };
