// Aba Mesh: primeiro a árvore de roteadores (topologia EasyMesh lida do controlador, inclusive
// satélites fora do ACS); ao clicar num roteador, carrega os aparelhos daquele nó.

import { Cable, ExternalLink, Network, RefreshCw, Router, Smartphone, Wifi } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, formatDateTime, type DeviceDetail, type MeshNode, type MeshStation, type MeshTopology, type TaskResult } from "../../api";
import { Alert, Badge, Button, Card, EmptyState, InfoRow } from "../../components/ui";

const QUALITY_TONE = { excelente: "ok", bom: "ok", fraco: "warn", "muito fraco": "bad" } as const;

/** Conector entre o nó e o pai: cabo (velocidade colorida) ou Wi-Fi (sinal colorido). */
function Link({ n }: { n: MeshNode }) {
  const b = n.backhaul;
  // Sem dados do backhaul (ex.: satélite que o firmware do principal não identifica): só a linha.
  if (!b) return <div className="h-10 w-px bg-line" />;
  const tone =
    b.kind === "cabo"
      ? b.phyMbps === null ? "text-muted" : b.phyMbps <= 10 ? "text-bad" : b.phyMbps < 1000 ? "text-[#b45309]" : "text-ok"
      : b.signal === null ? "text-muted" : b.signal >= -60 ? "text-ok" : b.signal >= -70 ? "text-[#b45309]" : "text-bad";
  return (
    <div className="flex flex-col items-center">
      <div className="h-5 w-px bg-line" />
      <div className={`flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-medium ${tone}`}>
        {b.kind === "wifi" ? <Wifi size={12} /> : <Cable size={12} />}
        {b.kind === "wifi" ? `${b.signal ?? "?"} dBm` : b.phyMbps ? `${b.phyMbps} Mbps` : "cabo"}
      </div>
      <div className="h-5 w-px bg-line" />
    </div>
  );
}

