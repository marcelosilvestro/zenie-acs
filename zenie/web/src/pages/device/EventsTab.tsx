// Aba Eventos: linha do tempo do equipamento (eventos detectados pelo Zenie + ações do painel + falhas do ACS).

import { AlertTriangle, Cable, CheckCircle2, CircleAlert, History, Info, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, formatDuration, timeAgo, type DeviceEvent, type DeviceEvents, type EventLevel, type Incident } from "../../api";
import { Alert, Badge, Card, EmptyState, Input, Select } from "../../components/ui";
import { dayKey, DisconnectionsChart } from "./DisconnectionsChart";

const LEVEL_ICON: Record<EventLevel, ReactNode> = {
  ok: <CheckCircle2 size={16} className="text-ok" />,
  info: <Info size={16} className="text-brand" />,
  warn: <AlertTriangle size={16} className="text-[#b45309]" />,
  bad: <CircleAlert size={16} className="text-bad" />,
};

const SOURCE_LABEL = { zenie: "Zenie", noc: "Painel", acs: "ACS" } as const;

const FILTERS = [
  { key: "", label: "Todos os eventos" },
  { key: "problemas", label: "Só problemas" },
  { key: "zenie", label: "Detectados pelo Zenie" },
  { key: "noc", label: "Ações do painel" },
  { key: "olt", label: "Quedas na OLT" },
] as const;

const time = (v: string) => new Date(v).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const day = (v: string) => new Date(v).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/** Detalhes em texto curto (o que importa para o atendimento). */
function describe(e: DeviceEvent): string | null {
  const d = e.details ?? {};
  const parts: string[] = [];
  if (e.type.startsWith("wan.") && d.causa) parts.push(`causa: ${d.causa}`);
  if (d.usuario) parts.push(`por ${d.usuario}`);
  if (d.explicacao) parts.push(String(d.explicacao));
  if (d.de !== undefined && d.para !== undefined) parts.push(`${d.de} → ${d.para}`);
  if (typeof d.foraSegundos === "number") parts.push(e.type === "olt.down" ? `ficou ${formatDuration(d.foraSegundos)} fora` : `ficou ${formatDuration(d.foraSegundos)} sem contato`);
  if (d.posicao) parts.push(`ONU ${d.posicao}${d.olt ? ` na OLT ${d.olt}` : ""}${d.via === "login" ? " (pelo login PPPoE)" : ""}`);
  if (d.ultimoContato) parts.push(`último contato ${timeAgo(String(d.ultimoContato))}`);
  if (typeof d.rx === "number") parts.push(`RX ${d.rx.toFixed(2)} dBm${typeof d.antes === "number" ? ` (antes ${d.antes.toFixed(2)})` : ""}`);
  else if (d.antes !== undefined) parts.push(`antes: ${d.antes}`);
  if (d.ip) parts.push(`IP ${d.ip}`);
  if (d.status) parts.push(`status ${d.status}`);
  if (d.mensagem) parts.push(String(d.mensagem));
  if (d.erro) parts.push(String(d.erro));
  return parts.length ? parts.join(" · ") : null;
}

