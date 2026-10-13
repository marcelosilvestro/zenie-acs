// Homologação: frota por modelo (o que existe na rede x o que está no catálogo). docs/HOMOLOGACAO.md

import { BadgeCheck, Box, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, KIND_LABEL, profileImage, timeAgo, type Fleet, type ProfileSummary } from "../api";
import { Alert, Badge, Button, Card, EmptyState, PageTitle } from "../components/ui";

export function ModelPhoto({ id, hasImage, size = 40, v }: { id?: string | null; hasImage?: boolean; size?: number; v?: number }) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [id, v]);
  return (
    <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-page text-muted" style={{ width: size, height: size }}>
      {id && hasImage && ok ? (
        <img src={profileImage(id, v)} alt="" className="h-full w-full object-contain" onError={() => setOk(false)} />
      ) : (
        <Box size={Math.round(size * 0.45)} />
      )}
    </div>
  );
}

/** Selo do modelo: "Homologado" só com 100% (nenhum recurso a validar). */
export function ProfileStatus({ p, progress }: { p: { draft?: boolean } | null; progress?: { complete: boolean; resolved: number; total: number; pending: string[] } }) {
  if (!p) return <Badge tone="warn">Não homologado</Badge>;
  const badge = progress && !progress.complete ? (
    <span title={`Falta validar: ${progress.pending.join(", ")}`}><Badge tone="info">Em homologação {progress.resolved}/{progress.total}</Badge></span>
  ) : (
    <Badge tone="ok"><BadgeCheck size={11} />Homologado</Badge>
  );
  return p.draft ? <span className="inline-flex gap-1">{badge}<Badge>Rascunho</Badge></span> : badge;
}

