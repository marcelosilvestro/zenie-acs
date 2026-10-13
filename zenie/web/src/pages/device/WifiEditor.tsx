// Alteração de Wi-Fi pelo atendimento: nome, senha e unificar/separar (regras em zenie-api routes/wifi.ts).

import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, capMode, type DeviceDetail, type Role } from "../../api";
import { Alert, Button, ConfirmDialog, Field, Input, Select } from "../../components/ui";
import type { WifiBand } from "../../api";

interface Result {
  ok: boolean;
  done: string[];
  failure: { step: string; outcome: string; message?: string } | null;
  device: DeviceDetail | null;
}

function PasswordInput({ value, onChange, required, placeholder }: { value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} required={required} minLength={8} maxLength={63} placeholder={placeholder} autoComplete="new-password" />
      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

interface Radio { channel: string; bandwidth: string; txPower: string }

/** Valores atuais do rádio no formato do editor: "11 (auto)" -> "auto"; "Auto (160MHz)" -> "Auto"; "100%" -> "100". */
function radioOf(b: WifiBand | undefined): Radio {
  const ch = b?.channel ?? "";
  return {
    channel: /auto/i.test(ch) || !ch ? "auto" : String(parseInt(ch, 10)),
    bandwidth: (b?.bandwidth ?? "").replace(/\s*\(.*\)$/, "") || "Auto",
    txPower: String(parseInt(b?.txPower ?? "", 10) || ""),
  };
}

function RadioFields({ b, value, onChange }: { b: WifiBand | undefined; value: Radio; onChange: (r: Radio) => void }) {
  const o = b?.options;
  if (!o) return <p className="text-xs text-muted">Opções de canal/largura/potência ainda não lidas — clique em Atualizar.</p>;
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Canal">
        <Select value={value.channel} onChange={(e) => onChange({ ...value, channel: e.target.value })}>
          <option value="auto">Automático</option>
          {o.channels.map((c) => <option key={c} value={String(c)}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Largura">
        <Select value={value.bandwidth} onChange={(e) => onChange({ ...value, bandwidth: e.target.value })}>
          {o.bandwidths.map((w) => <option key={w} value={w}>{w === "Auto" ? "Automática" : w.replace("MHz", " MHz")}</option>)}
        </Select>
      </Field>
      <Field label="Potência">
        <Select value={value.txPower} onChange={(e) => onChange({ ...value, txPower: e.target.value })}>
          {o.powers.map((p) => <option key={p} value={String(p)}>{p}%</option>)}
        </Select>
      </Field>
    </div>
  );
}

/** Formulário de alteração de Wi-Fi (aberto em popup pelo cabeçalho do equipamento ou pela aba Wi-Fi). */
export function WifiEditorForm({ d, role, onUpdated, onClose, onNotice, onBusy }: {
  d: DeviceDetail;
  role?: Role;
  onUpdated: (d: DeviceDetail) => void;
  onClose: () => void;
  onNotice: (n: { tone: "ok" | "bad" | "warn"; text: string }) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [b24, b5] = d.wifi.bands;
  // O que este modelo permite (perfil do catálogo) e como ele unifica as redes (adaptador).
  const writeMode = capMode(d, "wifiWrite", role);
  const radioMode = capMode(d, "wifiRadio", role);
  const unifyMode = capMode(d, "wifiUnify", role);
  const unify = d.wifi.unify;
  // Unificar exige gravar nome/senha: sem wifiWrite, não oferece.
  const supportsUnify = !!unify && unify.unified !== null && unifyMode !== "off" && writeMode !== "off";
  const pending = [writeMode === "admin" && "nome/senha", radioMode === "admin" && "canal/largura/potência", supportsUnify && unifyMode === "admin" && "unificar/separar"].filter(Boolean);
  const [unified, setUnified] = useState(unify?.unified === true);
  const [ssid24, setSsid24] = useState(b24?.ssid ?? "");
  const [pass24, setPass24] = useState("");
  const [ssid5, setSsid5] = useState(b5?.ssid ?? "");
  const [pass5, setPass5] = useState("");
  const [radio24, setRadio24] = useState<Radio>(radioOf(b24));
  const [radio5, setRadio5] = useState<Radio>(radioOf(b5));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);

  const wasUnified = unify?.unified === true;
  const separateNeedsPass = unify?.rules.separateNeeds === "ssid+password";
  const unifyNeedsPass = unify?.rules.passwordOnUnify !== false;
  const radioChanged = JSON.stringify([radio24, radio5]) !== JSON.stringify([radioOf(b24), radioOf(b5)]);
  const unifying = unified && !wasUnified;
  const separating = !unified && wasUnified;

  const toggleUnified = (v: boolean) => {
    setUnified(v);
    // Ao separar, sugere o nome do 5 GHz a partir do atual.
    if (!v && wasUnified) setSsid5(`${ssid24}-5G`.slice(0, 32));
  };

  const body = () => {
    const out: Record<string, unknown> = {};
    if (supportsUnify && unified !== wasUnified) out.unified = unified;
    const radioDiff = (now: Radio, before: Radio, target: Record<string, unknown>) => {
      if (now.channel !== before.channel) target.channel = now.channel;
      if (now.bandwidth !== before.bandwidth) target.bandwidth = now.bandwidth;
      if (now.txPower !== before.txPower && now.txPower) target.txPower = Number(now.txPower);
    };
    const band24: Record<string, unknown> = {};
    if (ssid24 !== (b24?.ssid ?? "")) band24.ssid = ssid24;
    if (pass24) band24.password = pass24;
    radioDiff(radio24, radioOf(b24), band24);
    if (Object.keys(band24).length) out.band24 = band24;
    const band5: Record<string, unknown> = {};
    if (!unified) {
      if (ssid5 !== (b5?.ssid ?? "") || separating) band5.ssid = ssid5;
      if (pass5) band5.password = pass5;
    }
    radioDiff(radio5, radioOf(b5), band5);
    if (Object.keys(band5).length) out.band5 = band5;
    return out;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(body()).length === 0) return setResult({ tone: "warn", text: "Nada foi alterado." });
    setResult(null);
    setConfirm(true);
  };

  const apply = async () => {
    setBusy(true);
    onBusy?.(true);
    try {
      const res = await api<Result>(`/api/devices/${encodeURIComponent(d.id)}/wifi`, { body: body() });
      if (res.device) onUpdated(res.device);
      if (res.ok) {
        onNotice({ tone: "ok", text: "Wi-Fi alterado. Os aparelhos precisam reconectar com os novos dados." });
        onClose();
      } else {
        const feito = res.done.length ? ` Já aplicado: ${res.done.join(", ")}.` : " Nada foi aplicado.";
        setResult({ tone: "bad", text: `Falhou em "${res.failure?.step}": ${res.failure?.message ?? res.failure?.outcome}.${feito}` });
      }
    } catch (e) {
      setResult({ tone: "bad", text: e instanceof Error ? e.message : "erro ao alterar o Wi-Fi" });
    } finally {
      setBusy(false);
      onBusy?.(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-5">
        {pending.length > 0 && (
          <Alert tone="warn">
            Ainda não homologado para este modelo: <b>{pending.join(", ")}</b>. Ao aplicar, será pedida a liberação manual (fica na auditoria).
          </Alert>
        )}
        {supportsUnify && (
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={unified} onChange={(e) => toggleUnified(e.target.checked)} />
            <span className="text-sm">
              <b>Rede unificada</b> (2,4 e 5 GHz com o mesmo nome e senha)
              <span className="block text-xs text-muted">
                {unify?.source === "same-ssid" ? "Mesmo nome e senha nas duas faixas; cada aparelho escolhe a faixa." : "O equipamento escolhe a melhor faixa para cada aparelho."} Recomendado para a maioria dos clientes.
              </span>
            </span>
          </label>
        )}

        {writeMode !== "off" && <div className={`grid gap-4 ${unified ? "" : "md:grid-cols-2"}`}>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{unified ? "Rede Wi-Fi" : "2,4 GHz"}</h3>
            <Field label="Nome da rede (SSID)"><Input value={ssid24} onChange={(e) => setSsid24(e.target.value)} required maxLength={32} /></Field>
            <Field label={unifying && unifyNeedsPass ? "Senha (obrigatória ao unificar)" : "Nova senha"} hint={unifying && unifyNeedsPass ? undefined : "Deixe em branco para manter a senha atual."}>
              <PasswordInput value={pass24} onChange={setPass24} required={unifying && unifyNeedsPass} placeholder={unifying && unifyNeedsPass ? "" : "manter a atual"} />
            </Field>
          </div>
          {!unified && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">5 GHz</h3>
              <Field label="Nome da rede (SSID)"><Input value={ssid5} onChange={(e) => setSsid5(e.target.value)} required maxLength={32} /></Field>
              <Field label={separating && separateNeedsPass ? "Senha (obrigatória ao separar)" : "Nova senha"} hint={separating && separateNeedsPass ? "Ao separar, o equipamento voltaria à senha antiga do 5 GHz — defina uma agora." : "Deixe em branco para manter a senha atual."}>
                <PasswordInput value={pass5} onChange={setPass5} required={separating && separateNeedsPass} placeholder={separating && separateNeedsPass ? "" : "manter a atual"} />
              </Field>
            </div>
          )}
        </div>}

        {radioMode !== "off" && <details className="rounded-lg border border-line p-3" open={radioChanged}>
          <summary className="cursor-pointer text-sm font-semibold">Canal, largura e potência (avançado)</summary>
          <div className="mt-3 space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">2,4 GHz</h4>
              <RadioFields b={b24} value={radio24} onChange={setRadio24} />
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">5 GHz</h4>
              <RadioFields b={b5} value={radio5} onChange={setRadio5} />
            </div>
            <p className="text-xs text-muted">Na dúvida, deixe canal e largura em automático. Potência menor reduz o alcance (útil em prédios com muita interferência).</p>
          </div>
        </details>}

        <p className="text-xs text-muted">Senha: 8 a 63 caracteres, sem acentos. O modo de segurança (WPA2/WPA3) do equipamento não é alterado.</p>
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>Aplicar</Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        </div>
      </form>

      <ConfirmDialog open={confirm} title="Aplicar a alteração do Wi-Fi?" busy={busy} confirmLabel="Aplicar agora" onCancel={() => setConfirm(false)} onConfirm={() => void apply()}>
        <ul className="list-disc space-y-1 pl-5">
          {unifying && <li>As redes 2,4 e 5 GHz serão <b>unificadas</b>.</li>}
          {separating && <li>As redes serão <b>separadas</b> (5 GHz: <b>{ssid5}</b>).</li>}
          {ssid24 !== (b24?.ssid ?? "") && <li>Novo nome{unified ? "" : " 2,4 GHz"}: <b>{ssid24}</b></li>}
          {!unified && !separating && ssid5 !== (b5?.ssid ?? "") && <li>Novo nome 5 GHz: <b>{ssid5}</b></li>}
          {(pass24 || pass5) && <li>A senha será trocada.</li>}
          {radioChanged && <li>Canal/largura/potência serão alterados — o rádio reinicia e os aparelhos reconectam.</li>}
        </ul>
        <p className="mt-3">Os aparelhos do cliente <b>vão desconectar</b> e precisam reconectar com os novos dados.</p>
      </ConfirmDialog>
    </>
  );
}
