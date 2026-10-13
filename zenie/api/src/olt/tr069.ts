// Ativação do TR-069 numa ONU pela OLT (O3, docs/OLT.md). ÚNICA operação do módulo OLT que ALTERA a OLT.
//
// Fluxo de um envio (registro em tr069_jobs, para a tela e o histórico):
//   enviando        sessão na OLT: tr069-mgmt (URL literal da config + credencial ativa do Zenie) e releitura do
//                   running config da ONU para confirmar o que ficou gravado;
//   aguardando_acs  a ONU recebe a configuração por OMCI e faz um novo primeiro contato (BOOTSTRAP): o verificador
//                   procura na NBI o serial PON com inform depois do envio (até 15 min);
//   concluido       chegou; testa o connection request (crOk) e atualiza o índice do Zenie;
//   falha / nao_chegou.
// A senha do ACS vai na linha da OLT (exigência do comando) e em mais nenhum lugar: nem job, nem log, nem auditoria.

import { ObjectId } from "mongodb";
import { config } from "../config.js";
import { acsCredentials, audit, inventory, oltOnus, olts, tr069Jobs, type Tr069Job } from "../db.js";
import { onlineState } from "../rules.js";
import { fetchDevice, refreshInventory, runTask } from "../device.js";
import { nbiGet, type NbiDevice } from "../nbi.js";
import { decrypt } from "../secrets.js";
import { driverFor } from "./driver.js";
import { get, OltError, withSession } from "./service.js";
import { canBeOnu, jobForOnu, jobOf, samePonSerial, sentWithCurrent } from "./inventory.js";
import { OltFailure } from "./transport.js";

const WAIT_MINUTES = 15;

