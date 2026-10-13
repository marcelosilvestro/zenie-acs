// Adaptadores de rede unificada (contrato e particularidades em ../types.ts).

import type { UnifyAdapter } from "../types.js";

/** ZTE: Bandsteering. Regras validadas na F6201B de bancada (docs/PLANO.md 4.1). */
export const zteBandsteering: UnifyAdapter = {
  id: "zte-bandsteering",
  label: "Bandsteering (ZTE)",
  rules: { passwordOnUnify: true, separateNeeds: "ssid+password", mainWritesBoth: true },
  state: (w) => w.bandSteering,
  // Etapa própria: na mesma operação o VP de SSID ainda enxergaria o Bandsteering antigo.
  steps: (on) => [{ label: on ? "unificar redes" : "separar redes", values: [["VirtualParameters.WifiBandSteering", on, "xsd:boolean"]] }],
};

/** Genérico: mesmo nome e senha nas duas faixas, sem chave de unificação. A VALIDAR por modelo. */
export const sameSsid: UnifyAdapter = {
  id: "same-ssid",
  label: "Mesmo nome nas duas faixas",
  rules: { passwordOnUnify: true, separateNeeds: "ssid", mainWritesBoth: false },
  state: (w) => (w.ssid24 === null || w.ssid5 === null ? null : w.ssid24 === w.ssid5),
  steps: () => [],
};
