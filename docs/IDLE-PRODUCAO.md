# Produção da IDLE reativa — Odessa (v3, por persona)

Guia para produzir os vídeos de IDLE de **qualquer persona** no mesmo formato,
de forma que a live reaja às interações e **não pareça um vídeo repetido**.

- Assets por persona (fazer primeiro): [IDLE-ASSETS-PROMPTS.md](IDLE-ASSETS-PROMPTS.md)
- Verificador de âncora: `scripts/check_idle_anchor.py`

Os vídeos antigos em `assets/videos/` servem só para entender o **formato**;
rosto, roupa e cenário de cada persona são próprios.

---

## 0. O que aprendemos com os vídeos atuais

Análise dos 37 vídeos (todos 720×1264, 24 fps, 10 s).

| Achado | Consequência para o formato novo |
|---|---|
| Todos começam no mesmo frame | ✅ Ideia certa: existe uma **pose-base** (âncora) |
| Nenhum termina nesse frame (~26–30 dB) | Os novos são gerados com **primeiro E último frame = âncora** |
| 11 arquivos são duplicatas idênticas (`01`=`11`, `09`=`10`=`31`…) | Na prática ~22 clipes únicos → repetição perceptível |
| Plano aberto com mãos no mouse/teclado | Mãos são a maior fonte de erro e de "pulo" → no busto, **mãos ficam fora do quadro** em repouso |
| Luz do teclado muda num clipe (`33`) | Objetos com luz própria ficam fora do quadro ou desfocados |
| Todos têm 10 s | Micro-idles de 4–5 s → muito mais combinações |

---

## 1. Arquitetura

### 1.1 Quatro âncoras = quatro estados

```
                 A2 RELAXADA  (chat parado)
                  ▲        │
                  │        ▼
 A1 LENDO CHAT ◄──►  A0 CÂMERA  ◄──►  A3 PERTO  (conversando / respondendo)
 (chat agitado)      (padrão)
        ▲                 ▲
        └─ reações ───────┴─ reações voltam para a âncora de onde saíram
```

- Cada âncora tem um **pool** de micro-idles que começam e terminam nela →
  dentro do estado, qualquer ordem é válida.
- **Transições sempre passam por A0** (A1↔A0, A2↔A0, A3↔A0): 6 clipes em vez de 12.
- O estado muda pelo que acontece na live, não por tempo fixo.

### 1.2 Três camadas de variação

1. **Estado** (âncora) — muda em minutos, conforme o clima do chat.
2. **Energia** — pesos para clipes calmos vs. animados; sobe com presentes e
   mensagens e decai sozinha em ~2 min.
3. **Beats raros** — especiais com cooldown longo (beber algo, alongar, pet
   aparecendo). São o que o espectador "percebe" e quebram a sensação de loop.

A **personalidade** entra por cima de tudo: a mesma lista de clipes é gerada com
o `{MOTION}` de cada persona (Barbara mais expansiva, Viktoria mais contida).

### 1.3 Sinais → estado / reação

| Sinal da live | Resultado |
|---|---|
| Sem mensagem há > 90 s | vai para **A2**, energia baixa |
| Chat normal (1–5 msg/min) | fica em **A0**, com espiadas ao chat |
| Chat agitado (> 5 msg/min) | vai para **A1** |
| IA vai responder alguém / menção ao nome | vai para **A3** e toca clipe "falando" |
| Novo seguidor | *aceno* |
| Presente pequeno | *beijo* / *coração* / *piscadinha* |
| Presente médio | *obrigada* / *aplauso* |
| Presente grande / meta | *surpresa* / *dancinha* (energia no máximo) |
| Elogio | *tímida* |
| Pergunta | *pensativa* |
| Provocação | *revira olhos* / *não-não* |
| Comando `!pet` (opcional) | beat *pet aparece* |
| Fim de live | *tchau* |

Reações existem a partir de A0 e de A1: se ela está lendo o chat quando chega
o presente, reage dali mesmo.

### 1.4 Regras de reprodução (motor)

1. Sorteio ponderado no pool da âncora atual, com peso por energia.
2. Anti-repetição: nada dos últimos 4 clipes; nunca a mesma família em sequência.
3. Beats raros com cooldown mínimo de 3 min.
4. **Ping-pong:** clipes 🔁 podem tocar para frente e invertidos — voltam à
   âncora perfeitamente e dobram o pool.
5. Crossfade de 120–180 ms.
6. Reação espera o fim do micro-idle atual (≤ 5 s); presente grande corta na hora.

---

## 2. Geração dos vídeos

