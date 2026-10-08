# Viktoria — Academia — todos os prompts de produção

> Gerado por `scripts/build_idle_prompts.py` — não edite à mão: mude a ficha no script ou a lista de
> clipes em `docs/producao/ACADEMIA-PRODUCAO.md` e rode de novo.

Formato **Academia**: a Viktoria treinando, ao vivo. Conceito, poses, looks e onde gerar:
[ACADEMIA-PRODUCAO.md](../ACADEMIA-PRODUCAO.md). **Sensual, nunca explícito:** sem nudez, sem
mamilo, sem tecido transparente.

Pasta das imagens: `assets/idle-kit/viktoria-academia/` · pasta dos vídeos: `assets/videos/viktoria-academia/`

## Ficha

| Campo | Valor |
|---|---|
| `IDENTITY` | a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup |
| `BODY` | a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen |
| `WARDROBE` | a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes |
| `ROOM` | an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around |
| `LIGHT` | Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin |
| `CAMERA` | a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide |
| `MOTION` | Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish. |
| `DRINK` | frosted pink shaker bottle |

## Parte 1 — Imagens (na ordem)

Modelo de imagem com referência (Nano Banana / Gemini Image, Seedream 4, Flux Kontext, GPT-Image).
Gere 3–4 variações de cada e escolha a mais **fiel ao rosto e ao corpo** (`academia_corpo.png`).

### Etapa 0 · `ref_corpo.png` · 9:16

**Entradas:** nenhuma · **Para quê:** Não é gerada: envie aqui a imagem de referência do corpo (persona de IA). Só as proporções do corpo entram na etapa 3.

### Etapa 1 · `academia_vazia.png` · 9:16

**Entradas:** nenhuma · **Para quê:** Fundo sem pessoa: base da A0 e referência para conferir se o cenário mudou em algum clipe.

```text
Vertical 9:16 photo of an empty gym at night, shot from a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide. an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around. A padded bench stands in the foreground center with clear floor space around it. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic, natural grain, no people, no text, no logos.
```

### Etapa 2 · `figurino.png` · 3:4

**Entradas:** nenhuma · **Para quê:** Roupa fixa: cor e recortes iguais em todos os clipes.

```text
Flat-lay product photo of this gym outfit, no person: a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Arranged neatly on a black rubber gym floor, soft even light, true colors, fabric sheen and seams clearly visible. Wardrobe reference, photorealistic.
```

### Etapa 3 ⭐ · `academia_corpo.png` · 9:16

**Entradas:** foto de rosto + ref_corpo.png + figurino.png · **Para quê:** Fixa o corpo novo. Daqui em diante ela substitui a referência de corpo em todas as etapas.

```text
Vertical 9:16 full-body fitness photo of the woman from the face reference, an adult fitness model, standing in a relaxed three-quarter pose. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. Take only the body proportions from the body reference, never its face or hair. She wears a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes, as in the outfit reference. Neutral light-grey studio background, soft even light, full body visible from head to feet. Photorealistic, natural skin texture, no text.
```

### Etapa 4 ⭐ · `A0_camera.png` · 9:16

**Entradas:** foto de rosto + academia_corpo.png + academia_vazia.png · **Para quê:** A imagem mais importante: é o primeiro e o último frame de quase todos os vídeos.

```text
Vertical 9:16 photo of the woman from the references, an adult fitness streamer at night, standing in the gym from the scene reference, in exactly that room and light. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. She wears a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes.

Framing: a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide, frame cut at mid-thigh, small headroom above her ponytail, the bench partly visible behind her, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin.

Pose: standing facing the camera, weight on one leg, one hand on her hip, the other arm relaxed at her side, slightly out of breath after a set with a light sheen on her skin, looking straight into the lens with a confident half-smile. Photorealistic, natural skin texture, no text.
```

