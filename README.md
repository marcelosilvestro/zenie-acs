# Zenie — ACS TR-069 + painel NOC para GenieACS

ACS TR-069 (GenieACS 1.2) com um painel NOC próprio para o atendimento de provedores de fibra: busca pelo
login PPPoE, serial ou MAC; ficha do equipamento com sinal óptico, WAN, Wi-Fi, mesh, clientes e diagnóstico;
ações auditadas com perfis atendente, NOC e admin; e um catálogo de modelos homologados.

## Instalação (servidor Linux zerado)

Uma linha, como root, num Debian 12/13 ou Ubuntu 22.04/24.04:

```bash
wget -O - https://raw.githubusercontent.com/marcelosilvestro/zenie-acs/main/instalar.sh | sudo bash
```

Ela baixa a versão publicada mais nova em `/opt/zenie` e roda o `./install.sh`, que faz as perguntas (endereço do
ACS, firewall, fuso, admin do painel). Manualmente:

```bash
git clone https://github.com/marcelosilvestro/zenie-acs.git /opt/zenie && cd /opt/zenie
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"
sudo ./install.sh
```

Depois de instalado, as atualizações são pelo painel: **Configurações › Atualização**.

Debian 12/13 ou Ubuntu 22.04/24.04. Requisitos, perguntas do instalador, firewall, backup e atualização estão em
**[docs/INSTALACAO.md](docs/INSTALACAO.md)**. Operação: `./doctor.sh`, `./backup.sh`, `./restore.sh`,
`./update.sh` e `./uninstall.sh`.

Documentação: [PRODUTO.md](docs/PRODUTO.md) (visão do produto), [PAINEL.md](docs/PAINEL.md) (painel),
[HOMOLOGACAO.md](docs/HOMOLOGACAO.md) (catálogo de modelos), [MODELOS.md](docs/MODELOS.md) (caminhos por modelo),
[OLT.md](docs/OLT.md), [SEGURANCA-ACS.md](docs/SEGURANCA-ACS.md), [CONFIGURACOES.md](docs/CONFIGURACOES.md),
[ATUALIZACAO.md](docs/ATUALIZACAO.md) e [LOG-ACS.md](docs/LOG-ACS.md).

## Estrutura

```
.
├── install.sh update.sh doctor.sh backup.sh restore.sh uninstall.sh   # instalação e operação
├── docker-compose.yml        # GenieACS + MongoDB + zenie-api + zenie-web
├── .env.example              # modelo do .env (o install.sh preenche)
├── deploy/                   # firewall (zenie-firewall), funções dos scripts, respostas de exemplo
├── zenie/api  zenie/web      # painel NOC (Fastify + React)
├── catalog/                  # catálogo oficial de modelos homologados (perfis + fotos)
├── docker/genieacs/          # Dockerfile da imagem GenieACS (npm oficial)
├── provisions/               # scripts de provision (*.js)          ┐
├── virtual-parameters/       # virtual parameters (*.js)            │ sincronizados com o
├── presets/                  # presets (*.json)                     │ GenieACS pelo
├── ui-config/config.json     # configuração da UI (chave -> valor)  ┘ scripts/genieacs_sync.py
├── ext/                      # extensões GenieACS (ex.: API RouterOS)
├── scripts/                  # utilitários (sync NBI, exportação de samples…)
├── docs/                     # documentação (OLT/OMCI, procedimentos, rollout)
└── instalar.sh               # instalador de uma linha (baixa a versão publicada e roda o install.sh)

# só no repositório de desenvolvimento (fora do público): samples/ (árvores reais por modelo), ops/ e .claude/
```

## Desenvolvimento (subida manual, sem o instalador)

Pré-requisitos: Docker Engine + plugin `docker compose`, Python 3.8+.

```bash
cp .env.example .env
# edite o .env:
#   GENIEACS_UI_JWT_SECRET -> openssl rand -hex 32
#   GENIEACS_FS_HOSTNAME   -> IP da VM que as ONUs de bancada alcançam
#   ADMIN_BIND_ADDR        -> 127.0.0.1 (túnel SSH) ou IP interno da VM
docker compose up -d --build
docker compose ps
docker compose logs -f genieacs-cwmp   # JSON, uma linha por evento (resumo no painel: Log do ACS)
```

> **CPU sem AVX?** MongoDB ≥ 5 não inicia (o container reinicia em loop, log com
> "illegal instruction"). Use `MONGO_IMAGE=mongo:4.4` no `.env`. No VMware, AVX
> aparece na VM se o EVC/compatibilidade do cluster permitir.

Primeiro acesso à UI: `http://<ADMIN_BIND_ADDR>:3000` (ou `ssh -L 3000:127.0.0.1:3000 usuario@vm`).
A UI abre o assistente de inicialização: crie o usuário admin e aceite os
provisions/presets/config padrão. **Depois rode `docker compose restart genieacs-ui`**:
os processos da UI guardam em cache o estado anterior à inicialização e o login
`admin`/`admin` falha de forma intermitente até reiniciar. Em seguida troque a senha
do admin e exporte tudo para o git (abaixo).

Teste rápido da NBI: `curl -s http://127.0.0.1:7557/devices/?projection=_id`

### Apontar uma ONU de bancada

