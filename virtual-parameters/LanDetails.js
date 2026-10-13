// VirtualParameters.LanDetails — rede local (LAN/DHCP) para a aba Rede do painel (JSON em texto).
//
// Caminhos TR-098 padrão, presentes nos 8 samples (LANDevice.1.LANHostConfigManagement):
//   IPInterface.1.IPInterfaceIPAddress / IPInterfaceSubnetMask (IP e máscara da CPE na LAN)
//   DHCPServerEnable, MinAddress, MaxAddress, DNSServers, DHCPLeaseTime (s)
// IPv6 da LAN (ZTE):
//   ipv6Delegated prefixo delegado (/56) recebido do provedor para a rede do cliente:
//                 WANPPPConnection.*.X_ZTE-COM_PD (7 modelos) -> X_ZTE-COM_IPv6PrefixDelegationAddress (F670L V1.1)
//   ipv6Prefix    /64 da LAN (primeiro /64 do delegado): X_ZTE-COM_IPv6LANHostConfigManagement.Prefix.*.Prefix
//   ipv6Address   endereço global da CPE na LAN: X_ZTE-COM_IPv6GUAFormPrefixAddress (F670L V1.1)
//   ipv6Dns       DNS entregue por DHCPv6: {"manual":false,"servers":[]} — DHCPv6.ManualDNSEnable false =
//                 automático (repassa o da WAN; DNSAddress1..3 ficam "::" — visto nos 7 modelos com o objeto)
// Link-local (fe80::1) não é exibido.
// Somente leitura: editar a LAN pelo NOC está fora do escopo (docs/PAINEL.md).
//
// Formato: {"ip":"192.168.0.1","mask":"255.255.255.0","dhcp":true,"dhcpStart":"192.168.0.10",
//           "dhcpEnd":"192.168.0.254","dns":["192.168.0.1"],"leaseSec":86400,
//           "ipv6Delegated":"2804:...::/56","ipv6Prefix":"2804:...::/64","ipv6Address":null,
//           "ipv6Dns":{"manual":false,"servers":[]}}
//
// Retorno: [json, "xsd:string"].

const LAN = "InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.";
const hourly = Date.now(3600000);

function get(path) {
  const d = declare(path, { value: hourly });
  if (!d.size || !d.value || d.value[0] === null) return null;
  const s = String(d.value[0]).trim();
  return s === "" ? null : d.value[0];
}

const IPV6 = "InternetGatewayDevice.LANDevice.1.X_ZTE-COM_IPv6LANHostConfigManagement.";
const isGlobal = (v) => /^[23][0-9a-f]{3}:/i.test(String(v || "").trim());

let ipv6Prefix = null;
for (const p of declare(IPV6 + "Prefix.*.Prefix", { path: hourly, value: hourly })) {
  if (p.value && isGlobal(p.value[0])) {
    ipv6Prefix = String(p.value[0]).trim();
    break;
  }
}
let ipv6Address = null;
for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.X_ZTE-COM_IPv6GUAFormPrefixAddress", { path: hourly, value: hourly })) {
  if (p.value && isGlobal(p.value[0])) {
    ipv6Address = String(p.value[0]).trim();
    break;
  }
}

let ipv6Delegated = null;
for (const name of ["X_ZTE-COM_PD", "X_ZTE-COM_IPv6PrefixDelegationAddress"]) {
  for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*." + name, { path: hourly, value: hourly })) {
    if (!ipv6Delegated && p.value && isGlobal(p.value[0])) ipv6Delegated = String(p.value[0]).trim();
  }
}
const manualDns = get(IPV6 + "DHCPv6.ManualDNSEnable");
const dns6 = ["DNSAddress1", "DNSAddress2", "DNSAddress3"].map((n) => get(IPV6 + "DHCPv6." + n)).filter((v) => v && String(v).trim() !== "::").map(String);

const dhcp = get(LAN + "DHCPServerEnable");
const dns = get(LAN + "DNSServers");
const lease = parseInt(get(LAN + "DHCPLeaseTime"), 10);

const details = {
  ip: get(LAN + "IPInterface.1.IPInterfaceIPAddress"),
  mask: get(LAN + "IPInterface.1.IPInterfaceSubnetMask") || get(LAN + "SubnetMask"),
  dhcp: dhcp === null ? null : dhcp === true || String(dhcp) === "true" || String(dhcp) === "1",
  dhcpStart: get(LAN + "MinAddress"),
  dhcpEnd: get(LAN + "MaxAddress"),
  dns: dns === null ? [] : String(dns).split(",").map((s) => s.trim()).filter((s) => s),
  leaseSec: isFinite(lease) && lease > 0 ? lease : null,
  ipv6Delegated: ipv6Delegated,
  ipv6Prefix: ipv6Prefix,
  ipv6Address: ipv6Address,
  ipv6Dns: manualDns === null ? null : { manual: manualDns === true || String(manualDns) === "true", servers: dns6 },
};

return { writable: false, value: [JSON.stringify(details), "xsd:string"] };
