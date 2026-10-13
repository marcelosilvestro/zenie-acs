#!/usr/bin/env bash
# Remove o Zenie deste servidor.
#   sudo ./uninstall.sh            # para e remove os containers, o firewall e o cron; DADOS FICAM (volumes, .env, backups)
#   sudo ./uninstall.sh --purge    # também APAGA os bancos (volumes Docker) e o .env — irreversível; backups ficam
# O Docker em si não é removido.
set -euo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR"
PURGE=0
[ "${1:-}" = --purge ] && PURGE=1
need_root

if [ "$PURGE" = 1 ]; then
  warn "--purge: os bancos (equipamentos, usuários, auditoria) e o .env serão APAGADOS"
  info "backups em $ZENIE_DIR/backups ficam (faça um agora com ./backup.sh se precisar)"
  confirm "Apagar tudo?" || die "cancelado"
else
  confirm "Parar e remover os containers do Zenie (os dados ficam)?" || die "cancelado"
fi

step "Removendo"
if [ "$PURGE" = 1 ]; then "${COMPOSE[@]}" down -v --remove-orphans; else "${COMPOSE[@]}" down --remove-orphans; fi
ok "containers removidos"
if [ -f /etc/systemd/system/zenie-firewall.service ]; then
  systemctl disable --now zenie-firewall >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/zenie-firewall.service
  systemctl daemon-reload
  ok "firewall removido"
fi
rm -f /etc/cron.d/zenie-backup && ok "backup agendado removido"
if [ "$PURGE" = 1 ]; then
  rm -f "$ENV_FILE"
  ok "bancos e .env apagados"
fi
info "o código continua em $ZENIE_DIR (apague a pasta se não for reinstalar)"
