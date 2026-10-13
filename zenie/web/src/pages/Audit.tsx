import { useCallback, useEffect, useState } from "react";
import { api, formatDateTime } from "../api";
import { Alert, Badge, Button, Card, EmptyState, Input, PageTitle } from "../components/ui";

interface Entry {
  id: string;
  ts: string;
  username?: string;
  action: string;
  target?: string;
  ok: boolean;
  details?: Record<string, unknown>;
  ip?: string;
}

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.password": "Troca de senha",
  "user.create": "Usuário criado",
  "user.update": "Usuário alterado",
  "user.resetPassword": "Senha redefinida",
  "user.delete": "Usuário excluído",
  "cli.create-admin": "Admin criado (linha de comando)",
  "cli.reset-password": "Senha redefinida (linha de comando)",
  "settings.network.apply": "Rede do servidor aplicada",
  "settings.network.confirm": "Rede do servidor confirmada",
  "settings.tunnel": "Túnel Cloudflare alterado",
  "settings.time": "Horário do servidor alterado",
  "settings.update": "Atualização do Zenie iniciada",
};

const PAGE = 50;

export function Audit() {
  const [items, setItems] = useState<Entry[]>([]);
  const [filters, setFilters] = useState({ username: "", target: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);

  const fetchPage = useCallback(
    async (before?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: String(PAGE) });
        if (filters.username) qs.set("username", filters.username);
        if (filters.target) qs.set("target", filters.target);
        if (before) qs.set("before", before);
        const page = await api<Entry[]>(`/api/audit?${qs}`);
        setItems((prev) => (before ? [...prev, ...page] : page));
        setMore(page.length === PAGE);
      } catch (e) {
        setError(e instanceof Error ? e.message : "erro ao carregar auditoria");
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  return (
    <>
      <PageTitle title="Auditoria" subtitle="Quem fez o quê, quando e em qual equipamento." />
      <Card
        title={
          <div className="flex flex-wrap gap-2">
            <div className="w-44"><Input placeholder="Usuário" value={filters.username} onChange={(e) => setFilters({ ...filters, username: e.target.value })} /></div>
            <div className="w-56"><Input placeholder="Alvo (equipamento/usuário)" value={filters.target} onChange={(e) => setFilters({ ...filters, target: e.target.value })} /></div>
          </div>
        }
      >
        {error && <Alert>{error}</Alert>}
        {items.length === 0 && !loading ? (
          <EmptyState title="Nenhum registro" />
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Data/hora</th>
                  <th className="px-5 py-3 font-medium">Usuário</th>
                  <th className="px-5 py-3 font-medium">Ação</th>
                  <th className="px-5 py-3 font-medium">Alvo</th>
                  <th className="px-5 py-3 font-medium">Resultado</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted">{formatDateTime(i.ts)}</td>
                    <td className="px-5 py-2.5">{i.username ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      {ACTION_LABEL[i.action] ?? i.action}
                      {i.details && <div className="text-xs text-muted">{Object.entries(i.details).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</div>}
                    </td>
                    <td className="px-5 py-2.5">{i.target ?? "—"}</td>
                    <td className="px-5 py-2.5">{i.ok ? <Badge tone="ok">OK</Badge> : <Badge tone="bad">Falhou</Badge>}</td>
                    <td className="px-5 py-2.5 text-muted">{i.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {more && items.length > 0 && (
          <div className="mt-8 flex justify-center">
            <Button variant="secondary" disabled={loading} onClick={() => void fetchPage(items[items.length - 1]?.ts)}>
              {loading ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
