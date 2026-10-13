// Auditoria: toda ação relevante fica registrada (quem, quando, o quê, em qual alvo, deu certo?).

import type { FastifyRequest } from "fastify";
import { audit } from "./db.js";

export async function record(
  request: FastifyRequest,
  action: string,
  opts: { ok?: boolean; target?: string; details?: Record<string, unknown>; username?: string } = {},
): Promise<void> {
  await audit().insertOne({
    ts: new Date(),
    userId: request.user?.id,
    username: request.user?.username ?? opts.username,
    action,
    target: opts.target,
    ok: opts.ok ?? true,
    details: opts.details,
    ip: request.ip,
  });
}
