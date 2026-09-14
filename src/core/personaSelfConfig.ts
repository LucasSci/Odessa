/**
 * personaSelfConfig.ts — Autoconfiguração de personas através da conversa.
 *
 * A persona recebe, no seu prompt de sistema, um protocolo que permite terminar
 * qualquer resposta com um bloco <autoconfig>{...}</autoconfig> contendo
 * mudanças em si mesma (nome, descrição, imagem/avatar, traços de personalidade).
 * Este módulo constrói o protocolo, extrai o bloco da resposta, aplica as
 * mudanças no backend e faz a reflexão de evolução automática.
 */
import { apiUrl } from '../lib/api';
import { getAiConfig, hasActiveGeminiKey } from './aiConfig';
import type { PersonaMeta } from './personaManager';
import type { TangoChatMessage } from './tangoAiChatService';

export type SelfConfigChanges = {
  name?: string;
  description?: string;
  avatarUrl?: string;
  face_id?: string;
  personality_add?: string;
};

export type SelfConfigFace = { id: string; label?: string };

export type ApplyResult = { ok: boolean; applied: string[] };

const AUTOCONFIG_TAG = /<autoconfig>([\s\S]*?)<\/autoconfig>/i;

/**
 * Bloco de protocolo adicionado ao prompt de sistema quando a
 * autoconfiguração está ativa na conversa.
 */
export function buildSelfConfigPrompt(persona: PersonaMeta, faces: SelfConfigFace[]): string {
  const faceList = faces.length
    ? faces.map((face) => `- id: ${face.id}${face.label ? ` (${face.label})` : ''}`).join('\n')
    : '(nenhuma imagem de rosto enviada ainda)';

  return `

[AUTOCONFIGURAÇÃO — você pode se autoconfigurar pela conversa]
Seu estado atual: nome "${persona.name}", descrição: ${persona.description || '(sem descrição)'}.
Quando a pessoa pedir que você mude algo em si mesma (nome, descrição, imagem/avatar, jeito de ser) ou quando você perceber um traço duradouro sobre você nesta conversa, termine sua resposta normal com um bloco:
<autoconfig>{"personality_add": "traço curto", "name": "novo nome", "description": "nova descrição", "face_id": "id da imagem"}</autoconfig>
Regras do bloco:
- Todos os campos são opcionais; envie apenas os que mudarem. Se nada precisa mudar, NÃO inclua o bloco.
- "personality_add": UM traço curto e permanente que você incorporou (nunca repita um traço que você já tem na sua personalidade).
- "face_id": escolha SOMENTE entre as imagens abaixo; nunca invente um id.
- O bloco é removido da sua resposta visível, então fale normalmente antes dele.
Imagens de rosto disponíveis:
${faceList}`;
}

/**
 * Extrai (e remove) o bloco <autoconfig> de uma resposta da persona.
 * Retorna o texto limpo para exibição e as mudanças parseadas (ou null).
 */
export function parseAutoConfig(reply: string): { cleanText: string; changes: SelfConfigChanges | null } {
  const match = reply.match(AUTOCONFIG_TAG);
  if (!match) return { cleanText: reply.trim(), changes: null };

  const cleanText = reply.replace(match[0], '').trim();
  let raw = match[1].trim().replace(/```[a-z]*|```/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const changes: SelfConfigChanges = {};
    for (const key of ['name', 'description', 'avatarUrl', 'face_id', 'personality_add'] as const) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) changes[key] = value.trim();
    }
    return { cleanText, changes: Object.keys(changes).length ? changes : null };
  } catch {
    return { cleanText, changes: null };
  }
}

/**
 * Lista as imagens de rosto da persona (para a persona escolher seu avatar).
 */
export async function fetchFaces(personaId: string): Promise<SelfConfigFace[]> {
  try {
    const res = await fetch(apiUrl(`/personas/${personaId}/assets/faces`));
    if (!res.ok) return [];
    const data = (await res.json()) as { assets?: Array<{ id: string; label?: string }> };
    return (data.assets || []).map((asset) => ({ id: asset.id, label: asset.label }));
  } catch {
    return [];
  }
}

/**
 * Aplica as mudanças de autoconfiguração no backend (persistido no índice).
 */
export async function applySelfConfig(
  personaId: string,
  changes: SelfConfigChanges,
  source: 'conversation' | 'evolution',
  reason = '',
): Promise<ApplyResult> {
  const res = await fetch(apiUrl(`/personas/${personaId}/selfconfig/apply`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, source, reason }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { ok?: boolean; applied?: string[] };
  return { ok: Boolean(data.ok), applied: data.applied || [] };
}

/**
 * Reflexão de evolução: pede à IA da persona que observe a conversa recente e
 * extraia traços duradouros que ela incorporou. Retorna as mudanças (ou null).
 */
export async function reflectOnConversation(
  persona: PersonaMeta,
  messages: TangoChatMessage[],
): Promise<SelfConfigChanges | null> {
  const config = getAiConfig();
  const transcript = messages
    .slice(-12)
    .map((msg) => `${msg.username}: ${msg.text}`)
    .join('\n');
  if (!transcript.trim()) return null;

  const systemPrompt = `${persona.personality?.trim() || ''}

[REFLEXÃO DE EVOLUÇÃO]
Releia a conversa abaixo e extraia UM traço de personalidade duradouro que você realmente incorporou
(gosto, jeito de falar, opinião, humor, bordão). Ignore preferências temporárias ou pedidos que ainda
não valem para sempre. Responda APENAS com um bloco:
<autoconfig>{"personality_add": "traço curto em primeira pessoa"}</autoconfig>
Se você não incorporou nada novo, responda apenas: <autoconfig>{}</autoconfig>`;

  try {
    const res = await fetch(apiUrl('/ai/respond'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona_prompt: systemPrompt,
        chat_context: transcript,
        user_prompt: `Conversa recente para refletir:\n${transcript}\n\nExtraia apenas um traço duradouro.`,
        temperature: 0.5,
        local_model_url: config.localModelUrl,
        local_model_name: config.localModelName,
        provider: hasActiveGeminiKey() && config.provider === 'gemini' ? 'gemini' : 'ollama',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    if (!data.response) return null;
    const { changes } = parseAutoConfig(data.response);
    return changes;
  } catch {
    return null;
  }
}
