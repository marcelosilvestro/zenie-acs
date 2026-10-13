import type { FastifyInstance } from "fastify";
import { record } from "../audit.js";
import {
  clearLoginFailures, clearSessionCookie, createSession, hashPassword, loginAllowed, registerLoginFailure,
  requireAuth, setSessionCookie, validatePassword, verifyPassword,
} from "../auth.js";
import { sessions, users } from "../db.js";
import { permissionsOf } from "../permissions.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { username: string; password: string } }>("/api/auth/login", {
    schema: {
      body: {
        type: "object",
        required: ["username", "password"],
        properties: { username: { type: "string", maxLength: 64 }, password: { type: "string", maxLength: 256 } },
      },
    },
  }, async (request, reply) => {
    const ip = request.ip;
    const username = request.body.username.trim().toLowerCase();
    if (!loginAllowed(ip)) {
      await record(request, "auth.login", { ok: false, username, details: { motivo: "muitas tentativas" } });
      return reply.code(429).send({ error: "muitas tentativas; aguarde alguns minutos" });
    }
    const user = await users().findOne({ username });
    const ok = !!user && user.active && (await verifyPassword(request.body.password, user.passwordHash));
    if (!ok || !user) {
      registerLoginFailure(ip);
      await record(request, "auth.login", { ok: false, username });
      return reply.code(401).send({ error: "usuário ou senha inválidos" });
    }
    clearLoginFailures(ip);
    const token = await createSession(user, ip, String(request.headers["user-agent"] ?? ""));
    await users().updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    setSessionCookie(reply, token);
    request.user = { id: user._id!, username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
    await record(request, "auth.login");
    return { username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword, permissions: permissionsOf(user.role) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.sessionId) {
      await sessions().deleteOne({ _id: request.sessionId });
      await record(request, "auth.logout");
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth() }, async (request) => {
    const u = request.user!;
    return { username: u.username, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword, permissions: permissionsOf(u.role) };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>("/api/auth/password", {
    preHandler: requireAuth(),
    schema: {
      body: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: { currentPassword: { type: "string", maxLength: 256 }, newPassword: { type: "string", maxLength: 256 } },
      },
    },
  }, async (request, reply) => {
    const user = await users().findOne({ _id: request.user!.id });
    if (!user || !(await verifyPassword(request.body.currentPassword, user.passwordHash))) {
      await record(request, "auth.password", { ok: false, details: { motivo: "senha atual incorreta" } });
      return reply.code(400).send({ error: "senha atual incorreta" });
    }
    const problem = validatePassword(request.body.newPassword);
    if (problem) return reply.code(400).send({ error: problem });
    if (request.body.newPassword === request.body.currentPassword) return reply.code(400).send({ error: "a nova senha deve ser diferente da atual" });
    await users().updateOne({ _id: user._id }, {
      $set: { passwordHash: await hashPassword(request.body.newPassword), mustChangePassword: false, updatedAt: new Date() },
    });
    // Encerra as outras sessões do usuário (mantém a atual).
    await sessions().deleteMany({ userId: user._id!, _id: { $ne: request.sessionId! } });
    await record(request, "auth.password");
    return { ok: true };
  });
}
