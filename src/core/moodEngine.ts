import { LiveEvent } from '../types';

export type MoodState = 'cozy' | 'hype' | 'chaotic' | 'focused';

export interface MoodProfile {
  energy: number;
  warmth: number;
  temperature: number;
  state: MoodState;
}

export class MoodEngine {
  private baseEnergy: number;
  private baseWarmth: number;
  private currentHype: number = 0; // 0 to 100
  private lastUpdate: number = Date.now();

  constructor(baseEnergy = 60, baseWarmth = 80) {
    this.baseEnergy = baseEnergy;
    this.baseWarmth = baseWarmth;
  }

  public processEvents(events: LiveEvent[]) {
    const now = Date.now();
    const timeDiffMs = now - this.lastUpdate;
    this.lastUpdate = now;

    // Decay hype over time (e.g. lose 5 points per minute of silence)
    const decay = (timeDiffMs / 60000) * 5;
    this.currentHype = Math.max(0, this.currentHype - decay);

    // Increase hype based on events
    for (const event of events) {
      if (event.kind === 'gift') {
        const isRedeem = event.metadata?.redeemable ? true : false;
        this.currentHype += isRedeem ? 15 : 25;
      } else if (event.kind === 'alert') {
        this.currentHype += 10;
      } else if (event.kind === 'chat') {
        this.currentHype += 1; // Small bump for fast chat
      } else if (event.kind === 'moderation') {
        this.currentHype -= 10; // Kills hype
      }
    }

    this.currentHype = Math.min(100, Math.max(0, this.currentHype));
  }

  public getCurrentMood(): MoodProfile {
    let state: MoodState = 'cozy';
    let energy = this.baseEnergy;
    let warmth = this.baseWarmth;
    let temperature = 0.6;

    if (this.currentHype > 75) {
      state = 'hype';
      energy = Math.min(100, this.baseEnergy + 30);
      temperature = 0.8; // More creative/wild
    } else if (this.currentHype > 40) {
      state = 'focused';
      energy = Math.min(100, this.baseEnergy + 10);
      temperature = 0.65;
    } else if (this.currentHype < 10) {
      state = 'cozy';
      warmth = Math.min(100, this.baseWarmth + 10);
      temperature = 0.5; // More predictable/warm
    }

    return { state, energy, warmth, temperature };
  }

  public getMoodPromptInjection(): string {
    const mood = this.getCurrentMood();
    let instruction = '';
    switch (mood.state) {
      case 'hype':
        instruction =
          '[HUMOR ATUAL: HYPE! A live esta bombando, chat ativo e presentes. Responda com muita energia, empolgacao e fale mais rapido!]';
        break;
      case 'cozy':
        instruction =
          '[HUMOR ATUAL: COZY (Aconchegante). A live esta calma, foque em acolhimento, conversas profundas e respostas carinhosas.]';
        break;
      case 'focused':
        instruction =
          '[HUMOR ATUAL: FOCADA. Voce esta jogando ou focada no conteudo. Responda pontualmente, sem perder o ritmo do que esta fazendo.]';
        break;
      case 'chaotic':
        instruction =
          '[HUMOR ATUAL: CAOTICA. O chat esta enlouquecido. Responda de forma divertida e imprevisivel.]';
        break;
    }
    return `\n\n${instruction}\n(Sua energia: ${Math.round(mood.energy)}/100 | Seu acolhimento: ${Math.round(mood.warmth)}/100)`;
  }
}

// Global singleton for the live session
export const globalMoodEngine = new MoodEngine();
