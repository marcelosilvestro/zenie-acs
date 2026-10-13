import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { record } from "../audit.js";
import { generatePassword, hashPassword, requireAuth } from "../auth.js";
import { sessions, users } from "../db.js";
import { ROLES, type Role } from "../permissions.js";

const publicUser = (u: { _id?: ObjectId; username: string; name: string; role: Role; active: boolean; mustChangePassword: boolean; createdAt: Date; lastLoginAt?: Date }) => ({
  id: String(u._id), username: u.username, name: u.name, role: u.role, active: u.active,
  mustChangePassword: u.mustChangePassword, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt ?? null,
});

const USERNAME = "^[a-z0-9._-]{3,32}$";

/** O usuário é o único administrador ativo? (não pode ser excluído, desativado nem rebaixado) */
async function isLastAdmin(u: { _id?: ObjectId; role: Role; active: boolean }): Promise<boolean> {
  if (u.role !== "admin" || !u.active) return false;
  return (await users().countDocuments({ role: "admin", active: true, _id: { $ne: u._id } })) === 0;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: requireAuth("users.manage") };

  app.get("/api/users", admin, async () => {
    const list = await users().find({}, { sort: { username: 1 } }).toArray();
    return list.map(publicUser);
  });

  // Cria usuário com senha temporária gerada (mostrada uma única vez); troca obrigatória no 1º login.
  app.post<{ Body: { username: string; name: string; role: Role } }>("/api/users", {
    ...admin,
    schema: {
      body: {
        type: "object",
        required: ["username", "name", "role"],
        properties: {
          username: { type: "string", pattern: USERNAME },
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", enum: [...ROLES] },
        },
      },
    },
  }, async (request, reply) => {
    const username = request.body.username.toLowerCase();
    if (await users().findOne({ username })) return reply.code(409).send({ error: "usuário já existe" });
    const password = generatePassword();
    const now = new Date();
    const res = await users().insertOne({
      username, name: request.body.name.trim(), role: request.body.role, passwordHash: await hashPassword(password),
      active: true, mustChangePassword: true, createdAt: now, updatedAt: now,
    });
    await record(request, "user.create", { target: username, details: { role: request.body.role } });
    return { id: String(res.insertedId), username, temporaryPassword: password };
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; role?: Role; active?: boolean } }>("/api/users/:id", {
    ...admin,
    schema: {
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          role: { type: "string", enum: [...ROLES] },
          active: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(404).send({ error: "usuário não encontrado" });
    const _id = new ObjectId(request.params.id);
    const target = await users().findOne({ _id });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });
    const isSelf = target._id!.equals(request.user!.id);
    if (isSelf && (request.body.active === false || (request.body.role && request.body.role !== "admin"))) {
      return reply.code(400).send({ error: "você não pode desativar nem rebaixar a si mesmo" });
    }
    if ((request.body.active === false || (request.body.role && request.body.role !== "admin")) && (await isLastAdmin(target))) {
      return reply.code(400).send({ error: "é o único administrador ativo: crie ou ative outro antes" });
    }
    if (request.body.name !== undefined) request.body.name = request.body.name.trim();
    await users().updateOne({ _id }, { $set: { ...request.body, updatedAt: new Date() } });
    if (request.body.active === false || request.body.role) await sessions().deleteMany({ userId: _id });
    await record(request, "user.update", { target: target.username, details: request.body });
    return { ok: true };
  });

  // Exclui o usuário (admin): digitando o login para confirmar; nunca a si mesmo nem o último admin ativo.
  // As sessões dele caem; a auditoria continua com o nome de usuário nas ações que ele fez.
  app.post<{ Params: { id: string }; Body: { confirm: string } }>("/api/users/:id/remove", {
    ...admin,
    schema: { body: { type: "object", required: ["confirm"], additionalProperties: false, properties: { confirm: { type: "string", maxLength: 64 } } } },
  }, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(404).send({ error: "usuário não encontrado" });
    const _id = new ObjectId(request.params.id);
    const target = await users().findOne({ _id });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });
    if (target._id!.equals(request.user!.id)) return reply.code(400).send({ error: "você não pode excluir a si mesmo" });
    if (request.body.confirm.trim().toLowerCase() !== target.username) return reply.code(400).send({ error: "digite o usuário para confirmar" });
    if (await isLastAdmin(target)) return reply.code(400).send({ error: "é o único administrador ativo: crie ou ative outro antes" });
    await users().deleteOne({ _id });
    await sessions().deleteMany({ userId: _id });
    await record(request, "user.delete", { target: target.username, details: { nome: target.name, perfil: target.role } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/users/:id/reset-password", admin, async (request, reply) => {
    if (!ObjectId.isValid(request.params.id)) return reply.code(404).send({ error: "usuário não encontrado" });
    const _id = new ObjectId(request.params.id);
    const target = await users().findOne({ _id });
    if (!target) return reply.code(404).send({ error: "usuário não encontrado" });
    const password = generatePassword();
    await users().updateOne({ _id }, { $set: { passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: new Date() } });
    await sessions().deleteMany({ userId: _id });
    await record(request, "user.resetPassword", { target: target.username });
    return { temporaryPassword: password };
  });
}
