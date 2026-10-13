// Lista FECHADA de comandos do driver ZTE C320 MVR V2.1.x (porte de Comandos.php do addon zte_onu).
//
// Cada comando é um template fixo; os parâmetros são inteiros validados por faixa ou valores validados por
// regex. Não existe forma de mandar texto livre à OLT a partir daqui. Só entram comandos cuja saída foi vista
// na OLT real (fixtures/zte_c320_v2.1.0).

export const TEMPLATES = {
  versao: "show version-running",
  estado_pon: "show gpon onu state gpon-olt_%d/%d/%d",
  base_pon: "show gpon onu baseinfo gpon-olt_%d/%d/%d",
  detalhe_onu: "show gpon onu detail-info gpon-onu_%d/%d/%d:%d",
  // Validado em 08/10/2026 (testeZTE2 com tr069-mgmt, teste_ztev9 sem). A saída traz senhas de PPPoE: só o
  // parser lê, e só os campos do TR-069 saem dele.
  config_onu: "show onu running config gpon-onu_%d/%d/%d:%d",
  // Ativação do TR-069 via OMCI (validado à mão pelo usuário em 08/10/2026 na C320 V2.1.0). Únicos comandos que
  // ALTERAM a OLT neste driver. A senha vai na linha (exigência do próprio comando).
  tr069_config: "configure terminal",
  tr069_onu: "pon-onu-mng gpon-onu_%d/%d/%d:%d",
  tr069_state: "tr069-mgmt 1 state unlock",
  tr069_acs: "tr069-mgmt 1 acs %s validate basic username %s password %s",
  tr069_sair: "exit",
  // Grava a running config na flash (saída validada pelo usuário em 08/10/2026: "Writing configuration into
  // flash...[OK]"). Só por botão explícito do admin.
  salvar: "write",
} as const;

/** URL do ACS aceita na linha da OLT: literal, http(s)://host[:porta][/], até 128 caracteres (limite da OLT). */
export const ACS_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/;
/** Usuário/senha do ACS na linha da OLT: sem espaço, aspas, ; nem barra invertida. */
export const ACS_CRED_RE = /^[A-Za-z0-9._@-]{1,64}$/;

// Faixas aceitas. C320: um shelf; slots de placa baixos; até 16 PONs por placa; 128 ONUs por PON.
const SHELF: [number, number] = [1, 1];
const SLOT: [number, number] = [1, 21];
const PON: [number, number] = [1, 16];
const ONU: [number, number] = [1, 128];

function f(v: number, [min, max]: [number, number]): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`valor fora da faixa ${min}-${max}`);
  return v;
}

export const commands = {
  version: () => TEMPLATES.versao,
  save: () => TEMPLATES.salvar,
  ponState: (shelf: number, slot: number, pon: number) => `show gpon onu state gpon-olt_${f(shelf, SHELF)}/${f(slot, SLOT)}/${f(pon, PON)}`,
  ponBaseInfo: (shelf: number, slot: number, pon: number) => `show gpon onu baseinfo gpon-olt_${f(shelf, SHELF)}/${f(slot, SLOT)}/${f(pon, PON)}`,
  onuRunningConfig: (shelf: number, slot: number, pon: number, onu: number) =>
    `show onu running config gpon-onu_${f(shelf, SHELF)}/${f(slot, SLOT)}/${f(pon, PON)}:${f(onu, ONU)}`,
  /**
   * Sequência que ativa o TR-069 numa ONU. Validada aqui, não no chamador: URL literal (nunca derivada de leitura —
   * memória nunca-gravar-acs-url-derivada), credenciais sem caracteres que quebrem a linha. Sai do modo de
   * configuração com 2x "exit" (o "q" não existe no modo gpon-onu-mng).
   */
  tr069Activate: (shelf: number, slot: number, pon: number, onu: number, url: string, username: string, password: string): string[] => {
    if (!ACS_URL_RE.test(url) || url.length > 128) throw new Error("URL do ACS inválida para a OLT");
    if (!ACS_CRED_RE.test(username) || !ACS_CRED_RE.test(password)) throw new Error("usuário/senha do ACS com caracteres não aceitos pela OLT");
    return [
      TEMPLATES.tr069_config,
      `pon-onu-mng gpon-onu_${f(shelf, SHELF)}/${f(slot, SLOT)}/${f(pon, PON)}:${f(onu, ONU)}`,
      TEMPLATES.tr069_state,
      `tr069-mgmt 1 acs ${url} validate basic username ${username} password ${password}`,
      TEMPLATES.tr069_sair,
      TEMPLATES.tr069_sair,
    ];
  },
  onuDetail: (shelf: number, slot: number, pon: number, onu: number) =>
    `show gpon onu detail-info gpon-onu_${f(shelf, SHELF)}/${f(slot, SLOT)}/${f(pon, PON)}:${f(onu, ONU)}`,
};
