// OLTs (docs/OLT.md): cadastro, teste de acesso (só leitura) e drivers/compatibilidade — no formato do addon
// zte_onu, para qualquer provedor cadastrar a própria OLT.

import { Cpu, MoreHorizontal, Network, Plug, Plus, Server } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { OltOnus } from "./OltOnus";
import { api, formatDateTime } from "../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, PageTitle, Select, Textarea } from "../components/ui";
import { useSession } from "../session";

type Result = "ok" | "aviso" | "erro";
interface Step { key: string; title: string; result: Result; detail: string; ms: number }
interface Board { local: string; slot: number; type: string; versions: Record<string, string> }
interface TestRes { at: string; result: Result; code: string; by: string; summary: string; steps: Step[] }
interface Olt {
  id: string; name: string; vendor: string; model: string; protocol: string; host: string; port: number; username: string;
  hasPassword: boolean; hasEnable: boolean; connectTimeoutSec: number; commandTimeoutSec: number; note: string; active: boolean; rev: number;
  compatibility: "desconhecida" | "validada" | "somente_leitura" | "nao_suportada";
  detected: { identifier: string; version: string; boards: Board[] } | null; lastTest: TestRes | null; blockedUntil: string | null;
}
interface Manifest { id: string; name: string; vendor: string; models: string[]; testedVersions: string[]; features: Record<string, string>; commands: Record<string, string>; limitations: string[]; prerequisites: string[] }
interface Drivers { models: { vendor: string; model: string; driver: string; driverId: string }[]; protocols: { id: string; label: string; available: boolean; port: number }[]; manifests: Manifest[] }

const COMPAT: Record<Olt["compatibility"], { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  validada: { label: "VALIDADA", tone: "ok" },
  somente_leitura: { label: "SOMENTE LEITURA", tone: "warn" },
  nao_suportada: { label: "NÃO SUPORTADA", tone: "bad" },
  desconhecida: { label: "NÃO TESTADA", tone: "neutral" },
};
const RESULT_TONE: Record<Result, "ok" | "warn" | "bad"> = { ok: "ok", aviso: "warn", erro: "bad" };
const RESULT_LABEL: Record<Result, string> = { ok: "OK", aviso: "AVISO", erro: "ERRO" };
const LEVEL_TONE: Record<string, "ok" | "warn" | "neutral"> = { validado: "ok", experimental: "warn", indisponivel: "neutral" };
const FEATURE_LABEL: Record<string, string> = {
  identificar: "Identificar a OLT (versão e placas)",
  inventario: "Inventário de ONUs por PON",
  leitura_tr069: "Ler a configuração TR-069 das ONUs",
  ativar_tr069: "Ativar TR-069 nas ONUs",
  salvar_configuracao: "Salvar a configuração da OLT (write)",
};

interface Form {
  id: string | null; rev?: number; name: string; modelKey: string; protocol: string; port: string; host: string;
  username: string; password: string; enablePassword: string; clearEnable: boolean; connectTimeoutSec: string; commandTimeoutSec: string; note: string;
}
const emptyForm = (d: Drivers | null): Form => ({
  id: null, name: "", modelKey: d?.models[0] ? `${d.models[0].vendor}|${d.models[0].model}` : "ZTE|C320", protocol: "telnet", port: "23", host: "",
  username: "", password: "", enablePassword: "", clearEnable: false, connectTimeoutSec: "10", commandTimeoutSec: "30", note: "",
});

