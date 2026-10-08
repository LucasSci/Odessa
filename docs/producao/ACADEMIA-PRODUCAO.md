# Formato Academia — a live da Viktoria treinando

Fonte dos clipes do formato **Academia** (o `scripts/build_idle_prompts.py` lê as tabelas
da seção 4). Mesmo esquema da IDLE: quatro poses âncora, cada vídeo começa e termina numa
delas, e o palco emenda tudo sem corte (`docs/ARCHITECTURE.md` → Palco contínuo).

Prompts prontos, etapa a etapa: [viktoria-academia/PROMPTS.md](viktoria-academia/PROMPTS.md).
No app: **Estúdio da IDLE → Viktoria — Academia**.

**Limite de conteúdo:** sensual, nunca explícito — roupa colada, decote marcado, corpo
curvilíneo; sem nudez, sem mamilo, sem tecido transparente. É o nível que o Higgsfield e
o Tango aceitam.

## 1. Conceito

A Viktoria (mesmo rosto da IDLE) treinando à noite numa academia boutique, filmada pelo
celular num tripé. Entre as séries ela olha a câmera, lê o chat no celular, chega perto
para conversar e reage aos presentes. Corpo de quem treina glúteo: ampulheta atlética,
seios fartos, cintura fina, quadril largo, glúteos grandes.

## 2. Poses âncora

Os códigos `A0`–`A3` são os mesmos da IDLE (o app, o ciclo natural e as emendas por pose
usam esses nomes); o significado muda:

| Âncora | Arquivo | Pose | Quando |
|---|---|---|---|
| **A0** | `A0_camera.png` | de pé, de frente, enquadrada da metade da coxa para cima, mão na cintura | entre séries (estado base) |
| **A1** | `A1_chat.png` | segurando o celular na altura do peito, lendo | chat agitado |
| **A2** | `A2_lado.png` | de perfil ao lado do banco, mãos na cintura, pronta para agachar | treinando |
| **A3** | `A3_perto.png` | inclinada perto da câmera, rosto e decote ocupando mais o quadro | conversando (a IA respondendo alguém) |

## 3. Looks

O conjunto de vídeos usa um look só (o da ficha). Os outros servem para fotos de
divulgação; para um conjunto de vídeos com outro look, troque `WARDROBE` na ficha do script
e gere um formato novo.

| Look | Descrição |
|---|---|
| **Vermelho (vídeos)** | conjunto vermelho-cereja brilhante: top esportivo com decote V profundo e alças cruzadas finas, legging de cintura alta com recorte que empina o glúteo |
| Preto | macaquinho canelado preto com decote cavado e costas abertas com alças cruzadas |
| Esmeralda | top frente-única com recorte gota e decote, cropped, e short ciclista colado; meião e tênis brancos |

**Para o filtro passar:** use `deep cleavage`, `plunging neckline`, `low-cut`,
`form-fitting`, `sculpting`, `figure-hugging`, `curvy`, `fitness model`. Evite `sexy`,
`nipple`, `see-through`/`sheer`, `nude`, `topless` e `lingerie` junto com academia.

## 4. Lista de clipes

`NN_CATEGORIA_ANCORA_acao.mp4`. ⭐ = lote 1 (mínimo para ir ao ar) · 🔁 = pode tocar invertido.

### 4.1 FLUXO · A0 entre séries (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐🔁 `01_FLUXO_A0_respira` | `Catching her breath after a set: her chest and shoulders rise and fall visibly, a light sheen on her skin, she blinks and gives the lens a small confident smile.` |
| ⭐ `02_FLUXO_A0_rabo_de_cavalo` | `Both hands rise and tighten her high ponytail, then one hand returns to her hip and the other lowers to her side.` |
| ⭐ `03_FLUXO_A0_ajusta_top` | `She slides two fingers under the strap of her sports bra, adjusts it on her shoulder and smooths the fabric, then the hand returns to her hip.` |
| `04_FLUXO_A0_ajusta_legging` | `She smooths the high waistband of her leggings over her hips with both hands, glances down at it, then looks back at the lens.` |
| 🔁 `05_FLUXO_A0_balanca` | `She sways her hips gently side to side to the gym music, a playful half-smile at the lens.` |
| ⭐ `06_FLUXO_A0_espia_chat` | `She glances down to her right at the phone resting on the bench for a second, then looks back at the lens.` |
| `07_FLUXO_A0_alonga_braco` | `She pulls one arm across her chest in a slow shoulder stretch, then the other arm, and returns to the pose.` |
| 🔁 `08_FLUXO_A0_olha_espelho` | `She glances to the side toward the gym mirror, checks her look with a satisfied smile, and looks back at the lens.` |

