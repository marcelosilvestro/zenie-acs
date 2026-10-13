import { BadgeCheck, ClipboardList, KeyRound, LogOut, Menu, Network, Router, Search, ShieldCheck, Users, X, ScrollText, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, ROLE_LABEL } from "../api";
import { ChangePasswordForm } from "../pages/ChangePassword";
import { OverrideDialog } from "./OverrideDialog";
import { Alert, Modal } from "./ui";
import { useSession } from "../session";

const NAV = [
  { to: "/dispositivos", label: "Dispositivos", icon: Router, permission: "device.view" },
  { to: "/olts", label: "OLTs", icon: Network, permission: "olt.view" },
  { to: "/log-acs", label: "Log do ACS", icon: ScrollText, permission: "acslog.view" },
  { to: "/homologacao", label: "Homologação", icon: BadgeCheck, permission: "homologation.view" },
  { to: "/usuarios", label: "Usuários", icon: Users, permission: "users.manage" },
  { to: "/seguranca-acs", label: "Segurança do ACS", icon: ShieldCheck, permission: "acs.manage" },
  { to: "/auditoria", label: "Auditoria", icon: ClipboardList, permission: "audit.view" },
  { to: "/configuracoes", label: "Configurações", icon: Settings, permission: "settings.manage" },
];

export function Layout() {
  const { me, can, logout } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdDone, setPwdDone] = useState(false);
  const location = useLocation();
  const [params] = useSearchParams();
  const urlQ = location.pathname === "/dispositivos" ? params.get("q") ?? "" : "";
  const [term, setTerm] = useState(urlQ);
  const timer = useRef<number | undefined>(undefined);

  // Admin: versão instalada e selo de atualização (da verificação diária do agente; não consulta o GitHub aqui).
  const [update, setUpdate] = useState<{ available: boolean; version: string | null } | null>(null);
  const isAdmin = can("settings.manage");
  useEffect(() => {
    if (!isAdmin) return;
    api<{ available: boolean; current?: { version: string } }>("/api/settings/update")
      .then((r) => setUpdate({ available: r.available, version: r.current?.version ?? null }))
      .catch(() => setUpdate(null));
  }, [isAdmin, location.pathname]);

  // Mantém o campo igual à URL (ex.: voltar no navegador).
  useEffect(() => setTerm(urlQ), [urlQ]);

  // Busca enquanto digita (300 ms de espera); Enter busca na hora.
  const search = (value: string, now = false) => {
    setTerm(value);
    window.clearTimeout(timer.current);
    const go = () => {
      const q = value.trim();
      if (q === urlQ) return;
      navigate(q ? `/dispositivos?q=${encodeURIComponent(q)}` : "/dispositivos", { replace: location.pathname === "/dispositivos" });
    };
    if (now) go();
    else timer.current = window.setTimeout(go, 300);
  };

  const sidebar = (
    <nav className="flex h-full flex-col bg-side px-3 py-5 text-slate-300">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <img src="/zenie.svg" alt="" className="h-8 w-8" />
        <div>
          <div className="text-lg font-semibold leading-none text-white">Zenie</div>
          <div className="mt-1 text-[11px] text-slate-400">painel NOC para GenieACS</div>
        </div>
      </div>
      <ul className="space-y-1">
        {NAV.filter((n) => can(n.permission)).map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-brand text-white" : "hover:bg-white/5 hover:text-white"}`
              }
            >
              <n.icon size={18} />
              {n.label}
              {n.to === "/configuracoes" && update?.available && (
                <span className="ml-auto rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-semibold text-ink" title="Há uma atualização do Zenie disponível">atualizar</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-auto px-2 text-[11px] text-slate-500">Zenie {update?.version ?? "0.1"} · AGPL-3.0</div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="w-64">{sidebar}</div>
          <button aria-label="Fechar menu" className="flex-1 bg-black/40" onClick={() => setOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
          <button className="rounded-lg p-1.5 text-muted hover:bg-page lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="relative max-w-xl flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={term}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(term, true)}
              placeholder="Buscar por login PPPoE, serial PON, serial, MAC ou IP"
              className="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{me?.name}</div>
              <div className="text-xs text-muted">{me ? ROLE_LABEL[me.role] : ""}</div>
            </div>
            <button title="Trocar minha senha" className="rounded-lg p-2 text-muted hover:bg-page hover:text-ink" onClick={() => { setPwdDone(false); setPwdOpen(true); }}>
              <KeyRound size={18} />
            </button>
            <button
              title="Sair"
              className="rounded-lg p-2 text-muted hover:bg-page hover:text-bad"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
        <Modal open={pwdOpen} title="Trocar minha senha" subtitle={me?.username} onClose={() => setPwdOpen(false)}>
          {pwdDone ? (
            <div className="space-y-4">
              <Alert tone="ok">Senha alterada. Suas outras sessões abertas foram encerradas.</Alert>
              <button className="text-sm text-brand hover:underline" onClick={() => setPwdOpen(false)}>Fechar</button>
            </div>
          ) : (
            <ChangePasswordForm onDone={() => setPwdDone(true)} onCancel={() => setPwdOpen(false)} />
          )}
        </Modal>
      </div>
      <OverrideDialog />
    </div>
  );
}
