#!/usr/bin/env python3
"""Gera docs/MODELOS.md a partir dos samples anonimizados (samples/*.anon.json).

Mostra, para cada informação que o painel/provisionamento precisa, quais caminhos
TR-069 existem em cada modelo/firmware. É a base para escrever os virtual
parameters: a ordem de CANDIDATES de cada VP sai desta matriz.

Rodar sempre que entrar um sample novo:
  python3 scripts/compare_samples.py            # escreve docs/MODELOS.md
  python3 scripts/compare_samples.py --stdout   # só imprime
"""

import argparse
import collections
import glob
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGD = "InternetGatewayDevice."
WLAN = IGD + "LANDevice.{i}.WLANConfiguration.{i}."
ASSOC = WLAN + "AssociatedDevice.{i}."
HOST = IGD + "LANDevice.{i}.Hosts.Host.{i}."
PON = IGD + "WANDevice.{i}.X_ZTE-COM_WANPONInterfaceConfig."
PPP = IGD + "WANDevice.{i}.WANConnectionDevice.{i}.WANPPPConnection.{i}."
IPC = IGD + "WANDevice.{i}.WANConnectionDevice.{i}.WANIPConnection.{i}."

# Informação -> caminhos candidatos (normalizados: instâncias viram {i}).
CONCEPTS = collections.OrderedDict([
    ("Equipamento", [
        ("Modelo", [IGD + "DeviceInfo.ModelName"]),
        ("Firmware", [IGD + "DeviceInfo.SoftwareVersion"]),
        ("Hardware", [IGD + "DeviceInfo.HardwareVersion"]),
        ("Uptime", [IGD + "DeviceInfo.UpTime"]),
        ("Serial GPON", [IGD + "DeviceInfo.X_ZTE-COM_GPONSN"]),
        ("Tipo de acesso WAN", [IGD + "WANDevice.{i}.WANCommonInterfaceConfig.WANAccessType"]),
        ("EasyMesh", [IGD + "X_ZTE-COM_EasyMesh.Enable"]),
    ]),
    ("Óptico (PON)", [
        ("RX", [PON + "RXPower", PON + "OpticalTransceiver.RXPower"]),
        ("TX", [PON + "TXPower", PON + "OpticalTransceiver.TXPower"]),
        ("Temperatura", [PON + "TransceiverTemperature", PON + "OpticalTransceiver.Temperature"]),
        ("Tensão", [PON + "SupplyVoltage", PON + "OpticalTransceiver.Vcc"]),
        ("Corrente laser", [PON + "BiasCurrent", PON + "OpticalTransceiver.TXBias"]),
        ("Status PON", [PON + "Status"]),
    ]),
    ("WAN", [
        ("Status", [PPP + "ConnectionStatus", IPC + "ConnectionStatus"]),
        ("IP", [PPP + "ExternalIPAddress", IPC + "ExternalIPAddress"]),
        ("Usuário PPPoE", [PPP + "Username"]),
        ("Lista de serviço", [PPP + "X_ZTE-COM_ServiceList", IPC + "X_ZTE-COM_ServiceList"]),
        ("VLAN", [PPP + "X_ZTE-COM_VLANID", IPC + "X_ZTE-COM_VLANID"]),
        ("Uptime WAN", [PPP + "Uptime", IPC + "Uptime"]),
    ]),
    ("Wi-Fi (geral)", [
        ("Bandsteering (2.4+5 unificados)", [IGD + "X_ZTE-COM_Bandsteering.Enable",
                                             IGD + "LANDevice.{i}.WIFI.BANDSTEER.BandSteeringEnable",
                                             IGD + "LANDevice.{i}.X_ZTE-COM_BandSteering.Enable"]),
        ("Wi-Fi 6: WPA3", [WLAN + "WPA3AuthenticationMode"]),
        ("Wi-Fi 6: OFDMA", [WLAN + "X_ZTE-COM_DownLinkOFDMAEnable"]),
        ("Wi-Fi 6: TWT", [WLAN + "X_ZTE-COM_TWTSupport"]),
    ]),
    ("Wi-Fi (rádio/SSID)", [
        ("Faixa (2.4/5)", [WLAN + "X_ZTE-COM_OperatingFrequencyBand", WLAN + "X_ZTE-COM_RFBand", WLAN + "Standard"]),
        ("Padrão (ax = Wi-Fi 6)", [WLAN + "Standard"]),
        ("Rádio ligado", [WLAN + "RadioEnabled"]),
        ("SSID", [WLAN + "SSID"]),
        ("Senha (escrita)", [WLAN + "KeyPassphrase", WLAN + "PreSharedKey.{i}.KeyPassphrase"]),
        ("Canal", [WLAN + "Channel"]),
        ("Canal automático", [WLAN + "AutoChannelEnable"]),
        ("Largura configurada", [WLAN + "BandWidth", WLAN + "X_ZTE-COM_BandWidth"]),
        ("Largura em operação", [WLAN + "X_ZTE-COM_OperatingChannelBandwidth"]),
        ("Status", [WLAN + "Status"]),
        ("Nº clientes", [WLAN + "TotalAssociations"]),
    ]),
    ("Wi-Fi (cliente associado)", [
        ("MAC", [ASSOC + "AssociatedDeviceMACAddress", ASSOC + "X_ZTE-COM_MACAddress"]),
        ("IP", [ASSOC + "AssociatedDeviceIPAddress"]),
        ("Nome", [ASSOC + "X_ZTE-COM_AssociatedDeviceName", ASSOC + "X_ZTE-COM_DeviceName"]),
        ("RSSI", [ASSOC + "AssociatedDeviceRssi", ASSOC + "X_ZTE-COM_RSSI", ASSOC + "X_ZTE-COM_Rssi",
                  ASSOC + "X_ZTE-COM_WLAN_RSSI", ASSOC + "X_ZTE-COM_SignalStrength", ASSOC + "X_ZTE-COM_SigalStrength"]),
        ("Taxa", [ASSOC + "LastDataTransmitRate", ASSOC + "AssociatedDeviceRate"]),
        ("Tempo conectado", [ASSOC + "X_ZTE-COM_StayTime", ASSOC + "X_ZTE-COM_UpTime", ASSOC + "X_ZTE-COM_Uptime"]),
    ]),
    ("DHCP / hosts LAN", [
        ("Hostname", [HOST + "HostName"]),
        ("IP", [HOST + "IPAddress"]),
        ("MAC", [HOST + "MACAddress"]),
        ("Interface (Wi-Fi/cabo)", [HOST + "InterfaceType"]),
        ("Ativo", [HOST + "Active"]),
        ("Origem (DHCP/estático)", [HOST + "AddressSource"]),
        ("Lease restante", [HOST + "LeaseTimeRemaining"]),
    ]),
])


