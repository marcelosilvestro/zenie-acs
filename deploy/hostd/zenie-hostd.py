#!/usr/bin/env python3
"""zenie-hostd — agente do host para a tela Configurações do Zenie (rede e túnel Cloudflare).

O painel roda em containers, sem acesso ao servidor. Este agente (systemd, root) atende a API por um socket Unix
(/run/zenie/hostd.sock, montado só no container zenie-api) e aceita uma lista FECHADA de comandos, com validação
rígida — nada de texto livre para o shell:

  network.get                 interfaces, endereços, gateway, DNS, backend e mudança pendente
  network.apply   {config}    grava e aplica a rede; reverte sozinho se não for confirmada em CONFIRM_SECONDS
  network.confirm {token}     confirma a mudança (cancela a reversão)
  tunnel.get                  túnel Cloudflare: ligado, token (só o final), situação do container
  tunnel.set {enabled,token}  liga/desliga o container cloudflared (token no .env, permissão 600)
  time.get                    fuso, sincronização, servidores NTP (chrony ou systemd-timesyncd) e fonte em uso
  time.set {timezone,servers} grava fuso e/ou servidores NTP
  time.test {server}          consulta SNTP direta a um servidor (não mexe no relógio)
  update.check {fetch}        versão instalada x a do GitHub no canal (releases = tags; main = ramo main)
  update.run {by}             roda o update.sh --yes como unidade do systemd (zenie-update), fora do agente
  update.status               andamento: etapas, log (sem segredos) e código de saída
  acslog.read {since}         linhas JSON novas do log do genieacs-cwmp (para o "Log do ACS" do painel)

Linha de comando: "zenie-hostd.py time-default" (instalador) põe o NTP.br se o Zenie ainda não configurou o NTP.

Backends de rede: ifupdown (Debian, /etc/network/interfaces) e netplan (Ubuntu, /etc/netplan). Uma requisição por
conexão: uma linha JSON de entrada, uma linha JSON de saída. Só biblioteca padrão do Python 3.
"""

import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ZENIE_DIR = Path(os.environ.get("ZENIE_DIR", "/opt/zenie"))
ENV_FILE = ZENIE_DIR / ".env"
SOCKET_DIR = Path("/run/zenie")
SOCKET_PATH = SOCKET_DIR / "hostd.sock"
STATE_DIR = Path("/var/lib/zenie-hostd")
PENDING_FILE = STATE_DIR / "pending.json"
# Grupo exclusivo do socket: só o container zenie-api o recebe (group_add no docker-compose). Nenhum usuário do
# host tem esse GID — dono por UID seria o uid 1000, que no host costuma ser uma pessoa.
API_GID = int(os.environ.get("ZENIE_HOSTD_GID", "47547"))
CONFIRM_SECONDS = 120
APPLY_DELAY = 2  # responde à API antes de mexer na rede (a resposta ainda sai pelo endereço antigo)
IFUPDOWN_FILE = Path("/etc/network/interfaces")
NETPLAN_DIR = Path("/etc/netplan")
NETPLAN_FILE = NETPLAN_DIR / "01-zenie.yaml"
RESOLV = Path("/etc/resolv.conf")
IGNORED_IF = re.compile(r"^(lo|docker\d*|br-.*|veth.*|virbr.*|tun\d*|tap.*|wg\d*)$")
IFNAME = re.compile(r"^[A-Za-z0-9_-]{1,12}$")
TUNNEL_TOKEN = re.compile(r"^eyJ[A-Za-z0-9+/=_-]{60,4000}$")

lock = threading.Lock()
timer = None


class Refused(Exception):
    """Pedido recusado (validação): a mensagem vai para a tela."""


def run(cmd, timeout=60, check=True):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}: {(r.stderr or r.stdout).strip()[:300]}")
    return r


def log(msg):
    print(msg, flush=True)


# ------------------------------------------------------------------------------------------------ rede: leitura

def backend():
    if shutil.which("netplan") and NETPLAN_DIR.is_dir() and any(NETPLAN_DIR.glob("*.yaml")):
        return "netplan"
    if shutil.which("ifup") and IFUPDOWN_FILE.exists():
        return "ifupdown"
    return None


def vlan_info():
    """{nome: (pai, id)} das VLANs existentes (/proc/net/vlan/config)."""
    out = {}
    try:
        for line in Path("/proc/net/vlan/config").read_text().splitlines()[2:]:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) == 3:
                out[parts[0]] = (parts[2], int(parts[1]))
    except OSError:
        pass
    return out


def live_interfaces():
    addrs = json.loads(run(["ip", "-j", "addr", "show"]).stdout or "[]")
    vlans = vlan_info()
    out = []
    for a in addrs:
        name = a.get("ifname", "")
        if IGNORED_IF.match(name):
            continue
        v4 = [x for x in a.get("addr_info", []) if x.get("family") == "inet"]
        out.append({
            "name": name,
            "mac": a.get("address"),
            "state": a.get("operstate"),
            "vlan": {"parent": vlans[name][0], "id": vlans[name][1]} if name in vlans else None,
            "addresses": [f"{x['local']}/{x['prefixlen']}" for x in v4],
            "dhcp": any(x.get("dynamic") for x in v4),
        })
    return out


def live_gateway():
    for r in json.loads(run(["ip", "-j", "route", "show", "default"]).stdout or "[]"):
        if r.get("gateway"):
            return {"address": r["gateway"], "dev": r.get("dev")}
    return None


