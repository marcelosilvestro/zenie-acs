// Log do ACS (painel "Log do ACS"): resumo, em português, do que o genieacs-cwmp registra — senha recusada,
// equipamento novo, falhas de comando/configuração, sessões interrompidas, erros do próprio ACS.
//
// As linhas JSON vêm do agente do host (acslog.read). Só o útil é guardado e AGRUPADO: mesma ocorrência, mesmo
// equipamento e mesmo IP na mesma hora viram um registro com contador. Informs bem-sucedidos só contam (por hora).

import type { FastifyBaseLogger } from "fastify";
import { acsLog, acsLogState, type AcsLogEntry } from "./db.js";
import { hostd } from "./hostd.js";

export type LogLevel = "ok" | "info" | "warn" | "bad";

export interface Classified {
  kind: string;
  level: LogLevel;
  title: string;
  /** O que aconteceu e o que fazer (para o atendimento/NOC). */
  help: string;
  detail?: string | null;
}

/** Linha JSON do GenieACS (campos usados). */
export interface RawLine {
  timestamp?: string;
  severity?: string;
  message?: string;
  deviceId?: string;
  remoteAddress?: string;
  /** "Channel has faulted": a falha do provision (o GenieACS achata fault -> faultCode/faultMessage). */
  faultCode?: string;
  faultMessage?: string;
  channel?: string;
  retries?: number;
  parseError?: string;
  exceptionMessage?: string;
  cpeFaultCode?: string | number;
  cpeFaultString?: string;
  [k: string]: unknown;
}

// Códigos de falha TR-069 mais comuns (TR-069 Amendment 6, tabela A.5).
const CPE_FAULTS: Record<string, string> = {
  "9000": "método não suportado pelo equipamento",
  "9001": "pedido recusado pelo equipamento",
  "9002": "erro interno do equipamento",
  "9003": "argumentos inválidos",
  "9004": "equipamento sem recursos",
  "9005": "parâmetro inexistente neste modelo/firmware",
  "9006": "tipo de valor errado",
  "9007": "valor fora do permitido",
  "9008": "parâmetro somente leitura",
  "9010": "falha no download (arquivo/servidor)",
  "9013": "objeto inexistente",
};

const fromRemote = (ip?: string) => (ip ? ip.replace(/^::ffff:/, "") : null);

/** Classifica uma linha do log; null = não guardar (ruído ou informe bem-sucedido, que só conta). */
export function classify(l: RawLine): Classified | null {
  const m = l.message ?? "";
  switch (m) {
    case "Authentication failure":
      return {
        kind: "auth",
        level: "bad",
        title: "Senha do ACS recusada",
        help:
          "O equipamento tentou falar com o ACS com usuário/senha diferentes da credencial do ACS (ou sem credencial). " +
          "Enquanto isso ele não é atualizado e, se nunca entrou, não aparece em Dispositivos. O que fazer: regravar a " +
          "credencial — pela OLT (\"Ativar TR-069\" no módulo OLT) ou na tela TR-069 do equipamento.",
      };
    case "New device registered":
      return { kind: "new", level: "ok", title: "Equipamento novo registrado no ACS", help: "Primeiro contato aceito: o equipamento já aparece em Dispositivos." };
    case "CPE fault": {
      const code = String(l.cpeFaultCode ?? "");
      const text = CPE_FAULTS[code];
      return {
        kind: "cpe-fault",
        level: "warn",
        title: `O equipamento recusou um comando${code ? ` (${code})` : ""}`,
        help: `${text ? `Motivo: ${text}. ` : ""}Comum quando o modelo/firmware não tem o parâmetro ou não aceita o valor. Se for de um recurso do painel, confira a homologação do modelo.`,
        detail: l.cpeFaultString ? String(l.cpeFaultString) : null,
      };
    }
    case "Channel has faulted": {
      return {
        kind: "provision-fault",
        level: "warn",
        title: "Falha ao aplicar configuração automática",
        help:
          "Um provision/preset do ACS falhou neste equipamento (ele tenta de novo sozinho). Se repetir muito, é configuração do ACS ou parâmetro que o modelo não tem: verifique a homologação do modelo.",
        // Sem o nº da tentativa no detalhe: as repetições da mesma falha se agrupam num registro só (com contador).
        detail: [l.channel ? `canal ${l.channel}` : null, l.faultCode, l.faultMessage].filter(Boolean).join(" · ") || null,
      };
    }
    case "Session timeout":
      return { kind: "timeout", level: "warn", title: "O equipamento parou de responder no meio da sessão", help: "Conexão instável ou equipamento sobrecarregado/reiniciando. Se repetir, verifique sinal, WAN e CPU/memória do equipamento." };
    case "Connection dropped":
      return { kind: "dropped", level: "warn", title: "Conexão caiu no meio da sessão", help: "A conexão com o equipamento caiu durante a conversa com o ACS (rede instável, reinício ou NAT/firewall no caminho)." };
    case "Invalid session":
    case "Bad session state":
    case "CPE already in session":
      return { kind: "session", level: "warn", title: "Sessão TR-069 fora de ordem", help: "O equipamento abriu sessões repetidas ou fora de ordem (comum em reinício ou firmware com bug). Só preocupa se repetir muito." };
    case "XML parse error":
    case "Missing or invalid XML node":
    case "Method not supported":
    case "Unexpected parameter in response":
    case "Missing parameter in response":
    case "Response name does not match request name":
      return { kind: "protocol", level: "warn", title: "Mensagem fora do padrão TR-069", help: "O equipamento respondeu fora do padrão (firmware com bug ou modelo não homologado). Atualizar o firmware costuma resolver.", detail: (l.parseError as string) ?? m };
    case "Task expired":
      return { kind: "task", level: "info", title: "Tarefa expirou sem o equipamento conectar", help: "Um comando ficou na fila e o equipamento não voltou a falar com o ACS a tempo (offline ou sem connection request)." };
    case "Download operation timed out":
      return { kind: "download", level: "warn", title: "Download (firmware/arquivo) não terminou", help: "O equipamento não confirmou o download a tempo. Verifique se ele alcança o servidor de arquivos (porta 7567)." };
    case "Too many RPC requests":
    case "Too many commit iterations":
    case "Too many provision cycles":
    case "The presets are stuck in an endless configuration loop":
    case "Virtual parameters are referencing other virtual parameters in a deeply nested manner":
    case "Invalid virtual parameter value attribute":
    case "Invalid virtual parameter return value":
    case "Invalid preset schedule":
    case "Invalid task":
    case "Extension timed out":
      return { kind: "acs-config", level: "bad", title: "Erro na configuração do ACS", help: "Provision, preset ou virtual parameter do ACS com erro/loop neste equipamento. É ajuste do ACS (admin), não do cliente.", detail: m };
    case "Worker died":
    case "Uncaught exception":
    case "Too many crashes, exiting":
    case "Worker overloaded":
      return { kind: "acs-error", level: "bad", title: "Falha interna do ACS", help: "O serviço CWMP do GenieACS teve uma falha (ele reinicia sozinho). Se repetir, avise o admin.", detail: (l.exceptionMessage as string) ?? m };
    case "genieacs-cwmp starting":
      return { kind: "acs-start", level: "info", title: "Serviço do ACS iniciado", help: "O serviço CWMP subiu (atualização, reinício do servidor ou do container)." };
    default:
      return null;
  }
}

