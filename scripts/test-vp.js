#!/usr/bin/env node
// Executa virtual parameters contra um sample (samples/*.json) sem precisar do GenieACS.
// Simula declare() com suporte a curingas (*) e Date.now(intervalo).
//
// Uso:
//   node scripts/test-vp.js samples/F6201B_V9.3.10P7N9.json            # todos os VPs
//   node scripts/test-vp.js samples/F6201B_V9.3.10P7N9.json RXPower WanIP
//   node scripts/test-vp.js samples/F6201B_V9.3.10P7N9.json Wifi24SSID=NovoNome   # simula escrita
//   (na escrita, mostra os caminhos reais que seriam gravados: "SET caminho = valor")
//
// Limitação: o GenieACS real roda o script várias vezes por sessão (a cada rodada
// de declare); aqui é uma execução única com os valores do sample.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [samplePath, ...names] = process.argv.slice(2);
if (!samplePath) {
  console.error("uso: node scripts/test-vp.js <sample.json> [VP | VP=valor ...]");
  process.exit(1);
}
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
const paths = Object.keys(sample).filter((p) => p !== "_meta");
const vpDir = path.join(__dirname, "..", "virtual-parameters");
const vps = names.length ? names : fs.readdirSync(vpDir).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3));

function makeDeclare(log, sets) {
  return function declare(pattern, attrTs, attrValues) {
    log.push(pattern);
    if (attrValues && "value" in attrValues) sets.push(`SET ${pattern} = ${JSON.stringify(attrValues.value)}`);
    const rx = new RegExp("^" + pattern.split(".").map((s) => (s === "*" ? "[^.]+" : s.replace(/[-[\]{}()+?.,\\^$|#]/g, "\\$&"))).join("\\.") + "$");
    const items = paths.filter((p) => rx.test(p)).map((p) => ({
      path: p,
      value: "v" in sample[p] ? [sample[p].v, sample[p].t] : undefined,
    }));
    const result = items.slice();
    result.size = items.length;
    result.value = items.length ? items[0].value : undefined;
    result.path = items.length ? items[0].path : undefined;
    return result;
  };
}

const RealDate = Date;
const FakeDate = function (...a) { return new RealDate(...a); };
FakeDate.now = (interval) => (interval ? RealDate.now() - (RealDate.now() % interval) : RealDate.now());

for (const spec of vps) {
  const [name, ...rest] = spec.split("=");
  const writeValue = rest.length ? rest.join("=") : null;
  const src = fs.readFileSync(path.join(vpDir, name + ".js"), "utf8");
  const log = [];
  const sets = [];
  try {
    const r = vm.runInNewContext("(function(){" + src + "\n})()", {
      declare: makeDeclare(log, sets),
      args: [{}, writeValue === null ? {} : { value: [writeValue, "xsd:string"] }],
      Date: FakeDate,
    });
    console.log(`${spec.padEnd(16)} ${JSON.stringify(r.value).padEnd(30)} (${log.length} declare)${r.writable ? " gravável" : ""}`);
    sets.forEach((s) => console.log("    " + s));
  } catch (e) {
    console.log(`${spec.padEnd(16)} ERRO: ${e.message}`);
  }
}
