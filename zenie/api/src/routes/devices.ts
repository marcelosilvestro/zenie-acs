import type { FastifyInstance } from "fastify";
import type { Filter } from "mongodb";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { buildDevice, fetchDevice, LIST_VPS, refreshInventory, runTask, SCALAR_VPS } from "../device.js";
import { meshAdapter } from "../adapters/index.js";
import type { MeshAdapter } from "../adapters/types.js";
import { capabilityFor } from "../catalog.js";
import { guard } from "../guard.js";
import { nbiDeleteDevice, nbiDeletePending } from "../nbi.js";
import { inventory, type InventoryItem } from "../db.js";
import { eventsFor } from "../events.js";
import { buildIncidents, markMass } from "../incidents.js";
import { readOnuHistory } from "../olt/history.js";
import { OltError } from "../olt/service.js";
import { OltFailure } from "../olt/transport.js";
import { config } from "../config.js";
import { macKey, syncInventory } from "../inventory.js";
import { onlineState, rssiQuality, rules, rxLevel } from "../rules.js";

type Kind = "mac" | "ip" | "text";

const oltHistoryCache = new Map<string, { at: number; result: Awaited<ReturnType<typeof readOnuHistory>> }>();

interface MeshTopo { enabled: boolean | null; nodes?: { key: string; role: string; model: string | null; serial: string | null; deviceId: string | null }[] }

