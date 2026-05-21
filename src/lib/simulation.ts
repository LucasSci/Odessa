// ── Simulated live stream event generator ──────────────────────

export interface SimulatedEvent {
  username: string;
  text: string;
  type:
    | 'chat'
    | 'gift'
    | 'redeem_scene'
    | 'redeem_music'
    | 'quiet_moment'
    | 'follow'
    | 'alert'
    | 'moderation';
  displayText: string;
}

const USERS = [
  'Lucas_gg',
  'AnaStarlight',
  'PedroGamer22',
  'MariLive',
  'GuiNinja',
  'SofiaRose',
  'ThiagoFPS',
  'JuliaStream',
  'RafaelMod',
  'CamilaBR',
  'DarkKnight99',
  'LunaGaming',
  'MateusBR',
  'BeatrizLive',
  'FelipeDev',
  'Kaio_zera',
  'NandaBR',
  'ViktorPlay',
  'IsaGamer',
  'BrunoTech',
];

const CHAT_MESSAGES = [
  'Oi Juju! Acabei de chegar na live, como ta?',
  'kkkk muito bom isso, adorei',
  'Que jogo é esse? Parece muito bom',
  'Manda um salve pro chat!',
  'Primeira vez aqui, to gostando muito da vibe',
  'Juju, já comeu hoje? Cuida da saúde!',
  'Esse mapa é muito difícil, cuidado',
  'Boa noite galera! Cheguei agora',
  'Juju, recomenda algum jogo pra jogar solo?',
  'To assistindo desde o começo, live ta incrível!',
  'Essa skin é nova? Ficou demais!',
  'Quando vai ter live de terror? Quero ver',
  'Juju, canta uma música pra gente!',
  'Juju vs o boss final, quem ganha? hahaha',
  'Posso ser mod? Sou fiel demais',
  'Quanto tempo de live já?',
  'Ta jogando bem demais hoje!',
  'Caramba, que jogada incrível! GG',
  'F no chat',
  'Alguém viu o clip de ontem? Muito bom',
  'A live de ontem foi épica, voltei por causa disso',
  'Qual teu setup? To querendo montar um PC',
  'Juju, faz uma tier list de jogos!',
  'Chat, alguém mais tá com lag?',
  'Tu joga Valorant? Bora duo qualquer dia',
  'Stream tá com qualidade boa hoje, parabéns',
  'Juju, qual tua comida favorita?',
  'Esse jogo é pago ou free?',
  'Meu primo que me indicou, ele manda salve!',
  'Já se inscreveu? To inscrito faz tempo',
  'Boa! Mandou muito bem nessa partida',
  'Tá transmitindo há quanto tempo hoje?',
  'Adorei a overlay nova, ficou linda',
  'Quem mais tá viciado nesse jogo?',
  'Juju, fala algo em inglês!',
  'Quantos inscritos o canal tem?',
  'Essa live tá melhor que Netflix hahaha',
  'Como você começou a fazer live?',
  'Alguém sabe se vai ter sorteio hoje?',
  'Chat tá animado hoje, gosto assim',
];

const GIFT_TEMPLATES = [
  { gift: 'Rosa', amounts: [1, 3, 5, 10, 20] },
  { gift: 'Coração', amounts: [1, 5, 10, 25] },
  { gift: 'Estrela', amounts: [1, 3, 5] },
  { gift: 'Diamante', amounts: [1, 2] },
  { gift: 'Foguete', amounts: [1, 2, 3] },
  { gift: 'Coroa', amounts: [1] },
  { gift: 'Moeda', amounts: [10, 50, 100, 500] },
  { gift: 'Urso', amounts: [1, 2, 3] },
  { gift: 'Bolo', amounts: [1, 5] },
];

const FOLLOW_PHRASES = [
  'começou a seguir',
  'entrou na live agora',
  'é novo seguidor!',
  'acabou de chegar',
];

const SPAM_MESSAGES = [
  'COMPRE SEGUIDORES BARATO www.fake.com www.fake.com www.fake.com',
  'FREE COINS CLIQUE AQUI >>> www.spam.com <<< GRATIS',
  'Sigam meu canal @fakechannel @fakechannel @fakechannel @fakechannel',
  'GANHE DINHEIRO FACIL www.golpe.com LINK NA BIO LINK NA BIO',
];

const SCENE_REDEEMS = [
  'Gameplay Focus',
  'Cena Just Chatting',
  'Tela de reacts',
  'Camera principal',
];

const MUSIC_REDEEMS = [
  'synthwave neon',
  'lofi para boss fight',
  'trilha epica curta',
  'musica escolhida pelo chat',
];

