// Aba "ONUs" da página OLTs (O2, docs/OLT.md): ONUs de cada PON lidas da OLT, a situação do TR-069 configurado
// pela OLT (OMCI) e o cruzamento com os equipamentos do Zenie (SN GPON = PonSerial).

import { ChevronLeft, ChevronRight, HardDriveDownload, Layers, RefreshCw, Router, Search, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, formatDateTime, timeAgo } from "../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Select } from "../components/ui";

type Tr069Status = "ok" | "onu" | "senha" | "divergente" | "bloqueado" | "nao" | "desconhecido";
interface OnuRow {
  id: string; position: string; slot: number; pon: number; onu: number; sn: string | null; vendor: string | null; type: string | null;
  phase: string; online: boolean; absentSince: string | null;
  tr069: { configured: boolean; state: string | null; acsUrl: string | null; username: string | null; validate: string | null; readAt: string } | null;
  tr069Error: string | null; tr069Status: Tr069Status;
  zenie: { id: string; pppoe: string | null; model: string | null; lastInform: string | null; state: "online" | "late" | "offline" | "unknown" } | null;
  job: { state: JobState; createdAt: string; by: string; error: string | null; crOk: boolean | null; last: string | null } | null;
}
type JobState = "enviando" | "aguardando_acs" | "concluido" | "falha" | "nao_chegou";
const JOB: Record<JobState, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  enviando: { label: "enviando à OLT…", tone: "warn" },
  aguardando_acs: { label: "aguardando o ACS…", tone: "warn" },
  concluido: { label: "chegou ao ACS", tone: "ok" },
  falha: { label: "falhou", tone: "bad" },
  nao_chegou: { label: "não chegou ao ACS", tone: "bad" },
};
const inProgress = (j: OnuRow["job"]) => j?.state === "enviando" || j?.state === "aguardando_acs";
interface Job { running: boolean; startedAt: string; finishedAt: string | null; by: string; step: string; ponsTotal: number; ponsDone: number; onusRead: number; error: string | null }
interface OnusRes {
  counters: { total: number; online: number; tr069Ok: number; tr069Missing: number; inZenie: number; absent: number };
  items: OnuRow[]; total: number; page: number; pages: number; pageSize: number; pons: string[];
  batch: Batch | null; batchMax: number; save: { savedAt: string | null; savedBy: string | null; unsaved: number }; expected: { url: string | null; username: string | null }; inventoryAt: string | null; job: Job | null;
}
interface Batch { running: boolean; by: string; startedAt: string; finishedAt: string | null; total: number; done: number; failed: number; skipped: { position: string; reason: string }[]; current: string | null }
interface OltLite { id: string; name: string; active: boolean; compatibility: string; detected: unknown }

const TR069: Record<Tr069Status, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  ok: { label: "configurado", tone: "ok" },
  onu: { label: "configurado na ONU", tone: "ok" },
  senha: { label: "senha a regravar", tone: "warn" },
  divergente: { label: "outra URL/usuário", tone: "warn" },
  bloqueado: { label: "bloqueado (lock)", tone: "bad" },
  nao: { label: "sem TR-069", tone: "bad" },
  desconhecido: { label: "não lido", tone: "neutral" },
};
const ZSTATE = { online: { label: "online", tone: "ok" }, late: { label: "atrasado", tone: "warn" }, offline: { label: "offline", tone: "bad" }, unknown: { label: "?", tone: "neutral" } } as const;

function Counter({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-xl border bg-card px-4 py-3 text-left transition hover:border-brand/50 ${active ? "border-brand ring-2 ring-brand/20" : "border-line"}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </button>
  );
}

const PICK_KEY = "zenie.olt.onus.olt";

