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
  lastMessage?: string;
  recurringTopics?: Record<string, number>;
  preferredTone?: 'playful' | 'warm' | 'direct' | 'supportive';
  giftNames?: Record<string, number>;
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

function metadataText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeMemoryText(text: string, max = 160): string {
  const clean = text
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, '[numero]')
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[cartao]')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(clean, max);
}

const TOPIC_STOPWORDS = new Set([
  'chat', 'live', 'tango', 'juju', 'odessa', 'voce', 'voces', 'para', 'com', 'uma', 'esse', 'essa',
  'isso', 'aqui', 'agora', 'muito', 'muita', 'mais', 'como', 'quando', 'onde', 'porque', 'the',
  'and', 'you', 'your', 'this', 'that', 'what', 'when', 'where',
]);

function extractMemoryTopics(text: string): string[] {
  const lower = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const words = lower.match(/[a-z0-9]{4,}/g) || [];
  return Array.from(new Set(words.filter((word) => !TOPIC_STOPWORDS.has(word)))).slice(0, 4);
}

function inferPreferredTone(text: string): UserProfile['preferredTone'] | undefined {
  const lower = text.toLowerCase();
  if (/[?!]{2,}|\b(k{2,}|haha|rsrs|brinca|zoa|engracad|funny)\b/i.test(lower)) return 'playful';
  if (/\b(obrigad|valeu|boa|linda|amei|love|cute|top)\b/i.test(lower)) return 'warm';
  if (/\b(ajuda|triste|cansad|dificil|forca|desabafo|support)\b/i.test(lower)) return 'supportive';
  if (/\b(qual|quando|onde|faz|toca|mostra|manda|como)\b/i.test(lower)) return 'direct';
  return undefined;
}

function pruneCounter(counter: Record<string, number>, limit = 12) {
  return Object.fromEntries(
    Object.entries(counter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

function eventUsername(event: { text: string; metadata?: Record<string, unknown> }) {
  return metadataText(event.metadata?.user) || metadataText(event.metadata?.sender) || extractUsername(event.text);
}

function eventMessage(event: { text: string; metadata?: Record<string, unknown> }) {
  return metadataText(event.metadata?.message) || event.text.replace(/^@?[\w.-]{2,25}\s*[:>]\s*/, '').trim();
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
  const safeText = sanitizeMemoryText(text, 200);
  const message = sanitizeMemoryText(text.replace(/^@?[\w.-]{2,25}\s*[:>]\s*/, '').trim(), 140);
  const topics = extractMemoryTopics(message);
  const recurringTopics = { ...(existing?.recurringTopics || {}) };
  topics.forEach((topic) => {
    recurringTopics[topic] = (recurringTopics[topic] || 0) + 1;
  });
  const preferredTone = inferPreferredTone(message) || existing?.preferredTone;
  const interaction: UserInteraction = {
    id: crypto.randomUUID(),
    text: safeText,
    type,
    timestamp: now,
  };

  const profile: UserProfile = existing
    ? {
        ...existing,
        interactions: [...existing.interactions, interaction].slice(-MAX_INTERACTIONS_PER_USER),
        messageCount: existing.messageCount + (type === 'chat' ? 1 : 0),
        giftCount: existing.giftCount + (type === 'gift' ? 1 : 0),
        lastMessage: type === 'chat' && message ? message : existing.lastMessage,
        recurringTopics: pruneCounter(recurringTopics),
        preferredTone,
        lastSeen: now,
      }
    : {
        username,
        interactions: [interaction],
        messageCount: type === 'chat' ? 1 : 0,
        giftCount: type === 'gift' ? 1 : 0,
        lastMessage: type === 'chat' && message ? message : undefined,
        recurringTopics: pruneCounter(recurringTopics),
        preferredTone,
        firstSeen: now,
        lastSeen: now,
      };

  const updated = { ...profiles, [key]: profile };
  saveUserProfiles(updated);
  return updated;
}

export function trackLiveEventInteraction(profiles: UserProfileMap, event: {
  text: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}): UserProfileMap {
  const username = eventUsername(event);
  if (!username) return profiles;
  const type: InteractionType =
    event.kind === 'gift'
      ? 'gift'
      : event.kind === 'alert'
        ? 'alert'
        : event.kind === 'moderation'
          ? 'moderation'
          : 'chat';
  const message = event.kind === 'gift'
    ? `${username} enviou ${metadataText(event.metadata?.giftName) || metadataText(event.metadata?.giftKey) || 'presente'}`
    : `${username}: ${eventMessage(event)}`;
  const updated = trackUserInteraction(profiles, message, type);
  const key = username.toLowerCase();
  const profile = updated[key];
  if (profile && type === 'gift') {
    const gift = metadataText(event.metadata?.giftName) || metadataText(event.metadata?.giftKey);
    if (gift) {
      const safeGift = sanitizeMemoryText(gift, 40);
      updated[key] = {
        ...profile,
        giftNames: pruneCounter({
          ...(profile.giftNames || {}),
          [safeGift]: (profile.giftNames?.[safeGift] || 0) + 1,
        }),
      };
      saveUserProfiles(updated);
    }
  }
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
    if (profile.preferredTone) parts.push(`tom ${profile.preferredTone}`);
    const topics = Object.entries(profile.recurringTopics || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic]) => topic);
    if (topics.length) parts.push(`temas: ${topics.join(', ')}`);
    if (profile.lastMessage) parts.push(`ultima: "${truncate(profile.lastMessage, 70)}"`);

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

export function buildRoundUserMemorySummary(
  events: Array<{ text: string; kind?: string; metadata?: Record<string, unknown> }>,
  profiles: UserProfileMap,
  maxItems = 5,
): string[] {
  const names = Array.from(new Set(events.map(eventUsername).filter(Boolean) as string[]));
  const summaries: string[] = [];
  for (const name of names) {
    const profile = profiles[name.toLowerCase()];
    if (!profile) {
      summaries.push(`@${name}: usuario novo ou sem historico local.`);
      continue;
    }
    const status = profile.giftCount > 0
      ? 'presenteador'
      : profile.messageCount > 1
        ? 'recorrente'
        : 'novo';
    const bits = [`@${profile.username}: ${status}`];
    if (profile.messageCount > 1) bits.push(`${profile.messageCount} msgs`);
    if (profile.giftCount > 0) bits.push(`${profile.giftCount} presentes`);
    if (profile.preferredTone) bits.push(`tom ${profile.preferredTone}`);
    const topics = Object.entries(profile.recurringTopics || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic]) => topic);
    if (topics.length) bits.push(`temas ${topics.join(', ')}`);
    if (profile.lastMessage) bits.push(`ultima "${truncate(profile.lastMessage, 60)}"`);
    summaries.push(bits.join('; '));
    if (summaries.length >= maxItems) break;
  }
  return summaries;
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