export async function sendTr069(oltId: string, onuId: string, by: string, opts: { allowExperimental?: boolean } = {}): Promise<Tr069Job> {
  const o = await get(oltId);
  const onu = await oltOnus().findOne({ _id: onuId, oltId: o._id! });
  if (!onu) throw new OltError("ONU não encontrada nesta OLT: leia as ONUs de novo", 404);
  if (onu.absentSince) throw new OltError("esta ONU não apareceu na última leitura da OLT");
  const drv = driverFor(o.vendor, o.model);
  if (!drv || drv.manifest.features.ativar_tr069 === "indisponivel") throw new OltError("o driver desta OLT não ativa TR-069");
  if (o.compatibility !== "validada") throw new OltError("só é possível alterar OLTs com compatibilidade VALIDADA: faça o teste de acesso");
  if (onu.vendor !== "ZTEG" && !opts.allowExperimental) throw new OltError("ONU de outro fabricante: o TR-069 por OMCI não foi validado nela; confirme como experimental para enviar");
  const url = config.acsUrl;
  if (!url) throw new OltError("URL do ACS não definida (ZENIE_ACS_URL / GENIEACS_FS_HOSTNAME)");
  const cred = await acsCredentials().findOne({ status: "active" });
  if (!cred) throw new OltError("cadastre a credencial do ACS em Segurança do ACS antes de ativar o TR-069");
  if (await tr069Jobs().findOne({ onuId, state: { $in: ["enviando", "aguardando_acs"] } })) throw new OltError("já há um envio em andamento para esta ONU", 409);
  // Já está ok: não regravar (provocaria um novo primeiro contato à toa — decisão do usuário, 08/10/2026).
  // "Ok" exige a senha CONFERIDA: pela leitura da OLT (passwordMatches) ou pelo envio do Zenie com a credencial atual.
  const t = onu.tr069;
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\/+$/, "").toLowerCase();
  const lastJob = jobForOnu(await tr069Jobs().findOne({ onuId }, { sort: { createdAt: -1 } }), onu.sn);
  const passwordOk = t?.passwordMatches === true || sentWithCurrent(lastJob, { username: cred.username, credentialSince: cred.createdAt ?? null });
  if (t?.configured && t.state === "unlock" && norm(t.acsUrl) === norm(url) && t.username === cred.username && passwordOk) {
    throw new OltError("esta ONU já está configurada pela OLT com a credencial atual", 409);
  }
  const keys = [...(onu.sn ? [{ ponSerialKey: onu.sn }] : []), ...(onu.pppoe ? [{ pppoeKey: onu.pppoe }] : [])];
  // Pelo login só conta equipamento sem SN GPON conhecido ou com o mesmo SN (troca de aparelho: o antigo não vale).
  const inZenie = keys.length
    ? (await inventory().find({ $or: keys, staleOf: { $in: [null, undefined] } }, { projection: { lastInform: 1, ponSerialKey: 1, accessType: 1 } }).toArray()).find((d) => canBeOnu(d.accessType) && samePonSerial(d.ponSerialKey, onu.sn)) ?? null
    : null;
  const zstate = inZenie ? onlineState(inZenie.lastInform) : null;
  if (zstate === "online" || zstate === "late") throw new OltError("esta ONU já fala com o ACS (configurada na própria ONU): não precisa do envio pela OLT", 409);

  const job: Tr069Job = {
    oltId: o._id!, onuId, position: `${onu.slot}/${onu.pon}:${onu.onu}`, sn: onu.sn, pppoe: onu.pppoe ?? null, vendor: onu.vendor,
    url, username: cred.username, state: "enviando", by, createdAt: new Date(), sentAt: null, finishedAt: null,
    deviceId: null, crOk: null, error: null,
    steps: [{ at: new Date(), text: `enviando tr069-mgmt (URL ${url}, usuário ${cred.username})` }],
  };
  const { insertedId } = await tr069Jobs().insertOne(job);
  job._id = insertedId;
  const step = async (patch: Partial<Tr069Job>, text: string) => {
    Object.assign(job, patch);
    job.steps.push({ at: new Date(), text });
    await tr069Jobs().updateOne({ _id: insertedId }, { $set: { ...patch, steps: job.steps } });
  };

  try {
    await withSession(oltId, async (d) => {
      const password = decrypt(cred.passwordEnc);
      await d.activateTr069(onu.slot, onu.pon, onu.onu, url, cred.username, password);
      // Confere o que ficou gravado na OLT (e atualiza a linha da lista).
      const now = await d.onuTr069(onu.slot, onu.pon, onu.onu, password);
      await oltOnus().updateOne({ _id: onuId }, { $set: { tr069: { ...now, readAt: new Date() }, tr069Error: null } });
      const norm = (u: string | null) => (u ?? "").replace(/\/+$/, "").toLowerCase();
      if (!now.configured || now.state !== "unlock" || norm(now.acsUrl) !== norm(url) || now.username !== cred.username || now.passwordMatches === false) {
        throw new OltFailure("formato", "a OLT aceitou os comandos, mas a releitura não mostra a configuração esperada");
      }
    });
    if (o.protocol === "simulado") {
      await step({ state: "concluido", sentAt: new Date(), finishedAt: new Date() }, "gravado e conferido na OLT simulada (não há ONU real para chegar ao ACS)");
    } else {
      await step({ state: "aguardando_acs", sentAt: new Date() }, `gravado na OLT e conferido; aguardando a ONU chegar ao ACS (até ${WAIT_MINUTES} min)`);
    }
  } catch (e) {
    const msg = e instanceof OltFailure ? e.describe() : e instanceof Error ? e.message : String(e);
    await step({ state: "falha", error: msg, finishedAt: new Date() }, `falhou: ${msg}`);
  }
  return job;
}

// ---------------------------------------------------------------- lote (O4)

export interface BatchState {
  running: boolean;
  by: string;
  startedAt: Date;
  finishedAt: Date | null;
  total: number;
  done: number;
  failed: number;
  skipped: { position: string; reason: string }[];
  current: string | null;
}
const batches = new Map<string, BatchState>();
export const batchOf = (oltId: string): BatchState | null => batches.get(oltId) ?? null;

