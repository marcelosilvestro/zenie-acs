import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Alert, Button, Field, Input } from "../components/ui";
import { useSession } from "../session";

export function Login() {
  const { me, login } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={me.mustChangePassword ? "/senha" : "/"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "erro ao entrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-side p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <img src="/zenie.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold">Zenie</h1>
            <p className="text-sm text-muted">painel NOC para GenieACS</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Usuário">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Senha">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
