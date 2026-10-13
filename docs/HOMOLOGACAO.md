# Plano: Módulo de Homologação de Equipamentos (Zenie)


## Context

O Zenie nasceu validado só em ZTE (8 modelos/firmwares, 9 equipamentos no ACS de teste). Para servir várias marcas e
tecnologias (TP-Link, MikroTik, TR-098 x TR-181, EasyMesh ZTE x padrão Data Elements…), o painel precisa **saber o que
cada modelo suporta** em vez de supor. Na prática já vimos: caminhos com formato diferente entre firmwares (F670L V1.1 x
V9), mesh como extensão própria da ZTE, TP-Link possivelmente publicando tudo em outro lugar.

Proposta do usuário: **módulo de homologação por marca e modelo**. Nós dois homologamos no servidor de testes; cada
homologação vira um **perfil** (foto, informações, capacidades validadas e fontes de dados) que é **distribuído nas
atualizações** do produto — cada release reconhece mais equipamentos. O perfil "amarra" o modelo às fontes de dados do
GenieACS e alimenta o painel (o que mostrar, o que permitir).

Decisões do usuário (2026-10-07):
- **Não homologado: ler sempre, escrever só homologado** (admin pode liberar caso a caso, auditado).
- **Só catálogo oficial**: homologação acontece no servidor de testes e vai para o repositório; instalações de
  produção não homologam localmente (catálogo só leitura).
- **Granularidade: só modelo** (firmwares vistos ficam registrados como informação, sem bloqueio).
- **Homologação antes do instalador**; o `install.sh` já nasce carregando o catálogo.

## Selo do modelo (regra do usuário, 2026-10-07)

| Selo | Quando |
|---|---|
| **Homologado** | 100%: nenhuma capacidade "a validar" (cada uma homologada ou não suportada) |
| **Em homologação N/17** | está no catálogo, mas falta validar algo. Leitura funciona; escrita só nas capacidades já homologadas |
| **Não homologado** | fora do catálogo: só leitura |

## Conceitos

| Termo | Significado |
|---|---|
| **Perfil de modelo** | por marca+modelo: identificação, foto, informações, capacidades (status + fonte), firmwares vistos, histórico |
| **Identificação** | `_Manufacturer` + (`_ProductClass` ou `ModelName`) do GenieACS; `_OUI` como reforço (ZTE tem vários OUIs). Opcional: `match.hardwareVersion` (prefixos de `DeviceInfo.HardwareVersion`, ex.: `V1.`/`V9.`) quando o mesmo modelo tem revisões com firmwares diferentes (F670L V1 x V9): perfil específico vence o genérico, e revisão sem perfil fica não homologada |
| **Capacidade** | recurso do painel — óptico, WAN, porta WAN, portas LAN, Wi-Fi leitura, Wi-Fi escrita, canal/largura/potência, liga/desliga rádio, Bandsteering, mesh, clientes Wi-Fi, DHCP, ping, tráfego, CPU/memória, reboot — com status `homologado` / `não suportado` / `a validar` |
| **Fonte (adaptador)** | de onde vem/vai o dado: `vp` (virtual parameters, já multi-candidato), `zte-easymesh`, `tr181-dataelements` (padrão, candidato p/ TP-Link), `tr098-ipping`, `tr181-ipping`… |
| **Catálogo oficial** | perfis versionados em `catalog/` no repositório, entregues em cada release |
| **Modo homologação** | `ZENIE_HOMOLOGATION=true` só no servidor de testes: libera edição/assistente/exportação. Produção: catálogo só leitura |

## Arquitetura

```
catalog/                          # NO REPOSITÓRIO (vai em cada release)
  index.json                      # versão do catálogo
  zte/f670l/profile.json          # identificação, capacidades+fontes, informações, firmwares vistos
  zte/f670l/thumb.webp            # foto (≤ 200 KB)
  zte/h196a-v9/…   (futuro: tp-link/ex220/…)
zenie-api
  catalog.ts      lê catalog/ (montado no container) + rascunhos do modo homologação (Mongo "catalog_drafts")
  match.ts        equipamento -> perfil (no sync do índice; resultado gravado no inventory)
  adapters/       registro de fontes: mesh/zte-easymesh (atual mesh.ts), diag/tr098-ipping (atual diagnostics), …
  routes/catalog.ts         leitura do catálogo, foto
  routes/homologation.ts    (só modo homologação) frota por modelo, rascunho, assistente, exportação
```

