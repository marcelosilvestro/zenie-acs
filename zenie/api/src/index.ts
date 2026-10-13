// Zenie API — painel NOC para GenieACS. Única peça que fala com a NBI do GenieACS.

import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { loadSession } from "./auth.js";
import { config } from "./config.js";
import { close, connect } from "./db.js";
import { startInventorySync } from "./inventory.js";
import { startAcsLog } from "./acslog.js";
import { acsLogRoutes } from "./routes/acslog.js";
import { auditRoutes } from "./routes/audit.js";
import { deviceRoutes } from "./routes/devices.js";
import { wifiRoutes } from "./routes/wifi.js";
import { diagnosticsRoutes } from "./routes/diagnostics.js";
import { catalogRoutes } from "./routes/catalog.js";
import { homologationRoutes, reloadDrafts } from "./routes/homologation.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { acsRoutes } from "./routes/acs.js";
import { settingsRoutes } from "./routes/settings.js";
import { oltRoutes } from "./routes/olts.js";
import { applyAuth } from "./acs/service.js";
import { startTr069Watcher } from "./olt/tr069.js";

const app = Fastify({
  logger: { level: process.env.ZENIE_LOG_LEVEL ?? "info" },
  // Atrás do nginx do zenie-web: confia no X-Forwarded-For para registrar o IP real.
  trustProxy: true,
  bodyLimit: 64 * 1024,
});

await app.register(cookie);
app.addHook("onRequest", loadSession);

app.get("/api/health", async () => {
  let nbi = false;
  try {
    const res = await fetch(`${config.nbiUrl}/devices/?projection=_id&limit=1`, { signal: AbortSignal.timeout(3000) });
    nbi = res.ok;
  } catch {
    nbi = false;
  }
  return { ok: true, nbi };
});

await app.register(authRoutes);
await app.register(userRoutes);
await app.register(auditRoutes);
await app.register(deviceRoutes);
await app.register(wifiRoutes);
await app.register(diagnosticsRoutes);
await app.register(catalogRoutes);
await app.register(homologationRoutes);
await app.register(acsRoutes);
await app.register(settingsRoutes);
await app.register(acsLogRoutes);
await app.register(oltRoutes);

await connect();
await reloadDrafts();
// cwmp.auth do GenieACS segue o estado do Zenie (docs/SEGURANCA-ACS.md). Falha aqui não derruba o painel.
try {
  app.log.info({ mode: await applyAuth() }, "autenticação do ACS reconciliada");
} catch (e) {
  app.log.error({ err: e }, "não foi possível reconciliar a autenticação do ACS");
}
await app.listen({ host: "0.0.0.0", port: config.port });
const syncTimer = startInventorySync(config.syncSeconds, app.log);
const tr069Timer = startTr069Watcher(app.log);
const acsLogTimer = startAcsLog(15, app.log);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(syncTimer);
    clearInterval(tr069Timer);
    clearInterval(acsLogTimer);
    await app.close();
    await close();
    process.exit(0);
  });
}
