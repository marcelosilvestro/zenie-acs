// Agrupamento dos eventos em desconexões (gráfico da aba Eventos) — npm test.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIncidents } from "../incidents.js";
import type { TimelineEntry } from "../events.js";

const T = (hhmm: string, day = "2026-10-08") => new Date(`${day}T${hhmm}:00Z`);
const ev = (type: string, ts: Date, details: Record<string, unknown> = {}, source: TimelineEntry["source"] = "zenie") =>
  ({ type, ts, details, source, level: "warn", title: type }) as TimelineEntry;

test("queda de energia: a queda na OLT, o reinício e a volta contam como UMA desconexão", () => {
  const items = [
    ev("reboot", T("15:49"), { causa: "energia" }),
    ev("online", T("15:52")),
    ev("olt.down", T("15:16"), { causa: "energia", voltou: T("15:48") }),
  ];
  const inc = buildIncidents(items);
  assert.equal(inc.length, 1);
  assert.equal(inc[0]!.category, "energia");
  assert.deepEqual(inc[0]!.members.sort(), [0, 2]);
});

test("três quedas no mesmo dia (print do 08/10) = três desconexões, a mais recente primeiro", () => {
  const items = [
    ev("olt.down", T("18:41"), { causa: "energia", voltou: T("18:42") }),
    ev("olt.down", T("15:16"), { causa: "energia", voltou: T("15:48") }),
    ev("olt.down", T("03:05"), { causa: "fibra", voltou: T("03:06") }),
  ];
  const inc = buildIncidents(items);
  assert.deepEqual(inc.map((i) => i.category), ["energia", "energia", "fibra"]);
});

test("fibra prevalece quando eventos se juntam; reinício pelo painel e ações do NOC não contam", () => {
  const items = [
    ev("olt.down", T("10:00"), { causa: "fibra", voltou: T("10:20") }),
    ev("wan.down", T("10:05")),
    ev("reboot", T("12:00"), { causa: "painel" }),
    ev("device.reboot", T("11:59"), {}, "noc"),
  ];
  const inc = buildIncidents(items);
  assert.equal(inc.length, 1);
  assert.equal(inc[0]!.category, "fibra");
});

test("sem dado da OLT: reinício local e reconexão da WAN separados por horas são duas desconexões", () => {
  const inc = buildIncidents([ev("reboot", T("08:00"), { causa: "local" }), ev("wan.reconnect", T("14:00"))]);
  assert.deepEqual(inc.map((i) => i.category), ["internet", "equipamento"]);
});
