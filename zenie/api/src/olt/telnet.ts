// Telnet com a OLT (porte de lib/Olt/TransporteTelnet.php do addon zte_onu, validado na C320 V2.1.0).
//
// Garantias:
//  - timeout em toda espera (conexão, login, comando): nada fica pendurado;
//  - a senha nunca vai para log nem para mensagem de erro;
//  - negociação telnet (IAC) respondida com o mínimo e removida do texto;
//  - a saída volta sem eco do comando, sem prompt, sem "--More--" e sem códigos de terminal.

import { Socket } from "node:net";
import { OltFailure, safeLine, type Transport } from "./transport.js";

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const ECHO = 1, SGA = 3;
const MAX_OUTPUT = 4 * 1024 * 1024;

const RE_USER = /(user ?name|login)\s*:\s*$/i;
const RE_PASS = /password\s*:\s*$/i;
const RE_PROMPT = /(?:^|\n)([A-Za-z0-9._-]{1,64})(\([^)\n]*\))?([#>])\s*$/;
// Só conta como recusa se for a ÚLTIMA linha recebida: um banner com "fail" no meio não engana.
const RE_REFUSED = /(bad password|invalid|fail|denied|incorrect|no username)[^\n]*\n?\s*$/i;

export interface TelnetOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  enable: string | null;
  connectTimeoutSec: number;
  commandTimeoutSec: number;
}

/** CRLF -> LF, tira códigos ANSI e apaga o que veio com backspace. */
export function cleanTerminal(t: string): string {
  t = t.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\0/g, "");
  let prev: string;
  do {
    prev = t;
    t = t.replace(/[^\x08\n]\x08/g, "");
  } while (t !== prev);
  return t.replace(/\x08/g, "");
}

export class TelnetTransport implements Transport {
  private sock: Socket | null = null;
  private buffer = "";
  private iacRest: number[] = [];
  private oltName = "";
  private waiter: (() => void) | null = null;
  private closedError: OltFailure | null = null;

  constructor(private readonly o: TelnetOptions) {}

