import { Olts } from "./pages/Olts";
import { AcsSecurity } from "./pages/AcsSecurity";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Layout } from "./components/Layout";
import "./index.css";
import { Audit } from "./pages/Audit";
import { AcsLog } from "./pages/AcsLog";
import { Settings } from "./pages/Settings";
import { ChangePassword } from "./pages/ChangePassword";
import { DeviceDetail } from "./pages/DeviceDetail";
import { Devices } from "./pages/Devices";
import { Homologation } from "./pages/Homologation";
import { HomologationProfile } from "./pages/HomologationProfile";
import { Login } from "./pages/Login";
import { Users } from "./pages/Users";
import { SessionProvider, useSession } from "./session";

/** Exige sessão; com senha temporária, só deixa abrir a troca de senha; checa a permissão da tela. */
function Protected({ permission, children }: { permission?: string; children: ReactNode }) {
  const { me, loading, can } = useSession();
  const location = useLocation();
  if (loading) return <div className="p-8 text-sm text-muted">Carregando...</div>;
  if (!me) return <Navigate to="/login" replace />;
  if (me.mustChangePassword && location.pathname !== "/senha") return <Navigate to="/senha" replace />;
  if (permission && !can(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Navigate to="/dispositivos" replace />} />
            <Route path="/dispositivos" element={<Protected permission="device.view"><Devices /></Protected>} />
            <Route path="/dispositivos/:id" element={<Protected permission="device.view"><DeviceDetail /></Protected>} />
            <Route path="/homologacao" element={<Protected permission="homologation.view"><Homologation /></Protected>} />
            <Route path="/homologacao/:vendor/:model" element={<Protected permission="homologation.view"><HomologationProfile /></Protected>} />
            <Route path="/usuarios" element={<Protected permission="users.manage"><Users /></Protected>} />
            <Route path="/olts" element={<Protected permission="olt.view"><Olts /></Protected>} />
            <Route path="/log-acs" element={<Protected permission="acslog.view"><AcsLog /></Protected>} />
            <Route path="/seguranca-acs" element={<Protected permission="acs.manage"><AcsSecurity /></Protected>} />
            <Route path="/auditoria" element={<Protected permission="audit.view"><Audit /></Protected>} />
            <Route path="/configuracoes" element={<Protected permission="settings.manage"><Settings /></Protected>} />
            <Route path="/senha" element={<ChangePassword />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