- `docker-compose.yml`: monta `./catalog` no `zenie-api` (somente leitura); `update`/`deploy` traz o catálogo novo.
- Índice `inventory` (`zenie/api/src/inventory.ts`) ganha `profileId` e `homologated` (bool), calculados no sync.
- Fotos redimensionadas **no navegador** (canvas → WebP ≤ 200 KB); sem dependência nativa no servidor.
- Reuso: `zenie/api/src/mesh.ts` → `adapters/mesh/zte-easymesh.ts`; `routes/diagnostics.ts` (IPPing TR-098) →
  `adapters/diag/tr098-ipping.ts`; a rota escolhe o adaptador pela fonte da capacidade no perfil.

## Como o perfil alimenta o painel

- **Ficha**: foto + nome comercial no cabeçalho; selo `Homologado` / `Não homologado`.
- **Capacidades mandam na tela**: aba Mesh só com `mesh` homologado (usando a fonte do perfil); botões de escrita
  (Wi-Fi, rádio, canal, reboot, ping) só se homologados; "a validar"/não homologado → só admin vê, com aviso.
- **Capacidades mandam na API** (segurança multimarca): leitura sempre; **escrita** só em modelo homologado com a
  capacidade homologada — admin pode liberar caso a caso (auditado: "liberação manual").
- **Lista**: miniatura do equipamento; filtro "não homologados"; card "modelos não homologados na rede".

## Particularidades por tecnologia (o perfil decide, a rota não supõe)

### Rede unificada (2,4 + 5 GHz com o mesmo nome e senha)

Cada fabricante unifica de um jeito, e isso muda o que o atendente precisa informar. Capacidade `wifiUnify`, com a
fonte (adaptador) no perfil (`zenie/api/src/adapters/wifi/unify.ts`):

| Fonte | Como funciona | Regras | Status |
|---|---|---|---|
| `zte-bandsteering` | chave própria (`X_ZTE-COM_Bandsteering`, VP `WifiBandSteering`). Unificado, o equipamento esconde o 5 GHz e copia o 2,4 | etapa própria antes de nome/senha; **senha obrigatória ao unificar** (não dá para ler); **ao separar, a ZTE restaura o 5 GHz antigo**, então SSID **e** senha do 5 GHz são obrigatórios; gravar o 2,4 vale para as duas | homologado na F6201B; a validar nos demais ZTE |
| `same-ssid` | sem chave: "unificar" = gravar o mesmo nome e senha nas duas faixas; quem escolhe a faixa é o aparelho/firmware | a API grava o 2,4 **e** o 5 GHz; separar exige só o SSID novo do 5 GHz | a validar (candidato: H198A, que não tem Bandsteering) |
| Smart Connect (TP-Link) e outros | a levantar com sample real | — | futuro, pelo assistente |

Pontos de atenção para homologar a unificação de um modelo novo:
- A unificação **altera o que se lê**: unificado, alguns firmwares escondem o SSID do 5 GHz ou reportam o do 2,4.
  O VP de leitura precisa refletir o estado real; validar lendo nos dois estados.
- **Tri-band / 6 GHz (Wi-Fi 6E/7)**: a "rede unificada" pode envolver 3 rádios. O perfil já tem `wifi.bands`; o
  adaptador vai precisar saber quais faixas entram (a validar quando houver equipamento).
- **Bandsteering x mesh**: em EasyMesh o controlador propaga o fronthaul (SSID/senha) para os satélites; em vários
  firmwares a mesh **exige** a rede unificada. Separar as redes num controlador mesh pode afetar os satélites —
  validar no H196A + H199A antes de homologar `wifiUnify` em controladores.

### Mesh

- Fonte `zte-easymesh` (`adapters/mesh/zte-easymesh.ts`): o **controlador** expõe a rede inteira (satélites fora do
  ACS inclusive). Candidato padrão para outras marcas: `tr181-dataelements` (Device.WiFi.DataElements), a validar.
- **Satélite também no ACS** (ex.: H199A como agente): a escrita de Wi-Fi nele seria sobrescrita pelo controlador.
  Próximo passo: detectar o papel (controlador/agente via `MeshAgent`, a validar) e bloquear escrita de Wi-Fi no
  agente, com aviso "altere pelo roteador principal".
- Alteração de Wi-Fi num controlador com satélites vale para a rede inteira: avisar na confirmação (a fazer com a
  topologia já lida).
- Firmwares que não identificam o satélite (F6201B V9.3.10P7N9: cada Agent vem com a identidade do controlador) são
  casados com o host DHCP `MULTIAP_SLAVE` da mesma porta LAN dos aparelhos dele (`identifySatellites`).

