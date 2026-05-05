import { useEffect, useRef, useCallback } from 'react';
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
  triggerVideoTransition: (trigger: 'gift' | 'message' | 'reaction') => void;
  recentEventCount: number;
}

/**
 * Hook that monitors captured messages and triggers persona video transitions
 * based on chat events (gifts, reactions, important messages)
 */
export function usePersonaTriggers(
  capturedText: CapturedMessage[],
  config: PersonaStudioTriggerConfig = {},
  onTrigger?: (type: 'gift' | 'message' | 'reaction') => void,
): UsePersonaTriggersReturn {
  const {
    enableGiftTrigger = true,
    enableMessageTrigger = true,
    enableReactionTrigger = true,
    giftKeywords = ['gift', 'present', 'donate', 'doação', 'presente', 'enviar'],
    messageKeywords = [],
    reactionKeywords = ['wow', 'lol', 'nice', 'legal', 'top', 'demais'],
  } = config;

  const lastProcessedRef = useRef<string>('');
  const triggerCooldownRef = useRef<number>(0);
  const COOLDOWN_MS = 2000; // Prevent spam, min 2s between triggers

  // Detect gift mentions
  const detectGift = useCallback(
    (message: string): boolean => {
      if (!enableGiftTrigger) return false;
      const lower = message.toLowerCase();
      return giftKeywords.some((keyword) => lower.includes(keyword));
    },
    [enableGiftTrigger, giftKeywords],
  );

  // Detect reaction messages
  const detectReaction = useCallback(
    (message: string): boolean => {
      if (!enableReactionTrigger) return false;
      const lower = message.toLowerCase();
      return reactionKeywords.some((keyword) => lower.includes(keyword));
    },
    [enableReactionTrigger, reactionKeywords],
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

    const messageId = `${latestMessage.timestamp}-${latestMessage.text}`;

    // Skip if already processed
    if (messageId === lastProcessedRef.current) return;

    lastProcessedRef.current = messageId;
    triggerCooldownRef.current = now;

    const messageText = latestMessage.text || '';

    // Detect and trigger based on message content
    if (detectGift(messageText)) {
      onTrigger?.('gift');
    } else if (detectReaction(messageText)) {
      onTrigger?.('reaction');
    } else if (enableMessageTrigger) {
      const lowerText = messageText.toLowerCase();
      const hasMessageKeyword = messageKeywords.length > 0 && messageKeywords.some(kw => lowerText.includes(kw.toLowerCase()));
      
      if (hasMessageKeyword || messageText.length > 25) {
        onTrigger?.('message');
      }
    }
  }, [capturedText, detectGift, detectReaction, enableMessageTrigger, onTrigger]);

  return {
    triggerVideoTransition: (trigger: 'gift' | 'message' | 'reaction') => {
      onTrigger?.(trigger);
    },
    recentEventCount: capturedText.length,
  };
}
