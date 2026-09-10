import { Film, Zap, Video, Clapperboard } from 'lucide-react';

export type VideoCategory = {
  key: string;
  prefix: string;
  label: string;
  description: string;
  color: string;
  icon: typeof Film;
  recommendedCount: number;
  promptTemplate: string;
};

export const VIDEO_ROTEIRO: VideoCategory[] = [
  {
    key: 'idle',
    prefix: 'FLUXO',
    label: 'IDLE / Fluxo',
    description: 'Vídeos em loop que tocam continuamente como fundo. A persona fica "viva" mesmo sem interações.',
    color: 'sky',
    icon: Film,
    recommendedCount: 5,
    promptTemplate:
      'Vídeo IDLE em loop da persona [NOME], [DESCRIÇÃO_DA_AÇÃO]. ' +
      'Movimento sutil e contínuo, sem início ou fim abrupto. ' +
      'Expressão: [EXPRESSÃO]. Olhar para a câmera de forma natural.',
  },
  {
    key: 'gatilho',
    prefix: 'GATILHO',
    label: 'Gatilhos / Reações',
    description: 'Vídeos acionados por presentes ou palavras-chave do chat. A persona reage a interações específicas.',
    color: 'amber',
    icon: Zap,
    recommendedCount: 10,
    promptTemplate:
      'Vídeo de REAÇÃO da persona [NOME] ao receber [TIPO_DE_GATILHO]. ' +
      'Ação: [AÇÃO_ESPECÍFICA]. Duração curta (3-8s). ' +
      'Expressão: [EXPRESSÃO]. Retorna ao idle ao final.',
  },
  {
    key: 'transicao',
    prefix: 'TRANSICAO',
    label: 'Transições',
    description: 'Vídeos curtos que conectam um estado a outro suavemente (ex: ajustar roupa, mudar postura).',
    color: 'violet',
    icon: Video,
    recommendedCount: 4,
    promptTemplate:
      'Vídeo de TRANSIÇÃO da persona [NOME]. ' +
      'Ação: [AÇÃO_DE_TRANSIÇÃO]. Duração muito curta (2-4s). ' +
      'Movimento natural que liga um idle a outro.',
  },
  {
    key: 'especial',
    prefix: 'ESPECIAL',
    label: 'Especiais',
    description: 'Ações especiais e únicas: alongamentos, mudanças de ângulo, momentos marcantes da live.',
    color: 'rose',
    icon: Clapperboard,
    recommendedCount: 3,
    promptTemplate:
      'Vídeo ESPECIAL da persona [NOME]. ' +
      'Ação: [AÇÃO_ESPECIAL]. Momento marcante e único. ' +
      'Duração média (5-10s). Expressão: [EXPRESSÃO].',
  },
];
