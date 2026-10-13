// VirtualParameters.MemUsage — uso de memória do equipamento (%).
//
// Candidatos (samples):
//   DeviceInfo.X_ZTE-COM_MemUsed   "42%"  ONUs F6201B, F6600P, F670L V9 e V1.1
//   X_ZTE-COM_Alarm.MemoryUsed     int    F6201B, F6600P, H196A, H199A, H3601P (bate com o anterior: F6201B 42/42)
//   DeviceInfo.MemoryStatus.Total/Free  TR-098 padrão (kB)  TP-Link EC230-G1 (uso = 1 - Free/Total)
//   H198A: não tem -> "".
//
// SOB DEMANDA (botão Atualizar da ficha). Retorno: [n, "xsd:unsignedInt"] ou ["", "xsd:string"].

const IGD = "InternetGatewayDevice.";
const now = Date.now();

for (const path of [IGD + "DeviceInfo.X_ZTE-COM_MemUsed", IGD + "X_ZTE-COM_Alarm.MemoryUsed"]) {
  const d = declare(path, { value: now });
  if (!d.size || !d.value || d.value[0] === null) continue;
  const n = parseFloat(String(d.value[0]));
  if (isFinite(n) && n >= 0 && n <= 100) return { writable: false, value: [Math.round(n), "xsd:unsignedInt"] };
}

// Padrão TR-098: total e livre (só se os campos ZTE não existirem).
const total = declare(IGD + "DeviceInfo.MemoryStatus.Total", { value: now });
const free = declare(IGD + "DeviceInfo.MemoryStatus.Free", { value: now });
if (total.size && free.size && total.value && free.value) {
  const t = Number(total.value[0]);
  const f = Number(free.value[0]);
  if (isFinite(t) && isFinite(f) && t > 0 && f >= 0 && f <= t) return { writable: false, value: [Math.round((1 - f / t) * 100), "xsd:unsignedInt"] };
}

return { writable: false, value: ["", "xsd:string"] };