def live_dns():
    for f in (Path("/run/systemd/resolve/resolv.conf"), RESOLV):
        try:
            servers = re.findall(r"^\s*nameserver\s+(\S+)", f.read_text(), re.M)
            servers = [s for s in servers if not s.startswith("127.")]
            if servers:
                return servers[:3]
        except OSError:
            continue
    return []


def network_get(_req):
    pending = read_pending()
    return {
        "backend": backend(),
        "interfaces": live_interfaces(),
        "gateway": live_gateway(),
        "dns": live_dns(),
        "pending": {"token": pending["token"], "deadline": pending["deadline"]} if pending else None,
        "confirmSeconds": CONFIRM_SECONDS,
    }


# ------------------------------------------------------------------------------------------------ rede: validação

def validate(cfg):
    """Config pedida -> lista normalizada. Recusa qualquer coisa fora do formato (nunca vira comando livre)."""
    if not isinstance(cfg, dict):
        raise Refused("configuração inválida")
    physical = {i["name"] for i in live_interfaces() if not i["vlan"]}
    items, names, nets = [], set(), []
    gateways = 0
    entries = cfg.get("interfaces")
    if not isinstance(entries, list) or not 1 <= len(entries) <= 16:
        raise Refused("informe de 1 a 16 interfaces")
    for e in entries:
        if not isinstance(e, dict):
            raise Refused("interface inválida")
        parent, vid = e.get("parent"), e.get("vlan")
        if vid is not None:
            if parent not in physical:
                raise Refused(f"VLAN sobre interface inexistente: {parent}")
            if not isinstance(vid, int) or not 1 <= vid <= 4094:
                raise Refused("VLAN deve ser de 1 a 4094")
            name = f"{parent}.{vid}"
        else:
            name = e.get("name")
            if not isinstance(name, str) or not IFNAME.match(name) or name not in physical:
                raise Refused(f"interface desconhecida: {name}")
        if name in names:
            raise Refused(f"interface repetida: {name}")
        names.add(name)
        mode = e.get("mode")
        item = {"name": name, "mode": mode, "parent": parent if vid is not None else None, "vlan": vid}
        if mode == "dhcp":
            pass
        elif mode == "static":
            try:
                if not re.match(r"^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$", str(e.get("address", ""))):
                    raise ValueError("sem máscara")  # IP sem /nn viraria /32 (sem rede, sem gateway)
                iface = ipaddress.IPv4Interface(e.get("address", ""))
            except ValueError:
                raise Refused(f"{name}: endereço inválido (use 192.168.0.10/24)")
            if iface.network.prefixlen < 8 or iface.ip in (iface.network.network_address, iface.network.broadcast_address) and iface.network.prefixlen < 31:
                raise Refused(f"{name}: endereço {iface} não pode ser usado")
            for other in nets:
                if iface.network.overlaps(other[1]):
                    raise Refused(f"{name}: a rede {iface.network} se sobrepõe à de {other[0]}")
            nets.append((name, iface.network))
            item["address"] = str(iface)
            gw = e.get("gateway") or None
            if gw:
                try:
                    gwa = ipaddress.IPv4Address(gw)
                except ValueError:
                    raise Refused(f"{name}: gateway inválido")
                if gwa not in iface.network or gwa == iface.ip:
                    raise Refused(f"{name}: o gateway {gwa} precisa estar na rede {iface.network}")
                item["gateway"] = str(gwa)
                gateways += 1
        else:
            raise Refused(f"{name}: modo deve ser static ou dhcp")
        items.append(item)
    if gateways > 1:
        raise Refused("só uma interface pode ter gateway padrão")
    dns = cfg.get("dns") or []
    if not isinstance(dns, list) or len(dns) > 3:
        raise Refused("informe até 3 servidores DNS")
    try:
        dns = [str(ipaddress.IPv4Address(d)) for d in dns if str(d).strip()]
    except ValueError:
        raise Refused("servidor DNS inválido")
    if not any(i["mode"] == "dhcp" or i.get("address") for i in items):
        raise Refused("o servidor precisa de pelo menos um endereço")
    return {"interfaces": items, "dns": dns}


# ------------------------------------------------------------------------------------------------ rede: geração

def render_ifupdown(cfg):
    lines = [
        "# Gerado pelo Zenie (Configurações > Redes). Edições manuais aqui são substituídas pela tela.",
        "source /etc/network/interfaces.d/*",
        "",
        "auto lo",
        "iface lo inet loopback",
    ]
    for i in sorted(cfg["interfaces"], key=lambda x: x["vlan"] is not None):
        lines += ["", f"auto {i['name']}", f"iface {i['name']} inet {i['mode']}"]
        if i["mode"] == "static":
            lines.append(f"\taddress {i['address']}")
            if i.get("gateway"):
                lines.append(f"\tgateway {i['gateway']}")
        if i["vlan"] is not None:
            lines.append(f"\tvlan-raw-device {i['parent']}")
        if cfg["dns"] and (i.get("gateway") or (i["mode"] == "dhcp" and i["vlan"] is None)):
            lines.append(f"\tdns-nameservers {' '.join(cfg['dns'])}")
    return "\n".join(lines) + "\n"


