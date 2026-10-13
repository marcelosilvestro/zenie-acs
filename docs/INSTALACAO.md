# Instalação do Zenie

Zenie = ACS TR-069 (GenieACS 1.2) + painel NOC para o atendimento de provedores. Tudo roda em containers
Docker num único servidor.

## Requisitos

| Item | Mínimo | Recomendado |
|---|---|---|
| Sistema | Debian 12/13 ou Ubuntu 22.04/24.04, 64 bits (x86_64 ou arm64), recém-instalado | Debian 13 |
| CPU | 2 vCPU | 4 vCPU **com AVX** (sem AVX o MongoDB fica na 4.4, fora de suporte) |
| Memória | 2 GB | 4 GB |
| Disco | 8 GB livres | 20 GB+ (SSD) |
| Rede | IP fixo alcançável pelas CPEs na porta 7547 | rede interna/VPN para o painel |
| Acesso | root (ou sudo) e internet para baixar pacotes e imagens | — |

As portas 7547, 7567, 80 e 443 precisam estar livres.

> VMware: a AVX só aparece na VM se o EVC/compatibilidade de CPU permitir. Confira com `grep -c avx /proc/cpuinfo`.

## Instalar

```bash
apt-get update && apt-get install -y git
git clone <url-do-repositório> /opt/zenie
cd /opt/zenie
sudo ./install.sh
```

O instalador pergunta:

| Pergunta | Exemplo | Para que serve |
|---|---|---|
| Nome do provedor | Minha Fibra | aparece no painel |
| Endereço que as CPEs usam | `10.0.0.10` | vira o **ACS URL** `http://10.0.0.10:7547/` e o endereço de download de firmware |
| Redes que falam com o ACS | `100.64.0.0/10 10.0.0.0/8` | firewall da porta 7547/7567 (pools PPPoE/CGNAT, gerência) |
| Endereço do painel | `10.0.0.10` ou `acs.minhafibra.net` | nome no certificado HTTPS |
| Quem abre o painel | `any` | firewall do 443/80: `any` = qualquer origem (filtro no firewall do provedor) ou lista de redes |
| Fuso horário | America/Sao_Paulo | horários do servidor |
| Usuário admin do painel | admin | senha temporária gerada e mostrada **uma vez** no fim |

O instalador faz, em ordem:
1. Checa sistema, memória, disco, AVX e portas.
2. Instala o Docker oficial.
3. Cria o `.env` com segredos aleatórios (permissão 600).
4. Liga o firewall das portas publicadas (serviço `zenie-firewall`).
5. Compila as imagens e sobe os containers.
6. Inicializa o GenieACS sem passo manual: usuário da UI com senha aleatória no `.env`, mais provisions, virtual parameters, presets e configuração da UI vindos do repositório.
7. Cria o admin do painel.
8. Agenda o backup diário, se você quiser.

**Sem perguntas** (automação):
```bash
cp deploy/respostas.env.example respostas.env   # ajuste
sudo ./install.sh --config respostas.env
```

**Certificado próprio** (padrão: autoassinado — o navegador pede confirmação na 1ª vez):
```bash
sudo ./install.sh --cert /caminho/fullchain.pem --key /caminho/privkey.pem
```
Let's Encrypt não vem pronto de propósito: o desafio HTTP exige o painel acessível da internet. Use um
certificado da sua CA interna ou um curinga do seu domínio.

Rodar o `install.sh` de novo é seguro: ele mantém segredos, senhas e dados, e só atualiza endereços e redes.

## Depois de instalar

1. Abra `https://<endereço-do-painel>/`, entre com o admin e troque a senha. Crie os usuários em **Usuários**.
   Os perfis são atendente, NOC e admin.
2. Configure as CPEs:
   - **ACS URL** `http://<endereço>:7547/`;
   - inform periódico de **300 a 900 s**;
   - usuário e senha do ACS: os da CPE (o GenieACS aceita qualquer um por padrão);
   - nas ZTE, marque **TR069 no serviço da WAN** que tem rota até o servidor. Pela OLT (OMCI) dá para aplicar
     em massa.
