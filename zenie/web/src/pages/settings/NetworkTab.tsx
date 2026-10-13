// Configurações > Redes: IP, máscara, gateway, DNS e VLANs do servidor, aplicados pelo agente do host.
// Segurança: o agente reverte sozinho se a mudança não for confirmada no prazo (ex.: IP errado e ninguém alcança mais
// o servidor). Mudou o IP por onde você está acessando: abra o novo endereço e confirme lá.

import { Network, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Select } from "../../components/ui";

interface LiveIf { name: string; mac: string | null; state: string; vlan: { parent: string; id: number } | null; addresses: string[]; dhcp: boolean }
interface NetState {
  backend: "ifupdown" | "netplan" | null;
  interfaces: LiveIf[];
  gateway: { address: string; dev: string } | null;
  dns: string[];
  pending: { deadline: number } | null;
  confirmSeconds: number;
  acsHost: string | null;
}
type Mode = "off" | "dhcp" | "static";
interface Row { key: string; name?: string; parent?: string; vlan?: number | ""; mode: Mode; ip: string; mask: string; gateway: string }

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** "255.255.255.0", "/24" ou "24" -> 24; null se inválida. */
export function maskToPrefix(m: string): number | null {
  const t = m.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(t)) return +t >= 8 && +t <= 32 ? +t : null;
  if (!IP_RE.test(t)) return null;
  const bits = t.split(".").map((o) => (+o).toString(2).padStart(8, "0")).join("");
  return /^1+0*$/.test(bits) ? bits.indexOf("0") === -1 ? 32 : bits.indexOf("0") : null;
}
const prefixToMask = (p: number) => [0, 8, 16, 24].map((s) => ((0xffffffff << (32 - p)) >>> (24 - s)) & 255).join(".");

let seq = 0;
const key = () => `r${++seq}`;

function rowsFrom(s: NetState): Row[] {
  return s.interfaces.map((i) => {
    const [ip, pre] = (i.addresses[0] ?? "").split("/");
    const mode: Mode = i.dhcp ? "dhcp" : i.addresses.length ? "static" : "off";
    return {
      key: key(),
      ...(i.vlan ? { parent: i.vlan.parent, vlan: i.vlan.id } : { name: i.name }),
      mode,
      ip: ip ?? "",
      mask: pre ? prefixToMask(+pre) : "255.255.255.0",
      gateway: s.gateway?.dev === i.name ? s.gateway.address : "",
    };
  });
}

const rowName = (r: Row) => (r.vlan !== undefined ? `${r.parent}.${r.vlan}` : r.name!);

