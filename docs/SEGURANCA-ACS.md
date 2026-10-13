# Segurança do ACS: autenticação das CPEs

Este documento descreve como funciona
e como operar.

## Como o GenieACS autentica (1.2.16, verificado no código e na VM em 2026-10-08)

- A chave `cwmp.auth` da coleção `config` do banco `genieacs` decide:
  - **sem a chave**: aceita qualquer CPE;
  - **com a chave**: avalia a expressão depois de processar o Inform.
- `AUTH("usuario","senha")` aceita **Basic** e **Digest**:
  - em HTTP (porta 7547), o desafio 401 é **só Digest** (`qop="auth,auth-int"`);
  - em HTTPS, só Basic;
  - Basic enviado sem desafio também passa.
- A expressão só pode usar `DeviceID.*`, que vem do próprio Inform.
  - `Tags.*` e outros parâmetros ficam sem valor num equipamento novo e transformam a expressão inteira em
    "falso", recusando todo mundo.
- Uma CPE que recebe o 401 e não reenvia com credencial **não gera log** de falha. Ela simplesmente para de
  aparecer.

## O que o Zenie faz

- **Credenciais** (menu *Segurança do ACS*, só admin):
  - usuário e senha cifrados no banco com AES-256-GCM e `ZENIE_SECRET_KEY` (gerada pelo `install.sh` ou pelo
    `update.sh`; vai no backup com o `.env`; **nunca troque**);
  - criar uma credencial nova a torna a **ativa**. A anterior passa a **em transição** e continua aceita até ser
    aposentada, então trocar a senha não derruba ninguém;
  - "Ver senha" fica na auditoria, e a senha nunca é registrada.
- **Modos**: o Zenie é dono da chave `cwmp.auth`. Ele a grava na hora e a reconcilia quando o zenie-api inicia.

  | Modo | `cwmp.auth` |
  |---|---|
  | Desligada | (sem a chave) |
  | Exigida de todos | `AUTH(ativa) OR AUTH(transição…)`: botão "Exigir de todos" com confirmação `EXIGIR`. **Decisão do usuário (2026-10-08): fica sempre ativa**, e equipamento sem credencial fica fora até ser configurado |

- O `scripts/genieacs_sync.py` ignora `cwmp.auth`: não exporta, não grava e não apaga.

O modo "canário" (exigir só de alguns seriais) existiu para o teste de bancada e foi **removido em 2026-10-08** a
pedido do usuário. Quem estava nele passou automaticamente a "Exigida de todos", com registro na auditoria.

## Emergência

Se a exigência recusar equipamentos e o painel não resolver:

```
cd /opt/zenie && docker compose exec zenie-api node dist/cli.js acs-auth off
```

O GenieACS volta a aceitar qualquer CPE em segundos. Uma CPE que ficou em espera de nova tentativa (norma
TR-069) volta no próximo inform periódico.

## Antes de exigir de todos (entrega S2)

1. A credencial ativa precisa chegar aos equipamentos:
   - por TR-069: o provision `inform` grava `ManagementServer.Username/Password` (a fazer);
   - nas ONUs ZTE, também pela OLT (`tr069-mgmt ... validate basic username ... password ...`, módulo OLT).
2. Cada modelo precisa ter a capacidade `acsAuth` homologada na bancada: o equipamento responde ao desafio
   Digest. **Validado em 2026-10-08** (exigência só nas ONUs de bancada, num modo de teste já removido): F6201B V9.3.10P7N9 (teste_ztev9) e F670L V9.0.11P3N10
   (testeZTE2, configurada pela OLT com `validate basic`) autenticam, com 0 falhas.
3. O painel de migração mostra quem já está com a credencial.

O provision `inform` (credencial de connection request e intervalo de inform, só `ManagementServer`) roda em
**todos** os equipamentos, inclusive nos com a tag `somente_leitura` (decisão de 2026-10-09): sem ele o ACS não
gerencia o equipamento. O que protege a configuração do cliente é a homologação do modelo (escrita só com a
capacidade "homologado") e, quando usada, a tag `somente_leitura`.
