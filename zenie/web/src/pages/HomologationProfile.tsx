// Perfil de um modelo no catálogo: foto, identificação, capacidades (status + fonte), firmwares, equipamentos
// e histórico. Produção: somente leitura. Servidor de testes (modo homologação): edição em rascunho.

import { ArrowLeft, Camera, Download, ImagePlus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api, CAP_STATUS, KIND_LABEL, profileImage, SOURCE_LABEL, timeAgo,
  type CatalogProfile, type ProfileCapStatus, type ProfilePage,
} from "../api";
import { PhotoEditor } from "../components/PhotoEditor";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, InfoRow, Input, Modal, Select, Textarea } from "../components/ui";
import { ModelPhoto, ProfileStatus } from "./Homologation";

const GROUPS: { kind: "leitura" | "diagnostico" | "escrita"; title: string; hint: string }[] = [
  { kind: "leitura", title: "Leitura", hint: "aparece no painel, exceto se “não suportado”" },
  { kind: "diagnostico", title: "Diagnóstico", hint: "comandos executados pelo equipamento" },
  { kind: "escrita", title: "Alterações", hint: "só liberadas com “homologado” (admin pode liberar caso a caso)" },
];

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
const statusClass: Record<ProfileCapStatus, string> = {
  homologado: "border-ok/40 bg-ok/5 text-ok",
  "a-validar": "border-warn/50 bg-warn/10 text-[#b45309]",
  "nao-suportado": "border-line bg-slate-50 text-muted",
};

