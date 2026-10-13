#!/usr/bin/env bash
# Restaura um backup do backup.sh (APAGA os dados atuais dos bancos genieacs e zenie).
#
#   sudo ./restore.sh backups/zenie-AAAAMMDD-HHMMSS.tar.gz            # bancos + segredos + certificado
#   sudo ./restore.sh ARQUIVO --with-env                              # também o .env inteiro (mesmo servidor)
#
# Por padrão, do .env só voltam os segredos que precisam casar com os bancos (senha da UI do GenieACS e JWT);
# endereços e redes ficam os do servidor atual (útil para restaurar em outro servidor/IP).
# Servidor novo: rode ./install.sh antes (sobe os containers) e depois este script.
set -euo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR"

FILE=""
WITH_ENV=0
for arg in "$@"; do
  case "$arg" in
    --with-env) WITH_ENV=1 ;;
    --yes) ZENIE_NONINTERACTIVE=1 ;;
    *) FILE="$arg" ;;
  esac
done
[ -n "$FILE" ] && [ -f "$FILE" ] || die "uso: $0 ARQUIVO.tar.gz [--with-env] [--yes]"
need_root

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$FILE"
[ -s "$work/genieacs.archive.gz" ] && [ -s "$work/zenie.archive.gz" ] || die "arquivo não parece um backup do Zenie"
step "Backup"
sed 's/^/    /' "$work/info.txt" 2>/dev/null || true

warn "os bancos ATUAIS (equipamentos, usuários, auditoria, configuração do ACS) serão SUBSTITUÍDOS"
confirm "Restaurar agora?" || die "cancelado"

step "Restaurando"
"${COMPOSE[@]}" --progress quiet up -d mongo
for i in $(seq 1 30); do mongo_eval admin 'print(1)' >/dev/null 2>&1 && break; sleep 2; done
"${COMPOSE[@]}" stop genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui zenie-api >/dev/null 2>&1 || true
for db in genieacs zenie; do
  "${COMPOSE[@]}" exec -T mongo mongorestore --quiet --archive --gzip --drop --nsInclude "$db.*" <"$work/$db.archive.gz"
  ok "banco $db restaurado"
done

if [ "$WITH_ENV" = 1 ]; then
  cp "$work/env" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env restaurado inteiro"
else
  for key in GENIEACS_UI_JWT_SECRET GENIEACS_UI_PASSWORD; do
    val="$(sed -n "s/^$key=//p" "$work/env" | tail -n1)"
    [ -n "$val" ] && env_set "$key" "$val"
  done
  ok "segredos restaurados (senha da UI do GenieACS e JWT); endereços mantidos"
fi

"${COMPOSE[@]}" --progress quiet up -d
if [ -s "$work/tls.tar" ]; then
  "${COMPOSE[@]}" exec -T zenie-web tar -C /etc/zenie -xf - <"$work/tls.tar"
  "${COMPOSE[@]}" exec -T zenie-web nginx -s reload >/dev/null 2>&1 || true
  ok "certificado do painel restaurado"
fi
wait_http "https://127.0.0.1/api/health" 120 && ok "painel no ar" || warn "o painel ainda não respondeu — rode ./doctor.sh"
wait_http "http://127.0.0.1:3000/" 60 || true
if ensure_ui_password; then ok "UI do GenieACS: login do admin confere com o .env"; else ok "UI do GenieACS: senha do admin regravada com a do .env"; fi
info "rode ./doctor.sh para conferir"
