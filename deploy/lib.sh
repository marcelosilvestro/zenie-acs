# Funções comuns dos scripts de operação do Zenie (install.sh, update.sh, doctor.sh, backup.sh...).
# Uso: . "$(dirname "$0")/deploy/lib.sh"   (a partir da raiz do repositório)

# shellcheck shell=bash

ZENIE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ZENIE_DIR/.env"
COMPOSE=(docker compose --project-directory "$ZENIE_DIR")

if [ -t 1 ]; then
  C_B=$'\e[1m'; C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_0=$'\e[0m'
else
  C_B=""; C_OK=""; C_WARN=""; C_ERR=""; C_0=""
fi

step() { printf '\n%s==> %s%s\n' "$C_B" "$*" "$C_0"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✔%s %s\n' "$C_OK" "$C_0" "$*"; }
warn() { printf '    %s⚠ %s%s\n' "$C_WARN" "$*" "$C_0"; }
fail() { printf '    %s✘ %s%s\n' "$C_ERR" "$*" "$C_0"; }
die()  { printf '\n%sERRO: %s%s\n' "$C_ERR" "$*" "$C_0" >&2; exit 1; }

need_root() { [ "$(id -u)" -eq 0 ] || die "rode como root (sudo $0)"; }

# Lê KEY do .env (sem executar o arquivo).
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1
}

# Grava KEY=VALUE no .env (substitui se existir). Valores sem aspas, sem quebra de linha.
env_set() {
  local key="$1" value="$2"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -q "^$key=" "$ENV_FILE"; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

# Pergunta com valor padrão (lê do terminal mesmo com stdin redirecionado). Em modo não interativo, usa o padrão.
ask() {
  local prompt="$1" default="$2" answer=""
  if [ "${ZENIE_NONINTERACTIVE:-0}" = 1 ] || [ ! -r /dev/tty ]; then
    printf '%s' "$default"
    return
  fi
  read -r -p "    $prompt [$default]: " answer </dev/tty || true
  printf '%s' "${answer:-$default}"
}

confirm() {
  local prompt="$1" answer=""
  [ "${ZENIE_NONINTERACTIVE:-0}" = 1 ] && return 0
  read -r -p "    $prompt [s/N]: " answer </dev/tty || true
  [[ "$answer" =~ ^[sSyY] ]]
}

# IP de saída padrão da máquina.
default_ip() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") print $(i+1)}' | head -n1; }

# Interfaces físicas/externas (sem loopback e sem as do Docker).
external_ifaces() {
  ip -o link show | awk -F': ' '{print $2}' | sed 's/@.*//' | grep -Ev '^(lo|docker[0-9]*|br-.*|veth.*|virbr.*)$' || true
}

valid_cidr_list() {
  local n
  for n in $1; do
    [[ "$n" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/([0-9]|[12][0-9]|3[0-2]))?$ ]] || return 1
  done
}

# IP contido em alguma rede da lista? (IPv4)
ip_in_nets() {
  local ip="$1" nets="$2"
  python3 - "$ip" "$nets" <<'PY'
import ipaddress, sys
ip = ipaddress.ip_address(sys.argv[1])
sys.exit(0 if any(ip in ipaddress.ip_network(n, strict=False) for n in sys.argv[2].split()) else 1)
PY
}

mongo_eval() {
  # Avalia JS no MongoDB do compose (mongosh no Mongo >= 6, mongo no 4.4).
  "${COMPOSE[@]}" exec -T mongo sh -c 'if command -v mongosh >/dev/null; then mongosh --quiet "$1" --eval "$2"; else mongo --quiet "$1" --eval "$2"; fi' _ "$1" "$2" </dev/null
}

wait_http() {
  local url="$1" seconds="${2:-120}" i
  for ((i = 0; i < seconds; i += 2)); do
    curl -fsk -o /dev/null --max-time 3 "$url" && return 0
    sleep 2
  done
  return 1
}

# Senha do admin da UI do GenieACS: hash PBKDF2-SHA512 igual ao do GenieACS, gravado direto no banco.
set_ui_password() {
  local pass="$1" salt hash
  read -r salt hash < <("${COMPOSE[@]}" exec -T genieacs-ui node -e '
    const c = require("crypto");
    const s = c.randomBytes(64).toString("hex");
    console.log(s, c.pbkdf2Sync(process.argv[1], s, 10000, 128, "sha512").toString("hex"));' "$pass" </dev/null)
  [ "${#salt}" = 128 ] && [ "${#hash}" = 256 ] || die "falha ao gerar o hash da senha da UI"
  mongo_eval genieacs "db.users.updateOne({_id: 'admin'}, {\$set: {salt: '$salt', password: '$hash'}})" >/dev/null
  # A UI guarda usuários em cache: reinicia para valer a senha nova.
  "${COMPOSE[@]}" restart genieacs-ui >/dev/null 2>&1
  wait_http "http://127.0.0.1:3000/" 60 || die "a UI do GenieACS não voltou"
}
ui_login_ok() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json'     --data "$(python3 -c 'import json,sys; print(json.dumps({"username":"admin","password":sys.argv[1]}))' "$1")" http://127.0.0.1:3000/login)"
  [ "$code" = 200 ]
}

# Garante que a senha GENIEACS_UI_PASSWORD do .env entra na UI do GenieACS (regrava se preciso).
ensure_ui_password() {
  local pass
  pass="$(env_get GENIEACS_UI_PASSWORD)"
  if [ -z "$pass" ]; then
    pass="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
    env_set GENIEACS_UI_PASSWORD "$pass"
  fi
  ui_login_ok "$pass" && return 0
  for _ in 1 2 3; do
    set_ui_password "$pass"
    ui_login_ok "$pass" && return 1
    sleep 3
  done
  die "não foi possível definir a senha do admin da UI do GenieACS"
}

# Agente do host (Configurações > Redes e túnel Cloudflare): serviço systemd zenie-hostd, socket em /run/zenie.
install_hostd() {
  sed "s#ZENIE_DIR#$ZENIE_DIR#g" "$ZENIE_DIR/deploy/hostd/zenie-hostd.service" >/etc/systemd/system/zenie-hostd.service
  systemctl daemon-reload
  systemctl enable zenie-hostd >/dev/null 2>&1
  systemctl restart zenie-hostd
}
