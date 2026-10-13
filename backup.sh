#!/usr/bin/env bash
# Backup do Zenie: bancos "genieacs" e "zenie" (mongodump), .env e certificado do painel, num único arquivo.
#
#   sudo ./backup.sh                 # gera backups/zenie-AAAAMMDD-HHMMSS.tar.gz e apaga os de mais de 14 dias
#   sudo ./backup.sh --keep 30 --dir /mnt/backup
#   sudo ./backup.sh --quiet         # para o cron (instalado pelo install.sh em /etc/cron.d/zenie-backup)
#
# O arquivo contém SEGREDOS (.env): fica com permissão 600. Copie para fora do servidor (outro disco/nuvem).
# Restaurar: sudo ./restore.sh backups/zenie-....tar.gz
set -euo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR"

KEEP=14
DIR="$ZENIE_DIR/backups"
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    *) die "uso: $0 [--keep DIAS] [--dir PASTA] [--quiet]" ;;
  esac
done
need_root
say() { [ "$QUIET" = 1 ] || ok "$*"; }

mkdir -p "$DIR"
chmod 700 "$DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for db in genieacs zenie; do
  "${COMPOSE[@]}" exec -T mongo mongodump --quiet --archive --gzip --db "$db" </dev/null >"$work/$db.archive.gz"
  [ -s "$work/$db.archive.gz" ] || die "mongodump de $db vazio"
  say "banco $db: $(du -h "$work/$db.archive.gz" | cut -f1)"
done
cp "$ENV_FILE" "$work/env"
"${COMPOSE[@]}" exec -T zenie-web tar -C /etc/zenie -cf - tls </dev/null >"$work/tls.tar" 2>/dev/null || rm -f "$work/tls.tar"
{
  echo "data=$(date -Is)"
  echo "host=$(hostname)"
  echo "versao=$(git describe --tags --always 2>/dev/null || echo '?')"
  echo "mongo=$(env_get MONGO_IMAGE)"
} >"$work/info.txt"

out="$DIR/zenie-$stamp.tar.gz"
tar -C "$work" -czf "$out" .
chmod 600 "$out"
say "backup: $out ($(du -h "$out" | cut -f1))"

find "$DIR" -maxdepth 1 -name 'zenie-*.tar.gz' -mtime +"$KEEP" -print -delete | while read -r f; do say "removido (mais de $KEEP dias): $(basename "$f")"; done
[ "$QUIET" = 1 ] || info "copie o arquivo para fora deste servidor — backup no mesmo disco não protege de perda do disco"
