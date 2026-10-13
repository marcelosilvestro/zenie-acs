# Painel NOC — análise do prompt/mockup e plano de implementação

Atualizado em 2026-10-07. Base: `prompt_gpt.md` (prompt gerado pelo ChatGPT) + 2 mockups da tela de detalhes
do dispositivo. Usa os virtual parameters de `virtual-parameters/`.

---

## 1. Leitura crítica do prompt

**O que o prompt acerta e vamos manter**
- UI recebe dados **normalizados**, nunca caminhos TR-069; "Não disponível" em vez de `NaN`/`null`.
- Esconder o que o modelo não suporta; mostrar só o que é útil para o NOC (não virar dump de parâmetros).
- Abas com carregamento sob demanda; botão "Atualizar" com "atualizado há X s"; sem dado simulado.
- Classificação Normal/Atenção/Crítico com limites configuráveis; confirmação em ação destrutiva.
- Estados de tela: carregando, vazio, erro, offline, não suportado.
- Prioridade do NOC: está OK? → óptico → internet → Wi-Fi → clientes → histórico → ações.

**O que não se aplica ou precisa ser corrigido**

| Ponto do prompt | Realidade do nosso projeto |
|---|---|
| "Analise o projeto atual / evolua a tela existente" | **Não existe painel.** A UI do GenieACS (Mithril, configurável por `ui-config`) não comporta essa tela — é preciso um **painel próprio** (decisão D5, seção 2) |
| "Normalizadores por fabricante (ZTE, Huawei, FiberHome, Intelbras)" | A normalização **já existe** nos 32 virtual parameters do GenieACS (validados em 8 modelos ZTE). O painel só mapeia `VirtualParameters.*` → modelo de tela. Huawei/FiberHome/Intelbras não estão na nossa base; TP-Link/MikroTik entram como novos candidatos nos VPs |
| OLT, slot, PON, ONU ID, distância | **Não vêm por TR-069** — só da OLT (módulo OLT) |
| Gráfico de tráfego / uso Wi-Fi ao longo do tempo | GenieACS guarda só o valor atual. Histórico = fase 6 (Prometheus). Até lá: valor **instantâneo** (delta de contadores) ou "Sem dados de tráfego" |
| Aba Logs com "Perda de sinal óptico", "Mudança de canal"… | GenieACS **não tem log de eventos por equipamento**. Precisamos construir (seção 5, P3) |
| "Cliente: João Silva" | Nome do cliente **não está na CPE** — vem do sistema de gestão (ERP) pelo login PPPoE |
| "Banco de Dados 1.0", "Versão TR-069 1.0", "Modo de Operação: Bridge" | Ruído para o NOC — fora |
| Velocidade da porta LAN (1000 Mbps) | `MaxBitRate` é só o configurado ("Auto"); a negociada vem de `PhyBitRate`/`X_ZTE-COM_Speed`/`X_ZTE-Speed` (todos menos H198A) — porta a 100 Mbps com plano maior é diagnóstico útil |
| Editar IP LAN, máscara, gateway, DHCP pelo NOC | Risco alto (cliente perde acesso) e uso raro → fora do escopo inicial |
| Factory reset, senha de admin | Factory reset só para perfil admin; senha de admin só existe na F670L V1.1 → fora por enquanto |
| Mockup: F6600P com Wi-Fi "802.11 b/g/n" e criptografia "WPA2-PSK (AES)" fixa | Nossa F6600P é Wi-Fi 6 com WPA3/SAE disponível — mostrar o que a CPE reporta |

## 2. Decisão D5 — painel próprio

A UI do GenieACS não faz abas, cards, escala de sinal, classificação de RSSI, ações com confirmação por perfil
nem log de auditoria. Proposta:

```
Navegador (NOC) ──HTTPS──► nginx ──► painel-web (SPA) ──► painel-api ──► NBI GenieACS (127.0.0.1:7557)
                                                              │
                                                              └──► banco do painel (usuários, auditoria, eventos, limites)
```

- **painel-api** (Node.js + TypeScript, mesmo runtime do GenieACS): autenticação e perfis (atendente / NOC / admin),
  **auditoria** de toda ação (quem, quando, equipamento, o quê), cálculo de online/offline, aplicação dos limites,
  e é o **único** que fala com a NBI (que não tem autenticação e nunca é exposta).
