// Refresh dos virtual parameters da aba Rede do painel (WAN/LAN/portas) e dos detalhes
// de Wi-Fi que mudam pouco (segurança, potência). Nasce restrito ao "piloto" (regra D2).

const hourly = Date.now(60 * 60 * 1000);
const daily = Date.now(24 * 60 * 60 * 1000);

["WanDetails", "LanPorts"].forEach((vp) => declare("VirtualParameters." + vp, { value: hourly }));

["LanDetails", "DeviceMacs", "Wifi24Security", "Wifi5Security", "Wifi24TxPower", "Wifi5TxPower"].forEach((vp) =>
  declare("VirtualParameters." + vp, { value: daily })
);
