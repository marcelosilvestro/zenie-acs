// Cadastro e teste de acesso das OLTs (porte de OltServico.php do addon zte_onu; docs/OLT.md).
//
// - Senha e senha de enable cifradas (secrets.ts); nunca voltam para a tela nem para a auditoria.
// - Teste de acesso SÓ LÊ: login, show version-running e compatibilidade com o driver. Falha de rede/login não
//   lança: vira etapa com erro, gravada no histórico.
// - Uma operação por OLT de cada vez (trava em memória: um único zenie-api).
// - 3 falhas de login seguidas bloqueiam novas tentativas por 15 min (não travar a conta na OLT).

import { ObjectId } from "mongodb";
import { olts, oltTests, type Olt, type OltStep } from "../db.js";
import { decrypt, encrypt } from "../secrets.js";
import { compatibility, driverFor, type OltDriver } from "./driver.js";
import { SimulatedTransport } from "./simulated.js";
import { TelnetTransport } from "./telnet.js";
import { OltFailure, type Transport } from "./transport.js";

export class OltError extends Error {
  /** code: motivo para a tela (ex.: "not_onu", "not_found", "no_olt"). */
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

export const PROTOCOLS = {
  telnet: { label: "Telnet", available: true, port: 23 },
  ssh: { label: "SSH (em breve)", available: false, port: 22 },
  simulado: { label: "Simulada (demonstração, sem rede)", available: true, port: 23 },
} as const;
export type Protocol = keyof typeof PROTOCOLS;

const AUTH_FAILURES_TO_BLOCK = 3;
const BLOCK_MINUTES = 15;

// ---------------------------------------------------------------- validação (porte de Validar.php)

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const USER_RE = /^[A-Za-z0-9._@-]{1,60}$/;
// Qualquer imprimível, menos o que pode quebrar a linha de comando da OLT (espaço, aspas, ;, crase, \, controle).
const BAD_PASS_RE = /[\s"'`;\\\x00-\x1f\x7f]/;

function text(v: unknown, max: number, required: boolean, field: string): string {
  const s = String(v ?? "").trim();
  if (required && !s) throw new OltError(`${field}: obrigatório`);
  if (s.length > max || /[\x00-\x1f\x7f]/.test(s)) throw new OltError(`${field}: até ${max} caracteres, sem caracteres de controle`);
  return s;
}
function host(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s.length > 253 || !(IPV4_RE.test(s) || HOST_RE.test(s))) throw new OltError("endereço: informe um IPv4 ou um nome (hostname) válido");
  return s;
}
function int(v: unknown, min: number, max: number, field: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new OltError(`${field}: de ${min} a ${max}`);
  return n;
}
function password(v: unknown, field: string): string {
  const s = String(v ?? "");
  if (!s || s.length > 128 || BAD_PASS_RE.test(s)) throw new OltError(`${field}: até 128 caracteres, sem espaço, aspas, ponto e vírgula, crase ou barra invertida`);
  return s;
}

// ---------------------------------------------------------------- consulta

export function publicOlt(o: Olt) {
  return {
    id: String(o._id),
    name: o.name,
    vendor: o.vendor,
    model: o.model,
    protocol: o.protocol,
    host: o.host,
    port: o.port,
    username: o.username,
    hasPassword: !!o.passwordEnc,
    hasEnable: !!o.enableEnc,
    connectTimeoutSec: o.connectTimeoutSec,
    commandTimeoutSec: o.commandTimeoutSec,
    note: o.note,
    active: o.active,
    rev: o.rev,
    compatibility: o.compatibility,
    detected: o.detected ?? null,
    lastTest: o.lastTest ?? null,
    blockedUntil: o.blockedUntil && o.blockedUntil > new Date() ? o.blockedUntil : null,
    createdAt: o.createdAt,
    createdBy: o.createdBy,
    updatedAt: o.updatedAt,
    updatedBy: o.updatedBy,
  };
}

export async function list() {
  return (await olts().find().sort({ name: 1 }).toArray()).map(publicOlt);
}

export async function get(id: string): Promise<Olt> {
  if (!ObjectId.isValid(id)) throw new OltError("id inválido");
  const o = await olts().findOne({ _id: new ObjectId(id) });
  if (!o) throw new OltError("OLT não encontrada", 404);
  return o;
}

export async function history(id: string) {
  const o = await get(id);
  return oltTests().find({ oltId: o._id! }).sort({ at: -1 }).limit(10).toArray();
}

// ---------------------------------------------------------------- cadastro

export interface OltInput {
  name?: string; vendor?: string; model?: string; protocol?: string; host?: string; port?: number | string;
  username?: string; password?: string; enablePassword?: string; clearEnable?: boolean;
  connectTimeoutSec?: number | string; commandTimeoutSec?: number | string; note?: string; rev?: number;
}

/** Cria (sem id) ou altera. Senha em branco na alteração = mantém a atual. Devolve a OLT e o resumo para a auditoria. */
export async function save(id: string | null, e: OltInput, by: string) {
  const protocol = String(e.protocol ?? "telnet") as Protocol;
  if (!(protocol in PROTOCOLS)) throw new OltError("protocolo desconhecido");
  if (!PROTOCOLS[protocol].available) throw new OltError("acesso por SSH ainda não é suportado nesta versão: use telnet");
  const simulated = protocol === "simulado";
  const vendor = text(e.vendor ?? "ZTE", 40, true, "fabricante");
  const model = text(e.model ?? "C320", 40, true, "modelo");
  const drv = driverFor(vendor, model);
  if (!drv) throw new OltError(`não há driver para ${vendor} ${model}`);

  const d = {
    name: text(e.name, 80, true, "nome"),
    vendor,
    model,
    driverId: drv.manifest.id,
    protocol,
    host: simulated ? "simulado" : host(e.host),
    port: simulated ? 23 : int(e.port ?? PROTOCOLS[protocol].port, 1, 65535, "porta"),
    username: simulated ? "simulado" : (() => {
      const u = String(e.username ?? "").trim();
      if (!USER_RE.test(u)) throw new OltError("usuário: 1 a 60 caracteres (letras, números e . _ @ -)");
      return u;
    })(),
    connectTimeoutSec: int(e.connectTimeoutSec ?? 10, 3, 60, "tempo de conexão"),
    commandTimeoutSec: int(e.commandTimeoutSec ?? 30, 5, 300, "tempo por comando"),
    note: text(e.note ?? "", 500, false, "observação"),
  };
  const pass = e.password ? password(e.password, "senha") : "";
  const enable = e.enablePassword ? password(e.enablePassword, "senha de enable") : "";
  const now = new Date();

  const dup = await olts().findOne({ name: d.name, ...(id ? { _id: { $ne: new ObjectId(id) } } : {}) });
  if (dup) throw new OltError("já existe uma OLT com esse nome", 409);

  if (!id) {
    if (!simulated && !pass) throw new OltError("informe a senha da OLT");
    const doc: Olt = {
      ...d, active: true, rev: 1, compatibility: "desconhecida", authFailures: 0,
      passwordEnc: pass ? encrypt(pass) : null, enableEnc: enable ? encrypt(enable) : null,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    };
    const { insertedId } = await olts().insertOne(doc);
    return { olt: publicOlt({ ...doc, _id: insertedId }), audit: { acao: "criada", ...summary(doc) } };
  }

  const before = await get(id);
  // Mudou como se chega à OLT: o teste anterior deixa de valer.
  const accessChanged = before.host !== d.host || before.port !== d.port || before.protocol !== d.protocol || before.username !== d.username || before.model !== d.model || before.vendor !== d.vendor;
  const set: Partial<Olt> = { ...d, updatedAt: now, updatedBy: by };
  if (accessChanged) Object.assign(set, { compatibility: "desconhecida", lastTest: null, detected: null });
  if (pass) Object.assign(set, { passwordEnc: encrypt(pass), authFailures: 0, blockedUntil: null });
  if (enable) set.enableEnc = encrypt(enable);
  else if (e.clearEnable) set.enableEnc = null;
  if (simulated) Object.assign(set, { passwordEnc: null, enableEnc: null });
  const res = await olts().updateOne({ _id: before._id, ...(e.rev ? { rev: Number(e.rev) } : {}) }, { $set: set, $inc: { rev: 1 } });
  if (!res.matchedCount) throw new OltError("a OLT foi alterada por outra pessoa: recarregue a tela", 409);
  const after = await get(id);
  return {
    olt: publicOlt(after),
    audit: { acao: "alterada", ...summary(after), senhaTrocada: !!pass, enableTrocado: !!enable || !!e.clearEnable, acessoMudou: accessChanged },
  };
}

function summary(o: Olt) {
  return { nome: o.name, modelo: `${o.vendor} ${o.model}`, acesso: `${o.protocol} ${o.host}:${o.port}`, usuario: o.username };
}

export async function setActive(id: string, active: boolean, by: string) {
  const o = await get(id);
  await olts().updateOne({ _id: o._id }, { $set: { active, updatedAt: new Date(), updatedBy: by }, $inc: { rev: 1 } });
  return publicOlt(await get(id));
}

/** Remove a OLT e o histórico de testes. Exige digitar o nome. */
export async function remove(id: string, confirmName: string) {
  const o = await get(id);
  if (confirmName !== o.name) throw new OltError("digite o nome da OLT exatamente para confirmar");
  await oltTests().deleteMany({ oltId: o._id! });
  await olts().deleteOne({ _id: o._id });
  return summary(o);
}

// ---------------------------------------------------------------- acesso

const busy = new Set<string>();

function transportFor(o: Olt): Transport {
  if (o.protocol === "simulado") return new SimulatedTransport();
  if (!o.passwordEnc) throw new OltError("senha da OLT não cadastrada");
  return new TelnetTransport({
    host: o.host, port: o.port, username: o.username, password: decrypt(o.passwordEnc),
    enable: o.enableEnc ? decrypt(o.enableEnc) : null,
    connectTimeoutSec: o.connectTimeoutSec, commandTimeoutSec: o.commandTimeoutSec,
  });
}

/** Abre uma sessão na OLT (trava + login), roda fn com o driver e fecha. Usado pelo inventário e pelo envio. */
export async function withSession<T>(id: string, fn: (drv: OltDriver, o: Olt) => Promise<T>): Promise<T> {
  const o = await get(id);
  if (!o.active) throw new OltError("esta OLT está desativada", 409);
  if (o.blockedUntil && o.blockedUntil > new Date()) throw new OltError(`OLT bloqueada após falhas de login seguidas: nova tentativa a partir de ${o.blockedUntil.toLocaleTimeString("pt-BR")}`, 423);
  const key = String(o._id);
  if (busy.has(key)) throw new OltError("já existe uma operação em andamento nesta OLT: aguarde e tente de novo", 409);
  const drv = driverFor(o.vendor, o.model);
  if (!drv) throw new OltError(`não há driver para ${o.vendor} ${o.model}`);
  busy.add(key);
  const t = transportFor(o);
  try {
    try {
      await t.connect();
    } catch (e) {
      await countAuthFailure(o, e);
      throw e;
    }
    await olts().updateOne({ _id: o._id }, { $set: { authFailures: 0 } });
    return await fn(drv.create(t), o);
  } finally {
    await t.close().catch(() => undefined);
    busy.delete(key);
  }
}

async function countAuthFailure(o: Olt, e: unknown) {
  if (!(e instanceof OltFailure) || (e.kind !== "autenticacao" && e.kind !== "modo_usuario")) return;
  const failures = (o.authFailures ?? 0) + 1;
  const blockedUntil = failures >= AUTH_FAILURES_TO_BLOCK ? new Date(Date.now() + BLOCK_MINUTES * 60_000) : o.blockedUntil ?? null;
  await olts().updateOne({ _id: o._id }, { $set: { authFailures: failures, blockedUntil } });
}

function step(key: string, title: string, result: OltStep["result"], detail: string, started: number): OltStep {
  return { key, title, result, detail, ms: Date.now() - started };
}

/** Teste de acesso (só leitura). Sempre devolve as etapas; nunca lança por falha de rede/login. */
export async function test(id: string, by: string) {
  const o = await get(id);
  const steps: OltStep[] = [];
  type Ident = Awaited<ReturnType<OltDriver["identify"]>>;
  let ident = null as Ident | null;
  let compat = o.compatibility;
  const drv = driverFor(o.vendor, o.model);
  const t0 = Date.now();
  try {
    await withSession(id, async (driver) => {
      steps.push(step("conexao", "Conexão e login", "ok", `Conectado como ${o.username} (${o.protocol}).`, t0));
      const t1 = Date.now();
      try {
        ident = await driver.identify();
        steps.push(step("identificacao", "Identificação do equipamento", "ok", `${ident.identifier || "sem nome"}, versão ${ident.version}, ${ident.boards.length} placa(s).`, t1));
      } catch (e) {
        steps.push(step("identificacao", "Identificação do equipamento", "erro", e instanceof OltFailure ? e.describe() : String(e), t1));
      }
    });
  } catch (e) {
    const msg = e instanceof OltFailure ? e.describe() : e instanceof Error ? e.message : String(e);
    // Bloqueio, OLT em uso/desativada ou senha não cadastrada: não é teste de acesso, só informa.
    if (e instanceof OltError) throw e;
    if (!steps.length) steps.push(step("conexao", "Conexão e login", "erro", msg, t0));
  }
  // (atribuída dentro do callback: o TypeScript não acompanha, daí o cast)
  const id2 = ident as Ident | null;
  if (id2) {
    compat = compatibility(drv?.manifest ?? null, id2.version);
    steps.push(step("compatibilidade", "Compatibilidade do driver", compat === "validada" ? "ok" : "aviso",
      compat === "validada"
        ? `Versão ${id2.version} testada com o driver ${drv!.manifest.name}.`
        : `Versão ${id2.version} não está entre as testadas (${drv?.manifest.testedVersions.join(", ")}): somente leitura.`, Date.now()));
    const prev = o.detected?.identifier ?? "";
    if (prev && id2.identifier && prev !== id2.identifier) {
      steps.push(step("identidade", "Mesmo equipamento do teste anterior", "aviso", `Antes respondia como "${prev}", agora como "${id2.identifier}". Confirme que o endereço aponta para a OLT certa.`, Date.now()));
    }
  }
  const result: OltStep["result"] = steps.some((s) => s.result === "erro") ? "erro" : steps.some((s) => s.result === "aviso") ? "aviso" : "ok";
  const at = new Date();
  const code = `TST-OLT-${at.toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const lastTest = { at, result, code, by, summary: steps.filter((s) => s.result !== "ok").map((s) => `${s.title}: ${s.detail}`).join(" | ") || "ok", steps };
  const identDone = id2;
  await olts().updateOne({ _id: o._id }, {
    $set: {
      lastTest, compatibility: compat,
      ...(identDone ? { detected: { identifier: identDone.identifier, version: identDone.version, boards: identDone.boards, at } } : {}),
    },
  });
  await oltTests().insertOne({ oltId: o._id!, ...lastTest });
  return { ...lastTest, compatibility: compat, detected: identDone ? { identifier: identDone.identifier, version: identDone.version, boards: identDone.boards } : o.detected ?? null, manifest: drv?.manifest ?? null };
}
