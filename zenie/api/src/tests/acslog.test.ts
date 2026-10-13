// Log do ACS: classificação das linhas JSON do genieacs-cwmp (npm test). Linhas no formato real do GenieACS 1.2.16
// (logger hr(): sessionContext -> deviceId/remoteAddress; rpc.cpeFault -> cpeFaultCode/String; fault -> faultCode/Message).

import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, type RawLine } from "../acslog.js";

const base = { timestamp: "2026-10-13T18:00:00.000Z", severity: "warn", deviceId: "0C014B-F6201B-ZTEPQ0000001", remoteAddress: "::ffff:100.64.0.10" };

test("senha recusada: ruim, explica o que fazer", () => {
  const c = classify({ ...base, message: "Authentication failure" } as RawLine)!;
  assert.equal(c.kind, "auth");
  assert.equal(c.level, "bad");
  assert.match(c.help, /Ativar TR-069/);
});

test("falha do equipamento: traduz o código TR-069", () => {
  const c = classify({ ...base, message: "CPE fault", acsRequestId: "abc", cpeFaultCode: "9005", cpeFaultString: "Invalid parameter name" } as RawLine)!;
  assert.equal(c.kind, "cpe-fault");
  assert.match(c.title, /9005/);
  assert.match(c.help, /parâmetro inexistente/);
  assert.equal(c.detail, "Invalid parameter name");
});

test("falha de provision: detalhe sem o nº da tentativa (as repetições se agrupam)", () => {
  const a = classify({ ...base, message: "Channel has faulted", channel: "inform", faultCode: "script.TypeError", faultMessage: "x is undefined", retries: 0 } as RawLine)!;
  const b = classify({ ...base, message: "Channel has faulted", channel: "inform", faultCode: "script.TypeError", faultMessage: "x is undefined", retries: 3 } as RawLine)!;
  assert.equal(a.kind, "provision-fault");
  assert.equal(a.detail, "canal inform · script.TypeError · x is undefined");
  assert.equal(a.detail, b.detail);
});

test("informe bem-sucedido e ruído não viram registro", () => {
  assert.equal(classify({ ...base, message: "Inform", informEvent: "2 PERIODIC" } as RawLine), null);
  assert.equal(classify({ ...base, message: "ACS request" } as RawLine), null);
});

test("equipamento novo, sessão interrompida e erro do ACS", () => {
  assert.equal(classify({ ...base, message: "New device registered" } as RawLine)!.level, "ok");
  assert.equal(classify({ ...base, message: "Session timeout" } as RawLine)!.kind, "timeout");
  assert.equal(classify({ ...base, message: "Too many commit iterations" } as RawLine)!.kind, "acs-config");
  assert.equal(classify({ message: "Worker died", timestamp: base.timestamp } as RawLine)!.level, "bad");
});
