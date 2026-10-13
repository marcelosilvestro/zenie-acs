"""Testes do zenie-hostd (validação e geração dos arquivos de rede) — não tocam na rede.

    python3 deploy/hostd/test_hostd.py
"""

import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("hostd", Path(__file__).with_name("zenie-hostd.py"))
hostd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hostd)

# Interfaces "vivas" simuladas: uma placa física (a da VM de teste) e uma segunda.
hostd.live_interfaces = lambda: [
    {"name": "ens192", "vlan": None, "addresses": ["10.0.0.10/30"], "dhcp": False},
    {"name": "ens224", "vlan": None, "addresses": [], "dhcp": False},
]

BASE = {"name": "ens192", "mode": "static", "address": "10.0.0.10/30", "gateway": "10.0.0.9"}


def refused(cfg):
    try:
        hostd.validate(cfg)
    except hostd.Refused as e:
        return str(e)
    return None


class Validate(unittest.TestCase):
    def test_config_da_vm_de_teste(self):
        cfg = hostd.validate({"interfaces": [BASE], "dns": ["10.0.0.53", "8.8.8.8"]})
        self.assertEqual(cfg["interfaces"][0]["gateway"], "10.0.0.9")
        self.assertEqual(cfg["dns"], ["10.0.0.53", "8.8.8.8"])

    def test_vlan(self):
        cfg = hostd.validate({"interfaces": [BASE, {"parent": "ens192", "vlan": 100, "mode": "static", "address": "10.100.0.2/24"}]})
        self.assertEqual(cfg["interfaces"][1]["name"], "ens192.100")

    def test_recusas(self):
        self.assertIn("gateway", refused({"interfaces": [{**BASE, "gateway": "10.0.0.1"}]}))
        self.assertIn("só uma", refused({"interfaces": [BASE, {"name": "ens224", "mode": "static", "address": "192.168.50.2/24", "gateway": "192.168.50.1"}]}))
        self.assertIn("desconhecida", refused({"interfaces": [{**BASE, "name": "eth9; rm -rf /"}]}))
        self.assertIn("inexistente", refused({"interfaces": [BASE, {"parent": "ens999", "vlan": 10, "mode": "dhcp"}]}))
        self.assertIn("4094", refused({"interfaces": [BASE, {"parent": "ens192", "vlan": 5000, "mode": "dhcp"}]}))
        self.assertIn("sobrepõe", refused({"interfaces": [BASE, {"name": "ens224", "mode": "static", "address": "10.0.0.9/24"}]}))
        self.assertIn("endereço inválido", refused({"interfaces": [{**BASE, "address": "10.0.0.10"}]}))
        self.assertIn("DNS", refused({"interfaces": [BASE], "dns": ["8.8.8.8; reboot"]}))
        self.assertIn("repetida", refused({"interfaces": [BASE, BASE]}))
        self.assertIn("não pode ser usado", refused({"interfaces": [{**BASE, "address": "10.0.0.0/24", "gateway": None}]}))


