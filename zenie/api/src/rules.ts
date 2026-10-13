// Regras de classificação (docs/PAINEL.md seção 4). Padrões = faixa definida pelo nosso NOC;
// cada provedor ajusta pelo .env (e, numa entrega futura, pela tela de configurações do admin).

export type Level = "ok" | "warn" | "bad";
export type OnlineState = "online" | "late" | "offline" | "unknown";

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" ? v : fallback;
};

export const rules = {
  // RX óptico (dBm): bom > -22, atenção -22..-24, ruim <= -24; acima de -8 = saturação.
  rxGoodAbove: num("ZENIE_RX_GOOD_ABOVE", -22),
  rxBadAtOrBelow: num("ZENIE_RX_BAD_AT_OR_BELOW", -24),
  rxSaturationAbove: num("ZENIE_RX_SATURATION_ABOVE", -8),
  // Online: inform periódico esperado (s). Online até 2 ciclos + 60 s; offline após 30 min.
  informIntervalSec: num("ZENIE_INFORM_INTERVAL", 300),
  offlineAfterSec: num("ZENIE_OFFLINE_AFTER", 1800),
};

export const extraRules = {
  // TX óptico (dBm) da ONU: fora de 0,5..5 = ruim (laser degradado/saturado).
  txMin: num("ZENIE_TX_MIN", 0.5),
  txMax: num("ZENIE_TX_MAX", 5),
  // Temperatura do módulo óptico (°C).
  tempWarnAbove: num("ZENIE_TEMP_WARN_ABOVE", 70),
  tempBadAbove: num("ZENIE_TEMP_BAD_ABOVE", 85),
  // RSSI do cliente Wi-Fi (dBm): >= -60 excelente, >= -67 bom, >= -75 fraco, abaixo muito fraco.
  rssiExcellent: num("ZENIE_RSSI_EXCELLENT", -60),
  rssiGood: num("ZENIE_RSSI_GOOD", -67),
  rssiWeak: num("ZENIE_RSSI_WEAK", -75),
  // CPU / memória (%).
  loadWarnAbove: num("ZENIE_LOAD_WARN_ABOVE", 70),
  loadBadAbove: num("ZENIE_LOAD_BAD_ABOVE", 90),
};

export function loadLevel(p: number | null): Level | null {
  if (p === null) return null;
  if (p > extraRules.loadBadAbove) return "bad";
  if (p > extraRules.loadWarnAbove) return "warn";
  return "ok";
}

export function txLevel(tx: number | null): Level | null {
  if (tx === null) return null;
  return tx >= extraRules.txMin && tx <= extraRules.txMax ? "ok" : "bad";
}

export function tempLevel(t: number | null): Level | null {
  if (t === null) return null;
  if (t > extraRules.tempBadAbove) return "bad";
  if (t > extraRules.tempWarnAbove) return "warn";
  return "ok";
}

export type RssiQuality = "excelente" | "bom" | "fraco" | "muito fraco";
export function rssiQuality(rssi: number | null): RssiQuality | null {
  if (rssi === null) return null;
  if (rssi >= extraRules.rssiExcellent) return "excelente";
  if (rssi >= extraRules.rssiGood) return "bom";
  if (rssi >= extraRules.rssiWeak) return "fraco";
  return "muito fraco";
}

export function rxLevel(rx: number | null): Level | null {
  if (rx === null) return null;
  if (rx > rules.rxSaturationAbove) return "bad";
  if (rx > rules.rxGoodAbove) return "ok";
  if (rx > rules.rxBadAtOrBelow) return "warn";
  return "bad";
}

export function onlineState(lastInform: Date | null, now = Date.now()): OnlineState {
  if (!lastInform) return "unknown";
  const age = (now - lastInform.getTime()) / 1000;
  if (age <= rules.informIntervalSec * 2 + 60) return "online";
  if (age <= rules.offlineAfterSec) return "late";
  return "offline";
}