export function HomologationProfile() {
  const { vendor = "", model = "" } = useParams();
  const id = `${vendor}/${model}`;
  const navigate = useNavigate();
  const [page, setPage] = useState<ProfilePage | null>(null);
  const [form, setForm] = useState<CatalogProfile | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "photo" | "discard" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [imgV, setImgV] = useState(0);
  const [editSrc, setEditSrc] = useState<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const p = await api<ProfilePage>(`/api/homologation/profiles/${id}`);
      setPage(p);
      setForm(structuredClone(p.profile));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar o perfil");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !page) return <Alert>{error}</Alert>;
  if (!page || !form) return <p className="text-sm text-muted">Carregando...</p>;

  const edit = page.homologationMode;
  const p = page.profile;
  const dirty = JSON.stringify(form) !== JSON.stringify(p) || note.trim() !== "";
  const set = (patch: Partial<CatalogProfile>) => setForm({ ...form, ...patch });
  const setCap = (k: string, patch: Partial<CatalogProfile["capabilities"][string]>) =>
    set({ capabilities: { ...form.capabilities, [k]: { ...(form.capabilities[k] ?? { status: "a-validar" }), ...patch } } });

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const { id: _i, vendor: _v, model: _m, homologation: _h, history: _hi, hasImage: _hs, draft: _d, ...profile } = form;
      await api(`/api/homologation/profiles/${id}`, { method: "PUT", body: { profile, ...(note.trim() ? { note: note.trim() } : {}) } });
      setNote("");
      await load();
      setMsg({ tone: "ok", text: "Rascunho salvo. Já vale neste servidor; exporte para levar ao repositório." });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao salvar" });
    } finally {
      setBusy(null);
    }
  };

  // Foto: escolhida (ou a atual) -> editor (recorte, fundo, enquadramento) -> WebP <= 200 KB -> rascunho.
  const pickPhoto = (file: File | undefined) => {
    if (file) setEditSrc(file);
    if (fileRef.current) fileRef.current.value = "";
  };
  const editCurrent = async () => {
    try {
      const res = await fetch(profileImage(id, imgV || undefined), { credentials: "same-origin" });
      if (!res.ok) throw new Error("foto atual indisponível");
      setEditSrc(await res.blob());
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao abrir a foto" });
    }
  };
  const savePhoto = async (webp: string) => {
    setBusy("photo");
    try {
      await api(`/api/homologation/profiles/${id}/image`, { method: "PUT", body: { webp } });
      setEditSrc(null);
      setImgV(Date.now());
      await load();
      setMsg({ tone: "ok", text: "Foto atualizada no rascunho." });
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("discard");
    try {
      const res = await api<{ official: boolean }>(`/api/homologation/profiles/${id}/draft`, { method: "DELETE" });
      setConfirmDiscard(false);
      if (!res.official) return navigate("/homologacao");
      setImgV(Date.now());
      await load();
      setMsg({ tone: "ok", text: "Rascunho descartado: voltou ao perfil oficial." });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "erro ao descartar" });
    } finally {
      setBusy(null);
    }
  };

  const exportFiles = async () => {
    const res = await api<{ profile: CatalogProfile; thumb: string | null }>(`/api/homologation/profiles/${id}/export`);
    download("profile.json", JSON.stringify(res.profile, null, 2) + "\n", "application/json");
    if (res.thumb) download("thumb.webp", Uint8Array.from(atob(res.thumb), (c) => c.charCodeAt(0)), "image/webp");
  };

  const networkFw = new Map<string, number>();
  for (const d of page.devices) networkFw.set(d.firmware ?? "?", (networkFw.get(d.firmware ?? "?") ?? 0) + 1);
  const listedFw = new Set((form.firmwaresSeen ?? []).map((f) => f.version));

  return (
    <div className="pb-24">
      <button className="mb-3 flex items-center gap-1.5 text-sm text-muted hover:text-ink" onClick={() => navigate("/homologacao")}>
        <ArrowLeft size={15} />Homologação
      </button>

      {/* Cabeçalho */}
      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="relative">
            <ModelPhoto id={p.id} hasImage={p.hasImage} size={112} v={imgV} />
            {edit && (
              <>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <div className="absolute -bottom-2 -right-2 flex gap-1">
                  {p.hasImage && (
                    <button
                      className="rounded-full border border-line bg-white p-2 text-muted shadow hover:text-brand disabled:opacity-50"
                      title="Editar a foto atual (recorte, fundo, enquadramento)"
                      disabled={busy !== null}
                      onClick={() => void editCurrent()}
                    >
                      <ImagePlus size={16} />
                    </button>
                  )}
                  <button
                    className="rounded-full border border-line bg-white p-2 text-muted shadow hover:text-brand disabled:opacity-50"
                    title="Enviar outra foto"
                    disabled={busy !== null}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Camera size={16} className={busy === "photo" ? "animate-pulse" : ""} />
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{p.commercialName}</h1>
              <ProfileStatus p={p} progress={page.progress} />
              <Badge>{KIND_LABEL[p.kind] ?? p.kind}</Badge>
              {p.wifi?.generation ? <Badge tone="info">Wi-Fi {p.wifi.generation}</Badge> : null}
            </div>
            <div className="mt-0.5 font-mono text-xs text-muted">{p.id}</div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
              <span>Equipamentos na rede: <b className="text-ink">{page.devices.length}</b></span>
              {p.homologation?.date && <span>Revisado em <b className="text-ink">{p.homologation.date}</b>{p.homologation.by ? ` por ${p.homologation.by}` : ""}</span>}
              {page.draft && <span>Rascunho de <b className="text-ink">{page.draft.updatedBy}</b>, {timeAgo(page.draft.updatedAt)}</span>}
              {!page.official && <span className="text-[#b45309]">ainda não está no catálogo oficial</span>}
            </div>
          </div>
          <Button variant="secondary" onClick={() => void exportFiles()} title="Baixar profile.json (e a foto) deste perfil">
            <Download size={16} />Exportar
          </Button>
        </div>
      </div>

      {!edit && <div className="mb-5"><Alert tone="info">Catálogo oficial, somente leitura. Ajustes de homologação são feitos no servidor de testes e chegam nas atualizações.</Alert></div>}
      {msg && <div className="mb-5"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {/* Capacidades */}
          <Card title="Recursos no painel" actions={<span className="text-xs text-muted">status validado no equipamento de bancada</span>}>
            <div className="space-y-6">
              {GROUPS.map((g) => (
                <div key={g.kind}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
                    <span className="text-xs text-muted">{g.hint}</span>
                  </div>
                  <div className="divide-y divide-line rounded-lg border border-line">
                    {Object.entries(page.capabilities).filter(([, d]) => d.kind === g.kind).map(([k, def]) => {
                      const c = form.capabilities[k] ?? { status: "a-validar" as const };
                      const sources = page.sources[k] ?? ["vp"];
                      return (
                        <div key={k} className="grid items-center gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1.3fr)_9.5rem_11rem_minmax(0,1.4fr)]">
                          <div className="text-sm font-medium">{def.label}</div>
                          {edit ? (
                            <select
                              value={c.status}
                              onChange={(e) => setCap(k, { status: e.target.value as ProfileCapStatus })}
                              className={`rounded-md border px-2 py-1 text-xs font-medium outline-none ${statusClass[c.status]}`}
                            >
                              {(Object.keys(CAP_STATUS) as ProfileCapStatus[]).map((s) => <option key={s} value={s}>{CAP_STATUS[s].label}</option>)}
                            </select>
                          ) : (
                            <span><Badge tone={CAP_STATUS[c.status].tone}>{CAP_STATUS[c.status].label}</Badge></span>
                          )}
                          {edit && sources.length > 1 ? (
                            <select value={c.source ?? sources[0]} onChange={(e) => setCap(k, { source: e.target.value })} className="rounded-md border border-line bg-white px-2 py-1 text-xs outline-none">
                              {sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs text-muted">{SOURCE_LABEL[c.source ?? sources[0]!] ?? c.source}</span>
                          )}
                          {edit ? (
                            <input value={c.notes ?? ""} maxLength={500} placeholder="observação" onChange={(e) => setCap(k, { notes: e.target.value || undefined })} className="rounded-md border border-line bg-white px-2 py-1 text-xs outline-none focus:border-brand" />
                          ) : (
                            <span className="text-xs text-muted">{c.notes}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Equipamentos */}
          <Card title={`Equipamentos deste modelo (${page.devices.length})`}>
            {page.devices.length === 0 ? (
              <EmptyState title="Nenhum equipamento deste modelo na rede" />
            ) : (
              <div className="-m-5 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {page.devices.map((d) => (
                      <tr key={d.id} className="hover:bg-page">
                        <td className="px-5 py-2"><Link className="font-medium text-brand hover:underline" to={`/dispositivos/${encodeURIComponent(d.id)}`}>{d.pppoe ?? d.id}</Link></td>
                        <td className="px-5 py-2 font-mono text-xs">{d.firmware ?? "—"}</td>
                        <td className="px-5 py-2 text-xs text-muted">{timeAgo(d.lastInform)}</td>
                        <td className="px-5 py-2">{d.pilot && <Badge tone="warn">piloto</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {edit && <p className="mt-6 text-xs text-muted">Testes de alteração só em equipamento de bancada (tag <b>piloto</b>), nunca em cliente.</p>}
          </Card>
        </div>

        <div className="space-y-5">
          {/* Identificação */}
          <Card title="Identificação">
            {edit ? (
              <div className="space-y-3">
                <Field label="Nome comercial"><Input value={form.commercialName} maxLength={80} onChange={(e) => set({ commercialName: e.target.value })} /></Field>
                <Field label="Tipo">
                  <Select value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                    {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Fabricante (como o equipamento informa)" hint="Manufacturer do GenieACS; separe por vírgula">
                  <Input value={form.match.manufacturer.join(", ")} onChange={(e) => set({ match: { ...form.match, manufacturer: list(e.target.value) } })} />
                </Field>
                <Field label="Modelo (ProductClass)" hint="todas as grafias que o modelo usa; separe por vírgula">
                  <Input value={form.match.productClass.join(", ")} onChange={(e) => set({ match: { ...form.match, productClass: list(e.target.value) } })} />
                </Field>
                <Field label="Versão de hardware (opcional)" hint="prefixos do HardwareVersion, ex.: V1. ou V9.; só quando o mesmo modelo tem revisões com firmwares diferentes">
                  <Input value={(form.match.hardwareVersion ?? []).join(", ")} onChange={(e) => set({ match: { ...form.match, hardwareVersion: list(e.target.value) } })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Geração Wi-Fi">
                    <Select value={String(form.wifi?.generation ?? 0)} onChange={(e) => set({ wifi: { ...form.wifi, generation: Number(e.target.value) } })}>
                      <option value="0">sem Wi-Fi</option>
                      {[4, 5, 6, 7].map((g) => <option key={g} value={g}>Wi-Fi {g}</option>)}
                    </Select>
                  </Field>
                  <Field label="Portas LAN">
                    <Input type="number" min={0} max={48} value={form.ports?.lan ?? 0} onChange={(e) => set({ ports: { ...form.ports, lan: Number(e.target.value) } })} />
                  </Field>
                </div>
                <div>
                  <span className="mb-1.5 block text-sm font-medium">Faixas Wi-Fi</span>
                  <div className="flex gap-4 text-sm">
                    {["2.4", "5", "6"].map((b) => (
                      <label key={b} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand"
                          checked={form.wifi?.bands?.includes(b) ?? false}
                          onChange={(e) => {
                            const cur = new Set(form.wifi?.bands ?? []);
                            if (e.target.checked) cur.add(b);
                            else cur.delete(b);
                            set({ wifi: { ...form.wifi, bands: ["2.4", "5", "6"].filter((x) => cur.has(x)) } });
                          }}
                        />
                        {b} GHz
                      </label>
                    ))}
                  </div>
                </div>
                <Field label="WAN"><Input value={form.ports?.wan ?? ""} maxLength={20} placeholder="GPON, Ethernet..." onChange={(e) => set({ ports: { ...form.ports, wan: e.target.value } })} /></Field>
                <Field label="Observações" hint="particularidades para o atendimento e para quem homologa">
                  <Textarea rows={4} maxLength={2000} value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
                </Field>
              </div>
            ) : (
              <>
                <InfoRow label="Fabricante" value={p.match.manufacturer.join(", ")} />
                <InfoRow label="Modelo (ProductClass)" value={p.match.productClass.join(", ")} />
                {p.match.hardwareVersion?.length ? <InfoRow label="Versão de hardware" value={p.match.hardwareVersion.join(", ")} mono /> : null}
                <InfoRow label="Tipo" value={KIND_LABEL[p.kind] ?? p.kind} />
                <InfoRow label="Wi-Fi" value={p.wifi?.generation ? `Wi-Fi ${p.wifi.generation} · ${(p.wifi.bands ?? []).join(" / ")} GHz` : null} />
                <InfoRow label="Portas" value={[p.ports?.lan ? `${p.ports.lan} LAN` : null, p.ports?.wan ? `WAN ${p.ports.wan}` : null].filter(Boolean).join(" · ")} />
                {p.notes && <p className="mt-3 whitespace-pre-line text-sm text-muted">{p.notes}</p>}
              </>
            )}
          </Card>

          {/* Firmwares */}
          <Card title="Firmwares">
            <div className="space-y-2">
              {(form.firmwaresSeen ?? []).length === 0 && <p className="text-sm text-muted">Nenhum firmware registrado.</p>}
              {(form.firmwaresSeen ?? []).map((f, i) => (
                <div key={f.version} className="flex items-start gap-2 rounded-lg border border-line p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm">{f.version} {networkFw.get(f.version) ? <span className="text-xs text-muted">· {networkFw.get(f.version)} na rede</span> : null}</div>
                    {f.sample && <div className="text-xs text-muted">sample: {f.sample}</div>}
                    {f.notes && <div className="text-xs text-muted">{f.notes}</div>}
                  </div>
                  {edit && (
                    <button className="p-1 text-muted hover:text-bad" title="Remover" onClick={() => set({ firmwaresSeen: form.firmwaresSeen!.filter((_, j) => j !== i) })}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {[...networkFw].filter(([v]) => v !== "?" && !listedFw.has(v)).map(([v, n]) => (
                <div key={v} className="flex items-center gap-2 rounded-lg border border-dashed border-line p-2.5 text-sm">
                  <span className="flex-1 font-mono">{v} <span className="text-xs text-muted">· {n} na rede, não registrado</span></span>
                  {edit && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => set({ firmwaresSeen: [...(form.firmwaresSeen ?? []), { version: v }] })}>registrar</Button>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Informativo: o perfil vale para o modelo, em qualquer firmware.</p>
          </Card>

          {/* Histórico */}
          <Card title="Histórico">
            {(p.history ?? []).length === 0 ? (
              <p className="text-sm text-muted">Sem registros.</p>
            ) : (
              <ol className="space-y-3">
                {[...(p.history ?? [])].reverse().map((h, i) => (
                  <li key={i} className="text-sm">
                    <div className="text-xs text-muted">{h.date} · {h.by}</div>
                    <div>{h.note}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {edit && (
        <Footer>
          <Input value={note} maxLength={300} placeholder="O que foi validado? (vai para o histórico)" onChange={(e) => setNote(e.target.value)} />
          <Button onClick={() => void save()} disabled={!dirty || busy !== null}><Save size={16} />{busy === "save" ? "Salvando..." : "Salvar rascunho"}</Button>
          {page.draft && (
            <Button variant="secondary" className="text-bad" onClick={() => setConfirmDiscard(true)} disabled={busy !== null}><Trash2 size={16} />Descartar rascunho</Button>
          )}
        </Footer>
      )}

      <Modal open={!!editSrc} title="Foto do equipamento" subtitle="Recorte, fundo e enquadramento — o resultado é salvo no rascunho" size="xl" busy={busy === "photo"} onClose={() => setEditSrc(null)}>
        {editSrc && <PhotoEditor source={editSrc} onCancel={() => setEditSrc(null)} onSave={savePhoto} />}
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        title="Descartar o rascunho?"
        danger
        busy={busy === "discard"}
        confirmLabel="Descartar"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => void discard()}
      >
        {page.official
          ? <p>O perfil volta a ser o do catálogo oficial ({p.commercialName}); as alterações e a foto deste rascunho são perdidas.</p>
          : <p>Este modelo <b>não está no catálogo oficial</b>: o perfil inteiro é removido e o modelo volta a ser “não homologado”.</p>}
      </ConfirmDialog>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur lg:left-60">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 md:px-8">{children}</div>
    </div>
  );
}
