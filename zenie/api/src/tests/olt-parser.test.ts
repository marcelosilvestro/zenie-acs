// Parser do ZTE C320 V2.1.x contra as saídas REAIS (fixtures/zte_c320_v2.1.0) e a OLT simulada (npm test).

import assert from "node:assert/strict";
import { test } from "node:test";
import { commands } from "../olt/zte-c320-v21/commands.js";
import { baseInfo, ponState, versionRunning } from "../olt/zte-c320-v21/parser.js";
import { fixture, resetSimulated, SimulatedTransport } from "../olt/simulated.js";
import { safeLine, OltFailure } from "../olt/transport.js";
import { cleanTerminal } from "../olt/telnet.js";

test("version-running: versão MVR e placas", () => {
  const v = versionRunning(fixture("show_version_running.txt"));
  assert.equal(v.version, "V2.1.0");
  assert.deepEqual(v.boards.map((b) => `${b.local} ${b.type}`), ["1/1/1 GTGHG", "1/1/2 GTXK", "1/1/4 SMXA"]);
  assert.equal(v.boards[2]!.versions.FW, "V2.1.0");
});

test("onu state: 27 ONUs, 25 online, total conferido", () => {
  const s = ponState(fixture("show_gpon_onu_state.txt"));
  assert.equal(s.total, 27);
  assert.equal(s.onus.length, 27);
  assert.equal(s.onus[0]!.onu, 1);
  assert.equal(s.onus.filter((o) => o.online).length, s.online);
});

test("PON vazia vira 0 ONUs (não é erro)", () => {
  assert.equal(ponState(fixture("show_gpon_onu_state_pon_vazia.txt")).total, 0);
  assert.equal(baseInfo(fixture("show_gpon_onu_state_pon_vazia.txt")).size, 0);
});

test("baseinfo: SN e fabricante pelo prefixo", () => {
  const b = baseInfo(fixture("show_gpon_onu_baseinfo.txt"));
  assert.equal(b.get(1)!.sn, "ZTEGD0000001");
  assert.equal(b.get(1)!.vendor, "ZTEG");
  assert.equal(b.get(2)!.vendor, "FRKW");
});

test("saída cortada ou erro da OLT nunca vira resultado vazio", () => {
  const cut = fixture("show_gpon_onu_state.txt").split("\n").filter((l) => !l.includes("1/1/1:5 ")).join("\n");
  assert.throws(() => ponState(cut), (e) => e instanceof OltFailure && e.kind === "formato");
  assert.throws(() => ponState("%Error 20203: Incomplete command."), (e) => e instanceof OltFailure && e.kind === "comando");
  assert.throws(() => versionRunning("lixo"), (e) => e instanceof OltFailure && e.kind === "formato");
});

test("comandos: só faixas válidas, nada de texto livre", () => {
  assert.equal(commands.ponState(1, 1, 16), "show gpon onu state gpon-olt_1/1/16");
  assert.throws(() => commands.ponState(1, 1, 17));
  assert.throws(() => commands.onuDetail(1, 1, 1, 0));
  assert.throws(() => commands.ponState(2, 1, 1));
  assert.throws(() => safeLine("show x\nreload"));
  assert.throws(() => safeLine(""));
});

test("OLT simulada responde como a real", async () => {
  const t = new SimulatedTransport();
  await t.connect();
  assert.equal(t.name(), "OLT-c320_1");
  assert.equal(versionRunning(await t.exec("show version-running")).version, "V2.1.0");
  assert.equal(ponState(await t.exec(commands.ponState(1, 1, 1))).total, 27);
  assert.equal(ponState(await t.exec(commands.ponState(1, 2, 5))).total, 0);
  assert.match(await t.exec(commands.ponState(1, 3, 1)), /%Error/);
});

test("terminal: CRLF, ANSI e backspace", () => {
  assert.equal(cleanTerminal("ab\x08c\r\n\x1b[1mok\x1b[0m"), "ac\nok");
});

// ---------------------------------------------------------------- TR-069 da ONU (running config)

import { onuTr069, unwrap80 } from "../olt/zte-c320-v21/parser.js";
import { canBeOnu, jobForOnu, samePonSerial, sentWithCurrent, tr069Status } from "../olt/inventory.js";

test("running config com tr069-mgmt: estado, URL, validate e usuário — sem senha", () => {
  const r = onuTr069(fixture("show_onu_running_config_com_tr069.txt"));
  assert.deepEqual(r, { configured: true, state: "unlock", acsUrl: "http://10.0.0.10:7547", validate: "basic", username: "zenie", passwordMatches: null, pppoeUser: "cliente20" });
  assert.ok(!JSON.stringify(r).includes("senhaacs"), "a senha do ACS não pode sair do parser");
  assert.ok(!JSON.stringify(r).includes("xxxxxxxx"), "nem a do PPPoE");
});

