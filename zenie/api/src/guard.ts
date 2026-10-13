// Trava por capacidade (docs/HOMOLOGACAO.md): leitura sempre; escrita só com a capacidade "homologado".
// Admin pode liberar caso a caso (cabeçalho X-Zenie-Override: 1) — fica na auditoria. "Não suportado"
// nunca é liberável: o equipamento não tem o recurso.

import type { FastifyReply, FastifyRequest } from "fastify";
import { record } from "./audit.js";
import { CAPABILITIES, capabilityFor, profileOf } from "./catalog.js";
import type { NbiDevice } from "./nbi.js";

export const OVERRIDE_HEADER = "x-zenie-override";

/** true = pode seguir; false = já respondeu 403 (a rota deve só "return reply"). */
export async function guard(request: FastifyRequest, reply: FastifyReply, d: NbiDevice, caps: string[]): Promise<boolean> {
  const profile = profileOf(d);
  const blocked = caps.map((cap) => ({ cap, ...capabilityFor(d, cap, profile) })).filter((r) => !r.allowed);
  if (!blocked.length) return true;

  const model = profile?.commercialName ?? [d._deviceId?._Manufacturer, d._deviceId?._ProductClass].filter(Boolean).join(" ");
  // "não suportado" e "somente leitura" nunca são liberáveis.
  const overridable = blocked.every((b) => b.status !== "nao-suportado" && b.status !== "somente-leitura") && request.user?.role === "admin";
  const labels = blocked.map((b) => CAPABILITIES[b.cap]?.label ?? b.cap).join(", ");

  if (overridable && request.headers[OVERRIDE_HEADER] === "1") {
    await record(request, "homologacao.liberacao", {
      target: d._id,
      details: { modelo: model, recursos: labels, status: blocked.map((b) => `${b.cap}=${b.status}`).join(", ") },
    });
    return true;
  }
  await record(request, "homologacao.bloqueio", { target: d._id, ok: false, details: { modelo: model, recursos: labels } });
  await reply.code(403).send({
    error: blocked.map((b) => b.reason).join("; "),
    code: "capability",
    capabilities: blocked.map((b) => b.cap),
    overridable,
  });
  return false;
}
