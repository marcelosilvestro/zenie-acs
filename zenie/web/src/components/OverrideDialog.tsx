// Diálogo global de liberação manual: aparece quando a API barra um recurso não homologado e o
// usuário é admin (api.ts repete a chamada com a liberação; a API registra na auditoria).

import { useEffect, useState } from "react";
import { setOverrideHandler } from "../api";
import { ConfirmDialog } from "./ui";

export function OverrideDialog() {
  const [ask, setAsk] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    setOverrideHandler((reason) => new Promise<boolean>((resolve) => setAsk({ reason, resolve })));
    return () => setOverrideHandler(null);
  }, []);

  const close = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  // z-[70]: fica acima dos outros diálogos (z-[60]) que estão esperando esta resposta.
  return (
    <div className="relative z-[70]">
      <ConfirmDialog open={!!ask} title="Recurso não homologado" danger confirmLabel="Liberar desta vez" onCancel={() => close(false)} onConfirm={() => close(true)}>
        <p>{ask?.reason}.</p>
        <p className="mt-2">
          Como administrador, você pode liberar <b>só esta operação</b>. A liberação fica registrada na auditoria.
          Em caso de dúvida, homologue o recurso no servidor de testes primeiro.
        </p>
      </ConfirmDialog>
    </div>
  );
}
