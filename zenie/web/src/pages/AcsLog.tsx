// Log do ACS (NOC/admin): por que um equipamento não está 100% — senha recusada, comandos recusados, falhas de
// configuração automática, sessões interrompidas. Resumo do log do GenieACS, agrupado e em português.

import { AlertTriangle, CheckCircle2, CircleAlert, Info, RefreshCw, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, formatDateTime, timeAgo } from "../api";
import { Alert, Badge, Button, Card, EmptyState, Input, PageTitle, Select } from "../components/ui";

type Level = "ok" | "info" | "warn" | "bad";
interface Item {
  id: string;
  kind: string;
  level: Level;
  title: string;
  help: string;
  detail: string | null;
  first: string;
  last: string;
  count: number;
  ip: string | null;
  device: { id: string; known: boolean; pppoe: string | null; model: string | null; serial: string | null } | null;
}
interface LogData {
  hours: number;
  reader: null | "no_hostd" | "erro";
  readAt: string | null;
  informs: { sessions: number; devices: number };
  summary: { kind: string; level: Level; title: string; count: number; devices: number }[];
  items: Item[];
}

const ICON: Record<Level, ReactNode> = {
  ok: <CheckCircle2 size={16} className="text-ok" />,
  info: <Info size={16} className="text-brand" />,
  warn: <AlertTriangle size={16} className="text-[#b45309]" />,
  bad: <CircleAlert size={16} className="text-bad" />,
};
const TONE: Record<Level, "ok" | "info" | "warn" | "bad"> = { ok: "ok", info: "info", warn: "warn", bad: "bad" };
const PERIODS = [
  { h: 1, label: "1 hora" },
  { h: 24, label: "24 horas" },
  { h: 72, label: "3 dias" },
  { h: 168, label: "7 dias" },
];

export function AcsLog() {
  const [data, setData] = useState<LogData | null>(null);
  const [hours, setHours] = useState(24);
  const [kind, setKind] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ hours: String(hours) });
      if (kind) qs.set("kind", kind);
      if (level) qs.set("level", level);
      if (query) qs.set("q", query);
      setData(await api<LogData>(`/api/acs-log?${qs}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar o log");
    } finally {
      setLoading(false);
    }
  }, [hours, kind, level, query]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const problems = data?.summary.filter((s) => s.level === "bad" || s.level === "warn") ?? [];

  return (
    <>
      <PageTitle title="Log do ACS" subtitle="Por que um equipamento não está 100%: senha recusada, comandos e configurações com falha, sessões interrompidas" />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {data?.reader === "no_hostd" && (
        <div className="mb-4"><Alert tone="warn">O agente do servidor (zenie-hostd) não está ativo: o log não está sendo lido. Rode ./update.sh no servidor.</Alert></div>
      )}

      {/* Resumo do período */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="text-xs text-muted">Sessões bem-sucedidas</div>
          <div className="text-2xl font-semibold">{data?.informs.sessions ?? "—"}</div>
          <div className="text-xs text-muted">{data ? `${data.informs.devices} equipamentos falaram com o ACS` : ""}</div>
        </div>
        {problems.slice(0, 3).map((s) => (
          <button
            key={s.kind}
            onClick={() => setKind(kind === s.kind ? "" : s.kind)}
            className={`rounded-xl border bg-card p-4 text-left transition hover:border-brand ${kind === s.kind ? "border-brand" : "border-line"}`}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted">{ICON[s.level]}{s.title}</div>
            <div className="text-2xl font-semibold">{s.count}</div>
            <div className="text-xs text-muted">{s.devices} {s.devices === 1 ? "equipamento" : "equipamentos"} · clique para filtrar</div>
          </button>
        ))}
        {data && !problems.length && (
          <div className="rounded-xl border border-line bg-card p-4 sm:col-span-1 xl:col-span-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ok"><CheckCircle2 size={16} />Nenhum problema no período</div>
            <div className="text-xs text-muted">Nenhuma senha recusada, falha de comando ou de configuração registrada.</div>
          </div>
        )}
      </div>

      <Card
        title="Ocorrências"
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {PERIODS.map((p) => (
              <button key={p.h} onClick={() => setHours(p.h)} className={`rounded-md px-3 py-1 text-sm transition ${hours === p.h ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{p.label}</button>
            ))}
          </div>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
            <option value="">Todos os tipos</option>
            {data?.summary.map((s) => <option key={s.kind} value={s.kind}>{s.title} ({s.count})</option>)}
          </Select>
          <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
            <option value="">Toda gravidade</option>
            <option value="bad">Só graves</option>
            <option value="warn">Só atenção</option>
          </Select>
          <Input className="w-64" placeholder="Login PPPoE, serial ou IP" value={q} onChange={(e) => setQ(e.target.value)} />
          {data?.readAt && <span className="text-xs text-muted">lido {timeAgo(data.readAt)}</span>}
        </div>

        {data && !data.items.length ? (
          <EmptyState icon={<ScrollText size={32} />} title="Nada registrado com esses filtros">
            O log guarda 7 dias. Sessões bem-sucedidas só aparecem no contador acima.
          </EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {data?.items.map((it) => {
              const d = it.device;
              const who = d ? (d.known ? d.pppoe || d.serial || d.id : d.serial || d.id) : it.ip ?? "—";
              const expanded = open === it.id;
              return (
                <li key={it.id} className="rounded-lg border border-line">
                  <button className="flex w-full items-start gap-3 px-3 py-2 text-left" onClick={() => setOpen(expanded ? null : it.id)}>
                    <span className="w-24 shrink-0 pt-0.5 text-xs tabular-nums text-muted">{formatDateTime(it.last).slice(0, 17)}</span>
                    <span className="pt-0.5">{ICON[it.level]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {it.title}
                        {it.count > 1 && <span className="ml-2 text-xs font-normal text-muted">{it.count}× {it.count > 1 ? `desde ${formatDateTime(it.first).slice(11, 17)}` : ""}</span>}
                      </div>
                      <div className="break-words text-xs text-muted">
                        {d?.known ? (
                          <Link className="text-brand underline" to={`/dispositivos/${encodeURIComponent(d.id)}`} onClick={(e) => e.stopPropagation()}>{who}</Link>
                        ) : (
                          <span>{who}</span>
                        )}
                        {d?.model ? ` · ${d.model}` : ""}
                        {it.ip ? ` · IP ${it.ip}` : ""}
                        {it.detail ? ` · ${it.detail}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0">
                      {d && !d.known ? <Badge tone="warn">fora de Dispositivos</Badge> : <Badge tone={TONE[it.level]}>{it.level === "bad" ? "grave" : it.level === "warn" ? "atenção" : it.level === "ok" ? "ok" : "info"}</Badge>}
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-line bg-page px-3 py-2 text-sm">
                      <p>{it.help}</p>
                      {d && <p className="mt-1 font-mono text-xs text-muted">id no ACS: {d.id}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
