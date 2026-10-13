// Configuração do zenie-api — tudo por variável de ambiente (definidas no .env pelo instalador).

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

/** URL do ACS para as CPEs; null se não houver valor válido (a tela avisa). */
function acsUrl(): string | null {
  const host = process.env.GENIEACS_FS_HOSTNAME ?? "";
  const url = process.env.ZENIE_ACS_URL || (host ? `http://${host}:7547` : "");
  return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(url) && url.length <= 128 ? url : null;
}

export const config = {
  port: Number(env("ZENIE_API_PORT", "8080")),
  mongoUrl: env("ZENIE_MONGODB_URL", "mongodb://mongo:27017/zenie"),
  nbiUrl: env("ZENIE_NBI_URL", "http://genieacs-nbi:7557"),
  // Sessão: cookie httpOnly; expira após este tempo sem uso.
  sessionIdleHours: Number(env("ZENIE_SESSION_IDLE_HOURS", "12")),
  // false só em desenvolvimento sem HTTPS.
  cookieSecure: env("ZENIE_COOKIE_SECURE", "true") !== "false",
  // Login: tentativas por IP numa janela de 15 min.
  loginMaxAttempts: Number(env("ZENIE_LOGIN_MAX_ATTEMPTS", "10")),
  minPasswordLength: 10,
  // Intervalo de sincronização do índice de busca com o GenieACS.
  syncSeconds: Number(env("ZENIE_SYNC_SECONDS", "120")),
  // Eventos dos equipamentos (events.ts): dias de retenção (índice TTL).
  // Fuso do relógio das OLTs (horários do histórico de quedas), usado quando a ONU está offline. Online, o Zenie
  // corrige pelo "Online Duration" (que também cobre relógio da OLT adiantado/atrasado).
  oltTimeZone: env("ZENIE_OLT_TZ", process.env.TZ || "America/Sao_Paulo"),
  eventsDays: Math.min(365, Math.max(1, Number(env("ZENIE_EVENTS_DAYS", "30")) || 30)),
  // Alvo "Internet" do teste de conectividade (ping feito pelo equipamento).
  pingInternetHost: env("ZENIE_PING_INTERNET", "8.8.8.8"),
  // Nomes pingados pelo equipamento: o próprio equipamento resolve pelo DNS dele (falha aqui = DNS do cliente).
  // Google e WhatsApp: redes diferentes (Google x Meta) e o serviço de que o cliente mais reclama.
  pingNames: env("ZENIE_PING_NAMES", "google.com.br whatsapp.com").split(/[\s,]+/).filter(Boolean).slice(0, 4),
  // Modo homologação (só no servidor de testes): edição do catálogo em rascunho (docs/HOMOLOGACAO.md).
  homologation: env("ZENIE_HOMOLOGATION", "false") === "true",
  // URL do ACS que as ONUs recebem pela OLT (tr069-mgmt). Valor LITERAL validado — nunca derivado de leitura
  // (memória nunca-gravar-acs-url-derivada). Padrão: http://<GENIEACS_FS_HOSTNAME>:7547 (o endereço do instalador).
  acsUrl: acsUrl(),
  // Máximo de ONUs por lote de "Ativar TR-069" (envio em ondas pequenas — CLAUDE.md).
  tr069BatchMax: Math.min(100, Math.max(1, Number(env("ZENIE_TR069_BATCH_MAX", "10")))),
} as const;
