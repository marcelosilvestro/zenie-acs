// Inventário de ONUs por OLT (O2, docs/OLT.md) — SOMENTE LEITURA na OLT. Porte do fluxo do addon zte_onu.
//
// Numa única sessão (withSession: trava por OLT, bloqueio por falha de login):
//   1. descobre quais slots/portas são PON (state por porta; recusa na porta 1 = placa não é PON);
//   2. por PON: state + baseinfo (SN, fase) e, por ONU, o running config → só os campos do TR-069;
//   3. grava em olt_onus; posição que sumiu da OLT não é apagada: ganha absentSince.
// Roda em segundo plano (a tela acompanha o progresso). A saída do running config traz senhas de PPPoE: nada
// dela é gravado além do que o parser extrai.

import type { ObjectId } from "mongodb";
import { acsCredentials, inventory, oltOnus, olts, tr069Jobs, type Olt, type OltOnu, type Tr069Job } from "../db.js";
import { decrypt } from "../secrets.js";
import { config } from "../config.js";
import { onlineState } from "../rules.js";
import { OltFailure } from "./transport.js";
import { OltError, withSession } from "./service.js";
import { batchOf, latestJobs, savingOlts } from "./tr069.js";
import { fillPonSerialFromOlt } from "../inventory.js";

const MAX_PORTS = 16;

export interface InventoryJob {
  running: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  by: string;
  step: string;
  ponsTotal: number;
  ponsDone: number;
  onusRead: number;
  error: string | null;
}

const jobs = new Map<string, InventoryJob>();

export const jobOf = (oltId: string): InventoryJob | null => jobs.get(oltId) ?? null;

/** Dispara a leitura em segundo plano. Recusa se já houver leitura nesta OLT. */
export async function startRead(oltId: string, by: string): Promise<InventoryJob> {
  if (jobs.get(oltId)?.running) throw new OltError("a leitura desta OLT já está em andamento", 409);
  if (savingOlts.has(oltId)) throw new OltError("a configuração da OLT está sendo salva na flash: leia depois que terminar", 409);
  const job: InventoryJob = { running: true, startedAt: new Date(), finishedAt: null, by, step: "conectando", ponsTotal: 0, ponsDone: 0, onusRead: 0, error: null };
  jobs.set(oltId, job);
  void read(oltId, job).catch((e) => {
    job.error = e instanceof OltFailure ? e.describe() : e instanceof Error ? e.message : String(e);
  }).finally(() => {
    job.running = false;
    job.finishedAt = new Date();
    job.step = job.error ? "falhou" : "concluída";
  });
  return job;
}

async function read(oltId: string, job: InventoryJob): Promise<void> {
  await withSession(oltId, async (drv, o) => {
    const boards = o.detected?.boards ?? [];
    if (!boards.length) throw new OltError("faça o teste de acesso antes: as placas da OLT ainda não foram identificadas");

    // 1. Descoberta das PONs
    job.step = "descobrindo as PONs";
    const pons: { slot: number; pon: number; onus: number }[] = [];
    for (const b of boards) {
      let answered = false;
      for (let port = 1; port <= MAX_PORTS; port++) {
        try {
          const s = await drv.ponState(b.slot, port);
          pons.push({ slot: b.slot, pon: port, onus: s.total });
          answered = true;
        } catch (e) {
          if (!(e instanceof OltFailure)) throw e;
          // Recusada já na porta 1: a placa não é de PON (ex.: controladora). Depois de uma porta válida, uma
          // recusa só pula AQUELA porta (a OLT real recusou a 2/12 e havia ONUs na 2/13-2/16).
          if (e.kind === "comando") {
            if (!answered) break;
            continue;
          }
          throw e; // queda/timeout/formato: aborta, não inventa resultado
        }
      }
    }
    job.ponsTotal = pons.filter((p) => p.onus > 0).length;
    // Senha esperada: o parser só COMPARA (senha antiga depois de uma troca), nada é guardado.
    const active = await acsCredentials().findOne({ status: "active" });
    const expectedPassword = active ? decrypt(active.passwordEnc) : null;
    await olts().updateOne({ _id: o._id }, { $set: { pons: pons.map((p) => ({ ...p, at: new Date() })) } });

    // 2. Leitura por PON
    for (const p of pons) {
      if (!p.onus) {
        await markAbsent(o._id!, p.slot, p.pon, new Set());
        continue;
      }
      job.step = `lendo a PON ${p.slot}/${p.pon}`;
      const state = await drv.ponState(p.slot, p.pon);
      const base = await drv.ponBaseInfo(p.slot, p.pon);
      const seen = new Set<number>();
      const now = new Date();
      for (const s of state.onus) {
        seen.add(s.onu);
        const b = base.get(s.onu);
        let tr069: OltOnu["tr069"] = null;
        let tr069Error: string | null = null;
        try {
          tr069 = { ...(await drv.onuTr069(p.slot, p.pon, s.onu, expectedPassword)), readAt: new Date() };
        } catch (e) {
          if (!(e instanceof OltFailure) || (e.kind !== "comando" && e.kind !== "formato")) throw e;
          tr069Error = e.describe();
        }
        job.onusRead++;
        const id = `${String(o._id)}:${p.slot}/${p.pon}:${s.onu}`;
        await oltOnus().updateOne(
          { _id: id },
          {
            $set: {
              oltId: o._id!, slot: p.slot, pon: p.pon, onu: s.onu,
              sn: b?.sn || null, vendor: b?.vendor || null, type: b?.type ?? null,
              admin: s.admin, omcc: s.omcc, phase: s.phase, online: s.online,
              tr069, tr069Error, pppoe: tr069?.pppoeUser ? tr069.pppoeUser.toLowerCase() : null, seenAt: now, absentSince: null,
            },
          },
          { upsert: true },
        );
      }
      await markAbsent(o._id!, p.slot, p.pon, seen);
      job.ponsDone++;
    }
    await olts().updateOne({ _id: o._id }, { $set: { inventoryAt: new Date() } });
    await fillPonSerialFromOlt();
  });
}