### 4.2 TRANSIÇÕES (2–3 s)

| Arquivo | ACTION |
|---|---|
| ⭐ `09_TRANSICAO_A0-A1_pega_celular` | `She bends slightly, picks up her phone from the bench below the frame and holds it at chest height with both hands, eyes going to the screen.` |
| ⭐ `10_TRANSICAO_A1-A0_guarda_celular` | `She lowers the phone out of frame, looks back up at the lens and places one hand back on her hip.` |
| ⭐ `11_TRANSICAO_A0-A2_vira_de_lado` | `She turns to stand in profile beside the bench, hands on her hips, ready to squat, glancing at the lens.` |
| ⭐ `12_TRANSICAO_A2-A0_volta_de_frente` | `She turns back to face the camera, one hand on her hip, confident half-smile.` |
| ⭐ `13_TRANSICAO_A0-A3_chega_perto` | `She takes a step toward the camera and leans in close, a warm teasing smile into the lens.` |
| ⭐ `14_TRANSICAO_A3-A0_volta` | `She straightens up and steps back to her place, one hand on her hip.` |

### 4.3 FLUXO · A1 lendo o chat (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐ `15_FLUXO_A1_le_e_ri` | `She reads something on the phone, laughs softly and shakes her head, still looking at the screen.` |
| `16_FLUXO_A1_digita` | `She types a quick reply on the phone with both thumbs, smiling at what she writes.` |

### 4.4 FLUXO · A2 treinando (4–5 s)

| Arquivo | ACTION |
|---|---|
| ⭐ `17_FLUXO_A2_agachamento` | `Three slow controlled bodyweight squats in profile: hips back and down, glutes and thighs engaged under the leggings, rising back up each time, glancing at the camera on the last rep.` |
| `18_FLUXO_A2_agachamento_pausa` | `One deep slow squat in profile, holding at the bottom for two seconds with a focused face, then rising back up.` |
| `19_FLUXO_A2_afundo` | `She steps one leg back into a slow reverse lunge, rises, then does the same with the other leg, ending standing in profile.` |
| 🔁 `20_FLUXO_A2_respira_de_lado` | `Standing in profile with hands on her hips, she catches her breath and throws a quick smile toward the lens.` |

### 4.5 FLUXO · A3 perto / conversando (4–6 s)

| Arquivo | ACTION |
|---|---|
| ⭐ `21_FLUXO_A3_conversa` | `Leaning close, she talks animatedly to the camera as if answering a question from the chat, expressive eyebrows, smiling. Silent.` |
| `22_FLUXO_A3_sorriso` | `Close to the lens, her smile slowly grows, she bites her lower lip lightly and lets out a small laugh.` |

### 4.6 GATILHOS · a partir de A0 (5–8 s, A0 → A0)

| Arquivo | Evento | ACTION |
|---|---|---|
| ⭐ `23_GATILHO_A0_aceno` | follow | `She notices someone new, brightens, and gives a friendly wave with a big smile, then the hand returns to her hip.` |
| ⭐ `24_GATILHO_A0_beijo` | presente pequeno | `She blows a kiss to the camera, adds a playful wink, and the hand returns to her hip.` |
| ⭐ `25_GATILHO_A0_biceps` | presente médio | `She flexes one bicep proudly toward the camera with a playful grin, gives it a little tap, then relaxes back to the pose.` |
| ⭐ `26_GATILHO_A0_mais_uma_serie` | presente grande | `She points at the camera, mouths "one more for you", does two quick squats facing the camera, and stands back up with a hand on her hip, beaming.` |
| ⭐ `27_GATILHO_A0_risada` | msg engraçada | `She bursts into a genuine laugh, head tipping back, a hand briefly on her stomach, then settles into a smile.` |
| `28_GATILHO_A0_gira_look` | elogio | `Flattered, she does a slow full turn showing off her outfit and ends facing the camera again with a shy smile and a hand on her hip.` |
| `29_GATILHO_A0_nao_nao` | provocação | `Playful teasing: she wags her index finger "no-no" at the camera with a mischievous smile, then the hand returns to her hip.` |

