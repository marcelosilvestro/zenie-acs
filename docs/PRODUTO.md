# Zenie — ACS + Painel NOC instalável por qualquer provedor

Atualizado em 2026-10-07. Requisitos do usuário:
1. **Independente do MK-Auth** (por enquanto). Busca principal pelo **login PPPoE**, além de MAC, serial PON e serial.
2. **Tudo instalável em um Linux zerado**, por qualquer provedor — não só o nosso.

Complementa [PAINEL.md](PAINEL.md) (telas, viabilidade, P1–P4).

---

## 1. O que muda com "produto para outros provedores"

| Hoje (nossa instalação) | Produto |
|---|---|
| Scripts com IP da VM, repositório GitHub e chave SSH fixos (`scripts/vm/*`, `scripts/tunel-vm-teste.ps1`) | Instalador genérico; tudo que é do provedor vai para `.env`/configuração. Os scripts da nossa VM viram `ops/` (exemplo de uso, não parte do produto) |
| Assistente da UI do GenieACS feito à mão + `docker compose restart genieacs-ui` | Inicialização automática pelo instalador (admin, config padrão) |
| Imagens construídas na VM | Imagens publicadas em registry (GHCR) com versão; build local continua possível |
| Faixas de sinal, intervalo de inform, nome da empresa no código/docs | Configuráveis pelo painel (admin) e pelo `.env` |
| VPs e samples só de ZTE | Mesma estrutura; cada provedor contribui candidatos/samples dos seus modelos (processo de [HOMOLOGACAO.md](HOMOLOGACAO.md)). O que não tiver VP aparece "Não disponível" |
| Tag `piloto` = F6201B nossa | Conceito do produto: o admin marca quais equipamentos são piloto |

## 2. Arquitetura (docker compose, um servidor)

```
                Internet / rede do provedor
   CPEs ──7547/7567──►  genieacs-cwmp / genieacs-fs
   NOC  ──443 HTTPS──►  nginx ──► zenie-web (estático)
                              └──► zenie-api ──► genieacs-nbi (só rede interna do compose)
                                         │
                         mongo (genieacs + banco "zenie": usuários, auditoria, eventos, índice de busca, config)
   admin ──443/genieacs──► nginx ──► genieacs-ui (opcional, desligável)
```

- **Um único MongoDB** (bancos `genieacs` e `zenie`) — menos peças para quem instala.
- **zenie-api** (Node.js 24 LTS + TypeScript + Fastify): login, perfis, auditoria, limites, índice de busca,
  ações (atualizar, reboot, Wi-Fi). Única peça que fala com a NBI.
- **zenie-web** (React + Vite + TypeScript + Tailwind + Recharts), textos em pt-BR com estrutura para i18n.
- **nginx** com HTTPS: Let's Encrypt se o provedor tiver domínio; senão certificado autoassinado.
- NBI, MongoDB e UI do GenieACS **nunca** publicados para fora (NBI não tem autenticação).

## 3. Busca (requisito 1)

Índice próprio no banco `zenie` (coleção `inventario`), atualizado a cada poucos minutos e logo após cada
inform/ação, a partir dos virtual parameters — o painel não toca em caminhos TR-069.

| Chave de busca | Fonte | Observação |
|---|---|---|
| **Login PPPoE** (principal) | VP `PPPoEUsername` | busca por prefixo e por trecho, sem diferenciar maiúsculas |
| Serial PON (o da OLT) | VP `PonSerial` | só ONUs |
| Serial de fábrica | GenieACS `_deviceId._SerialNumber` | todos |
| MAC do equipamento | **VP novo `DeviceMacs`** (base `X_ZTE-COM_ALMAC`, WAN, LAN — os 3 existem nos 8 modelos) | aceita com ou sem `:`/`-` |
| IP WAN | VP `WanIP` | |
| Modelo / firmware | VPs | filtro, não busca principal |
| MAC de aparelho do cliente (celular etc.) | — | **fase posterior**: listas são sob demanda |

Resultado: lista com status (online/offline), modelo, PPPoE, RX colorido pela faixa do NOC → clique abre a ficha.

## 4. Instalador (requisito 2)

**Sistemas suportados**: Debian 12/13 e Ubuntu 22.04/24.04 (64 bits), servidor zerado, acesso root.

```bash
git clone https://github.com/<org>/<repo>.git /opt/acs && cd /opt/acs
sudo ./install.sh            # interativo; ou ./install.sh --config respostas.env (sem perguntas)
```

O `install.sh` faz, em ordem (idempotente — rodar de novo não quebra):
1. **Pré-checagens**: SO suportado, root, arquitetura, RAM (mín. 2 GB, recomendado 4 GB), disco, portas livres
   (7547, 7567, 443, 80), **CPU com AVX** (sem AVX → MongoDB 4.4 com aviso de que está fora de suporte).
2. **Perguntas** (com padrão sugerido): nome do provedor, endereço que as CPEs usam para chegar ao ACS
   (IP/hostname), redes que podem falar CWMP (ex.: `100.64.0.0/10`), domínio do painel (opcional, para Let's
   Encrypt), e-mail do admin, fuso horário.
3. Instala Docker oficial e utilitários.
4. Gera segredos (JWT, senhas internas) e escreve `.env` com permissão 600.
5. Firewall (nftables): 7547/7567 só das redes informadas; 443/80 abertos; resto fechado.
6. Sobe os containers (imagens do registry ou build local) e espera ficarem saudáveis.
7. Inicializa o GenieACS sem assistente manual (config padrão + usuário admin da UI) e importa provisions,
   virtual parameters e presets do repositório (`genieacs_sync.py import --liberar`).
