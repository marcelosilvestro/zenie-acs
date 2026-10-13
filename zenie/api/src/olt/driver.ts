// Contrato de um driver de OLT e registro dos drivers (porte de Driver.php/Registro.php do addon zte_onu).
//
// Cada driver DECLARA o que sabe fazer (manifesto). O Zenie nunca chama um recurso que o manifesto não marca
// como disponível — e é o manifesto que a tela "Drivers e compatibilidade" mostra.
//   validado      comandos e saídas conferidos na OLT real da versão testada
//   experimental  implementado a partir de saída real, ainda não exercitado de ponta a ponta
//   indisponivel  não implementado — o Zenie recusa usar

import { OltFailure, type Transport } from "./transport.js";
import { commands, TEMPLATES } from "./zte-c320-v21/commands.js";
import { baseInfo, onuDetail, onuTr069, ponState, requireNoError, versionRunning, type OnuBase, type OnuDetail, type OnuTr069, type PonState, type VersionInfo } from "./zte-c320-v21/parser.js";

export type Level = "validado" | "experimental" | "indisponivel";

export interface Manifest {
  id: string;
  name: string;
  vendor: string;
  models: string[];
  testedVersions: string[];
  features: Record<string, Level>;
  commands: Record<string, string>;
  limitations: string[];
  prerequisites: string[];
}

export interface OltDriver {
  identify(): Promise<VersionInfo & { identifier: string }>;
  ponState(slot: number, pon: number): Promise<PonState>;
  ponBaseInfo(slot: number, pon: number): Promise<Map<number, OnuBase>>;
  onuTr069(slot: number, pon: number, onu: number, expectedPassword?: string | null): Promise<OnuTr069>;
  /** Estado e histórico de quedas da ONU (somente leitura). */
  onuDetail(slot: number, pon: number, onu: number): Promise<OnuDetail>;
  /** Grava a configuração da OLT na flash (write). Lança OltFailure se a OLT não confirmar "[OK]". */
  saveConfig(): Promise<void>;
  /** Grava o tr069-mgmt da ONU (ALTERA a OLT). Lança OltFailure no 1º erro; nunca devolve texto com a senha. */
  activateTr069(slot: number, pon: number, onu: number, url: string, username: string, password: string): Promise<void>;
}

export const ZTE_C320_V21: Manifest = {
  id: "zte_c320_v21",
  name: "ZTE C320 (MVR V2.1.x)",
  vendor: "ZTE",
  models: ["C320"],
  testedVersions: ["V2.1.0"],
  features: {
    identificar: "validado",
    inventario: "validado",
    leitura_tr069: "validado",
    // Validado pelo Zenie em 08/10/2026 na C320 real (teste_ztev9, bancada): gravado, conferido, BOOTSTRAP
    // autenticado e connection request ok em 14 s.
    ativar_tr069: "validado",
    // Validado pelo Zenie em 08/10/2026 na C320 real (2 gravações com [OK], depois do 1º lote).
    salvar_configuracao: "validado",
    // Histórico de quedas da ONU (detail-info: Authpass/OfflineTime/Cause). Formato da saída real (fixture), mesma
    // leitura do app mobile do MK-Auth. Validado na OLT real em 13/10/2026: causas DyingGasp e LOSi,
    // buffer circular, horário corrigido pelo Online Duration.
    historico_quedas: "validado",
  },
  commands: { ...TEMPLATES },
  limitations: [
    "Acesso somente por telnet. Login conferido na OLT de referência (01/10/2026).",
    "PON sem ONUs (vazia ou desativada) responde \"%Code 62310-GPONSRV : No related information to show.\": entra no inventário com 0 ONUs.",
    "Configuração TR-069 das ONUs lida por \"show onu running config\" (um comando por ONU). A saída traz senhas de PPPoE: o Zenie extrai só as linhas tr069-mgmt e não guarda o texto.",
    "ONU Furukawa em modo bridge (SN FRKW, perfil HBR) recusa o tr069-mgmt: \"%Code 63865-GPONRM : Execute error in NP.\" (visto em 08/10/2026). O Zenie para no erro e marca falha, sem deixar nada pela metade.",
    "O inventário confere a contagem de linhas com o total que a OLT informa: se não bater (paginação/corte), a leitura falha em vez de ficar incompleta.",
    "Histórico de quedas: a C320 guarda as 10 últimas autenticações da ONU num buffer circular (a ordem das linhas não é a do tempo; posições não usadas vêm zeradas — visto em 13/10/2026), com o horário do relógio da OLT (sem fuso). O Zenie corrige pelo \"Online Duration\" quando a ONU está online.",
  ],
  prerequisites: [
    "Usuário da OLT com acesso ao modo privilegiado (#), direto ou por senha de enable.",
    "Acesso telnet liberado do servidor do Zenie até a OLT.",
  ],
};