function NodeCard({ n, selected, onClick }: { n: MeshNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-44 flex-col items-center rounded-2xl border bg-card px-3 py-4 text-center transition hover:border-brand/50 ${selected ? "border-brand ring-2 ring-brand/20" : "border-line"}`}
    >
      <div className={`relative flex h-14 w-14 items-center justify-center rounded-full ${n.role === "principal" ? "bg-brand/10 text-brand" : "bg-page text-muted"}`}>
        <Router size={26} />
        {n.clientCount !== null && (
          <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white" title="aparelhos conectados">
            {n.clientCount}
          </span>
        )}
      </div>
      <div className="mt-2 text-sm font-semibold">{n.model ?? (n.role === "satélite" ? "Satélite" : "Roteador")}</div>
      <div className="font-mono text-[11px] text-muted">{n.mac ?? "—"}</div>
      <div className="mt-1 flex gap-1">
        <Badge tone={n.role === "principal" ? "info" : "neutral"}>{n.role}</Badge>
        {n.active === false && <Badge tone="bad">inativo</Badge>}
      </div>
    </button>
  );
}

/** Desenha um nó e, embaixo, seus filhos (ligados pelo MAC do pai). */
function Tree({ node, all, selected, onSelect }: { node: MeshNode; all: MeshNode[]; selected: string | null; onSelect: (k: string) => void }) {
  const kids = all.filter((c) => c.key !== node.key && c.parentMac && c.parentMac === node.mac);
  return (
    <div className="flex flex-col items-center">
      <NodeCard n={node} selected={selected === node.key} onClick={() => onSelect(node.key)} />
      {kids.length > 0 && (
        <div className="flex items-start justify-center gap-6">
          {kids.map((k) => (
            <div key={k.key} className="flex flex-col items-center">
              <Link n={k} />
              <Tree node={k} all={all} selected={selected} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stations({ list: raw }: { list: MeshStation[] }) {
  // A ZTE mantém na tabela aparelhos que já saíram (Active=0): ficam escondidos, como histórico.
  const [showOld, setShowOld] = useState(false);
  const isOld = (s: MeshStation) => s.active === false;
  const current = raw.filter((s) => !isOld(s));
  const old = raw.filter(isOld);
  const list = showOld ? [...current, ...old] : current;
  return (
    <>
      {current.length === 0 && <p className="py-3 text-sm text-muted">Nenhum aparelho conectado neste roteador agora.</p>}
      {list.length > 0 && (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Aparelho</th>
                <th className="px-5 py-2 font-medium">Conexão</th>
                <th className="px-5 py-2 font-medium">Sinal</th>
                <th className="px-5 py-2 font-medium">IP</th>
                <th className="px-5 py-2 font-medium">MAC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.map((s) => (
                <tr key={s.mac} className={isOld(s) ? "text-muted" : ""}>
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2">
                      <Smartphone size={14} className="shrink-0 text-muted" />
                      <span>
                        {s.name ?? <span className="text-muted">sem nome</span>}
                        {s.vendor && <span className="block text-xs text-muted">{s.vendor}</span>}
                        {isOld(s) && <span className="block text-xs">desconectado{s.associatedAt ? ` · última conexão ${formatDateTime(s.associatedAt)}` : ""}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-2">{s.band === "cabo" ? <span className="flex items-center gap-1.5"><Cable size={14} />Cabo</span> : s.band ? `Wi-Fi ${s.band} GHz` : "—"}</td>
                  <td className="whitespace-nowrap px-5 py-2">{!isOld(s) && s.signal !== null && s.quality ? <Badge tone={QUALITY_TONE[s.quality]}>{s.signal} dBm · {s.quality}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-5 py-2 font-mono text-xs">{s.ip ?? "—"}</td>
                  <td className="px-5 py-2 font-mono text-xs">{s.mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {old.length > 0 && (
        <button className="mt-3 text-xs text-muted hover:text-ink hover:underline" onClick={() => setShowOld((v) => !v)}>
          {showOld ? "ocultar desconectados" : `mostrar ${old.length} desconectado${old.length > 1 ? "s" : ""} (histórico)`}
        </button>
      )}
    </>
  );
}

function NodeDetail({ d, n, canRefresh }: { d: DeviceDetail; n: MeshNode; canRefresh: boolean }) {
  const navigate = useNavigate();
  const [list, setList] = useState<MeshStation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canRefresh) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ result: TaskResult; stations: MeshStation[] | null }>(`/api/devices/${encodeURIComponent(d.id)}/mesh/${n.key}`, { method: "POST" });
      if (!res.result.ok) setError(`Não foi possível ler agora: ${res.result.message ?? res.result.outcome}. Mostrando a última leitura.`);
      setList(res.stations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro");
    } finally {
      setLoading(false);
    }
  }, [d.id, n.key, canRefresh]);

  useEffect(() => {
    setList(null);
    void load();
  }, [load]);

  return (
    <Card
      title={<span className="flex items-center gap-2"><Router size={16} />{n.model ?? (n.role === "satélite" ? "Satélite" : "Roteador")} <Badge tone={n.role === "principal" ? "info" : "neutral"}>{n.role}</Badge></span>}
      actions={
        <div className="flex items-center gap-3">
          {n.role === "satélite" && (n.deviceId ? (
            <button className="flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => navigate(`/dispositivos/${encodeURIComponent(n.deviceId!)}`)}>abrir ficha <ExternalLink size={12} /></button>
          ) : (
            <span className="text-xs text-muted" title="Este satélite não está gerenciado pelo ACS; os dados vêm do roteador principal">fora do ACS</span>
          ))}
          {canRefresh && <Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} />{loading ? "Lendo..." : "Atualizar"}</Button>}
        </div>
      }
    >
      {n.identityUnknown && (
        <div className="mb-3">
          <Alert tone="info">
            {n.mac
              ? "O firmware do roteador principal não informa o modelo nem o serial deste satélite. MAC, IP e porta vêm da tabela DHCP do principal."
              : "O firmware do roteador principal não informa o modelo, o serial nem o backhaul deste satélite."}{" "}
            Os aparelhos abaixo são os conectados nele.
          </Alert>
        </div>
      )}
      <div className="mb-4 grid gap-x-8 sm:grid-cols-2">
        <div>
          <InfoRow label="Fabricante" value={n.manufacturer} />
          <InfoRow label="Serial" value={n.serial} mono />
          <InfoRow label="MAC" value={n.mac} mono />
          {n.ip && <InfoRow label="IP" value={n.ip} mono />}
        </div>
        <div>
          <InfoRow label="Firmware" value={n.role === "principal" ? d.identity.firmware : n.firmware} />
          <InfoRow label="Distância do principal" value={n.hop !== null ? (n.hop === 0 ? "é o principal" : `${n.hop} salto${n.hop > 1 ? "s" : ""}`) : null} />
          <InfoRow
            label="Backhaul"
            value={n.backhaul ? `${n.backhaul.kind === "cabo" ? "Cabo" : n.backhaul.kind === "wifi" ? "Wi-Fi" : n.backhaul.media ?? "?"}${n.backhaul.phyMbps ? ` · ${n.backhaul.phyMbps} Mbps` : ""}${n.backhaul.signal !== null ? ` · ${n.backhaul.signal} dBm` : ""}${n.backhaul.errorsRx || n.backhaul.errorsTx ? ` · erros ${n.backhaul.errorsRx ?? 0}/${n.backhaul.errorsTx ?? 0}` : ""}` : n.role === "principal" ? "—" : null}
          />
        </div>
      </div>
      <h3 className="mb-2 text-sm font-semibold">Aparelhos conectados neste roteador</h3>
      {error && <div className="mb-2"><Alert tone="warn">{error}</Alert></div>}
      {list === null ? <p className="py-3 text-sm text-muted">{loading ? "Lendo os aparelhos deste roteador..." : "—"}</p> : <Stations list={list} />}
    </Card>
  );
}

export function MeshTab({ d, canRefresh }: { d: DeviceDetail; canRefresh: boolean }) {
  const [topo, setTopo] = useState<MeshTopology | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const started = useRef(false);
  const path = `/api/devices/${encodeURIComponent(d.id)}/mesh`;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ result: TaskResult; topology: MeshTopology }>(path, { method: "POST" });
      setTopo(res.topology);
      if (!res.result.ok) setError(`Não foi possível ler do equipamento agora: ${res.result.message ?? res.result.outcome}. Mostrando a última leitura.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao ler a topologia");
    } finally {
      setLoading(false);
    }
  }, [path]);

  // Mostra na hora o que está no banco e, em seguida, lê a topologia do equipamento.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<{ topology: MeshTopology }>(path).then((r) => setTopo((t) => t ?? r.topology)).catch(() => undefined);
    if (canRefresh && d.status.state !== "offline") void refresh();
  }, [path, canRefresh, d.status.state, refresh]);

  const root = topo?.nodes?.find((n) => n.role === "principal") ?? null;
  const selectedNode = topo?.nodes?.find((n) => n.key === selected) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Topologia lida do roteador principal, inclusive dos satélites que não estão no ACS. Clique num roteador para ver os aparelhos dele.</p>
        {canRefresh && (
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            {loading ? "Lendo a topologia..." : "Atualizar topologia"}
          </Button>
        )}
      </div>
      {error && <Alert tone="warn">{error}</Alert>}

      {!topo ? (
        <Card><EmptyState icon={<Network size={30} />} title={loading ? "Lendo a topologia..." : "Topologia ainda não lida"} /></Card>
      ) : topo.enabled === null ? (
        <Card><EmptyState icon={<Network size={30} />} title="Este equipamento não tem EasyMesh" /></Card>
      ) : (
        <>
          {!topo.enabled && <Alert tone="info">A rede mesh (EasyMesh) está <b>desligada</b> neste equipamento.</Alert>}
          {topo.self && (
            <Alert tone="info">
              Este roteador é um <b>satélite</b> ({topo.self.hop} salto{topo.self.hop > 1 ? "s" : ""} do principal). Principal: <b>{topo.self.controller.model ?? "?"}</b>
              {topo.self.controller.serial && <span className="font-mono text-xs"> ({topo.self.controller.serial})</span>}.
            </Alert>
          )}
          {topo.enabled && root && (
            <Card>
              <div className="overflow-x-auto py-2">
                <div className="mx-auto w-max">
                  <Tree node={root} all={topo.nodes ?? []} selected={selected} onSelect={(k) => setSelected((s) => (s === k ? null : k))} />
                </div>
              </div>
              {(topo.nodes?.length ?? 0) === 1 && <p className="mt-3 text-center text-sm text-muted">Mesh ligada, sem satélites conectados.</p>}
            </Card>
          )}
          {topo.enabled && (topo.unassignedSatellites?.length ?? 0) > 0 && (
            <Alert tone="info">
              O firmware do roteador principal não informa qual satélite é cada nó da árvore. Satélites vistos na rede:
              <ul className="mt-1 list-disc pl-5">
                {topo.unassignedSatellites!.map((s) => (
                  <li key={s.mac}>
                    <span className="font-mono text-xs">{s.mac}</span>
                    {s.ip && <> · <span className="font-mono text-xs">{s.ip}</span></>}
                    {s.link && <> · {s.link}</>}
                    {s.manufacturer && <> · {s.manufacturer}</>}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {selectedNode && <NodeDetail key={selectedNode.key} d={d} n={selectedNode} canRefresh={canRefresh} />}
        </>
      )}
    </div>
  );
}
