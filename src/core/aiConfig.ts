/**
 * aiConfig — configuração local da IA, persiste em localStorage.
 *
 * Separado do aiDecisionContract para manter aquele arquivo focado
 * na lógica de chamada. Este módulo é o único lugar que toca
 * localStorage para configurações de IA.
 */

const STORAGE_KEY = 'odessa:ai:config:v2';

/** Prompt padrão do sistema — mesmo usado em api/[...path].js. */
export const AI_SYSTEM_PROMPT_DEFAULT = `\
Você é o motor de decisão de IA da Odessa, uma persona de live TikTok interativa.
Sua tarefa: analisar um evento capturado por OCR ao vivo e decidir como a persona deve reagir.

Responda SOMENTE com um objeto JSON válido. Sem markdown, sem texto fora do JSON.

Estrutura obrigatória:
{
  "intent": "gift_reaction" | "greeting" | "compliment_response" | "question_response" | "idle_maintenance" | "special_event" | "unknown",
  "emotion": "happy" | "excited" | "grateful" | "neutral" | "shy" | "playful" | "surprised",
  "recommendedAction": "play_video" | "queue_video" | "wait" | "no_action",
  "selectedTriggerId": "<id do gatilho selecionado da lista>" | null,
  "selectedVideoId": "<id do vídeo selecionado da lista>" | null,
  "selectedVideoLabel": "<label do vídeo>" | null,
  "confidence": <número entre 0 e 1>,
  "reasoning": "<motivo em português, máximo 120 caracteres>"
}

Regras:
- Prefira gatilhos que combinem com o tipo do evento (gift → gatilhos de gift)
- Se nenhum gatilho combinar, deixe selectedTriggerId e selectedVideoId como null
- confidence acima de 0.8 → play_video; entre 0.5–0.8 → queue_video; abaixo → wait
- Para eventos de baixa relevância use intent: "idle_maintenance" e wait
`;

export type AiProvider = 'auto' | 'gemini' | 'mock';

/**
 * Nível de autonomia da Diretora de IA.
 *  - manual:    a IA sugere, mas nada executa sozinho (toda ação pede aprovação).
 *  - assistido: vídeo/voz/cena executam sozinhos; ações sensíveis (moderação) pedem aprovação.
 *  - auto:      tudo executa automaticamente dentro do que está habilitado no registry.
 */
export type AiAutonomyLevel = 'manual' | 'assistido' | 'auto';

export type AiLocalConfig = {
  /** Chave Gemini digitada pelo usuário (nunca vai para o servidor). */
  geminiKey: string;
  /** Prompt de sistema customizado. '' = usa o padrão. */
  systemPrompt: string;
  /** Provedor: auto = tenta Gemini, cai para mock; gemini = força Gemini; mock = sempre mock. */
  provider: AiProvider;
  /** Limiar mínimo de confiança para disparar play_video. Padrão: 0.65. */
  confidenceThreshold: number;
  /** Quanto a Diretora pode executar sozinha. Padrão: 'assistido'. */
  autonomyLevel: AiAutonomyLevel;
  /**
   * URL da "ponte" que encaminha as chamadas à Gemini (ex.: um Cloudflare
   * Worker). O browser não consegue chamar a Gemini direto (o Google não
   * responde o preflight CORS), então a ponte faz isso. '' = tenta o
   * proxy do próprio servidor (/api/ai/gemini).
   */
  geminiProxyUrl: string;
  /** Permite que a Diretora gere respostas publicas no chat ao vivo. */
  autoChatReplyEnabled: boolean;
  /** Dry-run por padrao; envio real precisa ser ativado explicitamente. */
  autoChatReplyMode: 'dry_run' | 'real';
  /** Cooldown minimo entre respostas publicas no chat. */
  chatReplyCooldownMs: number;
  /** Limite de respostas publicas por minuto. */
  chatReplyMaxPerMinute: number;
  /** Confiança minima do OCR para permitir resposta publica. */
  chatReplyMinConfidence: number;
};

