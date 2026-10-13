// Módulo Homologação (docs/HOMOLOGACAO.md).
//  - Frota por modelo e perfil: leitura para admin em qualquer instalação.
//  - Edição (rascunhos em "catalog_drafts", foto, exportação): só com ZENIE_HOMOLOGATION=true (servidor de
//    testes). O rascunho já vale no servidor de testes (reconhecimento e capacidades) e vira oficial quando é
//    exportado para catalog/ no repositório e entra numa release.

import type { FastifyInstance, FastifyReply } from "fastify";
import { SOURCES } from "../adapters/index.js";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { CAPABILITIES, catalog, isGenericProductClass, officialProfile, profileProgress, setDrafts, type Capability, type Profile } from "../catalog.js";
import { config } from "../config.js";
import { catalogDrafts, inventory, type CatalogDraft } from "../db.js";
import { syncInventory } from "../inventory.js";

const KINDS = ["onu-gpon", "onu-epon", "onu-xpon", "router", "ap", "outro"];
const STATUS = ["homologado", "a-validar", "nao-suportado"];
const SLUG = "^[a-z0-9][a-z0-9._-]{0,40}$";
const MAX_THUMB = 200 * 1024;

const str = (max: number) => ({ type: "string", maxLength: max });
const profileSchema = {
  type: "object",
  required: ["commercialName", "kind", "match", "capabilities"],
  properties: {
    commercialName: { type: "string", minLength: 1, maxLength: 80 },
    kind: { type: "string", enum: KINDS },
    match: {
      type: "object",
      required: ["manufacturer", "productClass"],
      properties: {
        manufacturer: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 64 } },
        productClass: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1, maxLength: 64 } },
        hardwareVersion: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 32 } },
      },
    },
    wifi: {
      type: "object",
      properties: {
        generation: { type: "integer", minimum: 0, maximum: 7 },
        bands: { type: "array", maxItems: 4, items: { type: "string", enum: ["2.4", "5", "6"] } },
      },
    },
    ports: { type: "object", properties: { lan: { type: "integer", minimum: 0, maximum: 48 }, wan: str(20) } },
    notes: str(2000),
    firmwaresSeen: {
      type: "array",
      maxItems: 50,
      items: { type: "object", required: ["version"], properties: { version: { type: "string", minLength: 1, maxLength: 64 }, sample: str(120), notes: str(500) } },
    },
    capabilities: {
      type: "object",
      additionalProperties: { type: "object", required: ["status"], properties: { status: { type: "string", enum: STATUS }, source: str(40), notes: str(500) } },
    },
  },
};

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Recarrega os rascunhos no catálogo em memória e reavalia o índice (selo homologado). */
export async function reloadDrafts(): Promise<void> {
  if (!config.homologation) return setDrafts([]);
  setDrafts(await catalogDrafts().find().toArray());
}

function ensureMode(reply: FastifyReply): boolean {
  if (config.homologation) return true;
  void reply.code(403).send({ error: "catálogo somente leitura: a homologação é feita no servidor de testes (ZENIE_HOMOLOGATION=true)" });
  return false;
}

/** "a-validar -> homologado" por capacidade (vai para o histórico e para a auditoria). */
function diff(before: Profile | null, after: Profile): string[] {
  const out: string[] = [];
  if (!before) return ["perfil criado"];
  for (const k of Object.keys(CAPABILITIES)) {
    const a = before.capabilities[k];
    const b = after.capabilities[k];
    if ((a?.status ?? "a-validar") !== (b?.status ?? "a-validar")) out.push(`${k}: ${a?.status ?? "a-validar"} → ${b?.status ?? "a-validar"}`);
    else if ((a?.source ?? "") !== (b?.source ?? "")) out.push(`${k}: fonte ${a?.source ?? "-"} → ${b?.source ?? "-"}`);
    else if ((a?.notes ?? "") !== (b?.notes ?? "")) out.push(`${k}: observação alterada`);
  }
  for (const f of ["commercialName", "kind", "notes"] as const) if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) out.push(`${f} alterado`);
  if (JSON.stringify(before.match) !== JSON.stringify(after.match)) out.push("identificação alterada");
  if (JSON.stringify(before.wifi) !== JSON.stringify(after.wifi) || JSON.stringify(before.ports) !== JSON.stringify(after.ports)) out.push("Wi-Fi/portas alterados");
  if (JSON.stringify(before.firmwaresSeen) !== JSON.stringify(after.firmwaresSeen)) out.push("firmwares alterados");
  return out;
}