type Period = "7d" | "mes" | "30d" | "custom";
const PERIODS: { key: Period; label: string }[] = [
  { key: "7d", label: "7 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "30d", label: "30 dias" },
  { key: "custom", label: "Datas" },
];

interface OltHistory { position: string; olt: string; via: "sn" | "login"; phase: string | null; records: number; added: number; confirmedReboots: number; cached?: boolean }

export function EventsTab({ id, canRefresh }: { id: string; canRefresh: boolean }) {
  const [data, setData] = useState<DeviceEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [olt, setOlt] = useState<{ state: "oculto" | "lendo" | "ok" | "info" | "erro"; text?: string }>({ state: "oculto" });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [period, setPeriod] = useState<Period>("7d") // padrão pedido pelo atendimento: abre sempre em 7 dias;
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [dayFilter, setDayFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<DeviceEvents>(`/api/devices/${encodeURIComponent(id)}/events`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar eventos");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Ao abrir a aba: mostra os eventos já gravados e, em segundo plano, lê o histórico de quedas na OLT; se trouxer
  // novidade, recarrega. Para atualizar, basta clicar de novo na aba (o DeviceDetail remonta este componente).
  useEffect(() => {
    let alive = true;
    void load();
    if (!canRefresh) return;
    setOlt({ state: "lendo" });
    api<OltHistory>(`/api/devices/${encodeURIComponent(id)}/olt-history`, { method: "POST" })
      .then(async (r) => {
        if (!alive) return;
        setOlt({ state: "ok", text: `Quedas na OLT: ONU ${r.position} (${r.olt})${r.via === "login" ? ", pelo login PPPoE" : ""} · ${r.cached ? "lido há menos de 1 min" : "lido agora"}` });
        if (r.added || r.confirmedReboots) await load();
      })
      .catch((e) => {
        if (!alive) return;
        const code = e instanceof ApiError ? e.code : undefined;
        if (code === "no_olt") setOlt({ state: "oculto" });
        else if (code === "not_onu") setOlt({ state: "info", text: "Este equipamento não é uma ONU: não há histórico de quedas na OLT." });
        else if (code === "not_found") setOlt({ state: "info", text: "ONU não encontrada no inventário da OLT: sem histórico de quedas." });
        else setOlt({ state: "erro", text: `Não foi possível consultar a OLT agora${e instanceof Error ? ` (${e.message})` : ""}.` });
      });
    return () => {
      alive = false;
    };
  }, [id, canRefresh, load]);

  // Período (gráfico e lista): presets ou datas escolhidas, sempre dentro da retenção.
  const retention = data?.retentionDays ?? 30;
  const today = new Date();
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (retention - 1));
  const range = (() => {
    const clamp = (d: Date) => (d < oldest ? oldest : d);
    if (period === "7d") return { from: clamp(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)), to: endOfToday };
    if (period === "mes") return { from: clamp(new Date(today.getFullYear(), today.getMonth(), 1)), to: endOfToday };
    if (period === "custom" && custom.from && custom.to) {
      const [a, b] = [new Date(`${custom.from}T00:00:00`), new Date(`${custom.to}T23:59:59.999`)];
      return a <= b ? { from: clamp(a), to: b > endOfToday ? endOfToday : b } : { from: clamp(b), to: a };
    }
    return { from: oldest, to: endOfToday };
  })();
  const inRange = (v: string) => {
    const t = new Date(v);
    return t >= range.from && t <= range.to;
  };
  const incidents = (data?.incidents ?? []).filter((i) => inRange(i.start));
  // Queda em massa de cada evento da lista (pelo incidente de que ele faz parte).
  const massOf = new Map<number, NonNullable<Incident["mass"]>>();
  for (const inc of data?.incidents ?? []) if (inc.mass) for (const m of inc.members) massOf.set(m, inc.mass);

  const items = (data?.items ?? [])
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => inRange(e.ts) && (!dayFilter || dayKey(new Date(e.ts)) === dayFilter))
    .filter(({ e }) =>
      filter === "problemas" ? e.level === "bad" || e.level === "warn" : filter === "olt" ? e.type === "olt.down" : filter ? e.source === filter : true,
    );
  const days: [string, { e: DeviceEvent; idx: number }[]][] = [];
  for (const x of items) {
    const k = day(x.e.ts);
    if (days.at(-1)?.[0] === k) days.at(-1)![1].push(x);
    else days.push([k, [x]]);
  }

  return (
    <Card
      title="Eventos"
      actions={
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
          {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
      }
    >
      {error && <Alert>{error}</Alert>}
      {/* Período: vale para o gráfico e para a lista */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.key);
                setDayFilter(null);
              }}
              className={`rounded-md px-3 py-1 text-sm transition ${period === p.key ? "bg-brand text-white" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <Input type="date" className="w-auto py-1" min={dayKey(oldest)} max={dayKey(today)} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            até
            <Input type="date" className="w-auto py-1" min={dayKey(oldest)} max={dayKey(today)} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        <span className="text-xs text-muted">histórico guardado por {retention} dias</span>
      </div>
      {/* Situação da leitura da OLT: discreta, sem interromper o atendimento */}
      {olt.state !== "oculto" && (
        <div className={`mb-3 flex items-center gap-1.5 text-xs ${olt.state === "erro" ? "text-[#b45309]" : "text-muted"}`}>
          <Cable size={13} className={olt.state === "lendo" ? "animate-pulse" : ""} />
          {olt.state === "lendo" ? "Consultando as quedas na OLT…" : olt.text}
        </div>
      )}
      {loading && !data && <p className="mb-3 text-sm text-muted">Carregando eventos...</p>}
      {data && <DisconnectionsChart incidents={incidents} from={range.from} to={range.to} selected={dayFilter} onSelect={setDayFilter} />}
      {dayFilter && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span>Eventos de <b>{new Date(`${dayFilter}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</b></span>
          <button className="text-brand underline" onClick={() => setDayFilter(null)}>ver todos os dias</button>
        </div>
      )}
      {!error && data && !items.length && (
        <EmptyState icon={<History size={32} />} title="Nenhum evento no período">
          O Zenie registra reinícios (com a causa provável), quedas de contato e de internet (com a causa informada pelo
          equipamento), reconexões, mudanças de faixa do sinal óptico, firmware e login PPPoE, além das ações do painel.
        </EmptyState>
      )}
      <div className="space-y-5">
        {days.map(([label, list]) => (
          <div key={label}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <ol className="space-y-1.5">
              {list.map(({ e, idx }, i) => {
                const desc = describe(e);
                const mass = massOf.get(idx);
                return (
                  <li key={`${e.ts}-${e.type}-${i}`} className="flex gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{time(e.ts)}</span>
                    <span className="pt-0.5">{LEVEL_ICON[e.level]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{e.title}</div>
                      {desc && <div className="break-words text-xs text-muted">{desc}</div>}
                      {mass && (
                        <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-ink">
                          <Users size={12} />
                          Queda em massa: mais {mass.pon} {mass.pon === 1 ? "cliente" : "clientes"} da PON {mass.position} no mesmo horário
                          {mass.olt > mass.pon ? ` (${mass.olt} na OLT)` : ""} — provável problema de rede/energia, não do cliente
                        </div>
                      )}
                    </div>
                    <span className="shrink-0">
                      <Badge tone={e.source === "zenie" ? "neutral" : "info"}>{e.source === "noc" && e.username ? e.username : e.type === "olt.down" ? "OLT" : SOURCE_LABEL[e.source]}</Badge>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        Sinal óptico e status da internet são lidos a cada 15 min; reconexões curtas aparecem pela leitura horária do
        tempo de conexão, com o horário em que a conexão voltou. O horário dos demais é o da detecção (reinício: hora do
        boot). A causa do reinício é deduzida: nenhum equipamento informa o motivo.
      </p>
    </Card>
  );
}

/** Resumo: problemas detectados nas últimas 24 h, com atalho para a aba Eventos. */
export function RecentEvents({ id, onTab }: { id: string; onTab: (t: string) => void }) {
  const [items, setItems] = useState<DeviceEvent[]>([]);
  useEffect(() => {
    let alive = true;
    api<DeviceEvents>(`/api/devices/${encodeURIComponent(id)}/events?days=1&limit=50`)
      .then((r) => alive && setItems(r.items.filter((e) => e.source !== "noc" && (e.level === "bad" || e.level === "warn"))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  if (!items.length) return null;
  const shown = items.slice(0, 3);
  return (
    <Alert tone="warn">
      <span className="font-medium">Últimas 24 h:</span>{" "}
      {shown.map((e) => `${e.title} ${timeAgo(e.ts)}`).join(" · ")}
      {items.length > shown.length && ` · e mais ${items.length - shown.length}`}{" "}
      <button className="underline" onClick={() => onTab("eventos")}>ver eventos</button>
    </Alert>
  );
}
