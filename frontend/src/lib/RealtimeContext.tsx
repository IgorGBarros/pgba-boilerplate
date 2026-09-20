// frontend/src/lib/RealtimeContext.tsx
//
// Conexão WebSocket única por aba, compartilhada via React Context.
// Antes, cada componente que chamava useRealtime() abria sua própria
// conexão (3-5 conexões simultâneas por aba na tela do Studio). Agora
// um Provider monta a conexão uma vez; todos os consumers recebem os
// eventos via context.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAccessToken } from "@/lib/auth";
import type { Agent, PendingApproval, Task } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const WS_URL = API_URL.replace(/^http/, "ws");
const RECONNECT_DELAY_MS = 3000;

async function fetchWsTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/api/v1/agency/ws-ticket/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

interface RealtimeState {
  connected: boolean;
  lastAgentEvent: Agent | null;
  lastTaskEvent: Task | null;
  lastPendingApprovalEvent: PendingApproval | null;
}

const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  lastAgentEvent: null,
  lastTaskEvent: null,
  lastPendingApprovalEvent: null,
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [lastAgentEvent, setLastAgentEvent] = useState<Agent | null>(null);
  const [lastTaskEvent, setLastTaskEvent] = useState<Task | null>(null);
  const [lastPendingApprovalEvent, setLastPendingApprovalEvent] = useState<PendingApproval | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      // Obtém ticket de uso único para não expor o JWT na URL do WebSocket
      const ticket = await fetchWsTicket();
      if (!ticket || cancelled) return;

      const ws = new WebSocket(`${WS_URL}/ws/agency/?ticket=${ticket}`);
      wsRef.current = ws;

      ws.onopen = () => { if (!cancelled) setConnected(true); };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let data: { kind: string } & Record<string, unknown>;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.kind === "agent") setLastAgentEvent(data as unknown as Agent);
        else if (data.kind === "task") setLastTaskEvent(data as unknown as Task);
        else if (data.kind === "pending_approval") setLastPendingApprovalEvent(data as unknown as PendingApproval);
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimerRef.current = setTimeout(() => { void connect(); }, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => { ws.close(); };
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ connected, lastAgentEvent, lastTaskEvent, lastPendingApprovalEvent }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}
