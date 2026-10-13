// Desconexões por dia (aba Eventos): barras empilhadas pela causa, com marca de queda em massa.
// Cores da paleta categórica validada (dataviz). Energia = amarelo, como no app mobile do provedor; a ordem de
// empilhamento (energia, internet, fibra, equipamento) deixa amarelo e laranja separados — validada sem falhas.
// A identidade também está na legenda e no tooltip (nunca só na cor); a lista logo abaixo é a "tabela" do gráfico.

import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Incident, IncidentCategory } from "../../api";

export const CATEGORIES: { key: IncidentCategory; label: string; color: string }[] = [
  { key: "energia", label: "Energia", color: "#eda100" },
  { key: "internet", label: "Internet (WAN)", color: "#4a3aa7" },
  { key: "fibra", label: "Fibra (sinal óptico)", color: "#eb6834" },
  { key: "equipamento", label: "Equipamento", color: "#2a78d6" },
];

/** "AAAA-MM-DD" no fuso do navegador. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Day {
  key: string;
  date: Date;
  counts: Record<IncidentCategory, number>;
  total: number;
  mass: Incident["mass"][];
}

function buildDays(incidents: Incident[], from: Date, to: Date): Day[] {
  const days: Day[] = [];
  const byKey = new Map<string, Day>();
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const day: Day = { key: dayKey(d), date: d, counts: { energia: 0, fibra: 0, internet: 0, equipamento: 0 }, total: 0, mass: [] };
    days.push(day);
    byKey.set(day.key, day);
  }
  for (const inc of incidents) {
    const day = byKey.get(dayKey(new Date(inc.start)));
    if (!day) continue;
    day.counts[inc.category]++;
    day.total++;
    if (inc.mass) day.mass.push(inc.mass);
  }
  return days;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const H = 150; // área das barras
const AXIS_W = 28;
const PAD_R = 8; // respiro à direita da última barra
const LABEL_H = 22;
const TOP = 18; // espaço para a marca de queda em massa

export function DisconnectionsChart({ incidents, from, to, selected, onSelect }: { incidents: Incident[]; from: Date; to: Date; selected: string | null; onSelect: (day: string | null) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = buildDays(incidents, from, to);
  // Eixo em inteiros: até 5 mostra todos; acima, topo arredondado para um número par e o meio.
  const peak = Math.max(1, ...days.map((d) => d.total));
  const max = peak <= 5 ? peak : Math.ceil(peak / 2) * 2;
  const ticks = max <= 5 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, max / 2, max];
  const plotW = Math.max(0, width - AXIS_W - PAD_R);
  const step = days.length ? plotW / days.length : 0;
  const barW = Math.max(3, Math.min(28, step * 0.62));
  const y = (v: number) => TOP + H - (v / max) * H;
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 44)));
  const totals = CATEGORIES.map((c) => ({ ...c, n: days.reduce((s, d) => s + d.counts[c.key], 0) }));
  const total = totals.reduce((s, c) => s + c.n, 0);
  const massDays = days.filter((d) => d.mass.length).length;
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="mb-5 rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-sm font-semibold">
          Desconexões por dia <span className="font-normal text-muted">· {total} no período</span>
        </div>
        {/* Legenda com os totais (identidade nunca só pela cor) */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {totals.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
              {c.label} <b className="font-semibold text-ink">{c.n}</b>
            </span>
          ))}
          {massDays > 0 && (
            <span className="inline-flex items-center gap-1"><Users size={12} className="text-ink" />queda em massa</span>
          )}
        </div>
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={TOP + H + LABEL_H} role="img" aria-label={`Desconexões por dia: ${total} no período`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={AXIS_W} x2={width - PAD_R} y1={y(t)} y2={y(t)} stroke="#e5eaf0" strokeWidth={1} />
                <text x={AXIS_W - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{t}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = AXIS_W + i * step + (step - barW) / 2;
              let acc = 0;
              const segs = CATEGORIES.filter((c) => d.counts[c.key] > 0).map((c) => {
                const y0 = y(acc);
                acc += d.counts[c.key];
                return { c, top: y(acc), bottom: y0 };
              });
              const dim = selected !== null && selected !== d.key;
              return (
                <g key={d.key} opacity={dim ? 0.35 : 1}>
                  {segs.map((s, j) => {
                    const last = j === segs.length - 1;
                    const hgt = Math.max(0, s.bottom - s.top - (j > 0 ? 2 : 0)); // 2px de respiro entre segmentos
                    return last ? (
                      <path key={s.c.key} fill={s.c.color} d={roundedTop(x, s.top, barW, hgt, Math.min(4, barW / 2, hgt))} />
                    ) : (
                      <rect key={s.c.key} x={x} y={s.top} width={barW} height={hgt} fill={s.c.color} />
                    );
                  })}
                  {d.mass.length > 0 && (
                    <g transform={`translate(${x + barW / 2 - 6}, ${y(d.total) - 15})`}>
                      <Users size={12} color="#172033" />
                    </g>
                  )}
                  {/* Rótulos contados a partir do último dia (hoje sempre rotulado) */}
                  {(days.length - 1 - i) % labelEvery === 0 && (
                    <text x={x + barW / 2} y={TOP + H + 15} textAnchor="middle" fontSize={11} fill={selected === d.key ? "#172033" : "#64748b"} fontWeight={selected === d.key ? 600 : 400}>
                      {d.date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </text>
                  )}
                  {/* Alvo de hover/clique: a coluna inteira, maior que a barra */}
                  <rect
                    x={AXIS_W + i * step}
                    y={0}
                    width={step}
                    height={TOP + H + LABEL_H}
                    fill="transparent"
                    className={d.total ? "cursor-pointer" : ""}
                    onMouseEnter={() => setHover(d.total ? i : null)}
                    onClick={() => d.total && onSelect(selected === d.key ? null : d.key)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(0, AXIS_W + hover * step + step / 2 - 112), Math.max(0, width - 224)), top: 0 }}
          >
            <div className="mb-1 font-semibold">
              {h.date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} · {h.total} {h.total === 1 ? "desconexão" : "desconexões"}
            </div>
            {CATEGORIES.filter((c) => h.counts[c.key]).map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-muted"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.label}</span>
                <b>{h.counts[c.key]}</b>
              </div>
            ))}
            {h.mass.map((m, k) => m && (
              <div key={k} className="mt-1 flex items-start gap-1.5 text-ink"><Users size={12} className="mt-0.5 shrink-0" />Queda em massa: mais {m.pon} na PON {m.position}{m.olt > m.pon ? `, ${m.olt} na OLT` : ""}</div>
            ))}
            {h.total > 0 && <div className="mt-1 text-muted">{selected === h.key ? "clique para ver todos os dias" : "clique para ver os eventos do dia"}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Retângulo com só os cantos de cima arredondados (a ponta de dados; a base fica reta, ancorada no zero). */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  r = Math.max(0, Math.min(r, h));
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
