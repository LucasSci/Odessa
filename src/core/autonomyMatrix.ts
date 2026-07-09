import type { PersonaTool, ToolCapability } from '../types';
import type { AiAutonomyLevel } from './aiConfig';

export type AutonomyToolStatus = 'real' | 'simulated' | 'approval' | 'blocked';

export interface AutonomyReadiness {
  chatRealRequested?: boolean;
  autoChatEnabled?: boolean;
  visualTargetReady?: boolean;
  localAgentReady?: boolean;
}

export interface AutonomyToolPolicy {
  capability: ToolCapability;
  status: AutonomyToolStatus;
  enabled: boolean;
  simulated: boolean;
  requiresApproval: boolean;
  reason: string;
}

export const AUTONOMY_MATRIX_CAPABILITIES: ToolCapability[] = [
  'tts.speak',
  'chat.reply',
  'media.play_video',
  'obs.switch_scene',
  'webhook.call',
  'moderation.message',
  'memory.remember',
];

const SAFE_CAPABILITIES = new Set<ToolCapability>(['log.event', 'memory.remember']);
const ASSISTED_REAL_CAPABILITIES = new Set<ToolCapability>(['tts.speak', 'media.play_video']);

function disabledPolicy(tool: PersonaTool): AutonomyToolPolicy {
  return {
    capability: tool.capability,
    status: 'blocked',
    enabled: false,
    simulated: tool.simulated,
    requiresApproval: tool.requiresApproval,
    reason: 'Ferramenta desativada no registro.',
  };
}

function chatPolicy(
  tool: PersonaTool,
  level: AiAutonomyLevel,
  readiness: AutonomyReadiness,
): AutonomyToolPolicy {
  if (level === 'manual') {
    return {
      capability: tool.capability,
      status: 'approval',
      enabled: true,
      simulated: true,
      requiresApproval: true,
      reason: 'Manual: resposta publica sempre espera aprovacao.',
    };
  }

  if (level === 'assistido') {
    return {
      capability: tool.capability,
      status: 'simulated',
      enabled: true,
      simulated: true,
      requiresApproval: false,
      reason: 'Assistido: chat real fica bloqueado; somente dry-run/simulacao.',
    };
  }

  if (!readiness.autoChatEnabled) {
    return {
      capability: tool.capability,
      status: 'blocked',
      enabled: false,
      simulated: false,
      requiresApproval: false,
      reason: 'Autonomo: responder chat automaticamente esta desligado.',
    };
  }

  if (!readiness.chatRealRequested) {
    return {
      capability: tool.capability,
      status: 'simulated',
      enabled: true,
      simulated: true,
      requiresApproval: false,
      reason: 'Autonomo: modo do chat esta em dry-run.',
    };
  }

  if (!readiness.visualTargetReady) {
    return {
      capability: tool.capability,
      status: 'blocked',
      enabled: false,
      simulated: false,
      requiresApproval: false,
      reason: 'Autonomo: alvo visual do chat ainda nao foi validado.',
    };
  }

  if (!readiness.localAgentReady) {
    return {
      capability: tool.capability,
      status: 'blocked',
      enabled: false,
      simulated: false,
      requiresApproval: false,
      reason: 'Autonomo: agente local nao esta pronto para clicar/digitar.',
    };
  }

  return {
    capability: tool.capability,
    status: 'real',
    enabled: true,
    simulated: false,
    requiresApproval: false,
    reason: 'Autonomo: governador ainda valida evento, cooldown e confianca antes do envio real.',
  };
}

export function autonomyPolicyForTool(
  tool: PersonaTool,
  level: AiAutonomyLevel,
  readiness: AutonomyReadiness = {},
): AutonomyToolPolicy {
  if (!tool.enabled) return disabledPolicy(tool);

  if (tool.capability === 'chat.reply') return chatPolicy(tool, level, readiness);

  if (level === 'manual') {
    const safe = SAFE_CAPABILITIES.has(tool.capability);
    return {
      capability: tool.capability,
      status: safe ? (tool.simulated ? 'simulated' : 'real') : 'approval',
      enabled: true,
      simulated: safe ? tool.simulated : tool.simulated,
      requiresApproval: !safe,
      reason: safe
        ? 'Manual: memoria/log seguro nao pede aprovacao.'
        : 'Manual: toda acao publica ou externa espera aprovacao.',
    };
  }

  if (level === 'assistido') {
    if (ASSISTED_REAL_CAPABILITIES.has(tool.capability)) {
      return {
        capability: tool.capability,
        status: 'real',
        enabled: true,
        simulated: false,
        requiresApproval: false,
        reason: 'Assistido: voz/video/idle podem executar sozinhos.',
      };
    }
    if (tool.capability === 'memory.remember' || tool.capability === 'log.event') {
      return {
        capability: tool.capability,
        status: tool.simulated ? 'simulated' : 'real',
        enabled: true,
        simulated: tool.simulated,
        requiresApproval: false,
        reason: 'Assistido: memoria/log seguro liberado.',
      };
    }
    return {
      capability: tool.capability,
      status: 'approval',
      enabled: true,
      simulated: tool.simulated,
      requiresApproval: true,
      reason: 'Assistido: acao sensivel exige aprovacao.',
    };
  }

  if (tool.capability === 'moderation.message') {
    return {
      capability: tool.capability,
      status: 'approval',
      enabled: true,
      simulated: true,
      requiresApproval: true,
      reason: 'Autonomo: moderacao sensivel ainda exige aprovacao.',
    };
  }

  return {
    capability: tool.capability,
    status: tool.simulated ? 'simulated' : 'real',
    enabled: true,
    simulated: tool.simulated,
    requiresApproval: false,
    reason: tool.simulated
      ? 'Autonomo: ferramenta permanece simulada pelo registro.'
      : 'Autonomo: ferramenta pode executar sem aprovacao.',
  };
}

export function buildAutonomyToolPolicies(
  tools: PersonaTool[],
  level: AiAutonomyLevel,
  readiness: AutonomyReadiness = {},
): AutonomyToolPolicy[] {
  return tools.map((tool) => autonomyPolicyForTool(tool, level, readiness));
}

export function applyAutonomyToTools(
  tools: PersonaTool[],
  level: AiAutonomyLevel,
  readiness: AutonomyReadiness = {},
): PersonaTool[] {
  const policiesByCapability = new Map(
    buildAutonomyToolPolicies(tools, level, readiness).map((policy) => [policy.capability, policy]),
  );
  return tools.map((tool) => {
    const policy = policiesByCapability.get(tool.capability);
    if (!policy) return tool;
    return {
      ...tool,
      enabled: policy.enabled,
      simulated: policy.simulated,
      requiresApproval: policy.requiresApproval,
    };
  });
}
