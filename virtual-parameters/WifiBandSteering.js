// VirtualParameters.WifiBandSteering — 2,4 e 5 GHz unificados (Bandsteering ZTE). Gravável (D4).
// Com ele ligado a CPE copia SSID/senha do 2,4 para o 5 (confirmado: SSID 1 == SSID 5
// em 6 de 6 equipamentos com Bandsteering ligado). Ver docs/PLANO.md 4.1.
//
// Caminhos (samples, docs/MODELOS.md "Wi-Fi (geral)"):
//   X_ZTE-COM_Bandsteering.Enable                 boolean  ONUs F6201B, F6600P, F670L V9 e V1.1
//   LANDevice.1.X_ZTE-COM_BandSteering.Enable     int 1/0  roteadores H196A, H199A, H3601P
//   LANDevice.1.WIFI.BANDSTEER.BandSteeringEnable boolean  espelho do 1º (F6201B, F6600P, F670L V9):
//                                                          só leitura aqui, nunca gravado
//   H198A V3.0: não tem -> "" e não gravável.
//
// Escrita: grava o caminho do modelo (true/false ou 1/0). Ao LIGAR, copia também o SSID do
// 2,4 GHz para o 5 GHz na mesma operação (D6 — não depender da cópia da CPE). A senha não pode
// ser lida (CPE devolve vazio): a do 5 GHz fica a cargo da CPE ou de uma troca de senha em seguida.
//
// Retorno: [true|false, "xsd:boolean"] ou ["", "xsd:string"].

const WRITABLE = [
  { path: "InternetGatewayDevice.X_ZTE-COM_Bandsteering.Enable", int: false },
  { path: "InternetGatewayDevice.LANDevice.1.X_ZTE-COM_BandSteering.Enable", int: true },
];
const MIRROR = "InternetGatewayDevice.LANDevice.1.WIFI.BANDSTEER.BandSteeringEnable";
const WLAN = "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.";
const now = Date.now();
const daily = Date.now(86400000);

const isOn = (v) => v === true || String(v) === "true" || String(v) === "1";

function parent(path) {
  return path.slice(0, path.lastIndexOf("."));
}

// Mesma regra dos VPs Wifi24*/Wifi5* (gerados por scripts/gen-wifi-vps.py).
function radioPath(band) {
  const bands = {};
  for (const field of ["X_ZTE-COM_OperatingFrequencyBand", "X_ZTE-COM_RFBand"]) {
    for (const p of declare(WLAN + field, { path: daily, value: daily })) {
      const b = parent(p.path);
      if (p.value && String(p.value[0]).trim() && bands[b] === undefined) {
        bands[b] = String(p.value[0]).trim().charAt(0) === "5" ? "5" : "2.4";
      }
    }
  }
  for (const p of declare(WLAN + "Standard", { path: daily, value: daily })) {
    const b = parent(p.path);
    if (p.value && bands[b] === undefined) {
      const tokens = String(p.value[0]).split(",").map((t) => t.trim());
      bands[b] = tokens.indexOf("a") >= 0 || tokens.indexOf("ac") >= 0 ? "5" : "2.4";
    }
  }
  const inst = (b) => parseInt(b.slice(b.lastIndexOf(".") + 1), 10);
  const found = Object.keys(bands).filter((b) => bands[b] === band).sort((x, y) => inst(x) - inst(y));
  return found.length ? found[0] : null;
}

let current = null;
let target = null;
for (const c of WRITABLE) {
  const d = declare(c.path, { value: now });
  if (d.size && d.value && d.value[0] !== null && String(d.value[0]).trim() !== "") {
    current = isOn(d.value[0]);
    target = c;
    break;
  }
}
if (current === null) {
  const d = declare(MIRROR, { value: now });
  if (d.size && d.value) current = isOn(d.value[0]);
}

if (args[1] && args[1].value) {
  if (!target) throw new Error("este equipamento não tem Bandsteering gravável");
  const on = isOn(args[1].value[0]);
  declare(target.path, null, { value: target.int ? (on ? 1 : 0) : on });
  if (on) {
    const r24 = radioPath("2.4");
    const r5 = radioPath("5");
    if (r24 && r5) {
      const ssid = declare(r24 + ".SSID", { value: now });
      if (ssid.size && ssid.value) declare(r5 + ".SSID", null, { value: String(ssid.value[0]) });
    }
  }
  return { writable: true, value: [on, "xsd:boolean"] };
}

if (current === null) return { writable: false, value: ["", "xsd:string"] };
return { writable: target !== null, value: [current, "xsd:boolean"] };
