# Configurações do servidor (admin)

Menu **Configurações**, só para o perfil admin. Cada mudança fica registrada na auditoria.

## Como funciona

O painel roda em containers e não tem acesso ao servidor. As mudanças passam pelo **agente do host**
`zenie-hostd` (`deploy/hostd/zenie-hostd.py`, serviço systemd instalado pelo `install.sh` e pelo `update.sh`):

- Atende só a API do Zenie, pelo socket `/run/zenie/hostd.sock` (`root:47547`, modo 660). O socket é montado apenas no container `zenie-api`, que é o único a receber o grupo 47547 (`group_add`). Nenhum usuário do host tem esse GID.
- Aceita uma lista fechada de comandos (`network.get/apply/confirm`, `tunnel.get/set`).
- Valida tudo de novo: nada chega ao shell como texto livre.
- Testes: `python3 deploy/hostd/test_hostd.py`.
- Sem o agente (instalação antiga ou serviço parado), a tela pede para rodar `./update.sh`.

## Redes

- Mostra as interfaces, os endereços, o gateway e o DNS atuais.
- Permite mudar IP, máscara (`255.255.255.0` ou `/24`), gateway padrão (um só) e DNS (até 3), e criar ou remover VLANs.
- Sistemas suportados:
  - **Debian (ifupdown)**: gera `/etc/network/interfaces` e grava o DNS em `/etc/resolv.conf`. Só as interfaces cujo bloco mudou são derrubadas e levantadas; acrescentar uma VLAN não mexe na interface principal.
  - **Ubuntu (netplan)**: grava `/etc/netplan/01-zenie.yaml` e tira os outros arquivos do caminho (ficam no backup). **Ainda não validado numa VM Ubuntu.**
- **Reversão automática**:
  1. O agente guarda a configuração atual em `/var/lib/zenie-hostd/backup-*`.
  2. Aplica a nova 2 s depois de responder.
  3. Se ninguém confirmar em **120 s**, volta sozinho à anterior. Isso também vale se o agente reiniciar no meio do prazo.
- Se o IP por onde você acessa mudou, a tela mostra o link do novo endereço com o código de confirmação. Abra o link, entre e clique em **Confirmar** dentro do prazo.
- Ao tirar o IP do ACS (`GENIEACS_FS_HOSTNAME`) do servidor, a tela avisa em vermelho: as CPEs apontam para `http://<IP>:7547`.

## Horário

- Mostra o relógio do servidor ao vivo (no fuso dele e em UTC), se está sincronizado, com qual servidor e a diferença.
- **Fuso horário**: os do Brasil vêm primeiro; o padrão é `America/Sao_Paulo`. Vale para o sistema (logs, horário do
  backup diário) e vai para o `TZ` do `.env`. Os containers trabalham em UTC e o painel mostra no fuso do navegador,
  então trocar o fuso não reinicia nada.
- **Servidores NTP** (até 5), padrão **NTP.br** (`a/b/c/d.st1.ntp.br`), com **Testar** em cada um: consulta SNTP
  direta (UDP 123) que mostra estrato, atraso e diferença, sem mexer no relógio. Erros comuns: nome não resolvido
  (DNS do servidor) e sem resposta (UDP 123 bloqueado).
- Funciona com **chrony** (grava `/etc/chrony/sources.d/zenie.sources` e comenta os `pool`/`server` do
  `chrony.conf`, com cópia em `/var/lib/zenie-hostd/chrony.conf.antes-zenie`) e com **systemd-timesyncd** (grava
  `/etc/systemd/timesyncd.conf.d/zenie.conf`).
- Instalação nova: o `install.sh` já põe o NTP.br (`zenie-hostd.py time-default`). O `update.sh` não mexe no NTP.

## Túnel Cloudflare

Funciona como o "Cloudflare Zero" do MK-Auth: **Ativar**, colar o **Token** e **Gravar**.

- O token é a parte `eyJ…` do comando de instalação. Pode colar o comando inteiro: o Zenie extrai o token.
- O token fica no `.env` (`ZENIE_TUNNEL_TOKEN`, permissão 600). A tela só mostra o final dele.
- Ligar o túnel acrescenta o perfil `tunnel` em `COMPOSE_PROFILES` no `.env` e sobe o container `cloudflared` (imagem `cloudflare/cloudflared:2026.9.3`).
- O container fica numa rede Docker **só com o `zenie-web`**. Pelo túnel não se alcança a NBI, a UI do GenieACS nem o MongoDB.
- Na Cloudflare (Zero Trust › Networks › Tunnels), configure o Public Hostname com o serviço **HTTPS**, URL `zenie-web` (não `localhost`: dentro do container o localhost é o próprio cloudflared — erro 502), e ligue **No TLS Verify**, porque o certificado do painel é autoassinado. Se a URL estiver errada, a tela avisa.