/** Aparelhos de todos os nós da mesh; null se o equipamento não tem mesh ligada ou não tem satélites. */
async function readMeshClients(id: string, mesh: MeshAdapter, refresh: boolean) {
  if ((await mesh.topology(id) as MeshTopo).enabled !== true) return null;
  // A lista de cada nó só vem do equipamento com refreshObject (fica fora do inform).
  const res = refresh ? await runTask(id, { name: "refreshObject", objectName: mesh.root }, 60_000) : null;
  const topo = await mesh.topology(id) as MeshTopo;
  const nodes = topo.nodes ?? [];
  if (nodes.length < 2) return null;
  const stations = [];
  for (const n of nodes) {
    for (const s of (await mesh.stations(id, n.key)) ?? []) stations.push({ ...(s as object), node: n.key });
  }
  return {
    source: mesh.id,
    refreshed: res?.ok ?? false,
    nodes: nodes.map((n) => ({ key: n.key, role: n.role, model: n.model, serial: n.serial, deviceId: n.deviceId })),
    stations,
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Descobre o tipo do termo: MAC (>= 6 hex, com/sem separador), IP (parcial ou completo) ou texto. */
export function classify(q: string): Kind {
  const t = q.trim();
  if (/^\d{1,3}(\.\d{1,3}){1,3}\.?$/.test(t)) return "ip";
  const hex = t.replace(/[:\-.]/g, "");
  if (/^[0-9a-fA-F]{6,12}$/.test(hex) && (/[:\-]/.test(t) || /[a-fA-F]/.test(hex) || hex.length === 12)) return "mac";
  return "text";
}

function buildFilter(q: string): { filter: Filter<InventoryItem>; kind: Kind } {
  const kind = classify(q);
  const t = q.trim();
  // Termo com cara de MAC também procura no PPPoE (login como "abc123def456" é só hex).
  if (kind === "mac") {
    return { kind, filter: { $or: [{ macs: { $regex: "^" + escapeRegex(macKey(t)) } }, { pppoeKey: { $regex: escapeRegex(t.toLowerCase()) } }] } };
  }
  if (kind === "ip") return { kind, filter: { wanIp: { $regex: "^" + escapeRegex(t) } } };
  const lower = escapeRegex(t.toLowerCase());
  const upper = escapeRegex(t.toUpperCase());
  return {
    kind,
    filter: {
      $or: [
        { pppoeKey: { $regex: lower } },
        { ponSerialKey: { $regex: "^" + upper } },
        { serialKey: { $regex: "^" + upper } },
        { _id: { $regex: escapeRegex(t), $options: "i" } },
      ],
    },
  };
}

/** Onde o termo bateu (para destacar na tela) e se foi exato (ordena primeiro). */
function matchInfo(item: InventoryItem, q: string, kind: Kind): { field: string; exact: boolean } {
  const t = q.trim();
  if (kind === "mac" && item.macs.some((m) => m.startsWith(macKey(t)))) return { field: "mac", exact: item.macs.includes(macKey(t)) };
  if (kind === "mac") return { field: "pppoe", exact: item.pppoeKey === t.toLowerCase() };
  if (kind === "ip") return { field: "wanIp", exact: item.wanIp === t };
  if (item.pppoeKey && item.pppoeKey.includes(t.toLowerCase())) return { field: "pppoe", exact: item.pppoeKey === t.toLowerCase() };
  if (item.ponSerialKey.startsWith(t.toUpperCase())) return { field: "ponSerial", exact: item.ponSerialKey === t.toUpperCase() };
  if (item.serialKey.startsWith(t.toUpperCase())) return { field: "serial", exact: item.serialKey === t.toUpperCase() };
  return { field: "id", exact: item._id === t };
}

export function present(item: InventoryItem, now = Date.now()) {
  return {
    id: item._id,
    vendor: item.vendor,
    model: item.model,
    serial: item.serial,
    pppoe: item.pppoe,
    ponSerial: item.ponSerial,
    macs: item.macs.map((m) => m.match(/.{2}/g)!.join(":")),
    wanIp: item.wanIp,
    wanStatus: item.wanStatus,
    accessType: item.accessType,
    firmware: item.firmware,
    wifiGeneration: item.wifiGeneration ?? null,
    profileId: item.profileId ?? null,
    homologated: !!item.homologated,
    staleOf: item.staleOf ?? null,
    rx: item.rx,
    rxLevel: rxLevel(item.rx),
    tx: item.tx,
    ponStatus: item.ponStatus,
    uptimeSec: item.uptimeSec,
    tags: item.tags,
    lastInform: item.lastInform,
    status: onlineState(item.lastInform, now),
  };
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Busca/listagem. Sem "q" = lista todos (com filtros), ordenado por PPPoE.
  app.get<{ Querystring: { q?: string; status?: string; type?: string; rx?: string; homologated?: string; limit?: number; skip?: number } }>("/api/devices", {
    preHandler: requireAuth("device.view"),
    schema: {
      querystring: {
        type: "object",
        properties: {
          q: { type: "string", maxLength: 64 },
          status: { type: "string", enum: ["online", "late", "offline"] },
          type: { type: "string", enum: ["ONU", "Roteador"] },
          rx: { type: "string", enum: ["ok", "warn", "bad"] },
          homologated: { type: "string", enum: ["sim", "nao"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          skip: { type: "integer", minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    const { q, status, type, rx } = request.query;
    const limit = request.query.limit ?? 50;
    const skip = request.query.skip ?? 0;
    const now = Date.now();
    const and: Filter<InventoryItem>[] = [];
    let kind: Kind | null = null;
    if (q && q.trim().length >= 2) {
      const built = buildFilter(q);
      and.push(built.filter);
      kind = built.kind;
    }
    if (type) and.push({ accessType: type });
    if (request.query.homologated === "sim") and.push({ homologated: true });
    if (request.query.homologated === "nao") and.push({ homologated: { $ne: true } });
    if (status) {
      const online = new Date(now - (rules.informIntervalSec * 2 + 60) * 1000);
      const offline = new Date(now - rules.offlineAfterSec * 1000);
      if (status === "online") and.push({ lastInform: { $gte: online } });
      if (status === "late") and.push({ lastInform: { $lt: online, $gte: offline } });
      if (status === "offline") and.push({ $or: [{ lastInform: { $lt: offline } }, { lastInform: null }] });
    }
    if (rx === "ok") and.push({ rx: { $gt: rules.rxGoodAbove, $lte: rules.rxSaturationAbove } });
    if (rx === "warn") and.push({ rx: { $gt: rules.rxBadAtOrBelow, $lte: rules.rxGoodAbove } });
    if (rx === "bad") and.push({ $or: [{ rx: { $lte: rules.rxBadAtOrBelow } }, { rx: { $gt: rules.rxSaturationAbove } }] });

    const filter: Filter<InventoryItem> = and.length ? { $and: and } : {};
    const [total, rows] = await Promise.all([
      inventory().countDocuments(filter),
      inventory().find(filter, { sort: { pppoeKey: 1, _id: 1 }, skip, limit }).toArray(),
    ]);
    let items = rows.map((r) => ({ ...present(r, now), match: q && kind ? matchInfo(r, q, kind) : null }));
    if (q) items = items.sort((a, b) => Number(b.match?.exact) - Number(a.match?.exact));
    return { total, items, kind };
  });

  // Resumo para os cards do topo da tela de dispositivos.
  app.get("/api/devices/summary", { preHandler: requireAuth("device.view") }, async () => {
    const now = Date.now();
    const all = await inventory().find({ staleOf: { $in: [null] } }, { projection: { lastInform: 1, rx: 1, accessType: 1, syncedAt: 1, homologated: 1 } }).toArray();
    const count = { total: all.length, online: 0, late: 0, offline: 0, rxBad: 0, rxWarn: 0, onu: 0, router: 0, notHomologated: 0 };
    let syncedAt: Date | null = null;
    for (const d of all) {
      const s = onlineState(d.lastInform, now);
      if (s === "online") count.online++;
      else if (s === "late") count.late++;
      else count.offline++;
      const l = rxLevel(d.rx);
      if (l === "bad") count.rxBad++;
      if (l === "warn") count.rxWarn++;
      if (d.accessType === "ONU") count.onu++;
      if (d.accessType === "Roteador") count.router++;
      if (!d.homologated) count.notHomologated++;
      if (!syncedAt || d.syncedAt > syncedAt) syncedAt = d.syncedAt;
    }
    return { ...count, syncedAt, rules };
  });

  // Força nova sincronização do índice (ex.: equipamento acabou de ser configurado).
  app.post("/api/devices/sync", { preHandler: requireAuth("device.refresh") }, async () => syncInventory(app.log));

  // ---------------------------------------------------------------- ficha do equipamento
  // O id chega decodificado pelo Fastify (ids do GenieACS contêm "%20"; o cliente manda encodeURIComponent).

  // Ficha a partir do que está no banco do GenieACS (instantâneo; cada bloco traz "updatedAt").
  app.get<{ Params: { id: string } }>("/api/devices/:id", { preHandler: requireAuth("device.view") }, async (request, reply) => {
    const d = await fetchDevice(request.params.id);
    if (!d) return reply.code(404).send({ error: "equipamento não encontrado" });
    const idx = await inventory().findOne({ _id: d._id }, { projection: { staleOf: 1, ponSerial: 1, ponSerialSource: 1 } });
    const dev = buildDevice(d);
    // Firmware sem serial GPON: mostra o da OLT (casado pelo login PPPoE), com a origem para a tela avisar.
    const fromOlt = !dev.identity.ponSerial && idx?.ponSerialSource === "olt" && idx.ponSerial;
    if (fromOlt) dev.identity = { ...dev.identity, ponSerial: idx!.ponSerial, ponSerialSource: "olt" } as typeof dev.identity;
    return { ...dev, staleOf: idx?.staleOf ?? null };
  });

  // Linha do tempo: eventos detectados pelo Zenie + ações do painel (auditoria) + falhas atuais do GenieACS.
  app.get<{ Params: { id: string }; Querystring: { days?: string; limit?: string } }>("/api/devices/:id/events", { preHandler: requireAuth("device.view") }, async (request, reply) => {
    const id = request.params.id;
    if (!(await inventory().findOne({ _id: id }, { projection: { _id: 1 } }))) return reply.code(404).send({ error: "equipamento não encontrado" });
    const days = Math.min(config.eventsDays, Math.max(1, Number(request.query.days) || config.eventsDays));
    const limit = Math.min(2000, Math.max(1, Number(request.query.limit) || 1000));
    const since = new Date(Date.now() - days * 86400_000);
    const items = await eventsFor(id, since, limit);
    // Desconexões agrupadas (gráfico) e quedas em massa (outros clientes da mesma PON/OLT no mesmo horário).
    const incidents = buildIncidents(items);
    await markMass(id, incidents, since).catch((e) => request.log.warn({ err: e }, "falha ao calcular quedas em massa"));
    return { days, retentionDays: config.eventsDays, items, incidents };
  });

  // Histórico de quedas da ONU na OLT (somente leitura na OLT): grava as quedas na linha do tempo. A aba Eventos
  // chama ao abrir; a mesma ONU é lida no máximo 1x por minuto (dentro disso devolve a leitura anterior).
  app.post<{ Params: { id: string } }>("/api/devices/:id/olt-history", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const id = request.params.id;
    const last = oltHistoryCache.get(id);
    if (last && Date.now() - last.at < 60_000) return { ...last.result, added: 0, confirmedReboots: 0, cached: true };
    try {
      const result = await readOnuHistory(id);
      oltHistoryCache.set(id, { at: Date.now(), result });
      if (oltHistoryCache.size > 5000) oltHistoryCache.delete(oltHistoryCache.keys().next().value!);
      return result;
    } catch (e) {
      if (e instanceof OltError) return reply.code(e.status).send({ error: e.message, code: e.code ?? null });
      if (e instanceof OltFailure) return reply.code(502).send({ error: e.describe() });
      throw e;
    }
  });

  // Mesh pelo adaptador do modelo (adapters/mesh). Topologia: GET = o que já está no banco; POST = lê do equipamento.
  app.get<{ Params: { id: string } }>("/api/devices/:id/mesh", { preHandler: requireAuth("device.view") }, async (request, reply) => {
    const d = await fetchDevice(request.params.id);
    if (!d) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, d, ["mesh"]))) return reply;
    const mesh = meshAdapter(d);
    return { source: mesh?.id ?? null, topology: mesh ? await mesh.topology(d._id) : null };
  });

  app.post<{ Params: { id: string } }>("/api/devices/:id/mesh", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const id = request.params.id;
    const d = await fetchDevice(id);
    if (!d) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, d, ["mesh"]))) return reply;
    const mesh = meshAdapter(d);
    if (!mesh) return reply.code(400).send({ error: "sem fonte de mesh para este modelo" });
    const result = await runTask(id, { name: "refreshObject", objectName: mesh.root }, 90_000);
    if (result.ok) for (const root of mesh.extraRoots ?? []) await runTask(id, { name: "refreshObject", objectName: root }, 60_000);
    return { source: mesh.id, result, topology: await mesh.topology(id) };
  });

  // Aparelhos de um nó da mesh (clique no roteador da árvore): lê só a lista daquele nó.
  app.post<{ Params: { id: string; node: string } }>("/api/devices/:id/mesh/:node", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const { id, node } = request.params;
    const d = await fetchDevice(id);
    if (!d) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, d, ["mesh"]))) return reply;
    const mesh = meshAdapter(d);
    const path = mesh?.stationsPath(node);
    if (!mesh || !path) return reply.code(400).send({ error: "nó inválido" });
    const result = await runTask(id, { name: "refreshObject", objectName: path }, 60_000);
    return { result, stations: await mesh.stations(id, node) };
  });

  // "Atualizar": lê agora os dados principais direto do equipamento (connection request).
  app.post<{ Params: { id: string } }>("/api/devices/:id/refresh", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const id = request.params.id;
    if (!(await fetchDevice(id))) return reply.code(404).send({ error: "equipamento não encontrado" });
    const result = await runTask(id, { name: "getParameterValues", parameterNames: SCALAR_VPS.map((v) => `VirtualParameters.${v}`) });
    await record(request, "device.refresh", { target: id, ok: result.ok, details: { resultado: result.outcome, ms: result.ms, ...(result.message ? { erro: result.message } : {}) } });
    const d = await fetchDevice(id);
    if (d) await refreshInventory(d);
    return { result, device: d ? buildDevice(d) : null };
  });

  // Listas de clientes (Wi-Fi e DHCP) — caras; só sob demanda (docs/PLANO.md 4.2).
  // Com mesh ligada, junta os aparelhos de cada nó (inclusive satélites fora do ACS) para a aba Clientes
  // mostrar a rede inteira e em qual roteador cada aparelho está.
  app.post<{ Params: { id: string } }>("/api/devices/:id/clients", { preHandler: requireAuth("device.refresh") }, async (request, reply) => {
    const id = request.params.id;
    const raw = await fetchDevice(id);
    if (!raw) return reply.code(404).send({ error: "equipamento não encontrado" });
    const result = await runTask(id, { name: "getParameterValues", parameterNames: LIST_VPS.map((v) => `VirtualParameters.${v}`) }, 90_000);
    const mesh = capabilityFor(raw, "mesh").allowed ? meshAdapter(raw) : null;
    const meshClients = mesh ? await readMeshClients(id, mesh, result.ok) : null;
    const d = await fetchDevice(id);
    const clients = d ? buildDevice(d).clients : null;
    // Lista padrão sem sinal (H198A V3.0: AssociatedDevice só tem o IP): completa pelo sinal do mesmo aparelho na
    // árvore da mesh (STA.SignalStrength), lida agora por readMeshClients quando a mesh está ligada.
    if (mesh && clients?.wifi?.some((c) => c.rssi === null)) {
      const topo = (await mesh.topology(id)) as MeshTopo;
      if (topo.enabled) {
        const signal = new Map<string, number>();
        for (const n of topo.nodes ?? []) {
          for (const s of ((await mesh.stations(id, n.key)) ?? []) as { mac: string | null; signal: number | null; active: boolean | null }[]) {
            if (s.mac && s.signal !== null && s.active !== false) signal.set(s.mac.toLowerCase(), s.signal);
          }
        }
        for (const c of clients.wifi) {
          const sig = c.rssi === null ? signal.get(c.mac.toLowerCase()) : undefined;
          if (sig !== undefined) Object.assign(c, { rssi: sig, quality: rssiQuality(sig), rssiSource: "mesh" });
        }
      }
    }
    return { result, clients, mesh: meshClients };
  });

  // Exclui um equipamento do ACS (admin): GenieACS (dispositivo + tarefas/falhas pendentes) e índice do Zenie.
  // Exige digitar o login PPPoE (ou o serial). Nada é enviado ao equipamento: se ele continuar falando com o ACS
  // (com a credencial), volta como NOVO, com o histórico zerado.
  app.post<{ Params: { id: string }; Body: { confirm: string } }>("/api/devices/:id/remove", {
    preHandler: requireAuth("device.remove"),
    schema: { body: { type: "object", required: ["confirm"], additionalProperties: false, properties: { confirm: { type: "string", maxLength: 200 } } } },
  }, async (request, reply) => {
    const id = request.params.id;
    const idx = await inventory().findOne({ _id: id });
    const d = await fetchDevice(id);
    if (!idx && !d) return reply.code(404).send({ error: "equipamento não encontrado" });
    const expected = (idx?.pppoe || idx?.serial || id).trim();
    if (request.body.confirm.trim().toLowerCase() !== expected.toLowerCase()) {
      return reply.code(400).send({ error: `para confirmar, digite exatamente: ${expected}` });
    }
    const pending = await nbiDeletePending(id);
    await nbiDeleteDevice(id);
    await inventory().deleteOne({ _id: id });
    await record(request, "device.remove", {
      target: id,
      details: {
        motivo: idx?.staleOf ? "registro antigo" : "exclusão pelo painel",
        login: idx?.pppoe ?? null, modelo: idx?.model ?? null, serial: idx?.serial ?? null,
        ultimoInform: idx?.lastInform ?? null, tarefasRemovidas: pending.tasks, falhasRemovidas: pending.faults,
      },
    });
    return { ok: true };
  });

  // Remove um REGISTRO ANTIGO (mesmo equipamento com outro id no GenieACS). Só o registro no banco do ACS; nada é
  // enviado ao equipamento. Recusa registros que não estejam marcados como antigos.
  app.delete<{ Params: { id: string } }>("/api/devices/:id", { preHandler: requireAuth("device.remove") }, async (request, reply) => {
    const id = request.params.id;
    const idx = await inventory().findOne({ _id: id });
    if (!idx) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!idx.staleOf) return reply.code(409).send({ error: "só registros antigos (duplicados do mesmo equipamento) podem ser removidos pelo painel" });
    await nbiDeleteDevice(id);
    await inventory().deleteOne({ _id: id });
    await record(request, "device.remove", { target: id, details: { motivo: "registro antigo", atual: idx.staleOf, serial: idx.serial } });
    return { ok: true, current: idx.staleOf };
  });

  // Reiniciar (NOC/admin). Se o equipamento não responder, o reboot é cancelado — nunca fica na fila.
  app.post<{ Params: { id: string } }>("/api/devices/:id/reboot", { preHandler: requireAuth("device.reboot") }, async (request, reply) => {
    const id = request.params.id;
    const d = await fetchDevice(id);
    if (!d) return reply.code(404).send({ error: "equipamento não encontrado" });
    if (!(await guard(request, reply, d, ["reboot"]))) return reply;
    const result = await runTask(id, { name: "reboot" });
    await record(request, "device.reboot", { target: id, ok: result.ok, details: { resultado: result.outcome, ...(result.message ? { erro: result.message } : {}) } });
    return { result };
  });
}
