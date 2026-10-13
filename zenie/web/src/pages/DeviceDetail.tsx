import { Activity, ArrowLeft, Gauge, Power, RefreshCw, Router, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError, capMode, profileImage, timeAgo, type DeviceDetail as Device, type TaskResult } from "../api";
import { HomologationBadge, OnlineBadge, WifiGenBadge } from "../components/status";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal } from "../components/ui";
import { PingPanel, TrafficPanel } from "./device/Diagnostics";
import { EventsTab } from "./device/EventsTab";
import { MeshTab } from "./device/MeshTab";
import { WifiEditorForm } from "./device/WifiEditor";
import { useSession } from "../session";
import { ClientsTab, NetworkTab, OpticalTab, OverviewTab, WifiTab } from "./device/tabs";

const TABS = [
  { key: "resumo", label: "Resumo" },
  { key: "sinal", label: "Sinal óptico" },
  { key: "rede", label: "Rede" },
  { key: "wifi", label: "Wi-Fi" },
  { key: "mesh", label: "Mesh" },
  { key: "clientes", label: "Clientes" },
  { key: "eventos", label: "Eventos" },
] as const;

const OUTCOME_MSG = {
  unreachable: "O equipamento não respondeu (pode estar offline ou sem rota até o ACS). Nada ficou pendente.",
  fault: "O equipamento respondeu com erro.",
  done: "",
};