### Etapa 5 · `A1_chat.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "lendo o chat" (chat agitado).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, body shape and proportions, outfit, the gym, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She now holds her phone at chest height with both hands, eyes down reading the screen with an amused smile, shoulders relaxed.
```

### Etapa 5 · `A2_lado.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "treinando": base das séries de agachamento.

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, body shape and proportions, outfit, the gym, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She now stands in profile beside the bench, hands on her hips, feet shoulder-width apart, ready to squat, head turned toward the lens with a focused little smile. Her figure is seen from the side: full bust, narrow waist, large round glutes.
```

### Etapa 5 · `A3_perto.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "perto / conversando" (a IA está respondendo alguém).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, body shape and proportions, outfit, the gym, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She leans in close to the camera, so her face and the deep neckline of her sports bra fill more of the frame, looking into the lens with a warm teasing smile.
```

### Etapa 6 · `ref_rosto_frente.png` · 3:4

**Entradas:** foto de rosto + A0_camera.png · **Para quê:** Trava o rosto no gerador de vídeo (personagem salvo).

```text
Close-up head-and-shoulders portrait of the same woman as the references, identical face and features: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Same hair, makeup and outfit (a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes). Facing the camera, neutral soft smile, same light as the A0 image, gym softly blurred behind. Identity reference photo, photorealistic, sharp focus on the eyes, natural skin texture, no retouching.
```

### Etapa 6 · `ref_corpo_lado.png` · 9:16

**Entradas:** academia_corpo.png + A2_lado.png · **Para quê:** Trava o corpo de perfil (agachamentos e giros) no gerador de vídeo.

```text
Full-body side view of the same woman as the references, standing in profile: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. Same face, hair and outfit (a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes). Neutral light-grey studio background, soft even light, head to feet visible. Body reference photo, photorealistic.
```

### Etapa 7 · `ref_expressoes.png` · 1:1

**Entradas:** ref_rosto_frente.png + A0_camera.png · **Para quê:** Riso, piscadinha e esforço iguais em todas as reações.

```text
A 3x3 grid expression sheet of the exact same woman in every panel — identical face, hair, makeup and outfit, chest-up crop, same gym lighting, same blurred background, thin white gutters, no text.
1 neutral calm · 2 confident half-smile · 3 big genuine smile with teeth · 4 laughing with eyes squinting · 5 focused effort mid-rep, lips pressed · 6 out of breath with a tired smile · 7 blowing a kiss · 8 playful wink · 9 teasing look biting her lower lip lightly.
Expressions in her own style: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish. Natural and believable, not cartoonish. Photorealistic.
```

### Etapa 8 · `foto_selfie_espelho.png` · 9:16

**Entradas:** foto de rosto + academia_corpo.png + academia_vazia.png · **Para quê:** Divulgação: selfie no espelho da academia (look preto).

```text
Vertical 9:16 mirror selfie of the woman from the references in the gym mirror, phone held at face height partly covering one side of her face. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. She wears a matte black ribbed one-piece gym bodysuit with a very low scoop neckline showing deep cleavage and an open low back. Weight on one leg, hip popped to the side, other hand on her waist. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin, red neon reflected in the mirror. Photorealistic phone photo, natural skin texture, no text.
```

### Etapa 8 · `foto_angulo_baixo.png` · 9:16

**Entradas:** foto de rosto + academia_corpo.png + academia_vazia.png · **Para quê:** Divulgação: ângulo de baixo para cima, como a foto de referência.

```text
Vertical 9:16 low-angle photo looking slightly up at the woman from the references, standing close to the camera in the gym. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. She wears a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. One hand adjusting the strap of her sports bra, the other on her hip, head tilted, confident teasing half-smile looking down into the lens. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic, 24mm lens, natural skin texture, no text.
```

### Etapa 8 · `foto_costas_espelho.png` · 9:16

**Entradas:** foto de rosto + academia_corpo.png + academia_vazia.png · **Para quê:** Divulgação: de costas, olhando por cima do ombro (look esmeralda).

```text
Vertical 9:16 photo of the woman from the references seen from behind, looking back over her shoulder at the camera with a playful smile, her reflection visible in the gym mirror in front of her. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. She wears an emerald-green halter sports top with a keyhole cutout, cropped high above the navel, and matching tight micro biker shorts, white crew socks and white training shoes. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic, natural skin texture, no text.
```

### Etapa 8 · `foto_banco.png` · 9:16

**Entradas:** foto de rosto + academia_corpo.png + academia_vazia.png · **Para quê:** Divulgação: sentada no banco depois do treino.

```text
Vertical 9:16 photo of the woman from the references sitting on the edge of a padded gym bench, leaning slightly forward with her forearms on her knees, a frosted pink shaker bottle in one hand, slightly out of breath with a light sheen on her skin. Identity exactly as the face reference: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup. Body exactly as the body reference: a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen. She wears a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Looking up into the lens with a tired satisfied smile. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic, natural skin texture, no text.
```

### Etapa 9 · `capa_live_9x16.png` · 9:16

**Entradas:** A0_camera.png + ref_rosto_frente.png · **Para quê:** Capa da live (story / Tango).

```text
Vertical promotional cover photo for a live workout stream, the same adult woman as the references with identical face, hair, body and outfit: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Confident inviting expression looking into the lens, an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around softly out of focus behind her. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Clean composition with empty space at the bottom third for a title to be added later. Photorealistic, natural skin texture, no text, no logos.
```

## Parte 2 — Vídeos (image-to-video, primeiro + último frame)

Modelos com first + last frame: Kling (start/end frame), Veo 3.1, Seedance, Wan FLF2V.
Saída: 9:16, 24 fps, **sem áudio**. Personagem salvo, se o modelo aceitar: `ref_rosto_frente`,
`ref_corpo_lado`, `academia_corpo.png` e `A0_camera`.

**Prompt negativo (igual para todos os clipes):**

```text
camera movement, zoom, pan, dolly, cut, scene change, morphing face, different person, changing body shape, slimmer body, changing hairstyle, changing outfit, outfit color change, extra fingers, deformed hands, extra limbs, extra people, new objects, flickering light, exposure change, text, subtitles, watermark, logo, fast jerky motion, leaving the frame, nudity, see-through fabric
```

Lotes: **0** = teste (5 clipes, faça primeiro) · **1** = mínimo para ir ao ar · **2** = variedade.

### Lote 0 — 5 clipes

#### `01_FLUXO_A0_respira.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Catching her breath after a set: her chest and shoulders rise and fall visibly, a light sheen on her skin, she blinks and gives the lens a small confident smile.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `06_FLUXO_A0_espia_chat.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She glances down to her right at the phone resting on the bench for a second, then looks back at the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `11_TRANSICAO_A0-A2_vira_de_lado.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A2_lado.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She turns to stand in profile beside the bench, hands on her hips, ready to squat, glancing at the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens — and ends on exactly the pose of the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `12_TRANSICAO_A2-A0_volta_de_frente.mp4`

