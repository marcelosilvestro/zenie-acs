import { KeyRound, Pencil, Plus, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, formatDateTime, ROLE_LABEL, type Role } from "../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, PageTitle, Select } from "../components/ui";
import { useSession } from "../session";

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Senha temporária: mostrada uma única vez, para o admin repassar ao usuário. */
function TempPassword({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  return (
    <Alert tone="ok">
      <div className="space-y-1">
        <div>
          Senha temporária de <b>{username}</b>: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-ink">{password}</code>
        </div>
        <div className="text-xs">Ela não será mostrada de novo. O usuário troca no primeiro login.</div>
        <button className="text-xs underline" onClick={onClose}>Fechar</button>
      </div>
    </Alert>
  );
}

export function Users() {
  const { me } = useSession();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", name: "", role: "atendente" as Role });
  const [editing, setEditing] = useState<{ user: UserRow; name: string; role: Role } | null>(null);
  const [removing, setRemoving] = useState<{ user: UserRow; typed: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<UserRow[]>("/api/users"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar usuários");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    }
  };

  // Ação de diálogo: fecha só se der certo (o erro aparece no topo e o diálogo continua aberto).
  const runDialog = async (fn: () => Promise<void>, close: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ username: string; temporaryPassword: string }>("/api/users", { body: form });
      setTemp({ username: res.username, password: res.temporaryPassword });
      setForm({ username: "", name: "", role: "atendente" });
      setShowForm(false);
    });
  };

  return (
    <>
      <PageTitle
        title="Usuários"
        subtitle="Atendente: consulta e Wi-Fi · NOC: + reboot e diagnósticos · Administrador: tudo"
        actions={<Button onClick={() => setShowForm((v) => !v)}><Plus size={16} />Novo usuário</Button>}
      />
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
        {showForm && (
          <Card title="Novo usuário">
            <form onSubmit={create} className="grid gap-4 sm:grid-cols-3">
              <Field label="Usuário" hint="3 a 32: letras minúsculas, números, . _ -">
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} pattern="[a-z0-9._\-]{3,32}" required />
              </Field>
              <Field label="Nome" hint="nome da pessoa — a senha é gerada ao criar">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
              </Field>
              <Field label="Perfil">
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </Select>
              </Field>
              <div className="flex gap-2 sm:col-span-3">
                <Button type="submit">Criar e gerar senha temporária</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              </div>
            </form>
          </Card>
        )}
        <Card>
          {!rows ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : rows.length === 0 ? (
            <EmptyState title="Nenhum usuário" />
          ) : (
            <div className="-m-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Usuário</th>
                    <th className="px-5 py-3 font-medium">Perfil</th>
                    <th className="px-5 py-3 font-medium">Situação</th>
                    <th className="px-5 py-3 font-medium">Último acesso</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((u) => {
                    const self = u.username === me?.username;
                    return (
                      <tr key={u.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted">{u.username}</div>
                        </td>
                        <td className="px-5 py-3">
                          <Select
                            value={u.role}
                            disabled={self}
                            onChange={(e) => void run(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }))}
                          >
                            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </Select>
                        </td>
                        <td className="px-5 py-3">
                          {u.active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="neutral">Desativado</Badge>}{" "}
                          {u.mustChangePassword && <Badge tone="warn">Senha temporária</Badge>}
                        </td>
                        <td className="px-5 py-3 text-muted">{formatDateTime(u.lastLoginAt)}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" title="Editar nome e perfil" onClick={() => { setError(null); setEditing({ user: u, name: u.name, role: u.role }); }}>
                              <Pencil size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              title="Gerar nova senha temporária"
                              onClick={() => {
                                if (!confirm(`Gerar nova senha temporária para ${u.username}? As sessões dele serão encerradas.`)) return;
                                void run(async () => {
                                  const res = await api<{ temporaryPassword: string }>(`/api/users/${u.id}/reset-password`, { method: "POST" });
                                  setTemp({ username: u.username, password: res.temporaryPassword });
                                });
                              }}
                            >
                              <KeyRound size={16} />
                            </Button>
                            {!self && (
                              <Button
                                variant="ghost"
                                title={u.active ? "Desativar" : "Reativar"}
                                onClick={() => {
                                  if (u.active && !confirm(`Desativar ${u.username}? Ele perde o acesso na hora.`)) return;
                                  void run(() => api(`/api/users/${u.id}`, { method: "PATCH", body: { active: !u.active } }));
                                }}
                              >
                                {u.active ? <UserX size={16} /> : <UserCheck size={16} />}
                              </Button>
                            )}
                            {!self && (
                              <Button variant="ghost" title="Excluir usuário" onClick={() => { setError(null); setRemoving({ user: u, typed: "" }); }}>
                                <Trash2 size={16} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!editing}
        title={`Editar ${editing?.user.username ?? ""}`}
        confirmLabel="Salvar"
        busy={busy}
        confirmDisabled={!editing?.name.trim()}
        onCancel={() => setEditing(null)}
        onConfirm={() => {
          if (!editing) return;
          const body: { name?: string; role?: Role } = {};
          if (editing.name.trim() !== editing.user.name) body.name = editing.name.trim();
          if (editing.role !== editing.user.role) body.role = editing.role;
          if (!Object.keys(body).length) return setEditing(null);
          void runDialog(() => api(`/api/users/${editing.user.id}`, { method: "PATCH", body }), () => setEditing(null));
        }}
      >
        {editing && (
          <div className="space-y-3 text-ink">
            {error && <Alert>{error}</Alert>}
            <Field label="Nome">
              <Input value={editing.name} maxLength={80} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Perfil" hint={editing.user.username === me?.username ? "você não pode mudar o próprio perfil" : "mudar o perfil encerra as sessões do usuário"}>
              <Select value={editing.role} disabled={editing.user.username === me?.username} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!removing}
        title={`Excluir ${removing?.user.username ?? ""}?`}
        confirmLabel="Excluir"
        danger
        busy={busy}
        confirmDisabled={removing?.typed.trim().toLowerCase() !== removing?.user.username}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          void runDialog(() => api(`/api/users/${removing.user.id}/remove`, { body: { confirm: removing.typed } }), () => setRemoving(null));
        }}
      >
        {removing && (
          <div className="space-y-3">
            {error && <Alert>{error}</Alert>}
            <p>
              <b className="text-ink">{removing.user.name}</b> ({removing.user.username}) perde o acesso na hora e sai da lista. O que ele fez continua na
              auditoria. Para só bloquear o acesso por um tempo, use <b className="text-ink">Desativar</b>.
            </p>
            <Field label={`Digite ${removing.user.username} para confirmar`}>
              <Input value={removing.typed} autoFocus onChange={(e) => setRemoving({ ...removing, typed: e.target.value })} />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
