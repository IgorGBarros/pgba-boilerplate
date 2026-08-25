// frontend/src/types/builder.ts
export type MessageType = "user" | "assistant" | "error" | "fix" | "plan";

export interface ChatMessage {
  id: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  fileName?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

export interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
  messages: ChatMessage[];
}