| Parâmetro | Valor |
|---|---|
| Modo | image-to-video com **first frame + last frame** |
| Frames | âncora da persona (A0–A3); transições: A0→Ax ou Ax→A0 |
| Referências extras | personagem salvo, ou `ref_rosto_frente` + `ref_rosto_34_*` |
| Duração | micro-idle 4–5 s · transição 2–3 s · reação 5–8 s · beat 8–10 s |
| Saída | 9:16, 24 fps, **sem áudio** (reduzir para 720×1264 se vier maior) |
| Modelos com first+last | Kling (start/end frame), Veo 3.1, Seedance, Wan FLF2V |

### 2.1 Modelo de prompt

Troque os `{campos}` pela ficha da persona.

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: {IDENTITY}, wearing {WARDROBE}. Live streaming at night in {ROOM}, background softly out of focus. {MIC} stays in the lower right corner. {LIGHT}, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: <ação do clipe>

STYLE: {MOTION}

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — <âncora>. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

**Negativo padrão:**

```text
camera movement, zoom, pan, dolly, cut, scene change, morphing face, different person, changing hairstyle, changing outfit, missing jewelry, extra fingers, deformed hands, hands lingering in frame, extra people, new objects, flickering light, exposure change, text, subtitles, watermark, logo, exaggerated cartoon expressions, fast motion
```

**Texto das âncoras** (campo `<âncora>`):

| Âncora | Texto |
|---|---|
| A0 | `facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame` |
| A1 | `head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame` |
| A2 | `leaning back slightly in the chair, calm half-smile at the lens, hands out of frame` |
| A3 | `leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile` |

### 2.2 Nomes dos arquivos

`NN_CATEGORIA_ANCORA_acao.mp4`, em `assets/videos/<persona>/` —
ex.: `40_FLUXO_A0_respira_piscar.mp4`, `52_TRANSICAO_A0-A1_vira_chat.mp4`.
Mantém os prefixos que o app reconhece (`src/core/videoRoteiro.ts`).

---

## 3. Lista de clipes

⭐ = **lote 1** · 🔁 = pode tocar em ping-pong.
Esquerda/direita são **do quadro**. O chat fica à direita do quadro.

### 3.1 FLUXO · A0 câmera (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐🔁 `40_FLUXO_A0_respira_piscar` | `Almost still: slow calm breathing visible in the shoulders, two natural blinks, the smile softens and returns.` |
| ⭐🔁 `41_FLUXO_A0_inclina_cabeca` | `She slowly tilts her head a little to one side with a warm look, holds for a moment, and returns upright.` |
| ⭐ `42_FLUXO_A0_cabelo` | `One hand rises into frame and tucks a strand of hair behind her ear, then lowers out of frame.` |
| ⭐🔁 `43_FLUXO_A0_olha_baixo` | `Her eyes drop briefly toward the desk below as if checking something, then rise back to the lens with a small smile.` |
| ⭐🔁 `44_FLUXO_A0_sorriso_cresce` | `Her closed-mouth smile slowly widens into a soft smile showing a hint of teeth, then relaxes back.` |
| ⭐ `45_FLUXO_A0_espia_chat` | `She glances quickly toward the monitor on the right side of the frame, reads for a second, and looks back at the lens.` |
| `46_FLUXO_A0_ajusta_postura` | `She straightens her posture, rolling her shoulders slightly back, and settles comfortably.` |
| 🔁 `47_FLUXO_A0_suspiro` | `A calm, content sigh: shoulders rise and fall softly, eyes close for a second and reopen toward the lens.` |
| `48_FLUXO_A0_acessorio` | `One hand rises into frame and lightly touches her necklace or earring, then lowers out of frame.` |
| 🔁 `49_FLUXO_A0_balanca_musica` | `She sways very gently side to side as if enjoying soft background music, a relaxed small smile.` |
| 🔁 `50_FLUXO_A0_olha_longe` | `Her gaze drifts dreamily off to the left for a few seconds, then returns to the lens.` |
| `51_FLUXO_A0_labios` | `She presses her lips together softly and relaxes them, a subtle playful look into the lens.` |

### 3.2 TRANSIÇÕES (2–3 s)