export function NetworkTab({ confirmToken }: { confirmToken: string | null }) {
  const [s, setS] = useState<NetState | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dns, setDns] = useState<string[]>(["", "", ""]);
  const [error, setError] = useState<{ tone: "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [pending, setPending] = useState<{ token: string; deadline: number; newUrl: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<NetState>("/api/settings/network");
      setS(r);
      setRows(rowsFrom(r));
      setDns([...r.dns, "", "", ""].slice(0, 3));
    } catch (e) {
      setError({ tone: e instanceof ApiError && e.code === "no_hostd" ? "warn" : "bad", text: e instanceof Error ? e.message : "erro ao carregar" });
    }
  }, []);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!pending && !s?.pending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending, s?.pending]);

  const confirm = async (token?: string) => {
    setBusy(true);
    try {
      await api("/api/settings/network/confirm", { body: token ? { token } : {} });
      setPending(null);
      setDone("Configuração de rede confirmada e mantida.");
      await load();
    } catch (e) {
      setError({ tone: "bad", text: e instanceof Error ? e.message : "erro ao confirmar" });
    } finally {
      setBusy(false);
    }
  };

  const physical = s?.interfaces.filter((i) => !i.vlan).map((i) => i.name) ?? [];
  const set = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  // Validação na tela (o agente valida de novo, com as mesmas regras).
  const problems: string[] = [];
  const gws = rows.filter((r) => r.mode === "static" && r.gateway.trim());
  for (const r of rows) {
    if (r.vlan !== undefined && (r.vlan === "" || r.vlan < 1 || r.vlan > 4094)) problems.push(`VLAN de ${r.parent}: número de 1 a 4094`);
    if (r.mode !== "static") continue;
    if (!IP_RE.test(r.ip.trim())) problems.push(`${rowName(r)}: IP inválido`);
    if (maskToPrefix(r.mask) === null) problems.push(`${rowName(r)}: máscara inválida`);
    if (r.gateway.trim() && !IP_RE.test(r.gateway.trim())) problems.push(`${rowName(r)}: gateway inválido`);
  }
  if (gws.length > 1) problems.push("só uma interface pode ter gateway padrão");
  if (!rows.some((r) => r.mode !== "off")) problems.push("o servidor precisa de pelo menos um endereço");
  for (const d of dns) if (d.trim() && !IP_RE.test(d.trim())) problems.push(`DNS inválido: ${d}`);

  const config = {
    interfaces: rows
      .filter((r) => r.mode !== "off")
      .map((r) => ({
        ...(r.vlan !== undefined ? { parent: r.parent, vlan: Number(r.vlan) } : { name: r.name }),
        mode: r.mode,
        ...(r.mode === "static" ? { address: `${r.ip.trim()}/${maskToPrefix(r.mask)}`, gateway: r.gateway.trim() || null } : {}),
      })),
    dns: dns.map((d) => d.trim()).filter(Boolean),
  };

  // Avisos antes de aplicar: o IP do ACS (as CPEs apontam para ele) e o IP por onde você está acessando.
  const currentIps = new Set(s?.interfaces.flatMap((i) => i.addresses.map((a) => a.split("/")[0])) ?? []);
  const newIps = new Set(rows.filter((r) => r.mode === "static").map((r) => r.ip.trim()));
  const acsLost = !!s?.acsHost && currentIps.has(s.acsHost) && !newIps.has(s.acsHost);
  const browserHost = window.location.hostname;
  const browserLost = currentIps.has(browserHost) && !newIps.has(browserHost);
  // Novo IP da interface por onde o navegador chega hoje (para o link de confirmação).
  const browserIf = s?.interfaces.find((i) => i.addresses.some((a) => a.split("/")[0] === browserHost))?.name;
  const newBrowserIp = browserLost ? rows.find((r) => r.mode === "static" && rowName(r) === browserIf)?.ip.trim() || null : null;

  const apply = async () => {
    setAsk(false);
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await api<{ token: string; deadline: number }>("/api/settings/network", { body: { config } });
      const newUrl = browserLost && newBrowserIp ? `https://${newBrowserIp}/configuracoes?confirmar=${r.token}` : null;
      setPending({ token: r.token, deadline: r.deadline * 1000, newUrl });
    } catch (e) {
      setError({ tone: "bad", text: e instanceof Error ? e.message : "erro ao aplicar" });
    } finally {
      setBusy(false);
    }
  };

  if (error && !s) return <Alert tone={error.tone}>{error.text}</Alert>;
  if (!s) return <p className="text-sm text-muted">Carregando a rede do servidor...</p>;
  if (!s.backend) {
    return (
      <Card>
        <EmptyState icon={<Network size={32} />} title="Rede não gerenciável pelo Zenie neste sistema">
          O servidor não usa ifupdown (Debian) nem netplan (Ubuntu). Configure a rede pelo próprio sistema.
        </EmptyState>
      </Card>
    );
  }

  const left = pending ? Math.max(0, Math.round((pending.deadline - now) / 1000)) : 0;

  return (
    <div className="space-y-5">
      {/* Confirmação: pelo link aberto no novo endereço, ou na mesma tela quando o endereço não mudou */}
      {confirmToken && !pending && (
        <Alert tone="warn">
          Há uma mudança de rede aguardando confirmação. Se esta página abriu, a nova rede funciona.{" "}
          <Button className="ml-2" onClick={() => void confirm(confirmToken)} disabled={busy}>Confirmar a nova rede</Button>
        </Alert>
      )}
      {pending && (
        <Alert tone="warn">
          {left > 0 ? (
            <>
              <b>Rede aplicada. Confirme em {left} s</b>, ou o servidor volta sozinho à configuração anterior.{" "}
              {pending.newUrl ? (
                <>O endereço deste painel mudou: abra <a className="font-medium underline" href={pending.newUrl}>{pending.newUrl.split("/configuracoes")[0]}</a>, entre e confirme lá.</>
              ) : (
                <Button className="ml-2" onClick={() => void confirm(pending.token)} disabled={busy}>Confirmar</Button>
              )}
            </>
          ) : (
            <>O prazo acabou: se a mudança não foi confirmada, o servidor voltou à configuração anterior. <button className="underline" onClick={() => { setPending(null); void load(); }}>Recarregar</button></>
          )}
        </Alert>
      )}
      {/* Mudança pendente vista por outra página/endereço (recarregou, entrou pelo túnel...): confirma daqui mesmo */}
      {s.pending && !pending && !confirmToken && (() => {
        const secs = Math.max(0, Math.round(s.pending.deadline - now / 1000));
        const acsGone = !!s.acsHost && !currentIps.has(s.acsHost);
        return secs > 0 ? (
          <Alert tone={acsGone ? "bad" : "warn"}>
            <b>Há uma mudança de rede aguardando confirmação: faltam {secs} s.</b> Sem confirmação, o servidor volta
            sozinho à configuração anterior.
            {acsGone && (
              <> <b>Atenção:</b> o IP do ACS ({s.acsHost}) não está mais neste servidor. Confirmar deixa todas as ONUs e
              roteadores sem falar com o ACS. Na dúvida, não confirme.</>
            )}
            <Button className="ml-2" variant={acsGone ? "danger" : "primary"} onClick={() => void confirm()} disabled={busy}>Confirmar a nova rede</Button>
          </Alert>
        ) : (
          <Alert tone="info">O prazo acabou: o servidor voltou à configuração anterior. <button className="underline" onClick={() => void load()}>Recarregar</button></Alert>
        );
      })()}
      {done && <Alert tone="ok" onClose={() => setDone(null)}>{done}</Alert>}
      {error && <Alert tone={error.tone} onClose={() => setError(null)}>{error.text}</Alert>}

      <Card title="Situação atual" actions={<Badge tone="neutral">{s.backend === "ifupdown" ? "Debian (ifupdown)" : "Ubuntu (netplan)"}</Badge>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1.5 pr-4 font-medium">Interface</th><th className="pr-4 font-medium">Endereço</th><th className="pr-4 font-medium">Modo</th><th className="pr-4 font-medium">Link</th><th className="font-medium">MAC</th></tr>
            </thead>
            <tbody>
              {s.interfaces.map((i) => (
                <tr key={i.name} className="border-t border-line">
                  <td className="py-2 pr-4 font-medium">{i.name}{i.vlan && <span className="ml-1.5 text-xs text-muted">VLAN {i.vlan.id}</span>}</td>
                  <td className="pr-4 font-mono text-xs">{i.addresses.join(", ") || "—"}</td>
                  <td className="pr-4">{i.dhcp ? "DHCP" : i.addresses.length ? "estático" : "sem IP"}</td>
                  <td className="pr-4">{i.state === "UP" ? <Badge tone="ok">ativo</Badge> : <Badge tone="neutral">{i.state.toLowerCase()}</Badge>}</td>
                  <td className="font-mono text-xs text-muted">{i.mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span><span className="text-muted">Gateway:</span> {s.gateway ? `${s.gateway.address} (${s.gateway.dev})` : "—"}</span>
          <span><span className="text-muted">DNS:</span> {s.dns.join(", ") || "—"}</span>
        </div>
      </Card>

      <Card title="Alterar a rede">
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.key} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[150px_120px_1fr_1fr_1fr_auto] sm:items-end">
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">{r.vlan !== undefined ? "VLAN" : "Interface"}</span>
                {r.vlan !== undefined ? (
                  <div className="flex gap-1">
                    <Select value={r.parent} onChange={(e) => set(r.key, { parent: e.target.value })} className="w-auto">
                      {physical.map((p) => <option key={p}>{p}</option>)}
                    </Select>
                    <Input type="number" min={1} max={4094} placeholder="ID" className="w-20" value={r.vlan} onChange={(e) => set(r.key, { vlan: e.target.value === "" ? "" : Number(e.target.value) })} />
                  </div>
                ) : (
                  <div className="py-2 text-sm font-medium">{r.name}</div>
                )}
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">Modo</span>
                <Select value={r.mode} onChange={(e) => set(r.key, { mode: e.target.value as Mode })}>
                  <option value="static">Estático</option>
                  <option value="dhcp">DHCP</option>
                  {r.vlan === undefined && <option value="off">Sem IP</option>}
                </Select>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">IP</span>
                <Input value={r.ip} disabled={r.mode !== "static"} placeholder="192.168.0.10" onChange={(e) => set(r.key, { ip: e.target.value })} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">Máscara</span>
                <Input value={r.mask} disabled={r.mode !== "static"} placeholder="255.255.255.0 ou /24" onChange={(e) => set(r.key, { mask: e.target.value })} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-muted">Gateway (padrão)</span>
                <Input value={r.gateway} disabled={r.mode !== "static"} placeholder="opcional" onChange={(e) => set(r.key, { gateway: e.target.value })} />
              </div>
              <div className="flex justify-end">
                {r.vlan !== undefined && (
                  <button className="rounded-lg p-2 text-muted hover:bg-page hover:text-bad" aria-label="Remover VLAN" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setRows((rs) => [...rs, { key: key(), parent: physical[0], vlan: "", mode: "static", ip: "", mask: "255.255.255.0", gateway: "" }])} disabled={!physical.length}>
            <Plus size={15} />Adicionar VLAN
          </Button>
        </div>

        <div className="mt-5">
          <span className="mb-1 block text-xs font-medium text-muted">Servidores DNS</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {dns.map((d, i) => (
              <Input key={i} value={d} placeholder={i === 0 ? "8.8.8.8" : "opcional"} onChange={(e) => setDns((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
          </div>
        </div>

        {problems.length > 0 && <div className="mt-4"><Alert tone="warn">{problems.join(" · ")}</Alert></div>}
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={() => setAsk(true)} disabled={busy || problems.length > 0 || !!pending || !!s.pending}>{busy ? "Aplicando..." : "Aplicar"}</Button>
          <span className="text-xs text-muted">Sem confirmação em {s.confirmSeconds} s, o servidor volta sozinho à configuração atual.</span>
        </div>
      </Card>

      <ConfirmDialog
        open={ask}
        title="Aplicar a nova configuração de rede?"
        confirmLabel="Aplicar"
        danger={acsLost || browserLost}
        onCancel={() => setAsk(false)}
        onConfirm={() => void apply()}
      >
        <div className="space-y-2 text-sm">
          {acsLost && (
            <Alert tone="bad">
              O IP <b>{s.acsHost}</b> sai do servidor, e é o endereço do ACS que as ONUs e roteadores usam
              (<code>http://{s.acsHost}:7547</code>). Os equipamentos perdem o contato com o ACS até a URL ser atualizada
              neles (OLT/provisionamento) e o instalador ser rodado de novo com o novo endereço.
            </Alert>
          )}
          {browserLost && <p>Você está acessando por <b>{browserHost}</b>, que vai mudar: depois de aplicar, abra o novo endereço e confirme lá.</p>}
          <p>Se algo der errado (você não conseguir confirmar em {s.confirmSeconds} s), o servidor volta sozinho à configuração atual.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
