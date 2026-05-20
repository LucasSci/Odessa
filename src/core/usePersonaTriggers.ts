import { useEffect, useRef, useCallback, useMemo } from 'react';
import type { CapturedMessage } from '../types';

interface PersonaStudioTriggerConfig {
  enableGiftTrigger?: boolean;
  enableMessageTrigger?: boolean;
  enableReactionTrigger?: boolean;
  giftKeywords?: string[];
  messageKeywords?: string[];
  reactionKeywords?: string[];
}

interface UsePersonaTriggersReturn {
  triggerVideoTransition: (trigger: 'gift' | 'message' | 'reaction', data?: any) => void;
  recentEventCount: number;
}

/**
 * Hook that monitors captured messages and triggers persona video transitions
 * based on chat events (gifts, reactions, important messages)
 */
export function usePersonaTriggers(
  capturedText: CapturedMessage[],
  config: PersonaStudioTriggerConfig = {},
  onTrigger?: (type: 'gift' | 'message' | 'reaction', data?: any) => void,
): UsePersonaTriggersReturn {
  const {
    enableGiftTrigger = true,
    enableMessageTrigger = false,
    enableReactionTrigger = true,
    giftKeywords = ['gift', 'present', 'donate', 'doação', 'presente', 'enviar'],
    messageKeywords = [],
    reactionKeywords = ['wow', 'lol', 'nice', 'legal', 'top', 'demais'],
  } = config;

  const lastProcessedRef = useRef<string>('');
  const triggerCooldownRef = useRef<number>(0);
  const COOLDOWN_MS = 2000; // Prevent spam, min 2s between triggers

  const giftKeywordsLower = useMemo(() => giftKeywords.map((k) => k.toLowerCase()), [giftKeywords]);
  const reactionKeywordsLower = useMemo(
    () => reactionKeywords.map((k) => k.toLowerCase()),
    [reactionKeywords],
  );
  const messageKeywordsLower = useMemo(
    () => messageKeywords.map((k) => k.toLowerCase()),
    [messageKeywords],
  );

  // Detect gift mentions
  const detectGift = useCallback(
    (message: string): boolean => {
      if (!enableGiftTrigger) return false;
      const lower = message.toLowerCase();
      return giftKeywordsLower.some((keyword) => lower.includes(keyword));
    },
    [enableGiftTrigger, giftKeywordsLower],
  );

  // Detect reaction messages
  const detectReaction = useCallback(
    (message: string): boolean => {
      if (!enableReactionTrigger) return false;
      const lower = message.toLowerCase();
      return reactionKeywordsLower.some((keyword) => lower.includes(keyword));
    },
    [enableReactionTrigger, reactionKeywordsLower],
  );

  // Process messages and trigger transitions
  useEffect(() => {
    if (!capturedText.length) return;

    const now = Date.now();
    const canTrigger = now - triggerCooldownRef.current > COOLDOWN_MS;

    if (!canTrigger) return;

    // Get most recent message
    const latestMessage = capturedText[capturedText.length - 1];
    if (!latestMessage) return;

    const messageId = latestMessage.id;

    // Skip if already processed
    if (messageId === lastProcessedRef.current) return;

    lastProcessedRef.current = messageId;
    triggerCooldownRef.current = now;

    const messageText = latestMessage.text || '';

    // Prefer explicit classification
    const isExplicitGift =
      latestMessage.kind === 'gift' || Boolean(latestMessage.metadata?.giftName);

    if (enableGiftTrigger && (isExplicitGift || detectGift(messageText))) {
      onTrigger?.('gift', {
        giftName: latestMessage.metadata?.giftName || null,
        quantity: latestMessage.metadata?.quantity || null,
        user: latestMessage.metadata?.user || null,
        text: messageText,
        event: latestMessage,
      });
      return;
    }

    if (enableReactionTrigger && detectReaction(messageText)) {
      onTrigger?.('reaction', { text: messageText, event: latestMessage });
      return;
    }

    if (enableMessageTrigger) {
      const lowerText = messageText.toLowerCase();
      const hasMessageKeyword =
        messageKeywordsLower.length > 0 &&
        messageKeywordsLower.some((kw) => lowerText.includes(kw));

      if (hasMessageKeyword || messageText.length > 25) {
        onTrigger?.('message', { text: messageText, event: latestMessage });
      }
    }
  }, [
    capturedText,
    detectGift,
    detectReaction,
    enableMessageTrigger,
    messageKeywordsLower,
    onTrigger,
  ]);

  return {
    triggerVideoTransition: (trigger: 'gift' | 'message' | 'reaction', data?: any) => {
      onTrigger?.(trigger, data);
    },
    recentEventCount: capturedText.length,
  };
}
