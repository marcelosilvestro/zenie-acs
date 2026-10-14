// Abas da ficha do equipamento. Recebem o modelo normalizado do zenie-api (nunca caminhos TR-069).

import { Activity, Cable, Clock, Gauge, Info, Monitor, RefreshCw, Smartphone, Thermometer, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, describeStandard, formatDateTime, formatDuration, timeAgo, wifiGeneration, type DeviceClients, type DeviceDetail, type Level, type MeshClients, type MeshListStatus, type TaskResult, type WifiBand, type WifiClient } from "../../api";
import { OnlineBadge, RxBadge, WifiGenBadge } from "../../components/status";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, InfoRow, Switch } from "../../components/ui";
import { LoadBar } from "./Diagnostics";
import { RecentEvents } from "./EventsTab";

const LEVEL_TEXT: Record<Level, string> = { ok: "text-ok", warn: "text-[#b45309]", bad: "text-bad" };
const LEVEL_LABEL: Record<Level, string> = { ok: "Normal", warn: "Atenção", bad: "Crítico" };

const PPP_ERRORS: Record<string, string> = {
  ERROR_NONE: "nenhum",
  ERROR_AUTHENTICATION_FAILURE: "falha de autenticação (usuário/senha PPPoE)",
  ERROR_ISP_TIME_OUT: "sem resposta do servidor PPPoE",
  ERROR_IDLE_DISCONNECT: "desconectado por inatividade",
};

