// Configurações > Horário: fuso do servidor e servidores NTP (padrão NTP.br), com teste de conexão por servidor.
// O ACS depende do relógio certo (informs, eventos, backup diário); os containers trabalham em UTC.

import { CheckCircle2, CircleAlert, Clock, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { Alert, Badge, Button, Card, Input, Select } from "../../components/ui";

interface TimeState {
  now: number;
  timezone: string | null;
  synchronized: boolean;
  daemon: "chrony" | "timesyncd" | null;
  servers: string[];
  managed: boolean;
  source: { server: string; offsetMs: number | null; stratum: number | null } | null;
  defaults: string[];
  timezones: string[];
}
interface TestResult { server: string; ok: boolean; address?: string; stratum?: number; offsetMs?: number; delayMs?: number; error?: string }

const BRAZIL: [string, string][] = [
  ["America/Sao_Paulo", "Brasília (SP, RJ, MG, Sul, GO, DF…)"],
  ["America/Bahia", "Bahia"],
  ["America/Fortaleza", "Fortaleza (CE, MA, PI, RN, PB)"],
  ["America/Recife", "Recife (PE)"],
  ["America/Maceio", "Maceió (AL, SE)"],
  ["America/Belem", "Belém (PA leste, AP)"],
  ["America/Santarem", "Santarém (PA oeste)"],
  ["America/Araguaina", "Araguaína (TO)"],
  ["America/Cuiaba", "Cuiabá (MT)"],
  ["America/Campo_Grande", "Campo Grande (MS)"],
  ["America/Manaus", "Manaus (AM)"],
  ["America/Porto_Velho", "Porto Velho (RO)"],
  ["America/Boa_Vista", "Boa Vista (RR)"],
  ["America/Rio_Branco", "Rio Branco (AC)"],
  ["America/Eirunepe", "Eirunepé (AM oeste)"],
  ["America/Noronha", "Fernando de Noronha"],
];

const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.abs(v) < 1 ? `${v.toFixed(2)} ms` : `${Math.round(v)} ms`);

