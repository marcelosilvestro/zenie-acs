#!/usr/bin/env python3
"""Exporta a árvore de parâmetros de um dispositivo (NBI) para samples/.

Gera dois arquivos, ambos "achatados" (um caminho por linha, ordenados):
  samples/<modelo>_<firmware>.json       completo — NÃO vai para o git (.gitignore)
  samples/<modelo>_<firmware>.anon.json  anonimizado — este sim é versionado

Formato: {"caminho": {"v": valor, "t": "xsd:tipo", "w": gravável}, ...}
Objetos (nós sem valor) aparecem com "obj": true.

Antes de exportar, peça a árvore completa à CPE (uma vez):
  POST /devices/<id>/tasks?connection_request  {"name":"refreshObject","objectName":"InternetGatewayDevice"}

Uso:
  python3 scripts/export_sample.py <device_id> [--nbi URL] [--out DIR]
  python3 scripts/export_sample.py --from-file samples/<modelo>_<fw>.json   # só reanonimiza (sem NBI)

Anonimização (o .anon.json vai para o git, que pode ficar público):
  - por campo: senhas, usuários (PPPoE), SSID (inclusive VPs), hostnames, números de série (só o prefixo)
  - em qualquer texto, inclusive JSON de virtual parameters: MAC (fica o OUI), IPv6 global/link-local
    (vira 2001:db8::/32, mantendo /64 e /56), IPv4 público (vira 203.0.113.x); privados e CGNAT ficam
  - valores sensíveis achados nos campos são apagados onde reaparecerem
"""

import argparse
import ipaddress
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Regras de anonimização por nome do parâmetro (último segmento do caminho).
SECRET = re.compile(r"(Password|Passphrase|PreSharedKey|WEPKey|KeyPassphrase|Secret|Key\d?)$", re.I)
USERNAME = re.compile(r"(Username|UserName)$")
MAC = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
HOSTNAME = re.compile(r"(HostName|DeviceName|AssociatedDeviceName)$")
# WLANConfiguration.N.Name repete o SSID em algumas ZTE (ex.: F670L V9).
# Qualquer campo terminado em SSID (WLAN, VPs, X_TP_MESH_WIFI.PrimarySSID/GuestNSSID...) e o Name do WLAN da ZTE.
SSID = re.compile(r"(SSID|WLANConfiguration\.\d+\.Name|SSIDAdvertisementName)$")
# Números de série (de fábrica e PON): fica só o prefixo (fabricante), o resto é mascarado.
SERIAL = re.compile(r"(SerialNumber|PonSerial|PONSerial|SerialNum)$", re.I)
# MAC dentro de qualquer texto (ex.: JSON de virtual parameters).
MAC_ANY = re.compile(r"(?i)\b([0-9a-f]{2})([:-])([0-9a-f]{2})\2([0-9a-f]{2})\2[0-9a-f]{2}\2[0-9a-f]{2}\2[0-9a-f]{2}\b")
# Candidatos a endereço IP dentro de texto (validados com ipaddress).
IP_TOKEN = re.compile(r"[0-9A-Fa-f:.]*[:.][0-9A-Fa-f:.]*")
# Valores menores que isso não entram na varredura por conteúdo (evita apagar "1", "ACS"...).
MIN_SCRUB_LEN = 4


def flatten(node, prefix, out):
    for key, child in node.items():
        if key.startswith("_") or not isinstance(child, dict):
            continue
        path = prefix + key
        if "_value" in child:
            value = child["_value"]
            out[path] = {"v": value, "t": child.get("_type"), "w": child.get("_writable")}
        elif child.get("_object"):
            out[path] = {"obj": True, "w": child.get("_writable")}
        flatten(child, path + ".", out)


class IpMasker:
    """IPv6 global/link-local -> 2001:db8:0:N:: (mesmo /64 = mesmo N; mesma interface = mesmo ::M);
    IPv4 público -> 203.0.113.N. Privados, CGNAT (100.64/10), ULA (fd00::) e loopback ficam."""

    def __init__(self):
        self.nets = {}
        self.iids = {}
        self.v4 = {}

    def ip(self, token):
        try:
            addr = ipaddress.ip_address(token)
        except ValueError:
            return token
        if addr.version == 4:
            if not addr.is_global:
                return token
            return self.v4.setdefault(token, f"203.0.113.{len(self.v4) + 1}")
        if not (addr.is_global or addr.is_link_local):
            return token
        value = int(addr)
        prefix, iid = value >> 64, value & ((1 << 64) - 1)
        new_iid = self.iids.setdefault(iid, len(self.iids) + 1) if iid else 0
        if addr.is_link_local:
            return str(ipaddress.IPv6Address((0xFE80 << 112) | new_iid))
        n = self.nets.setdefault(prefix, len(self.nets) + 1)
        return str(ipaddress.IPv6Address((0x20010DB8 << 96) | (n << 64) | new_iid))

    def text(self, s):
        s = MAC_ANY.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}{m.group(2)}{m.group(4)}{m.group(2)}xx{m.group(2)}xx{m.group(2)}xx", s)
        return IP_TOKEN.sub(lambda m: self.ip(m.group(0)), s)


