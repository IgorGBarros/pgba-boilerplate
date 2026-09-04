// frontend/src/lib/useRealtime.ts
import { useEffect, useRef, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import type { Agent, PendingApproval, Task } from "@/lib/api";

const WS_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/^http/, "ws");
const RECONNECT_DELAY_MS = 3000;

interface AgentEvent extends Agent {
  kind: "agent";
}
interface TaskEvent extends Task {
  kind: "task";
}
interface PendingApprovalEvent extends PendingApproval {
  kind: "pending_approval";
}
type RealtimeEvent = AgentEvent | TaskEvent | PendingApprovalEvent;

interface RealtimeState {
  connected: boolean;
  lastAgentEvent: Agent | null;
  lastTaskEvent: Task | null;
  lastPendingApprovalEvent: PendingApproval | null;
}

/**
 * Uma conexão WebSocket por componente que chama o hook — em telas com
 * vários painéis (Studio: CompanyOverview + CompanyOffice3D + TaskBoard
 * ao mesmo tempo), isso abre uma conexão por painel. Aceitável por ora
 * (o backend aguenta várias conexões por tenant sem problema — é um
 * `group_send` por tenant, não por conexão), mas se algum dia isso pesar,
 * o próximo passo é levantar isso pra um contexto React compartilhado em
 * vez de um hook por componente.
 *
 * Token vai na URL (`?token=...`) — WebSocket nativo do navegador não
 * permite header `Authorization` customizado (ver agency/ws_auth.py no
 * backend, mesma limitação, mesma solução dos dois lados).
 */
export function useRealtime(): RealtimeState {
  const [connected, setConnected] = useState(false);
  const [lastAgentEvent, setLastAgentEvent] = useState<Agent | null>(null);
  const [lastTaskEvent, setLastTaskEvent] = useState<Task | null>(null);
  const [lastPendingApprovalEvent, setLastPendingApprovalEvent] = useState<PendingApproval | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      const token = getAccessToken();
      if (!token || cancelled) return;

      const ws = new WebSocket(`${WS_URL}/ws/agency/?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        let data: RealtimeEvent;
        try {
          data = JSON.parse(event.data);
        } catch {
          return; // mensagem que não é JSON válido — ignora, nunca derruba a UI por isso
        }
        if (data.kind === "agent") setLastAgentEvent(data);
        else if (data.kind === "task") setLastTaskEvent(data);
        else if (data.kind === "pending_approval") setLastPendingApprovalEvent(data);
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        // Reconecta sozinho — token expirado vira uma reconexão que falha
        // e tenta de novo, não trava a UI num estado "desconectado para sempre".
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connected, lastAgentEvent, lastTaskEvent, lastPendingApprovalEvent };
}
