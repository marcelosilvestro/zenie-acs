// VirtualParameters.WifiGeneration — geração do Wi-Fi do equipamento ("1" a "7"), pela maior
// geração anunciada em WLANConfiguration.*.Standard (nomenclatura Wi-Fi Alliance):
//   b = Wi-Fi 1, a = Wi-Fi 2, g = Wi-Fi 3, n = Wi-Fi 4, ac = Wi-Fi 5, ax = Wi-Fi 6, be = Wi-Fi 7.
// Só Standard serve para todos: os campos extras de Wi-Fi 6 (WPA3, OFDMA, TWT) existem nas ONUs
// F6201B/F6600P, mas não no roteador H3601P (que também é Wi-Fi 6).
// Samples: Wi-Fi 6 = F6201B, F6600P, H3601P; demais = Wi-Fi 5.
//
// Retorno: ["6", "xsd:string"] ou ["", "xsd:string"] (sem Wi-Fi).

const GEN = { b: 1, a: 2, g: 3, n: 4, ac: 5, ax: 6, be: 7 };
const daily = Date.now(86400000);
let best = 0;
for (const p of declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.Standard", { path: daily, value: daily })) {
  if (!p.value) continue;
  for (const t of String(p.value[0]).split(",")) {
    const g = GEN[t.trim().toLowerCase()];
    if (g && g > best) best = g;
  }
}

return { writable: false, value: [best ? String(best) : "", "xsd:string"] };