def anonymize(flat):
    """Duas passadas: (1) mascara por nome do campo e coleta os valores sensíveis;
    (2) apaga esses valores onde quer que reapareçam (outros campos repetem SSID,
    usuário PPPoE, hostname...)."""
    anon = {}
    hosts = {}
    sensitive = set()
    for path, item in flat.items():
        item = dict(item)
        v = item.get("v")
        if isinstance(v, str) and v.strip():
            original = v.strip()
            if SECRET.search(path):
                item["v"] = "***"
            elif USERNAME.search(path) and "ManagementServer" not in path:
                item["v"] = "usuario-anon"
                sensitive.add(original)
                # Partes do usuário PPPoE ("maria_souza2" -> "maria", "souza") pegam
                # variações como "Maria Souza" em outros campos.
                sensitive.update(t for t in re.split(r"[^A-Za-z]+", original) if len(t) >= MIN_SCRUB_LEN)
            elif SSID.search(path):
                item["v"] = "SSID-anon"
                sensitive.add(original)
            elif HOSTNAME.search(path):
                item["v"] = hosts.setdefault(v, f"host-{len(hosts) + 1}")
                sensitive.add(original)
            elif SERIAL.search(path) and len(original) > 4:
                item["v"] = original[:4] + "*" * (len(original) - 4)
                sensitive.add(original)
            elif MAC.match(v):
                # Mantém o OUI (identifica o fabricante), mascara o resto.
                item["v"] = v[:8] + ":xx:xx:xx"
        anon[path] = item

    needles = sorted((s for s in sensitive if len(s) >= MIN_SCRUB_LEN), key=len, reverse=True)
    ips = IpMasker()
    for path, item in anon.items():
        v = item.get("v")
        if not isinstance(v, str):
            continue
        if any(n.lower() in v.lower() for n in needles):
            item["v"] = "anon"
        else:
            item["v"] = ips.text(v)
    return anon


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("device_id", nargs="?")
    parser.add_argument("--from-file", help="reanonimiza uma amostra completa já exportada (não consulta a NBI)")
    parser.add_argument("--nbi", default=os.environ.get("GENIEACS_NBI_URL", "http://127.0.0.1:7557"))
    parser.add_argument("--out", default=str(ROOT / "samples"))
    args = parser.parse_args()

    if args.from_file:
        src = Path(args.from_file)
        data = json.loads(src.read_text(encoding="utf-8"))
        meta = data.pop("_meta", {})
        if meta.get("deviceId"):
            meta["deviceId"] = {**meta["deviceId"], "_SerialNumber": "anon"}
        anon_path = src.with_name(src.name[: -len(".json")] + ".anon.json")
        anon_path.write_text(json.dumps({"_meta": meta, **anonymize(data)}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"reanonimizado: {anon_path.name}")
        return
    if not args.device_id:
        parser.error("informe o device_id ou --from-file")

    query = urllib.parse.quote(json.dumps({"_id": args.device_id}))
    with urllib.request.urlopen(f"{args.nbi.rstrip('/')}/devices/?query={query}", timeout=60) as resp:
        devices = json.load(resp)
    if not devices:
        raise SystemExit(f"dispositivo não encontrado: {args.device_id}")
    device = devices[0]

    flat = {}
    flatten(device, "", flat)
    flat = dict(sorted(flat.items()))

    def val(path):
        return str(flat.get(path, {}).get("v") or "desconhecido")

    root = "InternetGatewayDevice" if any(p.startswith("InternetGatewayDevice.") for p in flat) else "Device"
    model = val(f"{root}.DeviceInfo.ModelName")
    if model == "desconhecido":
        model = device.get("_deviceId", {}).get("_ProductClass", "desconhecido")
    firmware = val(f"{root}.DeviceInfo.SoftwareVersion")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", f"{model}_{firmware}")
    if root == "Device":
        name += "_tr181"  # mesmo equipamento pode ter amostra TR-098 e TR-181

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = {
        "_meta": {
            "deviceId": device.get("_deviceId"),
            "lastInform": device.get("_lastInform"),
            "root": root,
            "parametros": sum(1 for i in flat.values() if "v" in i),
        }
    }
    full_path = out / f"{name}.json"
    anon_path = out / f"{name}.anon.json"
    full_path.write_text(json.dumps({**meta, **flat}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    meta["_meta"]["deviceId"] = {**meta["_meta"]["deviceId"], "_SerialNumber": "anon"}
    anon_path.write_text(json.dumps({**meta, **anonymize(flat)}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{meta['_meta']['parametros']} parâmetros -> {full_path.name} e {anon_path.name}")


if __name__ == "__main__":
    main()