export function TimeTab() {
  const [s, setS] = useState<TimeState | null>(null);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [tick, setTick] = useState(Date.now());
  const [tz, setTz] = useState("");
  const [servers, setServers] = useState<string[]>([]);
  const [tests, setTests] = useState<Record<string, TestResult | "testando">>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);

  const apply = (r: TimeState) => {
    setS(r);
    setLoadedAt(Date.now());
    setTz(r.timezone ?? "America/Sao_Paulo");
    setServers(r.managed && r.servers.length ? r.servers : r.servers.length ? r.servers : r.defaults);
  };
  const load = useCallback(async () => {
    try {
      apply(await api<TimeState>("/api/settings/time"));
    } catch (e) {
      setMsg({ tone: e instanceof ApiError && e.code === "no_hostd" ? "warn" : "bad", text: e instanceof Error ? e.message : "erro ao carregar" });
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const test = async (server: string) => {
    const name = server.trim();
    if (!name) return;
    setTests((t) => ({ ...t, [name]: "testando" }));
    try {
      const r = await api<TestResult>("/api/settings/time/test", { body: { server: name } });
      setTests((t) => ({ ...t, [name]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [name]: { server: name, ok: false, error: e instanceof Error ? e.message : "erro" } }));
    }
  };

  const list = servers.map((x) => x.trim()).filter(Boolean);
  const changedTz = !!s && tz !== s.timezone;
  const changedServers = !!s && (!s.managed || !s.daemon || list.join(" ") !== s.servers.join(" "));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<TimeState>("/api/settings/time", { method: "PUT", body: { ...(changedTz ? { timezone: tz } : {}), ...(changedServers ? { servers: list } : {}) } });
      apply(r);
      setMsg({ tone: "ok", text: "Horário gravado. A sincronização com os novos servidores leva alguns segundos." });
      setTimeout(() => void load(), 6000);
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao gravar" });
    } finally {
      setBusy(false);
    }
  };

  if (!s) return msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : <p className="text-sm text-muted">Carregando o horário do servidor...</p>;

  const serverNow = new Date(s.now * 1000 + (tick - loadedAt));
  const others = s.timezones.filter((z) => !BRAZIL.some(([b]) => b === z));
  const off = s.source?.offsetMs ?? null;

  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <Card title={<span className="inline-flex items-center gap-2"><Clock size={18} />Situação atual</span>} actions={s.synchronized ? <Badge tone="ok">sincronizado</Badge> : <Badge tone="bad">não sincronizado</Badge>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted">Horário do servidor</div>
            <div className="text-2xl font-semibold tabular-nums">{serverNow.toLocaleTimeString("pt-BR", { timeZone: s.timezone ?? undefined })}</div>
            <div className="text-xs text-muted">{serverNow.toLocaleDateString("pt-BR", { timeZone: s.timezone ?? undefined, weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Fuso horário</div>
            <div className="font-medium">{s.timezone ?? "—"}</div>
            <div className="text-xs text-muted">UTC agora: {serverNow.toISOString().slice(11, 19)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Sincronizando com</div>
            <div className="font-medium">{s.source?.server ?? "—"}</div>
            <div className="text-xs text-muted">
              {s.daemon ? `${s.daemon === "chrony" ? "chrony" : "systemd-timesyncd"}` : "sem serviço de NTP"}
              {s.source?.stratum ? ` · estrato ${s.source.stratum}` : ""}
              {off !== null ? ` · diferença ${fmtMs(off)}` : ""}
            </div>
          </div>
        </div>
        {!s.daemon ? (
          <div className="mt-4"><Alert tone="warn">O servidor não tem serviço de NTP: a hora não se mantém certa sozinha. Clique em <b>Gravar</b> abaixo e o Zenie instala o chrony e passa a sincronizar com os servidores da lista.</Alert></div>
        ) : !s.synchronized && (
          <div className="mt-4"><Alert tone="warn">O relógio não está sincronizado: teste os servidores abaixo (a porta UDP 123 precisa estar liberada até eles).</Alert></div>
        )}
      </Card>

      <Card title="Configurar">
        <div className="grid max-w-3xl gap-5">
          <div>
            <span className="mb-1 block text-sm font-medium">Fuso horário</span>
            <Select value={tz} onChange={(e) => setTz(e.target.value)} className="max-w-md">
              <optgroup label="Brasil">
                {BRAZIL.filter(([z]) => s.timezones.includes(z)).map(([z, label]) => <option key={z} value={z}>{label} — {z}</option>)}
              </optgroup>
              <optgroup label="Outros">
                {others.map((z) => <option key={z} value={z}>{z}</option>)}
              </optgroup>
            </Select>
            <span className="mt-1 block text-xs text-muted">Vale para o sistema (logs, horário do backup diário). O painel mostra os horários no fuso do navegador.</span>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Servidores NTP</span>
            {!s.managed && <p className="mb-2 text-xs text-muted">Hoje vêm da configuração do sistema. Ao gravar, o servidor passa a usar só a lista abaixo.</p>}
            <div className="space-y-2">
              {servers.map((srv, i) => {
                const t = tests[srv.trim()];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input className="w-64" value={srv} placeholder="a.st1.ntp.br" onChange={(e) => setServers((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} />
                    <Button variant="secondary" onClick={() => void test(srv)} disabled={!srv.trim() || t === "testando"}>{t === "testando" ? "Testando..." : "Testar"}</Button>
                    <button className="rounded-lg p-2 text-muted hover:bg-page hover:text-bad" aria-label="Remover servidor" onClick={() => setServers((xs) => xs.filter((_, j) => j !== i))} disabled={servers.length <= 1}>
                      <Trash2 size={16} />
                    </button>
                    {t && t !== "testando" && (
                      t.ok ? (
                        <span className="inline-flex items-center gap-1 text-xs text-ok"><CheckCircle2 size={14} />respondeu ({t.address}) · estrato {t.stratum} · atraso {fmtMs(t.delayMs)} · diferença {fmtMs(t.offsetMs)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-bad"><CircleAlert size={14} />{t.error}</span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setServers((xs) => [...xs, ""])} disabled={servers.length >= 5}><Plus size={15} />Adicionar servidor</Button>
              <Button variant="secondary" onClick={() => setServers(s.defaults)}>Usar padrão NTP.br</Button>
            </div>
          </div>

          <div>
            <Button onClick={() => void save()} disabled={busy || !list.length || (!changedTz && !changedServers)}>{busy ? "Gravando..." : "Gravar"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
