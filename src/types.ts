export type LiveEventKind = 'chat' | 'gift' | 'alert' | 'moderation' | 'scene' | 'system';

export type LiveEventSource =
  | 'ocr'
  | 'manual'
  | 'test'
  | 'system'
  | 'obs'
  | 'media'
  | 'chat_api'
  | 'n8n';

export interface LiveEvent {
  id: string;
  source: LiveEventSource;
  zoneName: string;
  text: string;
  kind: LiveEventKind;
  createdAt: string;
  time: string;
  metadata?: Record<string, unknown>;
  processedAt?: string;
}

export type AutopilotActionType =
  | 'speak'
  | 'chat_reply'
  | 'ack_gift'
  | 'moderate_message'
  | 'switch_scene'
  | 'show_overlay'
  | 'play_music'
  | 'play_video'
  | 'webhook'
  | 'stop_media'
  | 'set_topic'
  | 'suggest_topic'
  | 'remember'
  | 'log_event';

export type ToolCapability =
  | 'tts.speak'
  | 'chat.reply'
  | 'chat.private_reply'
  | 'gift.acknowledge'
  | 'moderation.message'
  | 'obs.switch_scene'
  | 'obs.show_overlay'
  | 'media.play_video'
  | 'media.play_music'
  | 'media.stop'
  | 'webhook.call'
  | 'topic.set'
  | 'topic.suggest'
  | 'memory.remember'
  | 'log.event';

export type ContentItemType =
  | 'topic'
  | 'script'
  | 'cta'
  | 'gift_redeem'
  | 'media_prompt'
  | 'scene_note'
  | 'moderation_policy'
  | 'faq'
  | 'blocked_topic';

export type ContentPriority = 'low' | 'normal' | 'high' | 'urgent';

export type ContentUsage = 'context' | 'prompt' | 'safety' | 'action';

export interface ContentItem {
  id: string;
  type: ContentItemType;
  title: string;
  body: string;
  tags: string[];
  priority: ContentPriority;
  enabled: boolean;
  usage: ContentUsage;
  linkedCapability?: ToolCapability;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  usedCount: number;
}

export interface UsedContentItem {
  id: string;
  type: ContentItemType;
  title: string;
  priority: ContentPriority;
  usage: ContentUsage;
  reason: string;
  snippet: string;
  linkedCapability?: ToolCapability;
}

export interface PersonaTool {
  id: string;
  label: string;
  capability: ToolCapability;
  enabled: boolean;
  requiresApproval: boolean;
  simulated: boolean;
}

export interface AutopilotAction {
  id: string;
  type: AutopilotActionType;
  label: string;
  capability?: ToolCapability;
  payload: Record<string, unknown>;
  simulated: boolean;
  requiresApproval?: boolean;
  status:
    | 'queued'
    | 'running'
    | 'done'
    | 'simulated'
    | 'n8n_dispatched'
    | 'error'
    | 'blocked'
    | 'approval_required';
  result?: string;
  source?: 'ai' | 'rule' | 'system';
  ruleId?: string;
  createdAt?: string;
}

export type ChatReplyQueueStatus =
  | 'queued'
  | 'approval_required'
  | 'sending'
  | 'sent'
  | 'blocked'
  | 'error';

export interface ChatReplyQueueItem {
  id: string;
  actionId: string;
  cycleId: string;
  sourceEvent: LiveEvent;
  action: AutopilotAction;
  status: ChatReplyQueueStatus;
  text: string;
  originalText: string;
  reason: string;
  confidence: number;
  cooldownMs: number;
  result?: string;
  governorBlockedReason?: string;
  approvedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaDecision {
  context_analysis?: string;
  sentiment?: string;
  speech: string;
  intent: string;
  confidence: number;
  reason: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  actions: AutopilotAction[];
}

export interface AutomationRuleTrigger {
  kind: LiveEventKind;
  contains?: string;
  giftName?: string;
  redeemable?: boolean;
  mappedAction?: ToolCapability;
}

export interface AutomationRule {
  id: string;
  label: string;
  enabled: boolean;
  trigger: AutomationRuleTrigger;
  actions: Array<
    Omit<AutopilotAction, 'id' | 'status' | 'simulated'> & {
      id?: string;
      simulated?: boolean;
    }
  >;
}

export type CycleStage =
  | 'capturado'
  | 'interpretado'
  | 'decidido'
  | 'executando'
  | 'concluido'
  | 'erro';

export interface CycleLog {
  id: string;
  time: string;
  label: string;
  status: 'done' | 'running' | 'error';
}

export interface AutopilotCycle {
  id: string;
  event: LiveEvent;
  events: LiveEvent[];
  stage: CycleStage;
  decision?: PersonaDecision;
  actions: AutopilotAction[];
  matchedRules: string[];
  contentUsed?: UsedContentItem[];
  logs: CycleLog[];
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export type CapturedMessage = LiveEvent;
