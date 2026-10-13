// Senhas (scrypt nativo do Node), sessões (token opaco no cookie, hash no banco) e
// guarda de rotas por permissão.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ObjectId } from "mongodb";
import { config } from "./config.js";
import { sessions, users, type User } from "./db.js";
import { can, type Permission, type Role } from "./permissions.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

export const SESSION_COOKIE = "zenie_session";

export interface AuthUser {
  id: ObjectId;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
    sessionId?: string;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePassword(password: string): string | null {
  if (password.length < config.minPasswordLength) return `a senha deve ter pelo menos ${config.minPasswordLength} caracteres`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "a senha deve ter letras e números";
  return null;
}

export function generatePassword(): string {
  // 16 caracteres sem ambíguos (0/O, 1/l/I), sempre com letra e número.
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const pw = Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join("");
    if (!validatePassword(pw)) return pw;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(user: User, ip: string, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await sessions().insertOne({
    _id: sha256(token),
    userId: user._id!,
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.sessionIdleHours * 3600_000),
    ip,
    userAgent: userAgent.slice(0, 200),
  });
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/",
    maxAge: config.sessionIdleHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Hook global: carrega o usuário da sessão (se houver) e renova a expiração (sessão deslizante). */
export async function loadSession(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  const id = sha256(token);
  const session = await sessions().findOne({ _id: id, expiresAt: { $gt: new Date() } });
  if (!session) return;
  const user = await users().findOne({ _id: session.userId, active: true });
  if (!user) return;
  await sessions().updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() + config.sessionIdleHours * 3600_000) } });
  request.sessionId = id;
  request.user = { id: user._id!, username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
}

/** preHandler: exige login e (opcionalmente) uma permissão. Quem precisa trocar a senha só acessa /auth/*. */
export function requireAuth(permission?: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.code(401).send({ error: "não autenticado" });
    if (request.user.mustChangePassword && !request.url.startsWith("/api/auth/")) {
      return reply.code(403).send({ error: "troque a senha antes de continuar", code: "MUST_CHANGE_PASSWORD" });
    }
    if (permission && !can(request.user.role, permission)) {
      return reply.code(403).send({ error: "sem permissão para esta ação" });
    }
  };
}

/** Limite simples de tentativas de login por IP (memória do processo; janela de 15 min). */
const attempts = new Map<string, { count: number; resetAt: number }>();
export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) return true;
  return a.count < config.loginMaxAttempts;
}
export function registerLoginFailure(ip: string): void {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  else a.count++;
}
export function clearLoginFailures(ip: string): void {
  attempts.delete(ip);
}