test("running config quebrado em 80 colunas (como a C320 entrega): a senha é comparada e não sai do parser", () => {
  // 2026-10-09: "...username zenie pass" + "word <senha>" na linha seguinte; antes passwordMatches ficava sempre null.
  const t = fixture("show_onu_running_config_quebra_80.txt");
  const ok = onuTr069(t, "SenhaTeste.1234");
  assert.deepEqual(ok, { configured: true, state: "unlock", acsUrl: "http://10.100.100.100:7547", validate: "basic", username: "zenie", passwordMatches: true, pppoeUser: "cliente21" });
  assert.equal(onuTr069(t, "OutraSenha123").passwordMatches, false);
  assert.ok(!JSON.stringify(ok).includes("SenhaTeste"), "a senha do ACS não pode sair do parser");
});

test("unwrap80: só junta continuação na coluna 0 depois de linha com 80 caracteres", () => {
  const a = "x".repeat(80);
  assert.equal(unwrap80(`${a}\ncontinua\n  linha`), `${a}continua\n  linha`);
  assert.equal(unwrap80(`${a}\n  nova linha`), `${a}\n  nova linha`); // linha nova (indentada) não é continuação
  assert.equal(unwrap80(`${a}\n!`), `${a}\n!`);
  assert.equal(unwrap80("curta\nsolta"), "curta\nsolta");
});

test("running config sem tr069-mgmt: não configurado", () => {
  assert.deepEqual(onuTr069(fixture("show_onu_running_config_sem_tr069.txt")), { configured: false, state: null, acsUrl: null, validate: null, username: null, passwordMatches: null, pppoeUser: "cliente13" });
});

test("running config: erro da OLT e formato desconhecido nunca viram 'não configurado'", () => {
  assert.throws(() => onuTr069("%Error 20202: Invalid input detected at '^' marker."), (e) => e instanceof OltFailure && e.kind === "comando");
  assert.throws(() => onuTr069("algo inesperado"), (e) => e instanceof OltFailure && e.kind === "formato");
});

test("situação do TR-069 comparada ao ACS esperado", () => {
  const exp = { url: "http://10.100.100.100:7547/", username: "zenie" };
  const cfg = (o: Partial<{ configured: boolean; state: "lock" | "unlock" | null; acsUrl: string | null; username: string | null }>) =>
    ({ tr069: { configured: true, state: "unlock" as const, acsUrl: "http://10.100.100.100:7547", validate: "basic", username: "zenie", readAt: new Date(), ...o }, tr069Error: null });
  assert.equal(tr069Status(cfg({}), exp), "ok"); // barra final não importa
  assert.equal(tr069Status(cfg({ username: "hgw" }), exp), "divergente");
  assert.equal(tr069Status(cfg({ acsUrl: "http://0.0.0.0:9090/digest/tr069" }), exp), "divergente");
  assert.equal(tr069Status(cfg({ state: "lock" }), exp), "bloqueado");
  assert.equal(tr069Status(cfg({ configured: false, acsUrl: null }), exp), "nao");
  assert.equal(tr069Status({ tr069: null, tr069Error: "x" }, exp), "desconhecido");
  // Sem TR-069 na OLT, mas falando com o ACS (online no Zenie): configurado na própria ONU, não é pendência.
  assert.equal(tr069Status(cfg({ configured: false, acsUrl: null }), exp, "online"), "onu");
  assert.equal(tr069Status(cfg({ username: "hgw" }), exp, "late"), "onu");
  assert.equal(tr069Status(cfg({ configured: false, acsUrl: null }), exp, "offline"), "nao");
  assert.equal(tr069Status(cfg({ state: "lock" }), exp, "online"), "bloqueado");
});

test("OLT simulada: running config das ONUs (pares com TR-069)", async () => {
  const t = new SimulatedTransport();
  await t.connect();
  assert.equal(onuTr069(await t.exec(commands.onuRunningConfig(1, 1, 1, 2))).configured, true);
  assert.equal(onuTr069(await t.exec(commands.onuRunningConfig(1, 1, 1, 3))).configured, false);
});

// ---------------------------------------------------------------- ativação do TR-069 (O3)

import { ZTE_C320_V21 } from "../olt/driver.js";
import { driverFor } from "../olt/driver.js";
import type { Transport } from "../olt/transport.js";

test("ativação: sequência exata, igual à validada na OLT", () => {
  assert.deepEqual(commands.tr069Activate(1, 1, 16, 13, "http://10.100.100.100:7547", "zenie", "Senha123abc"), [
    "configure terminal",
    "pon-onu-mng gpon-onu_1/1/16:13",
    "tr069-mgmt 1 state unlock",
    "tr069-mgmt 1 acs http://10.100.100.100:7547 validate basic username zenie password Senha123abc",
    "exit",
    "exit",
  ]);
});

