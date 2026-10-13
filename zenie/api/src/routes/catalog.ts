import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { CAPABILITIES, catalog, draftImage, imagePath } from "../catalog.js";

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  // Catálogo oficial (perfis + definição das capacidades).
  app.get("/api/catalog", { preHandler: requireAuth("device.view") }, async () => {
    const c = catalog();
    return { version: c.version, capabilities: CAPABILITIES, profiles: c.profiles };
  });

  // Foto do equipamento (thumb.webp do perfil). Id = "fabricante/modelo".
  app.get<{ Params: { vendor: string; model: string } }>("/api/catalog/:vendor/:model/image", { preHandler: requireAuth("device.view") }, async (request, reply) => {
    const id = `${request.params.vendor}/${request.params.model}`;
    // Rascunho do modo homologação tem precedência (sem cache: muda durante a homologação).
    const draft = draftImage(id);
    if (draft) return reply.header("Content-Type", "image/webp").header("Cache-Control", "no-cache").send(draft);
    const p = imagePath(id);
    if (!p) return reply.code(404).send({ error: "sem foto" });
    reply.header("Content-Type", "image/webp").header("Cache-Control", "private, max-age=3600");
    return reply.send(createReadStream(p));
  });
}