Transição · **1º frame:** `A2_lado.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She turns back to face the camera, one hand on her hip, confident half-smile.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens — and ends on exactly the pose of the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `24_GATILHO_A0_beijo.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente pequeno

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She blows a kiss to the camera, adds a playful wink, and the hand returns to her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

### Lote 1 — 18 clipes

#### `02_FLUXO_A0_rabo_de_cavalo.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Both hands rise and tighten her high ponytail, then one hand returns to her hip and the other lowers to her side.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `03_FLUXO_A0_ajusta_top.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She slides two fingers under the strap of her sports bra, adjusts it on her shoulder and smooths the fabric, then the hand returns to her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `09_TRANSICAO_A0-A1_pega_celular.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A1_chat.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She bends slightly, picks up her phone from the bench below the frame and holds it at chest height with both hands, eyes going to the screen.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens — and ends on exactly the pose of the end frame — standing facing the camera, holding her phone at chest height with both hands, eyes down reading the screen. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `10_TRANSICAO_A1-A0_guarda_celular.mp4`

Transição · **1º frame:** `A1_chat.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She lowers the phone out of frame, looks back up at the lens and places one hand back on her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — standing facing the camera, holding her phone at chest height with both hands, eyes down reading the screen — and ends on exactly the pose of the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `13_TRANSICAO_A0-A3_chega_perto.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A3_perto.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She takes a step toward the camera and leans in close, a warm teasing smile into the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens — and ends on exactly the pose of the end frame — leaning in close to the camera, face and neckline filling more of the frame, warm teasing smile. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `14_TRANSICAO_A3-A0_volta.mp4`

