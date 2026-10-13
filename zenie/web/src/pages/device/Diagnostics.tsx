// Cards de diagnóstico executados pelo próprio equipamento (resultado real).

import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type DeviceDetail, type Level, type PingResult } from "../../api";
import { Alert, Badge, Button } from "../../components/ui";

/** Barra de uso (CPU/memória) com a cor da faixa. */
export function LoadBar({ label, value, level }: { label: string; value: number | null; level: Level | null }) {
  const color = level === "bad" ? "bg-bad" : level === "warn" ? "bg-warn" : "bg-ok";
  return (
    <div className="py-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium">{value === null ? <span className="font-normal text-muted">Não disponível</span> : `${value}%`}</span>
      </div>
      {value !== null && (
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Roda uma vez ao montar (StrictMode monta duas vezes em dev: o ref evita disparo duplo). */
function useRunOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Teste de conectividade (popup): começa sozinho ao abrir. */
export function PingPanel({ d, onBusy }: { d: DeviceDetail; onBusy?: (b: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PingResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    onBusy?.(true);
    setError(null);
    setResults(null);
    try {
      const res = await api<{ results: PingResult[] }>(`/api/devices/${encodeURIComponent(d.id)}/ping`, { method: "POST" });
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro no teste");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  useRunOnce(() => void run());

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Ping de 4 pacotes feito <b>pelo próprio equipamento</b> até o DNS do provedor, a internet e sites pelo nome (o nome é resolvido pelo DNS do equipamento: se falhar só nos nomes, o problema é de DNS).</p>
      {error && <Alert>{error}</Alert>}
      {busy && (
        <div className="flex items-center gap-3 rounded-xl bg-page p-4 text-sm">
          <RefreshCw size={18} className="animate-spin text-brand" />
          O equipamento está executando o teste (cerca de 30 segundos)...
        </div>
      )}
      {results && (
        <div className="divide-y divide-line rounded-xl border border-line">
          {results.map((r) => (
            <div key={r.target} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{r.target}</div>
                <div className="font-mono text-xs text-muted">{r.host ?? "—"}</div>
              </div>
              {r.ok ? (
                <div className="text-right">
                  <Badge tone={r.lossPct ? "warn" : "ok"}>OK · {r.avgMs ?? "?"} ms</Badge>
                  <div className="mt-0.5 text-xs text-muted">perda {r.lossPct}% · mín {r.minMs ?? "?"} / máx {r.maxMs ?? "?"} ms</div>
                </div>
              ) : (
                <div className="text-right">
                  <Badge tone="bad">Falhou</Badge>
                  <div className="mt-0.5 text-xs text-muted">{r.error ?? r.state}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!busy && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void run()}><RefreshCw size={16} />Testar novamente</Button>
        </div>
      )}
    </div>
  );
}

interface TrafficResult {
  ok: boolean;
  message?: string;
  intervalSec?: number;
  downloadMbps?: number | null;
  uploadMbps?: number | null;
}

/** Tráfego atual da WAN (popup): mede sozinho ao abrir. */
export function TrafficPanel({ d, onBusy }: { d: DeviceDetail; onBusy?: (b: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TrafficResult | null>(null);

  const run = async () => {
    setBusy(true);
    onBusy?.(true);
    setRes(null);
    try {
      setRes(await api<TrafficResult>(`/api/devices/${encodeURIComponent(d.id)}/traffic`, { method: "POST" }));
    } catch (e) {
      setRes({ ok: false, message: e instanceof Error ? e.message : "erro" });
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  useRunOnce(() => void run());

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Uso da internet do cliente neste momento: duas leituras do equipamento com ~5 s de intervalo.</p>
      {busy && (
        <div className="flex items-center gap-3 rounded-xl bg-page p-4 text-sm">
          <RefreshCw size={18} className="animate-spin text-brand" />
          Medindo (cerca de 8 segundos)...
        </div>
      )}
      {res && !res.ok && <Alert tone="warn">Não foi possível medir: {res.message}</Alert>}
      {res?.ok && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-page p-5">
              <div className="flex items-center gap-1.5 text-sm text-muted"><ArrowDown size={16} className="text-brand" />Download</div>
              <div className="mt-2 text-4xl font-semibold">{res.downloadMbps ?? "—"} <span className="text-base font-normal text-muted">Mbps</span></div>
            </div>
            <div className="rounded-xl bg-page p-5">
              <div className="flex items-center gap-1.5 text-sm text-muted"><ArrowUp size={16} className="text-[#7c3aed]" />Upload</div>
              <div className="mt-2 text-4xl font-semibold">{res.uploadMbps ?? "—"} <span className="text-base font-normal text-muted">Mbps</span></div>
            </div>
          </div>
          <p className="text-xs text-muted">Média em {res.intervalSec} s. O histórico em gráfico chega com o Prometheus.</p>
        </>
      )}
      {!busy && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void run()}><RefreshCw size={16} />Medir novamente</Button>
        </div>
      )}
    </div>
  );
}