const DEFAULTS: AiLocalConfig = {
  geminiKey: '',
  systemPrompt: '',
  provider: 'auto',
  confidenceThreshold: 0.65,
  autonomyLevel: 'assistido',
  geminiProxyUrl: '',
  autoChatReplyEnabled: false,
  autoChatReplyMode: 'dry_run',
  chatReplyCooldownMs: 15_000,
  chatReplyMaxPerMinute: 4,
  chatReplyMinConfidence: 0.65,
};

function readRaw(): Partial<AiLocalConfig> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    return JSON.parse(raw) as Partial<AiLocalConfig>;
  } catch {
    return {};
  }
}

/** Lê a configuração atual (merged com defaults). */
export function getAiConfig(): AiLocalConfig {
  const stored = readRaw();
  return {
    geminiKey: typeof stored.geminiKey === 'string' ? stored.geminiKey : DEFAULTS.geminiKey,
    systemPrompt: typeof stored.systemPrompt === 'string' ? stored.systemPrompt : DEFAULTS.systemPrompt,
    provider: (['auto','gemini','mock'] as AiProvider[]).includes(stored.provider as AiProvider)
      ? (stored.provider as AiProvider)
      : DEFAULTS.provider,
    confidenceThreshold: typeof stored.confidenceThreshold === 'number'
      ? Math.max(0.1, Math.min(0.99, stored.confidenceThreshold))
      : DEFAULTS.confidenceThreshold,
    autonomyLevel: (['manual','assistido','auto'] as AiAutonomyLevel[]).includes(stored.autonomyLevel as AiAutonomyLevel)
      ? (stored.autonomyLevel as AiAutonomyLevel)
      : DEFAULTS.autonomyLevel,
    geminiProxyUrl: typeof stored.geminiProxyUrl === 'string' ? stored.geminiProxyUrl.trim() : DEFAULTS.geminiProxyUrl,
    autoChatReplyEnabled: stored.autoChatReplyEnabled === true,
    autoChatReplyMode: stored.autoChatReplyMode === 'real' ? 'real' : DEFAULTS.autoChatReplyMode,
    chatReplyCooldownMs: typeof stored.chatReplyCooldownMs === 'number'
      ? Math.max(3_000, Math.min(120_000, stored.chatReplyCooldownMs))
      : DEFAULTS.chatReplyCooldownMs,
    chatReplyMaxPerMinute: typeof stored.chatReplyMaxPerMinute === 'number'
      ? Math.max(1, Math.min(20, Math.round(stored.chatReplyMaxPerMinute)))
      : DEFAULTS.chatReplyMaxPerMinute,
    chatReplyMinConfidence: typeof stored.chatReplyMinConfidence === 'number'
      ? Math.max(0.1, Math.min(0.99, stored.chatReplyMinConfidence))
      : DEFAULTS.chatReplyMinConfidence,
  };
}

/** URL efetiva da ponte Gemini (vazio = usa o proxy do próprio servidor). */
export function getGeminiProxyUrl(): string {
  const buildUrl = (import.meta.env as Record<string, string>).VITE_GEMINI_PROXY_URL ?? '';
  return (buildUrl || getAiConfig().geminiProxyUrl || '').trim();
}

/** Persiste uma atualização parcial. */
export function saveAiConfig(patch: Partial<AiLocalConfig>): void {
  try {
    const current = readRaw();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // localStorage indisponível — silencioso
  }
}

/**
 * Retorna a chave Gemini efetiva.
 * Prioridade: variável de build (VITE_GEMINI_API_KEY) > localStorage.
 */
export function getEffectiveGeminiKey(): string {
  // Variável embutida na build pelo Vite tem prioridade máxima
  const buildKey = (import.meta.env as Record<string, string>).VITE_GEMINI_API_KEY ?? '';
  if (buildKey) return buildKey;
  return getAiConfig().geminiKey;
}

/** True se há uma chave Gemini disponível (build ou localStorage). */
export function hasActiveGeminiKey(): boolean {
  return Boolean(getEffectiveGeminiKey());
}

/**
 * Retorna o prompt de sistema efetivo.
 * Se o usuário tiver salvo um prompt customizado, usa esse; senão, usa o padrão.
 */
export function getEffectiveSystemPrompt(): string {
  const custom = getAiConfig().systemPrompt.trim();
  return custom || AI_SYSTEM_PROMPT_DEFAULT;
}
