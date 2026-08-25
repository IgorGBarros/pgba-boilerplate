// frontend/src/hooks/useChatPersistence.ts
import { useState, useCallback, useEffect } from "react";
import type { ChatMessage, Conversation } from "@/types/builder";

const MESSAGES_KEY = "pgba-studio-messages";
const HISTORY_KEY = "pgba-studio-history";

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

function loadHistory(): Conversation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
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

function saveHistory(convs: Conversation[]) {
  localStorage.setItem(
    HISTORY_KEY,
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

export function useChatPersistence() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const raw = localStorage.getItem(MESSAGES_KEY);
    return raw ? deserializeMessages(raw) : [];
  });
  const [history, setHistory] = useState<Conversation[]>(loadHistory);

  useEffect(() => {
    localStorage.setItem(MESSAGES_KEY, serializeMessages(messages));
  }, [messages]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

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
