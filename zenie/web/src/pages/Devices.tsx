import { ChevronLeft, ChevronRight, RefreshCw, Router, SearchX, Wifi } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, profileImage, timeAgo, type DeviceRow } from "../api";
import { HomologationBadge, OnlineBadge, RxBadge, WifiGenBadge } from "../components/status";
import { Alert, Badge, Button, Card, EmptyState, PageTitle } from "../components/ui";
import { useSession } from "../session";

interface Summary {
  total: number;
  online: number;
  late: number;
  offline: number;
  rxBad: number;
  rxWarn: number;
  onu: number;
  router: number;
  notHomologated: number;
  syncedAt: string | null;
}

const PAGE = 50;

/** Destaca o trecho buscado dentro do texto. */
function Mark({ text, q }: { text: string | null; q: string }) {
  if (!text) return <span className="text-muted">—</span>;
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-brand/15 px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function StatCard({ label, value, tone, active, onClick, children }: { label: string; value: number | string; tone?: string; active?: boolean; onClick?: () => void; children?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border bg-card p-4 text-left transition hover:border-brand/40 ${active ? "border-brand ring-2 ring-brand/15" : "border-line"}`}
    >
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      {children}
    </button>
  );
}

/** Miniatura do modelo (some sozinha se o perfil não tiver foto). */
function ModelThumb({ id }: { id: string | null }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-page text-muted">
      {id && ok ? <img src={profileImage(id)} alt="" className="h-full w-full object-contain" onError={() => setOk(false)} /> : <Router size={18} />}
    </div>
  );
}

const MATCH_LABEL: Record<string, string> = { pppoe: "PPPoE", ponSerial: "serial PON", serial: "serial", mac: "MAC", wanIp: "IP WAN", id: "ID" };

export function Devices() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? "";
  const rx = params.get("rx") ?? "";
  const homologated = params.get("homologated") ?? "";
  // Página na URL (?pagina=2): o "Voltar" do navegador volta para a mesma página depois de abrir uma ficha.
  const page = Math.max(1, Number(params.get("pagina")) || 1);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && params.get(key) !== value) next.set(key, value);
    else next.delete(key);
    next.delete("pagina"); // filtro novo = 1ª página
    setParams(next);
  };

  const goPage = (n: number) => {
    const next = new URLSearchParams(params);
    if (n > 1) next.set("pagina", String(n));
    else next.delete("pagina");
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const load = useCallback(
    async () => {
      setLoading(true);
      setError(null);
      const skip = (page - 1) * PAGE;
      try {
        const qs = new URLSearchParams({ limit: String(PAGE), skip: String(skip) });
        if (q) qs.set("q", q);
        if (status) qs.set("status", status);
        if (type) qs.set("type", type);
        if (rx) qs.set("rx", rx);
        if (homologated) qs.set("homologated", homologated);
        const [res, sum] = await Promise.all([
          api<{ total: number; items: DeviceRow[] }>(`/api/devices?${qs}`),
          skip ? Promise.resolve(null) : api<Summary>("/api/devices/summary"),
        ]);
        setRows(res.items);
        setTotal(res.total);
        if (sum) setSummary(sum);
      } catch (e) {
        setError(e instanceof Error ? e.message : "erro ao carregar dispositivos");
      } finally {
        setLoading(false);
      }
    },
    [q, status, type, rx, homologated, page],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api("/api/devices/sync", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = !!(q || status || type || rx || homologated);

  return (
    <>
      <PageTitle
        title="Dispositivos"
        subtitle={summary?.syncedAt ? `Índice atualizado ${timeAgo(summary.syncedAt)} · busque pelo login PPPoE, serial PON, serial, MAC ou IP` : "Busque pelo login PPPoE, serial PON, serial, MAC ou IP"}
        actions={
          can("device.refresh") && (
            <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Sincronizando..." : "Sincronizar agora"}
            </Button>
          )
        }
      />

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Equipamentos" value={summary.total} active={!status && !rx && !type && !homologated} onClick={() => setParams(q ? { q } : {})}>
            <div className="mt-1 text-xs text-muted">{summary.onu} ONU · {summary.router} roteador</div>
            {summary.notHomologated > 0 && (
              <div
                role="link"
                onClick={(e) => {
                  e.stopPropagation();
                  setFilter("homologated", "nao");
                }}
                className={`mt-1 text-xs hover:underline ${homologated === "nao" ? "font-semibold text-warn" : "text-warn"}`}
              >
                {summary.notHomologated} não homologado{summary.notHomologated === 1 ? "" : "s"}
              </div>
            )}
          </StatCard>
          <StatCard label="Online" value={summary.online} tone="text-ok" active={status === "online"} onClick={() => setFilter("status", "online")} />
          <StatCard label="Atrasados / offline" value={`${summary.late} / ${summary.offline}`} tone={summary.offline ? "text-bad" : ""} active={status === "offline"} onClick={() => setFilter("status", "offline")}>
            <div className="mt-1 text-xs text-muted">sem inform recente</div>
          </StatCard>
          <StatCard label="Sinal óptico ruim" value={summary.rxBad} tone={summary.rxBad ? "text-bad" : ""} active={rx === "bad"} onClick={() => setFilter("rx", "bad")}>
            <div className="mt-1 text-xs text-muted">{summary.rxWarn} em atenção</div>
          </StatCard>
        </div>
      )}

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      <Card
        title={
          <span>
            {filtered ? `${total} encontrado${total === 1 ? "" : "s"}` : `${total} equipamentos`}
            {q && <span className="font-normal text-muted"> para “{q}”</span>}
          </span>
        }
        actions={
          <div className="flex gap-1.5">
            {(["ONU", "Roteador"] as const).map((t) => (
              <button key={t} onClick={() => setFilter("type", t)} className={`rounded-full border px-2.5 py-1 text-xs ${type === t ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:text-ink"}`}>
                {t}
              </button>
            ))}
            <button onClick={() => setFilter("homologated", "nao")} className={`rounded-full border px-2.5 py-1 text-xs ${homologated === "nao" ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:text-ink"}`}>
              Não homologados
            </button>
          </div>
        }
      >
        {rows.length === 0 && !loading ? (
          <EmptyState icon={filtered ? <SearchX size={32} /> : <Router size={32} />} title={filtered ? "Nada encontrado" : "Nenhum equipamento ainda"}>
            {filtered
              ? "Confira o login PPPoE ou tente parte dele, o serial PON (ex.: ZTEG…) ou o MAC."
              : "Os equipamentos aparecem aqui depois do primeiro inform no GenieACS."}
          </EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Login PPPoE</th>
                  <th className="px-5 py-3 font-medium">Equipamento</th>
                  <th className="px-5 py-3 font-medium">Serial PON / serial</th>
                  <th className="px-5 py-3 font-medium">IP WAN</th>
                  <th className="px-5 py-3 font-medium">Sinal RX</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-page" onClick={() => navigate(`/dispositivos/${encodeURIComponent(d.id)}`)}>
                    <td className="whitespace-nowrap px-5 py-3">
                      <OnlineBadge state={d.status} />
                      <div className="mt-1 text-xs text-muted">{timeAgo(d.lastInform)}</div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium"><Mark text={d.pppoe} q={q} /></div>
                      {d.match && d.match.field !== "pppoe" && (
                        <div className="mt-0.5 text-xs text-muted">encontrado por {MATCH_LABEL[d.match.field] ?? d.match.field}{d.match.exact ? " (exato)" : ""}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <ModelThumb id={d.profileId} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.model ?? "—"}</span>
                            {d.accessType && <Badge tone={d.accessType === "ONU" ? "info" : "neutral"}>{d.accessType === "ONU" ? <><Wifi size={11} />ONU</> : "Roteador"}</Badge>}
                            <WifiGenBadge gen={d.wifiGeneration} />
                            {d.staleOf ? (
                              <span title="Registro antigo deste mesmo equipamento (mudou o modelo de dados TR-098/TR-181). Abra para ver o atual."><Badge>Registro antigo</Badge></span>
                            ) : !d.homologated && <HomologationBadge homologated={false} />}
                          </div>
                          <div className="text-xs text-muted">{d.vendor} · {d.firmware ?? "firmware ?"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">
                      <div><Mark text={d.ponSerial} q={q} /></div>
                      <div className="text-muted"><Mark text={d.serial} q={q} /></div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs"><Mark text={d.wanIp} q={q} /></td>
                    <td className="whitespace-nowrap px-5 py-3"><RxBadge rx={d.rx} level={d.rxLevel} accessType={d.accessType} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="-mx-5 -mb-5 mt-4 flex items-center justify-between border-t border-line px-5 py-3 text-sm">
            <span className="text-muted">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} de {total}</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => goPage(page - 1)} disabled={loading || page <= 1}><ChevronLeft size={16} />Anterior</Button>
              <span className="text-muted">página {page} de {Math.max(1, Math.ceil(total / PAGE))}</span>
              <Button variant="secondary" onClick={() => goPage(page + 1)} disabled={loading || page * PAGE >= total}>Próxima<ChevronRight size={16} /></Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
