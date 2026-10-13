// VirtualParameters.LanPorts — portas LAN físicas (JSON em texto).
//
// LANDevice.1.LANEthernetInterfaceConfig.{i}: Status ("Up"/"NoLink"), Name ("eth0" nas ONUs,
// "LAN1" nos roteadores — os roteadores listam só as LANs, a porta WAN não entra).
// Velocidade negociada (Mbps), conforme o modelo (docs/MODELOS.md):
//   PhyBitRate      F6201B, F6600P, H196A, H3601P (H199A tem o campo, sem valor nas portas do sample)
//   X_ZTE-COM_Speed F6201B, F6600P, F670L V9
//   X_ZTE-Speed     F670L V1.1.20 (sic, sem "COM")
//   H198A: sem velocidade -> null
// Porta sem link reporta 10 por padrão -> só mostramos velocidade de porta conectada.
// MaxBitRate é o configurado ("Auto"), não o negociado — não usado.
//
// Formato: [{"port":1,"name":"LAN 1","up":true,"speedMbps":100}, ...]
// Dica para o NOC: porta a 100 Mbps com plano maior = cabo/aparelho limitando.
//
// Retorno: [json, "xsd:string"].

const ETH = "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.*.";
const now = Date.now();
const daily = Date.now(86400000);

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

function collect(name, ts) {
  const out = {};
  for (const p of declare(ETH + name, ts)) {
    if (p.value && p.value[0] !== null && String(p.value[0]).trim() !== "") out[parent(p.path)] = p.value[0];
  }
  return out;
}

const status = collect("Status", { path: daily, value: now });
const speeds = [
  collect("PhyBitRate", { path: daily, value: now }),
  collect("X_ZTE-COM_Speed", { path: daily, value: now }),
  collect("X_ZTE-Speed", { path: daily, value: now }),
];

const ports = Object.keys(status)
  .map((p) => {
    const n = parseInt(p.slice(p.lastIndexOf(".") + 1), 10);
    const up = /^up$/i.test(String(status[p]));
    let speed = null;
    if (up) {
      for (const s of speeds) {
        const v = parseInt(s[p], 10);
        if (isFinite(v) && v > 0) {
          speed = v;
          break;
        }
      }
    }
    return { port: n, name: "LAN " + n, up: up, speedMbps: speed };
  })
  .sort((a, b) => a.port - b.port);

return { writable: false, value: [JSON.stringify(ports), "xsd:string"] };
