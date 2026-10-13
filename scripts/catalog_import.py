#!/usr/bin/env python3
"""Grava em catalog/ os rascunhos de homologação exportados do servidor de testes (docs/HOMOLOGACAO.md).

Uso (Windows, a partir da raiz do repositório):
    ssh root@<vm> "cd /opt/zenie && docker compose exec -T zenie-api node dist/cli.js catalog-export" \\
        | py scripts/catalog_import.py
    git diff catalog/   # revisar
    git commit ...      # o catálogo novo vai na próxima release (deploy)
    # depois do deploy, na VM: docker compose exec zenie-api node dist/cli.js catalog-clear-drafts

Também aceita um arquivo: py scripts/catalog_import.py export.json
Atualiza catalog/index.json com a versão AAAA.MM.DD-N.
"""

import base64
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "catalog"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$")
MAX_THUMB = 200 * 1024


def main() -> int:
    raw = Path(sys.argv[1]).read_text(encoding="utf-8") if len(sys.argv) > 1 else sys.stdin.read()
    data = json.loads(raw)
    drafts = data.get("drafts", [])
    if not drafts:
        print("nenhum rascunho para importar")
        return 0

    for d in drafts:
        pid = d["id"]
        if not ID_RE.match(pid):
            print(f"ignorado (id inválido): {pid!r}")
            continue
        folder = ROOT / pid
        folder.mkdir(parents=True, exist_ok=True)
        profile = {k: v for k, v in d["profile"].items() if k not in ("hasImage", "draft")}
        profile["id"] = pid
        (folder / "profile.json").write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        msg = f"{pid}: profile.json"
        if d.get("thumb"):
            img = base64.b64decode(d["thumb"])
            if len(img) > MAX_THUMB or img[:4] != b"RIFF" or img[8:12] != b"WEBP":
                print(f"{pid}: foto ignorada (precisa ser WebP <= 200 KB)")
            else:
                (folder / "thumb.webp").write_bytes(img)
                msg += f" + thumb.webp ({len(img) // 1024} KB)"
        print(msg)

    index = ROOT / "index.json"
    meta = json.loads(index.read_text(encoding="utf-8")) if index.exists() else {}
    today = datetime.date.today().strftime("%Y.%m.%d")
    old = str(meta.get("version", ""))
    n = int(old.rsplit("-", 1)[1]) + 1 if old.startswith(today + "-") else 1
    meta["version"] = f"{today}-{n}"
    meta.setdefault("description", "Catálogo oficial de equipamentos homologados do Zenie")
    index.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"versão do catálogo: {meta['version']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