const QUIET_MOMENTS = [
  'Assunto atual acabou / chat quieto. Puxar novo topico.',
  'Chat ficou parado por alguns minutos. Sugerir pergunta para reativar a live.',
  'Momento sem mensagens novas. Iniciar pauta curta com o chat.',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const SCENARIO_EVENTS: SimulatedEvent[] = [
  {
    username: 'AnaStarlight',
    text: '@AnaStarlight: Oi Juju, como esta a live?',
    type: 'chat',
    displayText: 'Oi Juju, como esta a live?',
  },
  {
    username: 'AnaStarlight',
    text: 'AnaStarlight enviou Rosa x5',
    type: 'gift',
    displayText: 'enviou Rosa x5',
  },
  {
    username: 'Lucas_gg',
    text: 'Lucas_gg resgatou Trocar Cena: Gameplay Focus',
    type: 'redeem_scene',
    displayText: 'resgatou Trocar Cena: Gameplay Focus',
  },
  {
    username: 'MariLive',
    text: 'MariLive resgatou Escolher musica: synthwave neon',
    type: 'redeem_music',
    displayText: 'resgatou Escolher musica: synthwave neon',
  },
  {
    username: 'sistema',
    text: 'Assunto atual acabou / chat quieto. Puxar novo topico.',
    type: 'quiet_moment',
    displayText: 'chat quieto: puxar novo topico',
  },
  {
    username: 'xXSpamXx',
    text: 'xXSpamXx: COMPRE SEGUIDORES BARATO www.fake.com spam repetido',
    type: 'moderation',
    displayText: 'spam repetido detectado',
  },
];

export function createScenarioQueue(): SimulatedEvent[] {
  return SCENARIO_EVENTS.map((event) => ({ ...event }));
}

export function generateSimEvent(): SimulatedEvent {
  const rand = Math.random();

  if (rand < 0.34) {
    const user = pick(USERS);
    const msg = pick(CHAT_MESSAGES);
    return {
      username: user,
      text: `@${user}: ${msg}`,
      type: 'chat',
      displayText: msg,
    };
  }

  if (rand < 0.54) {
    const user = pick(USERS);
    const template = pick(GIFT_TEMPLATES);
    const amount = pick(template.amounts);
    const text = `${user} enviou ${template.gift} x${amount}`;
    return {
      username: user,
      text,
      type: 'gift',
      displayText: `enviou ${template.gift} x${amount}`,
    };
  }

  if (rand < 0.66) {
    const user = pick(USERS);
    const scene = pick(SCENE_REDEEMS);
    return {
      username: user,
      text: `${user} resgatou Trocar Cena: ${scene}`,
      type: 'redeem_scene',
      displayText: `resgatou Trocar Cena: ${scene}`,
    };
  }

  if (rand < 0.78) {
    const user = pick(USERS);
    const track = pick(MUSIC_REDEEMS);
    return {
      username: user,
      text: `${user} resgatou Escolher musica: ${track}`,
      type: 'redeem_music',
      displayText: `resgatou Escolher musica: ${track}`,
    };
  }

  if (rand < 0.88) {
    const user = pick(USERS);
    const phrase = pick(FOLLOW_PHRASES);
    return {
      username: user,
      text: `Novo seguidor: ${user} ${phrase}`,
      type: 'follow',
      displayText: phrase,
    };
  }

  if (rand < 0.94) {
    const text = pick(QUIET_MOMENTS);
    return {
      username: 'sistema',
      text,
      type: 'quiet_moment',
      displayText: text,
    };
  }

  const spamUser = `xX${pick(USERS).slice(0, 5)}Xx`;
  const spam = pick(SPAM_MESSAGES);
  return {
    username: spamUser,
    text: `${spamUser}: ${spam}`,
    type: 'moderation',
    displayText: spam,
  };
}

export function generateEventBatch(count: number): SimulatedEvent[] {
  return Array.from({ length: count }, () => generateSimEvent());
}

export const SIM_SPEEDS = {
  lento: { label: 'Lento', minMs: 5000, maxMs: 8000, eventsPerTick: [1, 1, 1, 2] as number[] },
  normal: { label: 'Normal', minMs: 3000, maxMs: 5500, eventsPerTick: [1, 1, 2, 2, 3] as number[] },
  rapido: {
    label: 'Rapido',
    minMs: 1800,
    maxMs: 3500,
    eventsPerTick: [1, 2, 2, 3, 3, 4] as number[],
  },
  caos: { label: 'Caos', minMs: 900, maxMs: 2200, eventsPerTick: [2, 3, 3, 4, 5, 6] as number[] },
} as const;

export type SimSpeed = keyof typeof SIM_SPEEDS;

export const EVENT_TYPE_ICONS: Record<string, string> = {
  chat: '💬',
  gift: '🎁',
  follow: '👋',
  alert: '🔔',
  moderation: '🛡️',
};

Object.assign(EVENT_TYPE_ICONS, {
  redeem_scene: 'OBS',
  redeem_music: 'MUSIC',
  quiet_moment: 'SYS',
});

export const EVENT_TYPE_COLORS: Record<string, string> = {
  chat: 'text-slate-200',
  gift: 'text-amber-300',
  follow: 'text-emerald-300',
  alert: 'text-sky-300',
  moderation: 'text-rose-300',
};

Object.assign(EVENT_TYPE_COLORS, {
  redeem_scene: 'text-sky-300',
  redeem_music: 'text-fuchsia-300',
  quiet_moment: 'text-cyan-300',
});