/** Contagem compacta das capacidades: homologadas / a validar / não suportadas. */
export function CapsSummary({ caps }: { caps: ProfileSummary["caps"] }) {
  return (
    <div className="flex gap-1.5 text-xs">
      <span className="rounded bg-ok/10 px-1.5 py-0.5 font-medium text-ok" title="homologadas">{caps.homologado} ok</span>
      {caps["a-validar"] > 0 && <span className="rounded bg-warn/15 px-1.5 py-0.5 font-medium text-[#b45309]" title="a validar">{caps["a-validar"]} a validar</span>}
      {caps["nao-suportado"] > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-muted" title="não suportadas">{caps["nao-suportado"]} n/s</span>}
    </div>
  );
}

export function Homologation() {
  const navigate = useNavigate();
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFleet(await api<Fleet>("/api/homologation/fleet"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "erro ao carregar a frota");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (vendor: string, model: string, hardwareFamily: string | null | undefined, key: string) => {
    setCreating(key);
    try {
      const res = await api<{ id: string }>("/api/homologation/profiles", { body: { manufacturer: vendor, productClass: model, ...(hardwareFamily ? { hardwareFamily } : {}) } });
      navigate(`/homologacao/${res.id}`);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "erro ao criar o perfil");
      setCreating(null);
    }
  };

  const notHomologated = fleet?.models.filter((m) => !m.profile) ?? [];
  const devicesOut = notHomologated.reduce((s, m) => s + m.count, 0);
  // "Homologado" só com 100% (nenhum recurso a validar); o resto do catálogo está em homologação.
  const complete = fleet?.models.filter((m) => m.profile?.progress?.complete) ?? [];
  const partial = fleet?.models.filter((m) => m.profile && !m.profile.progress?.complete) ?? [];

  return (
    <>
      <PageTitle title="Homologação" subtitle={fleet ? `Catálogo ${fleet.version || "—"} · modelos encontrados na rede e o que cada um pode fazer no painel` : undefined} />

      {fleet && (
        <div className="mb-5">
          {fleet.homologationMode ? (
            <Alert tone="info">
              <b>Modo homologação</b> (servidor de testes): as edições ficam em <b>rascunho</b> e já valem aqui. Depois são exportadas para o repositório e chegam aos provedores na próxima atualização.
            </Alert>
          ) : (
            <Alert tone="info">Catálogo oficial, somente leitura. Novos modelos são homologados no servidor de testes e chegam nas atualizações do Zenie.</Alert>
          )}
        </div>
      )}
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {fleet && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="text-xs font-medium text-muted">Modelos na rede</div>
            <div className="mt-1 text-2xl font-semibold">{fleet.models.length}</div>
          </div>
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="text-xs font-medium text-muted">Homologados (100%)</div>
            <div className="mt-1 text-2xl font-semibold text-ok">{complete.length}</div>
          </div>
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="text-xs font-medium text-muted">Em homologação</div>
            <div className={`mt-1 text-2xl font-semibold ${partial.length ? "text-brand" : ""}`}>{partial.length}</div>
            {partial.length > 0 && <div className="mt-1 text-xs text-muted">alterações só nos recursos já validados</div>}
          </div>
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="text-xs font-medium text-muted">Não homologados</div>
            <div className={`mt-1 text-2xl font-semibold ${notHomologated.length ? "text-[#b45309]" : ""}`}>{notHomologated.length}</div>
            {devicesOut > 0 && <div className="mt-1 text-xs text-muted">{devicesOut} equipamento(s) só leitura</div>}
          </div>
        </div>
      )}

      <Card title="Modelos na rede">
        {!fleet ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : fleet.models.length === 0 ? (
          <EmptyState icon={<Box size={30} />} title="Nenhum equipamento ainda">Os modelos aparecem aqui depois do primeiro inform no GenieACS.</EmptyState>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Modelo</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Equipamentos</th>
                  <th className="px-5 py-3 font-medium">Firmwares na rede</th>
                  <th className="px-5 py-3 font-medium">Recursos</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fleet.models.map((m) => {
                  const key = `${m.vendor}|${m.model}|${m.profile?.id ?? ""}`;
                  const open = m.profile ? () => navigate(`/homologacao/${m.profile!.id}`) : undefined;
                  return (
                    <tr key={key} className={open ? "cursor-pointer hover:bg-page" : ""} onClick={open}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <ModelPhoto id={m.profile?.id} hasImage={m.profile?.hasImage} />
                          <div>
                            <div className="font-medium">{m.profile?.commercialName ?? `${m.vendor ?? "?"} ${m.model ?? "?"}`}</div>
                            <div className="text-xs text-muted">
                              {m.vendor ?? "?"} · {m.model ?? "?"}
                              {m.hardwareVersions?.length ? ` · HW ${m.hardwareVersions.join(", ")}` : ""}
                              {m.profile ? ` · ${KIND_LABEL[m.profile.kind] ?? m.profile.kind}` : m.accessType ? ` · ${m.accessType}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3"><ProfileStatus p={m.profile} progress={m.profile?.progress} /></td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{m.count}</div>
                        <div className="text-xs text-muted">último inform {timeAgo(m.lastInform)}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {m.firmwares.map((f) => (
                            <span key={f.version} className="rounded bg-page px-1.5 py-0.5 font-mono text-xs" title={`${f.count} equipamento(s)`}>
                              {f.version}{m.firmwares.length > 1 || f.count > 1 ? <span className="text-muted"> ×{f.count}</span> : null}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3">{m.profile ? <CapsSummary caps={m.profile.caps} /> : <span className="text-xs text-muted">só leitura, sem alterações</span>}</td>
                      <td className="px-5 py-3 text-right">
                        {!m.profile && fleet.homologationMode && m.vendor && m.model && (
                          <Button variant="secondary" disabled={creating !== null} onClick={(e) => { e.stopPropagation(); void create(m.vendor!, m.model!, m.hardwareFamily, key); }}>
                            <Plus size={15} />{creating === key ? "Criando..." : "Criar perfil"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {fleet && fleet.unused.length > 0 && (
        <Card title="No catálogo, sem equipamentos nesta rede" className="mt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fleet.unused.map((p) => (
              <button key={p.id} onClick={() => navigate(`/homologacao/${p.id}`)} className="flex items-center gap-3 rounded-lg border border-line p-3 text-left hover:border-brand/40">
                <ModelPhoto id={p.id} hasImage={p.hasImage} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.commercialName}</div>
                  <div className="mt-1"><CapsSummary caps={p.caps} /></div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
