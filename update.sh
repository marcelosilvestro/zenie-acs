#!/usr/bin/env bash
# Atualiza o Zenie para a versão mais nova do repositório (ou uma tag): backup -> código -> containers ->
# conteúdo do ACS (provisions/VPs/presets, com a trava de release) -> diagnóstico.
#
#   sudo ./update.sh                 # segue o ramo atual (git pull)
#   sudo ./update.sh --version v1.2  # vai para uma tag
#   sudo ./update.sh --yes           # sem perguntas (aplica o que a trava de release permitir)
set -euo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR"

TARGET=""
NOBACKUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) TARGET="$2"; shift 2 ;;
    --yes) ZENIE_NONINTERACTIVE=1; shift ;;
    --no-backup) NOBACKUP=1; shift ;;
    *) die "uso: $0 [--version TAG] [--yes] [--no-backup]" ;;
  esac
done
export ZENIE_NONINTERACTIVE="${ZENIE_NONINTERACTIVE:-0}"
need_root
[ -f "$ENV_FILE" ] || die "Zenie não instalado aqui (sem .env) — use ./install.sh"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "há alterações locais no código (git status); resolva antes de atualizar"

step "Versão"
git fetch --tags --quiet
current="$(git rev-parse --short HEAD)"
if [ -n "$TARGET" ]; then
  git rev-parse -q --verify "$TARGET^{commit}" >/dev/null || die "versão não encontrada: $TARGET"
  next="$(git rev-parse --short "$TARGET^{commit}")"
else
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || die "ramo sem upstream; use --version TAG"
  next="$(git rev-parse --short "$upstream")"
fi
info "atual $current → nova $next"
if [ "$current" = "$next" ]; then
  ok "já está na versão mais nova"
else
  git --no-pager log --oneline "$current..$next" | head -n 20 | sed 's/^/    /'
  changed="$(git diff --name-only "$current" "$next" -- provisions virtual-parameters presets ui-config catalog | sed 's/^/      /')"
  [ -n "$changed" ] && { info "conteúdo do ACS/catálogo que muda:"; printf '%s\n' "$changed"; }
  confirm "Atualizar agora?" || die "cancelado"
fi

if [ "$NOBACKUP" = 0 ]; then
  step "Backup antes de atualizar"
  "$ZENIE_DIR/backup.sh"
fi

if [ "$current" != "$next" ]; then
  step "Código"
  if [ -n "$TARGET" ]; then git -c advice.detachedHead=false checkout --quiet "$TARGET"; else git merge --ff-only --quiet "$upstream"; fi
  ok "código em $(git rev-parse --short HEAD)"
  # O próprio update.sh pode ter mudado com o código: o bash continuaria com a versão antiga já carregada
  # (e pularia passos novos, como gerar a ZENIE_SECRET_KEY). Continua com a versão nova, sem repetir backup.
  if [ -z "${ZENIE_UPDATE_REEXEC:-}" ]; then
    args=(--no-backup)
    [ "$ZENIE_NONINTERACTIVE" = 1 ] && args+=(--yes)
    [ -n "$TARGET" ] && args+=(--version "$TARGET")
    ZENIE_UPDATE_REEXEC=1 exec bash "$ZENIE_DIR/update.sh" "${args[@]}"
  fi
fi
# o .env.example pode trazer variáveis novas: acrescenta as que faltam (com o valor padrão)
while IFS='=' read -r k v; do
  [ -n "$k" ] && [ -z "$(grep "^$k=" "$ENV_FILE" || true)" ] && { env_set "$k" "$v"; info "nova variável no .env: $k"; }
done < <(grep -E '^[A-Z][A-Z0-9_]*=' .env.example)
# Chave dos segredos do banco (instalações anteriores não têm): gerada uma única vez e nunca trocada.
[ -n "$(env_get ZENIE_SECRET_KEY)" ] || { env_set ZENIE_SECRET_KEY "$(openssl rand -hex 32)"; info "ZENIE_SECRET_KEY gerada no .env (vai no backup)"; }

step "Agente do host"
install_hostd && ok "zenie-hostd atualizado (rede e túnel Cloudflare)"

step "Containers"
"${COMPOSE[@]}" --progress quiet build --pull
"${COMPOSE[@]}" --progress quiet up -d --remove-orphans --quiet-pull
wait_http "http://127.0.0.1:7557/devices/?projection=_id&limit=1" 180 && ok "GenieACS no ar" || die "a NBI não voltou (docker compose logs genieacs-nbi)"
wait_http "https://127.0.0.1/api/health" 120 && ok "painel no ar" || die "o painel não voltou (docker compose logs zenie-api zenie-web)"
systemctl is-enabled -q zenie-firewall 2>/dev/null && systemctl restart zenie-firewall

step "Conteúdo do ACS (provisions, virtual parameters, presets, config da UI)"
python3 scripts/genieacs_sync.py import --dry-run || true
if confirm "Aplicar o que a trava de release permite?"; then
  python3 scripts/genieacs_sync.py import || warn "itens bloqueados pela trava de release: aplique primeiro no piloto (docs/PLANO.md) e use --liberar"
fi

step "Diagnóstico"
"$ZENIE_DIR/doctor.sh" || true
