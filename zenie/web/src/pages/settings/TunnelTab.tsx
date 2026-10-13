// Túnel Cloudflare (Cloudflare Zero Trust): o admin cola o token do túnel criado no painel da Cloudflare e liga.
// Mesmo jeito do MK-Auth. O container cloudflared roda no servidor (perfil "tunnel" do docker compose).

import { CloudCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { Alert, Badge, Button, Card, Switch, Textarea } from "../../components/ui";

interface TunnelState { enabled: boolean; tokenSet: boolean; tokenHint: string | null; state: string | null; connected: boolean | null; originError?: { service: string; kind: "tls" | "localhost" | "inalcancavel" } | null }

export function TunnelTab() {
  const [s, setS] = useState<TunnelState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<TunnelState>("/api/settings/tunnel");
      setS(r);
      setEnabled(r.enabled);
    } catch (e) {
      setMsg({ tone: e instanceof ApiError && e.code === "no_hostd" ? "warn" : "bad", text: e instanceof Error ? e.message : "erro ao carregar" });
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<TunnelState>("/api/settings/tunnel", { method: "PUT", body: { enabled, token: token.trim() || undefined } });
      setS(r);
      setToken("");
      setMsg({ tone: "ok", text: r.enabled ? "Túnel ativado. A conexão com a Cloudflare leva alguns segundos." : "Túnel desativado." });
      if (r.enabled) setTimeout(() => void load(), 8000);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao gravar" });
    } finally {
      setBusy(false);
    }
  };

  const status = !s?.enabled ? null : s.state !== "running" ? <Badge tone="bad">parado ({s.state ?? "sem container"})</Badge> : s.connected ? <Badge tone="ok">conectado à Cloudflare</Badge> : <Badge tone="warn">conectando…</Badge>;

  return (
    <Card title={<span className="inline-flex items-center gap-2"><CloudCog size={18} />Cloudflare Zero</span>} actions={status}>
      {msg && <div className="mb-4"><Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      {s?.enabled && s.originError && (
        <div className="mb-4">
          <Alert tone="warn">
            O túnel está conectado, mas quem acessa recebe erro 502: a rota na Cloudflare aponta para{" "}
            <code>{s.originError.service}</code>
            {s.originError.kind === "tls"
              ? <> e o certificado do painel é autoassinado. Na rota do aplicativo publicado, em Configurações adicionais › TLS, ligue <b>No TLS Verify</b>.</>
              : s.originError.kind === "localhost"
                ? <>. Dentro do túnel, <code>localhost</code> é o próprio túnel: use o serviço <b>HTTPS</b> com URL <code>zenie-web</code> e ligue <b>No TLS Verify</b>.</>
                : <>, que o túnel não alcança. Use o serviço <b>HTTPS</b> com URL <code>zenie-web</code> e ligue <b>No TLS Verify</b>.</>}
          </Alert>
        </div>
      )}
      <div className="grid max-w-3xl gap-5 sm:grid-cols-[120px_1fr]">
        <span className="pt-0.5 text-sm font-medium">Ativar</span>
        <div>
          <Switch checked={enabled} onChange={setEnabled} disabled={busy || !s} label="Ativar túnel Cloudflare" />
          <p className="mt-2 text-sm text-muted">
            Túnel ligado aos servidores da Cloudflare: o painel fica acessível de fora pelo endereço configurado na
            Cloudflare, sem abrir portas no firewall.
          </p>
        </div>
        <span className="pt-2 text-sm font-medium">Token</span>
        <div>
          <Textarea
            rows={4}
            placeholder={s?.tokenSet ? `Token gravado (termina em …${s.tokenHint}). Cole outro para trocar.` : "Token de acesso"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted">Parte final do código de instalação (pode colar o comando inteiro: o Zenie pega o token).</p>
        </div>
        <span />
        <div>
          <Button onClick={() => void save()} disabled={busy || !s}>{busy ? "Gravando..." : "Gravar"}</Button>
        </div>
      </div>
      <details className="mt-6 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">Como criar o túnel na Cloudflare</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>No painel da Cloudflare: <b>Zero Trust › Networks › Tunnels › Create a tunnel</b> (tipo Cloudflared).</li>
          <li>Na tela de instalação, copie o comando (<code>cloudflared service install eyJ…</code>) e cole aqui no campo Token.</li>
          <li>Em <b>Public Hostname</b>, crie o endereço (ex.: <code>zenie.seuprovedor.com.br</code>) com o serviço <b>HTTPS</b> e URL <code>zenie-web</code>.</li>
          <li>Em <b>Additional application settings › TLS</b>, ligue <b>No TLS Verify</b> (o certificado do painel é do próprio servidor).</li>
        </ol>
        <p className="mt-2">O túnel só alcança o painel do Zenie: a NBI, a interface do GenieACS e o banco ficam fora do alcance dele.</p>
      </details>
    </Card>
  );
}
