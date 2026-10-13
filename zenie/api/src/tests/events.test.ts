// Detecção de eventos pela comparação do inventário (events.ts) — npm test.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { InventoryItem } from "../db.js";
import { diffDevice, nextRxBand, wanCause, type CarriedState } from "../events.js";

const NOW = new Date("2026-10-13T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function item(over: Partial<InventoryItem & CarriedState> = {}): InventoryItem & CarriedState {
  return {
    _id: "0C014B-F6201B-ZTEPQ0000001", vendor: "ZTE", model: "F6201B", productClass: "F6201B", modelName: null, oui: "0C014B",
    serial: "ZTEPQ0000001", serialKey: "ZTEPQ0000001", pppoe: "cliente1", pppoeKey: "cliente1", ponSerial: null, ponSerialKey: "",
    macs: [], wanIp: "100.64.0.10", wanStatus: "Connected", wanUptimeSec: 86400, wanLastError: "ERROR_NONE", wanLink: "Up", wanReadAt: ago(10), accessType: "ONU", firmware: "V9.3.10P7N9", wifiGeneration: "6",
    profileId: "zte/f6201b", homologated: true, rx: -19.5, tx: 2.1, ponStatus: "Up", uptimeSec: 86400, tags: [],
    lastInform: ago(2), lastBoot: ago(1440), registered: ago(10000), syncedAt: NOW,
    offlineSince: null, rxBand: "ok",
    ...over,
  };
}

const types = (r: ReturnType<typeof diffDevice>) => r.events.map((e) => e.type);

test("nada mudou: nenhum evento", () => {
  assert.deepEqual(types(diffDevice(item(), item(), NOW)), []);
});

const cause = (r: ReturnType<typeof diffDevice>) => r.events.find((e) => e.type === "reboot")?.details?.causa;

test("reinício: lastBoot avançou, evento com a hora do boot; sem pedido nem silêncio = local", () => {
  const r = diffDevice(item(), item({ lastBoot: ago(1), lastInform: ago(1) }), NOW);
  assert.deepEqual(types(r), ["reboot"]);
  assert.equal(r.events[0]!.ts.getTime(), ago(1).getTime());
  assert.equal(cause(r), "local");
});

test("causa do reinício: painel (auditoria até 15 min antes), firmware, desligado", () => {
  const next = item({ lastBoot: ago(1), lastInform: ago(1) });
  const panel = diffDevice(item(), next, NOW, { panelReboot: { ts: ago(3), username: "noc.joao" } });
  assert.equal(cause(panel), "painel");
  assert.equal(panel.events[0]!.details?.usuario, "noc.joao");
  // Pedido antigo (40 min antes do boot) não é a causa.
  assert.equal(cause(diffDevice(item(), next, NOW, { panelReboot: { ts: ago(41) } })), "local");
  assert.equal(cause(diffDevice(item(), item({ lastBoot: ago(1), lastInform: ago(1), firmware: "V9.3.10P8N1" }), NOW)), "firmware");
  // Último inform 40 min antes do boot: estava desligado.
  const off = diffDevice(item({ lastInform: ago(41) }), next, NOW);
  assert.equal(cause(off), "desligado");
  assert.equal(off.events.find((e) => e.type === "reboot")!.details?.foraSegundos, 40 * 60);
});

test("causa da queda da WAN: link físico ou último erro do equipamento", () => {
  assert.equal(wanCause({ wanLink: "Down", wanLastError: "ERROR_NONE" }), "porta WAN sem link (cabo ou equipamento ligado na WAN)");
  assert.equal(wanCause({ wanLink: "Up", wanLastError: "ERROR_AUTHENTICATION_FAILURE" }), "falha de autenticação PPPoE (usuário/senha)");
  assert.equal(wanCause({ wanLink: "Up", wanLastError: "ERROR_NONE" }), null);
  const r = diffDevice(item(), item({ wanStatus: "Disconnected", wanLastError: "ERROR_ISP_TIME_OUT" }), NOW);
  assert.equal(r.events[0]!.details?.causa, "sem resposta do servidor PPPoE");
});