| Arquivo | first → last | ACTION |
|---|---|---|
| ⭐ `52_TRANSICAO_A0-A1_vira_chat` | A0 → A1 | `She turns her head toward the monitor on the right side of the frame to read the chat.` |
| ⭐ `53_TRANSICAO_A1-A0_volta_camera` | A1 → A0 | `She turns her head from the monitor back to the lens with a soft smile.` |
| ⭐ `54_TRANSICAO_A0-A2_encosta` | A0 → A2 | `She leans back comfortably into the chair and relaxes her shoulders.` |
| ⭐ `55_TRANSICAO_A2-A0_volta` | A2 → A0 | `She sits up from the backrest toward the camera, smiling at the lens.` |
| ⭐ `56_TRANSICAO_A0-A3_aproxima` | A0 → A3 | `She leans forward toward the camera and rests her forearms on the desk, hands coming together at the bottom edge.` |
| ⭐ `57_TRANSICAO_A3-A0_recua` | A3 → A0 | `She sits back from the desk, hands lowering out of frame, soft smile to the lens.` |

### 3.3 FLUXO · A1 lendo chat (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐🔁 `58_FLUXO_A1_lendo` | `Reading the screen: eyes move along lines of text, occasional blink, calm attention.` |
| ⭐ `59_FLUXO_A1_ri_do_chat` | `She reads something funny and laughs softly, shoulders shaking lightly, then settles back to reading.` |
| ⭐ `60_FLUXO_A1_digita` | `She types a short reply below the frame — shoulders and arms move subtly as she types — still looking at the screen.` |
| 🔁 `61_FLUXO_A1_assente` | `She nods slowly in agreement with what she reads, a small smile.` |
| 🔁 `62_FLUXO_A1_sobrancelha` | `She raises one eyebrow with an amused, curious look at the screen, then relaxes.` |
| `63_FLUXO_A1_morde_labio` | `Concentrated on the screen, she lightly bites her lower lip while reading, then relaxes.` |

### 3.4 FLUXO · A2 relaxada (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐🔁 `64_FLUXO_A2_respira` | `Resting calmly: slow breathing, relaxed blinks, peaceful half-smile at the lens.` |
| ⭐🔁 `65_FLUXO_A2_olha_longe` | `She looks dreamily off to the left for a few seconds, then back to the lens.` |
| 🔁 `66_FLUXO_A2_gira_cadeira` | `She swivels the chair very slightly side to side, relaxed and playful, then settles back.` |
| `67_FLUXO_A2_ponta_cabelo` | `One hand rises into frame and plays idly with the ends of her hair, then lowers out of frame.` |
| `68_FLUXO_A2_espreguica_pescoco` | `A small lazy stretch of the neck and shoulders, eyes closing for a moment, content smile.` |

### 3.5 FLUXO · A3 perto / conversando (4–6 s)

Clipes "falando" sem áudio — tocam enquanto a IA responde no chat.

| Arquivo | ACTION |
|---|---|
| ⭐ `69_FLUXO_A3_fala_calma` | `She talks calmly to the camera as if chatting with a friend, lips moving naturally in conversation, small head movements, warm eyes. Silent.` |
| ⭐ `70_FLUXO_A3_fala_animada` | `She talks to the camera animatedly, lively expressions, small hand gestures near the bottom edge, a short laugh mid-sentence. Silent.` |
| 🔁 `71_FLUXO_A3_escuta` | `She listens attentively, nodding slightly, soft smile, as if hearing someone's story.` |
| `72_FLUXO_A3_queixo_mao` | `She rests her chin on one hand, gazing into the lens with a fond smile, then brings the hand back to the other.` |

### 3.6 GATILHOS · a partir de A0 (5–8 s, A0 → A0)

| Arquivo | Evento | ACTION |
|---|---|---|
| ⭐ `73_GATILHO_A0_aceno_oi` | follow | `She notices someone new, brightens, and one hand rises into frame for a small friendly wave, then lowers out of frame.` |
| ⭐ `74_GATILHO_A0_beijo` | presente pequeno | `She smiles, brings her fingertips up to her lips and blows a soft kiss to the camera, then the hand lowers out of frame.` |
| ⭐ `75_GATILHO_A0_coracao_maos` | presente pequeno | `Both hands rise into frame and form a heart shape in front of her chest, warm smile, then lower out of frame.` |
| ⭐ `76_GATILHO_A0_obrigada` | presente médio | `Grateful: both hands come together near her chin, a small bow of the head with a big smile, then lower out of frame.` |
| ⭐ `77_GATILHO_A0_surpresa_grande` | presente grande | `Delighted surprise: eyes widen, both hands rise to cover her mouth, she laughs behind them, then lowers them out of frame smiling.` |
| ⭐ `78_GATILHO_A0_risada` | msg engraçada | `She bursts into a genuine laugh, eyes squinting, head tipping slightly back, then settles into a smile.` |
| `79_GATILHO_A0_piscadinha` | presente pequeno | `A playful wink at the camera with a small smile.` |
| `80_GATILHO_A0_aplauso` | meta | `Her hands rise into frame and clap quickly and happily a few times near her chest, beaming, then lower out of frame.` |
| `81_GATILHO_A0_timida` | elogio | `Flattered and shy: she looks down, smiles, and briefly hides part of her smile with her fingertips, then lowers the hand.` |
| `82_GATILHO_A0_pensativa` | pergunta | `Thoughtful: a finger rests on her chin, eyes looking up as she thinks, then she smiles as if she found the answer and lowers the hand.` |
| `83_GATILHO_A0_nao_nao` | provocação | `Playful teasing: her index finger rises into frame and wags side to side as a "no-no", mischievous smile, then lowers.` |
| `84_GATILHO_A0_revira_olhos` | provocação | `A playful, amused eye-roll followed by a laugh.` |
| `85_GATILHO_A0_danca_cadeira` | presente grande | `Celebration: she dances happily in the chair, shoulders bouncing and head bopping to a beat for a few seconds, then settles.` |

