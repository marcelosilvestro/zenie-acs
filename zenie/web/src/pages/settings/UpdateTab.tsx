// Configurações > Atualização: verifica no GitHub se há versão nova (canal do servidor) e atualiza pelo update.sh,
// rodado pelo agente do host. Durante a atualização o painel reinicia: a tela espera e reconecta sozinha.

import { CheckCircle2, CircleAlert, Download, GitCommitHorizontal, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, formatDateTime } from "../../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState } from "../../components/ui";

interface Ref { commit: string; version?: string; ref?: string; date: string; notes?: string | null }
interface Check {
  channel: "releases" | "main";
  current: Ref;
  target: Ref | null;
  available: boolean;
  changes: { commit: string; date: string; subject: string }[];
  dirty: boolean;
  checkedAt: number;
}
interface Status {
  running: boolean;
  exitCode: number | null;
  run: { startedAt: number; from: Ref; to: Ref; by: string; channel: string } | null;
  finishedAt: number | null;
  steps: string[];
  log: string[];
}

const CHANNEL = {
  releases: { label: "Versões publicadas", text: "Este servidor só atualiza para versões marcadas (vX.Y.Z), liberadas depois de testadas." },
  main: { label: "Desenvolvimento (main)", text: "Este servidor segue o ramo main: recebe tudo o que é publicado (servidor de testes)." },
} as const;

const when = (sec: number | null | undefined) => (sec ? formatDateTime(new Date(sec * 1000).toISOString()) : "—");