/** Posições que não apareceram nesta leitura: ficam com absentSince (não são apagadas). */
async function markAbsent(oltId: ObjectId, slot: number, pon: number, seen: Set<number>) {
  await oltOnus().updateMany({ oltId, slot, pon, onu: { $nin: [...seen] }, absentSince: null }, { $set: { absentSince: new Date(), online: false } });
}

// ---------------------------------------------------------------- listagem com o cruzamento

export type Tr069Status = "ok" | "onu" | "senha" | "divergente" | "bloqueado" | "nao" | "desconhecido";

/** Situações que pedem ação (enviar o tr069-mgmt pela OLT). */
export const PENDING: Tr069Status[] = ["nao", "divergente", "senha", "bloqueado"];

const norm = (u: string | null | undefined) => (u ?? "").trim().replace(/\/+$/, "").toLowerCase();

/** O que esperar na ONU: URL deste ACS + usuário da credencial ativa do Zenie. */
/**
 * Troca de equipamento na mesma posição da OLT (ou do cliente, com o mesmo login PPPoE): o que foi registrado para o
 * aparelho anterior não vale para o novo (bancada 2026-10-09: F670L V1 na posição do F6201B mostrava "chegou ao ACS"
 * e o F6201B como "No Zenie").
 * - envio pela OLT: só vale para a ONU se foi feito para o MESMO SN que está hoje na posição;
 * - casar pelo login PPPoE: só se o equipamento do Zenie não tem SN GPON conhecido ou tem o mesmo SN da ONU.
 */
export const jobForOnu = <J extends { sn: string | null }>(job: J | null | undefined, sn: string | null | undefined): J | null =>
  job && (!job.sn || !sn || job.sn.toUpperCase() === sn.toUpperCase()) ? job : null;

/**
 * Pode ser a própria ONU? Roteador (AccessType "Roteador") nunca é: atrás de ONU em bridge ele usa o MESMO login
 * PPPoE que a OLT configurou na ONU (bancada 2026-10-09: H198A teste_ztev9 atrás da F6600P 1/16:13 aparecia como
 * a ONU, com o SN PON dela). Tipo desconhecido continua valendo.
 */
export const canBeOnu = (accessType: string | null | undefined): boolean => accessType !== "Roteador";

export const samePonSerial = (devicePonSerial: string | null | undefined, onuSn: string | null | undefined): boolean =>
  !devicePonSerial || !onuSn || devicePonSerial.toUpperCase() === onuSn.toUpperCase();

export async function expectedAcs() {
  const active = await acsCredentials().findOne({ status: "active" });
  return { url: config.acsUrl, username: active?.username ?? null, credentialSince: active?.createdAt ?? null };
}