  async connect(): Promise<void> {
    const sock = new Socket();
    this.sock = sock;
    sock.on("data", (d: Buffer) => {
      this.buffer += this.handleIac(d);
      if (this.buffer.length > MAX_OUTPUT) this.closedError = new OltFailure("formato", "saída grande demais");
      this.waiter?.();
    });
    sock.on("close", () => {
      this.closedError ??= new OltFailure("queda", "conexão encerrada pela OLT");
      this.sock = null;
      this.waiter?.();
    });
    sock.on("error", () => {
      /* o "close" seguinte classifica */
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new OltFailure("conexao", `sem resposta em ${this.o.connectTimeoutSec}s`));
      }, this.o.connectTimeoutSec * 1000);
      sock.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      sock.once("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(new OltFailure("conexao", e.code ?? "erro de rede"));
      });
      sock.connect(this.o.port, this.o.host);
    });

    const t = this.o.connectTimeoutSec;
    await this.expect([RE_USER], t, "a OLT não pediu o usuário");
    this.send(this.o.username);
    await this.expect([RE_PASS], t, "a OLT não pediu a senha");
    this.send(this.o.password);
    let [i, m] = await this.expect([RE_PROMPT, RE_USER, RE_REFUSED], t, "sem prompt após o login");
    if (i !== 0) throw new OltFailure("autenticacao");
    if (m[3] === ">") {
      if (!this.o.enable) throw new OltFailure("modo_usuario");
      this.send("enable");
      await this.expect([RE_PASS], t, "a OLT não pediu a senha de enable");
      this.send(this.o.enable);
      [i, m] = await this.expect([RE_PROMPT, RE_REFUSED], t, "sem prompt após o enable");
      if (i !== 0 || m[3] !== "#") throw new OltFailure("autenticacao", "enable recusado");
    }
    this.oltName = m[1]!;
    this.buffer = "";
  }

  async exec(line: string): Promise<string> {
    if (!this.sock) throw new OltFailure("queda", "executar sem conexão");
    line = safeLine(line);
    this.send(line);
    const esc = this.oltName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rePrompt = new RegExp(`(?:^|\\n)${esc}(\\([^)\\n]*\\))?#\\s*$`);
    let deadline = Date.now() + this.o.commandTimeoutSec * 1000;
    for (;;) {
      if (this.closedError) throw this.closedError;
      // Paginação: responde com espaço e tira o marcador do texto.
      if (/--More--/i.test(this.buffer)) {
        this.buffer = this.buffer.replace(/\s*--More--\s*/gi, "\n");
        this.write(Buffer.from(" "));
        deadline = Date.now() + this.o.commandTimeoutSec * 1000;
      }
      if (rePrompt.test(cleanTerminal(this.buffer))) break;
      if (Date.now() > deadline) throw new OltFailure("timeout", "comando sem prompt de volta");
      await this.wait(200);
    }
    const lines = cleanTerminal(this.buffer).split("\n");
    this.buffer = "";
    lines.pop(); // o prompt final
    if (lines.length && lines[0]!.includes(line)) lines.shift(); // o eco do comando
    return lines.join("\n").replace(/^\n+|\n+$/g, "");
  }

  name(): string {
    return this.oltName;
  }

  async close(): Promise<void> {
    const s = this.sock;
    this.sock = null;
    if (!s) return;
    try {
      s.write("exit\r\n");
    } catch {
      /* já caiu */
    }
    s.end();
    setTimeout(() => s.destroy(), 500).unref();
  }

  // ---------------------------------------------------------------- interno

  /** Espera um dos padrões casar no FIM do buffer. */
  private async expect(patterns: RegExp[], timeoutSec: number, missing: string): Promise<[number, RegExpMatchArray]> {
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      const text = cleanTerminal(this.buffer);
      for (let i = 0; i < patterns.length; i++) {
        const m = text.match(patterns[i]!);
        if (m) {
          this.buffer = "";
          return [i, m];
        }
      }
      if (this.closedError) throw this.closedError;
      if (Date.now() > deadline) throw new OltFailure("timeout", missing);
      await this.wait(200);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        self.waiter = null;
        resolve();
      }
      this.waiter = done;
    });
  }

  private send(text: string): void {
    this.write(Buffer.from(text + "\r\n", "utf8"));
  }

  private write(bytes: Buffer): void {
    if (!this.sock) throw this.closedError ?? new OltFailure("queda", "falha ao escrever");
    this.sock.write(bytes);
  }

  /**
   * Retira a negociação telnet do fluxo e responde o mínimo: aceita ECHO e SGA do servidor, recusa todo o
   * resto. Um IAC partido entre duas leituras fica guardado para a próxima.
   */
  private handleIac(chunk: Buffer): string {
    const data = [...this.iacRest, ...chunk];
    this.iacRest = [];
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const b = data[i]!;
      if (b !== IAC) {
        out.push(b);
        continue;
      }
      if (i + 1 >= data.length) {
        this.iacRest = data.slice(i);
        break;
      }
      const cmd = data[i + 1]!;
      if (cmd === IAC) {
        out.push(255);
        i++;
        continue;
      }
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        if (i + 2 >= data.length) {
          this.iacRest = data.slice(i);
          break;
        }
        const opt = data[i + 2]!;
        if (cmd === DO) this.write(Buffer.from([IAC, WONT, opt]));
        else if (cmd === WILL) this.write(Buffer.from([IAC, opt === ECHO || opt === SGA ? DO : DONT, opt]));
        i += 2;
        continue;
      }
      if (cmd === SB) {
        let end = -1;
        for (let j = i + 2; j + 1 < data.length; j++) if (data[j] === IAC && data[j + 1] === SE) { end = j; break; }
        if (end < 0) {
          this.iacRest = data.slice(i);
          break;
        }
        i = end + 1;
        continue;
      }
      i++; // outros comandos de 2 bytes
    }
    return Buffer.from(out).toString("latin1");
  }
}
