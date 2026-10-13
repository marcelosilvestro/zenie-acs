// Cliente do agente do host (deploy/hostd/zenie-hostd.py): rede do servidor e túnel Cloudflare.
// Uma requisição por conexão no socket Unix montado em /run/zenie (só este container o recebe).

import { connect } from "node:net";

export const HOSTD_SOCKET = process.env.ZENIE_HOSTD_SOCKET ?? "/run/zenie/hostd.sock";

export class HostdError extends Error {
  /** status HTTP para a tela: 400 = recusado pela validação; 503 = agente ausente; 502 = falha no agente. */
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function hostd<T>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const sock = connect(HOSTD_SOCKET);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new HostdError("o agente do servidor não respondeu a tempo", 504));
    }, timeoutMs);
    sock.on("connect", () => sock.write(JSON.stringify({ cmd, ...args }) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString();
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // Sem o agente (instalação antiga ou serviço parado): a tela explica como instalar.
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED" || e.code === "EACCES") {
        reject(new HostdError("o agente do servidor (zenie-hostd) não está ativo: rode ./update.sh no servidor", 503, "no_hostd"));
      } else reject(new HostdError(`falha ao falar com o agente do servidor: ${e.message}`, 502));
    });
    sock.on("end", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(buf) as { ok: boolean; result?: T; error?: string; refused?: boolean };
        if (r.ok) resolve(r.result as T);
        else reject(new HostdError(r.error ?? "erro no agente do servidor", r.refused ? 400 : 502));
      } catch {
        reject(new HostdError("resposta inválida do agente do servidor", 502));
      }
    });
  });
}