### 4.7 ESPECIAIS · beats raros (8–10 s, A0 → A0)

| Arquivo | ACTION |
|---|---|
| ⭐ `30_ESPECIAL_A0_bebe` | `She lifts a {DRINK} into frame, takes a long sip, wipes her lip with the back of her hand and smiles at the lens, then lowers the bottle.` |
| `31_ESPECIAL_A0_toalha` | `She dabs her neck and collarbone with a small black towel, tosses it over her shoulder, and returns to the pose.` |
| `32_ESPECIAL_A0_danca` | `She dances for a few seconds to the gym music, hips and shoulders moving, laughing, then settles back into the pose.` |
| ⭐ `33_ESPECIAL_A0_tchau` | `Ending the workout: she waves goodbye with a big smile, blows a final kiss to the camera, and the hand returns to her hip.` |

### 4.8 SEGMENTOS · blocos da live (6–9 s, disparo manual)

| Arquivo | Âncoras | Bloco | ACTION |
|---|---|---|---|
| ⭐ `34_SEGMENTO_A0_bora_treinar` | A0 → A0 | abertura | `Starting the live: she claps her hands once, rubs them together and says "let's go" to the camera with energy, then a hand returns to her hip. Silent.` |
| ⭐ `35_SEGMENTO_A0_aquecimento` | A0 → A0 | aquecimento | `Warming up: big slow arm circles forward, then a few quick side steps in place, ending back in the pose slightly out of breath.` |
| `36_SEGMENTO_A2_serie_gluteo` | A2 → A2 | treino de glúteo | `Glute set in profile: three slow sumo squats with wide stance, pausing at the bottom of each one, glancing at the camera on the last rep.` |
| ⭐ `37_SEGMENTO_A0_meta_batida` | A0 → A0 | meta batida | `Goal reached: she jumps once with both fists up, laughs and claps, beaming at the lens, then settles back with a hand on her hip.` |
| `38_SEGMENTO_A3_agradece` | A3 → A3 | agradecimento | `Leaning in, she places one hand over her heart, looks deeply into the lens with a grateful smile and gives a small slow nod.` |

### 4.9 Lotes

| Lote | Clipes | Cobre |
|---|---|---|
| **0 (teste)** | `01`, `06`, `11`, `12`, `24` | enquadramento, corpo e rosto fiéis, encaixe nas âncoras A0 e A2 |
| **1 ⭐** | 18 | todos os estados, os presentes e os blocos principais |
| 2 | 15 | variedade |

Faça o **lote 0** antes de tudo: 5 clipes mostram se o corpo se mantém igual ao
`academia_corpo.png`, se o rosto continua o da Viktoria e se o fim bate na âncora.

## 5. Onde gerar

| Ferramenta | Para quê | Observação |
|---|---|---|
| **Higgsfield** — Soul / Nano Banana / Seedream 4 | todas as imagens | decote, roupa colada e corpo curvilíneo costumam passar |
| **Higgsfield** — Kling / Seedance / Veo (1º + último frame) | todos os vídeos | se um modelo barrar, tente outro: cada um tem filtro próprio |
| **Civitai.red** (assinatura) | fotos mais ousadas, LoRA da Viktoria | sem filtro de nudez; use só para o que o Higgsfield recusar |
| Seedream 4 / Flux Kontext em outros serviços (fal.ai, Replicate) | alternativa pontual | filtros diferentes; confira os termos |

## 6. Na live

1. Estúdio da IDLE → **Viktoria — Academia** → aprove os vídeos → **Montar fluxo**
   (com a persona Viktoria ativa). O fluxo da academia substitui o da IDLE na persona.
2. Para voltar à IDLE: Estúdio → **Viktoria** → **Montar fluxo** de novo.
3. Presentes e comentários disparam os gatilhos da seção 4.6; os segmentos (4.8) ficam em
   Automações como gatilhos manuais.
