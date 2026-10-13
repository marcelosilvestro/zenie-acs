#!/usr/bin/env bash
# Instalador de uma linha do Zenie (ACS TR-069 + painel NOC). Num Debian 12/13 ou Ubuntu 22.04/24.04 zerado:
#
#   curl -fsSL https://raw.githubusercontent.com/marcelosilvestro/zenie-acs/main/instalar.sh | sudo bash
#   (ou: wget -O - https://raw.githubusercontent.com/marcelosilvestro/zenie-acs/main/instalar.sh | sudo bash —
#    o Debian mínimo não vem com wget; o curl vem)
#
# Baixa a versão publicada mais nova (tag vX.Y.Z) em /opt/zenie e roda o ./install.sh, que faz as perguntas.
# Variáveis opcionais: ZENIE_DIR (padrão /opt/zenie), ZENIE_VERSION (ex.: v0.1.0), ZENIE_REPO.
# Tudo fica dentro de main(): com "wget | bash" o bash lê o script pelo pipe, e nada pode consumir o resto dele.

main() {
  set -euo pipefail
  local repo="${ZENIE_REPO:-https://github.com/marcelosilvestro/zenie-acs.git}"
  local dir="${ZENIE_DIR:-/opt/zenie}"
  local version="${ZENIE_VERSION:-}"

  echo "==> Zenie: instalador"
  [ "$(id -u)" -eq 0 ] || { echo "rode como root: ... | sudo bash"; exit 1; }
  command -v apt-get >/dev/null || { echo "sistema sem apt-get: o Zenie suporta Debian 12/13 e Ubuntu 22.04/24.04"; exit 1; }

  # Instalado de verdade = tem .env. Só o código baixado (tentativa anterior que parou no meio): reaproveita.
  if [ -e "$dir/.env" ]; then
    echo "já existe uma instalação em $dir."
    echo "  atualizar: painel > Configurações > Atualização (ou: cd $dir && sudo ./update.sh)"
    echo "  reinstalar do zero: sudo $dir/uninstall.sh e rode este instalador de novo"
    exit 0
  fi

  # Relógio: VM nova costuma vir com a hora errada (ex.: horário local tratado como UTC). Com mais de 5 min de
  # diferença, o apt recusa as assinaturas ("Not live until ...") e o TLS pode falhar. Acerta pela hora de um
  # servidor HTTP (cabeçalho Date) antes de tudo; o NTP (NTP.br) é configurado depois pelo install.sh.
  local remote now skew
  remote="$(curl -sI --max-time 10 http://deb.debian.org/ 2>/dev/null | sed -n 's/^[Dd]ate: //p' | tr -d '\r')"
  if [ -n "$remote" ] && remote="$(date -u -d "$remote" +%s 2>/dev/null)"; then
    now="$(date -u +%s)"
    skew=$(( remote > now ? remote - now : now - remote ))
    if [ "$skew" -gt 300 ]; then
      echo "==> Relógio do servidor estava $(( skew / 60 )) min errado: acertando ($(date -u -d "@$remote" '+%d/%m/%Y %H:%M') UTC)"
      date -u -s "@$remote" >/dev/null
      command -v hwclock >/dev/null && hwclock --systohc --utc >/dev/null 2>&1 || true
    fi
  fi

  echo "==> Pacotes base (git)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq </dev/null
  apt-get install -y -qq git ca-certificates curl </dev/null >/dev/null

  if [ -z "$version" ]; then
    version="$(git ls-remote --tags --refs --sort=-v:refname "$repo" 'v*' </dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)"
    [ -n "$version" ] || { echo "nenhuma versão publicada encontrada em $repo"; exit 1; }
  fi
  if [ -d "$dir/.git" ]; then
    echo "==> Reaproveitando o download anterior em $dir ($version)"
    git -C "$dir" fetch --quiet --tags "$repo" </dev/null
  else
    echo "==> Baixando o Zenie $version"
    git clone --quiet "$repo" "$dir" </dev/null
  fi
  git -C "$dir" -c advice.detachedHead=false checkout --quiet --force "$version"

  echo "==> Instalando (responda as perguntas a seguir)"
  cd "$dir"
  # Terminal disponível de verdade (abrir, não só existir: via ssh sem -t o /dev/tty existe mas não abre).
  if { : </dev/tty; } 2>/dev/null; then
    exec bash ./install.sh </dev/tty  # "bash": não depende do bit de execução do arquivo
  fi
  echo "sem terminal interativo: rode com respostas prontas -> cd $dir && cp deploy/respostas.env.example respostas.env (ajuste) && sudo ./install.sh --config respostas.env"
  exit 1
}

main "$@"