def norm(path):
    return re.sub(r"\.\d+(?=\.|$)", ".{i}", path)


def load_samples():
    samples = []
    for f in sorted(glob.glob(str(ROOT / "samples" / "*.anon.json"))):
        d = json.load(open(f, encoding="utf-8"))
        meta = d.pop("_meta", {})
        by_norm = collections.defaultdict(list)
        for p, item in d.items():
            if not item.get("obj"):
                by_norm[norm(p)].append((p, item))
        name = os.path.basename(f).replace(".anon.json", "")
        samples.append({"name": name, "file": os.path.basename(f), "meta": meta, "raw": d, "norm": by_norm})
    return samples


def val(s, path):
    item = s["raw"].get(path)
    return None if item is None else item.get("v")


def first(s, npath):
    items = s["norm"].get(npath) or []
    return items[0][1] if items else None


def short(s):
    model = val(s, IGD + "DeviceInfo.ModelName") or s["name"]
    return model.replace("ZXHN ", "")


def radios(s):
    """Lista (instância, faixa, como foi deduzida, canal, habilitado, padrão)."""
    out = []
    insts = sorted({int(m.group(1)) for p in s["raw"]
                    for m in [re.match(r"InternetGatewayDevice\.LANDevice\.1\.WLANConfiguration\.(\d+)\.SSID$", p)] if m})
    for i in insts:
        base = f"{IGD}LANDevice.1.WLANConfiguration.{i}."
        band, how = None, None
        for field in ("X_ZTE-COM_OperatingFrequencyBand", "X_ZTE-COM_RFBand"):
            v = val(s, base + field)
            if v:
                band, how = ("5" if str(v).startswith("5") else "2.4"), field
                break
        std = val(s, base + "Standard") or ""
        if not band and std:
            band, how = ("5" if re.search(r"\ba\b|ac", std) else "2.4"), "Standard"
        out.append((i, band or "?", how or "-", val(s, base + "Channel"), val(s, base + "Enable"), std))
    return out