- **painel-web** (React + Vite + Tailwind + Recharts): as abas do mockup.
- Banco do painel: PostgreSQL ou o próprio MongoDB (banco separado `painel`).
- Roda como mais um serviço no `docker-compose.yml`, mesmo deploy (`ops/vm/deploy.sh`), versionado no repo (`painel/`).

## 3. Viabilidade item a item

Fonte: **VP** = virtual parameter pronto · **VP novo** = criar (caminho já existe nos samples) ·
**GenieACS** = metadado/task do GenieACS · **API** = calculado no painel-api · **Externo** = outro sistema ·
**✗** = não disponível via TR-069.

| Elemento do mockup | Fonte | Situação | Fase |
|---|---|---|---|
| Busca por serial, PPPoE, IP, serial GPON | NBI (query em VPs + `_deviceId`) | viável | P1 |
| Busca por MAC de aparelho do cliente | — | caro (listas são sob demanda) | depois |
| Cabeçalho: modelo, fabricante, serial, firmware, IP WAN, último inform | VP + GenieACS | pronto | P1 |
| Status Online/Offline | API: `_lastInform` vs inform de 300 s | viável | P1 |
| Nome do cliente | Externo (ERP via PPPoE) | depende de integração | P3 |
| Sinal óptico RX/TX + escala + classificação | VP `RXPower`/`TXPower` + API (limites) | pronto | P1 |
| Temperatura, tensão, corrente do laser | VP | pronto | P1 |
| Uptime, último boot, registrado em | VP `Uptime` + GenieACS `_lastBoot`/`_registered` | pronto | P1 |
| Estado PON, serial GPON | VP `PonStatus`/`PonSerial` | pronto | P1 |
| OLT / slot / PON / ONU ID / distância | ✗ (OLT) | fase 8 | — |
| Roteador atrás de ONU bridge | VP `AccessType` = Roteador → aviso "sinal óptico só pela OLT" | pronto | P1 |
| WAN: IP, status, PPPoE, tempo conectado | VP | pronto | P1 |
| WAN: gateway, DNS, MTU, **último erro PPPoE**, IPv6 | VP `WanDetails` (JSON) | ✅ pronto | P1 |
| LAN: IP, máscara, faixa DHCP | VP `LanDetails` (JSON) | ✅ pronto | P1 |
| Portas LAN: conectada/desconectada + velocidade | VP `LanPorts` (JSON) | ✅ pronto (velocidade exceto H198A) | P1 |
| Wi-Fi por faixa: SSID, estado, padrão, canal, largura, clientes | VP | pronto | P1 |
| Wi-Fi: criptografia, potência (%) | VP `Wifi{24,5}Security`, `Wifi{24,5}TxPower` | ✅ pronto | P1 |
| Bandsteering (unificado) | VP `WifiBandSteering` | pronto | P1 |
| Clientes Wi-Fi: nome, IP, MAC, faixa, RSSI, taxa, tempo | VP `WifiClients` (sob demanda) | pronto | P1 |
| Clientes cabeados (LAN) | VP `DhcpHosts` (`iface = cabo`) | pronto | P1 |
| Classificação do sinal do cliente (Excelente/Bom/Fraco/Muito fraco) | API (limites) | viável | P1 |
| Fabricante do aparelho (Samsung, Apple…) | API: tabela OUI local; MAC aleatório → "MAC privado" | viável | P2 |
| CPU / memória | VP novo `CpuUsage`/`MemUsage` (3 caminhos ZTE; H198A não tem) | samples OK | P2 |
| Tráfego atual (Mbps) | API: 2 leituras de `TotalBytes*` com intervalo | viável, sob demanda | P2 |
| Gráfico de tráfego/uso no tempo | Prometheus (fase 6) | depois | P3 |
| Teste de conectividade (gateway, DNS, internet) | GenieACS: `IPPingDiagnostics` (existe nos 8) | viável — resultado real, assíncrono | P2 |
| Traceroute / teste de velocidade | `TraceRouteDiagnostics` / `Download`/`UploadDiagnostics` (precisam de servidor de teste) | viável | P3 |
| Ações: Atualizar, Reboot | GenieACS (connection request / task `reboot`) | pronto | P1 |
| Configurações Wi-Fi: SSID, senha, unificar/separar | VP graváveis (testados na F6201B) | pronto | P2 |
| Configurações Wi-Fi: canal, largura, potência | VP graváveis novos + teste na bancada | viável | P2 |
| Logs do equipamento | Aba **Eventos**: eventos detectados pelo Zenie + auditoria + faults (ver P3). Syslog da CPE fica para depois | eventos prontos | P3 |
| Atualizar firmware (individual) | GenieACS (`download` + FS) | viável, com cuidado | P4 |
| Factory reset | GenieACS (`factoryReset`) | só admin, confirmação dupla | P4 |
| Backup/restore de configuração | TR-069 Upload/Download de arquivo de config | viável, testar por modelo | P4 |
| Editar rede LAN (IP, DHCP), senha de admin | — | fora do escopo | — |