export function Olts() {
  const { can } = useSession();
  const manage = can("olt.manage");
  const [rows, setRows] = useState<Olt[] | null>(null);
  const [drivers, setDrivers] = useState<Drivers | null>(null);
  const [secretsReady, setSecretsReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testView, setTestView] = useState<{ olt: Olt; res: TestRes & { compatibility?: string; detected?: Olt["detected"] } } | null>(null);
  const [showDrivers, setShowDrivers] = useState(false);
  // Menu "mais ações": fica numa camada fixa (posição do botão), para não ser cortado pela rolagem da tabela.
  const [menu, setMenu] = useState<{ olt: Olt; top: number; right: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const [removing, setRemoving] = useState<{ olt: Olt; typed: string } | null>(null);
  const [params, setParams] = useSearchParams();
  // Abre sempre na aba ONUs (decisão do usuário, 08/10/2026); Cadastro por ?aba=cadastro.
  const tab = params.get("aba") === "cadastro" ? "cadastro" : "onus";

  const load = useCallback(async () => {
    try {
      const [o, d] = await Promise.all([api<{ olts: Olt[]; secretsReady: boolean }>("/api/olts"), api<Drivers>("/api/olts/drivers")]);
      setRows(o.olts);
      setSecretsReady(o.secretsReady);
      setDrivers(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const edit = (o: Olt) =>
    setForm({
      id: o.id, rev: o.rev, name: o.name, modelKey: `${o.vendor}|${o.model}`, protocol: o.protocol, port: String(o.port), host: o.protocol === "simulado" ? "" : o.host,
      username: o.protocol === "simulado" ? "" : o.username, password: "", enablePassword: "", clearEnable: false,
      connectTimeoutSec: String(o.connectTimeoutSec), commandTimeoutSec: String(o.commandTimeoutSec), note: o.note,
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    const [vendor, model] = form.modelKey.split("|");
    const body = {
      name: form.name, vendor, model, protocol: form.protocol, host: form.host, port: form.port, username: form.username,
      ...(form.password ? { password: form.password } : {}), ...(form.enablePassword ? { enablePassword: form.enablePassword } : {}),
      clearEnable: form.clearEnable, connectTimeoutSec: form.connectTimeoutSec, commandTimeoutSec: form.commandTimeoutSec, note: form.note,
      ...(form.rev ? { rev: form.rev } : {}),
    };
    try {
      await api(form.id ? `/api/olts/${form.id}` : "/api/olts", { method: form.id ? "PUT" : "POST", body });
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (o: Olt) => {
    setTesting(o.id);
    setError(null);
    try {
      const res = await api<TestRes & { compatibility: string; detected: Olt["detected"] }>(`/api/olts/${o.id}/test`, { method: "POST" });
      setTestView({ olt: o, res });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro no teste");
    } finally {
      setTesting(null);
    }
  };

  const simulated = form?.protocol === "simulado";
  const manifestOf = (o: Olt) => drivers?.manifests.find((m) => m.vendor === o.vendor && m.models.includes(o.model)) ?? null;

  return (
    <div className="space-y-5">
      <PageTitle title="OLTs" subtitle="Cadastro e acesso às OLTs, para ativar o TR-069 nas ONUs" />
      <div className="flex gap-1 border-b border-line">
        {([["onus", "ONUs"], ["cadastro", "Cadastro"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setParams(k === "onus" ? {} : { aba: k }, { replace: true })}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${tab === k ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "onus" && rows && <OltOnus olts={rows} canManage={manage} canTr069={can("olt.tr069")} />}
      {tab === "cadastro" && <>
      <Alert tone="info">
        O teste de acesso só <b>lê</b> a OLT: faz login e consulta a versão e as placas (<code className="font-mono">show version-running</code>). Nenhuma configuração é alterada. Para conhecer a tela sem equipamento, cadastre uma OLT com o protocolo <b>Simulada</b>.
      </Alert>
      {!secretsReady && <Alert>A chave de cifra (ZENIE_SECRET_KEY) não está configurada no servidor: rode ./update.sh antes de cadastrar OLTs.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card
        title={<span className="flex items-center gap-2"><Server size={16} />OLTs cadastradas <Badge>{rows?.length ?? 0}</Badge></span>}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowDrivers(true)}><Cpu size={16} />Drivers e compatibilidade</Button>
            {manage && <Button onClick={() => { setFormError(null); setForm(emptyForm(drivers)); }} disabled={!secretsReady}><Plus size={16} />Nova OLT</Button>}
          </div>
        }
      >
        {rows === null ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Network size={28} />} title="Nenhuma OLT cadastrada">Cadastre a OLT para listar as ONUs e ativar o TR-069 nelas.</EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">Acesso</th>
                  <th className="px-5 py-3 font-medium">Versão</th>
                  <th className="px-5 py-3 font-medium">Compatibilidade</th>
                  <th className="px-5 py-3 font-medium">Último teste</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => (
                  <tr key={o.id} className={o.active ? "" : "opacity-60"}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-muted">{o.detected?.identifier ?? `${o.vendor} ${o.model}`}{!o.active && " · desativada"}</div>
                    </td>
                    <td className="px-5 py-3">{o.protocol === "simulado" ? <span className="text-muted">simulada</span> : <><span className="font-mono text-xs">{o.host}:{o.port}</span> <span className="text-xs text-muted">{o.protocol}</span></>}</td>
                    <td className="px-5 py-3">{o.detected?.version ?? "—"}</td>
                    <td className="px-5 py-3"><Badge tone={COMPAT[o.compatibility].tone}>{COMPAT[o.compatibility].label}</Badge></td>
                    <td className="px-5 py-3">
                      {o.lastTest ? (
                        <button className="text-left" onClick={() => setTestView({ olt: o, res: { ...o.lastTest!, detected: o.detected } })}>
                          <Badge tone={RESULT_TONE[o.lastTest.result]}>{RESULT_LABEL[o.lastTest.result]}</Badge>
                          <span className="block text-xs text-muted">{formatDateTime(o.lastTest.at)}</span>
                        </button>
                      ) : <span className="text-muted">—</span>}
                      {o.blockedUntil && <span className="block text-xs text-bad">bloqueada até {formatDateTime(o.blockedUntil)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      {manage && (
                        <>
                          <Button onClick={() => void runTest(o)} disabled={!!testing || !o.active}><Plug size={15} />{testing === o.id ? "Testando..." : "Testar"}</Button>
                          <Button variant="secondary" className="ml-2" aria-label="mais ações" aria-haspopup="menu" aria-expanded={menu?.olt.id === o.id}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setMenu(menu?.olt.id === o.id ? null : { olt: o, top: r.bottom + 4, right: window.innerWidth - r.right });
                            }}>
                            <MoreHorizontal size={16} />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>}

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div role="menu" className="fixed z-50 w-44 overflow-hidden rounded-xl border border-line bg-card py-1 text-left shadow-lg" style={{ top: menu.top, right: menu.right }}>
            <button role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-page" onClick={() => { const o = menu.olt; setMenu(null); setFormError(null); edit(o); }}>Editar</button>
            <button role="menuitem" className="block w-full px-4 py-2 text-left text-sm hover:bg-page" onClick={() => { const o = menu.olt; setMenu(null); void api(`/api/olts/${o.id}/active`, { body: { active: !o.active } }).then(load, (e) => setError(e.message)); }}>{menu.olt.active ? "Desativar" : "Ativar"}</button>
            <button role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-bad hover:bg-page" onClick={() => { const o = menu.olt; setMenu(null); setRemoving({ olt: o, typed: "" }); }}>Remover</button>
          </div>
        </>
      )}

      {/* Cadastro / edição */}
      <Modal open={!!form} title={form?.id ? "Editar OLT" : "Nova OLT"} onClose={() => setForm(null)} busy={saving} size="lg">
        {form && (
          <form onSubmit={submit} className="space-y-4">
            {formError && <Alert>{formError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required autoFocus /></Field>
              <Field label="Modelo">
                <Select value={form.modelKey} onChange={(e) => setForm({ ...form, modelKey: e.target.value })}>
                  {drivers?.models.map((m) => <option key={`${m.vendor}|${m.model}`} value={`${m.vendor}|${m.model}`}>{m.vendor} {m.model} — {m.driver}</option>)}
                </Select>
              </Field>
              <Field label="Protocolo">
                <Select value={form.protocol} onChange={(e) => { const p = drivers?.protocols.find((x) => x.id === e.target.value); setForm({ ...form, protocol: e.target.value, port: String(p?.port ?? 23) }); }}>
                  {drivers?.protocols.map((p) => <option key={p.id} value={p.id} disabled={!p.available}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Porta"><Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} inputMode="numeric" disabled={simulated} /></Field>
            </div>
            {!simulated && (
              <>
                <Field label="Endereço (IP ou hostname)"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} maxLength={253} required /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Usuário"><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={60} required autoComplete="off" /></Field>
                  <Field label="Senha" hint={form.id ? "••• definida — deixe em branco para manter" : undefined}>
                    <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} maxLength={128} required={!form.id} autoComplete="new-password" />
                  </Field>
                  <Field label="Senha de enable (opcional)" hint="Só se o usuário entrar em modo >.">
                    <Input type="password" value={form.enablePassword} onChange={(e) => setForm({ ...form, enablePassword: e.target.value, clearEnable: false })} maxLength={128} autoComplete="new-password" />
                  </Field>
                  {form.id && (
                    <label className="flex items-center gap-2 self-center text-sm">
                      <input type="checkbox" checked={form.clearEnable} onChange={(e) => setForm({ ...form, clearEnable: e.target.checked, enablePassword: "" })} />Apagar a senha de enable
                    </label>
                  )}
                </div>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tempo de conexão (s)"><Input value={form.connectTimeoutSec} onChange={(e) => setForm({ ...form, connectTimeoutSec: e.target.value })} inputMode="numeric" /></Field>
              <Field label="Tempo por comando (s)"><Input value={form.commandTimeoutSec} onChange={(e) => setForm({ ...form, commandTimeoutSec: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <Field label="Observação"><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} rows={2} /></Field>
            <p className="text-xs text-muted">As senhas são guardadas cifradas e nunca voltam para a tela.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Resultado do teste */}
      <Modal open={!!testView} title={`Teste de acesso — ${testView?.olt.name ?? ""}`} onClose={() => setTestView(null)} size="lg">
        {testView && (() => {
          const m = manifestOf(testView.olt);
          const det = testView.res.detected ?? testView.olt.detected;
          const compat = (testView.res.compatibility ?? testView.olt.compatibility) as Olt["compatibility"];
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RESULT_TONE[testView.res.result]}>{RESULT_LABEL[testView.res.result]}</Badge>
                <Badge tone={COMPAT[compat].tone}>{COMPAT[compat].label}</Badge>
                <span className="font-mono text-xs text-muted">{testView.res.code}</span>
                <span className="text-xs text-muted">{formatDateTime(testView.res.at)} · {testView.res.by}</span>
              </div>
              <div className="divide-y divide-line rounded-xl border border-line">
                {testView.res.steps.map((s) => (
                  <div key={s.key} className="flex gap-3 px-4 py-3">
                    <Badge tone={RESULT_TONE[s.result]}>{RESULT_LABEL[s.result]}</Badge>
                    <div className="min-w-0 text-sm">
                      <div className="font-medium">{s.title}</div>
                      <div className="text-muted">{s.detail} · {s.ms} ms</div>
                    </div>
                  </div>
                ))}
              </div>
              {det && det.boards.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Placas detectadas</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted"><tr><th className="py-1.5">Local</th><th className="py-1.5">Tipo</th><th className="py-1.5">Versões</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {det.boards.map((b) => (
                        <tr key={b.local}><td className="py-1.5">{b.local}</td><td className="py-1.5">{b.type}</td><td className="py-1.5 font-mono text-xs">{Object.entries(b.versions).map(([k, v]) => `${k} ${v}`).join(" · ")}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {m && <DriverFeatures m={m} />}
            </div>
          );
        })()}
      </Modal>

      {/* Drivers e compatibilidade */}
      <Modal open={showDrivers} title="Drivers e compatibilidade" onClose={() => setShowDrivers(false)} size="lg">
        <div className="space-y-6">
          {drivers?.manifests.map((m) => (
            <div key={m.id} className="space-y-3">
              <div>
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-muted">{m.vendor} {m.models.join(", ")} · versões testadas: {m.testedVersions.join(", ")}</div>
              </div>
              <DriverFeatures m={m} />
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Comandos usados</h4>
                <ul className="space-y-0.5 font-mono text-xs">{Object.values(m.commands).map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Pré-requisitos</h4>
                <ul className="list-disc space-y-0.5 pl-5 text-sm">{m.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Limitações conhecidas</h4>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">{m.limitations.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog open={!!removing} title="Remover OLT?" confirmLabel="Remover" danger confirmDisabled={removing?.typed !== removing?.olt.name}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void api(`/api/olts/${removing!.olt.id}/remove`, { body: { confirmName: removing!.typed } }).then(() => { setRemoving(null); return load(); }, (e) => setError(e.message))}>
        <p>Remove o cadastro de <b>{removing?.olt.name}</b> e o histórico de testes. Nada é alterado na OLT.</p>
        <p className="mt-3">Digite o nome da OLT para confirmar:</p>
        <Input className="mt-2" value={removing?.typed ?? ""} onChange={(e) => removing && setRemoving({ ...removing, typed: e.target.value })} />
      </ConfirmDialog>
    </div>
  );
}

function DriverFeatures({ m }: { m: Manifest }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Driver: {m.name} — versões testadas: {m.testedVersions.join(", ")}</h3>
      <div className="divide-y divide-line rounded-xl border border-line">
        {Object.entries(m.features).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>{FEATURE_LABEL[k] ?? k}</span>
            <Badge tone={LEVEL_TONE[v] ?? "neutral"}>{v === "indisponivel" ? "EM BREVE" : v.toUpperCase()}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