class Render(unittest.TestCase):
    def test_ifupdown(self):
        cfg = hostd.validate({"interfaces": [BASE, {"parent": "ens192", "vlan": 100, "mode": "static", "address": "10.100.0.2/24"}], "dns": ["10.0.0.53"]})
        text = hostd.render_ifupdown(cfg)
        self.assertIn("auto ens192\niface ens192 inet static\n\taddress 10.0.0.10/30\n\tgateway 10.0.0.9\n\tdns-nameservers 10.0.0.53", text)
        self.assertIn("iface ens192.100 inet static\n\taddress 10.100.0.2/24\n\tvlan-raw-device ens192", text)
        self.assertIn("source /etc/network/interfaces.d/*", text)
        self.assertEqual(hostd.ifupdown_names(text), ["lo", "ens192", "ens192.100"])

    def test_so_mexe_no_que_mudou(self):
        # Arquivo original da VM de teste (Debian 13): mesmo bloco gerado pelo Zenie = interface não é tocada.
        original = (
            "source /etc/network/interfaces.d/*\n\nauto lo\niface lo inet loopback\n\n"
            "allow-hotplug ens192\niface ens192 inet static\n\taddress 10.0.0.10/30\n\tgateway 10.0.0.9\n"
            "\t# dns-* options are implemented by the resolvconf package, if installed\n\tdns-nameservers 10.0.0.53 8.8.8.8\n"
        )
        cfg = hostd.validate({"interfaces": [BASE, {"parent": "ens192", "vlan": 999, "mode": "static", "address": "10.255.255.1/30"}], "dns": ["10.0.0.53", "8.8.8.8"]})
        old, new = hostd.ifupdown_stanzas(original), hostd.ifupdown_stanzas(hostd.render_ifupdown(cfg))
        self.assertEqual(old["ens192"], new["ens192"])
        self.assertNotIn("ens192.999", old)

    def test_netplan_json_e_yaml_valido(self):
        cfg = hostd.validate({"interfaces": [{"name": "ens224", "mode": "dhcp"}, {"parent": "ens192", "vlan": 20, "mode": "static", "address": "10.20.0.2/24", "gateway": "10.20.0.1"}], "dns": ["1.1.1.1"]})
        net = json.loads(hostd.render_netplan(cfg))["network"]
        self.assertEqual(net["ethernets"]["ens224"]["dhcp4"], True)
        self.assertEqual(net["ethernets"]["ens192"], {"dhcp4": False})  # pai da VLAN declarado
        self.assertEqual(net["vlans"]["ens192.20"]["id"], 20)
        self.assertEqual(net["vlans"]["ens192.20"]["routes"], [{"to": "default", "via": "10.20.0.1"}])

    def test_aviso_da_rota_na_cloudflare(self):
        # Linhas reais do cloudflared (VM de teste, 13/10/2026), resumidas.
        def err(svc, why):
            return f'cloudflared-1  | 2026-10-13T15:10:14Z ERR  error="Unable to reach the origin service. {why}" connIndex=3 event=1 ingressRule=0 originService={svc}'

        def cfg(svc, extra=""):
            return ('cloudflared-1  | 2026-10-13T15:10:27Z INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"zenie.example.com\\", '
                    f'\\"originRequest\\":{{{extra}}}, \\"service\\":\\"{svc}\\"}}, {{\\"service\\":\\"http_status:404\\"}}]}}" version=5')
        local = [err("https://localhost:443", "dial tcp [::1]:443: connect: connection refused")] * 3
        self.assertEqual(hostd.origin_problem("\n".join(local))["kind"], "localhost")
        tls = [cfg("https://zenie-web")] + [err("https://zenie-web", "x509: certificate is valid for localhost, not zenie-web")] * 2
        self.assertEqual(hostd.origin_problem("\n".join(tls))["kind"], "tls")
        # Caso do usuário: erros com http://zenie-web e depois a rota corrigida (https + No TLS Verify) -> sem aviso.
        fixed = [cfg("http://zenie-web")] + [err("http://zenie-web", "lookup zenie-web: no such host")] * 4 + [cfg("https://zenie-web", '\\"noTLSVerify\\":true')]
        self.assertIsNone(hostd.origin_problem("\n".join(fixed)))
        # Uma falha só (zenie-web sendo recriado num update) não vira aviso.
        self.assertIsNone(hostd.origin_problem(err("https://zenie-web", "no such host")))

    def test_servidores_ntp(self):
        self.assertEqual(hostd.valid_servers(["A.ST1.NTP.BR", "200.160.0.8", "a.st1.ntp.br"]), ["a.st1.ntp.br", "200.160.0.8"])
        for bad in (["ntp; rm -rf /"], ["-x.ntp.br"], ["localhost"], [], ["a.ntp.br"] * 6):
            with self.assertRaises(hostd.Refused):
                hostd.valid_servers(bad)

    def test_token_do_tunel(self):
        tok = "eyJhIjoiYWJjZGVmIiwidCI6IjEyMzQ1Njc4LTEyMzQtMTIzNC0xMjM0LTEyMzQ1Njc4OTAxMiIsInMiOiJzZWNyZXQifQ=="
        self.assertEqual(hostd.tunnel_token(f"sudo cloudflared service install {tok}"), tok)
        self.assertEqual(hostd.tunnel_token(tok), tok)
        with self.assertRaises(hostd.Refused):
            hostd.tunnel_token("abc; rm -rf /")


if __name__ == "__main__":
    unittest.main(verbosity=1)
