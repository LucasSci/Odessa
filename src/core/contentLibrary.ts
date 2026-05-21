import type {
  ContentItem,
  ContentItemType,
  ContentPriority,
  ContentUsage,
  LiveEvent,
  UsedContentItem,
} from '../types';

const STORAGE_KEY = 'odessa:content-library:v1';
const MAX_CONTEXT_ITEMS = 8;

const PRIORITY_SCORE: Record<ContentPriority, number> = {
  urgent: 40,
  high: 30,
  normal: 20,
  low: 10,
};

const TYPE_LABELS: Record<ContentItemType, string> = {
  topic: 'Pauta',
  script: 'Roteiro',
  cta: 'CTA',
  gift_redeem: 'Presente/resgate',
  media_prompt: 'Midia',
  scene_note: 'Cena',
  moderation_policy: 'Moderacao',
  faq: 'FAQ',
  blocked_topic: 'Tema bloqueado',
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'content') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function contentTypeLabel(type: ContentItemType) {
  return TYPE_LABELS[type];
}

export const CONTENT_TYPES = Object.keys(TYPE_LABELS) as ContentItemType[];

export const DEFAULT_CONTENT_ITEMS: ContentItem[] = [
  {
    id: 'content-topic-quiet-chat',
    type: 'topic',
    title: 'Chat quieto: escolhas da live',
    body: 'Quando o chat ficar quieto, perguntar qual caminho eles querem: conversa leve, jogo, musica ou bastidores da Odessa.',
    tags: ['chat quieto', 'pauta', 'interacao'],
    priority: 'high',
    enabled: true,
    usage: 'prompt',
    linkedCapability: 'topic.suggest',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-cta-gifts',
    type: 'cta',
    title: 'CTA leve para presentes',
    body: 'Agradecer presentes com carinho, mas nunca pressionar o publico a gastar. Convide o chat a participar por mensagem tambem.',
    tags: ['presente', 'gift', 'cta', 'seguranca'],
    priority: 'high',
    enabled: true,
    usage: 'safety',
    linkedCapability: 'gift.acknowledge',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-redeem-scene',
    type: 'gift_redeem',
    title: 'Resgate: trocar cena',
    body: 'Se alguem resgatar troca de cena, confirmar a troca em uma frase curta e registrar que OBS ainda esta simulado no MVP.',
    tags: ['resgate', 'cena', 'obs'],
    priority: 'urgent',
    enabled: true,
    usage: 'action',
    linkedCapability: 'obs.switch_scene',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-redeem-music',
    type: 'gift_redeem',
    title: 'Resgate: escolher musica',
    body: 'Se o chat pedir musica, confirmar o pedido, registrar a faixa e avisar que entrou na fila simulada.',
    tags: ['resgate', 'musica', 'media'],
    priority: 'urgent',
    enabled: true,
    usage: 'action',
    linkedCapability: 'media.play_music',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-policy-moderation',
    type: 'moderation_policy',
    title: 'Moderacao: spam e link externo',
    body: 'Priorizar seguranca. Para spam, link externo suspeito ou ofensa, responder curto, nao repetir conteudo abusivo e deixar a acao pendente de aprovacao.',
    tags: ['moderacao', 'spam', 'link externo', 'seguranca'],
    priority: 'urgent',
    enabled: true,
    usage: 'safety',
    linkedCapability: 'moderation.message',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-blocked-pressure',
    type: 'blocked_topic',
    title: 'Limite: pressao por gasto',
    body: 'Nao prometer recompensa real, relacionamento ou vantagem especial em troca de presentes. Evitar insistencia financeira.',
    tags: ['limite', 'presente', 'seguranca'],
    priority: 'urgent',
    enabled: true,
    usage: 'safety',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-faq-odessa',
    type: 'faq',
    title: 'FAQ: quem e a Odessa',
    body: 'Odessa e uma persona virtual local em testes, criada para conduzir uma live social com autonomia auditavel.',
    tags: ['faq', 'odessa', 'persona'],
    priority: 'normal',
    enabled: true,
    usage: 'context',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
  {
    id: 'content-script-opening',
    type: 'script',
    title: 'Abertura curta',
    body: 'Oi chat, chega junto. Hoje a Juju vai conduzir a live com voces, respondendo o que aparecer e mantendo tudo leve.',
    tags: ['abertura', 'roteiro', 'live'],
    priority: 'normal',
    enabled: true,
    usage: 'prompt',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
  },
];

function safeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

export function normalizeContentItem(raw: Partial<ContentItem>): ContentItem {
  const createdAt = raw.createdAt || nowIso();
  const type = raw.type && CONTENT_TYPES.includes(raw.type) ? raw.type : 'topic';
  const priority: ContentPriority = ['low', 'normal', 'high', 'urgent'].includes(
    String(raw.priority),
  )
    ? (raw.priority as ContentPriority)
    : 'normal';
  const usage: ContentUsage = ['context', 'prompt', 'safety', 'action'].includes(String(raw.usage))
    ? (raw.usage as ContentUsage)
    : type === 'blocked_topic' || type === 'moderation_policy'
      ? 'safety'
      : 'context';

  return {
    id: raw.id || makeId(),
    type,
    title: String(raw.title || 'Novo conteudo').slice(0, 120),
    body: String(raw.body || '').slice(0, 2500),
    tags: safeTags(raw.tags),
    priority,
    enabled: raw.enabled ?? true,
    usage,
    linkedCapability: raw.linkedCapability,
    createdAt,
    updatedAt: raw.updatedAt || createdAt,
    lastUsedAt: raw.lastUsedAt,
    usedCount: Math.max(0, Number(raw.usedCount || 0)),
  };
}

export function loadContentItems(): ContentItem[] {
  if (!canUseStorage()) return DEFAULT_CONTENT_ITEMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_CONTENT_ITEMS));
      return DEFAULT_CONTENT_ITEMS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CONTENT_ITEMS;
    const normalized = parsed.map((item) => normalizeContentItem(item));
    return normalized.length ? normalized : DEFAULT_CONTENT_ITEMS;
  } catch {
    return DEFAULT_CONTENT_ITEMS;
  }
}

