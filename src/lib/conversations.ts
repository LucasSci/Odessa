import { apiUrl } from './api';

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status?: 'received' | 'draft' | 'approved' | 'sent' | string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  approvedAt?: string;
  sentAt?: string;
};

export type Conversation = {
  id: string;
  source: string;
  participantId: string;
  participantName: string;
  status: string;
  metadata?: Record<string, unknown>;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { detail?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await parseJson<{ conversations?: Conversation[] }>(
    await fetch(apiUrl('/conversations')),
  );
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function createConversation(payload: {
  participantId: string;
  participantName?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<Conversation> {
  return parseJson<Conversation>(
    await fetch(apiUrl('/conversations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

export async function getConversation(conversationId: string): Promise<Conversation> {
  return parseJson<Conversation>(
    await fetch(apiUrl(`/conversations/${encodeURIComponent(conversationId)}`)),
  );
}

export async function addConversationMessage(
  conversationId: string,
  payload: {
    role?: ConversationMessage['role'];
    text: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ConversationMessage> {
  return parseJson<ConversationMessage>(
    await fetch(apiUrl(`/conversations/${encodeURIComponent(conversationId)}/messages`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

export async function generateConversationReply(
  conversationId: string,
  payload: {
    personaPrompt: string;
    model?: string;
    temperature?: number;
  },
): Promise<{ message: ConversationMessage; provider: string }> {
  return parseJson<{ message: ConversationMessage; provider: string }>(
    await fetch(apiUrl(`/conversations/${encodeURIComponent(conversationId)}/reply`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

export async function approveConversationReply(
  conversationId: string,
  messageId: string,
): Promise<ConversationMessage> {
  return parseJson<ConversationMessage>(
    await fetch(apiUrl(`/conversations/${encodeURIComponent(conversationId)}/approve`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    }),
  );
}
