# Fixtures — ZTE C320, MVR V2.1.0 (OLT de referência)

Saídas **reais** da CLI, coladas pelo usuário. Servem ao parser, à OLT simulada e aos testes (`npm test`).
Anonimizadas: nomes, SN, IPs, usuários e **senhas** foram trocados, mantendo exatamente o formato (largura das
colunas, maiúsculas, espaços). Não edite o layout: é ele que o parser lê.

| Arquivo | Comando | Origem |
|---|---|---|
| show_version_running.txt | `show version-running` | addon zte_onu (01/10/2026) |
| show_gpon_onu_state.txt | `show gpon onu state gpon-olt_1/1/1` | addon zte_onu |
| show_gpon_onu_state_pon_vazia.txt | idem, PON vazia/desativada (`%Code 62310-GPONSRV`) | addon zte_onu |
| show_gpon_onu_baseinfo.txt | `show gpon onu baseinfo gpon-olt_1/1/1` (HBR/FRKW = Furukawa bridge) | addon zte_onu |
| show_gpon_onu_detail_info.txt | `show gpon onu detail-info gpon-onu_1/1/1:1` | addon zte_onu |
| show_onu_running_config_com_tr069.txt | `show onu running config gpon-onu_1/1/16:20` (testeZTE2, com `tr069-mgmt`) | Zenie, 08/10/2026 |
| show_onu_running_config_sem_tr069.txt | `show onu running config gpon-onu_1/1/16:13` (teste_ztev9, sem `tr069-mgmt`) | Zenie, 08/10/2026 |

A saída real do running config traz as **senhas de PPPoE em texto puro**: o Zenie nunca grava nem registra essa
saída; o parser extrai só os campos do TR-069.