test("ativação: URL/credencial que quebrariam a linha são recusadas", () => {
  const ok = ["http://10.100.100.100:7547", "zenie", "Senha123abc"] as const;
  for (const url of ["/", "", "http://10.100.100.100:7547/x y", "ftp://a", "http://a;reload", "http://" + "a".repeat(130)]) {
    assert.throws(() => commands.tr069Activate(1, 1, 1, 1, url, ok[1], ok[2]), url);
  }
  for (const bad of ["a b", "a;b", 'a"b', "", "a\b"]) {
    assert.throws(() => commands.tr069Activate(1, 1, 1, 1, ok[0], bad, ok[2]));
    assert.throws(() => commands.tr069Activate(1, 1, 1, 1, ok[0], ok[1], bad));
  }
  assert.throws(() => commands.tr069Activate(1, 1, 17, 1, ...ok));
});

test("ativação na OLT simulada: comandos enviados em ordem", async () => {
  const t = new SimulatedTransport();
  await t.connect();
  const drv = driverFor("ZTE", "C320")!.create(t);
  await drv.activateTr069(1, 1, 2, "http://10.100.100.100:7547", "zenie", "Senha123abc");
  assert.equal(t.history.length, 6);
  assert.equal(t.history[1], "pon-onu-mng gpon-onu_1/1/1:2");
  assert.equal(ZTE_C320_V21.features.ativar_tr069, "validado");
});

test("ativação: para no 1º %Error, sai do modo de configuração e não expõe a senha", async () => {
  const sent: string[] = [];
  const fake: Transport = {
    connect: async () => undefined,
    name: () => "OLT",
    close: async () => undefined,
    exec: async (line) => {
      sent.push(line);
      return line.startsWith("tr069-mgmt 1 acs") ? "                     ^\n%Error 20202: Invalid input detected at '^' marker." : "";
    },
  };
  const drv = driverFor("ZTE", "C320")!.create(fake);
  await assert.rejects(drv.activateTr069(1, 1, 2, "http://10.100.100.100:7547", "zenie", "SenhaSecreta99"),
    (e) => e instanceof OltFailure && e.kind === "comando" && !e.describe().includes("SenhaSecreta99"));
  assert.deepEqual(sent.slice(-2), ["exit", "exit"]); // saiu dos 2 modos abertos
  assert.equal(sent.filter((l) => l.startsWith("tr069-mgmt 1 acs")).length, 1);
});

// ---------------------------------------------------------------- O4: senha antiga e write

test("senha na OLT: só a comparação sai do parser", () => {
  const t = fixture("show_onu_running_config_com_tr069.txt");
  const same = onuTr069(t, "senhaacs");
  const other = onuTr069(t, "SenhaNova123");
  assert.equal(same.passwordMatches, true);
  assert.equal(other.passwordMatches, false);
  assert.ok(!JSON.stringify(same).includes("senhaacs") && !JSON.stringify(other).includes("senhaacs"));
});

test("situação 'senha antiga': URL e usuário certos, senha diferente — é pendência", () => {
  const exp = { url: "http://10.100.100.100:7547", username: "zenie" };
  const row = (m: boolean | null) => ({ tr069: { configured: true, state: "unlock" as const, acsUrl: "http://10.100.100.100:7547", validate: "basic", username: "zenie", passwordMatches: m, readAt: new Date() }, tr069Error: null });
  assert.equal(tr069Status(row(false), exp), "senha");
  assert.equal(tr069Status(row(true), exp), "ok");
  assert.equal(tr069Status(row(null), exp), "ok"); // não comparada (sem credencial ativa na leitura)
  assert.equal(tr069Status(row(false), exp, "online"), "onu"); // ainda fala com o ACS (credencial em transição)
});

test("senha não conferida (gravada fora do Zenie) e ONU sem chegar ao ACS: 'senha' (regravar)", () => {
  // testeZTE2, 2026-10-09: senha não comparada na leitura; a configuração tinha sido digitada direto na OLT e, ao religar,
  // o OMCI regravou na ONU uma senha diferente da credencial ativa (Digest recusado).
  const exp = { url: "http://10.100.100.100:7547", username: "zenie" };
  const row = { tr069: { configured: true, state: "unlock" as const, acsUrl: "http://10.100.100.100:7547", validate: "basic", username: "zenie", passwordMatches: null, readAt: new Date() }, tr069Error: null, online: true };
  assert.equal(tr069Status(row, exp, "offline"), "senha");
  assert.equal(tr069Status(row, exp, null), "senha"); // online na OLT e nunca chegou ao Zenie
  assert.equal(tr069Status(row, exp, "offline", true), "ok"); // o Zenie enviou a credencial atual
  assert.equal(tr069Status(row, exp, "online"), "ok"); // fala com o ACS
  assert.equal(tr069Status({ ...row, online: false }, exp, null), "ok"); // ONU desligada: nada a concluir
});