class ZteC320V21Driver implements OltDriver {
  constructor(private readonly t: Transport) {}
  async identify() {
    return { ...versionRunning(await this.t.exec(commands.version())), identifier: this.t.name() };
  }
  async ponState(slot: number, pon: number) {
    return ponState(await this.t.exec(commands.ponState(1, slot, pon)));
  }
  async ponBaseInfo(slot: number, pon: number) {
    return baseInfo(await this.t.exec(commands.ponBaseInfo(1, slot, pon)));
  }
  async onuTr069(slot: number, pon: number, onu: number, expectedPassword?: string | null) {
    return onuTr069(await this.t.exec(commands.onuRunningConfig(1, slot, pon, onu)), expectedPassword);
  }
  async onuDetail(slot: number, pon: number, onu: number) {
    return onuDetail(await this.t.exec(commands.onuDetail(1, slot, pon, onu)));
  }
  async saveConfig() {
    const out = await this.t.exec(commands.save());
    requireNoError(out);
    if (!/Writing configuration into flash\.*\s*\[OK\]/i.test(out)) throw new OltFailure("formato", "a OLT não confirmou a gravação na flash ([OK])");
  }
  async activateTr069(slot: number, pon: number, onu: number, url: string, username: string, password: string) {
    const lines = commands.tr069Activate(1, slot, pon, onu, url, username, password);
    let depth = 0; // quantos modos de configuração foram abertos (para sair deles se algo falhar)
    try {
      for (const [i, line] of lines.entries()) {
        const out = await this.t.exec(line);
        requireNoError(out); // "%Error ..." -> OltFailure("comando") com a linha do erro (não o comando)
        if (i < 2) depth++;
        else if (line === "exit") depth--;
      }
    } catch (e) {
      for (; depth > 0; depth--) await this.t.exec("exit").catch(() => undefined);
      throw e;
    }
  }
}

const DRIVERS: { manifest: Manifest; create: (t: Transport) => OltDriver }[] = [
  { manifest: ZTE_C320_V21, create: (t) => new ZteC320V21Driver(t) },
];

export const manifests = (): Manifest[] => DRIVERS.map((d) => d.manifest);

/** Modelos para o seletor do cadastro. */
export const models = () => DRIVERS.flatMap((d) => d.manifest.models.map((model) => ({ vendor: d.manifest.vendor, model, driver: d.manifest.name, driverId: d.manifest.id })));

export function driverFor(vendor: string, model: string) {
  return DRIVERS.find((d) => d.manifest.vendor.toLowerCase() === vendor.toLowerCase() && d.manifest.models.some((m) => m.toUpperCase() === model.toUpperCase())) ?? null;
}

/**
 * validada        modelo do driver + versão detectada entre as testadas
 * somente_leitura modelo do driver, versão não testada (ou placas com versões diferentes)
 * nao_suportada   sem driver
 */
export function compatibility(manifest: Manifest | null, detected: string): "validada" | "somente_leitura" | "nao_suportada" {
  if (!manifest) return "nao_suportada";
  return manifest.testedVersions.includes(detected) ? "validada" : "somente_leitura";
}