## 4. Regras de classificação (padrões iniciais, configuráveis no painel-api)

> RX definido pelo NOC em 2026-10-07 (bom > −22, atenção −22 a −24, ruim ≤ −24). Demais valores são
> de partida — validar com o NOC antes de produção.

| Medida | 🟢 Normal | 🟡 Atenção | 🔴 Crítico |
|---|---|---|---|
| RX óptico — **faixa do NOC** | −8 a −22 dBm | −22 a −24 dBm | ≤ −24 dBm, ou > −8 dBm (saturação) |
| TX óptico | 0,5 a 5 dBm | — | fora da faixa |
| Temperatura do módulo | < 70 °C | 70 a 85 °C | > 85 °C |
| Status | inform há < 11 min (2 ciclos de 300 s + folga) | 11 a 30 min | > 30 min = Offline |
| RSSI do cliente Wi-Fi | ≥ −60 Excelente · −60 a −67 Bom | −67 a −75 Fraco | < −75 Muito fraco |
| CPU / memória | < 70 % | 70 a 90 % | > 90 % |

Limites por modelo (ex.: ONU com laser diferente) ficam numa tabela do painel, não no código.

## 5. Entregas

### P1 — MVP de consulta (somente leitura + atualizar/reboot)
- painel-api com login, perfis, auditoria e proxy da NBI; painel-web com busca e as abas **Resumo, Status
  (óptico/PON), Rede, Wi-Fi, Clientes**.
- ✅ VPs da aba Rede (2026-10-07, ao vivo nos 8 equipamentos, 0 faults; provision `refresh-rede`):
  `WanDetails` (JSON: tipo, gateway, DNS, MTU, último erro PPPoE, uptime, VLAN, serviços, IPv6),
  `LanDetails` (JSON: IP/máscara, DHCP), `LanPorts` (JSON: estado + **velocidade negociada**, exceto H198A),
  `Wifi{24,5}Security` ("WPA2-PSK (AES)"), `Wifi{24,5}TxPower`.
- Abrir a tela = ler do banco (instantâneo, dados de até 15 min, com "atualizado há X min"); botão Atualizar =
  connection request (1,6–6 s medidos); abas Clientes leem `WifiClients`/`DhcpHosts` ao abrir.
- **Aceite**: atendente acha o cliente pelo PPPoE e em < 10 s sabe se está online, como está o sinal, a WAN e o Wi-Fi.

### P2 — Ações de atendimento

Feito em 2026-10-07 (testado na F6201B de bancada e ao vivo):
- ✅ Aba Wi-Fi: alterar nome/senha, unificar/separar (rota `POST /api/devices/:id/wifi`, em etapas; 5 GHz
  obrigatório ao separar, senha obrigatória ao unificar; senha nunca vai para a auditoria).
- ✅ Teste de conectividade (`IPPingDiagnostics` feito pelo equipamento: gateway, DNS, internet) — ~20 s.
- ✅ Tráfego atual (VP `WanCounters`, duas leituras, trata volta do contador de 32 bits).
- ✅ CPU/memória (VPs `CpuUsage`/`MemUsage`, lidos no Atualizar; H198A não tem; CPU a validar — 3 campos divergem).
- ✅ IPv6 completo: WAN nos 8 modelos (3 nomes de campo), prefixo delegado e prefixo/endereço da LAN.
- ✅ Velocidade da porta WAN (roteador Ethernet; linha GPON nas ONUs) — validada forçando 100 Mbps no H196A;
  cores de porta (WAN e LAN): 10 Mbps vermelho, 100 amarelo, 1000+ verde.