test("envio do Zenie só vale como 'senha conferida' se for da credencial ativa", () => {
  const since = new Date("2026-10-08T18:56:27Z");
  const exp = { username: "zenie", credentialSince: since };
  assert.equal(sentWithCurrent({ username: "zenie", sentAt: new Date("2026-10-08T19:55:33Z"), createdAt: new Date("2026-10-08T19:55:32Z") }, exp), true);
  assert.equal(sentWithCurrent({ username: "zenie", sentAt: new Date("2026-10-08T18:00:00Z"), createdAt: new Date("2026-10-08T18:00:00Z") }, exp), false); // credencial anterior
  assert.equal(sentWithCurrent({ username: "zenie", sentAt: null, createdAt: new Date("2026-10-08T19:55:32Z") }, exp), false); // não chegou a gravar
  assert.equal(sentWithCurrent(null, exp), false);
});

test("write: exige o [OK] da OLT", async () => {
  const sim = new SimulatedTransport();
  await sim.connect();
  await driverFor("ZTE", "C320")!.create(sim).saveConfig();
  assert.equal(sim.history.at(-1), "write");
  const bad: Transport = { connect: async () => undefined, name: () => "OLT", close: async () => undefined, exec: async () => "Backuping old configuration into flash...\nWriting configuration into flash...[FAIL]" };
  await assert.rejects(driverFor("ZTE", "C320")!.create(bad).saveConfig(), (e) => e instanceof OltFailure && e.kind === "formato");
  const err: Transport = { ...bad, exec: async () => "%Error 20203: Incomplete command." };
  await assert.rejects(driverFor("ZTE", "C320")!.create(err).saveConfig(), (e) => e instanceof OltFailure && e.kind === "comando");
});

test("OLT simulada lembra o tr069-mgmt recebido (a releitura confere)", async () => {
  resetSimulated();
  const t = new SimulatedTransport();
  await t.connect();
  const drv = driverFor("ZTE", "C320")!.create(t);
  assert.equal((await drv.onuTr069(1, 1, 1)).configured, false);
  await drv.activateTr069(1, 1, 1, "http://10.0.0.20:7547", "zenie", "Senha123abc");
  const r = await drv.onuTr069(1, 1, 1, "Senha123abc");
  assert.deepEqual([r.configured, r.state, r.acsUrl, r.username, r.passwordMatches], [true, "unlock", "http://10.0.0.20:7547", "zenie", true]);
  assert.equal(ZTE_C320_V21.features.salvar_configuracao, "validado");
  resetSimulated();
});

test("login PPPoE da WAN da OLT: sai do parser, a senha do PPPoE não", () => {
  const r = onuTr069(fixture("show_onu_running_config_sem_tr069.txt"));
  assert.equal(r.pppoeUser, "cliente13");
  assert.ok(!JSON.stringify(r).includes("xxxxxxxx"));
});

test("troca de equipamento na mesma posição/login: o registro do aparelho anterior não vale para o novo", () => {
  // Troca de equipamento: F670L V1 (ZTEGC0000013) na posição que era de um F6201B (ZTEGD0000020), mesmo login.
  const envioAntigo = { sn: "ZTEGD0000020", state: "concluido" };
  assert.equal(jobForOnu(envioAntigo, "ZTEGC0000013"), null);
  assert.equal(jobForOnu(envioAntigo, "ztegd0000020"), envioAntigo);
  assert.equal(jobForOnu(null, "ZTEGC0000013"), null);
  // Casar pelo login: só sem SN conhecido no Zenie ou com o mesmo SN.
  assert.equal(samePonSerial("ZTEGD0000020", "ZTEGC0000013"), false);
  assert.equal(samePonSerial("", "ZTEGC0000013"), true); // firmware que não publica o SN (cliente com esse firmware)
  assert.equal(samePonSerial("ZTEGC0000013", "ztegc0000013"), true);
});

test("roteador atrás de ONU em bridge (mesmo login PPPoE) nunca é tratado como a ONU", () => {
  // Bancada 2026-10-09: H198A teste_ztev9 atrás da F6600P (1/16:13) recebia o SN PON da ONU e aparecia na lista de ONUs.
  assert.equal(canBeOnu("Roteador"), false);
  assert.equal(canBeOnu("ONU"), true);
  assert.equal(canBeOnu(null), true); // tipo ainda não lido
});
