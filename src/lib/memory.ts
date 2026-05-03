// ── Conversation turns (global memory) ──────────────────────────

export interface ConversationTurn {
  id: string;
  userMessage: string;
  aiResponse: string;
  source: 'persona_studio' | 'autopilot' | 'manual';
  timestamp: string;
}

const MEMORY_KEY = 'odessa-persona-memory';
const MAX_TURNS = 50;

export function loadMemory(): ConversationTurn[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMemory(turns: ConversationTurn[]): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    // Storage full or unavailable
  }
}

export function addTurn(
  turns: ConversationTurn[],
  userMessage: string,
  aiResponse: string,
  source: ConversationTurn['source'],
): ConversationTurn[] {
  const updated = [
    ...turns,
    {
      id: crypto.randomUUID(),
      userMessage: userMessage.trim(),
      aiResponse: aiResponse.trim(),
      source,
      timestamp: new Date().toISOString(),
    },
  ].slice(-MAX_TURNS);
  saveMemory(updated);
  return updated;
}

export function buildMemoryContext(turns: ConversationTurn[], windowSize = 8): string {
  if (turns.length === 0) return '';

  const recent = turns.slice(-windowSize);
  const lines = recent.map((turn) => {
    const time = new Date(turn.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const user = truncate(turn.userMessage, 140);
    const ai = truncate(turn.aiResponse, 200);
    return `[${time}] Chat: ${user}\n[${time}] Voce respondeu: ${ai}`;
  });

  return lines.join('\n');
}

export function clearMemory(): ConversationTurn[] {
  try {
    localStorage.removeItem(MEMORY_KEY);
  } catch {
    // Ignore
  }
  return [];
}

// ── Per-user profiles ───────────────────────────────────────────

export type InteractionType = 'chat' | 'gift' | 'follow' | 'alert' | 'moderation';

export interface UserInteraction {
  id: string;
  text: string;
  type: InteractionType;
  timestamp: string;
}

export interface UserProfile {
  username: string;
  interactions: UserInteraction[];
  messageCount: number;
  giftCount: number;
  firstSeen: string;
  lastSeen: string;
}

export type UserProfileMap = Record<string, UserProfile>;

const USERS_KEY = 'odessa-user-profiles';
const MAX_INTERACTIONS_PER_USER = 30;
const MAX_USERS = 100;

export function loadUserProfiles(): UserProfileMap {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUserProfiles(profiles: UserProfileMap): void {
  try {
    // Prune to MAX_USERS by keeping the most recently seen
    const entries = Object.entries(profiles);
    if (entries.length > MAX_USERS) {
      entries.sort((a, b) => b[1].lastSeen.localeCompare(a[1].lastSeen));
      const pruned: UserProfileMap = {};
      for (const [key, value] of entries.slice(0, MAX_USERS)) {
        pruned[key] = value;
      }
      localStorage.setItem(USERS_KEY, JSON.stringify(pruned));
      return;
    }
    localStorage.setItem(USERS_KEY, JSON.stringify(profiles));
  } catch {
    // Storage full or unavailable
  }
}

/**
 * Extracts a username from a chat message.
 * Supports formats like:
 *   - "@Lucas: mensagem"
 *   - "Lucas: mensagem"
 *   - "Chat: @Lucas mandou rosas"
 *   - "Presentes: Ana enviou Rosa x5"
 *   - "@user> mensagem"
 */
export function extractUsername(text: string): string | null {
  const cleaned = text.replace(/^(Chat|Presentes|Alertas|Gifts|Alerts):\s*/i, '').trim();

  // @username: or @username> or @username<space>
  const atMatch = cleaned.match(/^@([A-Za-z0-9_.-]{2,25})\s*[:>\s]/);
  if (atMatch) return atMatch[1];

  // username: message
  const colonMatch = cleaned.match(/^([A-Za-z0-9_.-]{2,25}):\s/);
  if (colonMatch) return colonMatch[1];

  // "Ana enviou..." / "Lucas mandou..."
  const actionMatch = cleaned.match(
    /^([A-Za-z0-9_.-]{2,25})\s+(enviou|mandou|entrou|seguiu|curtiu|comecou)/i,
  );
  if (actionMatch) return actionMatch[1];

  // "Novo seguidor: Nome"
  const followerMatch = cleaned.match(/(?:seguidor|follower):\s*([A-Za-z0-9_.-]{2,25})/i);
  if (followerMatch) return followerMatch[1];

  return null;
}

/**
 * Detects the interaction type from message text.
 */
export function detectInteractionType(text: string): InteractionType {
  const lower = text.toLowerCase();

  if (/enviou|mandou|rosa|presente|gift|coin|moeda/i.test(lower)) return 'gift';
  if (/seguidor|seguiu|follower|entrou na live/i.test(lower)) return 'follow';
  if (/alerta|alert|notifica/i.test(lower)) return 'alert';
  if (/spam|ban|mute|suspeita|moderac/i.test(lower)) return 'moderation';

  return 'chat';
}

/**
 * Tracks a user interaction, updating their profile.
 */
export function trackUserInteraction(
  profiles: UserProfileMap,
  text: string,
  typeOverride?: InteractionType,
): UserProfileMap {
  const username = extractUsername(text);
  if (!username) return profiles;

  const now = new Date().toISOString();
  const type = typeOverride ?? detectInteractionType(text);
  const key = username.toLowerCase();

  const existing = profiles[key];
  const interaction: UserInteraction = {
    id: crypto.randomUUID(),
    text: truncate(text, 200),
    type,
    timestamp: now,
  };

  const profile: UserProfile = existing
    ? {
        ...existing,
        interactions: [...existing.interactions, interaction].slice(-MAX_INTERACTIONS_PER_USER),
        messageCount: existing.messageCount + (type === 'chat' ? 1 : 0),
        giftCount: existing.giftCount + (type === 'gift' ? 1 : 0),
        lastSeen: now,
      }
    : {
        username,
        interactions: [interaction],
        messageCount: type === 'chat' ? 1 : 0,
        giftCount: type === 'gift' ? 1 : 0,
        firstSeen: now,
        lastSeen: now,
      };

  const updated = { ...profiles, [key]: profile };
  saveUserProfiles(updated);
  return updated;
}

/**
 * Builds a context block summarizing known users for the AI prompt.
 * Only includes users seen recently (within the session).
 */
export function buildUserContext(profiles: UserProfileMap, maxUsers = 8): string {
  const entries = Object.values(profiles);
  if (entries.length === 0) return '';

  // Sort by lastSeen descending (most recent first)
  const sorted = entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, maxUsers);

  const lines = sorted.map((profile) => {
    const parts: string[] = [`@${profile.username}`];

    if (profile.messageCount > 0) parts.push(`${profile.messageCount} msgs`);
    if (profile.giftCount > 0) parts.push(`${profile.giftCount} presentes`);

    // Show last 3 interactions as context
    const recentInteractions = profile.interactions.slice(-3);
    const interactionSummary = recentInteractions
      .map((i) => {
        const time = new Date(i.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return `  [${time}] (${i.type}) ${truncate(i.text, 80)}`;
      })
      .join('\n');

    return `${parts.join(' | ')}\n${interactionSummary}`;
  });

  return lines.join('\n');
}

/**
 * Gets sorted user profiles as an array for UI display.
 */
export function getUserProfileList(profiles: UserProfileMap): UserProfile[] {
  return Object.values(profiles).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function clearUserProfiles(): UserProfileMap {
  try {
    localStorage.removeItem(USERS_KEY);
  } catch {
    // Ignore
  }
  return {};
}

// ── Shared utilities ────────────────────────────────────────────

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
