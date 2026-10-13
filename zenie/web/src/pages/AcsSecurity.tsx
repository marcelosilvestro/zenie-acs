// Segurança do ACS (docs/SEGURANCA-ACS.md): credencial que as CPEs usam para autenticar no GenieACS e o modo de
// exigência (desligada / exigida de todos). Só admin.

import { Eye, KeyRound, Plus, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, formatDateTime } from "../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageTitle } from "../components/ui";

type Mode = "off" | "enforced";
interface Credential { id: string; username: string; status: "active" | "transition" | "retired"; createdAt: string; createdBy: string; retiredAt: string | null; retiredBy: string | null }
interface SecurityState { mode: Mode; inSync: boolean; updatedAt: string | null; updatedBy: string | null; credentials: Credential[]; secretsReady: boolean }

const MODE_INFO: Record<Mode, { label: string; tone: "ok" | "neutral"; text: string }> = {
  off: { label: "Desligada", tone: "neutral", text: "O ACS aceita qualquer equipamento, sem conferir usuário e senha." },
  enforced: { label: "Exigida de todos", tone: "ok", text: "O ACS recusa qualquer equipamento sem uma credencial aceita." },
};
const STATUS_LABEL = { active: "ativa", transition: "em transição (ainda aceita)", retired: "aposentada" } as const;
const STATUS_TONE = { active: "ok", transition: "warn", retired: "neutral" } as const;