def render_netplan(cfg):
    """YAML do netplan escrito como JSON (YAML aceita JSON): sem depender do PyYAML."""
    eth, vlans = {}, {}
    for i in cfg["interfaces"]:
        d = {"dhcp4": i["mode"] == "dhcp"}
        if i["mode"] == "static":
            d["addresses"] = [i["address"]]
            if i.get("gateway"):
                d["routes"] = [{"to": "default", "via": i["gateway"]}]
        if cfg["dns"]:
            d["nameservers"] = {"addresses": cfg["dns"]}
        if i["vlan"] is None:
            eth[i["name"]] = d
        else:
            d.update({"id": i["vlan"], "link": i["parent"]})
            vlans[i["name"]] = d
    for i in cfg["interfaces"]:  # pai de VLAN precisa existir na seção ethernets
        if i["vlan"] is not None and i["parent"] not in eth:
            eth[i["parent"]] = {"dhcp4": False}
    net = {"version": 2, "renderer": "networkd", "ethernets": eth}
    if vlans:
        net["vlans"] = vlans
    return json.dumps({"network": net}, indent=2) + "\n"


def ifupdown_names(text):
    return re.findall(r"^\s*iface\s+(\S+)\s+inet", text, re.M)


# ------------------------------------------------------------------------------------------------ rede: aplicar e reverter

def snapshot(dest):
    """Copia a configuração de rede atual para dest (para reverter)."""
    dest.mkdir(parents=True, exist_ok=True)
    if IFUPDOWN_FILE.exists():
        shutil.copy2(IFUPDOWN_FILE, dest / "interfaces")
    if RESOLV.exists() and not RESOLV.is_symlink():
        shutil.copy2(RESOLV, dest / "resolv.conf")
    if NETPLAN_DIR.is_dir():
        (dest / "netplan").mkdir(exist_ok=True)
        for f in NETPLAN_DIR.glob("*.yaml"):
            shutil.copy2(f, dest / "netplan" / f.name)


def ifupdown_stanzas(text):
    """{interface: texto do bloco "iface ..." com as opções} — para mexer só no que mudou."""
    out, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^\s*iface\s+(\S+)\s+inet", line)
        if m:
            cur = m.group(1)
            out[cur] = [line.strip()]
        elif line.strip().startswith("#"):
            continue  # comentário não é configuração
        elif cur and line.startswith((" ", "\t")) and line.strip():
            out[cur].append(line.strip())
        elif line.strip():
            cur = None
    return {k: "\n".join(v) for k, v in out.items()}


def ifupdown_switch(old_text, new_text):
    """Derruba as interfaces que mudaram ou saíram e sobe as que mudaram ou entraram (VLANs por último ao subir).
    Interface com o bloco idêntico não é tocada (acrescentar uma VLAN não derruba a interface principal)."""
    old_s, new_s = ifupdown_stanzas(old_text), ifupdown_stanzas(new_text)
    changed = {n for n in set(old_s) | set(new_s) if old_s.get(n) != new_s.get(n) and n != "lo"}
    old = [n for n in ifupdown_names(old_text) if n in changed]
    new = [n for n in ifupdown_names(new_text) if n in changed]
    for name in [n for n in old if "." in n] + [n for n in old if "." not in n and n != "lo"]:
        run(["ifdown", "--force", name], check=False)
        run(["ip", "addr", "flush", "dev", name], check=False)
        if "." in name and name not in new:
            run(["ip", "link", "delete", name], check=False)
    for name in [n for n in new if "." not in n and n != "lo"] + [n for n in new if "." in n]:
        run(["ifup", name], check=False, timeout=90)


def write_dns(dns):
    if dns and RESOLV.exists() and not RESOLV.is_symlink() and not shutil.which("resolvconf"):
        RESOLV.write_text("# Gerado pelo Zenie (Configurações > Redes)\n" + "".join(f"nameserver {d}\n" for d in dns))


def restart_firewall():
    run(["systemctl", "try-restart", "zenie-firewall"], check=False)


def do_apply(cfg, kind):
    if kind == "ifupdown":
        old = IFUPDOWN_FILE.read_text()
        new = render_ifupdown(cfg)
        IFUPDOWN_FILE.write_text(new)
        write_dns(cfg["dns"])
        ifupdown_switch(old, new)
    else:
        pending_dir = STATE_DIR / "netplan-off"
        pending_dir.mkdir(parents=True, exist_ok=True)
        for f in NETPLAN_DIR.glob("*.yaml"):
            if f != NETPLAN_FILE:
                shutil.move(str(f), pending_dir / f.name)  # o netplan junta todos os arquivos: só o do Zenie fica
        NETPLAN_FILE.write_text(render_netplan(cfg))
        os.chmod(NETPLAN_FILE, 0o600)
        run(["netplan", "generate"])
        run(["netplan", "apply"], timeout=120)
    restart_firewall()


def do_restore(backup, kind):
    log(f"revertendo a rede a partir de {backup}")
    if kind == "ifupdown":
        current = IFUPDOWN_FILE.read_text()
        shutil.copy2(backup / "interfaces", IFUPDOWN_FILE)
        if (backup / "resolv.conf").exists():
            shutil.copy2(backup / "resolv.conf", RESOLV)
        ifupdown_switch(current, IFUPDOWN_FILE.read_text())
    else:
        for f in NETPLAN_DIR.glob("*.yaml"):
            f.unlink()
        for f in (backup / "netplan").glob("*.yaml"):
            shutil.copy2(f, NETPLAN_DIR / f.name)
        run(["netplan", "apply"], check=False, timeout=120)
    restart_firewall()


def read_pending():
    try:
        return json.loads(PENDING_FILE.read_text())
    except (OSError, ValueError):
        return None