/**
 * Lote em ondas pequenas (CLAUDE.md): até config.tr069BatchMax ONUs, confirmadas digitando a quantidade. Roda em
 * segundo plano, uma ONU de cada vez (cada uma com seu registro em tr069_jobs, como o envio individual).
 */
export async function startBatch(oltId: string, onuIds: string[], confirmCount: number, by: string, opts: { allowExperimental?: boolean } = {}) {
  const ids = [...new Set(onuIds)];
  if (!ids.length) throw new OltError("selecione ao menos uma ONU");
  if (ids.length > config.tr069BatchMax) throw new OltError(`no máximo ${config.tr069BatchMax} ONUs por lote (ondas pequenas)`);
  if (confirmCount !== ids.length) throw new OltError("a confirmação não bate com a quantidade selecionada");
  if (batches.get(oltId)?.running) throw new OltError("já há um lote em andamento nesta OLT", 409);
  const o = await get(oltId);
  const onus = await oltOnus().find({ _id: { $in: ids }, oltId: o._id! }).toArray();
  if (onus.length !== ids.length) throw new OltError("alguma ONU selecionada não está mais nesta OLT: leia as ONUs de novo");
  const state: BatchState = { running: true, by, startedAt: new Date(), finishedAt: null, total: ids.length, done: 0, failed: 0, skipped: [], current: null };
  batches.set(oltId, state);
  await audit().insertOne({ ts: new Date(), username: by, action: "olt.tr069.lote", target: oltId, ok: true, details: { onus: onus.map((x) => `${x.slot}/${x.pon}:${x.onu}`).join(", "), quantidade: ids.length } });
  void (async () => {
    for (const onu of onus) {
      const position = `${onu.slot}/${onu.pon}:${onu.onu}`;
      state.current = position;
      try {
        const job = await sendTr069(oltId, onu._id, by, opts);
        if (job.state === "falha") state.failed++;
        await audit().insertOne({ ts: new Date(), username: by, action: "olt.tr069.envio", target: onu._id, ok: job.state !== "falha", details: { posicao: position, sn: job.sn, url: job.url, usuario: job.username, resultado: job.state, lote: true, ...(job.error ? { erro: job.error } : {}) } });
      } catch (e) {
        // Pré-condição da ONU (ex.: envio em andamento, outro fabricante sem confirmação): pula e segue.
        state.skipped.push({ position, reason: e instanceof Error ? e.message : String(e) });
      }
      state.done++;
      await new Promise((r) => setTimeout(r, 2000)); // folga para a OLT entre uma ONU e outra
    }
  })().finally(() => {
    state.running = false;
    state.current = null;
    state.finishedAt = new Date();
  });
  return state;
}

// ---------------------------------------------------------------- salvar configuração (write, O4)

/** Grava a running config na flash. Só por botão explícito; nunca automático. */
/** OLTs gravando a configuração na flash agora (a leitura das PONs espera). */
export const savingOlts = new Set<string>();

export async function saveOltConfig(oltId: string, by: string) {
  const o = await get(oltId);
  if (o.compatibility !== "validada") throw new OltError("só é possível alterar OLTs com compatibilidade VALIDADA");
  if (batches.get(oltId)?.running) throw new OltError("aguarde o lote em andamento terminar antes de salvar", 409);
  // Nunca gravar na flash com a leitura das PONs em andamento (decisão do usuário, 2026-10-09).
  if (jobOf(oltId)?.running) throw new OltError("aguarde a leitura das PONs terminar antes de salvar a configuração", 409);
  if (savingOlts.has(oltId)) throw new OltError("a configuração desta OLT já está sendo salva", 409);
  const drv = driverFor(o.vendor, o.model);
  if (!drv || drv.manifest.features.salvar_configuracao === "indisponivel") throw new OltError("o driver desta OLT não salva a configuração");
  savingOlts.add(oltId);
  try {
    await withSession(oltId, (d) => d.saveConfig());
  } finally {
    savingOlts.delete(oltId);
  }
  const savedAt = new Date();
  await olts().updateOne({ _id: o._id }, { $set: { savedAt, savedBy: by } });
  return { savedAt, savedBy: by };
}

