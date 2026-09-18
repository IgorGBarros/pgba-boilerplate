// frontend/src/hooks/useChatPersistence.ts
import { useState, useCallback, useEffect } from "react";
import type { ChatMessage, Conversation } from "@/types/builder";

const DEFAULT_NS = "pgba-studio";

function msgKey(ns: string) { return `${ns}-messages`; }
function histKey(ns: string) { return `${ns}-history`; }

function serializeMessages(msgs: ChatMessage[]): string {
  return JSON.stringify(msgs.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })));
}

function deserializeMessages(raw: string): ChatMessage[] {
  try {
    const arr = JSON.parse(raw);
    return arr.map((m: ChatMessage) => ({ ...m, timestamp: new Date(m.timestamp) }));
  } catch {
    return [];
  }
}

function loadHistory(ns: string): Conversation[] {
  try {
    const raw = localStorage.getItem(histKey(ns));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return arr.map((c: Conversation) => ({
      ...c,
      timestamp: new Date(c.timestamp),
      messages: c.messages.map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
    }));
  } catch {
    return [];
  }
}

function saveHistory(ns: string, convs: Conversation[]) {
  localStorage.setItem(
    histKey(ns),
    JSON.stringify(
      convs.map((c) => ({
        ...c,
        timestamp: c.timestamp.toISOString(),
        messages: c.messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
      })),
    ),
  );
}

function buildTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find((m) => m.type === "user");
  if (!firstUserMsg) return "Conversa sem título";
  return firstUserMsg.content.length > 50 ? firstUserMsg.content.slice(0, 50) + "…" : firstUserMsg.content;
}

export function useChatPersistence(namespace = DEFAULT_NS) {
  const ns = namespace;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getItem(msgKey(ns));
      return raw ? deserializeMessages(raw) : [];
    } catch { return []; }
  });
  const [history, setHistory] = useState<Conversation[]>(() => loadHistory(ns));

  useEffect(() => {
    try { localStorage.setItem(msgKey(ns), serializeMessages(messages)); } catch {}
  }, [messages, ns]);

  useEffect(() => {
    saveHistory(ns, history);
  }, [history, ns]);

  const clearAndArchive = useCallback(() => {
    if (messages.length === 0) return;
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: buildTitle(messages),
      lastMessage: messages[messages.length - 1].content.slice(0, 80),
      timestamp: new Date(),
      messages: [...messages],
    };
    setHistory((prev) => [conv, ...prev]);
    setMessages([]);
  }, [messages]);

  const deleteConversation = useCallback((id: string) => {
    setHistory((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const restoreConversation = useCallback(
    (id: string) => {
      const conv = history.find((c) => c.id === id);
      if (!conv) return;

      if (messages.length > 0) {
        const current: Conversation = {
          id: crypto.randomUUID(),
          title: buildTitle(messages),
          lastMessage: messages[messages.length - 1].content.slice(0, 80),
          timestamp: new Date(),
          messages: [...messages],
        };
        setHistory((prev) => [current, ...prev.filter((c) => c.id !== id)]);
      } else {
        setHistory((prev) => prev.filter((c) => c.id !== id));
      }
      setMessages(conv.messages);
    },
    [history, messages],
  );

  return { messages, setMessages, history, clearAndArchive, deleteConversation, restoreConversation };
}