def render(samples):
    cols = [short(s) + "<br>" + str(val(s, IGD + "DeviceInfo.SoftwareVersion")) for s in samples]
    L = ["# Modelos e caminhos TR-069",
         "",
         "> Gerado por `scripts/compare_samples.py` a partir de `samples/*.anon.json`. Não edite à mão.",
         "",
         "## Inventário",
         "",
         "| Modelo | Firmware | Hardware | Tipo | WAN | Wi-Fi | Parâmetros | Sample |",
         "|---|---|---|---|---|---|---|---|"]
    for s in samples:
        access = val(s, IGD + "WANDevice.1.WANCommonInterfaceConfig.WANAccessType") or ""
        pon = any(k.startswith(PON) for k in s["norm"])
        tipo = "ONU GPON" if pon else "Roteador"
        stds = " ".join(str(val(s, f"{IGD}LANDevice.1.WLANConfiguration.{i}.Standard") or "") for i in (1, 5))
        wifi = "6 (ax)" if "ax" in stds else ("5 (ac)" if "ac" in stds else "4 (n)")
        L.append(f"| {short(s)} | {val(s, IGD + 'DeviceInfo.SoftwareVersion')} | {val(s, IGD + 'DeviceInfo.HardwareVersion')} "
                 f"| {tipo} | {access} | {wifi} | {s['meta'].get('parametros', '')} | [{s['file']}](../samples/{s['file']}) |")

    L += ["", "## Rádios Wi-Fi por modelo", "",
          "Faixa deduzida de `X_ZTE-COM_OperatingFrequencyBand`/`X_ZTE-COM_RFBand` ou, na falta, de `Standard`.", ""]
    for s in samples:
        rs = radios(s)
        desc = ", ".join(f"{i}={b}{'*' if en else ''}" for i, b, _, _, en, _ in rs)
        hows = sorted({h for _, _, h, _, _, _ in rs})
        L.append(f"- **{short(s)}** ({len(rs)} SSIDs; `*` = habilitado; faixa via {', '.join(hows)}): {desc}")

    for section, rows in CONCEPTS.items():
        L += ["", f"## {section}", "",
              "Cada célula: qual candidato existe (número = posição na lista de candidatos) e o tipo.", "",
              "| Informação | Candidatos | " + " | ".join(cols) + " |",
              "|---|---|" + "---|" * len(samples)]
        for label, cands in rows:
            cand_txt = "<br>".join(f"{n}. `{c.replace(IGD, '').replace('LANDevice.{i}.', '')}`"
                                   for n, c in enumerate(cands, 1))
            cells = []
            for s in samples:
                found = [f"{n} ({first(s, c).get('t', '').replace('xsd:', '')})"
                         for n, c in enumerate(cands, 1) if first(s, c)]
                cells.append(", ".join(found) if found else "—")
            L.append(f"| {label} | {cand_txt} | " + " | ".join(cells) + " |")
    return "\n".join(L) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()
    md = render(load_samples())
    if args.stdout:
        print(md)
    else:
        out = ROOT / "docs" / "MODELOS.md"
        out.write_text(md, encoding="utf-8", newline="\n")
        print(f"escrito {out.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
