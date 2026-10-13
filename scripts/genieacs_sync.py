#!/usr/bin/env python3
"""Exporta/importa a configuração do GenieACS para versionar no git.

Tipos sincronizados e onde ficam no repositório:
  provisions          -> provisions/<id>.js          (NBI: /provisions/)
  virtual-parameters  -> virtual-parameters/<id>.js  (NBI: /virtual_parameters/)
  presets             -> presets/<id>.json           (NBI: /presets/)
  ui-config           -> ui-config/config.json       (leitura: NBI /config/;
                                                      escrita: API da UI, exige login)

A NBI do GenieACS 1.2 não grava a coleção "config", por isso a importação de
ui-config usa a API da UI (POST /login + PUT /api/config/<id>).

Uso:
  python scripts/genieacs_sync.py export [--only TIPOS] [--prune]
  python scripts/genieacs_sync.py import [--only TIPOS] [--prune] [--dry-run]

  --only    lista separada por vírgula (ex.: provisions,presets). Padrão: todos.
  --prune   export: apaga arquivos locais que não existem mais no servidor.
            import: APAGA no servidor itens que não existem no repositório.
  --dry-run (import) só mostra o que seria alterado.
  --liberar (import) regra D2 — sem esta opção ficam BLOQUEADOS: preset novo sem
            "Tags.piloto IS NOT NULL", preset que perde o piloto ou preset geral alterado,
            provision alterado usado por preset geral e virtual parameter alterado.
            Itens novos que ainda não rodam em ninguém passam livres.
            Servidor zerado (VM recriada): importar com --liberar.

Configuração por variáveis de ambiente (ou arquivo .env na raiz do repo):
  GENIEACS_NBI_URL       padrão http://127.0.0.1:7557
  GENIEACS_UI_URL        padrão http://127.0.0.1:3000
  GENIEACS_UI_USERNAME   usuário da UI (só para importar ui-config)
  GENIEACS_UI_PASSWORD
"""

import argparse
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCRIPT_KINDS = {
    "provisions": {"dir": "provisions", "collection": "provisions"},
    "virtual-parameters": {"dir": "virtual-parameters", "collection": "virtual_parameters"},
}
ALL_KINDS = ["provisions", "virtual-parameters", "presets", "ui-config"]
UI_CONFIG_FILE = ROOT / "ui-config" / "config.json"
# Chaves da config do GenieACS que são do Zenie (geradas em tempo de execução, com segredos): o sync nunca
# exporta, grava nem apaga. cwmp.auth = autenticação das CPEs (docs/SEGURANCA-ACS.md).
ZENIE_MANAGED_CONFIG = {"cwmp.auth"}


# ---------------------------------------------------------------- utilidades