### 3.7 GATILHOS · a partir de A1 (5–7 s, A1 → A1)

| Arquivo | Evento | ACTION |
|---|---|---|
| ⭐ `86_GATILHO_A1_ve_presente` | presente | `She sees something on the screen, her eyes light up, she gasps with a big smile and does a quick excited shoulder wiggle, then goes back to reading.` |
| `87_GATILHO_A1_ve_seguidor` | follow | `She notices a name on the screen, smiles, and a hand rises for a tiny wave toward the monitor, then lowers; she keeps reading.` |
| `88_GATILHO_A1_gargalhada` | msg engraçada | `She reads something hilarious and laughs out loud, covering her mouth with a hand, then lowers it and settles back to reading.` |

### 3.8 ESPECIAIS · beats raros (8–10 s, A0 → A0)

| Arquivo | ACTION |
|---|---|
| ⭐ `89_ESPECIAL_A0_bebe` | `She lifts a {DRINK} into frame, takes a small sip, and lowers it out of frame again.` |
| `90_ESPECIAL_A0_alonga` | `She stretches both arms up over her head (arms leave the top of the frame), arches slightly, then relaxes back to the pose.` |
| `91_ESPECIAL_A0_bocejo` | `A small polite yawn hidden behind her hand, followed by an embarrassed little laugh.` |
| `92_ESPECIAL_A0_cabelo_dedos` | `She runs her fingers through her hair toward the back, then lets it settle exactly as before.` |
| `93_ESPECIAL_A0_pet` | `A {PET} pops up into the frame from below, she smiles and gently pets it for a moment, then it hops back down out of frame.` |
| ⭐ `94_ESPECIAL_A0_tchau` | `Saying goodbye: she smiles, one hand rises to wave, then blows a final kiss to the camera and lowers the hand.` |

`{DRINK}` e `{PET}` são da ficha (ex.: caneca de chá, taça de vinho, lata de refrigerante; gato, cachorro pequeno).

### 3.9 Lotes

| Lote | Clipes | Cobre |
|---|---|---|
| **0 (teste)** | `40`, `45`, `52`, `53`, `74` | valida enquadramento, fidelidade do rosto e o encaixe na âncora |
| **1 ⭐** | 28 | todos os estados e sinais da tabela 1.3 |
| 2 | ≈ 27 | variedade e beats raros |

Faça o **lote 0 de uma persona** antes de tudo: 5 clipes bastam para ver se o
busto funciona no palco, se o rosto se mantém e se o fim bate na âncora.

---

## 4. Controle de qualidade

1. Rodar o verificador com a âncora do pool — precisa dar `ok/ok`:

```bash
python scripts/check_idle_anchor.py --anchor assets/idle-kit/barbara/A0_camera.png assets/videos/barbara/40_FLUXO_A0_respira_piscar.mp4
```

   Transições: rode uma vez com a âncora de origem (coluna *início*) e outra com
   a de destino (coluna *fim*).
2. Olhar: rosto igual ao `ref_rosto_frente`, joias presentes, microfone no canto.
3. Mãos: entram e **saem** do quadro; dedos corretos nos gestos.
4. Fim "quase" (32–38 dB): cortar os últimos 2–4 frames ou regerar.

---

## 5. Próximos passos no app

1. Tirar as duplicatas do pool atual (lista impressa pelo verificador).
2. Motor da IDLE: pools por âncora, energia, anti-repetição, beats com cooldown,
   ping-pong e sinais da live → estado. Hoje o fluxo usa `safe_next` fixo e um
   único `idleVideoId`, então isso precisa ser implementado.
3. Pastas por persona (`assets/videos/<persona>/`) e cadastro dos clipes nos pools.