const hwList = (p: Pick<Profile, "match">) => (p.match.hardwareVersion ?? []).map((h) => h.trim().toUpperCase()).filter(Boolean);

/**
 * Outro perfil já reconhece o mesmo fabricante + modelo? Dois perfis do mesmo modelo só convivem com filtros
 * de hardware que não se sobrepõem (ex.: F670L "V1." e "V9."); o perfil genérico (sem filtro) só pode haver um.
 */
function conflict(p: Profile): string | null {
  const key = (m: string, c: string) => `${m.trim().toUpperCase()}|${c.trim().toUpperCase()}`;
  const mine = new Set(p.match.manufacturer.flatMap((m) => p.match.productClass.map((c) => key(m, c))));
  const hwA = hwList(p);
  for (const o of catalog().profiles) {
    if (o.id === p.id) continue;
    if (!o.match.manufacturer.some((m) => o.match.productClass.some((c) => mine.has(key(m, c))))) continue;
    const hwB = hwList(o);
    if (!hwA.length && !hwB.length) return o.commercialName;
    if (hwA.length && hwB.length && hwA.some((a) => hwB.some((b) => a.startsWith(b) || b.startsWith(a)))) return o.commercialName;
  }
  return null;
}

/** Família da versão de hardware para o filtro do perfil: "V1.1.01" -> "V1.", "V9.0" -> "V9.". */
export const hwFamily = (hw: string | null | undefined): string | null => {
  const m = /^\s*([A-Za-z]*\d+)(?:[._-]|\s*$)/.exec(hw ?? "");
  return m ? `${m[1]!.toUpperCase()}.` : null;
};

/** Perfil sem os campos calculados (o que vai para profile.json). */
function clean(p: Profile): Profile {
  const { hasImage: _h, draft: _d, ...rest } = p as Profile & { draft?: boolean };
  return rest as Profile;
}

const capCounts = (p: Profile) => {
  const c = { homologado: 0, "a-validar": 0, "nao-suportado": 0 } as Record<string, number>;
  for (const k of Object.keys(CAPABILITIES)) c[p.capabilities[k]?.status ?? "a-validar"]!++;
  return c;
};

