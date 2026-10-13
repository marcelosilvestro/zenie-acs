// VirtualParameters.WanCounters — contadores de bytes da WAN, para o painel calcular o tráfego atual
// (duas leituras com intervalo; o GenieACS não guarda histórico). JSON em texto.
//
// WANDevice.*.WANCommonInterfaceConfig.TotalBytesReceived / TotalBytesSent — TR-098 padrão, 8 samples.
// Algumas ONUs têm 2 WANDevice (F6201B, F6600P) e um deles fica zerado: usa o de maior contagem.
// São contadores de 32 bits em vários modelos (voltam a zero a cada 4 GiB) — o painel trata a volta.
// Alguns firmwares mandam o contador de 32 bits COM SINAL (negativo depois de 2 GiB): soma 2^32.
// TP-Link EC230-G1: WANCommonInterfaceConfig.Total* sempre 0 -> usa WANEthernetInterfaceConfig.Stats.
//   BytesReceived/BytesSent (TR-098 padrão; no sample vêm negativos, ex.: -640754967).
//
// SOB DEMANDA. Formato: {"rxBytes":123,"txBytes":456,"at":1696700000000}

const W = "InternetGatewayDevice.WANDevice.*.WANCommonInterfaceConfig.";
const now = Date.now();

const u32 = (v) => {
  const n = Number(v);
  return isFinite(n) && n < 0 ? n + 4294967296 : n;
};

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

const rx = {};
const tx = {};
for (const p of declare(W + "TotalBytesReceived", { path: Date.now(86400000), value: now })) {
  if (p.value) rx[parent(p.path)] = u32(p.value[0]);
}
for (const p of declare(W + "TotalBytesSent", { path: Date.now(86400000), value: now })) {
  if (p.value) tx[parent(p.path)] = u32(p.value[0]);
}

let best = null;
for (const k of Object.keys(rx)) {
  if (isFinite(rx[k]) && (best === null || rx[k] > rx[best])) best = k;
}

let out = best === null ? {} : { rxBytes: rx[best], txBytes: isFinite(tx[best]) ? tx[best] : null, at: now };

// Sem contador útil no WANCommonInterfaceConfig: tenta a interface Ethernet da WAN.
if (best === null || !rx[best]) {
  const E = "InternetGatewayDevice.WANDevice.*.WANEthernetInterfaceConfig.Stats.";
  const erx = {};
  const etx = {};
  for (const p of declare(E + "BytesReceived", { path: Date.now(86400000), value: now })) {
    if (p.value) erx[parent(p.path)] = u32(p.value[0]);
  }
  for (const p of declare(E + "BytesSent", { path: Date.now(86400000), value: now })) {
    if (p.value) etx[parent(p.path)] = u32(p.value[0]);
  }
  let eb = null;
  for (const k of Object.keys(erx)) {
    if (isFinite(erx[k]) && (eb === null || erx[k] > erx[eb])) eb = k;
  }
  if (eb !== null && erx[eb] > 0) out = { rxBytes: erx[eb], txBytes: isFinite(etx[eb]) ? etx[eb] : null, at: now };
}
return { writable: false, value: [JSON.stringify(out), "xsd:string"] };
