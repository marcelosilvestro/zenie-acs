// VirtualParameters.DeviceMacs — MACs do próprio equipamento, para a busca do painel (JSON em texto).
//
// Caminhos (presentes nos 8 samples, docs/MODELOS.md):
//   base  DeviceInfo.X_ZTE-COM_ALMAC (MAC base/etiqueta ZTE) — todos
//   wan   WANDevice.*.WANConnectionDevice.*.WAN{PPP,IP}Connection.*.MACAddress — todos;
//         WANDevice.*.WANEthernetInterfaceConfig.MACAddress — roteadores
//   lan   LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress — todos
// MACs normalizados em minúsculas com ":"; repetidos removidos.
//
// Formato: {"base":"aa:bb:cc:00:00:01","wan":["aa:bb:cc:00:00:01"],"lan":"aa:bb:cc:00:00:02"}
//
// Retorno: [json, "xsd:string"].

const IGD = "InternetGatewayDevice.";
const daily = Date.now(86400000);

function mac(v) {
  const hex = String(v || "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 12 || /^0+$/.test(hex)) return null;
  return hex.match(/.{2}/g).join(":");
}

function one(path) {
  const d = declare(path, { value: daily });
  return d.size && d.value ? mac(d.value[0]) : null;
}

const wan = [];
for (const pattern of [
  IGD + "WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.MACAddress",
  IGD + "WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress",
  IGD + "WANDevice.*.WANEthernetInterfaceConfig.MACAddress",
]) {
  for (const p of declare(pattern, { path: daily, value: daily })) {
    const m = p.value ? mac(p.value[0]) : null;
    if (m && wan.indexOf(m) < 0) wan.push(m);
  }
}

const macs = {
  base: one(IGD + "DeviceInfo.X_ZTE-COM_ALMAC"),
  wan: wan,
  lan: one(IGD + "LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress"),
};

return { writable: false, value: [JSON.stringify(macs), "xsd:string"] };