export function OltOnus({ olts, canManage, canTr069 }: { olts: OltLite[]; canManage: boolean; canTr069: boolean }) {
  const usable = olts.filter((o) => o.active);
  const [oltId, setOltId] = useState<string>(() => {
    try {
      return localStorage.getItem(PICK_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const current = usable.find((o) => o.id === oltId) ?? usable[0] ?? null;
  const [f, setF] = useState({ pon: "", phase: "", vendor: "", tr069: "", zenie: "", q: "", absent: "" });
  const [page, setPage] = useState(1);
  // Filtro novo = volta à 1ª página.
  useEffect(() => setPage(1), [f, oltId]);
  const [data, setData] = useState<OnusRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: OnuRow; experimental: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  // Lote: seleção (vale entre páginas), confirmação digitando a quantidade.
  const [selected, setSelected] = useState<Map<string, OnuRow>>(new Map());
  const [batchDlg, setBatchDlg] = useState<{ typed: string; experimental: boolean } | null>(null);
  const [saveDlg, setSaveDlg] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    const qs = new URLSearchParams([...(Object.entries(f).filter(([, v]) => v) as [string, string][]), ["page", String(page)]]).toString();
    try {
      setData(await api<OnusRes>(`/api/olts/${current.id}/onus?${qs}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar");
    }
  }, [current, f, page]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), f.q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [load, f.q]);

  // Acompanha a leitura em andamento e os envios de TR-069 em curso.
  const busyJobs = !!data?.items.some((r) => inProgress(r.job)) || !!data?.batch?.running;
  useEffect(() => {
    if (!data?.job?.running && !busyJobs) return;
    const t = window.setInterval(() => void load(), data?.job?.running ? 2000 : 4000);
    return () => window.clearInterval(t);
  }, [data?.job?.running, busyJobs, load]);
  // Trocar de OLT limpa a seleção.
  useEffect(() => setSelected(new Map()), [oltId]);

  // ONU que já fala com o ACS (configurada pela OLT ou na própria ONU, ex.: preset do provisionamento) não precisa
  // do envio: regravar só provocaria um novo primeiro contato à toa (decisão do usuário, 08/10/2026).
  const needsSend = (r: OnuRow) => !r.absentSince && r.tr069Status !== "ok" && r.tr069Status !== "onu" && !inProgress(r.job);
  const selectable = needsSend;
  const max = data?.batchMax ?? 10;
  const toggle = (r: OnuRow) => {
    const next = new Map(selected);
    if (next.has(r.id)) next.delete(r.id);
    else if (next.size < max) next.set(r.id, r);
    setSelected(next);
  };
  const pageSelectable = data?.items.filter(selectable) ?? [];
  const allPage = pageSelectable.length > 0 && pageSelectable.every((r) => selected.has(r.id));
  const togglePage = () => {
    const next = new Map(selected);
    if (allPage) pageSelectable.forEach((r) => next.delete(r.id));
    else for (const r of pageSelectable) if (next.size < max) next.set(r.id, r);
    setSelected(next);
  };
  const selRows = [...selected.values()];
  const needsExperimental = selRows.some((r) => r.vendor !== "ZTEG");

  const sendBatch = async () => {
    if (!current || !batchDlg) return;
    setSending(true);
    try {
      await api(`/api/olts/${current.id}/tr069/batch`, { body: { onuIds: selRows.map((r) => r.id), confirmCount: Number(batchDlg.typed), allowExperimental: batchDlg.experimental } });
      setBatchDlg(null);
      setSelected(new Map());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao enviar o lote");
      setBatchDlg(null);
    } finally {
      setSending(false);
    }
  };

  const saveConfig = async () => {
    if (!current) return;
    setSending(true);
    try {
      await api(`/api/olts/${current.id}/save`, { method: "POST" });
      setSaveDlg(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao salvar");
      setSaveDlg(false);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!confirm || !current) return;
    setSending(true);
    try {
      await api(`/api/olts/${current.id}/onus/${encodeURIComponent(confirm.row.id)}/tr069`, { body: { allowExperimental: confirm.experimental } });
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao enviar");
      setConfirm(null);
    } finally {
      setSending(false);
    }
  };

  const pick = (id: string) => {
    setOltId(id);
    setData(null);
    setF({ pon: "", phase: "", vendor: "", tr069: "", zenie: "", q: "", absent: "" });
    try {
      localStorage.setItem(PICK_KEY, id);
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  };

  const readNow = async () => {
    if (!current) return;
    try {
      await api(`/api/olts/${current.id}/inventory`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao iniciar a leitura");
    }
  };

  if (!usable.length) return <EmptyState icon={<Router size={28} />} title="Nenhuma OLT ativa">Cadastre e teste uma OLT na aba Cadastro.</EmptyState>;
  const job = data?.job;
  const c = data?.counters;
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: f[k] === v ? "" : v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={current?.id ?? ""} onChange={(e) => pick(e.target.value)} className="w-auto">
          {usable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        {canManage && (
          <Button onClick={() => void readNow()} disabled={!!job?.running || !current?.detected}>
            <RefreshCw size={16} className={job?.running ? "animate-spin" : ""} />{job?.running ? "Lendo da OLT..." : "Ler da OLT"}
          </Button>
        )}
        <span className="text-sm text-muted">
          {data?.inventoryAt ? <>Última leitura: {formatDateTime(data.inventoryAt)} ({timeAgo(data.inventoryAt)})</> : "Ainda não lida"}
        </span>
        {canTr069 && data && (
          <div className="ml-auto flex items-center gap-3">
            <span className={`text-xs ${data.save.unsaved ? "text-[#b45309]" : "text-muted"}`}>
              {data.save.unsaved ? `${data.save.unsaved} envio(s) ainda não salvo(s) na flash da OLT` : data.save.savedAt ? `Salva em ${formatDateTime(data.save.savedAt)} por ${data.save.savedBy}` : "Nada pendente de salvar"}
            </span>
            <Button variant="secondary" onClick={() => setSaveDlg(true)} disabled={!data.save.unsaved || !!data.batch?.running || !!job?.running} title={job?.running ? "aguarde a leitura das PONs terminar" : undefined}><HardDriveDownload size={16} />Salvar configuração da OLT</Button>
          </div>
        )}
      </div>
      {!current?.detected && <Alert tone="warn">Faça o teste de acesso desta OLT (aba Cadastro) antes de ler as ONUs: as placas ainda não foram identificadas.</Alert>}
      {job?.running && (
        <Alert tone="info">
          Lendo da OLT ({job.step}): {job.ponsDone} de {job.ponsTotal || "?"} PON(s), {job.onusRead} ONU(s) lidas. A leitura só consulta; nada é alterado na OLT.
        </Alert>
      )}
      {job && !job.running && job.error && <Alert>A última leitura falhou: {job.error}</Alert>}
      {error && <Alert>{error}</Alert>}
      {data && (
        <p className="text-xs text-muted">
          TR-069 esperado nas ONUs: URL <code className="font-mono">{data.expected.url ?? "não definida (ZENIE_ACS_URL)"}</code>, usuário <code className="font-mono">{data.expected.username ?? "sem credencial ativa (Segurança do ACS)"}</code>.
        </p>
      )}

      {data?.batch && (data.batch.running || data.batch.finishedAt) && (
        <Alert tone={data.batch.running ? "info" : data.batch.failed || data.batch.skipped.length ? "warn" : "ok"}>
          {data.batch.running
            ? <>Lote em andamento ({data.batch.by}): {data.batch.done} de {data.batch.total}{data.batch.current ? `, enviando ${data.batch.current}` : ""}. Cada ONU aparece na lista com o andamento.</>
            : <>Lote concluído: {data.batch.total} ONU(s), {data.batch.failed} falha(s){data.batch.skipped.length ? `, ${data.batch.skipped.length} pulada(s): ${data.batch.skipped.map((x) => `${x.position} (${x.reason})`).join("; ")}` : ""}. A chegada ao ACS segue sendo acompanhada em cada linha.</>}
        </Alert>
      )}

      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Counter label="ONUs" value={c.total} active={!f.phase && !f.tr069 && !f.zenie && !f.absent} onClick={() => setF({ ...f, phase: "", tr069: "", zenie: "", absent: "" })} />
          <Counter label="Online na OLT" value={c.online} active={f.phase === "online"} onClick={() => set("phase", "online")} />
          <Counter label="TR-069 ativo" value={c.tr069Ok} active={f.tr069 === "ativo"} onClick={() => set("tr069", "ativo")} />
          <Counter label="Sem TR-069 / divergente" value={c.tr069Missing} active={f.tr069 === "pendente"} onClick={() => set("tr069", "pendente")} />
          <Counter label="No Zenie" value={c.inZenie} active={f.zenie === "sim"} onClick={() => set("zenie", "sim")} />
          <Counter label="Sumiram da OLT" value={c.absent} active={f.absent === "1"} onClick={() => set("absent", "1")} />
        </div>
      )}

      {canTr069 && selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-card px-4 py-3 shadow-sm">
          <Layers size={18} className="text-brand" />
          <span className="text-sm"><b>{selected.size}</b> ONU(s) selecionada(s) <span className="text-muted">(máximo {max} por lote)</span></span>
          <Button onClick={() => setBatchDlg({ typed: "", experimental: false })} disabled={!!data?.batch?.running}><Zap size={15} />Ativar TR-069 em {selected.size}</Button>
          <Button variant="secondary" onClick={() => setSelected(new Map())}>Limpar seleção</Button>
        </div>
      )}

      <Card>
        <div className="-mt-1 mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="SN, login PPPoE ou posição (1/16:20)" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
          <Select className="w-auto" value={f.pon} onChange={(e) => setF({ ...f, pon: e.target.value })}>
            <option value="">Todas as PONs</option>
            {data?.pons.map((p) => <option key={p} value={p}>PON {p}</option>)}
          </Select>
          <Select className="w-auto" value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })}>
            <option value="">Online e offline</option><option value="online">Online</option><option value="offline">Offline</option>
          </Select>
          <Select className="w-auto" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })}>
            <option value="">Todos os fabricantes</option><option value="ZTEG">ZTE</option><option value="outros">Outros</option>
          </Select>
          <Select className="w-auto" value={f.tr069} onChange={(e) => setF({ ...f, tr069: e.target.value })}>
            <option value="">TR-069: todas</option>
            <option value="ativo">Ativo (pela OLT ou na ONU)</option>
            <option value="ok">Configurado pela OLT</option>
            <option value="onu">Configurado na ONU</option>
            <option value="pendente">Pendente (sem, divergente, senha ou lock)</option>
            <option value="nao">Sem TR-069</option>
            <option value="senha">Senha a regravar</option>
            <option value="divergente">Outra URL/usuário</option>
            <option value="bloqueado">Bloqueado (lock)</option>
            <option value="desconhecido">Não lido</option>
          </Select>
          <Select className="w-auto" value={f.zenie} onChange={(e) => setF({ ...f, zenie: e.target.value })}>
            <option value="">No Zenie: todas</option><option value="sim">No Zenie</option><option value="nao">Fora do Zenie</option>
          </Select>
        </div>

        {!data ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<Router size={28} />} title={data.inventoryAt ? "Nenhuma ONU com esses filtros" : "Ainda não há ONUs lidas"}>
            {!data.inventoryAt && canManage && "Clique em \"Ler da OLT\" para listar as ONUs."}
          </EmptyState>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  {canTr069 && (
                    <th className="w-10 pl-5 pr-0 py-3">
                      <input type="checkbox" aria-label="selecionar as pendentes desta página" checked={allPage} onChange={togglePage} disabled={!pageSelectable.length} />
                    </th>
                  )}
                  <th className="px-5 py-3 font-medium">Posição</th>
                  <th className="px-5 py-3 font-medium">SN</th>
                  <th className="px-5 py-3 font-medium">Na OLT</th>
                  <th className="px-5 py-3 font-medium">TR-069 na OLT</th>
                  <th className="px-5 py-3 font-medium">No Zenie</th>
                  {canTr069 && <th className="px-5 py-3 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? "bg-brand/5" : ""}>
                    {canTr069 && (
                      <td className="w-10 pl-5 pr-0 py-2.5">
                        {selectable(r) && <input type="checkbox" aria-label={`selecionar ${r.position}`} checked={selected.has(r.id)} onChange={() => toggle(r)} disabled={!selected.has(r.id) && selected.size >= max} />}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs">{r.position}</td>
                    <td className="px-5 py-2.5">
                      <span className="font-mono text-xs">{r.sn ?? "—"}</span>
                      <span className="block text-xs text-muted">{r.vendor === "ZTEG" ? "ZTE" : r.vendor ?? "?"}{r.type ? ` · perfil ${r.type}` : ""}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      {r.absentSince ? <Badge tone="neutral">sumiu {timeAgo(r.absentSince)}</Badge> : <Badge tone={r.online ? "ok" : "bad"}>{r.phase}</Badge>}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge tone={TR069[r.tr069Status].tone}>{TR069[r.tr069Status].label}</Badge>
                      {r.tr069?.configured && <span className="block font-mono text-xs text-muted">{r.tr069.acsUrl} · {r.tr069.username ?? "sem usuário"}</span>}
                      {r.tr069Status === "senha" && <span className="block text-xs text-muted">a senha na OLT não confere ou não pôde ser conferida (gravada fora do Zenie) e a ONU não chega ao ACS</span>}
                      {r.tr069Status === "onu" && <span className="block text-xs text-muted">{r.tr069?.configured ? "a OLT tem outra configuração; " : "sem TR-069 na OLT; "}a ONU fala com o ACS</span>}
                      {r.tr069Error && <span className="block text-xs text-bad">{r.tr069Error}</span>}
                      {r.job && (
                        <span className="mt-1 block text-xs">
                          <Badge tone={JOB[r.job.state].tone}>{JOB[r.job.state].label}</Badge>
                          {r.job.state === "concluido" && r.job.crOk === false && <span className="text-[#b45309]"> · connection request falhou</span>}
                          <span className="block text-muted">{r.job.last} · {r.job.by} {timeAgo(r.job.createdAt)}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      {r.zenie ? (
                        <Link to={`/dispositivos/${encodeURIComponent(r.zenie.id)}`} className="hover:underline">
                          <span className="font-medium">{r.zenie.pppoe ?? "sem login"}</span> <Badge tone={ZSTATE[r.zenie.state].tone}>{ZSTATE[r.zenie.state].label}</Badge>
                          <span className="block text-xs text-muted">{r.zenie.model} · inform {timeAgo(r.zenie.lastInform)}</span>
                        </Link>
                      ) : <span className="text-muted">fora do Zenie</span>}
                    </td>
                    {canTr069 && (
                      <td className="whitespace-nowrap px-5 py-2.5 text-right">
                        {needsSend(r) && (
                          <Button variant="secondary" onClick={() => setConfirm({ row: r, experimental: false })} disabled={!data.expected.url || !data.expected.username}>
                            <Zap size={15} />Ativar TR-069
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
              <span className="text-muted">{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} de {data.total}</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setPage(data.page - 1)} disabled={data.page <= 1}><ChevronLeft size={16} />Anterior</Button>
                <span className="text-muted">página {data.page} de {data.pages}</span>
                <Button variant="secondary" onClick={() => setPage(data.page + 1)} disabled={data.page >= data.pages}>Próxima<ChevronRight size={16} /></Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!batchDlg} title={`Ativar o TR-069 em ${selected.size} ONU(s)?`} confirmLabel="Enviar lote à OLT"
        busy={sending}
        confirmDisabled={!batchDlg || Number(batchDlg.typed) !== selected.size || (needsExperimental && !batchDlg.experimental)}
        onCancel={() => setBatchDlg(null)} onConfirm={() => void sendBatch()}>
        {batchDlg && data && (
          <div className="space-y-3 text-sm">
            <p>O Zenie envia o <code className="font-mono">tr069-mgmt</code> (URL <code className="font-mono">{data.expected.url}</code>, usuário <code className="font-mono">{data.expected.username}</code>) a uma ONU de cada vez, na OLT <b>{current?.name}</b>:</p>
            <div className="max-h-40 overflow-y-auto rounded-lg bg-page p-3 font-mono text-xs leading-relaxed">
              {selRows.map((r) => <div key={r.id}>{r.position} · {r.sn ?? "sem SN"}{r.zenie?.pppoe ? ` · ${r.zenie.pppoe}` : ""} · {TR069[r.tr069Status].label}</div>)}
            </div>
            <p className="text-muted">Cada ONU faz um novo primeiro contato com o ACS; a chegada é acompanhada em cada linha. Depois, use "Salvar configuração da OLT" para gravar na flash.</p>
            {needsExperimental && (
              <label className="flex items-start gap-2 rounded-lg bg-warn/10 p-3">
                <input type="checkbox" className="mt-0.5" checked={batchDlg.experimental} onChange={(e) => setBatchDlg({ ...batchDlg, experimental: e.target.checked })} />
                <span>Há ONU(s) de outro fabricante na seleção: o TR-069 pela OLT não foi validado nelas. Enviar mesmo assim (experimental).</span>
              </label>
            )}
            <p>Digite <b>{selected.size}</b> para confirmar:</p>
            <Input value={batchDlg.typed} onChange={(e) => setBatchDlg({ ...batchDlg, typed: e.target.value })} inputMode="numeric" autoFocus />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog open={saveDlg} title="Salvar a configuração da OLT na flash?" confirmLabel="Salvar (write)" busy={sending} confirmDisabled={!!job?.running}
        onCancel={() => setSaveDlg(false)} onConfirm={() => void saveConfig()}>
        {job?.running && <p className="mb-2 text-sm font-medium text-[#b45309]">A leitura das PONs está em andamento: aguarde terminar para salvar.</p>}
        <p className="text-sm">O Zenie executa <code className="font-mono">write</code> na OLT <b>{current?.name}</b>: grava na flash toda a configuração em execução, inclusive os {data?.save.unsaved ?? 0} envio(s) de TR-069 ainda não salvos. Sem isso, um reinício da OLT desfaz esses envios. Leva alguns segundos.</p>
      </ConfirmDialog>

      <ConfirmDialog open={!!confirm} title="Ativar o TR-069 nesta ONU?" confirmLabel="Enviar à OLT"
        busy={sending}
        confirmDisabled={!!confirm && confirm.row.vendor !== "ZTEG" && !confirm.experimental}
        onCancel={() => setConfirm(null)} onConfirm={() => void send()}>
        {confirm && data && (
          <div className="space-y-3 text-sm">
            <p>ONU <b className="font-mono">{confirm.row.position}</b> ({confirm.row.sn ?? "sem SN"}{confirm.row.zenie?.pppoe ? ` · ${confirm.row.zenie.pppoe}` : ""}) na OLT <b>{current?.name}</b>. Comandos que o Zenie vai mandar:</p>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-page p-3 font-mono text-xs leading-relaxed">{[
              "configure terminal",
              `pon-onu-mng gpon-onu_1/${confirm.row.position}`,
              "  tr069-mgmt 1 state unlock",
              `  tr069-mgmt 1 acs ${data.expected.url} validate basic username ${data.expected.username} password ********`,
              "exit",
              "exit",
            ].join("\n")}</pre>
            <p className="text-muted">A ONU recebe a configuração pela OLT (OMCI) e faz um novo primeiro contato com o ACS. O Zenie relê a configuração na OLT e acompanha a chegada ao ACS por até 15 minutos. Não é salvo na memória permanente da OLT (write).</p>
            {confirm.row.vendor !== "ZTEG" && (
              <label className="flex items-start gap-2 rounded-lg bg-warn/10 p-3">
                <input type="checkbox" className="mt-0.5" checked={confirm.experimental} onChange={(e) => setConfirm({ ...confirm, experimental: e.target.checked })} />
                <span>ONU de outro fabricante ({confirm.row.vendor ?? "?"}): o TR-069 pela OLT não foi validado nela. Enviar mesmo assim (experimental).</span>
              </label>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