def schedule_rollback(pending):
    global timer
    if timer:
        timer.cancel()
    delay = max(0, pending["deadline"] - time.time())
    timer = threading.Timer(delay, rollback_if_pending, args=(pending["token"],))
    timer.daemon = True
    timer.start()


def rollback_if_pending(token):
    with lock:
        p = read_pending()
        if not p or p["token"] != token:
            return
        try:
            do_restore(Path(p["backup"]), p["backend"])
        except Exception as e:  # noqa: BLE001 — registra e segue: o pendente sai para não tentar de novo em loop
            log(f"falha ao reverter: {e}")
        PENDING_FILE.unlink(missing_ok=True)
        log("mudança de rede não confirmada: configuração anterior restaurada")


def network_apply(req):
    kind = backend()
    if not kind:
        raise Refused("este sistema não usa ifupdown nem netplan: configure a rede pelo sistema")
    cfg = validate(req.get("config"))
    with lock:
        if read_pending():
            raise Refused("há uma mudança de rede aguardando confirmação: confirme ou espere a reversão")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = STATE_DIR / f"backup-{stamp}"
        snapshot(backup)
        token = secrets.token_hex(16)
        pending = {"token": token, "deadline": time.time() + CONFIRM_SECONDS + APPLY_DELAY, "backup": str(backup), "backend": kind}
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        PENDING_FILE.write_text(json.dumps(pending))
        schedule_rollback(pending)

    def later():
        time.sleep(APPLY_DELAY)
        with lock:
            try:
                do_apply(cfg, kind)
                log(f"rede aplicada ({kind}); aguardando confirmação até {time.ctime(pending['deadline'])}")
            except Exception as e:  # noqa: BLE001 — falhou no meio: volta já
                log(f"falha ao aplicar a rede: {e}")
                do_restore(backup, kind)
                PENDING_FILE.unlink(missing_ok=True)

    threading.Thread(target=later, daemon=True).start()
    return {"token": token, "deadline": pending["deadline"], "confirmSeconds": CONFIRM_SECONDS, "backend": kind, "config": cfg}


def network_confirm(req):
    with lock:
        p = read_pending()
        if not p:
            raise Refused("não há mudança de rede aguardando confirmação (o prazo pode ter acabado)")
        if not secrets.compare_digest(str(req.get("token", "")), p["token"]):
            raise Refused("código de confirmação não confere")
        PENDING_FILE.unlink(missing_ok=True)
        if timer:
            timer.cancel()
        # netplan: os arquivos tirados do caminho ficam guardados no backup; o desligado é descartado.
        shutil.rmtree(STATE_DIR / "netplan-off", ignore_errors=True)
    log("mudança de rede confirmada")
    return {"confirmed": True}


# ------------------------------------------------------------------------------------------------ túnel Cloudflare

def env_get(key):
    try:
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(key + "="):
                return line[len(key) + 1:]
    except OSError:
        pass
    return ""


def env_set(key, value):
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    out, found = [], False
    for line in lines:
        if line.startswith(key + "="):
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{key}={value}")
    tmp = ENV_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n")
    os.chmod(tmp, 0o600)
    tmp.replace(ENV_FILE)


def compose(*args, timeout=180):
    return run(["docker", "compose", "--project-directory", str(ZENIE_DIR), *args], timeout=timeout, check=False)


def profiles():
    return [p for p in env_get("COMPOSE_PROFILES").split(",") if p.strip()]


def tunnel_get(_req):
    token = env_get("ZENIE_TUNNEL_TOKEN")
    ps = compose("ps", "--all", "--format", "json", "cloudflared")
    state, connected = None, None
    try:
        rows = [json.loads(line) for line in ps.stdout.splitlines() if line.strip()]
        if rows:
            state = rows[0].get("State")
    except ValueError:
        pass
    origin_error = None
    if state == "running":
        r = compose("logs", "--tail", "200", "cloudflared")
        logs = r.stdout + r.stderr
        connected = len(re.findall(r"Registered tunnel connection", logs)) > 0
        # Serviço de origem mal configurado na Cloudflare (ex.: https://localhost:443 — dentro do container o
        # localhost é o próprio cloudflared). Só o endereço configurado sai daqui, nunca o log inteiro.
        origin_error = origin_problem(compose("logs", "--since", "3m", "cloudflared"))
    return {"enabled": "tunnel" in profiles(), "tokenSet": bool(token), "tokenHint": token[-6:] if token else None, "state": state, "connected": connected, "originError": origin_error}


def origin_problem(logs):
    """Erro da rota publicada na Cloudflare que ainda vale: só erros DEPOIS da última "Updated to new configuration"
    e do serviço configurado agora (erro de uma URL já corrigida não conta). Pelo menos 2, para não acusar uma falha
    passageira (ex.: o zenie-web sendo recriado num update). None = nada a avisar."""
    text = logs.stdout + logs.stderr if hasattr(logs, "stdout") else logs
    lines = text.splitlines()
    service = None
    start = 0
    for i, line in enumerate(lines):
        m = re.search(r'Updated to new configuration .*?\\"service\\":\\"([^"\\]+)\\"', line)
        if m:
            service, start = m.group(1), i + 1
    errs = []
    for line in lines[start:]:
        m = re.search(r"ERR .*originService=(\S+)", line)
        if m and (service is None or m.group(1) == service) and "Unable to reach the origin service" in line:
            errs.append((m.group(1), line))
    if len(errs) < 2:
        return None
    svc, line = errs[-1]
    if "x509" in line or "certificate" in line:
        kind = "tls"
    elif re.search(r"//(localhost|127\.0\.0\.1|\[::1\])", svc):
        kind = "localhost"
    else:
        kind = "inalcancavel"
    return {"service": svc[:200], "kind": kind}