/**
 * O Zenie gravou nesta ONU, pela OLT, a credencial ATIVA? (envio feito depois de a credencial ser criada). Vale
 * como senha conferida quando a leitura da OLT não comparou (passwordMatches null: leitura antiga, feita antes da
 * correção da quebra de 80 colunas, ou sem credencial ativa). Ao religar a ONU, o OMCI regrava o TR-069 da OLT por
 * cima do que estava na ONU (testeZTE2, 2026-10-09).
 */
export function sentWithCurrent(job: Pick<Tr069Job, "username" | "sentAt" | "createdAt"> | null | undefined, expected: { username: string | null; credentialSince: Date | null }): boolean {
  return !!job && !!job.sentAt && job.username === expected.username && (!expected.credentialSince || job.createdAt >= expected.credentialSince);
}

/**
 * Situação do TR-069 da ONU. A OLT manda (OMCI); mas uma ONU sem a configuração na OLT que está falando com o ACS
 * (online/atrasada no Zenie — com a exigência de senha, isso prova a credencial) foi configurada na própria ONU
 * (ex.: teste_ztev9, pela tela dela): "onu", que não é pendência.
 */
export function tr069Status(o: Pick<OltOnu, "tr069" | "tr069Error"> & { online?: boolean }, expected: { url: string | null; username: string | null }, zenieState?: string | null, sentByZenie = false): Tr069Status {
  const s = oltTr069Status(o, expected);
  if ((s === "nao" || s === "divergente" || s === "senha" || s === "desconhecido") && (zenieState === "online" || zenieState === "late")) return "onu";
  // URL e usuário certos, senha não conferida (configuração feita fora do Zenie) e a ONU não chega ao ACS: a senha
  // da OLT é a suspeita -> "senha" (reenviar). Online no Zenie continua "ok" (a ONU tem a senha certa agora).
  if (s === "ok" && o.tr069?.passwordMatches !== true && !sentByZenie && (zenieState === "offline" || (!zenieState && o.online))) return "senha";
  return s;
}

function oltTr069Status(o: Pick<OltOnu, "tr069" | "tr069Error">, expected: { url: string | null; username: string | null }): Tr069Status {
  if (!o.tr069) return "desconhecido";
  if (!o.tr069.configured) return "nao";
  if (o.tr069.state === "lock") return "bloqueado";
  const urlOk = !expected.url || norm(o.tr069.acsUrl) === norm(expected.url);
  const userOk = !expected.username || o.tr069.username === expected.username;
  if (!urlOk || !userOk) return "divergente";
  // URL e usuário certos, mas a senha na OLT não é a da credencial ativa (troca de senha): reenviar.
  return o.tr069.passwordMatches === false ? "senha" : "ok";
}

export interface OnuFilter { pon?: string; phase?: string; vendor?: string; tr069?: string; zenie?: string; q?: string; absent?: string; page?: string | number; pageSize?: string | number }

