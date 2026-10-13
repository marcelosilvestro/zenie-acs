import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { Alert, Button, Card, Field, Input, PageTitle } from "../components/ui";
import { useSession } from "../session";

/** Formulário de troca da própria senha (usado na página de troca obrigatória e no popup do topo). */
export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { reload } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("a confirmação não confere com a nova senha");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/password", { body: { currentPassword: current, newPassword: next } });
      await reload();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao trocar a senha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Senha atual">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
      </Field>
      <Field label="Nova senha" hint="Pelo menos 10 caracteres, com letras e números.">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Confirmar nova senha">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar nova senha"}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>}
      </div>
    </form>
  );
}

/** Página usada só na troca obrigatória (senha temporária no primeiro acesso). */
export function ChangePassword() {
  const { me } = useSession();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Trocar senha" subtitle={me?.mustChangePassword ? "Defina uma senha pessoal para continuar." : undefined} />
      <Card>
        <ChangePasswordForm onDone={() => navigate("/", { replace: true })} onCancel={me?.mustChangePassword ? undefined : () => navigate(-1)} />
      </Card>
    </div>
  );
}
