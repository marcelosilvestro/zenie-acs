// Segurança do ACS (docs/SEGURANCA-ACS.md): credenciais das CPEs e a chave "cwmp.auth" do GenieACS.
//
// O Zenie é o dono da chave: toda mudança de credencial ou de modo grava (ou remove) cwmp.auth na hora, e o
// zenie-api reconcilia no início. O scripts/genieacs_sync.py ignora essa chave.

import { ObjectId } from "mongodb";
import { acsCredentials, acsSettings, audit, genieacsConfig, type AcsCredential, type AcsSettings } from "../db.js";
import { decrypt, encrypt, strongPassword } from "../secrets.js";
import { buildAuthExpression, CREDENTIAL_RE, type AuthMode } from "./auth-expr.js";

export const AUTH_KEY = "cwmp.auth";
const DEFAULT_SETTINGS: AcsSettings = { _id: "auth", mode: "off", updatedAt: new Date(0), updatedBy: "" };

export class AcsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function settings(): Promise<AcsSettings> {
  return (await acsSettings().findOne({ _id: "auth" })) ?? DEFAULT_SETTINGS;
}

/**
 * O modo "canário" (exigir só de alguns seriais) foi removido em 2026-10-08, a pedido do usuário. Quem estava
 * nele passa a "Exigir de todos" (decisão do usuário: exigência sempre ativa), com registro na auditoria.
 */
async function migrateCanary(): Promise<void> {
  const legacy = await acsSettings().findOne({ _id: "auth", mode: "canary" as AcsSettings["mode"] });
  if (!legacy) return;
  const now = new Date();
  await acsSettings().updateOne({ _id: "auth" }, { $set: { mode: "enforced", updatedAt: now, updatedBy: "sistema" }, $unset: { canary: "" } });
  await audit().insertOne({ ts: now, username: "sistema", action: "acs.modo", ok: true, details: { modo: "enforced", motivo: "modo canário removido; exigência de todos (decisão do usuário)" } });
}

/** Credenciais aceitas pelo ACS (ativa + em transição), com a senha decifrada. */
async function acceptedCredentials(): Promise<{ username: string; password: string }[]> {
  const list = await acsCredentials().find({ status: { $in: ["active", "transition"] } }).sort({ createdAt: -1 }).toArray();
  return list.map((c) => ({ username: c.username, password: decrypt(c.passwordEnc) }));
}

/** Grava/remove cwmp.auth conforme o estado do Zenie. Devolve o modo aplicado. */
export async function applyAuth(): Promise<AuthMode> {
  await migrateCanary();
  const s = await settings();
  const expr = buildAuthExpression(s.mode, s.mode === "off" ? [] : await acceptedCredentials());
  if (expr === null) await genieacsConfig().deleteOne({ _id: AUTH_KEY });
  else await genieacsConfig().updateOne({ _id: AUTH_KEY }, { $set: { value: expr } }, { upsert: true });
  return s.mode;
}

/** Situação para a tela (sem senhas). */
export async function state() {
  const s = await settings();
  const creds = await acsCredentials().find().sort({ createdAt: -1 }).toArray();
  const applied = await genieacsConfig().findOne({ _id: AUTH_KEY });
  return {
    mode: s.mode,
    // A chave existe no GenieACS quando deveria (e só então)? Diferença = alguém mexeu fora do Zenie.
    inSync: (s.mode === "off") === !applied,
    updatedAt: s.updatedAt.getTime() ? s.updatedAt : null,
    updatedBy: s.updatedBy || null,
    credentials: creds.map(publicCredential),
  };
}

function publicCredential(c: AcsCredential) {
  return { id: String(c._id), username: c.username, status: c.status, createdAt: c.createdAt, createdBy: c.createdBy, retiredAt: c.retiredAt ?? null, retiredBy: c.retiredBy ?? null };
}

/**
 * Nova credencial: vira a ativa; a ativa anterior passa a "em transição" (continua aceita até ser aposentada).
 * Sem senha informada, gera uma forte. A senha é devolvida só aqui (e no "revelar" auditado).
 */
export async function createCredential(by: string, input: { username?: string; password?: string }) {
  const username = input.username?.trim() || "zenie";
  const password = input.password || strongPassword();
  if (!CREDENTIAL_RE.test(username)) throw new AcsError("usuário: 1 a 64 caracteres, só letras, números e . _ @ -");
  if (!CREDENTIAL_RE.test(password) || password.length < 12) throw new AcsError("senha: 12 a 64 caracteres, só letras, números e . _ @ -");
  await acsCredentials().updateMany({ status: "active" }, { $set: { status: "transition" } });
  const doc: AcsCredential = { username, passwordEnc: encrypt(password), status: "active", createdAt: new Date(), createdBy: by };
  const { insertedId } = await acsCredentials().insertOne(doc);
  await applyAuth();
  return { credential: publicCredential({ ...doc, _id: insertedId }), password };
}

export async function revealPassword(id: string): Promise<{ username: string; password: string }> {
  const c = await acsCredentials().findOne({ _id: toId(id) });
  if (!c) throw new AcsError("credencial não encontrada", 404);
  return { username: c.username, password: decrypt(c.passwordEnc) };
}

/** Aposenta uma credencial em transição (o ACS deixa de aceitá-la). A ativa não pode ser aposentada. */
export async function retireCredential(id: string, by: string) {
  const c = await acsCredentials().findOne({ _id: toId(id) });
  if (!c) throw new AcsError("credencial não encontrada", 404);
  if (c.status === "active") throw new AcsError("a credencial ativa não pode ser aposentada: crie uma nova antes");
  if (c.status === "retired") return publicCredential(c);
  await acsCredentials().updateOne({ _id: c._id }, { $set: { status: "retired", retiredAt: new Date(), retiredBy: by } });
  await applyAuth();
  return publicCredential({ ...c, status: "retired" });
}

/**
 * Muda o modo. "enforced" exige de todos: decisão do usuário (2026-10-08) — equipamento sem a credencial fica
 * fora do ACS até ser configurado.
 */
export async function setMode(mode: AuthMode, by: string) {
  if (mode === "enforced" && !(await acsCredentials().countDocuments({ status: "active" }))) throw new AcsError("cadastre a credencial antes de exigir autenticação");
  await acsSettings().updateOne({ _id: "auth" }, { $set: { mode, updatedAt: new Date(), updatedBy: by } }, { upsert: true });
  await applyAuth();
  return state();
}

function toId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new AcsError("id inválido");
  return new ObjectId(id);
}
