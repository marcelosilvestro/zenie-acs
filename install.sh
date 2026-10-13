#!/usr/bin/env bash
# Instalador do Zenie (GenieACS + painel NOC) em um servidor Linux zerado.
# Sistemas: Debian 12/13, Ubuntu 22.04/24.04 (64 bits). Detalhes: docs/INSTALACAO.md
#
#   git clone <repositório> /opt/zenie && cd /opt/zenie
#   sudo ./install.sh                         # interativo
#   sudo ./install.sh --config respostas.env  # sem perguntas (modelo: deploy/respostas.env.example)
#
# Idempotente: rodar de novo atualiza a configuração sem perder dados nem trocar segredos/senhas.
set -euo pipefail
. "$(dirname "$0")/deploy/lib.sh"
cd "$ZENIE_DIR"

CONFIG=""
FIREWALL=1
FORCE_OS=0
TLS_CERT=""
TLS_KEY=""

usage() {
  cat <<EOF
Uso: sudo ./install.sh [opções]
  --config ARQUIVO   respostas sem perguntas (KEY=VALOR; modelo em deploy/respostas.env.example)
  --yes              não pergunta nada (usa respostas/padrões)
  --cert ARQ --key ARQ  certificado HTTPS próprio do painel (PEM); padrão: autoassinado
  --no-firewall      não instala o firewall das portas (use se já filtra em outro lugar)
  --force-os         instala mesmo em sistema não suportado (por sua conta)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="$2"; ZENIE_NONINTERACTIVE=1; shift 2 ;;
    --yes) ZENIE_NONINTERACTIVE=1; shift ;;
    --cert) TLS_CERT="$2"; shift 2 ;;
    --key) TLS_KEY="$2"; shift 2 ;;
    --no-firewall) FIREWALL=0; shift ;;
    --force-os) FORCE_OS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "opção desconhecida: $1" ;;
  esac
done
export ZENIE_NONINTERACTIVE="${ZENIE_NONINTERACTIVE:-0}"

need_root
printf '%sZenie — instalador%s  (%s)\n' "$C_B" "$C_0" "$ZENIE_DIR"

# Respostas do arquivo --config (só chaves conhecidas; o arquivo não é executado).
declare -A CFG=()
if [ -n "$CONFIG" ]; then
  [ -f "$CONFIG" ] || die "arquivo não encontrado: $CONFIG"
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^(ZENIE_COMPANY|ACS_HOST|ZENIE_CWMP_ALLOW|ZENIE_PUBLIC_HOST|ZENIE_PANEL_ALLOW|TZ|ZENIE_ADMIN_USER|BACKUP_CRON)$ ]] || continue
    v="${v%\"}"; v="${v#\"}"
    CFG[$k]="$v"
  done < <(grep -E '^[A-Z_]+=' "$CONFIG")
fi
cfg() { local v="${CFG[$1]:-}"; [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$2"; }

# ------------------------------------------------------------------------------------------- 1. checagens
step "1/9 Checagens do servidor"
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  debian:12|debian:13|ubuntu:22.04|ubuntu:24.04) ok "sistema: $PRETTY_NAME" ;;
  *) [ "$FORCE_OS" = 1 ] && warn "sistema não suportado: ${PRETTY_NAME:-?} (seguindo por --force-os)" || die "sistema não suportado: ${PRETTY_NAME:-?} (use Debian 12/13 ou Ubuntu 22.04/24.04)" ;;
esac
case "$(uname -m)" in
  x86_64|aarch64) ok "arquitetura: $(uname -m)" ;;
  *) die "arquitetura não suportada: $(uname -m)" ;;
esac
mem_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1900 ]; then die "memória: ${mem_mb} MB (mínimo 2 GB)"; fi
[ "$mem_mb" -lt 3800 ] && warn "memória: ${mem_mb} MB (recomendado 4 GB)" || ok "memória: ${mem_mb} MB"
disk_gb=$(df -BG --output=avail "$ZENIE_DIR" | tail -n1 | tr -dc 0-9)
if [ "$disk_gb" -lt 8 ]; then die "disco livre: ${disk_gb} GB (mínimo 8 GB)"; fi
[ "$disk_gb" -lt 20 ] && warn "disco livre: ${disk_gb} GB (recomendado 20 GB+)" || ok "disco livre: ${disk_gb} GB"
if [ "$(uname -m)" = x86_64 ] && ! grep -qw avx /proc/cpuinfo; then
  MONGO_IMAGE="mongo:4.4"
  warn "CPU sem AVX: usando MongoDB 4.4 (fora de suporte). Em VM, ative AVX (VMware: EVC/compatibilidade de CPU)."