export function UpdateTab() {
  const [check, setCheck] = useState<Check | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false); // painel reiniciando durante a atualização
  const [busy, setBusy] = useState<"check" | "run" | null>(null);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api<Status>("/api/settings/update/status");
      setStatus(s);
      setOffline(false);
      return s;
    } catch (e) {
      // Sem resposta (502/rede) enquanto a atualização reinicia os containers: continua esperando.
      if (!(e instanceof ApiError) || e.status >= 500) setOffline(true);
      else setMsg({ tone: e.code === "no_hostd" ? "warn" : "bad", text: e.message });
      return null;
    }
  }, []);

  const loadCheck = useCallback(async (fetch: boolean) => {
    try {
      setCheck(await api<Check>(fetch ? "/api/settings/update/check" : "/api/settings/update", fetch ? { method: "POST" } : {}));
    } catch (e) {
      setMsg({ tone: e instanceof ApiError && e.code === "no_hostd" ? "warn" : "bad", text: e instanceof Error ? e.message : "erro ao verificar" });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadCheck(false);
  }, [loadStatus, loadCheck]);

  // Acompanha enquanto roda (ou enquanto o painel está fora do ar no meio da atualização).
  const watching = status?.running || offline;
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(async () => {
      const s = await loadStatus();
      if (s && !s.running) void loadCheck(false);
    }, 3000);
    return () => clearInterval(t);
  }, [watching, loadStatus, loadCheck]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log.length, showLog]);

  const verify = async () => {
    setBusy("check");
    setMsg(null);
    await loadCheck(true);
    setBusy(null);
  };

  const start = async () => {
    setAsk(false);
    setBusy("run");
    setMsg(null);
    try {
      setStatus(await api<Status>("/api/settings/update/run", { method: "POST" }));
      setShowLog(true);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao iniciar a atualização" });
    } finally {
      setBusy(null);
    }
  };

  const running = status?.running || offline;
  const finished = status && !status.running && status.run && status.exitCode !== null;
  const ch = check ? CHANNEL[check.channel] : null;

  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      {/* Em andamento / resultado da última atualização */}
      {(running || (finished && status?.run && status.run.startedAt > Date.now() / 1000 - 86400)) && status?.run && (
        <Card
          title={running ? "Atualizando o Zenie" : status.exitCode === 0 ? "Última atualização: concluída" : "Última atualização: falhou"}
          actions={running ? <Badge tone="warn">em andamento</Badge> : status.exitCode === 0 ? <Badge tone="ok">concluída</Badge> : <Badge tone="bad">falhou</Badge>}
        >
          <p className="mb-3 text-sm">
            De <b>{status.run.from.version ?? status.run.from.commit}</b> para <b>{status.run.to.ref ?? status.run.to.commit}</b>
            {" · "}iniciada {when(status.run.startedAt)}{status.run.by ? ` por ${status.run.by}` : ""}
            {status.finishedAt ? ` · terminou ${when(status.finishedAt)}` : ""}
          </p>
          {offline && (
            <div className="mb-3"><Alert tone="warn">O painel está reiniciando com a versão nova. Esta tela reconecta sozinha em instantes.</Alert></div>
          )}
          <ol className="mb-3 space-y-1 text-sm">
            {status.steps.map((st, i) => {
              const last = i === status.steps.length - 1;
              const icon = running && last ? <Loader2 size={15} className="animate-spin text-brand" /> : !running && last && status.exitCode !== 0 ? <CircleAlert size={15} className="text-bad" /> : <CheckCircle2 size={15} className="text-ok" />;
              return <li key={i} className="flex items-center gap-2">{icon}{st}</li>;
            })}
          </ol>
          {!running && status.exitCode === 0 && (
            <Alert tone="ok">Zenie atualizado. <button className="underline" onClick={() => window.location.reload()}>Recarregar a página</button> para usar a tela nova.</Alert>
          )}
          {!running && status.exitCode !== 0 && (
            <Alert tone="bad">
              A atualização parou na etapa marcada. O backup feito no início está em <code>/opt/zenie/backups</code>; veja o
              registro abaixo e, se precisar voltar, use <code>./restore.sh</code> no servidor.
            </Alert>
          )}
          <button className="mt-3 text-sm text-brand underline" onClick={() => setShowLog((v) => !v)}>{showLog ? "Esconder o registro" : "Ver o registro completo"}</button>
          {showLog && (
            <pre ref={logRef} className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{status.log.join("\n") || "(aguardando...)"}</pre>
          )}
        </Card>
      )}

      <Card
        title="Versão do Zenie"
        actions={
          <Button variant="secondary" onClick={() => void verify()} disabled={busy !== null || !!running}>
            <RefreshCw size={15} className={busy === "check" ? "animate-spin" : ""} />{busy === "check" ? "Verificando..." : "Verificar agora"}
          </Button>
        }
      >
        {!check ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted">Instalada</div>
                <div className="text-lg font-semibold">{check.current.version}</div>
                <div className="text-xs text-muted">{check.current.commit} · {formatDateTime(check.current.date)}</div>
              </div>
              <div>
                <div className="text-xs text-muted">{check.channel === "releases" ? "Versão publicada mais nova" : "Último commit do main"}</div>
                <div className="text-lg font-semibold">{check.target ? check.target.ref : "—"}</div>
                <div className="text-xs text-muted">{check.target ? `${check.target.commit} · ${formatDateTime(check.target.date)}` : check.channel === "releases" ? "nenhuma versão publicada ainda" : ""}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Canal</div>
                <div className="font-medium">{ch?.label}</div>
                <div className="text-xs text-muted">verificado {when(check.checkedAt)}</div>
              </div>
            </div>
            <p className="text-xs text-muted">{ch?.text}</p>

            {check.dirty && <Alert tone="warn">O código no servidor tem alterações locais (git status): a atualização pelo painel fica bloqueada até resolver.</Alert>}

            {check.available ? (
              <>
                <Alert tone="info">
                  <b>Atualização disponível:</b> {check.current.version} → {check.target?.ref} ({check.changes.length} {check.changes.length === 1 ? "mudança" : "mudanças"}).
                </Alert>
                {check.target?.notes && <pre className="whitespace-pre-wrap rounded-lg bg-page p-3 text-sm">{check.target.notes}</pre>}
                <ul className="max-h-72 space-y-1 overflow-auto text-sm">
                  {check.changes.map((c) => (
                    <li key={c.commit} className="flex gap-2">
                      <GitCommitHorizontal size={15} className="mt-0.5 shrink-0 text-muted" />
                      <span className="min-w-0"><span className="font-mono text-xs text-muted">{c.commit}</span> {c.subject} <span className="text-xs text-muted">· {formatDateTime(c.date)}</span></span>
                    </li>
                  ))}
                </ul>
                <Button onClick={() => setAsk(true)} disabled={busy !== null || !!running || check.dirty}>
                  <Download size={15} />Atualizar para {check.target?.ref}
                </Button>
              </>
            ) : (
              <EmptyState icon={<CheckCircle2 size={28} />} title="O Zenie está atualizado">
                {check.channel === "releases" && !check.target ? "Ainda não há versão publicada para este canal." : "Não há versão mais nova no canal deste servidor."}
              </EmptyState>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog open={ask} title={`Atualizar o Zenie para ${check?.target?.ref ?? ""}?`} confirmLabel="Atualizar agora" onCancel={() => setAsk(false)} onConfirm={() => void start()}>
        <ul className="list-disc space-y-1 pl-5">
          <li>Primeiro é feito um <b>backup completo</b> (banco e configuração).</li>
          <li>Depois o servidor baixa a versão nova, recompila e reinicia os serviços: o painel fica fora do ar por alguns minutos e o ACS pausa por instantes (os equipamentos repetem o inform).</li>
          <li>Provisions e parâmetros do ACS são aplicados respeitando a trava de release.</li>
          <li>No fim roda o diagnóstico. Esta tela acompanha tudo e reconecta sozinha.</li>
        </ul>
      </ConfirmDialog>
    </div>
  );
}
