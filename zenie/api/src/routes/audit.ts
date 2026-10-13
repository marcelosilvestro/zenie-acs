import type { FastifyInstance } from "fastify";
import type { Filter } from "mongodb";
import { requireAuth } from "../auth.js";
import { audit, type AuditEntry } from "../db.js";

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // Lista paginada (mais recente primeiro), com filtros por usuário, ação e alvo.
  app.get<{ Querystring: { username?: string; action?: string; target?: string; before?: string; limit?: number } }>("/api/audit", {
    preHandler: requireAuth("audit.view"),
    schema: {
      querystring: {
        type: "object",
        properties: {
          username: { type: "string", maxLength: 64 },
          action: { type: "string", maxLength: 64 },
          target: { type: "string", maxLength: 128 },
          before: { type: "string", format: "date-time" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
    },
  }, async (request) => {
    const q = request.query;
    const filter: Filter<AuditEntry> = {};
    if (q.username) filter.username = q.username.toLowerCase();
    if (q.action) filter.action = q.action;
    if (q.target) filter.target = q.target;
    if (q.before) filter.ts = { $lt: new Date(q.before) };
    const items = await audit().find(filter, { sort: { ts: -1 }, limit: q.limit ?? 50 }).toArray();
    return items.map(({ _id, userId, ...rest }) => ({ id: String(_id), ...rest }));
  });
}