export async function homologationRoutes(app: FastifyInstance): Promise<void> {
  const view = { preHandler: requireAuth("homologation.view") };
  const manage = { preHandler: requireAuth("homologation.manage") };

  // Frota por modelo: o que existe na rede x o que está no catálogo. Não homologados primeiro.
  app.get("/api/homologation/fleet", view, async () => {
    const groups = await inventory()
      .aggregate<{ _id: { vendor: string | null; model: string | null; profileId: string | null }; count: number; profileId: string | null; firmwares: (string | null)[]; hardware: (string | null)[]; types: (string | null)[]; lastInform: Date | null }>([
        { $match: { staleOf: { $in: [null] } } },
        // Por perfil também: o mesmo modelo pode ter um perfil por versão de hardware (F670L V1 x V9).
        { $group: { _id: { vendor: "$vendor", model: "$model", profileId: "$profileId" }, count: { $sum: 1 }, profileId: { $first: "$profileId" }, firmwares: { $push: "$firmware" }, hardware: { $addToSet: "$hardwareVersion" }, types: { $addToSet: "$accessType" }, lastInform: { $max: "$lastInform" } } },
      ])
      .toArray();
    const c = catalog();
    const byId = new Map(c.profiles.map((p) => [p.id, p]));
    const summary = (p: Profile) => ({ id: p.id, commercialName: p.commercialName, kind: p.kind, hasImage: !!p.hasImage, draft: !!(p as Profile & { draft?: boolean }).draft, status: p.homologation?.status ?? "a-validar", caps: capCounts(p), progress: profileProgress(p) });
    const seen = new Set<string>();
    const models = groups.map((g) => {
      const p = g.profileId ? byId.get(g.profileId) : undefined;
      if (p) seen.add(p.id);
      const fw = new Map<string, number>();
      for (const f of g.firmwares) fw.set(f ?? "?", (fw.get(f ?? "?") ?? 0) + 1);
      return {
        vendor: g._id.vendor,
        model: g._id.model,
        count: g.count,
        accessType: g.types.filter(Boolean)[0] ?? null,
        lastInform: g.lastInform,
        firmwares: [...fw].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
        hardwareVersions: g.hardware.filter((h): h is string => !!h).sort(),
        // Família única de hardware do grupo (para criar um perfil só desta revisão).
        hardwareFamily: (() => {
          const f = new Set(g.hardware.map(hwFamily));
          return f.size === 1 ? [...f][0] ?? null : null;
        })(),
        profile: p ? summary(p) : null,
      };
    });
    models.sort((a, b) => Number(!!a.profile) - Number(!!b.profile) || b.count - a.count);
    return {
      homologationMode: config.homologation,
      version: c.version,
      models,
      // Perfis do catálogo sem nenhum equipamento nesta rede.
      unused: c.profiles.filter((p) => !seen.has(p.id)).map(summary),
    };
  });

  // Perfil completo + equipamentos do modelo + firmwares vistos na rede + opções de fonte por capacidade.
  app.get<{ Params: { vendor: string; model: string } }>("/api/homologation/profiles/:vendor/:model", view, async (request, reply) => {
    const id = `${request.params.vendor}/${request.params.model}`;
    const profile = catalog().profiles.find((p) => p.id === id);
    if (!profile) return reply.code(404).send({ error: "perfil não encontrado" });
    const devices = await inventory()
      .find({ profileId: id }, { projection: { _id: 1, pppoe: 1, firmware: 1, lastInform: 1, tags: 1 } })
      .sort({ lastInform: -1 })
      .limit(200)
      .toArray();
    const draft = config.homologation ? await catalogDrafts().findOne({ _id: id }, { projection: { thumb: 0 } }) : null;
    return {
      homologationMode: config.homologation,
      profile,
      progress: profileProgress(profile),
      official: !!officialProfile(id),
      draft: draft ? { updatedAt: draft.updatedAt, updatedBy: draft.updatedBy } : null,
      devices: devices.map((d) => ({ id: d._id, pppoe: d.pppoe, firmware: d.firmware, lastInform: d.lastInform, pilot: d.tags?.includes("piloto") ?? false })),
      capabilities: CAPABILITIES,
      sources: SOURCES,
    };
  });

  // Novo perfil (rascunho) para um modelo não homologado da frota.
  // Se o modelo já tem perfil, o novo é só da família de hardware dos equipamentos sem perfil (hardwareFamily da
  // frota, ex.: "V1."): id "<modelo>-v1", nome "<modelo> V1", filtro match.hardwareVersion.
  app.post<{ Body: { manufacturer: string; productClass: string; hardwareFamily?: string } }>("/api/homologation/profiles", {
    ...manage,
    schema: { body: { type: "object", required: ["manufacturer", "productClass"], properties: { manufacturer: { type: "string", minLength: 1, maxLength: 64 }, productClass: { type: "string", minLength: 1, maxLength: 64 }, hardwareFamily: { type: "string", pattern: "^[A-Za-z]*[0-9]+\\.$", maxLength: 12 } } } },
  }, async (request, reply) => {
    if (!ensureMode(reply)) return reply;
    const { manufacturer, productClass } = request.body;
    const up = (v: string) => v.trim().toUpperCase();
    const sameModel = catalog().profiles.some((p) => p.match.manufacturer.some((m) => up(m) === up(manufacturer)) && p.match.productClass.some((c) => up(c) === up(productClass)));
    const hw = sameModel ? request.body.hardwareFamily ?? null : null;
    if (sameModel && !hw) return reply.code(409).send({ error: "este modelo já tem perfil; para separar por versão de hardware, os equipamentos sem perfil precisam ter uma única família de hardware" });
    const hwLabel = hw ? hw.replace(/\.$/, "") : null;
    if (isGenericProductClass(productClass)) {
      return reply.code(400).send({ error: `"${productClass}" não identifica o modelo (ProductClass genérico): aguarde o ModelName ser lido (próximo inform) — o modelo aparece com o nome certo na frota` });
    }
    const id = `${slug(manufacturer)}/${slug(hwLabel ? `${productClass} ${hwLabel}` : productClass)}`;
    if (!new RegExp(SLUG).test(id.split("/")[0]!) || !new RegExp(SLUG).test(id.split("/")[1]!)) return reply.code(400).send({ error: "fabricante/modelo inválido" });
    if (catalog().profiles.some((p) => p.id === id)) return reply.code(409).send({ error: "já existe um perfil para este modelo", id });
    const filter = { vendor: manufacturer, model: productClass, ...(hw ? { profileId: null } : {}) };
    const sample = await inventory().findOne(filter);
    const firmwares = await inventory().distinct("firmware", filter);
    const isOnu = sample?.accessType === "ONU";
    const profile: Profile = {
      id,
      vendor: manufacturer,
      model: hwLabel ? `${productClass} ${hwLabel}` : productClass,
      commercialName: `${manufacturer} ${productClass}${hwLabel ? ` ${hwLabel}` : ""}`,
      kind: isOnu ? "onu-gpon" : sample?.accessType === "Roteador" ? "router" : "outro",
      match: { manufacturer: [manufacturer], productClass: [productClass], ...(hw ? { hardwareVersion: [hw] } : {}) },
      wifi: { generation: Number(sample?.wifiGeneration) || 0, bands: ["2.4", "5"] },
      ports: { lan: 4, wan: isOnu ? "GPON" : "Ethernet" },
      notes: "",
      firmwaresSeen: firmwares.filter(Boolean).map((v) => ({ version: String(v) })),
      capabilities: Object.fromEntries(
        Object.keys(CAPABILITIES).map((k) => [k, { status: "a-validar", source: (SOURCES[k] ?? ["vp"])[0] } as Capability]),
      ),
      homologation: { status: "em-homologacao" },
      history: [{ date: new Date().toISOString().slice(0, 10), by: request.user!.name, note: "perfil criado a partir da frota" }],
    };
    const c = conflict(profile);
    if (c) return reply.code(409).send({ error: `o perfil "${c}" já reconhece este modelo` });
    await catalogDrafts().insertOne({ _id: id, profile, updatedAt: new Date(), updatedBy: request.user!.username });
    await record(request, "homologacao.perfil", { target: id, details: { alteracao: "perfil criado" } });
    await reloadDrafts();
    void syncInventory(app.log).catch(() => undefined);
    return { id };
  });

  // Salva o rascunho (o servidor de testes passa a usá-lo na hora).
  app.put<{ Params: { vendor: string; model: string }; Body: { profile: Profile; note?: string } }>("/api/homologation/profiles/:vendor/:model", {
    ...manage,
    schema: { body: { type: "object", required: ["profile"], properties: { profile: profileSchema, note: str(300) } } },
  }, async (request, reply) => {
    if (!ensureMode(reply)) return reply;
    const id = `${request.params.vendor}/${request.params.model}`;
    const before = catalog().profiles.find((p) => p.id === id) ?? null;
    if (!before) return reply.code(404).send({ error: "perfil não encontrado" });
    const input = request.body.profile;
    const unknownCap = Object.keys(input.capabilities).find((k) => !CAPABILITIES[k]);
    if (unknownCap) return reply.code(400).send({ error: `capacidade desconhecida: ${unknownCap}` });
    const badSource = Object.entries(input.capabilities).find(([k, c]) => c.source && !(SOURCES[k] ?? ["vp"]).includes(c.source));
    if (badSource) return reply.code(400).send({ error: `fonte "${badSource[1].source}" inválida para ${badSource[0]}` });

    const today = new Date().toISOString().slice(0, 10);
    // Perfil "homologado" = ao menos uma capacidade validada; data/autor da última revisão.
    // "homologado" só com 100% (nenhuma capacidade a validar); senão "em-homologacao".
    const complete = Object.keys(CAPABILITIES).every((k) => (input.capabilities[k]?.status ?? "a-validar") !== "a-validar");
    const profile: Profile = {
      ...clean(before),
      ...input,
      id,
      vendor: before.vendor,
      model: before.model,
      homologation: { status: complete ? "homologado" : "em-homologacao", date: today, by: request.user!.name },
    };
    const c = conflict(profile);
    if (c) return reply.code(409).send({ error: `o perfil "${c}" já reconhece este fabricante + modelo` });

    const changes = diff(before, profile);
    const note = request.body.note?.trim();
    if (!changes.length && !note) return reply.code(400).send({ error: "nada mudou" });
    profile.history = [...(before.history ?? []), { date: today, by: request.user!.name, note: [note, ...changes].filter(Boolean).join("; ") }].slice(-100);

    await catalogDrafts().updateOne({ _id: id }, { $set: { profile, photoOnly: false, updatedAt: new Date(), updatedBy: request.user!.username } }, { upsert: true });
    await record(request, "homologacao.perfil", { target: id, details: { alteracoes: changes.join("; ") || "-", ...(note ? { nota: note } : {}) } });
    await reloadDrafts();
    void syncInventory(app.log).catch(() => undefined);
    return { profile: catalog().profiles.find((p) => p.id === id) };
  });

  // Foto (WebP já redimensionado no navegador, ≤ 200 KB).
  app.put<{ Params: { vendor: string; model: string }; Body: { webp: string } }>("/api/homologation/profiles/:vendor/:model/image", {
    ...manage,
    bodyLimit: 400 * 1024,
    schema: { body: { type: "object", required: ["webp"], properties: { webp: { type: "string", maxLength: 300_000 } } } },
  }, async (request, reply) => {
    if (!ensureMode(reply)) return reply;
    const id = `${request.params.vendor}/${request.params.model}`;
    const current = catalog().profiles.find((p) => p.id === id);
    if (!current) return reply.code(404).send({ error: "perfil não encontrado" });
    const buf = Buffer.from(request.body.webp, "base64");
    if (buf.length > MAX_THUMB) return reply.code(400).send({ error: "foto acima de 200 KB" });
    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return reply.code(400).send({ error: "a foto precisa ser WebP" });
    await catalogDrafts().updateOne(
      { _id: id },
      { $set: { thumb: buf, updatedAt: new Date(), updatedBy: request.user!.username }, $setOnInsert: { profile: clean(current), photoOnly: true } },
      { upsert: true },
    );
    await record(request, "homologacao.foto", { target: id, details: { kb: Math.round(buf.length / 1024) } });
    await reloadDrafts();
    return { ok: true };
  });

  // Descarta o rascunho (volta ao oficial; perfil novo some).
  app.delete<{ Params: { vendor: string; model: string } }>("/api/homologation/profiles/:vendor/:model/draft", manage, async (request, reply) => {
    if (!ensureMode(reply)) return reply;
    const id = `${request.params.vendor}/${request.params.model}`;
    const res = await catalogDrafts().deleteOne({ _id: id });
    if (!res.deletedCount) return reply.code(404).send({ error: "sem rascunho" });
    await record(request, "homologacao.descartar", { target: id });
    await reloadDrafts();
    void syncInventory(app.log).catch(() => undefined);
    return { ok: true, official: !!officialProfile(id) };
  });

  // Exportação para o repositório: profile.json + thumb.webp (base64).
  app.get<{ Params: { vendor: string; model: string } }>("/api/homologation/profiles/:vendor/:model/export", view, async (request, reply) => {
    const id = `${request.params.vendor}/${request.params.model}`;
    const p = catalog().profiles.find((x) => x.id === id);
    if (!p) return reply.code(404).send({ error: "perfil não encontrado" });
    const d = config.homologation ? await catalogDrafts().findOne({ _id: id }) : null;
    return { id, profile: clean(p), thumb: d?.thumb ? Buffer.from(d.thumb.buffer).toString("base64") : null };
  });
}

export type { CatalogDraft };