/** Último envio de cada ONU de uma OLT (para a lista). */
export async function latestJobs(oltId: ObjectId): Promise<Map<string, Tr069Job>> {
  const list = await tr069Jobs().find({ oltId }).sort({ createdAt: -1 }).limit(2000).toArray();
  const out = new Map<string, Tr069Job>();
  for (const j of list) if (!out.has(j.onuId)) out.set(j.onuId, j);
  return out;
}

export async function jobsOf(onuId: string) {
  return tr069Jobs().find({ onuId }).sort({ createdAt: -1 }).limit(10).toArray();
}

/** Verificador: a ONU chegou ao ACS? Roda a cada 20 s. */
async function checkWaiting(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const waiting = await tr069Jobs().find({ state: "aguardando_acs" }).toArray();
  for (const job of waiting) {
    try {
      const done = async (patch: Partial<Tr069Job>, text: string) => {
        job.steps.push({ at: new Date(), text });
        await tr069Jobs().updateOne({ _id: job._id }, { $set: { ...patch, finishedAt: new Date(), steps: job.steps } });
        log.info({ job: String(job._id), position: job.position, state: patch.state }, "envio de TR-069 pela OLT finalizado");
      };
      // Pelo SN GPON e, se o firmware não publica o SN, pelo login PPPoE configurado pela OLT.
      let dev: NbiDevice | undefined;
      const or = [
        ...(job.sn ? [{ "VirtualParameters.PonSerial": job.sn }] : []),
        ...(job.pppoe ? [{ "VirtualParameters.PPPoEUsername": job.pppoe }] : []),
      ];
      if (or.length) {
        const q = encodeURIComponent(JSON.stringify(or.length === 1 ? or[0] : { $or: or }));
        const found = (await nbiGet<NbiDevice[]>(`/devices/?query=${q}&projection=_id,_lastInform,VirtualParameters.PonSerial,VirtualParameters.AccessType`))
          // Achado pelo login com outro SN GPON = outro aparelho com o mesmo login (troca de equipamento): não é esta ONU.
          .filter((d) => canBeOnu(d.VirtualParameters?.AccessType?._value as string | undefined) && samePonSerial(d.VirtualParameters?.PonSerial?._value as string | undefined, job.sn));
        dev = found.sort((a, b) => Date.parse(b._lastInform ?? "0") - Date.parse(a._lastInform ?? "0"))[0];
      }
      const last = dev?._lastInform ? new Date(dev._lastInform) : null;
      if (dev && last && job.sentAt && last > job.sentAt) {
        const cr = await runTask(dev._id, { name: "getParameterValues", parameterNames: ["VirtualParameters.Uptime"] }, 30_000);
        const full = await fetchDevice(dev._id);
        if (full) await refreshInventory(full);
        await done({ state: "concluido", deviceId: dev._id, crOk: cr.ok },
          cr.ok ? `chegou ao ACS (${dev._id}); connection request ok` : `chegou ao ACS (${dev._id}); connection request falhou: ${cr.message ?? cr.outcome}`);
      } else if (job.sentAt && Date.now() - job.sentAt.getTime() > WAIT_MINUTES * 60_000) {
        await done({ state: "nao_chegou" }, `a ONU não chegou ao ACS em ${WAIT_MINUTES} min (confira a WAN de TR-069/rota até o ACS)`);
      }
    } catch (e) {
      log.error({ err: e, job: String(job._id) }, "falha ao verificar envio de TR-069");
    }
  }
}

export function startTr069Watcher(log: Parameters<typeof checkWaiting>[0]): NodeJS.Timeout {
  return setInterval(() => void checkWaiting(log), 20_000);
}
