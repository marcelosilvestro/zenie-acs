# Atualização do Zenie pelo painel

**Configurações › Atualização** (só admin). O painel mostra a versão instalada e a mais nova do canal, com a lista de mudanças. O botão **Atualizar** roda o mesmo `update.sh` usado no servidor, sem precisar de SSH.

## Canais (`ZENIE_UPDATE_CHANNEL` no `.env`)

| Canal | Para | Atualiza para |
|---|---|---|
| `releases` (padrão) | produção | só versões marcadas `vX.Y.Z` (tags do git) |
| `main` | servidor de testes | último commit do ramo `main` |

## Como funciona

1. **Verificação.** O agente do host (`zenie-hostd`) faz `git fetch` com a deploy key, que é somente leitura, e compara as versões. Ele verifica sozinho uma vez por dia, e o menu mostra o selo **"atualizar"**. Nada é atualizado sem o clique do admin.
2. **Atualizar.** Depois da confirmação, o agente dispara o `update.sh --yes` como unidade do systemd (`zenie-update`), fora dele mesmo, porque a atualização reinicia o painel e o próprio agente. Etapas:
   1. backup completo;
   2. código da versão;
   3. variáveis novas no `.env`;
   4. agente do host;
   5. build das imagens;
   6. containers;
   7. firewall;
   8. provisions, VPs e presets (com a trava de release);
   9. `doctor`.
3. **Acompanhamento.** A tela mostra as etapas e o registro (sem senhas). Enquanto o painel reinicia, ela espera e reconecta sozinha.
   - O registro fica em `/var/log/zenie-update.log`.
   - O resultado fica em `/var/lib/zenie-hostd/update.rc`.
   - Comando no servidor: `journalctl -u zenie-update`.
4. **Bloqueios.** A atualização é recusada quando:
   - já há outra em andamento;
   - há mudança de rede aguardando confirmação;
   - há alterações locais no código (`git status`).
5. **Voltar atrás.** Use o backup do início, em `/opt/zenie/backups`, com o `./restore.sh` no servidor.

## Publicar uma versão para a produção

1. A mudança vai para o `main` e é testada na VM de teste (canal `main`).
2. Com a aprovação do usuário, cria-se a tag anotada `vX.Y.Z`, com as notas da versão:
   ```bash
   git tag -a v0.2.0 -m "notas da versão"
   git push origin v0.2.0
   ```
3. Em até um dia, a produção mostra o selo. O admin clica em **Atualizar**, ou em **Verificar agora** para não esperar.