Na ZTE (Gerência → TR-069): ACS URL `http://<ip-da-vm>:7547/`, inform periódico 300 s.
Ela deve aparecer em *Devices* na UI após o primeiro inform.

### Portas

| Porta | Serviço | Exposição |
|---|---|---|
| 7547 | CWMP (CPEs) | `CWMP_BIND_ADDR` — só rede de gerência/bancada |
| 7567 | File server (firmware) | `CWMP_BIND_ADDR` |
| 7557 | NBI (**sem autenticação**) | `ADMIN_BIND_ADDR` — nunca internet |
| 3000 | UI | `ADMIN_BIND_ADDR` — nunca internet |
| 27017 | MongoDB | não publicada |

## Painel Zenie

Serviços `zenie-api` (Node/Fastify — única peça que fala com a NBI) e `zenie-web` (React + nginx com HTTPS).
Acesso: `https://<ZENIE_PUBLIC_HOST>` (certificado autoassinado gerado na primeira subida; para usar um
certificado próprio, coloque `fullchain.pem` e `privkey.pem` no volume `zenie-tls`).

```bash
# primeiro administrador (senha temporária mostrada uma vez; troca obrigatória no 1º login)
docker compose exec zenie-api node dist/cli.js create-admin admin "Administrador"
# esqueceu a senha
docker compose exec zenie-api node dist/cli.js reset-password admin
```

Perfis: **atendente** (consulta, atualizar, Wi-Fi) · **NOC** (+ reboot, diagnósticos) · **admin** (tudo,
usuários, auditoria). Toda ação fica na auditoria. Desenvolvimento: `cd zenie/web && npm run dev`
(proxy de `/api` para `ZENIE_API`, padrão `http://localhost:8080`).

## Versionar a configuração (scripts/genieacs_sync.py)

Só biblioteca padrão do Python. Lê `GENIEACS_NBI_URL`, `GENIEACS_UI_URL`,
`GENIEACS_UI_USERNAME` e `GENIEACS_UI_PASSWORD` do ambiente ou do `.env`.

```bash
# servidor -> repositório
python3 scripts/genieacs_sync.py export
git diff                                   # revise antes de commitar

# repositório -> servidor (sempre rode --dry-run antes)
python3 scripts/genieacs_sync.py import --dry-run
python3 scripts/genieacs_sync.py import

# só alguns tipos
python3 scripts/genieacs_sync.py import --only virtual-parameters,provisions

# espelhar exatamente (APAGA no servidor o que não está no git)
python3 scripts/genieacs_sync.py import --prune --dry-run

# mudança que afeta clientes fora da tag "piloto" (regra D2, abaixo)
python3 scripts/genieacs_sync.py import --liberar
```

> **Regra D2:** o import **bloqueia** preset novo sem `Tags.piloto IS NOT NULL`, preset que deixa de ser
> piloto, preset geral alterado, provision alterado usado por preset geral e virtual parameter alterado.
> Só passa com `--liberar`. Servidor zerado (VM recriada): importar com `--liberar`.

Como funciona:
- **provisions**, **virtual-parameters**, **presets**: leitura e escrita pela NBI (7557).
- **ui-config**: leitura pela NBI; escrita pela API da UI (login com usuário/senha),
  porque a NBI do GenieACS 1.2 não grava a coleção `config`.
- O import só envia o que mudou (compara com o servidor) e é idempotente.
- Usuários e permissões da UI **não** são sincronizados (contêm hashes de senha).

> Testado contra um mock da NBI; **validar na VM de dev** contra o GenieACS real
> (principalmente o import de `ui-config` via API da UI).

## Plano, modelos e virtual parameters

- **[docs/PRODUTO.md](docs/PRODUTO.md)** — produto instalável por qualquer provedor: arquitetura, busca,
  instalador para Linux zerado, ordem de execução.
- **[docs/PAINEL.md](docs/PAINEL.md)** — painel NOC: análise do mockup, viabilidade por item, entregas P1–P4.
- **[docs/HOMOLOGACAO.md](docs/HOMOLOGACAO.md)** — catálogo de modelos homologados e o processo para cada modelo novo.
- **[docs/MODELOS.md](docs/MODELOS.md)** — inventário de modelos/firmwares e matriz de caminhos TR-069
  por informação. Gerado: `python3 scripts/compare_samples.py` (não editar à mão).

Virtual parameters ficam em `VirtualParameters.<nome>` e retornam `""` quando o equipamento não
tem o dado. Decimais saem como texto (`"-11.27"`): o GenieACS 1.2 não aceita `xsd:double`.
Testar contra um sample: `node scripts/test-vp.js samples/<arquivo>.json [VP ...]`.

### Configurar TR-069 nos equipamentos ZTE

- **ONUs (F6201B, F6600P, F670L)**: a WAN PPPoE vem da OLT via OMCI já com serviço `INTERNET_TR069_VoIP`.
  Basta em *Gerência → TR-069*: ACS URL `http://<ip-acs>:7547`, inform periódico 300 s.
- **Roteadores (H196A, H198A, H199A, H3601P)**: além da tela TR-069, em *Internet → WAN → (conexão PPPoE)*
  marcar **TR069** na *Lista de serviço* (fica `INTERNET_TR069`). Sem isso a
  "URL da solicitação de conexão" fica `http://0.0.0.0` e o roteador nunca contata o ACS.
