// Refresh enxuto dos virtual parameters usados pelo painel de atendimento.
// Aplicado a todas as CPEs pelo preset "refresh-vp" (a cada Inform), mas cada
// grupo só consulta a CPE quando o intervalo vence — com Inform de 300 s,
// o grupo de 15 min gera consulta em 1 de cada 3 informs.
// Date.now(intervalo) tem deslocamento por dispositivo: a carga se espalha.
//
// Para dados "na hora" (botão Atualizar do painel), o painel pede
// getParameterValues dos VPs com connection_request — não depende deste provision.

const every15min = Date.now(15 * 60 * 1000);
const hourly = Date.now(60 * 60 * 1000);

// Mudam rápido / mais consultados pelo atendimento.
["RXPower", "TXPower", "PonStatus", "WanStatus", "WanIP", "Uptime"].forEach((vp) =>
  declare("VirtualParameters." + vp, { value: every15min })
);

// Mudam devagar.
["PonTemperature", "PonVoltage", "PonBiasCurrent", "PPPoEUsername", "FirmwareVersion"].forEach((vp) =>
  declare("VirtualParameters." + vp, { value: hourly })
);

// Não muda (ModelName: reconhecimento do modelo no catálogo quando o ProductClass é genérico).
declare("VirtualParameters.PonSerial", { value: 1 });
declare("VirtualParameters.ModelName", { value: Date.now(86400000) });
