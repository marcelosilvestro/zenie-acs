// Contratos dos adaptadores (fontes de dados por capacidade — docs/HOMOLOGACAO.md).
// O perfil do modelo diz QUAL fonte usar ("source" da capacidade); a rota só fala com o contrato.

/** Uma etapa de gravação (uma task setParameterValues). */
export type Step = { label: string; values: [string, string | boolean | number, string][] };

export interface MeshAdapter {
  id: string;
  label: string;
  root: string;
  /** Outras subárvores lidas junto com a topologia ("Atualizar" da aba Mesh). */
  extraRoots?: string[];
  topology(id: string): Promise<unknown>;
  stationsPath(key: string): string | null;
  stations(id: string, key: string): Promise<unknown[] | null>;
}

export interface PingResult {
  target: string;
  host: string | null;
  ok: boolean;
  state: string | null;
  sent: number;
  received: number;
  lossPct: number | null;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  error?: string;
}

export interface PingAdapter {
  id: string;
  label: string;
  ping(id: string, target: string, host: string | null): Promise<PingResult>;
}

/** Estado do Wi-Fi que o adaptador de unificação precisa (já normalizado pelos VPs). */
export interface WifiState {
  bandSteering: boolean | null;
  ssid24: string | null;
  ssid5: string | null;
}

/**
 * Rede unificada (2,4 + 5 GHz com o mesmo nome e senha). Cada fabricante faz de um jeito:
 *  - "zte-bandsteering": chave própria (X_ZTE-COM_Bandsteering via VP WifiBandSteering). Unificado, o
 *    equipamento esconde o 5 GHz e copia a config do 2,4; ao separar, RESTAURA a config antiga do 5 GHz.
 *  - "same-ssid": sem chave; "unificar" = gravar o mesmo nome e senha nas duas faixas (a escolha de
 *    faixa fica com o aparelho/firmware). Genérico, para modelos sem Bandsteering — A VALIDAR por modelo.
 *  - futuros: Smart Connect TP-Link, etc. (entram pelo assistente de homologação, com sample real).
 */
export interface UnifyAdapter {
  id: string;
  label: string;
  rules: {
    /** A senha não pode ser lida do equipamento: ao unificar, a senha da rede unificada é obrigatória. */
    passwordOnUnify: boolean;
    /** Ao separar, o que o atendente precisa informar para o 5 GHz. */
    separateNeeds: "ssid" | "ssid+password";
    /** Unificado: gravar a faixa principal (2,4) já vale para as duas (senão a API grava as duas). */
    mainWritesBoth: boolean;
  };
  state(w: WifiState): boolean | null;
  /** Etapas da troca de modo (vão ANTES de nome/senha). Vazio = a troca é só gravar nome/senha. */
  steps(on: boolean): Step[];
}