def tunnel_token(text):
    """Aceita o token puro ou o comando inteiro copiado do painel da Cloudflare (pega a parte eyJ...)."""
    m = re.search(r"eyJ[A-Za-z0-9+/=_-]+", text or "")
    token = m.group(0) if m else (text or "").strip()
    if not TUNNEL_TOKEN.match(token):
        raise Refused("token inválido: cole o código de instalação do túnel (a parte que começa com eyJ)")
    return token


def tunnel_set(req):
    enabled = bool(req.get("enabled"))
    with lock:
        if req.get("token"):
            env_set("ZENIE_TUNNEL_TOKEN", tunnel_token(req["token"]))
        if enabled and not env_get("ZENIE_TUNNEL_TOKEN"):
            raise Refused("informe o token do túnel para ativar")
        ps = [p for p in profiles() if p != "tunnel"] + (["tunnel"] if enabled else [])
        env_set("COMPOSE_PROFILES", ",".join(ps))
        if enabled:
            r = compose("up", "-d", "--force-recreate", "cloudflared", timeout=300)
        else:
            compose("stop", "cloudflared")
            r = compose("rm", "-f", "cloudflared")
        if r.returncode != 0:
            raise Refused(f"docker compose falhou: {(r.stderr or r.stdout).strip()[-300:]}")
    return tunnel_get({})


# ------------------------------------------------------------------------------------------------ horário (fuso e NTP)

NTP_DEFAULT = ["a.st1.ntp.br", "b.st1.ntp.br", "c.st1.ntp.br", "d.st1.ntp.br"]  # NTP.br (padrão do Zenie)
NTP_HOST = re.compile(r"^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(\.(?!-)[A-Za-z0-9-]{1,63})+$")
CHRONY_CONF = Path("/etc/chrony/chrony.conf")
CHRONY_ZENIE = Path("/etc/chrony/sources.d/zenie.sources")
TIMESYNCD_ZENIE = Path("/etc/systemd/timesyncd.conf.d/zenie.conf")
CHRONY_MARK = "# zenie (desligado: os servidores NTP vêm de sources.d/zenie.sources): "


def ntp_daemon():
    if shutil.which("chronyc") and run(["systemctl", "is-active", "chrony"], check=False).stdout.strip() == "active":
        return "chrony"
    if run(["systemctl", "cat", "systemd-timesyncd"], check=False).returncode == 0:
        return "timesyncd"
    return None


def timezones():
    return run(["timedatectl", "list-timezones"]).stdout.split()


def ntp_servers(daemon):
    """(servidores, gerenciado pelo Zenie?)"""
    if daemon == "chrony":
        if CHRONY_ZENIE.exists():
            return re.findall(r"^\s*(?:server|pool)\s+(\S+)", CHRONY_ZENIE.read_text(), re.M), True
        try:
            return re.findall(r"^\s*(?:server|pool)\s+(\S+)", CHRONY_CONF.read_text(), re.M), False
        except OSError:
            return [], False
    if daemon == "timesyncd":
        if TIMESYNCD_ZENIE.exists():
            m = re.search(r"^NTP=(.*)$", TIMESYNCD_ZENIE.read_text(), re.M)
            return (m.group(1).split() if m else []), True
        out = run(["timedatectl", "show-timesync", "-p", "SystemNTPServers", "-p", "FallbackNTPServers"], check=False).stdout
        servers = []
        for line in out.splitlines():
            servers += line.split("=", 1)[1].split() if "=" in line else []
        return servers, False
    return [], False


def ntp_source(daemon):
    """Servidor em uso agora e a diferença do relógio (ms)."""
    if daemon == "chrony":
        out = run(["chronyc", "-n", "tracking"], check=False).stdout
        ref = re.search(r"Reference ID\s*:\s*\S+\s*\(([^)]*)\)", out)
        off = re.search(r"System time\s*:\s*([\d.]+) seconds (slow|fast)", out)
        stratum = re.search(r"Stratum\s*:\s*(\d+)", out)
        if not ref or ref.group(1) in ("", "0.0.0.0"):
            return None
        ms = float(off.group(1)) * 1000 * (-1 if off.group(2) == "slow" else 1) if off else None
        return {"server": ref.group(1), "offsetMs": ms, "stratum": int(stratum.group(1)) if stratum else None}
    if daemon == "timesyncd":
        out = run(["timedatectl", "timesync-status"], check=False).stdout
        srv = re.search(r"Server:\s*(\S+)(?:\s*\(([^)]*)\))?", out)
        off = re.search(r"Offset:\s*([+-]?[\d.]+)(us|ms|s)", out)
        stratum = re.search(r"Stratum:\s*(\d+)", out)
        if not srv:
            return None
        ms = None
        if off:
            ms = float(off.group(1)) * {"us": 0.001, "ms": 1, "s": 1000}[off.group(2)]
        return {"server": srv.group(2) or srv.group(1), "offsetMs": ms, "stratum": int(stratum.group(1)) if stratum else None}
    return None


def time_get(_req):
    daemon = ntp_daemon()
    servers, managed = ntp_servers(daemon)
    show = dict(line.split("=", 1) for line in run(["timedatectl", "show", "-p", "Timezone", "-p", "NTPSynchronized"]).stdout.splitlines() if "=" in line)
    return {
        "now": time.time(),
        "timezone": show.get("Timezone"),
        "synchronized": show.get("NTPSynchronized") == "yes",
        "daemon": daemon,
        "servers": servers,
        "managed": managed,
        "source": ntp_source(daemon),
        "defaults": NTP_DEFAULT,
        "timezones": timezones(),
    }