Transição · **1º frame:** `A3_perto.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She straightens up and steps back to her place, one hand on her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

TRANSITION RULES: Starts on the start frame — leaning in close to the camera, face and neckline filling more of the frame, warm teasing smile — and ends on exactly the pose of the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `15_FLUXO_A1_le_e_ri.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She reads something on the phone, laughs softly and shakes her head, still looking at the screen.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, holding her phone at chest height with both hands, eyes down reading the screen. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `17_FLUXO_A2_agachamento.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_lado.png` · **último frame:** `A2_lado.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Three slow controlled bodyweight squats in profile: hips back and down, glutes and thighs engaged under the leggings, rising back up each time, glancing at the camera on the last rep.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `21_FLUXO_A3_conversa.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Leaning close, she talks animatedly to the camera as if answering a question from the chat, expressive eyebrows, smiling. Silent.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning in close to the camera, face and neckline filling more of the frame, warm teasing smile. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `23_GATILHO_A0_aceno.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: follow

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She notices someone new, brightens, and gives a friendly wave with a big smile, then the hand returns to her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `25_GATILHO_A0_biceps.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente médio

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She flexes one bicep proudly toward the camera with a playful grin, gives it a little tap, then relaxes back to the pose.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `26_GATILHO_A0_mais_uma_serie.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente grande

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She points at the camera, mouths "one more for you", does two quick squats facing the camera, and stands back up with a hand on her hip, beaming.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `27_GATILHO_A0_risada.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: msg engraçada

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She bursts into a genuine laugh, head tipping back, a hand briefly on her stomach, then settles into a smile.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `30_ESPECIAL_A0_bebe.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She lifts a frosted pink shaker bottle into frame, takes a long sip, wipes her lip with the back of her hand and smiles at the lens, then lowers the bottle.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `33_ESPECIAL_A0_tchau.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Ending the workout: she waves goodbye with a big smile, blows a final kiss to the camera, and the hand returns to her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `34_SEGMENTO_A0_bora_treinar.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: abertura

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Starting the live: she claps her hands once, rubs them together and says "let's go" to the camera with energy, then a hand returns to her hip. Silent.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `35_SEGMENTO_A0_aquecimento.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: aquecimento

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Warming up: big slow arm circles forward, then a few quick side steps in place, ending back in the pose slightly out of breath.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `37_SEGMENTO_A0_meta_batida.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: meta batida

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Goal reached: she jumps once with both fists up, laughs and claps, beaming at the lens, then settles back with a hand on her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

### Lote 2 — 15 clipes

#### `04_FLUXO_A0_ajusta_legging.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She smooths the high waistband of her leggings over her hips with both hands, glances down at it, then looks back at the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `05_FLUXO_A0_balanca.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She sways her hips gently side to side to the gym music, a playful half-smile at the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `07_FLUXO_A0_alonga_braco.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She pulls one arm across her chest in a slow shoulder stretch, then the other arm, and returns to the pose.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `08_FLUXO_A0_olha_espelho.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She glances to the side toward the gym mirror, checks her look with a satisfied smile, and looks back at the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `16_FLUXO_A1_digita.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She types a quick reply on the phone with both thumbs, smiling at what she writes.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, holding her phone at chest height with both hands, eyes down reading the screen. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `18_FLUXO_A2_agachamento_pausa.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_lado.png` · **último frame:** `A2_lado.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: One deep slow squat in profile, holding at the bottom for two seconds with a focused face, then rising back up.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `19_FLUXO_A2_afundo.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_lado.png` · **último frame:** `A2_lado.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She steps one leg back into a slow reverse lunge, rises, then does the same with the other leg, ending standing in profile.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `20_FLUXO_A2_respira_de_lado.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_lado.png` · **último frame:** `A2_lado.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Standing in profile with hands on her hips, she catches her breath and throws a quick smile toward the lens.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `22_FLUXO_A3_sorriso.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Close to the lens, her smile slowly grows, she bites her lower lip lightly and lets out a small laugh.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning in close to the camera, face and neckline filling more of the frame, warm teasing smile. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `28_GATILHO_A0_gira_look.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: elogio

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Flattered, she does a slow full turn showing off her outfit and ends facing the camera again with a shy smile and a hand on her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `29_GATILHO_A0_nao_nao.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: provocação

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Playful teasing: she wags her index finger "no-no" at the camera with a mischievous smile, then the hand returns to her hip.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `31_ESPECIAL_A0_toalha.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She dabs her neck and collarbone with a small black towel, tosses it over her shoulder, and returns to the pose.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `32_ESPECIAL_A0_danca.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: She dances for a few seconds to the gym music, hips and shoulders moving, laughing, then settles back into the pose.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing facing the camera, framed from mid-thigh up, one hand on her hip, confident half-smile at the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `36_SEGMENTO_A2_serie_gluteo.mp4`