- ✅ Fabricante do aparelho pelo MAC (lista OUI pública do IEEE baixada no build; "MAC privado (aleatório)").
- ✅ Canal, largura e potência graváveis por faixa, limitados às opções do próprio equipamento
  (`PossibleChannels`, `TransmitPowerSupported`; 160 MHz só em Wi-Fi 6). Testados na F6201B; escrita de
  largura em roteador (`X_ZTE-COM_BandWidth`) a validar.

**P2 concluído em 2026-10-07.**

Ajustes finos (2026-10-07): popups centralizados (Wi-Fi, teste de conectividade, tráfego, troca da própria
senha); aba **Mesh** com a árvore EasyMesh lida do controlador (satélites mesmo fora do ACS, backhaul
cabo/Wi-Fi) e aparelhos por nó ao clicar — interpretação na API (`mesh.ts`), não em VP (limite de rodadas).

- Aba **Configurações (Wi-Fi)**: SSID, senha, unificar/separar (com o fluxo de separar pedindo SSID/senha do 5 GHz), canal, largura, potência.
- Teste de conectividade real (ping na CPE); CPU/memória; tráfego atual; fabricante do aparelho por OUI.
- **Aceite**: trocar senha do Wi-Fi de um cliente pelo painel, com registro na auditoria.

### P3 — Histórico e logs
- **Eventos (entregue em 2026-10-13)**: aba "Eventos" da ficha e alerta das últimas 24 h no Resumo.
  - A cada sincronização do inventário (`ZENIE_SYNC_SECONDS`), `zenie/api/src/events.ts` compara o estado anterior
    com o novo e grava em `device_events`. Tipos: reinício (`_lastBoot`), sem contato/voltou (`ZENIE_OFFLINE_AFTER`),
    WAN desconectada/conectada, troca de IP da WAN, faixa do RX (faixas do NOC, histerese 0,5 dB), status PON,
    firmware, login PPPoE e equipamento novo. O botão Atualizar passa pela mesma detecção.
  - **Causa do reinício** (deduzida; nenhum equipamento informa o motivo): pedido do painel (auditoria até 15 min
    antes do boot), atualização de firmware, "depois de ficar sem contato" (sem inform por mais de 2 ciclos antes do
    boot: falta de energia ou desligado) ou "sem pedido do painel" (botão, app, travamento ou queda rápida de energia).
    Reinício pedido fora do painel (UI do GenieACS, NBI) aparece como "sem pedido do painel".
  - **WAN**: a queda traz a causa (porta sem link ou `LastConnectionError` traduzido). **Reconexões entre leituras**
    vêm do tempo de conexão do `WanDetails` (lido a cada hora): se a conexão atual começou depois da anterior, houve
    reconexão, com o horário real do início. Várias reconexões na mesma hora aparecem como uma.
  - **Quedas na OLT** (`zenie/api/src/olt/history.ts`): `show gpon onu detail-info` traz as 10 últimas
    autenticações da ONU com OfflineTime e Cause. DyingGasp = falta de energia; LOSi = perda de sinal óptico
    (fibra). As duas foram vistas na C320 real em 13/10/2026; LOF entra pela mesma regra. Cada queda vira evento `olt.down` (sem duplicar entre leituras) e confirma
    o reinício deduzido ("Reiniciou depois de falta de energia (confirmado pela OLT)"). Lido sozinho depois de um
    reinício sem causa conhecida ou de uma volta (fila, uma ONU por vez, no máximo a cada 10 min por ONU, nunca
    durante a leitura das PONs nem durante um "write"), e **ao abrir a aba Eventos**, em segundo plano, sem botão
    (clicar de novo na aba recarrega; a mesma ONU é lida no máximo 1x por minuto). Uma linha discreta mostra a
    situação: ONU lida, "não é uma ONU" (roteador), "ONU não encontrada no inventário da OLT" ou falha. Sem OLT pronta
    (ativa, testada, com inventário lido) nada é consultado e a linha some. A ONU é achada
    pelo SN GPON ou pelo login PPPoE (roteador atrás de ONU em bridge). Os horários da OLT não têm fuso: o Zenie
    corrige pelo "Online Duration" (cobre também relógio errado na OLT) ou, com a ONU offline, por `ZENIE_OLT_TZ`.
    É a mesma leitura do app mobile do MK-Auth (`auth_history` do v2oltZTE).
  - **Gráfico de desconexões por dia** (aba Eventos, `zenie/api/src/incidents.ts`): os eventos de uma mesma queda
    (queda na OLT, reinício, volta ao ACS) viram UM incidente, com a causa Energia (amarelo, como no app
    mobile) / Internet (WAN, roxo) / Fibra (laranja) / Equipamento (azul); fibra prevalece. Reinício pedido pelo painel ou por firmware não conta. Período: 7 dias (padrão ao abrir),
    mês atual, 30 dias ou datas (dentro da retenção); clicar numa barra filtra a lista do dia.
  - **Queda em massa**: outros clientes da mesma PON (`ZENIE_MASS_PON`, padrão 3) ou da mesma OLT
    (`ZENIE_MASS_OLT`, padrão 10) com desconexão começando ou voltando a até 5 min do mesmo horário. Aparece no
    gráfico (ícone) e no evento ("provável problema de rede/energia, não do cliente"). Usa os eventos que o Zenie já
    tem dos vizinhos: reinícios e quedas de contato vêm de todos os equipamentos do ACS; quedas na OLT, só das ONUs
    cujo histórico já foi lido.
  - **Não guardamos** log bruto da CPE, Wi-Fi (conecta/desconecta, senha errada) nem DHCP (decisão de 2026-10-13).
    O log interno dos ZTE fica como de fábrica ("Salvar Log" desligado); o Zenie não depende dele.
  - A linha do tempo junta esses eventos com a auditoria (ações do painel nesse equipamento) e as faults atuais do
    GenieACS. Retenção: `ZENIE_EVENTS_DAYS` (padrão 30), por índice TTL.
  - Não grava nada no equipamento e vale para todos os fabricantes.
  - Limites: os VPs de RX/WAN/IP são lidos a cada 15 min (`provisions/refresh-vp.js`), então quedas curtas entre
    duas leituras não aparecem. A hora é a da detecção; só o reinício usa a hora do boot.
