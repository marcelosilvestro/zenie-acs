// Linha de comando do zenie-api (usada pelo instalador e para emergências).
//
//   docker compose exec zenie-api node dist/cli.js create-admin <usuario> ["Nome"]
//   docker compose exec zenie-api node dist/cli.js reset-password <usuario>
//   docker compose exec -T zenie-api node dist/cli.js catalog-export     (rascunhos -> JSON na saída;
//       no Windows: ... | py scripts/catalog_import.py — grava em catalog/ para o commit)
//   docker compose exec zenie-api node dist/cli.js catalog-clear-drafts  (depois que o catálogo novo subiu)
//   docker compose exec zenie-api node dist/cli.js acs-auth off          (EMERGÊNCIA: o ACS volta a aceitar
//       qualquer CPE — use se a exigência de autenticação recusou equipamentos e o painel não resolve)
//
// A senha temporária é gerada e mostrada uma única vez; troca obrigatória no 1º login.

import { generatePassword, hashPassword } from "./auth.js";
import { audit, catalogDrafts, close, connect, sessions, users } from "./db.js";
import { setMode } from "./acs/service.js";
import { officialProfile } from "./catalog.js";

async function main(): Promise<number> {
  const [command, rawUser, name] = process.argv.slice(2);
  if (command === "acs-auth") {
    if (rawUser !== "off") {
      console.error("uso: cli.js acs-auth off");
      return 2;
    }
    await connect();
    await setMode("off", "cli");
    await audit().insertOne({ ts: new Date(), username: "cli", action: "acs.modo", ok: true, details: { modo: "off", via: "cli (emergência)" } });
    console.log("autenticação do ACS DESLIGADA: o GenieACS volta a aceitar qualquer CPE em segundos");
    return 0;
  }
  if (command === "catalog-export" || command === "catalog-clear-drafts") {
    await connect();
    if (command === "catalog-export") {
      const drafts = await catalogDrafts().find().toArray();
      const out = drafts.map((d) => {
        // Rascunho só da foto: vai o perfil oficial (a cópia do rascunho pode ser antiga).
        const { hasImage: _h, draft: _d, ...profile } = (d.photoOnly ? officialProfile(d._id) : null) ?? d.profile;
        return { id: d._id, profile, thumb: d.thumb ? Buffer.from(d.thumb.buffer as ArrayBuffer).toString("base64") : null };
      });
      // Espera a escrita terminar: com process.exit logo depois, a saída em pipe era cortada em 64 KB (7 fotos).
      await new Promise<void>((resolve) => process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), drafts: out }) + "\n", () => resolve()));
    } else {
      const res = await catalogDrafts().deleteMany({});
      console.log(`rascunhos removidos: ${res.deletedCount}`);
      await audit().insertOne({ ts: new Date(), username: "cli", action: "cli.catalog-clear-drafts", ok: true, details: { removidos: res.deletedCount } });
    }
    return 0;
  }
  const username = (rawUser ?? "").toLowerCase();
  if (!["create-admin", "reset-password"].includes(command ?? "") || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    console.error("uso: cli.js create-admin <usuario> [\"Nome\"] | reset-password <usuario>");
    return 2;
  }
  await connect();
  const password = generatePassword();
  const now = new Date();
  if (command === "create-admin") {
    if (await users().findOne({ username })) {
      console.error(`usuário "${username}" já existe — use reset-password`);
      return 1;
    }
    await users().insertOne({
      username, name: name ?? "Administrador", role: "admin", passwordHash: await hashPassword(password),
      active: true, mustChangePassword: true, createdAt: now, updatedAt: now,
    });
  } else {
    const res = await users().updateOne({ username }, { $set: { passwordHash: await hashPassword(password), mustChangePassword: true, active: true, updatedAt: now } });
    if (!res.matchedCount) {
      console.error(`usuário "${username}" não existe`);
      return 1;
    }
    const u = await users().findOne({ username });
    await sessions().deleteMany({ userId: u!._id! });
  }
  await audit().insertOne({ ts: now, username: "cli", action: `cli.${command}`, target: username, ok: true });
  console.log(`usuário: ${username}\nsenha temporária: ${password}\n(troca obrigatória no primeiro login)`);
  return 0;
}

const code = await main().catch((e) => {
  console.error(e);
  return 1;
});
await close();
process.exit(code);