Segmento (formato de live) · **1º frame:** `A2_lado.png` · **último frame:** `A2_lado.png` · **duração:** 6–9 s · evento: treino de glúteo

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Glute set in profile: three slow sumo squats with wide stance, pausing at the bottom of each one, glancing at the camera on the last rep.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — standing in profile beside the bench, hands on her hips, ready to squat, head turned toward the lens. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

#### `38_SEGMENTO_A3_agradece.mp4`

Segmento (formato de live) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 6–9 s · evento: agradecimento

```text
SCENE LOCK — Static locked-off camera (a phone on a tripod at chest height, vertical 9:16, 26mm phone lens look, slightly wide), framed from mid-thigh up, identical framing to the start frame. The same woman as the start frame: a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted rosy-beige; honey-platinum blonde hair pulled into a high sleek ponytail, curtain bangs framing her face, a few loose strands; light fresh gym makeup, with a curvy athletic hourglass physique of a fitness model who trains glutes: very full, large and round natural-looking bust, narrow cinched waist with soft visible abs lines, wide hips, large round lifted glutes, thick toned thighs, defined shoulders and lean toned arms, smooth fair skin with a light healthy sheen, wearing a glossy cherry-red seamless sculpting gym set: a plunging deep V-neck sports bra with thin crisscross straps and a very deep cleavage, and matching high-waisted scrunch-butt leggings with a contour seam that lifts and shapes the glutes, white training shoes. Working out in an upscale boutique gym at night: black rubber floor, a wall of mirrors, a chrome dumbbell rack, a padded bench and a hip-thrust machine, warm amber strip lights and a soft red neon line along the ceiling, a few blurred machines in the background, nobody else around, background softly out of focus. Warm amber practical lights mixed with a soft red neon rim light, gentle contrast, glossy highlights on the skin. Photorealistic.

ACTION: Leaning in, she places one hand over her heart, looks deeply into the lens with a grateful smile and gives a small slow nod.

STYLE: Confident and playful: slow controlled reps, glances at the camera between sets, a teasing half-smile, breathing visibly after a set; never rushed, never cartoonish.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning in close to the camera, face and neckline filling more of the frame, warm teasing smile. She stays fully inside the frame. Natural breathing and blinks throughout. Camera completely static. Background, outfit, body and lighting never change. No sound.
```

## Parte 3 — Conferir cada clipe

```bash
python scripts/check_idle_anchor.py --anchor assets/idle-kit/viktoria-academia/A0_camera.png assets/videos/viktoria-academia/<arquivo>.mp4
```

Precisa dar `ok/ok`. Transição: rode com a âncora de início e depois com a de fim.
Olhar também: rosto igual ao `ref_rosto_frente`, corpo igual ao `academia_corpo.png`, a roupa não muda de cor nem de corte, ela não sai do quadro.