function Metric({ icon, label, value, sub, level }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; level?: Level | null }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-card p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className={`mt-0.5 text-lg font-semibold ${level ? LEVEL_TEXT[level] : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
    </div>
  );
}

function Updated({ at }: { at: string | null | undefined }) {
  return <span className="text-xs font-normal text-muted">{at ? `lido ${timeAgo(at)}` : "ainda não lido"}</span>;
}

const NoPon = () => (
  <Alert tone="info">
    Este equipamento é um <b>roteador</b> (sem fibra). Nos prédios com ONU em bridge, o sinal óptico só pode ser visto
    na <b>OLT</b>.
  </Alert>
);

/** Cor da velocidade de porta Ethernet: 10 Mbps vermelho, 100 Mbps amarelo, 1000+ verde. */
function speedTone(mbps: number | null): { cls: string; hint?: string } {
  if (mbps === null) return { cls: "text-muted" };
  if (mbps <= 10) return { cls: "font-semibold text-bad", hint: "Porta a 10 Mbps: cabo danificado ou mal crimpado — limita muito a internet do cliente" };
  if (mbps < 1000) return { cls: "font-semibold text-[#b45309]", hint: "Porta a 100 Mbps: cabo, porta ou aparelho limitando planos acima de 100 Mega" };
  return { cls: "font-semibold text-ok" };
}

/** Velocidade da porta WAN: Ethernet colorida pela velocidade; linha GPON (fixa) sem cor. */
function WanLink({ link }: { link: DeviceDetail["wan"]["link"] }) {
  if (!link || (link.downMbps === null && !link.status)) return <>{null}</>;
  if (link.status && link.status !== "Up") return <Badge tone="bad">sem link ({link.status})</Badge>;
  const isEth = /ethernet/i.test(link.access ?? "");
  const down = link.downMbps;
  if (down === null) return <Badge tone="ok">Conectada</Badge>;
  const speed = link.upMbps !== null && link.upMbps !== down ? `${down} / ${link.upMbps} Mbps` : `${down} Mbps`;
  if (!isEth) return <span>{`${link.access ?? "PON"} ${speed}`}</span>;
  const tone = speedTone(down);
  return <span className={tone.cls} title={tone.hint}>{speed}</span>;
}

// ------------------------------------------------------------------------------------- Escala de RX

/** Barra de -30 a -5 dBm com as faixas do NOC e o marcador do RX atual. */
export function RxScale({ rx, rules }: { rx: number; rules: DeviceDetail["rules"]["rx"] }) {
  const min = -30;
  const max = -5;
  const pos = (v: number) => `${((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100}%`;
  return (
    <div className="pt-6">
      <div className="relative h-3 rounded-full bg-slate-100">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-bad/70" style={{ width: pos(rules.badAtOrBelow) }} />
        <div className="absolute inset-y-0 bg-warn/80" style={{ left: pos(rules.badAtOrBelow), width: `calc(${pos(rules.goodAbove)} - ${pos(rules.badAtOrBelow)})` }} />
        <div className="absolute inset-y-0 bg-ok/80" style={{ left: pos(rules.goodAbove), width: `calc(${pos(rules.saturationAbove)} - ${pos(rules.goodAbove)})` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-bad/70" style={{ left: pos(rules.saturationAbove) }} />
        <div className="absolute -top-6 -translate-x-1/2 text-xs font-semibold" style={{ left: pos(rx) }}>{rx.toFixed(1)}</div>
        <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded bg-ink" style={{ left: pos(rx) }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        {[-30, -25, -20, -15, -10, -5].map((v) => <span key={v}>{v}</span>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />bom: acima de {rules.goodAbove}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />atenção: {rules.goodAbove} a {rules.badAtOrBelow}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-bad" />ruim: {rules.badAtOrBelow} ou pior, ou acima de {rules.saturationAbove}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ Resumo

export function OverviewTab({ d, onTab }: { d: DeviceDetail; onTab: (t: string) => void }) {
  const o = d.optical;
  // Sem PON (roteador): os cards ópticos dão lugar a porta WAN e dispositivos na rede.
  const noOptical = d.capabilities?.optical?.status === "nao-suportado" || ((o?.rx === null || o?.rx === undefined) && d.identity.accessType === "Roteador");
  // Clientes Wi-Fi: só quando o modelo informa (senão "0 clientes" seria falso).
  const clientsKnown = d.capabilities?.wifiClients?.status !== "nao-suportado" && d.wifi.bands.some((b) => b.clients !== null);
  const wifiClients = d.wifi.bands.reduce((s, b) => s + (b.clients ?? 0), 0);
  // Modelo com mesh: o contador da faixa é só do roteador principal (os satélites aparecem na aba Clientes).
  const meshModel = d.capabilities?.mesh?.status !== undefined && d.capabilities.mesh.status !== "nao-suportado";
  const hosts = d.clients.hosts;
  const activeHosts = hosts ? hosts.filter((h) => h.active !== false).length : null;
  return (
    <div className="space-y-5">
      <RecentEvents id={d.id} onTab={onTab} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={<Activity size={20} />} label="Status" value={<OnlineBadge state={d.status.state} />} sub={`último inform ${timeAgo(d.status.lastInform)}`} />
        {noOptical ? (
          <>
            <Metric icon={<Cable size={20} />} label="Porta WAN" value={d.wan.link?.downMbps || d.wan.link?.status ? <WanLink link={d.wan.link} /> : "—"} sub={d.wan.link?.access ?? undefined} />
            <Metric
              icon={<Wifi size={20} />}
              label="Dispositivos na rede"
              value={activeHosts !== null ? String(activeHosts) : "—"}
              sub={activeHosts !== null ? `lista DHCP lida ${timeAgo(d.clients.hostsUpdatedAt)}` : "abra a aba Clientes para ler"}
            />
          </>
        ) : (
          <>
            <Metric
              icon={<Gauge size={20} />}
              label="Sinal óptico RX / TX"
              value={o?.rx !== null && o?.rx !== undefined ? `${o.rx.toFixed(2)} / ${o.tx?.toFixed(2) ?? "—"} dBm` : "sem PON"}
              level={o?.rxLevel}
              sub={o?.rxLevel ? LEVEL_LABEL[o.rxLevel] : undefined}
            />
            <Metric icon={<Thermometer size={20} />} label="Temperatura do módulo óptico" value={o?.temperature !== null && o?.temperature !== undefined ? `${o.temperature.toFixed(1)} °C` : "—"} level={o?.temperatureLevel} sub={o?.temperatureLevel ? LEVEL_LABEL[o.temperatureLevel] : undefined} />
          </>
        )}
        <Metric icon={<Clock size={20} />} label="Ligado há" value={formatDuration(d.status.uptimeSec)} sub={d.status.lastBoot ? `último boot ${formatDateTime(d.status.lastBoot)}` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
        <Card title="Internet (WAN)" actions={<Updated at={d.wan.updatedAt} />}>
          <InfoRow label="Status" value={d.wan.status && <Badge tone={d.wan.status === "Connected" ? "ok" : "bad"}>{d.wan.status === "Connected" ? "Conectado" : d.wan.status}</Badge>} />
          <InfoRow label="Porta WAN" value={d.wan.link?.downMbps || d.wan.link?.status ? <WanLink link={d.wan.link} /> : null} />
          <InfoRow label="IP WAN" value={d.wan.ip} mono />
          <InfoRow label="Login PPPoE" value={d.wan.pppoe} />
          {d.wan.uptimeSec !== undefined && d.wan.uptimeSec !== null && <InfoRow label="Conectado há" value={formatDuration(d.wan.uptimeSec)} />}
          {d.wan.lastError && <InfoRow label="Último erro PPPoE" value={PPP_ERRORS[d.wan.lastError] ?? d.wan.lastError} />}
        </Card>
        <Card title="Portas LAN" actions={<Updated at={d.ports.updatedAt} />}>
          {d.ports.list.length === 0 ? <p className="text-sm text-muted">Não disponível</p> : d.ports.list.map((p) => <PortRow key={p.port} p={p} />)}
        </Card>
        <Card title="Equipamento" actions={<Updated at={d.system.updatedAt} />}>
          <InfoRow label="Modelo" value={[d.identity.vendor, d.identity.model].filter(Boolean).join(" ")} />
          <InfoRow label="Firmware" value={d.identity.firmware} />
          <LoadBar label="CPU" value={d.system.cpu} level={d.system.cpuLevel} />
          <LoadBar label="Memória" value={d.system.memory} level={d.system.memoryLevel} />
          {d.system.cpu === null && d.system.memory === null && <p className="mt-1 text-xs text-muted">CPU e memória são lidas ao clicar em Atualizar.</p>}
        </Card>
        <Card title="Wi-Fi" actions={<button className="text-xs text-brand hover:underline" onClick={() => onTab("wifi")}>detalhes</button>}>
          {d.wifi.unify?.unified && <div className="mb-2"><Badge tone="info">2,4 e 5 GHz unificados</Badge></div>}
          {d.wifi.bands.map((b) => (
            <InfoRow key={b.band} label={`${b.band} GHz`} value={b.enabled === null ? null : b.enabled ? (clientsKnown ? `${b.ssid ?? "—"} · ${b.clients ?? 0} cliente(s)${meshModel ? " no principal" : ""}` : b.ssid ?? "—") : "desligado"} />
          ))}
          <div className="mt-3">
            <Button variant="secondary" className="w-full" onClick={() => onTab("clientes")}>
              {clientsKnown ? (meshModel ? `Ver todos os clientes (${wifiClients} no principal; a mesh é lida na aba)` : `Ver ${wifiClients} cliente(s) Wi-Fi e dispositivos da rede`) : "Ver dispositivos da rede"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function PortRow({ p }: { p: DeviceDetail["ports"]["list"][number] }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
      <span className="flex items-center gap-2"><Cable size={14} className="text-muted" />{p.name}</span>
      {p.up ? (
        <span className="flex items-center gap-2">
          <Badge tone="ok">Conectada</Badge>
          <span className={`w-20 text-right text-xs ${speedTone(p.speedMbps).cls}`} title={speedTone(p.speedMbps).hint}>
            {p.speedMbps ? `${p.speedMbps} Mbps` : ""}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-2"><Badge>Desconectada</Badge><span className="w-20" /></span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------ Sinal óptico

export function OpticalTab({ d }: { d: DeviceDetail }) {
  const o = d.optical;
  if (!o) return <NoPon />;
  const lvl = (l: Level | null) => (l ? <Badge tone={l}>{LEVEL_LABEL[l]}</Badge> : null);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Potência recebida (RX)" className="lg:col-span-2" actions={<Updated at={o.updatedAt} />}>
        {o.rx === null ? (
          <p className="text-sm text-muted">Sem leitura de RX (fibra desconectada ou sem luz?)</p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className={`text-4xl font-semibold ${o.rxLevel ? LEVEL_TEXT[o.rxLevel] : ""}`}>{o.rx.toFixed(2)}</span>
              <span className="mb-1 text-muted">dBm</span>
              <span className="mb-1.5">{lvl(o.rxLevel)}</span>
            </div>
            <RxScale rx={o.rx} rules={d.rules.rx} />
          </>
        )}
      </Card>
      <Card title="Transceptor">
        <InfoRow label="Status PON" value={o.ponStatus && <Badge tone={o.ponStatus === "Up" ? "ok" : "bad"}>{o.ponStatus}</Badge>} />
        <InfoRow label="TX (transmitida)" value={o.tx !== null ? <span className="flex items-center gap-2">{o.tx.toFixed(2)} dBm {lvl(o.txLevel)}</span> : null} />
        <InfoRow label="Temperatura" value={o.temperature !== null ? <span className="flex items-center gap-2">{o.temperature.toFixed(1)} °C {lvl(o.temperatureLevel)}</span> : null} />
        <InfoRow label="Tensão" value={o.voltage !== null ? `${o.voltage.toFixed(2)} V` : null} />
        <InfoRow label="Corrente do laser" value={o.biasCurrent !== null ? `${o.biasCurrent.toFixed(2)} mA` : null} />
        <InfoRow label="Serial PON" value={d.identity.ponSerial} mono />
      </Card>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- Rede


export function NetworkTab({ d }: { d: DeviceDetail }) {
  const w = d.wan;
  const l = d.lan;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Internet (WAN)" actions={<Updated at={w.updatedAt} />}>
        <InfoRow label="Status" value={w.status && <Badge tone={w.status === "Connected" ? "ok" : "bad"}>{w.status === "Connected" ? "Conectado" : w.status}</Badge>} />
        <InfoRow label="Tipo" value={w.type} />
        <InfoRow label="Porta WAN" value={w.link?.downMbps || w.link?.status ? <WanLink link={w.link} /> : null} />
        <InfoRow label="Login PPPoE" value={w.pppoe} />
        <InfoRow label="IP WAN" value={w.ip} mono />
        <InfoRow label="IPv6 WAN" value={w.ipv6 ?? (w.ipv6Status ? `sem endereço (status: ${w.ipv6Status})` : null)} mono />
        <InfoRow label="Prefixo IPv6 WAN" value={w.ipv6Prefix} mono />
        <InfoRow label="Gateway" value={w.gateway} mono />
        <InfoRow label="DNS" value={w.dns?.join(", ")} mono />
        <InfoRow label="DNS IPv6" value={w.ipv6Dns?.join(", ")} mono />
        <InfoRow label="MTU" value={w.mtu} />
        <InfoRow label="VLAN" value={w.vlan ?? (d.identity.accessType === "Roteador" ? "sem VLAN (atrás de ONU bridge)" : null)} />
        <InfoRow label="Serviços" value={w.services} />
        <InfoRow label="Conectado há" value={w.uptimeSec !== undefined && w.uptimeSec !== null ? formatDuration(w.uptimeSec) : null} />
        <InfoRow label="Último erro PPPoE" value={w.lastError ? PPP_ERRORS[w.lastError] ?? w.lastError : null} />
      </Card>
      <div className="space-y-5">
        <Card title="Rede local (LAN)" actions={<Updated at={l.updatedAt} />}>
          <InfoRow label="IP do equipamento" value={l.ip} mono />
          <InfoRow label="Máscara" value={l.mask} mono />
          <InfoRow label="Prefixo IPv6 delegado" value={l.ipv6Delegated} mono />
          {l.ipv6Address && <InfoRow label="IPv6 do equipamento" value={l.ipv6Address} mono />}
          <InfoRow label="Servidor DHCP" value={l.dhcp === null || l.dhcp === undefined ? null : l.dhcp ? "ligado" : "desligado"} />
          <InfoRow label="Faixa DHCP" value={l.dhcpStart && l.dhcpEnd ? `${l.dhcpStart} – ${l.dhcpEnd}` : null} mono />
          <InfoRow label="DNS entregue" value={l.dns?.join(", ")} mono />
          <InfoRow
            label="DNS IPv6 entregue"
            value={l.ipv6Dns ? (l.ipv6Dns.manual && l.ipv6Dns.servers.length ? l.ipv6Dns.servers.join(", ") : "automático (repassa o da WAN)") : null}
            mono={!!l.ipv6Dns?.manual}
          />
          <InfoRow label="Tempo de concessão" value={l.leaseSec ? formatDuration(l.leaseSec) : null} />
        </Card>
        <Card title="Portas LAN" actions={<Updated at={d.ports.updatedAt} />}>
          {d.ports.list.length === 0 ? <p className="text-sm text-muted">Não disponível</p> : d.ports.list.map((p) => <PortRow key={p.port} p={p} />)}
        </Card>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- Wi-Fi

function BandCard({ b, d, canEdit, onUpdated, onNotice }: {
  b: WifiBand;
  d: DeviceDetail;
  canEdit: boolean;
  onUpdated: (d: DeviceDetail) => void;
  onNotice: (n: { tone: "ok" | "bad" | "warn"; text: string }) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = `Wi-Fi ${b.band} GHz`;
  const turnOn = !b.enabled;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; failure: { message?: string; outcome: string } | null; device: DeviceDetail | null }>(
        `/api/devices/${encodeURIComponent(d.id)}/wifi`,
        { body: { [b.band === "2.4" ? "band24" : "band5"]: { enabled: turnOn } } },
      );
      if (res.device) onUpdated(res.device);
      onNotice(res.ok
        ? { tone: "ok", text: `${label} ${turnOn ? "ligado" : "desligado"}.` }
        : { tone: "bad", text: `Não foi possível ${turnOn ? "ligar" : "desligar"} o ${label}: ${res.failure?.message ?? res.failure?.outcome}.` });
    } catch (e) {
      onNotice({ tone: "bad", text: e instanceof Error ? e.message : "erro" });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Card
      title={<span className="flex items-center gap-2">{b.enabled ? <Wifi size={16} className="text-brand" /> : <WifiOff size={16} className="text-muted" />}{label}</span>}
      actions={
        <div className="flex items-center gap-2">
          {b.enabled === null ? null : canEdit ? (
            <>
              <span className={`text-xs font-medium ${b.enabled ? "text-ok" : "text-muted"}`}>{busy ? "aplicando..." : b.enabled ? "Ligado" : "Desligado"}</span>
              <Switch checked={!!b.enabled} disabled={busy} label={`Ligar/desligar ${label}`} onChange={() => setConfirm(true)} />
            </>
          ) : b.enabled ? <Badge tone="ok">Ativo</Badge> : <Badge>Desligado</Badge>}
        </div>
      }
    >
      <InfoRow label="SSID" value={b.ssid} />
      <InfoRow label="Canal" value={b.channel} />
      <InfoRow label="Largura de banda" value={b.bandwidth} />
      <InfoRow
        label="Padrão"
        value={b.standard ? <span className="inline-flex items-center gap-2"><WifiGenBadge gen={wifiGeneration(b.standard)} />{describeStandard(b.standard)}</span> : null}
      />
      <InfoRow label="Segurança" value={b.security} />
      <InfoRow label="Potência" value={b.txPower} />
      <InfoRow label="Clientes conectados" value={b.clients} />
      <ConfirmDialog
        open={confirm}
        title={`${turnOn ? "Ligar" : "Desligar"} o ${label}?`}
        danger={!turnOn}
        busy={busy}
        confirmLabel={turnOn ? "Ligar" : "Desligar"}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void apply()}
      >
        {turnOn
          ? <p>A rede <b>{b.ssid ?? label}</b> volta a aparecer para os aparelhos do cliente.</p>
          : <p>A rede <b>{b.ssid ?? label}</b> some e os aparelhos conectados nessa faixa <b>vão cair</b>.</p>}
        {!turnOn && d.wifi.unify?.unified && (
          <p className="mt-2 rounded-lg bg-warn/10 p-2 text-[#b45309]">Com a rede unificada, alguns equipamentos desligam <b>as duas faixas</b> juntas (ex.: ZTE H196A V9) — o cliente pode ficar sem Wi-Fi.</p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

export function WifiTab({ d, onEdit, canEdit, onUpdated, onNotice }: {
  d: DeviceDetail;
  onEdit?: () => void;
  canEdit: boolean;
  onUpdated: (d: DeviceDetail) => void;
  onNotice: (n: { tone: "ok" | "bad" | "warn"; text: string }) => void;
}) {
  return (
    <div className="space-y-5">
      {(onEdit || d.wifi.unify?.unified === true) && (
        <div className="flex flex-wrap items-center gap-3">
          {onEdit && <Button onClick={onEdit}><Wifi size={16} />Alterar Wi-Fi</Button>}
          {d.wifi.unify?.unified === true && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <span title={`${d.wifi.unify.label}: 2,4 e 5 GHz com o mesmo nome e senha`}>
                <Badge tone="info">2,4 e 5 GHz unificados</Badge>
              </span>
              mesmo nome e senha nas duas faixas
            </p>
          )}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {d.wifi.bands.map((b) => <BandCard key={b.band} b={b} d={d} canEdit={canEdit} onUpdated={onUpdated} onNotice={onNotice} />)}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------- Clientes

const QUALITY_TONE = { excelente: "ok", bom: "ok", fraco: "warn", "muito fraco": "bad" } as const;

type ClientRow = WifiClient & { node?: string | null; fromMesh?: boolean };

/** Roteador da mesh onde o aparelho está (nome do modelo + papel). */
function NodeCell({ mesh, node }: { mesh: MeshClients; node: string | null | undefined }) {
  const n = mesh.nodes.find((x) => x.key === node);
  if (!n) return <span className="text-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      {n.model ?? (n.role === "principal" ? "Principal" : "Satélite")}
      <span className="block text-xs text-muted">{n.role}</span>
    </span>
  );
}

export function ClientsTab({ d, canRefresh }: { d: DeviceDetail; canRefresh: boolean }) {
  const [clients, setClients] = useState<DeviceClients>(d.clients);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TaskResult | null>(null);
  const [mesh, setMesh] = useState<MeshClients | null>(null);
  const [meshStatus, setMeshStatus] = useState<MeshListStatus | null>(null);
  // Modelo com mesh (homologada ou a validar): a lista só fica completa depois de ler todos os roteadores.
  const hasMesh = d.capabilities?.mesh?.status !== undefined && d.capabilities.mesh.status !== "nao-suportado";

  const read = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await api<{ result: TaskResult; clients: DeviceClients | null; mesh?: MeshClients | null; meshStatus?: MeshListStatus | null }>(`/api/devices/${encodeURIComponent(d.id)}/clients`, { method: "POST" });
      setResult(res.result);
      if (res.clients) setClients(res.clients);
      setMesh(res.mesh ?? null);
      setMeshStatus(res.meshStatus ?? null);
    } catch (e) {
      setResult({ ok: false, outcome: "fault", message: e instanceof Error ? e.message : "erro", ms: 0 });
    } finally {
      setLoading(false);
    }
  };

  // Lê na hora ao abrir a aba (listas são caras e só são lidas sob demanda).
  useEffect(() => {
    if (canRefresh && d.status.state !== "offline") void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  // Mesh: a lista própria (VP) é a do roteador principal; os satélites vêm da topologia EasyMesh.
  // Entradas com Active=0 são antigas (aparelho saiu ou trocou de nó) e ficam de fora.
  const own = clients.wifi ?? [];
  const nodeOf = new Map<string, string>();
  for (const s of mesh?.stations ?? []) if (s.active !== false && !nodeOf.has(s.mac)) nodeOf.set(s.mac, s.node);
  const wifi: ClientRow[] = [
    ...own.map((c) => ({ ...c, node: mesh ? "controller" : null })),
    ...(mesh?.stations ?? [])
      .filter((s) => s.node !== "controller" && s.active !== false && (s.band === "2.4" || s.band === "5") && !own.some((c) => c.mac === s.mac))
      .map((s) => ({ band: s.band, ssid: 1, mac: s.mac, ip: s.ip, name: s.name, rssi: s.signal, rateMbps: null, connectedSec: null, quality: s.quality, vendor: s.vendor, node: s.node, fromMesh: true })),
  ];
  const hosts = clients.hosts ?? [];
  // Aparelho ativo que não aparece em nenhum satélite está no principal (cabo ou Wi-Fi dele).
  const hostNode = (mac: string, active: boolean | null) => (!mesh ? null : nodeOf.get(mac) ?? (active === false ? null : "controller"));
  const wired = hosts.filter((h) => h.iface === "cabo" && h.active !== false);
  const count = (band: string) => wifi.filter((c) => c.band === band).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid flex-1 grid-cols-3 gap-3 sm:max-w-xl">
          <Metric icon={<Wifi size={18} />} label="Wi-Fi 2,4 GHz" value={count("2.4")} />
          <Metric icon={<Wifi size={18} />} label="Wi-Fi 5 GHz" value={count("5")} />
          <Metric icon={<Cable size={18} />} label="Cabo" value={wired.length} />
        </div>
        {canRefresh && (
          <Button variant="secondary" onClick={() => void read()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            {loading ? "Lendo do equipamento..." : "Ler agora"}
          </Button>
        )}
      </div>
      {result && !result.ok && <Alert tone="warn">Não foi possível ler agora: {result.message}. Mostrando a última leitura ({timeAgo(clients.wifiUpdatedAt)}).</Alert>}
      {/* Situação da mesh: nunca mostrar só o roteador principal como se fosse a lista completa */}
      {loading && (
        <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted">
          <RefreshCw size={13} className="animate-spin" />
          Lendo os aparelhos do equipamento{hasMesh ? " e de todos os roteadores da mesh (pode levar alguns segundos)" : ""}. Até terminar, a lista abaixo é a da última leitura.
        </p>
      )}
      {!loading && meshStatus === "ok" && mesh && <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted"><Info size={13} />Rede mesh com {mesh.nodes.length} roteadores: as listas incluem os aparelhos de todos eles.</p>}
      {!loading && meshStatus === "desatualizada" && mesh && <Alert tone="warn">Não foi possível ler os roteadores da mesh agora: os aparelhos dos {mesh.nodes.length - 1} satélite(s) são da última leitura.</Alert>}
      {!loading && meshStatus === "falhou" && <Alert tone="warn">Não foi possível ler os roteadores da mesh: <b>a lista pode estar incompleta</b> (só os aparelhos do roteador principal). Tente "Ler agora" ou abra a aba Mesh.</Alert>}

      <Card title="Aparelhos no Wi-Fi" actions={<Updated at={clients.wifiUpdatedAt} />}>
        {wifi.some((c) => c.source === "hosts") && (
          <p className="-mt-1 mb-4 text-xs text-muted">Este modelo não informa o sinal (RSSI) nem a velocidade de cada aparelho: a lista vem da tabela de dispositivos da rede.</p>
        )}
        {wifi.length === 0 ? (
          <EmptyState icon={<Smartphone size={28} />} title={clients.wifi === null ? "Lista ainda não lida" : "Nenhum aparelho no Wi-Fi"} />
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Aparelho</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                  <th className="px-5 py-3 font-medium">MAC</th>
                  <th className="px-5 py-3 font-medium">Faixa</th>
                  {mesh && <th className="px-5 py-3 font-medium">Roteador</th>}
                  <th className="px-5 py-3 font-medium">Sinal</th>
                  <th className="px-5 py-3 font-medium">Velocidade</th>
                  <th className="px-5 py-3 font-medium">Conectado há</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {wifi.map((c) => (
                  <tr key={`${c.band}-${c.mac}`}>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-2">
                        <Smartphone size={15} className="shrink-0 text-muted" />
                        <span>
                          {c.name ?? <span className="text-muted">sem nome</span>}
                          {c.vendor && <span className="block text-xs text-muted">{c.vendor}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs">{c.ip ?? "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs">{c.mac}</td>
                    <td className="px-5 py-2.5">{c.band ? `${c.band} GHz` : "—"}{c.ssid !== 1 && c.ssid !== 5 && <span className="text-xs text-muted"> (SSID {c.ssid})</span>}</td>
                    {mesh && <td className="px-5 py-2.5"><NodeCell mesh={mesh} node={c.node} /></td>}
                    <td className="whitespace-nowrap px-5 py-2.5">
                      {c.rssi !== null && c.quality ? <Badge tone={QUALITY_TONE[c.quality]}>{c.rssi} dBm · {c.quality}</Badge> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-5 py-2.5">{c.rateMbps !== null ? `${c.rateMbps} Mbps` : "—"}</td>
                    <td className="px-5 py-2.5 text-muted">{formatDuration(c.connectedSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {wifi.some((c) => c.fromMesh) && (
          <p className="mt-4 text-xs text-muted">Aparelhos nos satélites: o roteador principal informa o sinal, mas não a velocidade nem há quanto tempo estão conectados.</p>
        )}
      </Card>

      <Card title="Dispositivos na rede (DHCP)" actions={<Updated at={clients.hostsUpdatedAt} />}>
        {hosts.length === 0 ? (
          <EmptyState icon={<Monitor size={28} />} title={clients.hosts === null ? "Lista ainda não lida" : "Nenhum dispositivo"} />
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Nome</th>
                  <th className="px-5 py-3 font-medium">IP</th>
                  <th className="px-5 py-3 font-medium">MAC</th>
                  <th className="px-5 py-3 font-medium">Conexão</th>
                  {mesh && <th className="px-5 py-3 font-medium">Roteador</th>}
                  <th className="px-5 py-3 font-medium">Origem</th>
                  <th className="px-5 py-3 font-medium">Ativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {hosts.map((h) => (
                  <tr key={h.mac}>
                    <td className="px-5 py-2.5">
                      {h.name ?? <span className="text-muted">sem nome</span>}
                      {h.vendor && <span className="block text-xs text-muted">{h.vendor}</span>}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs">{h.ip ?? "—"}</td>
                    <td className="px-5 py-2.5 font-mono text-xs">{h.mac}</td>
                    <td className="px-5 py-2.5">{h.iface === "wifi" ? <span className="flex items-center gap-1.5"><Wifi size={14} />Wi-Fi</span> : h.iface === "cabo" ? <span className="flex items-center gap-1.5"><Cable size={14} />Cabo</span> : h.iface ?? "—"}</td>
                    {mesh && <td className="px-5 py-2.5"><NodeCell mesh={mesh} node={hostNode(h.mac, h.active)} /></td>}
                    <td className="px-5 py-2.5 text-muted">{h.source ?? "—"}</td>
                    <td className="px-5 py-2.5">{h.active === null ? "—" : h.active ? <Badge tone="ok">sim</Badge> : <Badge>não</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted"><Info size={13} />Sinal: excelente ≥ −60 · bom ≥ −67 · fraco ≥ −75 · muito fraco abaixo disso (dBm).</p>
    </div>
  );
}

export { RxBadge };