export async function listOnus(o: Olt, f: OnuFilter) {
  const all = await oltOnus().find({ oltId: o._id! }).sort({ slot: 1, pon: 1, onu: 1 }).toArray();
  const expected = await expectedAcs();
  // Casa pelo SN GPON e, se o equipamento não publica o SN, pelo login PPPoE que a OLT configurou.
  const sns = all.map((x) => x.sn).filter((s): s is string => !!s);
  const logins = all.map((x) => x.pppoe).filter((s): s is string => !!s);
  const devs = await inventory().find({ $or: [{ ponSerialKey: { $in: sns } }, { pppoeKey: { $in: logins } }] }, { projection: { _id: 1, ponSerialKey: 1, pppoeKey: 1, pppoe: 1, model: 1, lastInform: 1, staleOf: 1, accessType: 1 } }).toArray();
  const jobs = await latestJobs(o._id!);
  const bySn = new Map<string, (typeof devs)[number]>();
  const byLogin = new Map<string, (typeof devs)[number][]>();
  for (const d of devs) {
    if (d.ponSerialKey && canBeOnu(d.accessType) && (!d.staleOf || !bySn.has(d.ponSerialKey))) bySn.set(d.ponSerialKey, d);
    if (d.pppoeKey) byLogin.set(d.pppoeKey, [...(byLogin.get(d.pppoeKey) ?? []), d]);
  }
  // Pelo login, só equipamento sem SN GPON conhecido ou com o mesmo SN (outro SN = outro aparelho); o atual primeiro.
  const byLoginFor = (login: string, sn: string | null) =>
    (byLogin.get(login) ?? []).filter((d) => canBeOnu(d.accessType) && samePonSerial(d.ponSerialKey, sn)).sort((a, b) => Number(!!a.staleOf) - Number(!!b.staleOf))[0];

  const rows = all.map((x) => {
    const d = (x.sn ? bySn.get(x.sn) : undefined) ?? (x.pppoe ? byLoginFor(x.pppoe, x.sn) : undefined);
    const job = jobForOnu(jobs.get(x._id), x.sn);
    const zstate = d ? onlineState(d.lastInform) : null;
    return {
      id: x._id,
      slot: x.slot, pon: x.pon, onu: x.onu,
      position: `${x.slot}/${x.pon}:${x.onu}`,
      sn: x.sn, vendor: x.vendor, type: x.type, pppoe: x.pppoe ?? null,
      phase: x.phase, online: x.online, absentSince: x.absentSince,
      tr069: x.tr069 ? { configured: x.tr069.configured, state: x.tr069.state, acsUrl: x.tr069.acsUrl, username: x.tr069.username, validate: x.tr069.validate, readAt: x.tr069.readAt } : null,
      tr069Error: x.tr069Error,
      tr069Status: tr069Status(x, expected, zstate, sentWithCurrent(job, expected)),
      zenie: d ? { id: d._id, pppoe: d.pppoe, model: d.model, lastInform: d.lastInform, state: zstate! } : null,
      seenAt: x.seenAt,
      job: (() => {
        const j = job;
        return j ? { state: j.state, createdAt: j.createdAt, by: j.by, error: j.error, crOk: j.crOk, last: j.steps.at(-1)?.text ?? null } : null;
      })(),
    };
  });

  const counters = {
    total: rows.filter((r) => !r.absentSince).length,
    online: rows.filter((r) => !r.absentSince && r.online).length,
    tr069Ok: rows.filter((r) => !r.absentSince && (r.tr069Status === "ok" || r.tr069Status === "onu")).length,
    tr069Missing: rows.filter((r) => !r.absentSince && PENDING.includes(r.tr069Status)).length,
    inZenie: rows.filter((r) => !r.absentSince && r.zenie).length,
    absent: rows.filter((r) => r.absentSince).length,
  };

  const q = (f.q ?? "").trim().toUpperCase();
  const filtered = rows.filter((r) =>
    (f.absent === "1" ? !!r.absentSince : !r.absentSince) &&
    (!f.pon || `${r.slot}/${r.pon}` === f.pon) &&
    (!f.phase || (f.phase === "online" ? r.online : !r.online)) &&
    (!f.vendor || (f.vendor === "ZTEG" ? r.vendor === "ZTEG" : r.vendor !== "ZTEG")) &&
    (!f.tr069 || (f.tr069 === "pendente" ? PENDING.includes(r.tr069Status) : f.tr069 === "ativo" ? r.tr069Status === "ok" || r.tr069Status === "onu" : r.tr069Status === f.tr069)) &&
    (!f.zenie || (f.zenie === "sim" ? !!r.zenie : !r.zenie)) &&
    (!q || (r.sn ?? "").includes(q) || (r.zenie?.pppoe ?? r.pppoe ?? "").toUpperCase().includes(q) || r.position.includes(q)),
  );

  const pons = [...new Set(rows.map((r) => `${r.slot}/${r.pon}`))];
  // Paginação no servidor (OLT cheia = centenas de ONUs); contadores e filtros valem para o total.
  const pageSize = Math.min(200, Math.max(10, Number(f.pageSize) || 50));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number(f.page) || 1));
  // Envios gravados na OLT depois do último "Salvar configuração" (write): ainda não estão na flash.
  const unsaved = await tr069Jobs().countDocuments({ oltId: o._id!, sentAt: { $ne: null, ...(o.savedAt ? { $gt: o.savedAt } : {}) } });
  return {
    counters, pons, expected, inventoryAt: o.inventoryAt ?? null,
    batch: batchOf(String(o._id)), batchMax: config.tr069BatchMax,
    save: { savedAt: o.savedAt ?? null, savedBy: o.savedBy ?? null, unsaved },
    total: filtered.length, page, pages, pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
  };
}
