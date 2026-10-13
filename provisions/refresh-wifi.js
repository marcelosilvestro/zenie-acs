// Refresh enxuto dos virtual parameters de Wi-Fi (rádio/SSID por faixa + gerais).
// Separado do refresh-vp para poder nascer só no "piloto" (regra D2) sem mexer
// no provision que já roda em todos os clientes.
//
// Listas (clientes Wi-Fi, hosts DHCP) NÃO entram aqui: são lidas sob demanda (PLANO 4.2).

const every15min = Date.now(15 * 60 * 1000);
const hourly = Date.now(60 * 60 * 1000);
const daily = Date.now(24 * 60 * 60 * 1000);

// Muda com frequência.
["Wifi24ClientsCount", "Wifi5ClientsCount"].forEach((vp) =>
  declare("VirtualParameters." + vp, { value: every15min })
);

// Configuração do Wi-Fi (muda quando alguém altera).
[
  "Wifi24SSID", "Wifi5SSID",
  "Wifi24Channel", "Wifi5Channel",
  "Wifi24Bandwidth", "Wifi5Bandwidth",
  "Wifi24Enabled", "Wifi5Enabled",
  "WifiBandSteering",
].forEach((vp) => declare("VirtualParameters." + vp, { value: hourly }));

// Atributo "gravável" dos VPs de escrita (D4). O GenieACS IGNORA setParameterValues num VP cujo
// _writable gravado no banco é false (visto na F6201B: SSID não foi enviado), então esse
// atributo precisa ser renovado — 1x/dia basta.
[
  "Wifi24SSID", "Wifi5SSID", "Wifi24Password", "Wifi5Password", "WifiBandSteering",
  "Wifi24Channel", "Wifi5Channel", "Wifi24Bandwidth", "Wifi5Bandwidth", "Wifi24TxPower", "Wifi5TxPower",
  "Wifi24Enabled", "Wifi5Enabled",
].forEach((vp) =>
  declare("VirtualParameters." + vp, { writable: daily })
);

// Características do equipamento.
["Wifi24Standard", "Wifi5Standard", "Wifi24Options", "Wifi5Options", "WifiGeneration", "AccessType"].forEach((vp) =>
  declare("VirtualParameters." + vp, { value: daily })
);
