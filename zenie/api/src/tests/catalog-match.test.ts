// Reconhecimento de perfil pelo catálogo do repositório, inclusive por versão de hardware (npm test).

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.ZENIE_CATALOG_DIR = "../../catalog";
const { matchProfile, hardwareMatches, setDrafts, catalog } = await import("../catalog.js");

test("F670L: V1 e V9 têm perfis próprios pela versão de hardware", () => {
  assert.equal(matchProfile("ZTE", "F670L", null, "V9.0")?.id, "zte/f670l");
  assert.equal(matchProfile("ZTE", "F670L", null, "V1.1.01")?.id, "zte/f670l-v1");
});

test("F670L sem versão de hardware (ou revisão desconhecida) não herda a homologação de nenhuma revisão", () => {
  assert.equal(matchProfile("ZTE", "F670L", null, null), null);
  assert.equal(matchProfile("ZTE", "F670L", null, "V5.0"), null);
});

test("modelos sem filtro de hardware continuam reconhecidos com qualquer revisão", () => {
  assert.equal(matchProfile("ZTE", "F6201B", null, "V2.0")?.id, "zte/f6201b");
  assert.equal(matchProfile("ZTE", "F6201B", null, null)?.id, "zte/f6201b");
});

test("filtro de hardware: prefixo, sem diferenciar maiúsculas", () => {
  const p = { match: { manufacturer: ["X"], productClass: ["Y"], hardwareVersion: ["V9."] } };
  assert.equal(hardwareMatches(p, "v9.0"), true);
  assert.equal(hardwareMatches(p, "V90"), false);
  assert.equal(hardwareMatches({ match: { manufacturer: ["X"], productClass: ["Y"] } }, null), true);
});

test("rascunho só da foto não congela o perfil: a homologação do catálogo oficial continua valendo", () => {
  // 2026-10-09: a foto da F670L V1 criou um rascunho com a cópia 0/17 por cima do oficial 17/17.
  const official = catalog().profiles.find((p) => p.id === "zte/f670l-v1")!;
  const stale = { ...official, capabilities: {}, homologation: { status: "em-homologacao" } };
  setDrafts([{ _id: "zte/f670l-v1", profile: stale, thumb: Buffer.from("webp"), photoOnly: true }]);
  let p = catalog().profiles.find((x) => x.id === "zte/f670l-v1")!;
  assert.equal(p.homologation.status, official.homologation.status);
  assert.equal(p.hasImage, true);
  assert.equal(p.draft, true);
  // Rascunho editado no painel (photoOnly falso) continua valendo por cima do oficial.
  setDrafts([{ _id: "zte/f670l-v1", profile: stale, thumb: null, photoOnly: false }]);
  p = catalog().profiles.find((x) => x.id === "zte/f670l-v1")!;
  assert.equal(p.homologation.status, "em-homologacao");
  setDrafts([]);
});
