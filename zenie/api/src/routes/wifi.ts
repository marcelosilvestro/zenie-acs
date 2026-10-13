// Alteração do Wi-Fi pelo atendimento (permissão wifi.edit): SSID, senha, rádio, liga/desliga e unificar/separar.
// Usa os VPs graváveis testados na F6201B (docs/PLANO.md 4.1).
//  - Cada parte exige a capacidade homologada no perfil do modelo (guard): nome/senha = wifiWrite,
//    canal/largura/potência = wifiRadio, liga/desliga = wifiPower, unificar/separar = wifiUnify.
//  - Unificar/separar segue o adaptador do modelo (adapters/wifi/unify.ts): etapa própria, o que é
//    obrigatório informar e se gravar o 2,4 já vale para as duas faixas.
//  - Tarefa que não executa na hora é cancelada (runTask); a senha nunca vai para a auditoria.

import type { FastifyInstance } from "fastify";
import { unifyAdapter } from "../adapters/index.js";
import type { Step } from "../adapters/types.js";
import { record } from "../audit.js";
import { requireAuth } from "../auth.js";
import { buildDevice, fetchDevice, refreshInventory, runTask, SCALAR_VPS, type TaskResult } from "../device.js";
import { guard } from "../guard.js";

interface BandInput { ssid?: string; password?: string; channel?: string; bandwidth?: string; txPower?: number; enabled?: boolean }
interface WifiBody { unified?: boolean; band24?: BandInput; band5?: BandInput }

const SSID_RE = /^[^\x00-\x1f\x7f]{1,32}$/;
const PASS_RE = /^[\x20-\x7e]{8,63}$/; // WPA-PSK: 8 a 63 caracteres ASCII imprimíveis

function validate(b: BandInput | undefined, label: string): string | null {
  if (!b) return null;
  if (b.ssid !== undefined && !SSID_RE.test(b.ssid)) return `SSID ${label}: 1 a 32 caracteres, sem caracteres de controle`;
  if (b.password !== undefined && !PASS_RE.test(b.password)) return `senha ${label}: 8 a 63 caracteres (letras, números e símbolos comuns, sem acentos)`;
  return null;
}