#### Checagem da mesh (bancada, antes de marcar `mesh` como homologado)

Satélites de bancada: H199A e H3601P (firmwares diferentes). Para cada item, ler a aba Mesh (ou a topologia pela
NBI) e comparar com a tela "Topologia" da web do principal.

| # | Cenário | O que conferir |
|---|---|---|
| 1 | Mesh ligada, **sem satélite** | só o principal; nenhum satélite "fantasma" |
| 2 | **1 satélite no cabo** | modelo/serial/MAC (ou MAC/IP/porta pela tabela DHCP), hop, backhaul cabo e velocidade |
| 3 | **2 satélites no cabo** (firmwares diferentes) | cada um com a identificação e os aparelhos certos |
| 4 | **Satélite pelo Wi-Fi** (backhaul sem fio) | backhaul "Wi-Fi" com sinal (dBm); com 2 satélites no Wi-Fi, a identificação de cada um |
| 5 | **Aparelho trocando de nó** (celular do principal para um satélite; notebook de uma porta para outra) | some de um nó e aparece no outro; RSSI igual ao da web |
| 6 | **Satélite desligado** | sai da árvore; os outros continuam identificados |
| 7 | Aba **Clientes** | aparelhos de todos os nós, cada um no roteador certo |

Resultado por modelo (2026-10-09):

| Modelo | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| F6201B V9.3.10P7N9 | ✅ | ✅ pela tabela DHCP | ✅ | não testado¹ | ✅ | ✅ | ✅ |
| F670L V9.0.11P3N10 | — | ✅ | ✅ | ✅ em cadeia² | ✅ | — | ✅ |
| F670L V1.1.20P3N12 | — | ✅ | ✅ | ✅ (H199A, −25 dBm) | ✅ | — | ✅ |
| F6600P V9.0.10P6N6 | — | ✅ | ✅ (H3601P cabo + H199A Wi-Fi) | ✅ (H199A, −13 dBm) | ✅ (cabo) | — | ✅ |
| H199A V9.1.0P12_MUL (principal) | — | ✅ | ✅ (H3601P cabo + H199A Wi-Fi) | ✅ (H199A, −21 dBm) | ✅ (cabo e Wi-Fi) | — | ✅ |
| H3601P V9.0.0P11_MUL (principal) | — | ✅ | ✅ (em cadeia) | ✅ (hop 2, −24 dBm) | ✅ (Wi-Fi) | — | ✅ |
| H198A V3.0 V3.0.0C6_MUL (principal) | — | ✅ | ✅ (H199A cabo + H3601P Wi-Fi) | ✅ (H3601P, −39 dBm) | ✅ (Wi-Fi) | — | ✅ |
| H196A V9 (rede de cliente, com autorização) | — | ✅ | — | — | — | — | ✅ |

¹ Limitação conhecida, a testar quando a F6201B voltar à bancada. O firmware não informa pai, hop nem backhaul de
nenhum satélite. Pelo Wi-Fi, a árvore fica "achatada" (todos ligados ao principal) e sem sinal. Com 1 satélite
pelo Wi-Fi, a identificação é por eliminação. Com 2 ou mais, pode ficar "Satélite" sem MAC. A lista de aparelhos
de cada nó continua certa.
² F670L → H199A (5 GHz 802.11ac, 867 Mbps, −11 dBm) → H3601P (hop 2, 5 GHz 802.11ax, 234 Mbps, −35 dBm), igual à web.

## Módulo Homologação (admin; edição só em modo homologação)

1. **Frota por modelo** (produção e teste): marca / modelo / qtde / firmwares vistos / status; não homologados no topo.
2. **Perfil do modelo**: foto, nome comercial, tipo (ONU GPON/EPON, roteador, AP), portas, geração Wi-Fi, observações,
   capacidades (status + fonte), firmwares vistos, histórico. Em produção: só leitura.
3. **Assistente** (modo homologação, em equipamento real — de preferência tag `piloto`):
   1. *Coletar amostra*: `refreshObject` da árvore + sample anonimizado (porta a lógica de `scripts/export_sample.py`
      para a API; guarda em GridFS; download para `samples/`).
   2. *Verificação de leitura*: lê todos os VPs/fontes no equipamento e sugere o status de cada capacidade
      (valor plausível → ok; vazio → não suportado; erro → falhou) — o `scripts/test-vp.js`, mas ao vivo.
   3. *Testes de escrita guiados* (opcionais, só piloto): Wi-Fi nome/senha, canal/largura/potência, liga/desliga,
      unificar — cada teste **aplica e reverte** (como na F6201B) e registra o resultado.
   4. *Revisão e confirmação* (auditada) → rascunho do perfil.