def valid_servers(servers):
    if not isinstance(servers, list) or not 1 <= len(servers) <= 5:
        raise Refused("informe de 1 a 5 servidores NTP")
    out = []
    for s in servers:
        s = str(s).strip().lower()
        try:
            out.append(str(ipaddress.IPv4Address(s)))
            continue
        except ValueError:
            pass
        if not NTP_HOST.match(s):
            raise Refused(f"servidor NTP inválido: {s}")
        out.append(s)
    return list(dict.fromkeys(out))


def apply_ntp(daemon, servers):
    if daemon == "chrony":
        CHRONY_ZENIE.parent.mkdir(parents=True, exist_ok=True)
        CHRONY_ZENIE.write_text("# Gerado pelo Zenie (Configurações > Horário)\n" + "".join(f"server {s} iburst\n" for s in servers))
        # Os pool/server do chrony.conf somariam aos do Zenie: ficam comentados (com marca, para dar para voltar).
        text = CHRONY_CONF.read_text()
        new = re.sub(r"^(\s*(?:pool|server)\s+.*)$", lambda m: CHRONY_MARK + m.group(1), text, flags=re.M)
        if new != text:
            shutil.copy2(CHRONY_CONF, STATE_DIR / "chrony.conf.antes-zenie")
            CHRONY_CONF.write_text(new)
        run(["systemctl", "restart", "chrony"])
        run(["chronyc", "burst", "4/4"], check=False)
    elif daemon == "timesyncd":
        TIMESYNCD_ZENIE.parent.mkdir(parents=True, exist_ok=True)
        TIMESYNCD_ZENIE.write_text("# Gerado pelo Zenie (Configurações > Horário)\n[Time]\nNTP=" + " ".join(servers) + "\nFallbackNTP=\n")
        run(["timedatectl", "set-ntp", "true"], check=False)
        run(["systemctl", "restart", "systemd-timesyncd"])
    else:
        raise Refused("o servidor não tem chrony nem systemd-timesyncd: instale um deles (apt install chrony)")


def time_set(req):
    with lock:
        tz = req.get("timezone")
        if tz is not None:
            if tz not in timezones():
                raise Refused(f"fuso horário desconhecido: {tz}")
            run(["timedatectl", "set-timezone", tz])
            if ENV_FILE.exists():
                env_set("TZ", tz)  # o install/update leem daqui (os containers trabalham em UTC)
        if req.get("servers") is not None:
            apply_ntp(ntp_daemon(), valid_servers(req["servers"]))
    return time_get({})


def sntp_query(server, timeout=3.0):
    """Consulta SNTP (RFC 4330) direta, sem mexer no relógio: diferença, atraso e estrato do servidor."""
    epoch = 2208988800  # 1900 -> 1970
    addr = socket.getaddrinfo(server, 123, socket.AF_INET, socket.SOCK_DGRAM)[0][4]
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        t1 = time.time()
        s.sendto(b"\x23" + 47 * b"\0", addr)  # LI 0, versão 4, modo 3 (cliente)
        data, _ = s.recvfrom(512)
        t4 = time.time()
    if len(data) < 48:
        raise ValueError("resposta curta")

    def ts(off):
        sec, frac = int.from_bytes(data[off:off + 4], "big"), int.from_bytes(data[off + 4:off + 8], "big")
        return sec - epoch + frac / 2**32

    t2, t3 = ts(32), ts(40)
    stratum = data[1]
    if stratum == 0:
        raise ValueError("o servidor respondeu 'kiss-of-death' (recusou a consulta)")
    return {"address": addr[0], "stratum": stratum, "offsetMs": round(((t2 - t1) + (t3 - t4)) / 2 * 1000, 2), "delayMs": round(((t4 - t1) - (t3 - t2)) * 1000, 2)}


def time_test(req):
    """Testa o servidor; nome com vários IPs (ex.: pool.ntp.br) vale se ALGUM responder (até 4, 2 s cada)."""
    server = valid_servers([req.get("server")])[0]
    try:
        addrs = list(dict.fromkeys(a[4][0] for a in socket.getaddrinfo(server, 123, socket.AF_INET, socket.SOCK_DGRAM)))[:4]
    except socket.gaierror:
        return {"server": server, "ok": False, "error": "nome não encontrado no DNS do servidor"}
    last = None
    for ip in addrs:
        try:
            r = sntp_query(ip, timeout=2.0 if len(addrs) > 1 else 3.0)
            return {"server": server, "ok": True, "tried": len(addrs), **r}
        except socket.timeout:
            last = "sem resposta (UDP 123 bloqueado ou servidor fora)"
        except (OSError, ValueError) as e:
            last = str(e)
    n = len(addrs)
    return {"server": server, "ok": False, "error": f"{last} — {n} endereço(s) testado(s): {', '.join(addrs)}"}


def time_default():
    """Instalação: NTP.br como padrão, se o Zenie ainda não configurou o NTP (não sobrescreve escolha do admin)."""
    daemon = ntp_daemon()
    if not daemon:
        print("zenie-hostd: sem chrony nem systemd-timesyncd — NTP não configurado")
        return
    if ntp_servers(daemon)[1]:
        print("zenie-hostd: NTP já configurado pelo Zenie — mantido")
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    apply_ntp(daemon, NTP_DEFAULT)
    print(f"zenie-hostd: NTP ({daemon}) -> {' '.join(NTP_DEFAULT)}")