export async function wifiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: WifiBody }>("/api/devices/:id/wifi", {
    preHandler: requireAuth("wifi.edit"),
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          unified: { type: "boolean" },
          band24: { type: "object", additionalProperties: false, properties: { ssid: { type: "string", maxLength: 32 }, password: { type: "string", maxLength: 63 }, channel: { type: "string", pattern: "^(auto|[0-9]{1,3})$" }, bandwidth: { type: "string", maxLength: 10 }, txPower: { type: "integer", minimum: 1, maximum: 100 }, enabled: { type: "boolean" } } },
          band5: { type: "object", additionalProperties: false, properties: { ssid: { type: "string", maxLength: 32 }, password: { type: "string", maxLength: 63 }, channel: { type: "string", pattern: "^(auto|[0-9]{1,3})$" }, bandwidth: { type: "string", maxLength: 10 }, txPower: { type: "integer", minimum: 1, maximum: 100 }, enabled: { type: "boolean" } } },
        },
      },
    },
  }, async (request, reply) => {
    const id = request.params.id;
    const body = request.body;
    const before = await fetchDevice(id);
    if (!before) return reply.code(404).send({ error: "equipamento não encontrado" });
    const current = buildDevice(before);
    const unify = unifyAdapter(before);
    const unifiedNow = current.wifi.unify?.unified === true;

    const problem = validate(body.band24, "2,4 GHz") ?? validate(body.band5, "5 GHz");
    if (problem) return reply.code(400).send({ error: problem });

    // Canal/largura/potência: só valores que o próprio equipamento anuncia (VP Wifi*Options).
    const radioProblem = (input: BandInput | undefined, idx: 0 | 1, label: string): string | null => {
      if (!input || (input.channel === undefined && input.bandwidth === undefined && input.txPower === undefined)) return null;
      const opts = current.wifi.bands[idx]?.options;
      if (!opts) return `${label}: opções do rádio ainda não lidas — clique em Atualizar e tente de novo`;
      if (input.channel !== undefined && input.channel !== "auto" && !opts.channels.includes(Number(input.channel))) return `${label}: canal ${input.channel} não suportado`;
      if (input.bandwidth !== undefined && !opts.bandwidths.includes(input.bandwidth)) return `${label}: largura ${input.bandwidth} não suportada`;
      if (input.txPower !== undefined && opts.powers.length && !opts.powers.includes(input.txPower)) return `${label}: potência ${input.txPower}% não suportada`;
      return null;
    };
    const rp = radioProblem(body.band24, 0, "2,4 GHz") ?? radioProblem(body.band5, 1, "5 GHz");
    if (rp) return reply.code(400).send({ error: rp });

    const changeUnify = body.unified !== undefined && body.unified !== unifiedNow;
    if (changeUnify && !unify) return reply.code(400).send({ error: "este modelo não tem rede unificada" });
    const unifiedAfter = body.unified ?? unifiedNow;
    const rules = unify?.rules;

    if (changeUnify && body.unified === false) {
      const needPass = rules?.separateNeeds === "ssid+password";
      if (!body.band5?.ssid || (needPass && !body.band5?.password)) {
        return reply.code(400).send({ error: needPass ? "ao separar as redes, informe SSID e senha do 5 GHz (o equipamento restauraria a configuração antiga)" : "ao separar as redes, informe o SSID do 5 GHz" });
      }
    }
    if (changeUnify && body.unified === true && rules?.passwordOnUnify && !body.band24?.password) {
      return reply.code(400).send({ error: "ao unificar as redes, informe a senha da rede unificada" });
    }
    if (unifiedAfter && (body.band5?.ssid || body.band5?.password)) {
      return reply.code(400).send({ error: "com a rede unificada, altere só o SSID/senha principal (2,4 GHz) — vale para as duas faixas" });
    }

    // Capacidades homologadas exigidas por esta alteração (escrita só em modelo/recurso homologado).
    const bands = [body.band24, body.band5];
    const caps = new Set<string>();
    if (changeUnify) caps.add("wifiUnify");
    if (bands.some((b) => b?.ssid !== undefined || b?.password !== undefined)) caps.add("wifiWrite");
    if (bands.some((b) => b?.channel !== undefined || b?.bandwidth !== undefined || b?.txPower !== undefined)) caps.add("wifiRadio");
    if (bands.some((b) => b?.enabled !== undefined)) caps.add("wifiPower");
    if (!(await guard(request, reply, before, [...caps]))) return reply;

    // Monta as etapas na ordem certa.
    const steps: Step[] = [];
    if (changeUnify) steps.push(...unify!.steps(body.unified!));
    const values: Step["values"] = [];
    if (body.band24?.ssid !== undefined) values.push(["VirtualParameters.Wifi24SSID", body.band24.ssid, "xsd:string"]);
    if (body.band24?.password !== undefined) values.push(["VirtualParameters.Wifi24Password", body.band24.password, "xsd:string"]);
    if (!unifiedAfter && body.band5?.ssid !== undefined) values.push(["VirtualParameters.Wifi5SSID", body.band5.ssid, "xsd:string"]);
    if (!unifiedAfter && body.band5?.password !== undefined) values.push(["VirtualParameters.Wifi5Password", body.band5.password, "xsd:string"]);
    // Unificação sem chave própria (ex.: "same-ssid"): a API grava o mesmo nome/senha também no 5 GHz.
    if (unifiedAfter && rules && !rules.mainWritesBoth) {
      const ssid = body.band24?.ssid ?? (changeUnify ? current.wifi.bands[0]?.ssid : undefined);
      if (ssid) values.push(["VirtualParameters.Wifi5SSID", ssid, "xsd:string"]);
      if (body.band24?.password !== undefined) values.push(["VirtualParameters.Wifi5Password", body.band24.password, "xsd:string"]);
    }
    if (values.length) steps.push({ label: "nome/senha", values });
    // Ajustes de rádio por faixa (independem da rede unificada: cada rádio tem canal/largura/potência próprios).
    const radio: Step["values"] = [];
    for (const [key, input] of [["24", body.band24], ["5", body.band5]] as const) {
      if (input?.channel !== undefined) radio.push([`VirtualParameters.Wifi${key}Channel`, input.channel, "xsd:string"]);
      if (input?.bandwidth !== undefined) radio.push([`VirtualParameters.Wifi${key}Bandwidth`, input.bandwidth, "xsd:string"]);
      if (input?.txPower !== undefined) radio.push([`VirtualParameters.Wifi${key}TxPower`, String(input.txPower), "xsd:string"]);
    }
    if (radio.length) steps.push({ label: "canal/largura/potência", values: radio });
    // Liga/desliga o Wi-Fi da faixa (SSID + rádio) — etapa própria, por último.
    const power: Step["values"] = [];
    for (const [key, input] of [["24", body.band24], ["5", body.band5]] as const) {
      if (input?.enabled !== undefined) power.push([`VirtualParameters.Wifi${key}Enabled`, input.enabled, "xsd:boolean"]);
    }
    if (power.length) steps.push({ label: power.length > 1 ? "ligar/desligar Wi-Fi" : power[0]![1] ? "ligar Wi-Fi" : "desligar Wi-Fi", values: power });
    if (!steps.length) return reply.code(400).send({ error: "nada para alterar" });

    const done: string[] = [];
    let failure: { step: string; result: TaskResult } | null = null;
    for (const step of steps) {
      const result = await runTask(id, { name: "setParameterValues", parameterValues: step.values }, 90_000);
      if (!result.ok) {
        failure = { step: step.label, result };
        break;
      }
      done.push(step.label);
    }

    // Troca de canal leva ~10 s para valer (F670L V1: antes disso informa um canal provisório, ex.: 4 no lugar de 9).
    if (!failure && radio.some(([path, v]) => path.endsWith("Channel") && v !== "auto")) await new Promise((r) => setTimeout(r, 12_000));
    // Lê de volta o que interessa para a tela (sem senhas).
    await runTask(id, { name: "getParameterValues", parameterNames: SCALAR_VPS.filter((v) => v.startsWith("Wifi")).map((v) => `VirtualParameters.${v}`) });
    const after = await fetchDevice(id);
    if (after) await refreshInventory(after);

    await record(request, "wifi.update", {
      target: id,
      ok: !failure,
      details: {
        etapas: done.join(", ") || "nenhuma",
        ...(changeUnify ? { redes: body.unified ? "unificadas" : "separadas", via: unify!.id } : {}),
        ...(body.band24?.ssid !== undefined ? { ssid24: body.band24.ssid } : {}),
        ...(body.band5?.ssid !== undefined && !unifiedAfter ? { ssid5: body.band5.ssid } : {}),
        ...(body.band24?.password !== undefined || body.band5?.password !== undefined ? { senha: "alterada" } : {}),
        ...Object.fromEntries((["24", "5"] as const).flatMap((k) => {
          const i = k === "24" ? body.band24 : body.band5;
          const tag = k === "24" ? "2,4" : "5";
          return [
            ...(i?.channel !== undefined ? [[`canal ${tag}`, i.channel]] : []),
            ...(i?.bandwidth !== undefined ? [[`largura ${tag}`, i.bandwidth]] : []),
            ...(i?.txPower !== undefined ? [[`potência ${tag}`, `${i.txPower}%`]] : []),
            ...(i?.enabled !== undefined ? [[`Wi-Fi ${tag}`, i.enabled ? "ligado" : "desligado"]] : []),
          ];
        })),
        ...(failure ? { falhou: `${failure.step}: ${failure.result.message ?? failure.result.outcome}` } : {}),
      },
    });

    return {
      ok: !failure,
      done,
      failure: failure ? { step: failure.step, outcome: failure.result.outcome, message: failure.result.message } : null,
      device: after ? buildDevice(after) : null,
    };
  });
}
