// Histórico de quedas da ONU (detail-info) contra a saída REAL do C320 e a conversão em eventos (npm test).

import assert from "node:assert/strict";
import { test } from "node:test";
import { onuDetail, parseDuration } from "../olt/zte-c320-v21/parser.js";
import { fixture, SimulatedTransport } from "../olt/simulated.js";
import { historyEvents, oltCause, oltClock } from "../olt/history.js";
import { OltFailure } from "../olt/transport.js";

const DETAIL = fixture("show_gpon_onu_detail_info.txt");
// No fixture: último Authpass 2026-10-01 07:40:56 + Online Duration 9h 52m 52s = 17:33:48 no relógio da OLT.
// Agora real 20:33:48Z -> OLT em UTC-3.
const NOW = new Date("2026-10-01T20:33:48Z");

test("detail-info: estado, tempo online e as 10 autenticações (a atual sem queda)", () => {
  const d = onuDetail(DETAIL);
  assert.equal(d.name, "cliente_teste_01");
  assert.equal(d.phase, "working");
  assert.equal(d.onlineSec, 9 * 3600 + 52 * 60 + 52);
  assert.equal(d.history.length, 10);
  assert.deepEqual(d.history[0], { authpass: "2026-08-16 05:45:43", offline: "2026-08-16 05:48:11", cause: "DyingGasp" });
  assert.deepEqual(d.history[9], { authpass: "2026-10-01 07:40:56", offline: null, cause: null });
});

test("detail-info: saída fora do formato ou erro da OLT nunca vira histórico vazio", () => {
  assert.throws(() => onuDetail("qualquer coisa"), (e: unknown) => e instanceof OltFailure && e.kind === "formato");
  assert.throws(() => onuDetail("%Code 62310-GPONSRV : No related information to show."), (e: unknown) => e instanceof OltFailure && e.kind === "comando");
  // Sem a tabela (ONU que nunca autenticou): histórico vazio, sem erro.
  assert.deepEqual(onuDetail(DETAIL.split("------")[0]!).history, []);
});

test("detail-info: buffer circular (OLT real, 13/10/2026) — linhas vazias saem e a ordem é a do tempo", () => {
  const cut = DETAIL.indexOf("\n", DETAIL.indexOf("Authpass Time"));
  const head = DETAIL.slice(0, cut);
  const rows = DETAIL.slice(cut + 1).trimEnd().split("\n");
  // Sessão atual na linha 1 e o resto zerado (ONU com uma autenticação só).
  const fresh = head + "\n   1   2026-10-09 16:08:32    0000-00-00 00:00:00\n" + Array.from({ length: 9 }, (_, i) => `  ${String(i + 2).padStart(2)}   0000-00-00 00:00:00    0000-00-00 00:00:00`).join("\n");
  const d = onuDetail(fresh);
  assert.deepEqual(d.history, [{ authpass: "2026-10-09 16:08:32", offline: null, cause: null }]);
  assert.equal(oltClock(d, NOW).method, "online");
  // Buffer que já deu a volta: as 3 últimas linhas reais aparecem primeiro.
  const rotated = head + "\n" + [...rows.slice(7), ...rows.slice(0, 7)].join("\n");
  assert.deepEqual(onuDetail(rotated).history, onuDetail(DETAIL).history);
});

test("duração: formatos com e sem dias; desconhecido = null", () => {
  assert.equal(parseDuration("9h 52m 52s"), 35572);
  assert.equal(parseDuration("2d 1h 0m 5s"), 2 * 86400 + 3605);
  assert.equal(parseDuration("N/A"), null);
});

test("relógio da OLT: online corrige pelo Online Duration; offline usa o fuso", () => {
  const d = onuDetail(DETAIL);
  const online = oltClock(d, NOW);
  assert.equal(online.method, "online");
  assert.equal(online.toDate("2026-10-01 07:38:07").toISOString(), "2026-10-01T10:38:07.000Z");
  // Relógio da OLT 2 min atrasado: a correção acompanha.
  assert.equal(oltClock(d, new Date(NOW.getTime() + 120_000)).toDate("2026-10-01 07:38:07").toISOString(), "2026-10-01T10:40:07.000Z");
  const offline = { ...d, history: d.history.slice(0, 9), onlineSec: null };
  const byZone = oltClock(offline, NOW, "America/Sao_Paulo");
  assert.equal(byZone.method, "fuso");
  assert.equal(byZone.toDate("2026-10-01 07:38:07").toISOString(), "2026-10-01T10:38:07.000Z");
});

test("causa: DyingGasp = energia; LOS/LOF = fibra; outra fica com o texto da OLT", () => {
  assert.equal(oltCause("DyingGasp").kind, "energia");
  assert.equal(oltCause("LOSi").kind, "fibra");
  assert.equal(oltCause("LOFi").kind, "fibra");
  const other = oltCause("Deactived");
  assert.equal(other.kind, "outra");
  assert.match(other.title, /Deactived/);
  assert.equal(oltCause(null).kind, "outra");
});

test("eventos: uma queda por registro dentro da retenção, com a duração até a volta", () => {
  const ev = historyEvents("dev1", onuDetail(DETAIL), NOW, { posicao: "1/1/1:1" });
  // Retenção 30 dias a partir de 01/10: entram as quedas de 13/09, 28/09 e 01/10 (31/08 fica de fora).
  assert.deepEqual(ev.map((e) => e.ts.toISOString()), ["2026-09-13T05:45:40.000Z", "2026-09-28T17:44:38.000Z", "2026-10-01T10:38:07.000Z"]);
  const last = ev.at(-1)!;
  assert.equal(last.type, "olt.down");
  assert.equal(last.details?.causa, "energia");
  assert.equal(last.details?.foraSegundos, 2 * 60 + 49); // 07:38:07 -> 07:40:56
  assert.equal(last.details?.posicao, "1/1/1:1");
});

test("OLT simulada responde o detail-info de qualquer ONU da PON 1/1/1", async () => {
  const t = new SimulatedTransport();
  await t.connect();
  const out = await t.exec("show gpon onu detail-info gpon-onu_1/1/1:7");
  assert.match(out, /gpon-onu_1\/1\/1:7/);
  assert.equal(onuDetail(out).history.length, 10);
  await t.close();
});
