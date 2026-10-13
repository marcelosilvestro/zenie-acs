// Componentes básicos reutilizáveis (cards, botões, campos, badges, estados de tela).

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90",
  secondary: "border border-line bg-white text-ink hover:bg-page",
  danger: "bg-bad text-white hover:bg-bad/90",
  ghost: "text-muted hover:bg-page hover:text-ink",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const control = "rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15";

/** Soma as classes extras ao estilo do campo (antes, className substituía o estilo inteiro). Largura padrão: w-full. */
const controlClass = (extra?: string) => `${control} ${extra && /(^|\s)(min-|max-)?w-/.test(extra) ? "" : "w-full"} ${extra ?? ""}`.trim();

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClass(className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={controlClass(className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={controlClass(className)} {...props} />;
}

const TONES = {
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/15 text-[#b45309]",
  bad: "bg-bad/10 text-bad",
  info: "bg-brand/10 text-brand",
  neutral: "bg-slate-100 text-muted",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

/**
 * Mensagem na página. Toda mensagem tem o X para fechar: esconde AQUELA mensagem; se o texto mudar (novo erro,
 * novo lote, outro andamento), ela volta a aparecer — nada importante fica escondido por engano.
 */
export function Alert({ tone = "bad", children, onClose }: { tone?: "bad" | "ok" | "warn" | "info"; children: ReactNode; onClose?: () => void }) {
  const styles = { bad: "border-bad/30 bg-bad/5 text-bad", ok: "border-ok/30 bg-ok/5 text-ok", warn: "border-warn/40 bg-warn/10 text-[#92400e]", info: "border-brand/30 bg-brand/5 text-brand" };
  const body = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [closedText, setClosedText] = useState<string | null>(null);
  // O texto atual (para saber se mudou depois de fechar). Lido do DOM: children pode ser qualquer ReactNode.
  useLayoutEffect(() => {
    const t = body.current?.textContent ?? "";
    if (t !== text) setText(t);
  });
  const hidden = closedText !== null && closedText === text;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${styles[tone]} ${hidden ? "hidden" : ""}`} role={tone === "bad" ? "alert" : "status"}>
      <div ref={body} className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        aria-label="fechar mensagem"
        className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 opacity-60 transition hover:bg-black/5 hover:opacity-100"
        onClick={() => {
          setClosedText(text);
          onClose?.();
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Diálogo de confirmação (ações destrutivas: reiniciar etc.).
 * - busy: a ação está em andamento ("Aguarde...", nada clicável).
 * - confirmDisabled: ainda não dá para confirmar (ex.: falta digitar a confirmação). Só o botão de confirmar fica
 *   desativado: Cancelar e Esc continuam funcionando — o usuário sempre consegue desistir.
 */
export function ConfirmDialog({
  open, title, children, confirmLabel = "Confirmar", danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel,
}: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; confirmDisabled?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy || confirmDisabled}>{busy ? "Aguarde..." : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/** Linha "rótulo: valor" das listas de informações; valor ausente = "Não disponível". */
export function InfoRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""} ${empty ? "text-muted" : "font-medium"}`}>{empty ? "Não disponível" : value}</span>
    </div>
  );
}

/** Popup centralizado (Esc ou clique fora fecha, a menos que busy). */
export function Modal({
  open, title, subtitle, onClose, children, size = "md", busy = false,
}: {
  open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode;
  size?: "md" | "lg" | "xl"; busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);
  if (!open) return null;
  const width = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`flex max-h-[90vh] w-full ${width} flex-col rounded-2xl bg-white shadow-2xl`}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button className="rounded-lg p-1.5 text-muted hover:bg-page hover:text-ink disabled:opacity-40" onClick={onClose} disabled={busy} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Interruptor liga/desliga (acessível: role="switch"). */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-ok" : "bg-slate-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );
}
