// Indicadores reutilizáveis: status online/offline e sinal óptico classificado pela faixa do NOC.

import type { Level, OnlineState } from "../api";
import { Badge } from "./ui";

const STATE: Record<OnlineState, { label: string; dot: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  online: { label: "Online", dot: "bg-ok", tone: "ok" },
  late: { label: "Atrasado", dot: "bg-warn", tone: "warn" },
  offline: { label: "Offline", dot: "bg-bad", tone: "bad" },
  unknown: { label: "Sem inform", dot: "bg-slate-400", tone: "neutral" },
};

export function OnlineBadge({ state }: { state: OnlineState }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </Badge>
  );
}

const LEVEL_TONE: Record<Level, "ok" | "warn" | "bad"> = { ok: "ok", warn: "warn", bad: "bad" };
const LEVEL_LABEL: Record<Level, string> = { ok: "Bom", warn: "Atenção", bad: "Ruim" };

/** RX em dBm com a cor da faixa (o rótulo Bom/Atenção/Ruim fica só no tooltip); roteador (sem PON) explica de onde viria o sinal. */
export function RxBadge({ rx, level, accessType }: { rx: number | null; level: Level | null; accessType: string | null }) {
  if (rx === null || level === null) {
    return accessType === "Roteador" ? (
      <span className="text-xs text-muted" title="Roteador atrás de ONU bridge: o sinal óptico só pode ser visto na OLT">sem PON</span>
    ) : (
      <span className="text-xs text-muted">não disponível</span>
    );
  }
  return (
    <span title={LEVEL_LABEL[level]}>
      <Badge tone={LEVEL_TONE[level]}>{rx.toFixed(2)} dBm</Badge>
    </span>
  );
}

/** Etiqueta "Wi-Fi N": 6 e 7 em azul (atuais), 5 neutro, 4 ou menor em amarelo (antigo, limita velocidade). */
export function WifiGenBadge({ gen }: { gen: number | string | null | undefined }) {
  const n = Number(gen);
  if (!n) return null;
  const tone = n >= 6 ? "info" : n === 5 ? "neutral" : "warn";
  const title = n <= 4 ? "Padrão antigo: limita a velocidade do Wi-Fi" : undefined;
  return <span title={title}><Badge tone={tone}>Wi-Fi {n}</Badge></span>;
}

/** Selo do catálogo: modelo homologado ou não (não homologado = só leitura). */
export function HomologationBadge({ homologated, name, progress }: { homologated: boolean; name?: string | null; progress?: { complete: boolean; resolved: number; total: number; pending: string[] } }) {
  if (homologated && progress && !progress.complete) {
    return (
      <span title={`${name ?? "Modelo"} em homologação (${progress.resolved}/${progress.total}). Falta validar: ${progress.pending.join(", ")}. O que falta validar fica bloqueado para alteração.`}>
        <Badge tone="info">Em homologação {progress.resolved}/{progress.total}</Badge>
      </span>
    );
  }
  return homologated ? (
    <span title={name ? `Modelo homologado: ${name}` : "Modelo homologado"}><Badge tone="ok">Homologado</Badge></span>
  ) : (
    <span title="Modelo fora do catálogo: dados só para leitura, alterações bloqueadas"><Badge tone="warn">Não homologado</Badge></span>
  );
}