3. Em poucos minutos os equipamentos aparecem em **Dispositivos**. Modelos fora do catálogo aparecem como
   "não homologados": dá para ver tudo, mas alterações ficam bloqueadas (veja [HOMOLOGACAO.md](HOMOLOGACAO.md)).
4. **Piloto**: marque 1 a 3 equipamentos de bancada com a tag `piloto` na UI do GenieACS antes de mexer em
   provisions. Mudanças de configuração são liberadas primeiro para eles.

## Operação

| Comando | O que faz |
|---|---|
| `sudo ./doctor.sh` | diagnóstico: containers, portas, firewall, certificado, último inform, faults, disco, NTP, backup |
| `sudo ./backup.sh` | backup dos bancos + `.env` + certificado em `backups/` (14 dias). **Copie para fora do servidor** |
| `sudo ./restore.sh backups/zenie-….tar.gz` | restaura (substitui os bancos). Em servidor novo: `install.sh` primeiro |
| `sudo ./update.sh` | backup → código novo → containers → conteúdo do ACS (com trava de release) → diagnóstico |
| `sudo ./uninstall.sh [--purge]` | remove containers, firewall e cron (`--purge` apaga também os dados) |

UI técnica do GenieACS (presets, faults, tags): só na própria máquina, por túnel SSH:
`ssh -L 3000:127.0.0.1:3000 root@<servidor>` e abra `http://localhost:3000`. Usuário `admin`, senha em
`GENIEACS_UI_PASSWORD` no `.env`.

## Segurança

- **Nunca publicados para fora**: a NBI do GenieACS (7557, sem autenticação), a UI do GenieACS (3000) e o MongoDB.
- **Firewall `zenie-firewall`** (cadeia `DOCKER-USER`):
  - 7547/7567: por padrão de qualquer origem (`ZENIE_CWMP_ALLOW=any`). O filtro por IP fica no firewall do
    provedor, porque há CPEs com IP público, CGNAT e instalações que atendem vários provedores. Quem quiser filtrar
    aqui põe uma lista de redes;
  - 443/80 (painel): também de qualquer origem por padrão (`ZENIE_PANEL_ALLOW=any`), com o filtro no firewall do
    provedor. Quem quiser filtrar aqui põe uma lista de redes;
  - vale só para o que entra pelas interfaces externas: não atrapalha o ACS chamando as CPEs (connection request);
  - não mexe no SSH nem em outros serviços do servidor;
  - para mudar as redes: edite `ZENIE_CWMP_ALLOW` / `ZENIE_PANEL_ALLOW` no `.env` e rode `systemctl restart zenie-firewall`.
- O painel exige login, com perfis por função e auditoria de todas as ações.
  As senhas são guardadas com scrypt, e a sessão vai num cookie httpOnly com HTTPS.
- Mantenha o sistema atualizado (`apt upgrade`) e o Zenie também (`./update.sh`).

## Problemas comuns

| Sintoma | Verifique |
|---|---|
| Nenhum equipamento aparece | a CPE alcança `http://<endereço>:7547/`? Se `ZENIE_CWMP_ALLOW` for uma lista, a rede da CPE está nela (CPE com IP público fica de fora de uma lista só com CGNAT)? Na ZTE, o TR069 está marcado na WAN certa? `./doctor.sh` |
| "Atualizar" não responde | o connection request exige que o servidor alcance o IP da CPE (rota até o pool CGNAT/PPPoE) |
| Painel não abre | se `ZENIE_PANEL_ALLOW` for uma lista, seu IP está nela? O firewall do provedor libera o 443? `systemctl status zenie-firewall` |
| Erro de AVX / Mongo reiniciando | CPU sem AVX: o instalador já usa o Mongo 4.4; em VM, ative a AVX |
