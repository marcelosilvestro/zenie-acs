# Módulo OLT

O módulo é independente do addon
MK-Auth `zte_onu`. A lógica de acesso foi portada dele (MIT, mesmo autor) com as mesmas garantias.

## Entregas

| # | Entrega | Situação |
|---|---|---|
| O1 | Cadastro de OLT, teste de acesso (só leitura), drivers e compatibilidade, protocolo Simulada | ✅ validado na C320 real (08/10/2026: VALIDADA, V2.1.0, 3 placas) |
| O2 | Inventário de ONUs por PON + running config (TR-069 na OLT) + cruzamento com o Zenie | ✅ código e testes; falta a leitura na C320 real |
| O3 | Envio individual do `tr069-mgmt` + verificação no ACS + auditoria | ✅ validado em 08/10/2026 na teste_ztev9: gravado e conferido na OLT, BOOTSTRAP autenticado, CR ok, 14 s no total |
| O4 | Lote com teto, reenvio (senha antiga), `write` | ✅ validado em 08/10/2026: lote de 3 ONUs (PON 2/16, F670L) todas no ACS com CR ok em ~23 s; `write` 2x com `[OK]` |

## Cadastro

- **Campos**: nome, modelo/driver, protocolo (Telnet ou **Simulada**), porta, endereço, usuário, senha, senha de
  enable (opcional, com "apagar"), tempo de conexão (3–60 s), tempo por comando (5–300 s), observação.
- **Senhas**:
  - cifradas com AES-256-GCM (`ZENIE_SECRET_KEY`); nunca voltam para a tela nem para a auditoria;
  - não aceitam espaço, aspas, `;`, crase nem `\`, porque quebrariam a linha de comando da OLT.
- **Permissões**: `olt.view` (NOC, admin) vê a lista e os drivers. `olt.manage` (admin) cadastra, altera,
  testa e remove. Remover exige digitar o nome.
- **Alteração simultânea**: se outra pessoa salvou antes, a gravação é recusada (campo `rev`).
- Mudar endereço, porta, protocolo, usuário ou modelo invalida o teste anterior (compatibilidade volta a "não
  testada").

## Teste de acesso (nada é alterado na OLT)

1. **Conexão e login**: Telnet, `Username:`/`Password:`, e `enable` se o usuário entrar em modo `>`.
2. **Identificação**: `show version-running` → nome do prompt, versão MVR e placas.
3. **Compatibilidade**: a versão detectada está entre as testadas do driver?
   - **VALIDADA**: está;
   - **SOMENTE LEITURA**: o driver existe, mas a versão não foi testada (ou as placas têm versões diferentes);
   - **NÃO SUPORTADA**: não há driver para o modelo.
4. **Mesmo equipamento**: avisa se o nome do prompt mudou desde o teste anterior (o endereço pode apontar para
   outra OLT).

Proteções:
- uma operação por OLT de cada vez;
- **3 falhas de login seguidas bloqueiam novas tentativas por 15 min**, para não travar a conta na OLT;
- trocar a senha libera o bloqueio.

## ONUs (aba ONUs da página OLTs, entrega O2)

- **"Ler da OLT"** (admin) roda em segundo plano, numa única sessão. Nada é alterado na OLT.
  1. Descobre as PONs de cada placa identificada no teste:
     - `show gpon onu state` porta a porta;
     - recusa logo na porta 1 = a placa não é PON;
     - depois de uma porta válida, uma recusa só pula aquela porta.
  2. Por PON: `state` (fase) + `baseinfo` (SN, fabricante pelo prefixo, perfil).
  3. Por ONU: `show onu running config gpon-onu_X`. O parser extrai **só** as linhas `tr069-mgmt 1`: estado,
     URL, validate e usuário.
     - A saída traz senhas de PPPoE em texto puro: nada dela é gravado nem registrado;
     - a senha do ACS também não sai do parser.
  4. Grava em `olt_onus`. Uma posição que sumiu da OLT não é apagada: ganha "sumiu há…".
- **TR-069 na OLT**, comparado com o esperado: URL `ZENIE_ACS_URL` (padrão `http://<GENIEACS_FS_HOSTNAME>:7547`)
  e o usuário da credencial ativa em *Segurança do ACS*.

  | Situação | Quando |
  |---|---|
  | configurado | URL e usuário iguais aos esperados, `state unlock` |
  | configurado na ONU | sem TR-069 (ou outro) na OLT, mas a ONU está online no Zenie: foi configurada na própria ONU (ex.: teste_ztev9). Com a exigência de senha, estar online prova a credencial. Não conta como pendência |
  | outra URL/usuário | configurado, mas diferente (ex.: o placeholder de fábrica `http://0.0.0.0:9090/...`) |
  | bloqueado (lock) | `tr069-mgmt 1 state lock` |
  | senha antiga | URL e usuário certos, mas a senha na OLT não é a da credencial ativa (depois de uma troca de senha em Segurança do ACS). O parser só **compara**: a senha lida não sai dele |
  | sem TR-069 | sem linhas `tr069-mgmt` |
  | não lido | a OLT recusou o comando para essa ONU (o erro aparece na linha) |