const HOUR = 3600_000;

/** Situação da leitura em segundo plano (a tela mostra; não espera a leitura). */
export const readerState: { at: Date | null; error: null | "no_hostd" | "erro" } = { at: null, error: null };

/** Lê as linhas novas pelo agente e grava o resumo. Uma execução por vez. */
let running = false;
export async function pollAcsLog(log?: FastifyBaseLogger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const state = await acsLogState().findOne({ _id: "cursor" });
    const r = await hostd<{ lines: string[]; truncated: boolean }>("acslog.read", { since: state?.since ?? null }, 70_000);
    let last = state?.since ?? null;
    const lastKey = state?.lastKey ?? null;
    const ops = [];
    const informs = new Map<number, { n: number; devices: Set<string> }>();
    for (const line of r.lines) {
      let l: RawLine;
      try {
        l = JSON.parse(line) as RawLine;
      } catch {
        continue;
      }
      if (!l.timestamp) continue;
      // A leitura é "desde" o último horário (inclusive): pula o que já foi visto.
      if (last && (l.timestamp < last || (l.timestamp === last && line === lastKey))) continue;
      last = l.timestamp;
      const ts = new Date(l.timestamp);
      if (l.message === "Inform") {
        const h = Math.floor(ts.getTime() / HOUR) * HOUR;
        const s = informs.get(h) ?? { n: 0, devices: new Set<string>() };
        s.n++;
        if (l.deviceId) s.devices.add(l.deviceId);
        informs.set(h, s);
        continue;
      }
      const c = classify(l);
      if (!c) continue;
      const hour = new Date(Math.floor(ts.getTime() / HOUR) * HOUR);
      const ip = fromRemote(l.remoteAddress);
      const deviceId = l.deviceId ?? null;
      const key = `${c.kind}|${deviceId ?? ""}|${ip ?? ""}|${c.detail ?? ""}|${hour.toISOString()}`;
      ops.push({
        updateOne: {
          filter: { _id: key },
          update: {
            $setOnInsert: { first: ts, kind: c.kind, level: c.level, title: c.title, help: c.help, detail: c.detail ?? null, deviceId, ip, hour } satisfies Omit<AcsLogEntry, "_id" | "last" | "count">,
            $max: { last: ts },
            $inc: { count: 1 },
          },
          upsert: true,
        },
      });
    }
    if (ops.length) await acsLog().bulkWrite(ops, { ordered: false });
    for (const [h, s] of informs) {
      await acsLogState().updateOne({ _id: `informs:${h}` }, { $inc: { n: s.n }, $addToSet: { devices: { $each: [...s.devices] } }, $set: { hour: new Date(h) } }, { upsert: true });
    }
    if (last && last !== state?.since) {
      const tail = r.lines.at(-1) ?? null;
      await acsLogState().updateOne({ _id: "cursor" }, { $set: { since: last, lastKey: tail, at: new Date() } }, { upsert: true });
    }
    if (r.truncated) log?.warn("log do ACS: leitura cortada em 5000 linhas (muito volume); o resto vem na próxima");
  } finally {
    running = false;
  }
}

export function startAcsLog(seconds: number, log: FastifyBaseLogger): NodeJS.Timeout {
  const run = () =>
    pollAcsLog(log)
      .then(() => {
        readerState.at = new Date();
        readerState.error = null;
      })
      .catch((e) => {
        // Sem o agente (instalação antiga): silencioso; outros erros aparecem no log da API.
        const noHostd = e instanceof Error && /zenie-hostd/.test(e.message);
        readerState.error = noHostd ? "no_hostd" : "erro";
        if (!noHostd) log.warn({ err: e }, "falha ao ler o log do ACS");
      });
  void run();
  return setInterval(run, seconds * 1000);
}