def load_dotenv(path):
    """Carrega KEY=VALUE de um .env simples sem sobrescrever o ambiente."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def id_to_filename(item_id):
    # Mantém nomes legíveis; codifica só o que é problemático em Windows/Linux.
    return urllib.parse.quote(item_id, safe=" -_.()")


def filename_to_id(name):
    return urllib.parse.unquote(name)


def id_to_url(item_id):
    # As rotas da NBI aceitam só [a-zA-Z0-9-_%] no nome: codifica todo o resto.
    return urllib.parse.quote(item_id, safe="").replace(".", "%2E")


def read_text(path):
    with open(path, "r", encoding="utf-8", newline="") as f:
        return f.read()


def write_text(path, content):
    # newline="" preserva o conteúdo exatamente como veio do servidor (sem CRLF no Windows).
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def dump_json(obj):
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


class Http:
    def __init__(self, base_url, cookies=False):
        self.base_url = base_url.rstrip("/")
        handlers = [urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())] if cookies else []
        self.opener = urllib.request.build_opener(*handlers)

    def request(self, method, path, body=None, content_type=None):
        data = None
        headers = {}
        if body is not None:
            if isinstance(body, (dict, list)):
                data = json.dumps(body).encode("utf-8")
                headers["Content-Type"] = "application/json"
            else:
                data = body.encode("utf-8")
                headers["Content-Type"] = content_type or "text/plain; charset=utf-8"
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace").strip()
            raise SystemExit(f"ERRO {method} {self.base_url}{path}: HTTP {e.code} {detail}")
        except urllib.error.URLError as e:
            raise SystemExit(f"ERRO ao conectar em {self.base_url}{path}: {e.reason}")
        if raw and raw.lstrip()[:1] in "[{":
            return json.loads(raw)
        return raw


def nbi_list(nbi, collection):
    return nbi.request("GET", f"/{collection}/")


# ----------------------------------------------------- leitura local / remota

def remote_items(nbi, kind):
    """Retorna {id: conteúdo} no mesmo formato da representação local."""
    if kind in SCRIPT_KINDS:
        return {d["_id"]: d.get("script", "") for d in nbi_list(nbi, SCRIPT_KINDS[kind]["collection"])}
    if kind == "presets":
        return {d["_id"]: {k: v for k, v in d.items() if k != "_id"} for d in nbi_list(nbi, "presets")}
    if kind == "ui-config":
        return {d["_id"]: d.get("value") for d in nbi_list(nbi, "config") if d["_id"] not in ZENIE_MANAGED_CONFIG}
    raise ValueError(kind)


def local_items(kind):
    if kind in SCRIPT_KINDS:
        folder = ROOT / SCRIPT_KINDS[kind]["dir"]
        return {filename_to_id(p.stem): read_text(p) for p in sorted(folder.glob("*.js"))}
    if kind == "presets":
        folder = ROOT / "presets"
        return {filename_to_id(p.stem): json.loads(read_text(p)) for p in sorted(folder.glob("*.json"))}
    if kind == "ui-config":
        items = json.loads(read_text(UI_CONFIG_FILE)) if UI_CONFIG_FILE.exists() else {}
        return {k: v for k, v in items.items() if k not in ZENIE_MANAGED_CONFIG}
    raise ValueError(kind)


# ------------------------------------------------------------------- export

def export_kind(nbi, kind, prune):
    items = remote_items(nbi, kind)
    if kind == "ui-config":
        UI_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        write_text(UI_CONFIG_FILE, dump_json(items))
        print(f"[{kind}] {len(items)} chaves -> {UI_CONFIG_FILE.relative_to(ROOT).as_posix()}")
        return

    folder = ROOT / (SCRIPT_KINDS[kind]["dir"] if kind in SCRIPT_KINDS else "presets")
    ext = ".js" if kind in SCRIPT_KINDS else ".json"
    folder.mkdir(parents=True, exist_ok=True)
    written = set()
    for item_id, content in sorted(items.items()):
        path = folder / (id_to_filename(item_id) + ext)
        write_text(path, content if kind in SCRIPT_KINDS else dump_json(content))
        written.add(path.name)
    print(f"[{kind}] {len(items)} itens exportados -> {folder.relative_to(ROOT).as_posix()}/")

    stale = [p for p in folder.glob("*" + ext) if p.name not in written]
    for p in stale:
        if prune:
            p.unlink()
            print(f"[{kind}] removido local (não existe no servidor): {p.name}")
        else:
            print(f"[{kind}] AVISO: {p.name} existe só no repositório (use --prune para apagar)")


# ------------------------------------------------------------------- import

def ui_login():
    url = os.environ.get("GENIEACS_UI_URL", "http://127.0.0.1:3000")
    user = os.environ.get("GENIEACS_UI_USERNAME")
    password = os.environ.get("GENIEACS_UI_PASSWORD")
    if not user or not password:
        raise SystemExit("ERRO: importar ui-config exige GENIEACS_UI_USERNAME e GENIEACS_UI_PASSWORD")
    ui = Http(url, cookies=True)
    ui.request("POST", "/login", {"username": user, "password": password})
    return ui


PILOT = re.compile(r"\bTags\.piloto\b")


def is_pilot(preset):
    return bool(PILOT.search(str((preset or {}).get("precondition") or "")))


def release_gate(kind, to_put, local, remote):
    """Regra D2: o que afeta clientes que não são 'piloto' só passa com --liberar.
    Retorna {id: motivo} dos itens bloqueados."""
    blocked = {}
    if kind == "presets":
        for i in to_put:
            if i not in remote and not is_pilot(local[i]):
                blocked[i] = "preset novo sem 'Tags.piloto' na precondition"
            elif i in remote and is_pilot(remote[i]) and not is_pilot(local[i]):
                blocked[i] = "LIBERAÇÃO: preset deixa de ser só 'piloto' e passa a valer para todos"
            elif i in remote and not is_pilot(remote[i]):
                blocked[i] = "preset geral alterado (vale para todos)"
    elif kind == "provisions":
        presets = local_items("presets")
        for i in to_put:
            if i not in remote:
                continue
            users = [p for p, doc in presets.items()
                     if any(c.get("name") == i for c in doc.get("configurations", []))]
            general = [p for p in users if not is_pilot(presets[p])]
            if general:
                blocked[i] = f"provision alterado usado por preset(s) geral(is): {', '.join(general)}"
    elif kind == "virtual-parameters":
        for i in to_put:
            if i in remote:
                blocked[i] = "virtual parameter alterado vale na hora para todos (rode scripts/test-vp.js em todos os samples)"
    return blocked


def import_kind(nbi, kind, prune, dry_run, liberar=False):
    local = local_items(kind)
    remote = remote_items(nbi, kind)

    to_put = sorted(i for i, v in local.items() if remote.get(i, object()) != v)
    blocked = release_gate(kind, to_put, local, remote)
    for i, reason in blocked.items():
        if liberar:
            print(f"[{kind}] LIBERADO (--liberar): {i} — {reason}")
        else:
            print(f"[{kind}] BLOQUEADO: {i} — {reason}. Use --liberar se for intencional.")
    if not liberar:
        to_put = [i for i in to_put if i not in blocked]
    to_delete = sorted(i for i in remote if i not in local) if prune else []
    only_remote = sorted(i for i in remote if i not in local)

    for i in to_put:
        print(f"[{kind}] {'criar' if i not in remote else 'atualizar'}: {i}")
    for i in to_delete:
        print(f"[{kind}] APAGAR no servidor: {i}")
    if not prune and only_remote:
        print(f"[{kind}] {len(only_remote)} item(ns) só no servidor (mantidos; use --prune para apagar)")
    if not to_put and not to_delete:
        print(f"[{kind}] nada a alterar")
        return
    if dry_run:
        return

    if kind == "ui-config":
        ui = ui_login()
        for i in to_put:
            ui.request("PUT", f"/api/config/{urllib.parse.quote(i, safe='')}", {"value": local[i]})
        for i in to_delete:
            ui.request("DELETE", f"/api/config/{urllib.parse.quote(i, safe='')}")
        return

    collection = SCRIPT_KINDS[kind]["collection"] if kind in SCRIPT_KINDS else "presets"
    for i in to_put:
        nbi.request("PUT", f"/{collection}/{id_to_url(i)}", local[i])
    for i in to_delete:
        nbi.request("DELETE", f"/{collection}/{id_to_url(i)}")


# --------------------------------------------------------------------- main

def main():
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Sync de configuração do GenieACS <-> git")
    parser.add_argument("action", choices=["export", "import"])
    parser.add_argument("--only", default=",".join(ALL_KINDS))
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--liberar", action="store_true",
                        help="permite mudanças que afetam equipamentos fora da tag 'piloto' (regra D2)")
    args = parser.parse_args()

    kinds = [k.strip() for k in args.only.split(",") if k.strip()]
    invalid = [k for k in kinds if k not in ALL_KINDS]
    if invalid:
        parser.error(f"tipos inválidos: {', '.join(invalid)} (válidos: {', '.join(ALL_KINDS)})")

    nbi = Http(os.environ.get("GENIEACS_NBI_URL", "http://127.0.0.1:7557"))
    for kind in kinds:
        if args.action == "export":
            export_kind(nbi, kind, args.prune)
        else:
            import_kind(nbi, kind, args.prune, args.dry_run, args.liberar)


if __name__ == "__main__":
    main()