8. Cria o **admin do painel** e mostra a senha gerada uma única vez.
9. Resumo final: URL do painel, ACS URL para configurar nas CPEs (`http://<endereço>:7547`), próximos passos.

Ferramentas que acompanham:

| Script | Função |
|---|---|
| `update.sh` | atualiza para uma versão (git tag), mostra o que muda nos provisions/VPs (`--dry-run`) antes de aplicar |
| `backup.sh` / `restore.sh` | `mongodump` dos dois bancos + `.env`; agendável no cron; restauração testada no CI |
| `doctor.sh` | diagnóstico: containers, portas, certificado, último inform recebido, faults recentes |
| `uninstall.sh` | remove containers (dados só com `--purge`) |

**Teste do instalador**: a cada mudança, rodar em VM limpa de cada SO suportado (pode ser na VM de teste
recriada). Critério: do zero ao painel funcionando, sem passo manual além das perguntas.

## 5. Configuração pelo admin no painel

- Empresa: nome, logo (aparece no painel).
- Faixas de classificação (RX, TX, temperatura, RSSI, CPU/memória) — padrão = faixa do nosso NOC (PAINEL.md 4).
- Intervalo de inform esperado (para calcular online/offline).
- Usuários e perfis (atendente / NOC / admin); política de senha; sessão expira.
- Equipamentos piloto (tag `piloto`).

## 6. Organização do repositório (alvo)

```
install.sh  update.sh  backup.sh  restore.sh  doctor.sh  uninstall.sh
docker-compose.yml          # produto: mongo, genieacs-*, zenie-api, zenie-web, nginx
deploy/                     # nginx (templates), firewall, systemd (opcional)
docker/genieacs/            # imagem GenieACS
zenie/api/  zenie/web/      # painel NOC Zenie
provisions/  virtual-parameters/  presets/  ui-config/   # "conteúdo" ACS, versionado
scripts/                    # sync, samples, gerador de VPs, test-vp
samples/  docs/
ops/                        # NOSSA instalação (VM de teste, túnel, deploy key) — exemplo, fora do produto
.claude/                    # memória/skills/agents do Claude
```

## 7. Ordem de execução

| # | Entrega | Aceite |
|---|---|---|
| 1 | ✅ VP `DeviceMacs` + reorganizar repo (`ops/`, sem dados fixos nos scripts do produto) | ✅ samples OK; nada nosso fora de `ops/` |
| 2 | ✅ Esqueleto do painel: compose com zenie-api, zenie-web (nginx HTTPS autoassinado); login + perfis + auditoria | ✅ 2026-10-07: testado ponta a ponta na VM (perfis, troca de senha obrigatória, auditoria, HTTPS) |
| 3 | ✅ Índice de busca + tela de busca (PPPoE, serial PON, serial, MAC, IP) | ✅ 2026-10-07: os 8 equipamentos achados por todas as chaves; sync de 8 equipamentos em 81 ms |
| 4 | ✅ Ficha do equipamento: Resumo, Status (óptico com faixa do NOC), Rede, Wi-Fi, Clientes; Atualizar e Reboot | ✅ 2026-10-07: API testada nos equipamentos reais (atualizar 2,2 s, clientes 5,1 s, reboot na F6201B); validado pelo usuário nas telas (prints de 2026-10-07) |
| 5 | ✅ `install.sh` + `doctor.sh` + `backup.sh`/`restore.sh` + `update.sh` + `uninstall.sh` + firewall (`docs/INSTALACAO.md`) | ✅ 2026-10-07: VM de teste limpa (Debian 13, sem AVX → Mongo 4.4); instalação do zero sem passo manual, reinstalação idempotente, restauração do backup (9 equipamentos voltaram), update e firewall testados. **Ubuntu 24.04 ainda não testado** |
| 6 | `update.sh`, imagens no GHCR, documentação de instalação para terceiros | outro provedor instala seguindo só o README |
| 7 | **Suporte a TR-181** nos virtual parameters (candidatos `Device.*`: WiFi.Radio/SSID/AccessPoint, PPP, IP, Hosts, Ethernet, DeviceInfo) e adaptador de unificação `tplink-bandsteering` | amostra TP-Link EC230-G1 TR-181 com o painel completo (regressão TR-098 inalterada) |

A VM de teste atual continua sendo o ambiente de desenvolvimento; ela será **recriada do zero com o
`install.sh`** no item 5 — é o teste de verdade do instalador (os 7 clientes reais voltam sozinhos assim que o
ACS sobe no mesmo IP).

## 8. Decisões

| # | Decisão |
|---|---|
| P-1 | **Licença AGPL-3.0** (mesma do GenieACS) — decidido 2026-10-07 |
| P-2 | **Repositório público** quando o instalador (item 5) estiver pronto; revisar samples antes — decidido |
| P-4 | **Debian 12/13 e Ubuntu 22.04/24.04** — decidido |
| P-3 | **Nome: Zenie** (Z de ZTE + enie de Genie) — decidido 2026-10-07. Subtítulo: "painel NOC para GenieACS". Não usar as marcas "ZTE"/"GenieACS" no nome; serviços: `zenie-api`, `zenie-web` |
