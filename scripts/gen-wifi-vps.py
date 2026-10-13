#!/usr/bin/env python3
"""Gera os virtual parameters de rádio Wi-Fi por faixa (Wifi24*, Wifi5*).

VP do GenieACS não importa módulos, então a lógica "qual SSID é o principal da faixa"
precisa estar em cada arquivo. Este gerador mantém um único modelo (TEMPLATE) e escreve
virtual-parameters/Wifi{24,5}{Campo}.js. Edite aqui e rode de novo — nunca edite os .js gerados.

  python3 scripts/gen-wifi-vps.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TEMPLATE = r"""// GERADO por scripts/gen-wifi-vps.py — não editar à mão.
// VirtualParameters.Wifi{band_id}{field} — {desc} do SSID principal de {band_label}.
//
// SSID principal da faixa = menor instância de WLANConfiguration daquela faixa
// (nos 8 modelos ZTE dos samples: 1 = 2,4 GHz, 5 = 5 GHz). Faixa deduzida de
// X_ZTE-COM_OperatingFrequencyBand -> X_ZTE-COM_RFBand -> Standard (token "a"/"ac" = 5 GHz).
// Ver docs/MODELOS.md (seções Wi-Fi) e docs/PLANO.md 4.1.
//
// Retorno: {ret_desc}

const BAND = "{band}";
const OTHER_BAND = "{other_band}";
const WLAN = "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.";
const now = Date.now();
const daily = Date.now(86400000);

function parent(path) {{
  return path.slice(0, path.lastIndexOf("."));
}}

function radioPath(band) {{
  const bands = {{}};
  for (const field of ["X_ZTE-COM_OperatingFrequencyBand", "X_ZTE-COM_RFBand"]) {{
    for (const p of declare(WLAN + field, {{ path: daily, value: daily }})) {{
      const b = parent(p.path);
      if (p.value && String(p.value[0]).trim() && bands[b] === undefined) {{
        bands[b] = String(p.value[0]).trim().charAt(0) === "5" ? "5" : "2.4";
      }}
    }}
  }}
  for (const p of declare(WLAN + "Standard", {{ path: daily, value: daily }})) {{
    const b = parent(p.path);
    if (p.value && bands[b] === undefined) {{
      const tokens = String(p.value[0]).split(",").map((t) => t.trim());
      bands[b] = tokens.indexOf("a") >= 0 || tokens.indexOf("ac") >= 0 ? "5" : "2.4";
    }}
  }}
  const inst = (b) => parseInt(b.slice(b.lastIndexOf(".") + 1), 10);
  const found = Object.keys(bands).filter((b) => bands[b] === band).sort((x, y) => inst(x) - inst(y));
  return found.length ? found[0] : null;
}}

function get(path, ts) {{
  const d = declare(path, {{ value: ts }});
  return d.size && d.value ? d.value[0] : null;
}}

// Bandsteering ligado = 2,4 e 5 GHz unificados (D6: escrita de SSID/senha vai para as duas faixas).
// Mesmos caminhos de WifiBandSteering.js (bool nas ONUs, 1/0 nos roteadores).
function steeringOn() {{
  for (const path of ["InternetGatewayDevice.X_ZTE-COM_Bandsteering.Enable",
                      "InternetGatewayDevice.LANDevice.1.X_ZTE-COM_BandSteering.Enable"]) {{
    const v = get(path, now);
    if (v !== null && String(v).trim() !== "") return v === true || String(v) === "true" || String(v) === "1";
  }}
  return false;
}}

// Rádios que recebem uma escrita: a faixa pedida e, com Bandsteering ligado, a outra também.
function writeTargets() {{
  const targets = [radio];
  if (steeringOn()) {{
    const other = radioPath(OTHER_BAND);
    if (other) targets.push(other);
  }}
  return targets;
}}

function newValue() {{
  return args[1] && args[1].value ? String(args[1].value[0]) : null;
}}

