// frontend/src/pages/MarketingConectado.tsx — volta do login OAuth de uma rede social (janela pop-up)
import { useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

export function MarketingConectado() {
  const q = new URLSearchParams(window.location.search);
  const ok = q.get("ok") === "1";
  const msg = q.get("msg") ?? "";
  useEffect(() => {
    if (window.opener) {
      try { window.opener.postMessage({ tipo: "marketing-oauth", ok }, window.location.origin); } catch { /* outra origem */ }
      if (ok) setTimeout(() => window.close(), 1800);
    }
  }, [ok]);
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        {ok ? <CheckCircle2 className="mx-auto size-10 text-success" /> : <XCircle className="mx-auto size-10 text-destructive" />}
        <h1 className="mt-3 font-display text-lg font-semibold">{ok ? "Conta conectada" : "Não conectou"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{msg || (ok ? "Pronto." : "Tente de novo pela tela Contas do Marketing.")}</p>
        <p className="mt-4 text-xs text-muted-foreground">{window.opener ? (ok ? "Esta janela fecha sozinha." : "Pode fechar esta janela.") : <a className="text-primary" href="/">Voltar ao sistema</a>}</p>
      </div>
    </div>
  );
}
