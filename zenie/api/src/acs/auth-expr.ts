// Expressão "cwmp.auth" do GenieACS 1.2 (docs/SEGURANCA-ACS.md). Função pura: testada em tests/auth-expr.test.ts.
//
// Comportamento verificado no código do genieacs-cwmp 1.2.16:
//  - sem a chave: aceita qualquer CPE;
//  - AUTH("u","p") confere Basic ou Digest (em HTTP o desafio 401 é Digest);
//  - a expressão é avaliada depois do Inform.

export type AuthMode = "off" | "enforced";

export const CREDENTIAL_RE = /^[A-Za-z0-9._@-]{1,64}$/;

export interface AuthCredential {
  username: string;
  password: string;
}

function lit(v: string, what: string): string {
  // A regex não deixa passar aspas, barra invertida nem espaço: o valor entra literal na expressão.
  if (!CREDENTIAL_RE.test(v)) throw new Error(`${what} inválido para a expressão de autenticação`);
  return `"${v}"`;
}

/**
 * Monta a expressão. null = sem autenticação (remover a chave). "enforced" exige de todos os equipamentos.
 * Todas as credenciais aceitas (ativa + em transição) entram com OR: trocar a senha não derruba ninguém.
 */
export function buildAuthExpression(mode: AuthMode, accepted: AuthCredential[]): string | null {
  if (mode === "off") return null;
  if (!accepted.length) throw new Error("nenhuma credencial aceita: cadastre uma antes de exigir autenticação");
  return accepted.map((c) => `AUTH(${lit(c.username, "usuário")},${lit(c.password, "senha")})`).join(" OR ");
}