export function DeviceDetail() {
  // useParams já devolve o id original do GenieACS (que pode conter "%20"): não decodificar de novo.
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can, me } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("aba") ?? "resumo";

  const [device, setDevice] = useState<Device | null>(null);
  const [eventsKey, setEventsKey] = useState(0); // muda ao clicar de novo em "Eventos": recarrega a aba
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<"refresh" | "reboot" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [del, setDel] = useState<{ typed: string } | null>(null);
  const [popup, setPopup] = useState<"wifi" | "ping" | "traffic" | null>(null);
  const [popupBusy, setPopupBusy] = useState(false);
  const closePopup = () => {
    setPopup(null);
    setPopupBusy(false);
  };

  const path = `/api/devices/${encodeURIComponent(id)}`;

  const load = useCallback(async () => {
    try {
      setDevice(await api<Device>(path));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e instanceof Error ? e.message : "erro ao carregar o equipamento");
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy("refresh");
    setNotice(null);
    try {
      const res = await api<{ result: TaskResult; device: Device | null }>(`${path}/refresh`, { method: "POST" });
      if (res.device) setDevice(res.device);
      setNotice(res.result.ok
        ? { tone: "ok", text: `Dados atualizados direto do equipamento (${(res.result.ms / 1000).toFixed(1)} s).` }
        : { tone: "warn", text: `${OUTCOME_MSG[res.result.outcome]} ${res.result.message ?? ""} Mostrando os últimos dados conhecidos.` });
    } catch (e) {
      setNotice({ tone: "bad", text: e instanceof Error ? e.message : "erro ao atualizar" });
    } finally {
      setBusy(null);
    }
  };

  const reboot = async () => {
    setBusy("reboot");
    setNotice(null);
    try {
      const res = await api<{ result: TaskResult }>(`${path}/reboot`, { method: "POST" });
      setNotice(res.result.ok
        ? { tone: "ok", text: "Comando de reinício enviado. O equipamento volta em 1 a 3 minutos; o cliente fica sem internet nesse tempo." }
        : { tone: "bad", text: `Reinício NÃO enviado. ${OUTCOME_MSG[res.result.outcome]} ${res.result.message ?? ""}` });
    } catch (e) {
      setNotice({ tone: "bad", text: e instanceof Error ? e.message : "erro ao reiniciar" });
    } finally {
      setBusy(null);
      setConfirmReboot(false);
    }
  };

  if (notFound) {
    return (
      <Card>
        <EmptyState icon={<Router size={32} />} title="Equipamento não encontrado">
          Ele pode ter sido removido do GenieACS. <button className="text-brand underline" onClick={() => navigate("/dispositivos")}>Voltar à lista</button>
        </EmptyState>
      </Card>
    );
  }
  if (error) return <Alert>{error}</Alert>;
  if (!device) return <p className="p-4 text-sm text-muted">Carregando equipamento...</p>;

  const idt = device.identity;
  // O que digitar para excluir: o login PPPoE (ou o serial / id, se não houver login). Igual à regra da API.
  const delKey = (idt.pppoe || idt.serial || device.id).trim();
  const setTab = (key: string) => {
    // Clicar de novo em "Eventos" recarrega a aba (eventos + leitura da OLT).
    if (key === "eventos" && tab === "eventos") setEventsKey((k) => k + 1);
    setParams(key === "resumo" ? {} : { aba: key }, { replace: true });
  };

  // Perfil do modelo manda na tela (docs/HOMOLOGACAO.md): recurso não suportado some; não homologado só para admin.
  const mode = (cap: string) => capMode(device, cap, me?.role);
  const hidden = (cap: string) => device.capabilities?.[cap]?.status === "nao-suportado";
  const tabHidden = (tab === "sinal" && hidden("optical")) || (tab === "mesh" && hidden("mesh"));
  const canWifi = can("wifi.edit") && ["wifiWrite", "wifiRadio", "wifiUnify"].some((c) => mode(c) !== "off");

  return (
    <>
      <button className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} />Voltar
      </button>

      {/* Cabeçalho */}
      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-page text-muted">
            {device.profile?.hasImage ? (
              <img src={profileImage(device.profile.id)} alt={device.profile.commercialName} className="h-full w-full object-contain" />
            ) : idt.accessType === "ONU" ? <Router size={36} /> : <Wifi size={36} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{idt.pppoe ?? idt.serial ?? device.id}</h1>
              <OnlineBadge state={device.status.state} />
              {idt.accessType && <Badge tone={idt.accessType === "ONU" ? "info" : "neutral"}>{idt.accessType}</Badge>}
              <WifiGenBadge gen={idt.wifiGeneration} />
              {device.profile && can("homologation.view") ? (
                <Link to={`/homologacao/${device.profile.id}`} title="Ver o perfil do modelo"><HomologationBadge homologated name={device.profile.commercialName} progress={device.profile.progress} /></Link>
              ) : (
                <HomologationBadge homologated={!!device.profile} name={device.profile?.commercialName} progress={device.profile?.progress} />
              )}
              {idt.tags.includes("piloto") && <Badge tone="warn">piloto</Badge>}
              {device.readonly && <span title="Tag somente_leitura: o painel e o ACS só leem este equipamento (sem alterações, ping ou reinício)"><Badge tone="info">Somente leitura</Badge></span>}
            </div>
            <div className="mt-0.5 text-sm text-muted">{[device.profile?.commercialName ?? [idt.vendor, idt.model].filter(Boolean).join(" "), idt.firmware].filter(Boolean).join(" · ")}</div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
              <span>Serial: <b className="font-mono font-medium text-ink">{idt.serial ?? "—"}</b></span>
              {idt.ponSerial && <span>Serial PON: <b className="font-mono font-medium text-ink">{idt.ponSerial}</b>{idt.ponSerialSource === "olt" && <span className="text-muted" title="Este firmware não informa o serial GPON pelo TR-069: o valor vem da leitura da OLT (mesmo login PPPoE)."> (da OLT)</span>}</span>}
              <span>IP WAN: <b className="font-mono font-medium text-ink">{device.wan.ip ?? "—"}</b></span>
              <span>MAC: <b className="font-mono font-medium text-ink">{idt.macs.base ?? idt.macs.wan[0] ?? "—"}</b></span>
              <span>Último inform: <b className="font-medium text-ink">{timeAgo(device.status.lastInform)}</b></span>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {can("diag.run") && mode("ping") !== "off" && (
              <Button variant="secondary" onClick={() => setPopup("ping")} disabled={busy !== null || device.status.state === "offline"}><Activity size={16} />Teste de conectividade</Button>
            )}
            {can("device.refresh") && mode("traffic") !== "off" && (
              <Button variant="secondary" onClick={() => setPopup("traffic")} disabled={busy !== null || device.status.state === "offline"}><Gauge size={16} />Tráfego agora</Button>
            )}
            {can("device.refresh") && (
              <Button variant="secondary" onClick={() => void refresh()} disabled={busy !== null}>
                <RefreshCw size={16} className={busy === "refresh" ? "animate-spin" : ""} />
                {busy === "refresh" ? "Atualizando..." : "Atualizar"}
              </Button>
            )}
            {can("device.reboot") && mode("reboot") !== "off" && (
              <Button variant="secondary" className="text-bad" onClick={() => setConfirmReboot(true)} disabled={busy !== null}>
                <Power size={16} />Reiniciar
              </Button>
            )}
            {can("device.remove") && !device.staleOf && (
              <Button variant="secondary" className="text-bad" onClick={() => setDel({ typed: "" })} disabled={busy !== null} title="Excluir do ACS e do Zenie">
                <Trash2 size={16} />Excluir
              </Button>
            )}
          </div>
        </div>
      </div>

      {device.staleOf && (
        <div className="mb-4">
          <Alert tone="warn">
            <b>Registro antigo deste equipamento.</b> Ele agora fala com o ACS em outro registro (
            <Link className="font-medium underline" to={`/dispositivos/${encodeURIComponent(device.staleOf)}`}>abrir o registro atual</Link>
            ) — acontece quando o modelo de dados muda (TR-098 ↔ TR-181). Os dados abaixo estão parados.
            {can("device.remove") && (
              <button className="ml-2 font-medium text-bad underline" onClick={() => setConfirmRemove(true)}>Remover registro antigo</button>
            )}
          </Alert>
        </div>
      )}
      {notice && <div className="mb-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}

      {/* Abas */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.filter((t) => !(t.key === "sinal" && hidden("optical")) && !(t.key === "mesh" && hidden("mesh"))).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "resumo" || tabHidden) && <OverviewTab d={device} onTab={setTab} />}
      {tab === "sinal" && !tabHidden && <OpticalTab d={device} />}
      {tab === "rede" && <NetworkTab d={device} />}
      {tab === "wifi" && <WifiTab d={device} onEdit={canWifi ? () => setPopup("wifi") : undefined} canEdit={can("wifi.edit") && mode("wifiPower") !== "off"} onUpdated={setDevice} onNotice={setNotice} />}
      {tab === "mesh" && !tabHidden && <MeshTab d={device} canRefresh={can("device.refresh")} />}
      {tab === "clientes" && <ClientsTab d={device} canRefresh={can("device.refresh")} />}
      {tab === "eventos" && <EventsTab key={eventsKey} id={device.id} canRefresh={can("device.refresh")} />}

      <Modal open={popup === "wifi"} title="Alterar Wi-Fi" subtitle={idt.pppoe ?? device.id} size="lg" busy={popupBusy} onClose={closePopup}>
        <WifiEditorForm d={device} role={me?.role} onUpdated={setDevice} onClose={closePopup} onNotice={setNotice} onBusy={setPopupBusy} />
      </Modal>
      <Modal open={popup === "ping"} title="Teste de conectividade" subtitle={idt.pppoe ?? device.id} busy={popupBusy} onClose={closePopup}>
        <PingPanel d={device} onBusy={setPopupBusy} />
      </Modal>
      <Modal open={popup === "traffic"} title="Tráfego agora (WAN)" subtitle={idt.pppoe ?? device.id} busy={popupBusy} onClose={closePopup}>
        <TrafficPanel d={device} onBusy={setPopupBusy} />
      </Modal>

      <ConfirmDialog
        open={!!del}
        title="Excluir este equipamento?"
        danger
        confirmLabel="Excluir"
        busy={removing}
        confirmDisabled={del?.typed.trim().toLowerCase() !== delKey.toLowerCase()}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          setRemoving(true);
          api(`${path}/remove`, { body: { confirm: del!.typed } })
            .then(() => navigate("/dispositivos", { replace: true }))
            .catch((e) => {
              setNotice({ tone: "bad", text: e instanceof Error ? e.message : "erro ao excluir" });
              setDel(null);
            })
            .finally(() => setRemoving(false));
        }}
      >
        <div className="space-y-3 text-sm">
          <p>Remove <b>{idt.pppoe ?? idt.serial ?? device.id}</b> ({[idt.vendor, idt.model].filter(Boolean).join(" ")}) do ACS e da lista de dispositivos, com as tarefas pendentes. Fica na auditoria. <b>Nada é enviado ao equipamento.</b></p>
          <p className="text-muted">Se ele continuar falando com o ACS (com a credencial), volta a aparecer como novo, com o histórico zerado. Para não voltar, tire a configuração TR-069 dele (na tela do equipamento ou na OLT).</p>
          <p>Digite <b className="font-mono">{delKey}</b> para confirmar:</p>
          <Input value={del?.typed ?? ""} onChange={(e) => del && setDel({ typed: e.target.value })} autoFocus />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmRemove}
        title="Remover o registro antigo?"
        danger
        busy={removing}
        confirmLabel="Remover"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setRemoving(true);
          api<{ ok: boolean; current: string }>(path, { method: "DELETE" })
            .then((r) => navigate(`/dispositivos/${encodeURIComponent(r.current)}`, { replace: true }))
            .catch((e) => setNotice({ tone: "bad", text: e instanceof Error ? e.message : "erro ao remover" }))
            .finally(() => {
              setRemoving(false);
              setConfirmRemove(false);
            });
        }}
      >
        <p>Apaga só este registro duplicado do banco do ACS (fica na auditoria). <b>Nada é enviado ao equipamento</b>, que continua no registro atual.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmReboot}
        title="Reiniciar o equipamento?"
        danger
        busy={busy === "reboot"}
        confirmLabel="Reiniciar agora"
        onCancel={() => setConfirmReboot(false)}
        onConfirm={() => void reboot()}
      >
        <p><b>{idt.pppoe ?? device.id}</b> ({idt.model}) vai reiniciar e o cliente fica <b>sem internet por 1 a 3 minutos</b>.</p>
        <p className="mt-2">A ação fica registrada na auditoria com o seu usuário.</p>
      </ConfirmDialog>
    </>
  );
}
