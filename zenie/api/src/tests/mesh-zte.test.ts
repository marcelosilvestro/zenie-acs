// Testes do adaptador de mesh ZTE contra árvores EasyMesh reais (anonimizadas) lidas da NBI (npm test).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { identifySatellites, parseNodes } from "../adapters/mesh/zte-easymesh.js";

type Igd = { InternetGatewayDevice: Record<string, any> };
const igd = (name: string) => (JSON.parse(readFileSync(`src/tests/fixtures/${name}.json`, "utf8")) as Igd).InternetGatewayDevice;
const em = (name: string) => igd(name)["X_ZTE-COM_EasyMesh"];

test("F6201B: satélite vem com a identidade do controlador -> satélite sem identificação, filho do principal", () => {
  // Bancada 2026-10-09: notebook no cabo da F6201B (Controller.STA), Redmi-A5 no 5 GHz do H199A (Agent.1.STA).
  const [ctrl, sat, ...rest] = parseNodes("dev", em("easymesh-f6201b-satelite"));
  assert.equal(rest.length, 0);
  assert.equal(ctrl!.role, "principal");
  assert.equal(ctrl!.clientCount, 1);
  assert.equal(sat!.role, "satélite");
  assert.equal(sat!.identityUnknown, true);
  assert.equal(sat!.mac, null);
  assert.equal(sat!.model, null);
  assert.equal(sat!.serial, null);
  assert.equal(sat!.backhaul, null);
  assert.equal(sat!.parentMac, ctrl!.mac);
  // TotalSTANumberOfEntries vem 0 no Agent: conta pela lista.
  assert.equal(sat!.clientCount, 1);
});

test("H196A: satélite H199A identificado normalmente (sem regressão)", () => {
  const [ctrl, sat, ...rest] = parseNodes("dev", em("easymesh-h196a-satelite"));
  assert.equal(rest.length, 0);
  // 6 entradas, 1 inativa: 5, igual ao TotalSTANumberOfEntries do próprio equipamento.
  assert.equal(ctrl!.clientCount, 5);
  assert.equal(sat!.identityUnknown, false);
  assert.equal(sat!.model, "ZXHN H199A");
  assert.notEqual(sat!.mac, ctrl!.mac);
  assert.equal(sat!.parentMac, ctrl!.mac);
  assert.equal(sat!.hop, 1);
  assert.equal(sat!.backhaul?.kind, "cabo");
  // 7 entradas na lista, 1 inativa (Active=0, aparelho que saiu).
  assert.equal(sat!.clientCount, 6);
});

test("F6201B com 2 satélites (H199A e H3601P no cabo): cada Agent casado com o satélite DHCP da mesma porta", () => {
  // Bancada 2026-10-09: H199A (MULTIAP_SLAVE) e Redmi-A5 na LAN 4; H3601P (MULTIAP_SLAVE) e notebook na LAN 1.
  const t = igd("easymesh-f6201b-2satelites");
  const nodes = parseNodes("dev", t["X_ZTE-COM_EasyMesh"]);
  assert.equal(nodes.length, 3);
  assert.ok(nodes.slice(1).every((n) => n.identityUnknown && n.mac === null));
  identifySatellites(nodes, t["X_ZTE-COM_EasyMesh"], t.LANDevice["1"].Hosts.Host);
  const hosts = Object.values(t.LANDevice["1"].Hosts.Host as Record<string, any>).filter((h) => h?.MACAddress);
  const sat = (port: string) => hosts.find((h) => h.VendorClassID._value === "MULTIAP_SLAVE" && h.Layer2Interface._value.endsWith(`.${port}`));
  const [, a1, a2] = nodes;
  assert.equal(a1!.mac, sat("4").MACAddress._value);
  assert.equal(a1!.ip, sat("4").IPAddress._value);
  assert.deepEqual([a1!.backhaul?.kind, a1!.backhaul?.media], ["cabo", "LAN 4 do principal"]);
  assert.equal(a2!.mac, sat("1").MACAddress._value);
  assert.deepEqual([a2!.backhaul?.kind, a2!.backhaul?.media], ["cabo", "LAN 1 do principal"]);
  assert.equal(a1!.parentMac, nodes[0]!.mac);
  assert.equal(a2!.parentMac, nodes[0]!.mac);
  assert.equal(a1!.model, null);
});

test("satélite sem aparelhos e sem porta em comum: só atribui por eliminação quando sobra exatamente um", () => {
  const t = igd("easymesh-f6201b-2satelites");
  const tree = structuredClone(t["X_ZTE-COM_EasyMesh"]);
  delete tree.NetworkTopology.Agent["2"].STA;
  const nodes = parseNodes("dev", tree);
  identifySatellites(nodes, tree, t.LANDevice["1"].Hosts.Host);
  assert.ok(nodes[1]!.mac && nodes[2]!.mac);
  assert.notEqual(nodes[1]!.mac, nodes[2]!.mac);
  // Sem nenhuma lista: dois Agents e dois satélites -> ambíguo, ninguém é atribuído.
  delete tree.NetworkTopology.Agent["1"].STA;
  const none = parseNodes("dev", tree);
  identifySatellites(none, tree, t.LANDevice["1"].Hosts.Host);
  assert.ok(none.slice(1).every((n) => n.mac === null));
});

test("F6201B com 2 satélites pelo Wi-Fi: nós sem identificação, satélites listados à parte, contagem pela lista", () => {
  // Bancada 2026-10-09: H199A e H3601P pelo Wi-Fi; os dois hosts MULTIAP_SLAVE na mesma interface (WLANConfiguration.10,
  // backhaul interno que o firmware não publica) e nenhum aparelho neles: não há como dizer qual nó é qual.
  const t = igd("easymesh-f6201b-2satelites-wifi");
  const nodes = parseNodes("dev", t["X_ZTE-COM_EasyMesh"]);
  assert.equal(nodes.length, 3);
  const unassigned = identifySatellites(nodes, t["X_ZTE-COM_EasyMesh"], t.LANDevice["1"].Hosts.Host);
  assert.ok(nodes.slice(1).every((n) => n.identityUnknown && n.mac === null));
  assert.equal(unassigned.length, 2);
  assert.ok(unassigned.every((s) => s.link === "Wi-Fi"));
  // O firmware manda TotalSTANumberOfEntries=1 com a lista vazia: vale a lista.
  assert.deepEqual(nodes.slice(1).map((n) => n.clientCount), [0, 0]);
});