else
  MONGO_IMAGE="mongo:7.0"
  ok "CPU com AVX: MongoDB 7.0"
fi
for port in 7547 7567 80 443; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
    if ss -ltnpH "sport = :$port" 2>/dev/null | grep -q docker-proxy; then
      info "porta $port: já usada pelo Docker (reinstalação)"
    else
      die "porta $port ocupada por: $(ss -ltnpH "sport = :$port" | awk '{print $NF}' | head -n1)"
    fi
  fi
done
ok "portas 7547, 7567, 80 e 443 disponíveis"

# ------------------------------------------------------------------------------------------- 2. perguntas
step "2/9 Configuração"
ip_now="$(default_ip)"
COMPANY="$(cfg ZENIE_COMPANY "$(ask "Nome do provedor" "$(env_get ZENIE_COMPANY || true)")")"
ACS_HOST="$(cfg ACS_HOST "$(ask "Endereço (IP ou nome) que as CPEs usam para chegar a este servidor" "$(env_get GENIEACS_FS_HOSTNAME | grep -v '^192.168.0.10$' || echo "$ip_now")")")"
[ -n "$ACS_HOST" ] || ACS_HOST="$ip_now"
def_cwmp="$(env_get ZENIE_CWMP_ALLOW)"
CWMP_ALLOW="$(cfg ZENIE_CWMP_ALLOW "$(ask "Quem pode falar com o ACS (CWMP): any = qualquer origem (filtro no firewall do provedor) ou redes separadas por espaço" "${def_cwmp:-any}")")"
[ "$CWMP_ALLOW" = "any" ] || valid_cidr_list "$CWMP_ALLOW" || die "redes CWMP inválidas: $CWMP_ALLOW (use any ou uma lista de redes)"
PANEL_HOST="$(cfg ZENIE_PUBLIC_HOST "$(ask "Endereço do painel (IP ou nome usado no navegador)" "$(env_get ZENIE_PUBLIC_HOST | grep -v '^192.168.0.10$' || echo "$ACS_HOST")")")"
[ -n "$PANEL_HOST" ] || PANEL_HOST="$ACS_HOST"
def_panel="$(env_get ZENIE_PANEL_ALLOW)"
PANEL_ALLOW="$(cfg ZENIE_PANEL_ALLOW "$(ask "Quem pode abrir o painel (443/80): any = qualquer origem (filtro no firewall do provedor) ou redes separadas por espaço" "${def_panel:-any}")")"
[ "$PANEL_ALLOW" = "any" ] || valid_cidr_list "$PANEL_ALLOW" || die "redes do painel inválidas: $PANEL_ALLOW (use any ou uma lista de redes)"
ssh_ip="${SSH_CLIENT:-}"; ssh_ip="${ssh_ip%% *}"  # vazio quando roda no console (sem SSH)
if [ "$PANEL_ALLOW" != "any" ] && [ -n "$ssh_ip" ] && [[ "$ssh_ip" =~ ^[0-9.]+$ ]] && ! ip_in_nets "$ssh_ip" "$PANEL_ALLOW" 2>/dev/null; then
  warn "seu IP ($ssh_ip) não está nas redes do painel"
  if [ "$ZENIE_NONINTERACTIVE" != 1 ] && confirm "Incluir $ssh_ip/32 nas redes do painel?"; then PANEL_ALLOW="$PANEL_ALLOW $ssh_ip/32"; fi