const radio = radioPath(BAND);
{body}
"""

FIELDS = {
    "SSID": dict(
        desc="SSID (gravável)",
        ret_desc='[ssid, "xsd:string"] ou ["", "xsd:string"].\n'
                 '// Escrita (D4/D6): 1 a 32 caracteres; com Bandsteering ligado grava nas duas faixas.',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const v = newValue();
if (v !== null) {
  if (v.length < 1 || v.length > 32) throw new Error("SSID deve ter de 1 a 32 caracteres");
  for (const r of writeTargets()) declare(r + ".SSID", null, { value: v });
  return { writable: true, value: [v, "xsd:string"] };
}
const cur = get(radio + ".SSID", now);
return { writable: true, value: [cur === null ? "" : String(cur), "xsd:string"] };""",
    ),
    "Password": dict(
        desc="senha do Wi-Fi (só escrita)",
        ret_desc='["", "xsd:string"] sempre na leitura (a senha nunca é exibida; muitas CPEs devolvem vazio).\n'
                 '// Escrita (D4/D6): 8 a 63 caracteres (WPA-PSK); com Bandsteering ligado grava nas duas faixas.\n'
                 '// Campo: KeyPassphrase; se não existir (F670L V1.1.20), PreSharedKey.1.KeyPassphrase.\n'
                 '// Não altera o modo de segurança (WPA2/WPA3) — fica o que a CPE já usa.',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const v = newValue();
if (v !== null) {
  if (v.length < 8 || v.length > 63) throw new Error("senha do Wi-Fi deve ter de 8 a 63 caracteres");
  for (const r of writeTargets()) {
    const direct = declare(r + ".KeyPassphrase", { path: daily });
    const target = direct.size ? r + ".KeyPassphrase" : r + ".PreSharedKey.1.KeyPassphrase";
    declare(target, null, { value: v });
  }
  // Na escrita devolve o valor pedido: se devolver "" o GenieACS acha que não convergiu
  // e tenta gravar de novo até "Too many commit iterations" (visto na F6201B).
  return { writable: true, value: [v, "xsd:string"] };
}
return { writable: true, value: ["", "xsd:string"] };""",
    ),
    "Security": dict(
        desc="segurança (texto amigável)",
        ret_desc='["WPA2-PSK (AES)", "xsd:string"] ou "".\n'
                 '// BeaconType: "11i" = WPA2 (único visto nos 8 samples); "None", "Basic", "WPA", "WPAand11i"\n'
                 '// e variantes com "WPA3" seguem o TR-098 — A VALIDAR quando aparecerem. Valor desconhecido = texto da CPE.',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const beacon = String(get(radio + ".BeaconType", now) || "");
const enc = (v) => ({ AESEncryption: "AES", TKIPEncryption: "TKIP", TKIPandAESEncryption: "TKIP+AES" })[String(v)] || (v ? String(v) : "");
let label = beacon;
let mode = "";
if (/wpa3/i.test(beacon)) label = /11i/i.test(beacon) ? "WPA2/WPA3" : "WPA3";
else if (beacon === "11i") { label = "WPA2-PSK"; mode = enc(get(radio + ".IEEE11iEncryptionModes", now)); }
else if (beacon === "WPAand11i") { label = "WPA/WPA2-PSK"; mode = enc(get(radio + ".IEEE11iEncryptionModes", now)); }
else if (beacon === "WPA") { label = "WPA-PSK"; mode = enc(get(radio + ".WPAEncryptionModes", now)); }
else if (beacon === "Basic") label = "WEP";
else if (beacon === "None") label = "Aberta (sem senha)";
return { writable: false, value: [label ? label + (mode ? " (" + mode + ")" : "") : "", "xsd:string"] };""",
    ),
    "TxPower": dict(
        desc="potência de transmissão (%, gravável)",
        ret_desc='["100%", "xsd:string"] ou "". TransmitPower; opções em TransmitPowerSupported (20,40,60,80,100\n'
                 '// nos 8 samples). Escrita: "60" ou "60%" -> TransmitPower=60 (testado na F6201B).',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const v = newValue();
if (v !== null) {
  const n = parseInt(v, 10);
  if (!isFinite(n) || n < 1 || n > 100) throw new Error("potência deve ser um percentual de 1 a 100");
  declare(radio + ".TransmitPower", null, { value: n });
  // Devolve exatamente o valor pedido (senão o GenieACS repete o commit).
  return { writable: true, value: [v, "xsd:string"] };
}
const n = parseInt(get(radio + ".TransmitPower", now), 10);
return { writable: true, value: [isFinite(n) && n >= 0 ? n + "%" : "", "xsd:string"] };""",
    ),
    "Channel": dict(
        desc="canal (com marcação de automático; gravável)",
        ret_desc='["11 (auto)", "xsd:string"], ["36", "xsd:string"] ou "" (rádio desligado reporta canal 0 -> "").\n'
                 '// Escrita: "auto" -> AutoChannelEnable=true; "36" -> AutoChannelEnable=false + Channel=36\n'
                 '// (testado na F6201B; canais válidos em PossibleChannels — ver Wifi*Options).',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const v = newValue();
if (v !== null) {
  if (String(v).trim().toLowerCase() === "auto") {
    declare(radio + ".AutoChannelEnable", null, { value: true });
  } else {
    const n = parseInt(v, 10);
    if (!isFinite(n) || n < 1 || n > 196) throw new Error("canal inválido");
    declare(radio + ".AutoChannelEnable", null, { value: false });
    declare(radio + ".Channel", null, { value: n });
  }
  return { writable: true, value: [v, "xsd:string"] };
}
const ch = get(radio + ".Channel", now);
const auto = get(radio + ".AutoChannelEnable", now);
const n = parseInt(ch, 10);
let out = "";
if (isFinite(n) && n > 0) out = String(n) + (auto === true || String(auto) === "true" || String(auto) === "1" ? " (auto)" : "");
return { writable: true, value: [out, "xsd:string"] };""",
    ),
    "Bandwidth": dict(
        desc="largura de canal (configurada, com a de operação quando automática; gravável)",
        ret_desc='["Auto (160MHz)", "xsd:string"], ["80MHz", "xsd:string"] ou "".\n'
                 '// Configurada: BandWidth (ONUs) ou X_ZTE-COM_BandWidth (roteadores); em operação:\n'
                 '// X_ZTE-COM_OperatingChannelBandwidth (só ONUs). Escrita: "Auto", "20MHz", "40MHz", "80MHz",\n'
                 '// "160MHz" (testados na F6201B no campo BandWidth; roteadores: mesmo formato, A VALIDAR).\n'
                 '// TP-Link EC230-G1: X_TP_Bandwidth ("20M") — só leitura (escrita A VALIDAR).',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const ALLOWED = ["Auto", "20MHz", "40MHz", "80MHz", "160MHz"];
let field = null;
for (const f of ["BandWidth", "X_ZTE-COM_BandWidth"]) {
  if (declare(radio + "." + f, { path: daily }).size) {
    field = f;
    break;
  }
}
const v = newValue();
if (v !== null) {
  if (!field) throw new Error("este equipamento não permite alterar a largura de canal");
  if (ALLOWED.indexOf(String(v)) < 0) throw new Error("largura inválida (use Auto, 20MHz, 40MHz, 80MHz ou 160MHz)");
  declare(radio + "." + field, null, { value: String(v) });
  return { writable: true, value: [v, "xsd:string"] };
}
const configured = field ? get(radio + "." + field, now) : null;
const operating = get(radio + ".X_ZTE-COM_OperatingChannelBandwidth", now);
let out = "";
if (configured !== null && String(configured).trim() !== "") {
  out = String(configured).trim();
  if (/^auto$/i.test(out) && operating && !/^auto$/i.test(String(operating))) out = "Auto (" + String(operating).trim() + ")";
} else if (operating) {
  out = String(operating).trim();
} else if (!field) {
  const tp = get(radio + ".X_TP_Bandwidth", now);
  if (tp !== null && String(tp).trim() !== "") out = String(tp).trim().replace(/^(\\d+)M$/i, "$1MHz");
}
return { writable: field !== null, value: [out, "xsd:string"] };""",
    ),
    "Options": dict(
        desc="opções válidas do rádio para o editor do painel",
        ret_desc='[json, "xsd:string"]: {"channels":[1,...,13],"powers":[20,40,60,80,100],"bandwidths":["Auto","20MHz","40MHz"]}\n'
                 '// channels = PossibleChannels; powers = TransmitPowerSupported; bandwidths: 2,4 GHz Auto/20/40;\n'
                 '// 5 GHz Auto/20/40/80 (+160 se o rádio for Wi-Fi 6 — "ax" em Standard).',
        body="""if (!radio) return { writable: false, value: ["{}", "xsd:string"] };
const nums = (v) => String(v || "").split(",").map((s) => parseInt(s, 10)).filter((n) => isFinite(n) && n > 0);
const std = String(get(radio + ".Standard", daily) || "").split(",").map((s) => s.trim());
const bandwidths = BAND === "2.4" ? ["Auto", "20MHz", "40MHz"] : ["Auto", "20MHz", "40MHz", "80MHz"].concat(std.indexOf("ax") >= 0 ? ["160MHz"] : []);
const opts = {
  channels: nums(get(radio + ".PossibleChannels", daily)),
  powers: nums(get(radio + ".TransmitPowerSupported", daily)),
  bandwidths: bandwidths,
};
return { writable: false, value: [JSON.stringify(opts), "xsd:string"] };""",
    ),
    "Enabled": dict(
        desc="SSID e rádio ligados (gravável: liga/desliga o Wi-Fi da faixa)",
        ret_desc='[true|false, "xsd:boolean"] ou ["", "xsd:string"] se não há rádio da faixa.\n'
                 '// true só se Enable (SSID) e RadioEnabled (rádio) estiverem ligados. Escrita: grava os DOIS\n'
                 '// (ligar exige ambos; a H198A do sample tinha Enable=true e RadioEnabled=false).',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const on = (v) => v === true || String(v) === "true" || String(v) === "1";
const v = newValue();
if (v !== null) {
  const want = on(v);
  declare(radio + ".Enable", null, { value: want });
  if (declare(radio + ".RadioEnabled", { path: daily }).size) declare(radio + ".RadioEnabled", null, { value: want });
  // Devolve o valor pedido (senão o GenieACS repete o commit).
  return { writable: true, value: [want, "xsd:boolean"] };
}
const enable = get(radio + ".Enable", now);
const radioOn = get(radio + ".RadioEnabled", now);
return { writable: true, value: [on(enable) && (radioOn === null || on(radioOn)), "xsd:boolean"] };""",
    ),
    "Standard": dict(
        desc="padrão do rádio",
        ret_desc='["b,g,n,ax", "xsd:string"] ou "". Contém "ax" = Wi-Fi 6.',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const v = get(radio + ".Standard", daily);
return { writable: false, value: [v === null ? "" : String(v), "xsd:string"] };""",
    ),
    "ClientsCount": dict(
        desc="número de clientes associados",
        ret_desc='[n, "xsd:unsignedInt"] ou ["", "xsd:string"]. TotalAssociations do SSID principal\n'
                 '// (clientes em SSIDs secundários, ex.: convidados, não entram).\n'
                 '// Sem TotalAssociations (TP-Link EC230-G1): hosts ativos com Layer2Interface neste rádio.',
        body="""if (!radio) return { writable: false, value: ["", "xsd:string"] };
const n = parseInt(get(radio + ".TotalAssociations", now), 10);
if (isFinite(n) && n >= 0) return { writable: false, value: [n, "xsd:unsignedInt"] };
// Sem TotalAssociations: conta os hosts ativos cujo Layer2Interface aponta para este rádio.
const H = "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.";
const l2 = {};
for (const p of declare(H + "Layer2Interface", { path: now, value: now })) {
  if (p.value) l2[parent(p.path)] = String(p.value[0]).replace(/\\.$/, "");
}
if (!Object.keys(l2).length) return { writable: false, value: ["", "xsd:string"] };
let count = 0;
for (const p of declare(H + "Active", { path: now, value: now })) {
  const on = p.value && (p.value[0] === true || String(p.value[0]) === "true" || String(p.value[0]) === "1");
  if (on && l2[parent(p.path)] === radio) count++;
}
return { writable: false, value: [count, "xsd:unsignedInt"] };""",
    ),
}

BANDS = [("24", "2.4", "5", "2,4 GHz"), ("5", "5", "2.4", "5 GHz")]


def main():
    out_dir = ROOT / "virtual-parameters"
    for band_id, band, other_band, band_label in BANDS:
        for field, spec in FIELDS.items():
            code = TEMPLATE.format(band_id=band_id, band=band, other_band=other_band, band_label=band_label, field=field,
                                   desc=spec["desc"], ret_desc=spec["ret_desc"], body=spec["body"])
            path = out_dir / f"Wifi{band_id}{field}.js"
            path.write_text(code, encoding="utf-8", newline="\n")
            print(f"gerado {path.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
