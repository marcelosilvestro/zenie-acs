# Log do ACS (painel)

Menu **Log do ACS** (perfis NOC e admin). Explica por que um equipamento não está 100% operacional, a partir do log do GenieACS. O log aparece resumido, agrupado e em português.

## O que aparece

| Ocorrência | Gravidade | Significado e o que fazer |
|---|---|---|
| Senha do ACS recusada | grave | O equipamento usou um usuário ou senha diferente da credencial do ACS, ou nenhuma. Se nunca entrou, **não aparece em Dispositivos** (selo "fora de Dispositivos"). Regravar a credencial pela OLT ("Ativar TR-069") ou na tela TR-069 do equipamento. |
| Equipamento novo registrado | ok | Primeiro contato aceito. |
| O equipamento recusou um comando (9xxx) | atenção | Falha TR-069, com o código traduzido (9005 = parâmetro inexistente, 9007 = valor inválido…). |
| Falha ao aplicar configuração automática | atenção | Um provision ou preset falhou nesse equipamento. Ele tenta de novo sozinho; as repetições se agrupam. |
| Parou de responder / conexão caiu / sessão fora de ordem | atenção | Rede instável, reinício ou firmware. |
| Mensagem fora do padrão TR-069 | atenção | Firmware com bug ou modelo não homologado. |
| Erro na configuração do ACS / falha interna do ACS | grave | Ajuste do ACS (admin), não do cliente. |

As sessões bem-sucedidas (informs) **só entram num contador**, sem gerar uma linha para cada uma. As repetições da mesma ocorrência, do mesmo equipamento e do mesmo IP, dentro da mesma hora, viram uma linha só, com o número de vezes. Tudo é guardado por **7 dias**.

## Como funciona

- O `genieacs-cwmp` grava o log em **JSON** (`GENIEACS_LOG_FORMAT=json` no docker-compose). O Docker guarda e rotaciona esse log.
- A API pede ao agente do host (`acslog.read`) as linhas novas a cada 15 s, e também ao abrir a tela. As linhas "ACS request" e "CPE request" são descartadas, porque podem trazer valores de parâmetros.
- A classificação fica em `zenie/api/src/acslog.ts`, com testes em `src/tests/acslog.test.ts`. O resumo vai para as coleções `acs_log` e `acs_log_state`, com TTL.
- No terminal: `docker compose logs -f genieacs-cwmp` mostra o log bruto, uma linha JSON por evento.