test("reconexão entre leituras: pelo tempo de conexão da WAN, com o horário do início", () => {
  // Leitura nova: conectada há 20 min (antes: há 1 dia) -> reconectou há 20 min.
  const r = diffDevice(item(), item({ wanReadAt: ago(0), wanUptimeSec: 1200, wanIp: "100.64.9.9", wanLastError: "ERROR_ISP_DISCONNECT" }), NOW);
  assert.deepEqual(types(r), ["wan.reconnect"]);
  assert.equal(r.events[0]!.ts.getTime(), ago(20).getTime());
  assert.equal(r.events[0]!.details?.para, "100.64.9.9");
  assert.equal(r.events[0]!.details?.causa, "o servidor PPPoE encerrou a conexão");
  // Mesma conexão relida (tempo cresceu junto com o relógio): nada.
  assert.deepEqual(types(diffDevice(item(), item({ wanReadAt: ago(0), wanUptimeSec: 86400 + 600 }), NOW)), []);
  // Conexão nova logo depois do boot: faz parte do reinício.
  assert.deepEqual(types(diffDevice(item({ lastBoot: ago(21) }), item({ lastBoot: ago(21), wanReadAt: ago(0), wanUptimeSec: 1200 }), NOW)), []);
  // Volta já anunciada pelo status (wan.up): a leitura seguinte não repete.
  assert.deepEqual(types(diffDevice(item({ wanUpSeenAt: ago(15) }), item({ wanReadAt: ago(0), wanUptimeSec: 1200 }), NOW)), []);
});

test("offline e volta, com a duração fora", () => {
  const off = diffDevice(item(), item({ lastInform: ago(45) }), NOW);
  assert.deepEqual(types(off), ["offline"]);
  assert.equal(off.state.offlineSince?.getTime(), ago(45).getTime());
  // Continua offline: não repete.
  assert.deepEqual(types(diffDevice(item({ lastInform: ago(45), offlineSince: ago(45) }), item({ lastInform: ago(47) }), NOW)), []);
  const back = diffDevice(item({ lastInform: ago(45), offlineSince: ago(45) }), item({ lastInform: ago(1) }), NOW);
  assert.deepEqual(types(back), ["online"]);
  assert.equal(back.events[0]!.details?.foraSegundos, 44 * 60);
  assert.equal(back.state.offlineSince, null);
});

test("sem referência anterior de contato (1ª sincronização com eventos): não anuncia offline", () => {
  const r = diffDevice(item({ offlineSince: undefined, lastInform: ago(60) }), item({ lastInform: ago(60) }), NOW);
  assert.deepEqual(types(r), []);
  assert.equal(r.state.offlineSince?.getTime(), ago(60).getTime());
});

test("WAN cai e volta; troca de IP com a WAN no ar", () => {
  assert.deepEqual(types(diffDevice(item(), item({ wanStatus: "Disconnected" }), NOW)), ["wan.down"]);
  assert.deepEqual(types(diffDevice(item({ wanStatus: "Disconnected" }), item({ wanIp: "100.64.9.9" }), NOW)), ["wan.up"]);
  assert.deepEqual(types(diffDevice(item(), item({ wanIp: "100.64.9.9" }), NOW)), ["wan.ip"]);
});

test("dado ausente não é mudança", () => {
  assert.deepEqual(types(diffDevice(item(), item({ wanStatus: null, wanIp: null, ponStatus: null, firmware: null, pppoe: null, rx: null }), NOW)), []);
  assert.deepEqual(types(diffDevice(item({ ponStatus: "" }), item(), NOW)), []);
});

test("RX: evento só na mudança de faixa, com histerese de 0,5 dB", () => {
  assert.equal(nextRxBand(-22.2, "ok"), "ok"); // a 0,2 dB da borda: fica
  assert.equal(nextRxBand(-22.6, "ok"), "warn");
  assert.equal(nextRxBand(-21.8, "warn"), "warn");
  assert.equal(nextRxBand(-24.6, "warn"), "bad");
  assert.equal(nextRxBand(-7, "ok"), "sat");
  assert.equal(nextRxBand(null, "warn"), "warn");
  const r = diffDevice(item(), item({ rx: -24.8 }), NOW);
  assert.deepEqual(types(r), ["rx.level"]);
  assert.equal(r.events[0]!.level, "bad");
  assert.deepEqual(types(diffDevice(item(), item({ rx: -22.3 }), NOW)), []);
  // Sem faixa anterior: só referência.
  assert.deepEqual(types(diffDevice(item({ rxBand: undefined }), item({ rx: -25 }), NOW)), []);
});

test("firmware, login PPPoE e status PON", () => {
  assert.deepEqual(types(diffDevice(item(), item({ firmware: "V9.3.10P8N1" }), NOW)), ["firmware"]);
  assert.deepEqual(types(diffDevice(item(), item({ pppoe: "cliente2" }), NOW)), ["pppoe"]);
  assert.deepEqual(types(diffDevice(item(), item({ ponStatus: "Down" }), NOW)), ["pon.status"]);
});

test("equipamento novo: anuncia só fora da carga inicial", () => {
  assert.deepEqual(types(diffDevice(null, item(), NOW)), ["registered"]);
  assert.deepEqual(types(diffDevice(null, item(), NOW, { announceNew: false })), []);
});

test("registro antigo (staleOf) não gera eventos", () => {
  assert.deepEqual(types(diffDevice(item({ staleOf: "outro" }), item({ lastBoot: ago(5), wanStatus: "Disconnected" }), NOW)), []);
});