# ------------------------------------------------------------------------------------------------ atualização do Zenie
#
# Canal (ZENIE_UPDATE_CHANNEL no .env): "releases" (padrão, produção) = só versões marcadas (tags vX.Y.Z);
# "main" (servidor de testes) = último commit do ramo main. A atualização em si é o update.sh --yes, rodado como
# unidade transitória do systemd (zenie-update): ela reinicia o painel e o próprio agente, então não pode ser filha
# dele. Log em UPDATE_LOG; código de saída em UPDATE_RC.

UPDATE_UNIT = "zenie-update"
UPDATE_LOG = Path("/var/log/zenie-update.log")
UPDATE_RC = STATE_DIR / "update.rc"
UPDATE_RUN = STATE_DIR / "update-run.json"
UPDATE_CHECK = STATE_DIR / "update-check.json"
TAG = re.compile(r"^v\d+\.\d+\.\d+$")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
SECRET_LINE = re.compile(r"(?i)(senha|password|token|secret)\s*[:=]\s*\S+")


def git(*args, timeout=120, check=True):
    return run(["git", "-C", str(ZENIE_DIR), *args], timeout=timeout, check=check)


def channel():
    c = env_get("ZENIE_UPDATE_CHANNEL") or "releases"
    return c if c in ("releases", "main") else "releases"


def update_check(req):
    """Compara a versão instalada com a do GitHub. O fetch (rede) só quando pedido ou na verificação diária; a
    comparação é sempre refeita na hora (local, instantânea) — senão, depois de atualizar, a tela mostraria a
    versão de antes."""
    ch = channel()
    fetched_at = None
    try:
        fetched_at = json.loads(UPDATE_CHECK.read_text()).get("checkedAt")
    except (OSError, ValueError):
        pass
    if req.get("fetch") or fetched_at is None:
        git("fetch", "--tags", "--prune", "--quiet", "origin", timeout=180)
        fetched_at = time.time()
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        UPDATE_CHECK.write_text(json.dumps({"checkedAt": fetched_at}))
    head = git("rev-parse", "HEAD").stdout.strip()
    current = {
        "commit": head[:7],
        "version": git("describe", "--tags", "--always", check=False).stdout.strip() or head[:7],
        "date": git("log", "-1", "--format=%cI").stdout.strip(),
    }
    if ch == "main":
        ref = "origin/main"
        label = "main"
        note = None
    else:
        tags = [t for t in git("tag", "-l", "v*", "--sort=-v:refname").stdout.split() if TAG.match(t)]
        ref = tags[0] if tags else None
        label = ref
        note = git("tag", "-l", "--format=%(contents)", ref, check=False).stdout.strip() if ref else None
    target, changes, available = None, [], False
    if ref:
        tcommit = git("rev-parse", f"{ref}^{{commit}}").stdout.strip()
        target = {"ref": label, "commit": tcommit[:7], "date": git("log", "-1", "--format=%cI", tcommit).stdout.strip(), "notes": note or None}
        ancestor = git("merge-base", "--is-ancestor", tcommit, head, check=False).returncode == 0
        available = tcommit != head and not ancestor
        if available:
            for line in git("log", "--format=%h|%cI|%s", "-n", "60", f"{head}..{tcommit}").stdout.splitlines():
                h, d, s = line.split("|", 2)
                changes.append({"commit": h, "date": d, "subject": s})
    dirty = bool(git("status", "--porcelain", "--untracked-files=no").stdout.strip())
    return {"channel": ch, "current": current, "target": target, "available": available, "changes": changes, "dirty": dirty, "checkedAt": fetched_at}


def update_running():
    return run(["systemctl", "is-active", UPDATE_UNIT], check=False).stdout.strip() in ("active", "activating", "deactivating")


def update_status(_req):
    try:
        info = json.loads(UPDATE_RUN.read_text())
    except (OSError, ValueError):
        info = None
    running = update_running()
    rc = None
    if not running and UPDATE_RC.exists():
        try:
            rc = int(UPDATE_RC.read_text().strip() or "-1")
        except ValueError:
            rc = -1
    lines = []
    try:
        lines = [SECRET_LINE.sub(r"\1: ***", ANSI.sub("", l)) for l in UPDATE_LOG.read_text(errors="replace").splitlines()]
    except OSError:
        pass
    # Etapas do update.sh, sem repetição (ele se reexecuta com o código novo e repete "Versão") e sem as seções
    # internas do diagnóstico (doctor), que vêm depois de "Diagnóstico".
    steps = []
    for l in lines:
        if not l.startswith("==>"):
            continue
        name = l.replace("==>", "").strip()
        if steps and steps[-1] == "Diagnóstico":
            break
        if name not in steps:
            steps.append(name)
    return {
        "running": running,
        "exitCode": rc,
        "run": info,
        "finishedAt": UPDATE_RC.stat().st_mtime if (rc is not None and UPDATE_RC.exists()) else None,
        "steps": steps,
        "log": lines[-250:],
    }