- **Próximas fontes de log (a decidir)**, levantadas nos samples:
  - ZTE `DeviceInfo.DeviceLog` (vazio enquanto `X_ZTE-COM_Syslog.Enable=false`; no H198A com syslog nível 7
    vieram 32 KB). "Buscar log" sob demanda exige ligar o syslog na CPE, ou seja, escrita pelo catálogo.
  - Syslog remoto (`X_ZTE-COM_Remotelog.LogServer`) para um receptor UDP no Zenie.
  - `VendorLogFile` depende do RPC Upload, que não é task do GenieACS 1.2. `BulkData` (TR-232) serve para métricas.
- Gráficos de RX/tráfego/clientes vindos do Prometheus (fase 6).
- Nome do cliente via integração com o ERP; traceroute e teste de velocidade.

### P4 — Ações avançadas (perfil admin)
- Firmware individual, factory reset, backup/restore de configuração.

## 6. Decisões (2026-10-07)

| # | Decisão |
|---|---|
| D5 | **Painel próprio** (painel-api + painel-web, seção 2) |
| ERP | **MK-Auth** (já existem addons nossos) — **adiado**: o painel nasce independente; busca principal pelo login PPPoE (ver [PRODUTO.md](PRODUTO.md)) |
| Perfis | **atendente**: ver, atualizar, Wi-Fi (SSID/senha/unificar) · **NOC**: + reboot, diagnósticos · **admin**: tudo (firmware, factory reset, backup) |
| Limites RX | bom > −22 dBm · atenção −22 a −24 · ruim ≤ −24 (e > −8 = saturação) |

### Pendente (depois do painel independente)
- Integração MK-Auth: por API do MK-Auth ou consulta ao banco? Endereço e credencial de leitura.
- Sugestão: um **addon no MK-Auth** com o botão "Abrir no painel ACS" na ficha do cliente (link pelo login PPPoE),
  já que o atendimento vive no MK-Auth — o painel continua independente.
