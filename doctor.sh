#!/usr/bin/env bash
# Diagnóstico do Zenie: containers, portas, firewall, certificado, informs, faults, disco e relógio.
# Uso: sudo ./doctor.sh        (só lê; não altera nada)
set -uo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR" || exit 1
need_root
problems=0
bad() { fail "$*"; problems=$((problems + 1)); }

step "Containers"
for svc in mongo genieacs-cwmp genieacs-nbi genieacs-fs genieacs-ui zenie-api zenie-web; do
  st="$("${COMPOSE[@]}" ps --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | head -n1)"
  case "$st" in
    "running healthy"|"running ") ok "$svc" ;;
    running*) warn "$svc: $st" ;;
    *) bad "$svc: ${st:-não está rodando} (docker compose logs $svc)" ;;
  esac
done

step "Serviços"
curl -fs -o /dev/null --max-time 5 "http://127.0.0.1:7557/devices/?projection=_id&limit=1" && ok "NBI (7557, só local)" || bad "NBI não responde"
curl -fs -o /dev/null --max-time 5 http://127.0.0.1:3000/ && ok "UI do GenieACS (3000, só local)" || bad "UI do GenieACS não responde"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:7547/)"
[ "$code" != 000 ] && ok "CWMP (7547) aceitando conexões" || bad "CWMP (7547) não responde"
health="$(curl -fsk --max-time 5 https://127.0.0.1/api/health 2>/dev/null)"
if [ -n "$health" ]; then
  [[ "$health" == *'"nbi":true'* ]] && ok "painel (HTTPS) e API → NBI" || bad "painel responde, mas a API não alcança a NBI: $health"
else
  bad "painel não responde em https://127.0.0.1/"
fi

step "Exposição"
for port in 7557 3000 27017; do
  if ss -ltnH "sport = :$port" 2>/dev/null | awk '{print $4}' | grep -Evq '^(127\.0\.0\.1|\[::1\]):'; then
    bad "porta $port aberta em interface externa — deveria ficar só em 127.0.0.1"
  else
    ok "porta $port não exposta"
  fi
done
if systemctl is-active -q zenie-firewall 2>/dev/null && iptables -S DOCKER-USER 2>/dev/null | grep -q -- '-j ZENIE'; then
  cw="$(env_get ZENIE_CWMP_ALLOW)"; [ "$cw" = any ] && cw="qualquer origem"
  pn="$(env_get ZENIE_PANEL_ALLOW)"; [ "$pn" = any ] && pn="qualquer origem"
  ok "firewall ativo — CWMP de [$cw], painel de [$pn]"
else
  warn "firewall do Zenie inativo (systemctl status zenie-firewall) — 7547/443 abertos para qualquer origem"
fi

step "Certificado do painel"
end="$("${COMPOSE[@]}" exec -T zenie-web sh -c 'openssl x509 -noout -enddate -subject -in /etc/zenie/tls/fullchain.pem' </dev/null 2>/dev/null)"
if [ -n "$end" ]; then
  exp="$(printf '%s\n' "$end" | sed -n 's/^notAfter=//p')"
  days=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 ))
  subj="$(printf '%s\n' "$end" | sed -n 's/^subject=//p')"
  if [ "$days" -lt 0 ]; then bad "certificado VENCIDO ($exp)"; elif [ "$days" -lt 21 ]; then warn "certificado vence em $days dias ($subj)"; else ok "válido por $days dias ($subj)"; fi
else
  bad "certificado não encontrado no zenie-web"
fi

step "Equipamentos"
total="$(curl -fs --max-time 10 "http://127.0.0.1:7557/devices/?projection=_id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)"
last="$(curl -fs --max-time 10 "http://127.0.0.1:7557/devices/?projection=_lastInform&sort=%7B%22_lastInform%22%3A-1%7D&limit=1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["_lastInform"] if d else "")' 2>/dev/null)"
if [ -z "$total" ]; then
  bad "não foi possível consultar os equipamentos"
elif [ "$total" = 0 ]; then
  warn "nenhum equipamento ainda — configure o ACS URL nas CPEs (http://$(env_get GENIEACS_FS_HOSTNAME):7547/)"
else
  age=$(( $(date +%s) - $(date -d "$last" +%s) ))
  [ "$age" -lt 1800 ] && ok "$total equipamento(s); último inform há $((age / 60)) min" || warn "$total equipamento(s); último inform há $((age / 60)) min — CPEs alcançam a porta 7547?"
fi
faults="$(curl -fs --max-time 10 "http://127.0.0.1:7557/faults/?projection=_id" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)"
[ "${faults:-0}" -eq 0 ] && ok "sem faults pendentes" || warn "$faults fault(s) no GenieACS (veja na UI do GenieACS > Faults)"

step "Servidor"
disk="$(df -P "$ZENIE_DIR" | awk 'NR==2{print $5}' | tr -d %)"
[ "$disk" -lt 85 ] && ok "disco: ${disk}% usado" || bad "disco: ${disk}% usado"
mongo_size="$(mongo_eval genieacs 'print(Math.round(db.stats().dataSize/1048576))' 2>/dev/null | tail -n1)"
[ -n "$mongo_size" ] && info "MongoDB (genieacs): ${mongo_size} MB · imagem $(env_get MONGO_IMAGE)"
[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] && ok "relógio sincronizado (NTP)" || warn "relógio não sincronizado por NTP"
last_backup="$(ls -1t "$ZENIE_DIR"/backups/zenie-*.tar.gz 2>/dev/null | head -n1)"
if [ -n "$last_backup" ]; then
  bage=$(( ($(date +%s) - $(stat -c %Y "$last_backup")) / 3600 ))
  [ "$bage" -lt 36 ] && ok "último backup há ${bage} h ($(basename "$last_backup"))" || warn "último backup há ${bage} h"
else
  warn "nenhum backup em $ZENIE_DIR/backups (rode ./backup.sh)"
fi
cat_ver="$(python3 -c 'import json; print(json.load(open("catalog/index.json"))["version"])' 2>/dev/null)"
info "versão: $(git -C "$ZENIE_DIR" describe --tags --always 2>/dev/null || echo '?') · catálogo de modelos $cat_ver"

echo
if [ "$problems" -eq 0 ]; then printf '%sTudo certo.%s\n' "$C_OK" "$C_0"; else printf '%s%d problema(s) encontrado(s).%s\n' "$C_ERR" "$problems" "$C_0"; exit 1; fi