def update_run(req):
    with lock:
        if update_running():
            raise Refused("já existe uma atualização em andamento")
        if read_pending():
            raise Refused("há uma mudança de rede aguardando confirmação: confirme ou espere a reversão antes de atualizar")
        check = update_check({"fetch": True})
        if check["dirty"]:
            raise Refused("há alterações locais no código do servidor (git status): resolva antes de atualizar")
        if not check["available"]:
            raise Refused("o servidor já está na versão mais nova do canal")
        args = [str(ZENIE_DIR / "update.sh"), "--yes"]
        if check["channel"] == "releases":
            args += ["--version", check["target"]["ref"]]
        elif git("symbolic-ref", "-q", "HEAD", check=False).returncode != 0:
            git("checkout", "--quiet", "main")  # saiu de uma tag para o canal main: volta ao ramo (o update.sh segue o upstream)
        UPDATE_RC.unlink(missing_ok=True)
        UPDATE_LOG.write_text("")
        os.chmod(UPDATE_LOG, 0o600)
        UPDATE_RUN.write_text(json.dumps({"startedAt": time.time(), "from": check["current"], "to": check["target"], "by": str(req.get("by") or "")[:64], "channel": check["channel"]}))
        cmd = " ".join(f"'{a}'" for a in args)
        run(["systemctl", "reset-failed", UPDATE_UNIT], check=False)
        run([
            "systemd-run", f"--unit={UPDATE_UNIT}", "--collect", "--quiet", "--setenv=ZENIE_NONINTERACTIVE=1", "--setenv=TERM=dumb",
            "/bin/bash", "-c", f"{cmd} >>'{UPDATE_LOG}' 2>&1; echo $? >'{UPDATE_RC}'",
        ])
        log(f"atualização iniciada: {check['current']['commit']} -> {check['target']['ref']} ({check['target']['commit']})")
    return update_status({})


def daily_update_check():
    """Verifica 1x por dia (5 min depois de subir e a cada 24 h) para o selo do menu. Nunca atualiza sozinho."""
    time.sleep(300)
    while True:
        try:
            if not update_running():
                update_check({"fetch": True})
        except Exception as e:  # noqa: BLE001 — sem internet/GitHub: tenta no dia seguinte
            log(f"verificação diária de atualização falhou: {e}")
        time.sleep(86400)


# ------------------------------------------------------------------------------------------------ log do ACS
#
# O genieacs-cwmp escreve o log em JSON na saída padrão (docker-compose: GENIEACS_LOG_FORMAT=json); o Docker guarda
# e rotaciona. A API pede as linhas novas (desde o último horário lido) e guarda só o resumo (Log do ACS).

ACSLOG_SKIP = re.compile(r'"message":"(ACS request|CPE request|Worker listening)"')  # ruído; ACS request pode ter valores
ACSLOG_MAX = 5000


def acslog_read(req):
    since = str(req.get("since") or "")
    if not re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$", since):
        since = "2h"  # primeira leitura: as últimas 2 horas
    r = compose("logs", "--no-color", "--no-log-prefix", "--since", since, "genieacs-cwmp", timeout=60)
    lines = [l[:4000] for l in (r.stdout + "\n" + r.stderr).splitlines() if l.startswith("{") and not ACSLOG_SKIP.search(l)]
    lines.sort(key=lambda l: (re.search(r'"timestamp":"([^"]+)"', l) or [None, ""])[1])
    truncated = len(lines) > ACSLOG_MAX
    return {"lines": lines[:ACSLOG_MAX], "truncated": truncated}


# ------------------------------------------------------------------------------------------------ servidor

HANDLERS = {
    "acslog.read": acslog_read,
    "update.check": update_check,
    "update.run": update_run,
    "update.status": update_status,
    "time.get": time_get,
    "time.set": time_set,
    "time.test": time_test,
    "network.get": network_get,
    "network.apply": network_apply,
    "network.confirm": network_confirm,
    "tunnel.get": tunnel_get,
    "tunnel.set": tunnel_set,
}


def handle(conn):
    with conn:
        conn.settimeout(30)
        data = b""
        while not data.endswith(b"\n") and len(data) < 64_000:
            chunk = conn.recv(8192)
            if not chunk:
                break
            data += chunk
        try:
            req = json.loads(data.decode() or "{}")
            fn = HANDLERS.get(req.get("cmd"))
            if not fn:
                raise Refused("comando desconhecido")
            resp = {"ok": True, "result": fn(req)}
        except Refused as e:
            resp = {"ok": False, "error": str(e), "refused": True}
        except Exception as e:  # noqa: BLE001
            log(f"erro em {data[:80]!r}: {e}")
            resp = {"ok": False, "error": f"falha no servidor: {e}"}
        try:
            conn.sendall((json.dumps(resp) + "\n").encode())
        except OSError:
            pass


def main():
    if os.geteuid() != 0:
        sys.exit("zenie-hostd precisa rodar como root")
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    # Mudança pendente de antes de um reinício do agente: mantém o prazo original (ou reverte já, se venceu).
    p = read_pending()
    if p:
        schedule_rollback(p)
    SOCKET_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(SOCKET_DIR, 0o755)
    SOCKET_PATH.unlink(missing_ok=True)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(str(SOCKET_PATH))
    os.chown(SOCKET_PATH, 0, API_GID)  # só o grupo da API (e o root) falam com o agente
    os.chmod(SOCKET_PATH, 0o660)
    srv.listen(8)
    threading.Thread(target=daily_update_check, daemon=True).start()
    log(f"zenie-hostd ouvindo em {SOCKET_PATH} (ZENIE_DIR={ZENIE_DIR}, rede: {backend() or 'não suportada'})")
    while True:
        conn, _ = srv.accept()
        threading.Thread(target=handle, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "time-default":
        time_default()
    else:
        main()
