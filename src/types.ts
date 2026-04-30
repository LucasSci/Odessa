export type LiveEventKind = 'chat' | 'gift' | 'alert' | 'moderation' | 'scene' | 'system';

export type LiveEventSource = 'ocr' | 'manual' | 'test' | 'system';

export interface LiveEvent {
  id: string;
  source: LiveEventSource;
  zoneName: string;
  text: string;
  kind: LiveEventKind;
  createdAt: string;
  time: string;
}

export type AutopilotActionType =
  | 'speak'
  | 'chat_reply'
  | 'ack_gift'
  | 'moderate_message'
  | 'switch_scene'
  | 'show_overlay'
  | 'log_event';

export interface AutopilotAction {
  id: string;
  type: AutopilotActionType;
  label: string;
  payload: Record<string, string | number | boolean | null>;
  simulated: boolean;
  status: 'queued' | 'running' | 'done' | 'error';
  result?: string;
}

export interface PersonaDecision {
  speech: string;
  intent: string;
  confidence: number;
  reason: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  actions: AutopilotAction[];
}

export type CapturedMessage = LiveEvent;