- **No Zenie**: o SN da OLT (`ZTEG…`) é comparado com o VP `PonSerial` do inventário do Zenie. Mostra o login
  PPPoE, o modelo e se está online, com link para a ficha.
- Filtros: PON, online/offline, fabricante (ZTE/outros), TR-069, no Zenie, busca por SN, login ou posição.
  Os contadores no topo também filtram ao clicar. A lista é paginada no servidor (50 por página); contadores e
  filtros valem para o total.
- Primeira leitura real (08/10/2026, OLT de referência): 755 ONUs, 743 online, 6 no Zenie.

## Ativar TR-069 (entrega O3) — a única operação que ALTERA a OLT

- Botão **"Ativar TR-069"** na linha da ONU. Permissão `olt.tr069` (admin).
  - Aparece só para quem **não** fala com o ACS: nem "configurado" pela OLT, nem "configurado na ONU".
  - O preset de provisionamento do provedor já entrega a ONU com TR-069, e regravar só provocaria um novo
    primeiro contato à toa.
  - A API também recusa (409), e num lote essa ONU é pulada com o motivo.
- **Pré-condições**:
  - OLT com compatibilidade VALIDADA;
  - driver com o recurso (C320: validado);
  - URL do ACS definida;
  - credencial ativa em *Segurança do ACS*;
  - ONU de outro fabricante (não ZTEG) exige marcar "experimental".