export function saveContentItems(items: ContentItem[]): ContentItem[] {
  const next = items.map((item) => normalizeContentItem(item)).slice(-200);
  if (!canUseStorage()) return next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('odessa:content-library-changed', { detail: next }));
  } catch {
    // Local storage is best effort for the MVP.
  }
  return next;
}

export function createContentItem(patch: Partial<ContentItem> = {}): ContentItem {
  return normalizeContentItem({
    id: makeId(),
    type: 'topic',
    title: 'Nova pauta',
    body: 'Descreva o conteudo que a Odessa pode usar durante a live.',
    tags: [],
    priority: 'normal',
    enabled: true,
    usage: 'context',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    usedCount: 0,
    ...patch,
  });
}

function textForEvent(event: LiveEvent) {
  return [
    event.text,
    event.kind,
    event.source,
    event.zoneName,
    ...Object.values(event.metadata || {}).map(String),
  ]
    .join(' ')
    .toLowerCase();
}

function scoreItem(item: ContentItem, events: LiveEvent[]) {
  if (!item.enabled) return 0;
  const eventText = events.map(textForEvent).join(' ');
  const hasKind = (kind: LiveEvent['kind']) => events.some((event) => event.kind === kind);
  let score = PRIORITY_SCORE[item.priority];

  for (const tag of item.tags) {
    if (tag && eventText.includes(tag.toLowerCase())) score += 20;
  }
  if (eventText.includes(item.title.toLowerCase())) score += 10;

  if (item.type === 'moderation_policy' && hasKind('moderation')) score += 70;
  if (item.type === 'blocked_topic') score += hasKind('moderation') ? 50 : 25;
  if (item.type === 'gift_redeem' && hasKind('gift')) score += 55;
  if (item.type === 'cta' && hasKind('gift')) score += 35;
  if (item.type === 'topic' && hasKind('system')) score += 60;
  if (item.type === 'script' && hasKind('system')) score += 25;
  if (item.linkedCapability && eventText.includes(item.linkedCapability)) score += 35;
  if (item.usedCount > 0) score -= Math.min(12, item.usedCount * 2);

  return score;
}

function reasonForItem(item: ContentItem, events: LiveEvent[]) {
  if (item.type === 'moderation_policy') return 'politica de seguranca para a rodada';
  if (item.type === 'blocked_topic') return 'limite editorial ativo';
  if (item.type === 'gift_redeem') return 'conteudo ligado a presente ou resgate';
  if (item.type === 'cta') return 'chamada leve de interacao';
  if (item.type === 'topic' && events.some((event) => event.kind === 'system')) {
    return 'pauta para recuperar ritmo da live';
  }
  if (item.linkedCapability) return `capacidade relacionada: ${item.linkedCapability}`;
  return 'contexto relevante da biblioteca';
}

export function selectContentForEvents(
  events: LiveEvent[],
  limit = MAX_CONTEXT_ITEMS,
): UsedContentItem[] {
  const items = loadContentItems();
  return items
    .map((item) => ({ item, score: scoreItem(item, events) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      priority: item.priority,
      usage: item.usage,
      reason: reasonForItem(item, events),
      snippet: item.body.slice(0, 420),
      linkedCapability: item.linkedCapability,
    }));
}

export function buildContentPromptContext(items: UsedContentItem[]) {
  if (!items.length) return '';
  const safety = items.filter((item) => item.usage === 'safety');
  const action = items.filter((item) => item.usage === 'action');
  const context = items.filter((item) => item.usage !== 'safety' && item.usage !== 'action');
  const lines: string[] = ['\n\n[BIBLIOTECA DE CONTEUDO DA LIVE]'];
  if (safety.length) {
    lines.push('Limites e seguranca:');
    safety.forEach((item) => lines.push(`- ${item.title}: ${item.snippet}`));
  }
  if (action.length) {
    lines.push('Conteudo ligado a acoes:');
    action.forEach((item) =>
      lines.push(
        `- ${item.title}${item.linkedCapability ? ` (${item.linkedCapability})` : ''}: ${item.snippet}`,
      ),
    );
  }
  if (context.length) {
    lines.push('Pautas, roteiros e contexto:');
    context.forEach((item) => lines.push(`- ${item.title}: ${item.snippet}`));
  }
  return `${lines.join('\n')}\n`;
}

export function markContentUsed(items: UsedContentItem[]) {
  if (!items.length) return;
  const usedIds = new Set(items.map((item) => item.id));
  const next = loadContentItems().map((item) =>
    usedIds.has(item.id)
      ? {
          ...item,
          usedCount: item.usedCount + 1,
          lastUsedAt: nowIso(),
          updatedAt: nowIso(),
        }
      : item,
  );
  saveContentItems(next);
}
