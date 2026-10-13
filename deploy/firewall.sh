#!/usr/bin/env bash
# Firewall do Zenie para as portas publicadas pelo Docker (cadeia DOCKER-USER).
#
# Por que DOCKER-USER: o Docker publica as portas por DNAT; esse tráfego passa pelo FORWARD, não pelo INPUT
# do host — regras comuns de INPUT (ufw/nftables do host) NÃO filtram containers.
# Regras só para o que ENTRA pelas interfaces externas: o tráfego que sai dos containers (ex.: o ACS fazendo
# connection request na porta 7547 das CPEs) não é afetado. O host (SSH etc.) não é tocado.
#
#   7547 (CWMP) e 7567 (download de firmware) -> ZENIE_CWMP_ALLOW: "any" (padrão) = qualquer origem, o filtro por
#                                               IP fica no firewall do provedor (CPEs com IP público, CGNAT, outros
#                                               provedores); ou uma lista de redes para filtrar aqui
#   443 / 80 (painel)                        -> ZENIE_PANEL_ALLOW: "any" (padrão) = qualquer origem, o filtro por IP
#                                               fica no firewall do provedor; ou uma lista de redes para filtrar aqui
#   NBI (7557), UI do GenieACS (3000) e MongoDB já não são publicados para fora (127.0.0.1 / rede interna).
#
# Uso: deploy/firewall.sh apply | remove | show      (o serviço zenie-firewall chama "apply" após o Docker subir)
set -euo pipefail
. "$(dirname "$0")/lib.sh"

CHAIN=ZENIE

remove() {
  local rule
  while rule="$(iptables -S DOCKER-USER 2>/dev/null | grep -- "-j $CHAIN" | head -n1)" && [ -n "$rule" ]; do
    # shellcheck disable=SC2086
    iptables ${rule/-A/-D}
  done
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
}

apply() {
  local cwmp panel
  cwmp="$(env_get ZENIE_CWMP_ALLOW)"
  panel="$(env_get ZENIE_PANEL_ALLOW)"
  [ -n "$cwmp" ] && [ -n "$panel" ] || die "defina ZENIE_CWMP_ALLOW e ZENIE_PANEL_ALLOW no .env"
  [ "$cwmp" = "any" ] || valid_cidr_list "$cwmp" || die "ZENIE_CWMP_ALLOW inválido: $cwmp (use any ou uma lista de redes)"
  [ "$panel" = "any" ] || valid_cidr_list "$panel" || die "ZENIE_PANEL_ALLOW inválido: $panel (use any ou uma lista de redes)"
  iptables -n -L DOCKER-USER >/dev/null 2>&1 || die "cadeia DOCKER-USER não existe (o Docker está rodando?)"

  remove
  iptables -N "$CHAIN"
  iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  local port net
  if [ "$cwmp" != "any" ]; then
    for port in 7547 7567; do
      for net in $cwmp; do iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" -s "$net" -j RETURN; done
      iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" -j DROP
    done
  fi
  if [ "$panel" != "any" ]; then
    for port in 443 80; do
      for net in $panel; do iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" -s "$net" -j RETURN; done
      iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$port" -j DROP
    done
  fi
  iptables -A "$CHAIN" -j RETURN

  local ifc
  for ifc in $(external_ifaces); do
    iptables -I DOCKER-USER -i "$ifc" -j "$CHAIN"
  done
  echo "zenie-firewall: CWMP de [$([ "$cwmp" = any ] && echo "qualquer origem" || echo "$cwmp")]; painel de [$([ "$panel" = any ] && echo "qualquer origem" || echo "$panel")]; interfaces: $(external_ifaces | tr '\n' ' ')"
}

case "${1:-}" in
  apply) apply ;;
  remove) remove; echo "zenie-firewall: regras removidas" ;;
  show) iptables -S DOCKER-USER; iptables -S "$CHAIN" 2>/dev/null || echo "(cadeia $CHAIN ausente)" ;;
  *) echo "uso: $0 apply|remove|show"; exit 2 ;;
esac