- **Comandos** (os mesmos validados à mão em 08/10/2026):
  `configure terminal` → `pon-onu-mng gpon-onu_1/S/P:O` → `tr069-mgmt 1 state unlock` →
  `tr069-mgmt 1 acs <URL> validate basic username <usuário> password <senha>` → `exit` → `exit`.
  - A URL é a literal da configuração, validada (http(s)://host[:porta], até 128 caracteres).
  - Usuário e senha só com `A-Z a-z 0-9 . _ @ -`.
  - No 1º `%Error`, para, sai dos modos de configuração e marca falha. A mensagem nunca contém a senha.
- **Depois**:
  1. relê o running config da ONU para conferir URL, usuário e `unlock`;
  2. **aguarda a ONU chegar ao ACS**: um verificador a cada 20 s procura na NBI o serial PON com inform posterior
     ao envio, por até 15 min;
  3. testa o connection request e atualiza o índice do Zenie.
- **Situações do envio**: `enviando` → `aguardando_acs` → `concluido` (com CR ok/falhou) | `falha` | `nao_chegou`.
  Ficam em `tr069_jobs` e aparecem na linha da ONU.
- **Não faz `write`**: a configuração fica na running config da OLT. Salvar na flash é a entrega O4 (botão
  explícito).
- A senha do ACS vai só na linha da OLT. Não fica no envio, no log nem na auditoria (`olt.tr069.envio` registra
  posição, SN, URL, usuário e resultado).

## Lote, reenvio e salvar (entrega O4)

- **Lote**:
  - marque as ONUs pendentes (caixa na linha, ou "todas as pendentes desta página"); a seleção vale entre páginas;
  - limite de **`ZENIE_TR069_BATCH_MAX` (padrão 10)** por lote, para ir em ondas pequenas;
  - confirmação digitando a quantidade. Se houver ONU de outro fabricante, é preciso marcar "experimental";
  - roda em segundo plano, uma ONU de cada vez, com 2 s de folga entre elas. Cada uma tem o seu envio (mesmo
    fluxo do individual) e a sua linha de auditoria;
  - pré-condição que falha numa ONU (ex.: envio já em andamento) só pula aquela ONU.
- **Reenviar após troca de senha**:
  - a leitura compara a senha gravada na OLT com a credencial ativa;
  - as diferentes aparecem como **senha antiga** e entram em "pendente";
  - o envio individual ou em lote regrava com a credencial atual;
  - enquanto a antiga estiver "em transição", a ONU continua falando com o ACS.
- **Salvar configuração da OLT** (`write`):
  - botão explícito; o cabeçalho mostra quantos envios ainda não estão na flash;
  - confere o `[OK]` da OLT (saída validada à mão em 08/10/2026);
  - auditado como `olt.salvar_config`;
  - recusado com lote em andamento.

## Ajustes depois da validação (08/10/2026)

- **ONU que já fala com o ACS não recebe envio**: "configurado" pela OLT ou "configurado na ONU" (preset do
  provedor). A tela não oferece o botão e a API recusa (409).
- **Firmware sem serial GPON** (F670L V9.0.11P3N10: sem `X_ZTE-COM_GPONSN`, interface PON em
  `X_ZTE-COM_WANPONInterfaceConfig`):
  - a leitura da OLT guarda o **login PPPoE** da WAN (`wan-ip … mode pppoe username X`, nunca a senha);
  - o cruzamento e o verificador do envio usam SN **ou** login;
  - o índice do Zenie preenche o Serial PON com o da OLT (`ponSerialSource: "olt"`), e a ficha mostra
    "(da OLT)".
- **Furukawa em bridge** (FRKW, perfil HBR) recusa o `tr069-mgmt`: `%Code 63865-GPONRM : Execute error in NP.`.
- A página OLTs abre na aba **ONUs** (Cadastro em `?aba=cadastro`).
- Menu "mais ações" da lista de OLTs em camada fixa, porque era cortado pela tabela.

## Ajustes de 09/10/2026

- **Senha do `tr069-mgmt` conferida de verdade.**
  - A C320 quebra o `show onu running config` em 80 colunas, no meio de "password".
  - O parser junta as linhas (`unwrap80`) antes de comparar.
  - A senha nunca sai do parser.
- **O OMCI sobrescreve o TR-069 da ONU ao religar** (confirmado no testeZTE2).
  - Senha não conferida mais ONU que não chega ao ACS aparece como **"senha a regravar"**, e o "Ativar TR-069" fica liberado.
  - Envio feito pelo Zenie com a credencial ativa conta como senha conferida.
- **Troca de equipamento.** Uma ONU nova na mesma posição, ou com o mesmo login, não herda o "chegou ao ACS" nem o "No Zenie" do aparelho anterior:
  - o envio só vale para o mesmo SN;
  - o login só casa com equipamento sem SN conhecido ou com o mesmo SN.
- **Roteador atrás de ONU em bridge** (mesmo login PPPoE) nunca é tratado como a ONU e não recebe o SN PON dela.
- **Nunca salvar (`write`) durante a leitura das PONs.** O servidor recusa nos dois sentidos, e a tela trava os botões.
- **ONU com IP público** (plano com IP fixo) só chega ao ACS com a porta 7547 aberta para qualquer origem (`ZENIE_CWMP_ALLOW=any`, padrão agora).

## Segurança do acesso

- **Lista fechada de comandos** por driver (`zenie/api/src/olt/zte-c320-v21/commands.ts`):
  - parâmetros só inteiros em faixa (shelf 1, slot 1–21, PON 1–16, ONU 1–128);
  - nenhum texto livre chega à OLT;
  - toda linha passa por `safeLine` (sem controle ou quebra de linha, até 200 caracteres).
- Parser estrito (`parser.ts`):
  - saída fora do formato conhecido vira erro, nunca um resultado vazio presumido;
  - a contagem de ONUs precisa bater com o total que a própria OLT informa.

## Drivers

| Driver | Versões testadas | Recursos |
|---|---|---|
| ZTE C320 (MVR V2.1.x) | V2.1.0 | identificar ✅, inventário ✅, leitura do TR-069 da ONU ✅, ativação de TR-069 ✅, salvar configuração (`write`) ✅ |

## Testes (`cd zenie/api && npm test`)

- Parser contra as saídas reais em `zenie/api/fixtures/zte_c320_v2.1.0/` (copiadas do addon, já anonimizadas).
- OLT Simulada: responde com as saídas reais e **lembra o `tr069-mgmt` recebido**, para a releitura conferir.
  Um envio nela termina como "concluído (simulado)", porque não há ONU real para chegar ao ACS.
- Telnet contra uma **OLT falsa local**: IAC, eco, paginação `--More--`, senha errada, porta fechada, modo `>`
  com e sem enable.