fi
# Padrão: horário de Brasília. Aceita "brasilia"/"-3" como atalho; nome inválido volta a perguntar (ou usa o padrão).
def_tz="$(env_get TZ || true)"; [ -f "/usr/share/zoneinfo/${def_tz:-x}" ] || def_tz="America/Sao_Paulo"
while :; do
  TZ_SET="$(cfg TZ "$(ask "Fuso horário (Enter = horário de Brasília)" "$def_tz")")"
  case "${TZ_SET,,}" in ""|brasil|brasilia|brasília|-3|-03|-03:00|utc-3|gmt-3) TZ_SET="America/Sao_Paulo" ;; esac
  [ -f "/usr/share/zoneinfo/$TZ_SET" ] && break
  warn "fuso horário inválido: $TZ_SET (use o nome, ex.: America/Sao_Paulo, America/Manaus, America/Recife)"
  [ "$ZENIE_NONINTERACTIVE" = 1 ] && { TZ_SET="America/Sao_Paulo"; break; }
done
ADMIN_USER="$(cfg ZENIE_ADMIN_USER "$(ask "Usuário administrador do painel" "admin")")"
[[ "$ADMIN_USER" =~ ^[a-z0-9._-]{3,32}$ ]] || die "usuário inválido: $ADMIN_USER (3 a 32: letras minúsculas, números, . _ -)"
info "provedor: ${COMPANY:-—} · ACS: http://$ACS_HOST:7547/ · painel: https://$PANEL_HOST/"

# ------------------------------------------------------------------------------------------- 3. pacotes/Docker
step "3/9 Pacotes e Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null
apt-get install -yq ca-certificates curl git python3 iptables openssl iproute2 cron >/dev/null
# Relógio: o Debian mínimo pode vir sem NTP nenhum (nem systemd-timesyncd). Sem ele, a hora do ACS deriva.
if ! command -v chronyc >/dev/null && ! systemctl cat systemd-timesyncd >/dev/null 2>&1; then
  apt-get install -yq chrony >/dev/null && ok "chrony instalado (NTP)"