4. **Exportar**: rascunho → `profile.json` + `thumb.webp` para commit em `catalog/` (nossa release).

## Fluxo de trabalho (H3)

1. **Servidor de testes** com `ZENIE_HOMOLOGATION=true` no `.env`. Em produção fica `false`: o catálogo é só leitura.
2. Menu **Homologação**:
   - a frota por modelo mostra os não homologados primeiro;
   - **Criar perfil** gera um rascunho com todas as capacidades "a validar";
   - no perfil: foto (reduzida no navegador para WebP ≤ 200 KB), identificação, status e fonte de cada recurso, firmwares, nota do que foi validado.
3. O **rascunho já vale no servidor de testes** (reconhecimento, selo e travas). Testes de alteração só em
   equipamento de **bancada** (tag `piloto`).
4. Levar para o repositório:
   ```
   ssh root@<vm> "cd /opt/zenie && docker compose exec -T zenie-api node dist/cli.js catalog-export" | py scripts/catalog_import.py
   git diff catalog/  →  commit  →  deploy
   ssh root@<vm> "cd /opt/zenie && docker compose exec -T zenie-api node dist/cli.js catalog-clear-drafts"
   ```
   O `catalog_import.py` grava `profile.json` e `thumb.webp` e sobe a versão em `catalog/index.json`.
   O botão **Exportar** do perfil baixa os mesmos arquivos, para um modelo só.
5. Histórico: cada gravação acrescenta ao `history` do perfil o que mudou (ex.: `wifiWrite: a-validar → homologado`)
   e fica na auditoria (`homologacao.perfil`, `homologacao.foto`, `homologacao.descartar`).

## Entregas

| # | Entrega | Aceite |
|---|---|---|
| H1 ✅ | Formato do perfil + `catalog/` + loader + matching; perfis dos 8 modelos ZTE já validados (capacidades a partir de `docs/PLANO.md`/`docs/PAINEL.md`, fotos depois); selo na ficha e na lista; filtro "não homologados" | os 9 equipamentos (inclui `m2_autocenter`) com o perfil certo |
| H2 ✅ | Capacidades controlando tela e API; adaptadores por fonte (mesh, diagnóstico); liberação manual auditada | modelo sem `mesh` não mostra a aba; escrita bloqueada em não homologado |
| H3 ✅ | Módulo Homologação: frota por modelo, perfil (leitura em produção / edição em modo homologação), upload de foto, exportação | editar um perfil no servidor de testes, exportar e ver no `catalog/` |
| H4 ⏳ | Assistente: coleta de sample, verificação de leitura, testes de escrita com reversão | homologar a F6201B do zero pelo assistente e chegar ao mesmo perfil |
| depois | ✅ Instalador (PRODUTO.md item 5) já com o catálogo | — |

## Situação dos modelos (catálogo 2026.10.09-15)

| Modelo | Progresso | Selo | Falta validar |
|---|---|---|---|
| TP-Link EC230-G1 | 7/17 | em homologação | wanLink, ipv6, wifiClients, system, traffic, wifiWrite, wifiRadio, wifiPower, wifiUnify, reboot |
| ZTE F6201B | 17/17 | ✅ Homologado | (checagem da mesh: satélite pelo Wi-Fi, limitação conhecida) |
| ZTE F6600P | 17/17 | ✅ Homologado | — |
| ZTE F670L V9 | 17/17 | ✅ Homologado | — |
| ZTE F670L V1 | 17/17 | ✅ Homologado | — (ping exige Interface; canal leva ~10 s) |
| ZTE H196A V9 | 17/17 | ✅ Homologado | — |
| ZTE ZXHN H198A V3.0 | 15/17 + 2 n/s | ✅ Homologado | — (sem óptico e sem CPU/memória; sinal dos aparelhos vem da mesh) |
| ZTE ZXHN H199A | 16/17 + 1 n/s | ✅ Homologado | — (óptico não suportado: WAN Ethernet) |
| ZTE ZXHN H3601P | 16/17 + 1 n/s | ✅ Homologado | — (óptico não suportado: WAN Ethernet) |

