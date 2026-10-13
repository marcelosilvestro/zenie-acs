// VirtualParameters.AccessType — "ONU" (tem PON) ou "Roteador" (WAN Ethernet).
//
// Roteador = sem sinal óptico no ACS: nos samples (H196A, H198A, H199A, H3601P) a WAN tem
// VLAN 0, e os prédios usam 1 ONU bridge SEM TR-069 com vários roteadores atrás (decisão D3).
// O painel usa isto para dizer "sinal óptico só pela OLT" em vez de mostrar campos vazios.
//
// WANCommonInterfaceConfig.WANAccessType: "GPON" (F6201B, F6600P, F670L V1.1), "PON" (F670L V9),
// "Ethernet" (roteadores). Valores fora disso: retorna o texto original.
//
// Retorno: ["ONU"|"Roteador"|<texto da CPE>, "xsd:string"] ou ["", "xsd:string"].

let result = "";
const daily = Date.now(86400000);
for (const p of declare("InternetGatewayDevice.WANDevice.*.WANCommonInterfaceConfig.WANAccessType", { path: daily, value: daily })) {
  if (!p.value) continue;
  const v = String(p.value[0]).trim();
  if (/PON/i.test(v)) {
    result = "ONU";
    break;
  }
  if (/Ethernet/i.test(v)) result = "Roteador";
  else if (!result) result = v;
}

return { writable: false, value: [result, "xsd:string"] };
