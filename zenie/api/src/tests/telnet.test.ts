// Telnet contra uma OLT falsa local (como tests/apoio/olt_falsa.php do addon): login, IAC, eco, paginação
// "--More--", enable e senha errada. A saída devolvida tem de ser a do fixture real, limpa.

import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Server } from "node:net";
import { after, before, test } from "node:test";
import { TelnetTransport } from "../olt/telnet.js";
import { fixture } from "../olt/simulated.js";
import { OltFailure } from "../olt/transport.js";
import { versionRunning, ponState } from "../olt/zte-c320-v21/parser.js";

const IAC = 255, WILL = 251, DO = 253;
let server: Server;
let port = 0;

/** OLT falsa: usuário "zenie"/"certa"; userMode=true entra em ">" e exige enable "en". */
function fakeOlt(userMode: boolean) {
  return createServer((s) => {
    let stage = "user";
    let buf = "";
    let mode = userMode ? ">" : "#";
    s.write(Buffer.from([IAC, WILL, 1, IAC, WILL, 3, IAC, DO, 24])); // ECHO, SGA, pede TERMINAL-TYPE
    s.write("\r\n\r\n************ banner com a palavra fail no meio ************\r\nUsername:");
    s.on("data", (d) => {
      buf += Buffer.from([...d].filter((b) => b < 240)).toString("latin1"); // ignora respostas IAC
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        // A OLT real consome o espaço que avança o "--More--"; aqui ele chegaria grudado na linha seguinte.
        const line = buf.slice(0, i).replace(/^ +/, "");
        buf = buf.slice(i + 2);
        if (stage === "user") { stage = "pass"; s.write("\r\nPassword:"); continue; }
        if (stage === "pass") {
          if (line !== "certa") { s.write("\r\n%Error 20209: Bad password.\r\nUsername:"); stage = "user"; continue; }
          stage = "cli"; s.write(`\r\nOLT-c320_1${mode}`); continue;
        }
        if (stage === "enable") { mode = line === "en" ? "#" : ">"; stage = "cli"; s.write(`\r\nOLT-c320_1${mode}`); continue; }
        s.write(line + "\r\n"); // eco
        if (line === "enable") { stage = "enable"; s.write("Password:"); continue; }
        if (line === "show version-running") {
          const lines = fixture("show_version_running.txt").split("\n");
          s.write(lines.slice(0, 4).join("\r\n") + "\r\n --More-- ");
          setTimeout(() => s.write("\x08\x08\x08\x08\x08\x08\x08\x08\x08\x08" + lines.slice(4).join("\r\n") + "\r\nOLT-c320_1#"), 50);
          continue;
        }
        if (line.startsWith("show gpon onu state")) { s.write(fixture("show_gpon_onu_state.txt").replace(/\n/g, "\r\n") + "\r\nOLT-c320_1#"); continue; }
        if (line === "exit") { s.end(); continue; }
        s.write(`%Error 20203: Incomplete command.\r\nOLT-c320_1${mode}`);
      }
    });
  });
}

const opts = (password: string, enable: string | null = null) => ({ host: "127.0.0.1", port, username: "zenie", password, enable, connectTimeoutSec: 3, commandTimeoutSec: 3 });

before(async () => {
  server = fakeOlt(false);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

test("login, paginação --More-- e saída limpa igual ao fixture", async () => {
  const t = new TelnetTransport(opts("certa"));
  await t.connect();
  assert.equal(t.name(), "OLT-c320_1");
  const v = versionRunning(await t.exec("show version-running"));
  assert.equal(v.version, "V2.1.0");
  assert.equal(v.boards.length, 3);
  assert.equal(ponState(await t.exec("show gpon onu state gpon-olt_1/1/1")).total, 27);
  await t.close();
});

test("senha errada vira falha de autenticação (sem a senha na mensagem)", async () => {
  const t = new TelnetTransport(opts("errada"));
  await assert.rejects(t.connect(), (e) => e instanceof OltFailure && e.kind === "autenticacao" && !e.describe().includes("errada"));
  await t.close();
});

test("porta fechada vira falha de conexão", async () => {
  const t = new TelnetTransport({ ...opts("certa"), port: 1 });
  await assert.rejects(t.connect(), (e) => e instanceof OltFailure && e.kind === "conexao");
});

test("modo usuário (>) sem enable pede a senha de enable; com enable entra", async () => {
  const s2 = fakeOlt(true);
  await new Promise<void>((r) => s2.listen(0, "127.0.0.1", () => r()));
  const p2 = (s2.address() as AddressInfo).port;
  const t1 = new TelnetTransport({ ...opts("certa"), port: p2 });
  await assert.rejects(t1.connect(), (e) => e instanceof OltFailure && e.kind === "modo_usuario");
  await t1.close();
  const t2 = new TelnetTransport({ ...opts("certa", "en"), port: p2 });
  await t2.connect();
  assert.equal(versionRunning(await t2.exec("show version-running")).version, "V2.1.0");
  await t2.close();
  s2.close();
});