export function AcsSecurity() {
  const [s, setS] = useState<SecurityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ username: string; password: string; created: boolean } | null>(null);
  const [newForm, setNewForm] = useState<{ open: boolean; username: string; password: string }>({ open: false, username: "zenie", password: "" });
  const [retire, setRetire] = useState<Credential | null>(null);
  const [off, setOff] = useState(false);
  const [enforce, setEnforce] = useState({ open: false, typed: "" });

  const load = useCallback(async () => {
    try {
      const res = await api<SecurityState>("/api/acs/security");
      setS(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <div className="p-6">{error ? <Alert>{error}</Alert> : "Carregando..."}</div>;
  const active = s.credentials.find((c) => c.status === "active");
  const mi = MODE_INFO[s.mode];

  return (
    <div className="space-y-5">
      <PageTitle title="Segurança do ACS" subtitle="Usuário e senha que os equipamentos usam para falar com o ACS (TR-069)" />
      {error && <Alert>{error}</Alert>}
      {!s.secretsReady && <Alert>A chave de cifra (ZENIE_SECRET_KEY) não está configurada no servidor. Rode ./update.sh antes de cadastrar credenciais.</Alert>}
      {!s.inSync && <Alert tone="warn">A configuração do GenieACS está diferente da do Zenie (alguém alterou fora do painel). Salve o modo de novo para corrigir.</Alert>}

      <Card title="Exigência de autenticação" actions={<Badge tone={mi.tone}>{mi.label}</Badge>}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-page text-muted">
            {s.mode === "off" ? <ShieldOff size={22} /> : <ShieldCheck size={22} />}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p>{mi.text}</p>
            {s.updatedBy && <p className="text-xs text-muted">Alterado por {s.updatedBy} em {formatDateTime(s.updatedAt)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {s.mode !== "enforced" && <Button onClick={() => setEnforce({ open: true, typed: "" })} disabled={busy || !active}><ShieldCheck size={16} />Exigir de todos</Button>}
            {s.mode !== "off" && <Button variant="danger" onClick={() => setOff(true)} disabled={busy}><ShieldOff size={16} />Desligar agora</Button>}
          </div>
        </div>
        <p className="mt-4 text-xs text-muted">
          Emergência no servidor: <code className="font-mono">docker compose exec zenie-api node dist/cli.js acs-auth off</code>
        </p>
      </Card>

      <Card title="Credenciais" actions={<Button onClick={() => setNewForm({ open: true, username: active?.username ?? "zenie", password: "" })} disabled={busy || !s.secretsReady}><Plus size={16} />Nova credencial</Button>}>
        {shown && (
          <div className="mb-4">
            <Alert tone="ok">
              <div className="space-y-1">
                <div>{shown.created ? "Credencial criada" : "Credencial"}: usuário <b className="font-mono">{shown.username}</b>, senha <code className="rounded bg-white px-1.5 py-0.5 font-mono text-ink">{shown.password}</code></div>
                <div className="text-xs">Use-a na OLT (tr069-mgmt) e em equipamentos configurados à mão. Guarde em local seguro.</div>
                <button className="text-xs underline" onClick={() => setShown(null)}>Fechar</button>
              </div>
            </Alert>
          </div>
        )}
        {newForm.open && (
          <form
            className="mb-4 grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const res = await api<{ credential: Credential; password: string }>("/api/acs/credentials", { body: { username: newForm.username, ...(newForm.password ? { password: newForm.password } : {}) } });
                setShown({ username: res.credential.username, password: res.password, created: true });
                setNewForm({ open: false, username: "zenie", password: "" });
              });
            }}
          >
            <Field label="Usuário"><Input value={newForm.username} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} maxLength={64} required /></Field>
            <Field label="Senha" hint="Em branco: gera uma senha forte"><Input value={newForm.password} onChange={(e) => setNewForm({ ...newForm, password: e.target.value })} maxLength={64} placeholder="gerar automaticamente" /></Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>Criar</Button>
              <Button type="button" variant="secondary" onClick={() => setNewForm({ ...newForm, open: false })}>Cancelar</Button>
            </div>
            <p className="text-xs text-muted sm:col-span-3">
              A nova credencial vira a ativa. A atual passa a "em transição" e continua aceita pelo ACS até você aposentá-la, para nenhum equipamento cair durante a troca.
            </p>
          </form>
        )}
        {s.credentials.length === 0 ? (
          <EmptyState icon={<KeyRound size={28} />} title="Nenhuma credencial cadastrada">Crie a credencial que os equipamentos vão usar para autenticar no ACS.</EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-5 py-3 font-medium">Usuário</th><th className="px-5 py-3 font-medium">Situação</th><th className="px-5 py-3 font-medium">Criada</th><th className="px-5 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.credentials.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2.5 font-mono">{c.username}</td>
                    <td className="px-5 py-2.5"><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>{c.retiredAt && <span className="block text-xs text-muted">por {c.retiredBy} em {formatDateTime(c.retiredAt)}</span>}</td>
                    <td className="px-5 py-2.5 text-muted">{formatDateTime(c.createdAt)} · {c.createdBy}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      {c.status !== "retired" && (
                        <Button variant="secondary" onClick={() => void run(async () => setShown({ ...(await api<{ username: string; password: string }>(`/api/acs/credentials/${c.id}/reveal`, { method: "POST" })), created: false }))} disabled={busy}><Eye size={15} />Ver senha</Button>
                      )}
                      {c.status === "transition" && <Button variant="secondary" className="ml-2" onClick={() => setRetire(c)} disabled={busy}>Aposentar</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={enforce.open} title="Exigir a credencial de todos os equipamentos?" confirmLabel="Exigir de todos" danger busy={busy} confirmDisabled={enforce.typed !== "EXIGIR"}
        onCancel={() => setEnforce({ open: false, typed: "" })}
        onConfirm={() => void run(async () => { await api("/api/acs/mode", { body: { mode: "enforced" } }); setEnforce({ open: false, typed: "" }); })}>
        <p>O ACS passa a <b>recusar qualquer equipamento</b> que não use uma credencial aceita ({s.credentials.filter((c) => c.status !== "retired").map((c) => c.username).join(", ")}). Quem ainda não estiver configurado deixa de aparecer no Zenie até receber a credencial (pela OLT ou pela tela do equipamento).</p>
        <p className="mt-3">Digite <b>EXIGIR</b> para confirmar:</p>
        <Input className="mt-2" value={enforce.typed} onChange={(e) => setEnforce({ ...enforce, typed: e.target.value })} autoFocus />
      </ConfirmDialog>
      <ConfirmDialog open={off} title="Desligar a exigência de autenticação?" confirmLabel="Desligar" danger busy={busy} onCancel={() => setOff(false)}
        onConfirm={() => void run(async () => { await api("/api/acs/mode", { body: { mode: "off" } }); setOff(false); })}>
        <p>O ACS volta a aceitar qualquer equipamento, sem conferir usuário e senha.</p>
      </ConfirmDialog>
      <ConfirmDialog open={!!retire} title="Aposentar credencial?" confirmLabel="Aposentar" danger busy={busy} onCancel={() => setRetire(null)}
        onConfirm={() => void run(async () => { await api(`/api/acs/credentials/${retire!.id}/retire`, { method: "POST" }); setRetire(null); })}>
        <p>O ACS deixa de aceitar <b className="font-mono">{retire?.username}</b> (credencial antiga). Com a exigência ligada, equipamentos que ainda usam essa senha deixam de falar com o ACS.</p>
      </ConfirmDialog>
    </div>
  );
}
