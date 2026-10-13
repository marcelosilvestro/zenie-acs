// Configurações do servidor (admin). Abas: Redes (IP, máscara, gateway, DNS, VLAN), Horário (fuso, NTP), Túnel Cloudflare e Atualização.
// As mudanças passam pelo agente do host (deploy/hostd); a rede reverte sozinha se não for confirmada.

import { useSearchParams } from "react-router";
import { PageTitle } from "../components/ui";
import { NetworkTab } from "./settings/NetworkTab";
import { TimeTab } from "./settings/TimeTab";
import { TunnelTab } from "./settings/TunnelTab";
import { UpdateTab } from "./settings/UpdateTab";

const TABS = [
  { key: "redes", label: "Redes" },
  { key: "horario", label: "Horário" },
  { key: "tunel", label: "Túnel Cloudflare" },
  { key: "atualizacao", label: "Atualização" },
] as const;

export function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("aba") ?? "redes";
  return (
    <>
      <PageTitle title="Configurações" subtitle="Rede, horário e acesso externo do servidor" />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams(t.key === "redes" ? {} : { aba: t.key }, { replace: true })}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "redes" && <NetworkTab confirmToken={params.get("confirmar")} />}
      {tab === "horario" && <TimeTab />}
      {tab === "tunel" && <TunnelTab />}
      {tab === "atualizacao" && <UpdateTab />}
    </>
  );
}