fi
ok "pacotes base"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/${ID}
Suites: ${VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -q >/dev/null
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1
ok "$(docker --version | cut -d, -f1) · $(docker compose version --short 2>/dev/null | sed 's/^/compose /')"
if command -v timedatectl >/dev/null; then
  timedatectl set-timezone "$TZ_SET" 2>/dev/null && ok "fuso horário: $TZ_SET" || warn "fuso horário inválido: $TZ_SET"
  [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] && ok "relógio sincronizado (NTP)" || warn "relógio não sincronizado por NTP — os horários de inform podem ficar errados"
fi

# ------------------------------------------------------------------------------------------- 4. .env
step "4/9 Arquivo .env (segredos e endereços)"
first_env=0
if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  first_env=1
fi
chmod 600 "$ENV_FILE"
jwt="$(env_get GENIEACS_UI_JWT_SECRET)"
if [ -z "$jwt" ] || [ "$jwt" = troque-por-um-segredo-aleatorio ]; then env_set GENIEACS_UI_JWT_SECRET "$(openssl rand -hex 32)"; fi
env_set GENIEACS_FS_HOSTNAME "$ACS_HOST"
env_set MONGO_IMAGE "$MONGO_IMAGE"
env_set CWMP_BIND_ADDR 0.0.0.0
env_set ADMIN_BIND_ADDR 127.0.0.1
env_set ZENIE_BIND_ADDR 0.0.0.0
env_set ZENIE_PUBLIC_HOST "$PANEL_HOST"
env_set ZENIE_CWMP_ALLOW "$CWMP_ALLOW"
env_set ZENIE_PANEL_ALLOW "$PANEL_ALLOW"
env_set ZENIE_COMPANY "$COMPANY"
env_set TZ "$TZ_SET"
env_set GENIEACS_UI_USERNAME admin
[ -n "$(env_get ZENIE_HOMOLOGATION)" ] || env_set ZENIE_HOMOLOGATION false
# Chave dos segredos do banco: gerada uma única vez e nunca trocada (docs/SEGURANCA-ACS.md).
[ -n "$(env_get ZENIE_SECRET_KEY)" ] || env_set ZENIE_SECRET_KEY "$(openssl rand -hex 32)"
[ "$first_env" = 1 ] && ok ".env criado (permissão 600)" || ok ".env atualizado (segredos mantidos)"

install_hostd && ok "agente do host (zenie-hostd) ativo: Configurações > Redes, Horário e túnel Cloudflare"
python3 "$ZENIE_DIR/deploy/hostd/zenie-hostd.py" time-default 2>&1 | sed 's/^zenie-hostd: /    /' || warn "não foi possível configurar o NTP (Configurações > Horário)"

# ------------------------------------------------------------------------------------------- 5. firewall
step "5/9 Firewall (CWMP e painel)"
if [ "$FIREWALL" = 1 ]; then
  sed "s#ZENIE_DIR#$ZENIE_DIR#g" deploy/zenie-firewall.service >/etc/systemd/system/zenie-firewall.service
  chmod +x deploy/firewall.sh
  systemctl daemon-reload
  systemctl enable zenie-firewall >/dev/null 2>&1
  systemctl restart zenie-firewall
  ok "$(journalctl -u zenie-firewall -n 1 -o cat --no-pager 2>/dev/null | grep zenie-firewall || echo "zenie-firewall ativo")"
  info "o SSH e os demais serviços do servidor não são alterados"
else
  warn "firewall não instalado (--no-firewall): filtre 7547/7567 e 443 em outro lugar"
fi

# ------------------------------------------------------------------------------------------- 6. containers
step "6/9 Containers (a primeira vez demora: compila as imagens)"
"${COMPOSE[@]}" --progress quiet build --pull
"${COMPOSE[@]}" --progress quiet up -d --remove-orphans --quiet-pull
wait_http "http://127.0.0.1:7557/devices/?projection=_id&limit=1" 180 && ok "GenieACS NBI respondendo" || die "a NBI do GenieACS não subiu (veja: docker compose logs genieacs-nbi)"
wait_http "http://127.0.0.1:3000/" 120 && ok "GenieACS UI respondendo" || die "a UI do GenieACS não subiu (docker compose logs genieacs-ui)"
wait_http "https://127.0.0.1/api/health" 120 && ok "painel Zenie respondendo (HTTPS)" || die "o painel não subiu (docker compose logs zenie-api zenie-web)"

if [ -n "$TLS_CERT" ] || [ -n "$TLS_KEY" ]; then
  [ -s "$TLS_CERT" ] && [ -s "$TLS_KEY" ] || die "--cert e --key precisam apontar para arquivos PEM"
  openssl x509 -noout -in "$TLS_CERT" >/dev/null 2>&1 || die "certificado inválido: $TLS_CERT"
  "${COMPOSE[@]}" cp "$TLS_CERT" zenie-web:/etc/zenie/tls/fullchain.pem
  "${COMPOSE[@]}" cp "$TLS_KEY" zenie-web:/etc/zenie/tls/privkey.pem
  "${COMPOSE[@]}" exec -T zenie-web nginx -s reload
  ok "certificado próprio instalado: $(openssl x509 -noout -subject -in "$TLS_CERT" | sed 's/^subject=//')"
fi

# ------------------------------------------------------------------------------------------- 7. GenieACS
step "7/9 GenieACS: usuário da UI, provisions, virtual parameters e presets"
ui_users="$(mongo_eval genieacs 'print(db.users.countDocuments ? db.users.countDocuments({}) : db.users.count())' | tail -n1 | tr -dc 0-9)"
first_acs=0
ui_pass="$(env_get GENIEACS_UI_PASSWORD)"
if [ "${ui_users:-0}" = 0 ]; then
  first_acs=1
  # Mesmo efeito do assistente da UI, sem passo manual: cria admin e permissões (config e presets vêm do repositório).
  curl -fsS -X POST -H 'Content-Type: application/json'     -d '{"users":true,"presets":false,"filters":false,"device":false,"index":false,"overview":false}'     http://127.0.0.1:3000/init >/dev/null
  # O /init responde antes de terminar de gravar: espera o usuário existir antes de trocar a senha.
  for _ in $(seq 1 30); do
    [ "$(mongo_eval genieacs 'print(db.users.count({_id: "admin"}))' | tail -n1 | tr -dc 0-9)" = 1 ] && break
    sleep 1
  done
  sleep 3
  [ -n "$ui_pass" ] || { ui_pass="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"; env_set GENIEACS_UI_PASSWORD "$ui_pass"; }
fi
if [ -z "$ui_pass" ]; then
  ui_pass="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
  env_set GENIEACS_UI_PASSWORD "$ui_pass"
fi
# Confere com login de verdade; se a senha do .env não entra (1ª instalação ou senha trocada fora), regrava.
if ui_login_ok "$ui_pass"; then
  ok "UI do GenieACS: login do admin confere com o .env"
else
  for attempt in 1 2 3; do
    set_ui_password "$ui_pass"
    ui_login_ok "$ui_pass" && break
    [ "$attempt" = 3 ] && die "não foi possível definir a senha do admin da UI do GenieACS"
    sleep 3
  done
  ok "UI do GenieACS: senha do admin definida (aleatória, no .env)"
fi
if [ "$first_acs" = 1 ]; then
  python3 scripts/genieacs_sync.py import --liberar
else
  # Reinstalação: a trava de release (regra D2) continua valendo; mudanças em presets gerais exigem --liberar manual.
  python3 scripts/genieacs_sync.py import || warn "importação parcial: revise com 'python3 scripts/genieacs_sync.py import --dry-run'"
fi
ok "conteúdo do ACS importado do repositório"

# ------------------------------------------------------------------------------------------- 8. admin do painel
step "8/9 Administrador do painel"
admin_out=""
zenie_users="$(mongo_eval zenie 'print(db.users.countDocuments ? db.users.countDocuments({}) : db.users.count())' | tail -n1 | tr -dc 0-9)"
if [ "${zenie_users:-0}" = 0 ]; then
  admin_out="$("${COMPOSE[@]}" exec -T zenie-api node dist/cli.js create-admin "$ADMIN_USER" "Administrador" </dev/null)"
  ok "administrador '$ADMIN_USER' criado"
else
  ok "o painel já tem usuários (nenhum criado). Senha esquecida: docker compose exec zenie-api node dist/cli.js reset-password <usuário>"
fi

# ------------------------------------------------------------------------------------------- 9. backup e resumo
step "9/9 Backup"
backup_cron="$(cfg BACKUP_CRON "")"
if [ ! -f /etc/cron.d/zenie-backup ]; then
  if [ "$backup_cron" = yes ] || { [ -z "$backup_cron" ] && [ "$ZENIE_NONINTERACTIVE" != 1 ] && confirm "Agendar backup diário (03:15, guarda 14 dias em $ZENIE_DIR/backups)?"; }; then
    printf '# Zenie: backup diário (backup.sh)\n15 3 * * * root %s/backup.sh --quiet\n' "$ZENIE_DIR" >/etc/cron.d/zenie-backup
    ok "backup diário agendado (/etc/cron.d/zenie-backup)"
  else
    info "backup não agendado — rode $ZENIE_DIR/backup.sh quando quiser"
  fi
else
  ok "backup diário já agendado"
fi

printf '\n%s================================ Zenie instalado ================================%s\n' "$C_B" "$C_0"
cat <<EOF

  Painel NOC .......... https://$PANEL_HOST/
EOF
if [ -n "$admin_out" ]; then
  printf '  Usuário ............ %s\n  Senha temporária ... %s%s%s   (troca obrigatória no 1º login; anote agora, não é mostrada de novo)\n' \
    "$ADMIN_USER" "$C_B" "$(printf '%s\n' "$admin_out" | sed -n 's/^senha[^:]*: *//p')" "$C_0"
fi
cat <<EOF

  Configure nas CPEs (TR-069):
    ACS URL ........... http://$ACS_HOST:7547/
    Inform periódico .. 300 a 900 s
    (ZTE: marque TR069 no serviço da WAN que tem rota até este servidor)

  UI do GenieACS (técnico): só pela própria máquina — de outro computador:
    ssh -L 3000:127.0.0.1:3000 root@$ip_now   e abra http://localhost:3000  (usuário admin, senha em .env)

  Diagnóstico: $ZENIE_DIR/doctor.sh      Backup: $ZENIE_DIR/backup.sh      Atualizar: $ZENIE_DIR/update.sh
EOF
[ "$PANEL_HOST" = "$ip_now" ] || [[ "$PANEL_HOST" =~ ^[0-9.]+$ ]] || info "(o certificado do painel é autoassinado: o navegador vai pedir confirmação na primeira vez)"
