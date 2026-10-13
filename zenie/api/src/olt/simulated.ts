// OLT simulada (porte de TransporteFixture/Fixtures.php do addon zte_onu): responde com as saídas REAIS gravadas
// em fixtures/zte_c320_v2.1.0. Nenhum byte sai do servidor. Serve para conhecer a tela sem equipamento e para os
// testes automáticos (o parser é testado contra o formato real).
//
// Mapa: placas PON nos slots 1 e 2 (16 portas); PON 1/1/1 -> as ONUs do fixture; demais PONs -> vazias.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { safeLine, OltFailure, type Transport } from "./transport.js";

export const SIMULATED_NAME = "OLT-c320_1";
const DIR = process.env.ZENIE_FIXTURES_DIR ?? fileURLToPath(new URL("../../fixtures/zte_c320_v2.1.0/", import.meta.url));

/** Conteúdo de um fixture sem a 1ª linha (eco "NOME#comando" que veio colado junto). */
export function fixture(name: string): string {
  const t = readFileSync(DIR + name, "utf8").replace(/\r\n/g, "\n");
  const lines = t.split("\n");
  if (/^[A-Za-z0-9._-]+(\([^)]*\))?#/.test(lines[0] ?? "")) lines.shift();
  return lines.join("\n").replace(/\n+$/, "");
}

// Estado da OLT simulada (vale para todas as sessões do processo): ONU em edição e o tr069-mgmt gravado em cada uma.
let editing: string | null = null;
const simTr069 = new Map<string, string>();
/** Limpa o estado (testes). */
export function resetSimulated(): void {
  editing = null;
  simTr069.clear();
}

const INVALID = "                                        ^\n%Error 20202: Invalid input detected at '^' marker.Invalid parameter";

export function simulatedResponse(line: string): string {
  line = line.trim().replace(/\s+/g, " ");
  if (line === "show version-running") return fixture("show_version_running.txt");
  const m = line.match(/^show gpon onu (state|baseinfo) gpon-olt_(\d+)\/(\d+)\/(\d+)$/);
  if (m) {
    if (m[2] !== "1" || !["1", "2"].includes(m[3]!) || +m[4]! < 1 || +m[4]! > 16) return INVALID;
    if (m[3] === "1" && m[4] === "1") return fixture(m[1] === "state" ? "show_gpon_onu_state.txt" : "show_gpon_onu_baseinfo.txt");
    return fixture("show_gpon_onu_state_pon_vazia.txt");
  }
  // Modo de configuração da OLT simulada: aceita a sequência do tr069-mgmt, responde vazio (como a real) e guarda o
  // que foi gravado, para a releitura mostrar.
  if (line === "configure terminal" || line === "exit" || line === "tr069-mgmt 1 state unlock") {
    if (line === "exit") editing = null;
    return "";
  }
  const mng = line.match(/^pon-onu-mng gpon-onu_1\/([12]\/\d+:\d+)$/);
  if (mng) {
    editing = mng[1]!;
    return "";
  }
  if (/^tr069-mgmt 1 acs \S+ validate basic username \S+ password \S+$/.test(line)) {
    if (editing) simTr069.set(editing, line);
    return "";
  }
  // Detalhe da ONU: a saída real do fixture para qualquer ONU da PON 1/1/1.
  const det = line.match(/^show gpon onu detail-info gpon-onu_1\/1\/1:(\d+)$/);
  if (det) return fixture("show_gpon_onu_detail_info.txt").replace(/gpon-onu_1\/1\/1:1\b/, `gpon-onu_1/1/1:${det[1]}`);
  if (line === "write") return "Backuping old configuration into flash...\nCollecting configuration into memory.....\nWriting configuration into flash...[OK]";
  // Running config: ONUs pares com TR-069 configurado (fixture real), ímpares sem.
  const rc = line.match(/^show onu running config gpon-onu_1\/1\/1:(\d+)$/);
  if (rc && simTr069.has(`1/1:${rc[1]}`)) {
    const n = rc[1]!;
    return fixture("show_onu_running_config_sem_tr069.txt")
      .replace(/gpon-onu_1\/1\/16:\d+/g, `gpon-onu_1/1/1:${n}`).replace(/cliente\d+/g, `cliente${n}`)
      .replace("  security-mgmt", `  tr069-mgmt 1 state unlock\n  ${simTr069.get(`1/1:${n}`)}\n  security-mgmt`);
  }
  if (rc) {
    const n = rc[1]!;
    const base = fixture(+n % 2 === 0 ? "show_onu_running_config_com_tr069.txt" : "show_onu_running_config_sem_tr069.txt");
    return base.replace(/gpon-onu_1\/1\/16:\d+/g, `gpon-onu_1/1/1:${n}`).replace(/cliente\d+/g, `cliente${n}`);
  }
  return "%Error 20203: Incomplete command.";
}

export class SimulatedTransport implements Transport {
  private open = false;
  /** linhas executadas, na ordem (os testes conferem) */
  readonly history: string[] = [];
  async connect() {
    this.open = true;
  }
  async exec(line: string) {
    if (!this.open) throw new OltFailure("queda", "executar sem conexão");
    this.history.push(safeLine(line));
    return simulatedResponse(line);
  }
  name() {
    return this.open ? SIMULATED_NAME : "";
  }
  async close() {
    this.open = false;
  }
}
