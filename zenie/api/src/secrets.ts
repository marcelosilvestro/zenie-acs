// Segredos guardados no banco (senha do ACS, senhas de OLT): AES-256-GCM com a chave ZENIE_SECRET_KEY do .env.
// A chave é gerada pelo install.sh/update.sh e vai no backup junto com o .env: sem ela, os segredos precisam ser
// cadastrados de novo. Formato gravado: "v1:<iv>:<tag>:<cifrado>" (base64).

import { createCipheriv, createDecipheriv, randomBytes, randomInt } from "node:crypto";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.ZENIE_SECRET_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ZENIE_SECRET_KEY ausente ou inválida (64 caracteres hex) — rode ./update.sh para gerá-la");
  }
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

/** true se a chave existe e é válida (para avisar na tela em vez de falhar). */
export function secretsReady(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("segredo em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Senha forte só com caracteres aceitos por CPEs e pela CLI da OLT (sem espaço, aspas, ponto e vírgula). */
export function strongPassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}
