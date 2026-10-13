// Canal de comunicação com a OLT (porte de lib/Olt/Transporte.php do addon zte_onu, MIT, mesmo autor).
//
// O driver só conversa com a OLT por aqui. Implementações: TelnetTransport (OLT real) e SimulatedTransport
// (saídas reais gravadas em fixtures/). O transporte não conhece comando nenhum: quem monta a linha é o
// commands.ts do driver, a partir de uma lista fechada. Linha com controle/quebra é recusada aqui também.

export interface Transport {
  /** Abre a conexão e faz login (e enable, se preciso). Lança OltFailure. */
  connect(): Promise<void>;
  /** Executa UMA linha e devolve a saída limpa (sem eco, sem prompt, sem paginação). */
  exec(line: string): Promise<string>;
  /** Nome que a OLT mostra no prompt (ex.: OLT-c320_1). Vazio antes de conectar. */
  name(): string;
  close(): Promise<void>;
}

export type FailureKind = "conexao" | "autenticacao" | "timeout" | "formato" | "modo_usuario" | "queda" | "comando";

const MESSAGES: Record<FailureKind, string> = {
  conexao: "Não foi possível conectar à OLT (endereço ou porta inacessível).",
  autenticacao: "A OLT recusou o usuário ou a senha.",
  timeout: "A OLT não respondeu dentro do tempo limite.",
  formato: "A resposta da OLT veio num formato que o driver não reconhece.",
  modo_usuario: "A OLT entrou em modo usuário (>). Informe a senha de enable.",
  queda: "A conexão com a OLT caiu no meio da operação.",
  comando: "A OLT respondeu com erro ao comando.",
};

/** Falha de comunicação com a OLT, já classificada. O detalhe técnico nunca contém senha. */
export class OltFailure extends Error {
  constructor(readonly kind: FailureKind, readonly technical = "") {
    super(MESSAGES[kind]);
  }
  /** Mensagem para a tela: texto amigável + detalhe técnico curto. */
  describe(): string {
    return this.technical ? `${this.message} (${this.technical.slice(0, 200)})` : this.message;
  }
}

/** Última barreira: nada de controle/quebra de linha nem linha gigante chega à CLI da OLT. */
export function safeLine(line: string): string {
  if (!line || /[\x00-\x1f\x7f]/.test(line) || line.length > 200) throw new Error("linha de comando inválida para a OLT");
  return line;
}
