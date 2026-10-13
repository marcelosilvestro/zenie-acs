#!/usr/bin/env bash
# Instalador de uma linha do Zenie (ACS TR-069 + painel NOC). Num Debian 12/13 ou Ubuntu 22.04/24.04 zerado:
#
#   wget -O - https://raw.githubusercontent.com/marcelosilvestro/zenie-acs/main/instalar.sh | sudo bash
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

  if [ -e "$dir/.env" ] || [ -d "$dir/.git" ]; then
    echo "já existe uma instalação em $dir."
    echo "  atualizar: painel > Configurações > Atualização (ou: cd $dir && sudo ./update.sh)"
    echo "  reinstalar do zero: sudo $dir/uninstall.sh e rode este instalador de novo"
    exit 0
  fi

  echo "==> Pacotes base (git)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq </dev/null
  apt-get install -y -qq git ca-certificates curl </dev/null >/dev/null

  if [ -z "$version" ]; then
    version="$(git ls-remote --tags --refs --sort=-v:refname "$repo" 'v*' </dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)"
    [ -n "$version" ] || { echo "nenhuma versão publicada encontrada em $repo"; exit 1; }
  fi
  echo "==> Baixando o Zenie $version"
  git clone --quiet "$repo" "$dir" </dev/null
  git -C "$dir" -c advice.detachedHead=false checkout --quiet "$version"

  echo "==> Instalando (responda as perguntas a seguir)"
  cd "$dir"
  if [ -r /dev/tty ]; then
    exec ./install.sh </dev/tty
  fi
  echo "sem terminal interativo: rode com respostas prontas -> cd $dir && cp deploy/respostas.env.example respostas.env (ajuste) && sudo ./install.sh --config respostas.env"
  exit 1
}

main "$@"