Notas da homologação de 2026-10-07:
- **H196A V9**: 17/17 na rede de um cliente, com autorização (cliente no cabo). Com Bandsteering, desligar uma faixa desliga as duas. Separar e unificar num controlador mesh mantém o satélite.
- **TP-Link EC230-G1**: cliente em produção, **somente leitura** (tag + serial excluído do preset inform).
  - ProductClass genérico "IGD"/"Device": o modelo é reconhecido pelo ModelName.
  - TR-098 em uso; a amostra TR-181 existe, mas o suporte a TR-181 está pendente (PRODUTO item 7).
  - Sem RSSI em nenhum dos dois modos.
- Testes de escrita: só em bancada, ou com autorização explícita do usuário por equipamento.

Notas da homologação de 2026-10-08:
- **F670L V9.0.11P3N10**: 16/17 na ONU de bancada `testeZTE2` (`A4F33B-F670L-ZTELQJNN6A12156`). Falta só o mesh.
  - Testes feitos pela NBI com os mesmos VPs e tasks da zenie-api, porque não foi criado um admin temporário no painel.
  - Com Bandsteering, desligar o **5 GHz** desliga só o 5 GHz. Desligar o **2,4 GHz** desliga as duas faixas, e religar o 2,4 religa as duas. O H196A desliga as duas em qualquer caso.
  - Separar as redes restaura o 5 GHz antigo (`ZTE_5G_*`), como na F6201B.
- **F6201B V9.3.10P7N9** (bancada `teste_ztev9`): 16/17. system, wifiClients e dhcpHosts validados com um aparelho conectado.
  - A CPU padrão TR-098 acompanha a média por núcleo da ZTE.
  - A memória usa o campo da ZTE (42%); Total/Free daria 51%, porque conta o cache como usado.
  - O EasyMesh está desligado na bancada (`Enable=False`), então o mesh fica para quando houver um satélite.
- **Connection request falhando em ONU nova** ("Incorrect connection request credentials"):
  - No BOOTSTRAP, a sessão deu `too_many_commits` em todos os canais. A ONU ficou com o usuário de CR de fábrica (`ACS`), mas o banco do ACS registrou a credencial única.
  - Como o provision `inform` só renova a credencial 1x/dia, o CR ficou quebrado.
  - Correção pontual: task `setParameterValues` com os valores do banco, aplicada no inform seguinte.
  - **Causa e correção (2026-10-08):**
    - O BOOTSTRAP limpa a árvore do equipamento no ACS, e a sessão seguinte que lê muitos VPs precisa redescobrir cada nível de caminho com curinga.
    - Reproduzido na F6201B: o "Atualizar" (cerca de 40 VPs) logo após o bootstrap estoura `cwmp.maxCommitIterations` (padrão 32, ou seja 64 rodadas). Com o cache cheio, passa.
    - Não é loop infinito: com limite 1000, passa com 50 GetParameterNames e 42 GetParameterValues. O pior caso (todos os VPs da ficha mais WifiClients e DhcpHosts) passa com 128.
    - Correção: `cwmp.maxCommitIterations = 256` em `ui-config/config.json` (versionado; o sync apaga do banco o que não está no arquivo).

## Arquivos principais

- Novos: `catalog/**`, `zenie/api/src/{catalog.ts,match.ts}`, `zenie/api/src/adapters/**`,
  `zenie/api/src/routes/{catalog,homologation}.ts`, `zenie/web/src/pages/Homologation*.tsx`, `docs/HOMOLOGACAO.md`
- Alterados: `zenie/api/src/{inventory.ts,db.ts,device.ts,config.ts}`, `routes/{devices,wifi,diagnostics}.ts`
  (checagem de capacidade), `zenie/web/src/pages/{DeviceDetail,Devices}.tsx`, `pages/device/*` (esconder o que não é
  suportado), `components/Layout.tsx` (menu Homologação), `docker-compose.yml` (volume do catálogo, env do modo)
- Reusar: `runTask` (`zenie/api/src/device.ts`), `vendorOf` (`oui.ts`), `record` (`audit.ts`), `requireAuth`/permissões
  (`permissions.ts` ganha `homologation.manage`), anonimização de `scripts/export_sample.py`, lógica de `scripts/test-vp.js`.

## Verificação

- VM de teste: sync do índice → cada equipamento com `profileId` correto; um modelo removido do catálogo vira
  "não homologado", perde os botões de escrita e a API recusa a escrita (403 com motivo).
- Liberação manual por admin funciona e aparece na auditoria.
- Assistente completo na F6201B de bancada (coleta, leitura, escrita com reversão) → perfil igual ao atual.
- Exportar perfil → commit em `catalog/` → `deploy` → perfil aparece.
- Testes de API com usuário temporário (CLI `create-admin`), como nas entregas anteriores.
