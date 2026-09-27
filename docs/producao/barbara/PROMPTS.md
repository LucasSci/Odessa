# Barbara — todos os prompts de produção (IDLE)

> Gerado por `scripts/build_idle_prompts.py` — não edite à mão: mude a ficha no script ou a lista de
> clipes em `docs/IDLE-PRODUCAO.md` / `docs/PLANO-CONTEUDO-LIVE.md` e rode de novo.

Pasta das imagens: `assets/idle-kit/barbara/` · pasta dos vídeos: `assets/videos/barbara/`

## Ficha

| Campo | Valor |
|---|---|
| `IDENTITY` | a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup |
| `WARDROBE` | a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant |
| `ROOM` | a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights |
| `LIGHT` | Warm 3000K key light, pink and lilac accents in the background |
| `MIC` | a white podcast microphone on a short arm with a colorful foam windscreen |
| `MOTION` | Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural. |
| `DRINK` | pastel iced coffee cup with a straw |
| `PET` | small fluffy white pomeranian |

## Parte 1 — Imagens (na ordem)

Modelo de imagem com referência (Nano Banana / Gemini Image, Seedream 4, Flux Kontext, GPT-Image).
Gere 3–4 variações de cada e escolha a mais **fiel ao rosto**, não a mais bonita.

### Etapa 1 · `cenario_vazio.png` · 9:16

**Entradas:** nenhuma · **Para quê:** Fundo sem pessoa: base da A0 e referência para conferir se o fundo mudou em algum clipe.

```text
Vertical 9:16 photo of an empty live-streaming seat at night, shot from eye level with a 55mm lens at f/2. a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights. The background is softly out of focus with the practical lights turned into gentle bokeh. In the foreground, the empty backrest of a chair, and a white podcast microphone on a short arm with a colorful foam windscreen entering the frame from the lower right corner, partly cropped. A soft cool glow from an off-screen monitor on the right. Warm 3000K key light, pink and lilac accents in the background. Photorealistic, natural film grain, no people, no text.
```

### Etapa 2 · `figurino.png` · 3:4

**Entradas:** nenhuma · **Para quê:** Roupa e joias fixas: nenhuma joia some entre os clipes.

```text
Flat-lay product photo of this outfit, no person: a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Arranged neatly on a neutral linen surface, soft even light, true colors, fabric texture and details clearly visible. Wardrobe reference, photorealistic.
```

### Etapa 3 ⭐ · `A0_camera.png` · 9:16

**Entradas:** foto de rosto + cenario_vazio.png + figurino.png · **Para quê:** A imagem mais importante: é o primeiro e o último frame de quase todos os vídeos.

```text
Vertical 9:16 chest-up portrait of the woman from the face reference, an adult live streamer at night, seated in the chair from the scene reference, in exactly that room and light. Identity must match the face reference exactly: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup. She wears a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant.

Framing: small headroom above her head, eyes at one third from the top, frame cut at mid-chest, shoulders filling most of the width, camera at eye level, 55mm lens at f/2, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen enters from the lower right corner, partly cropped. Soft cool glow from an off-screen monitor on the right side of her face. Warm 3000K key light, pink and lilac accents in the background.

Pose: shoulders square to the camera, looking straight into the lens, relaxed friendly expression with a soft closed-mouth smile. Both hands are out of frame, resting on the desk below. Photorealistic, natural skin texture, gentle film grain, no text.
```

### Etapa 3b · `A0_camera_close.png` · 9:16

**Entradas:** foto de rosto + cenario_vazio.png + figurino.png · **Para quê:** Teste de enquadramento mais fechado. Compare as duas no palco do Odessa e fique com uma como A0.

```text
Vertical 9:16 close portrait of the woman from the face reference, an adult live streamer at night, seated in the chair from the scene reference, in exactly that room and light. Identity must match the face reference exactly: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup. She wears a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant.

Framing: close shoulders-up portrait, eyes at one third from the top, frame cut just below the collarbones, face filling about half of the frame height, camera at eye level, 65mm lens at f/1.8, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen barely visible in the lower right corner. Soft cool glow from an off-screen monitor on the right side of her face. Warm 3000K key light, pink and lilac accents in the background.

Pose: shoulders square to the camera, looking straight into the lens, relaxed friendly expression with a soft closed-mouth smile. Both hands are out of frame. Photorealistic, natural skin texture, gentle film grain, no text.
```

### Etapa 4 · `A1_chat.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "lendo o chat" (chat agitado).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She turns her head about 30 degrees toward the right side of the frame, eyes reading an off-screen monitor, attentive relaxed expression with the faintest smile. The cool monitor glow now falls more on her face. Hands stay out of frame.
```

### Etapa 4 · `A2_relaxada.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "relaxada" (chat parado).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She leans back a little into the chair, so she sits slightly further from the camera, head tilted gently, calm content half-smile, eyes softly on the lens. Hands stay out of frame.
```

### Etapa 4 · `A3_perto.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Estado "perto / conversando" (a IA está respondendo alguém).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.

She leans forward toward the camera with her forearms resting on the desk, face a little closer to the lens, warm engaged smile, looking directly into the camera. Her hands, loosely together, are just visible at the bottom edge of the frame.
```

### Etapa 5 · `ref_rosto_frente.png` · 3:4

**Entradas:** foto de rosto + A0_camera.png · **Para quê:** Trava o rosto no gerador de vídeo (personagem salvo).

```text
Close-up head-and-shoulders portrait of the same woman as the references, identical face and features: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup. Same hair, makeup, jewelry and outfit (a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant). Facing the camera, neutral soft smile, same light as the A0 image, background softly blurred. Identity reference photo, photorealistic, sharp focus on the eyes, natural skin texture, no retouching.
```

### Etapa 5 · `ref_rosto_34_esq.png` · 3:4

**Entradas:** foto de rosto + A0_camera.png · **Para quê:** Mantém o rosto quando ela vira a cabeça.

```text
Same woman as the references, identical face and features: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup. Same hair, jewelry, outfit and lighting. Three-quarter view, head turned about 40 degrees to HER LEFT, soft smile. Identity reference photo, photorealistic.
```

### Etapa 5 · `ref_rosto_34_dir.png` · 3:4

**Entradas:** foto de rosto + A0_camera.png · **Para quê:** Mantém o rosto quando ela olha para o chat (direita do quadro).

```text
Same woman as the references, identical face and features: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup. Same hair, jewelry, outfit and lighting. Three-quarter view, head turned about 40 degrees to HER RIGHT, soft smile. Identity reference photo, photorealistic.
```

### Etapa 6 · `ref_expressoes.png` · 1:1

**Entradas:** ref_rosto_frente.png + ref_rosto_34_esq.png · **Para quê:** Sorriso, riso e timidez iguais em todas as reações.

```text
A 3x3 grid expression sheet of the exact same woman in every panel — identical face, hair, makeup, jewelry and outfit, chest-up crop, same lighting, same blurred background, thin white gutters, no text.
1 neutral calm · 2 soft closed-mouth smile · 3 big genuine smile with teeth · 4 laughing with eyes squinting · 5 pleasantly surprised, lips parted · 6 shy smile looking down · 7 blowing a kiss, fingertips at her lips · 8 playful eye-roll with a smirk · 9 thoughtful, finger on chin.
Expressions in her own style: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural. Natural and believable, not cartoonish. Photorealistic.
```

### Etapa 7 · `ref_pet.png` · 1:1

**Entradas:** cenario_vazio.png · **Para quê:** O pet aparece em beats raros e está no prompt da personalidade: o que se vê bate com o que ela diz.

```text
A small fluffy white pomeranian resting calmly in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, same warm night lighting, full body visible. Photorealistic pet reference.
```

### Etapa 8 · `A0_brinde.png` · 9:16

**Entradas:** A0_camera.png · **Para quê:** Opcional: pose do brinde (vídeo 103).

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change: she raises a pastel iced coffee cup with a straw into frame at chest height toward the camera in a toast, warm smile at the lens. Photorealistic, same grain and color grading.
```

### Etapa 9 · `capa_live_1x1.png` · 1:1

**Entradas:** A0_camera.png + ref_rosto_frente.png · **Para quê:** Divulgação (Instagram vinculado ao Tango).

```text
Promotional cover photo for a live stream, the same adult woman as the references with identical face, hair, makeup, outfit and jewelry: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Warm inviting expression looking into the lens, a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights softly out of focus behind her. Warm 3000K key light, pink and lilac accents in the background. Clean composition with empty space at the top for a title to be added later. Photorealistic, natural skin texture, no text, no logos.
```

### Etapa 9 · `capa_live_9x16.png` · 9:16

**Entradas:** A0_camera.png + ref_rosto_frente.png · **Para quê:** Divulgação em formato de story.

```text
Vertical promotional cover photo for a live stream, the same adult woman as the references with identical face, hair, makeup, outfit and jewelry: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Warm inviting expression looking into the lens, a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights softly out of focus behind her. Warm 3000K key light, pink and lilac accents in the background. Clean composition with empty space at the bottom third for a title to be added later. Photorealistic, natural skin texture, no text, no logos.
```

### Etapa 10 · `overlay_cartela_segmento.png` · 9:16 (PNG transparente)

**Entradas:** nenhuma · **Para quê:** Cartela que aparece no OBS ao mudar de bloco (F1–F5).

```text
Minimal transparent-background overlay graphic for a vertical 9:16 live stream: a segment title card. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette soft pink, lilac and coral. Leave clear empty space where text will be added in OBS. No text, no letters, no logos, PNG with transparency.
```

### Etapa 10 · `overlay_top_fan.png` · 9:16 (PNG transparente)

**Entradas:** nenhuma · **Para quê:** Moldura "Top fã da noite" (formato F4).

```text
Minimal transparent-background overlay graphic for a vertical 9:16 live stream: a "top fan of the night" name frame with a subtle crown motif. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette soft pink, lilac and coral. Leave clear empty space where the name will be added in OBS. No text, no letters, no logos, PNG with transparency.
```

## Parte 2 — Vídeos (image-to-video, primeiro + último frame)

Modelos com first + last frame: Kling (start/end frame), Veo 3.1, Seedance, Wan FLF2V.
Saída: 9:16, 24 fps, **sem áudio**. Personagem salvo, se o modelo aceitar: `ref_rosto_frente`,
`ref_rosto_34_esq`, `ref_rosto_34_dir` e `A0_camera`.

**Prompt negativo (igual para todos os clipes):**

```text
camera movement, zoom, pan, dolly, cut, scene change, morphing face, different person, changing hairstyle, changing outfit, missing jewelry, extra fingers, deformed hands, hands lingering in frame, extra people, new objects, flickering light, exposure change, text, subtitles, watermark, logo, exaggerated cartoon expressions, fast motion
```

Lotes: **0** = teste (5 clipes, faça primeiro) · **1** = mínimo para ir ao ar · **2** = variedade.

### Lote 0 — 5 clipes

#### `40_FLUXO_A0_respira_piscar.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Almost still: slow calm breathing visible in the shoulders, two natural blinks, the smile softens and returns.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `45_FLUXO_A0_espia_chat.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She glances quickly toward the monitor on the right side of the frame, reads for a second, and looks back at the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `52_TRANSICAO_A0-A1_vira_chat.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A1_chat.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She turns her head toward the monitor on the right side of the frame to read the chat.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame — and ends on exactly the pose of the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `53_TRANSICAO_A1-A0_volta_camera.mp4`

Transição · **1º frame:** `A1_chat.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She turns her head from the monitor back to the lens with a soft smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame — and ends on exactly the pose of the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `74_GATILHO_A0_beijo.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente pequeno

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She smiles, brings her fingertips up to her lips and blows a soft kiss to the camera, then the hand lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

### Lote 1 — 29 clipes

#### `41_FLUXO_A0_inclina_cabeca.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She slowly tilts her head a little to one side with a warm look, holds for a moment, and returns upright.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `42_FLUXO_A0_cabelo.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: One hand rises into frame and tucks a strand of hair behind her ear, then lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `43_FLUXO_A0_olha_baixo.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Her eyes drop briefly toward the desk below as if checking something, then rise back to the lens with a small smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `44_FLUXO_A0_sorriso_cresce.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Her closed-mouth smile slowly widens into a soft smile showing a hint of teeth, then relaxes back.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `54_TRANSICAO_A0-A2_encosta.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A2_relaxada.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She leans back comfortably into the chair and relaxes her shoulders.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame — and ends on exactly the pose of the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `55_TRANSICAO_A2-A0_volta.mp4`

Transição · **1º frame:** `A2_relaxada.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She sits up from the backrest toward the camera, smiling at the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame — and ends on exactly the pose of the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `56_TRANSICAO_A0-A3_aproxima.mp4`

Transição · **1º frame:** `A0_camera.png` · **último frame:** `A3_perto.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She leans forward toward the camera and rests her forearms on the desk, hands coming together at the bottom edge.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame — and ends on exactly the pose of the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `57_TRANSICAO_A3-A0_recua.mp4`

Transição · **1º frame:** `A3_perto.png` · **último frame:** `A0_camera.png` · **duração:** 2–3 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She sits back from the desk, hands lowering out of frame, soft smile to the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

TRANSITION RULES: Starts on the start frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile — and ends on exactly the pose of the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `58_FLUXO_A1_lendo.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Reading the screen: eyes move along lines of text, occasional blink, calm attention.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `59_FLUXO_A1_ri_do_chat.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She reads something funny and laughs softly, shoulders shaking lightly, then settles back to reading.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `60_FLUXO_A1_digita.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She types a short reply below the frame — shoulders and arms move subtly as she types — still looking at the screen.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `64_FLUXO_A2_respira.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_relaxada.png` · **último frame:** `A2_relaxada.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Resting calmly: slow breathing, relaxed blinks, peaceful half-smile at the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `65_FLUXO_A2_olha_longe.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_relaxada.png` · **último frame:** `A2_relaxada.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She looks dreamily off to the left for a few seconds, then back to the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `69_FLUXO_A3_fala_calma.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She talks calmly to the camera as if chatting with a friend, lips moving naturally in conversation, small head movements, warm eyes. Silent.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `70_FLUXO_A3_fala_animada.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She talks to the camera animatedly, lively expressions, small hand gestures near the bottom edge, a short laugh mid-sentence. Silent.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `73_GATILHO_A0_aceno_oi.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: follow

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She notices someone new, brightens, and one hand rises into frame for a small friendly wave, then lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `75_GATILHO_A0_coracao_maos.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente pequeno

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Both hands rise into frame and form a heart shape in front of her chest, warm smile, then lower out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `76_GATILHO_A0_obrigada.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente médio

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Grateful: both hands come together near her chin, a small bow of the head with a big smile, then lower out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `77_GATILHO_A0_surpresa_grande.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente grande

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Delighted surprise: eyes widen, both hands rise to cover her mouth, she laughs behind them, then lowers them out of frame smiling.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `78_GATILHO_A0_risada.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: msg engraçada

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She bursts into a genuine laugh, eyes squinting, head tipping slightly back, then settles into a smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `86_GATILHO_A1_ve_presente.mp4`

Gatilho (reação) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 5–8 s · evento: presente

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She sees something on the screen, her eyes light up, she gasps with a big smile and does a quick excited shoulder wiggle, then goes back to reading.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `89_ESPECIAL_A0_bebe.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She lifts a pastel iced coffee cup with a straw into frame, takes a small sip, and lowers it out of frame again.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `94_ESPECIAL_A0_tchau.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Saying goodbye: she smiles, one hand rises to wave, then blows a final kiss to the camera and lowers the hand.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `95_SEGMENTO_A0_abertura.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F1

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She settles into the chair as if just arriving, looks into the lens with a bright smile, one hand rises for a small "hello, I'm here" wave, then lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `96_SEGMENTO_A3_anuncia_meta.mp4`

Segmento (formato de live) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 6–9 s · evento: F1

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Leaning toward the camera, she talks excitedly as if announcing tonight's goal, then points down toward the bottom of the frame with one finger, eyebrows raised, inviting. Silent.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `97_SEGMENTO_A0_meta_batida.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F1

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Goal reached: she gasps, both hands fly up into frame in celebration, she laughs and claps quickly, beaming at the lens, then lowers her hands out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `98_SEGMENTO_A3_dedicatoria_top_fan.mp4`

Segmento (formato de live) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 6–9 s · evento: F4

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Leaning in, she places one hand over her heart, looks deeply into the lens with a grateful smile, and gives a small slow nod, as if dedicating the moment to someone special.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `99_SEGMENTO_A1_le_pergunta.mp4`

Segmento (formato de live) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 6–9 s · evento: F3

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Reading carefully from the monitor, her eyes follow a longer message line by line, her expression shifts to curious interest, then she gives a small thoughtful nod.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `104_SEGMENTO_A0_agradece_encerra.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F1

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: End of the live: she smiles gratefully, both hands rise to form a heart in front of her chest, she mouths "thank you" to the camera, then lowers her hands out of frame. Silent.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

### Lote 2 — 31 clipes

#### `46_FLUXO_A0_ajusta_postura.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She straightens her posture, rolling her shoulders slightly back, and settles comfortably.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `47_FLUXO_A0_suspiro.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A calm, content sigh: shoulders rise and fall softly, eyes close for a second and reopen toward the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `48_FLUXO_A0_acessorio.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: One hand rises into frame and lightly touches her necklace or earring, then lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `49_FLUXO_A0_balanca_musica.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She sways very gently side to side as if enjoying soft background music, a relaxed small smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `50_FLUXO_A0_olha_longe.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Her gaze drifts dreamily off to the left for a few seconds, then returns to the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `51_FLUXO_A0_labios.mp4`

Fluxo (micro-idle) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She presses her lips together softly and relaxes them, a subtle playful look into the lens.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `61_FLUXO_A1_assente.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She nods slowly in agreement with what she reads, a small smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `62_FLUXO_A1_sobrancelha.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She raises one eyebrow with an amused, curious look at the screen, then relaxes.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `63_FLUXO_A1_morde_labio.mp4`

Fluxo (micro-idle) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Concentrated on the screen, she lightly bites her lower lip while reading, then relaxes.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `66_FLUXO_A2_gira_cadeira.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_relaxada.png` · **último frame:** `A2_relaxada.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She swivels the chair very slightly side to side, relaxed and playful, then settles back.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `67_FLUXO_A2_ponta_cabelo.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_relaxada.png` · **último frame:** `A2_relaxada.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: One hand rises into frame and plays idly with the ends of her hair, then lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `68_FLUXO_A2_espreguica_pescoco.mp4`

Fluxo (micro-idle) · **1º frame:** `A2_relaxada.png` · **último frame:** `A2_relaxada.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A small lazy stretch of the neck and shoulders, eyes closing for a moment, content smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning back slightly in the chair, calm half-smile at the lens, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `71_FLUXO_A3_escuta.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s · 🔁 pode tocar invertido

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She listens attentively, nodding slightly, soft smile, as if hearing someone's story.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `72_FLUXO_A3_queixo_mao.mp4`

Fluxo (micro-idle) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 4–5 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She rests her chin on one hand, gazing into the lens with a fond smile, then brings the hand back to the other.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `79_GATILHO_A0_piscadinha.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente pequeno

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A playful wink at the camera with a small smile.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `80_GATILHO_A0_aplauso.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: meta

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Her hands rise into frame and clap quickly and happily a few times near her chest, beaming, then lower out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `81_GATILHO_A0_timida.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: elogio

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Flattered and shy: she looks down, smiles, and briefly hides part of her smile with her fingertips, then lowers the hand.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `82_GATILHO_A0_pensativa.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: pergunta

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Thoughtful: a finger rests on her chin, eyes looking up as she thinks, then she smiles as if she found the answer and lowers the hand.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `83_GATILHO_A0_nao_nao.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: provocação

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Playful teasing: her index finger rises into frame and wags side to side as a "no-no", mischievous smile, then lowers.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `84_GATILHO_A0_revira_olhos.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: provocação

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A playful, amused eye-roll followed by a laugh.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `85_GATILHO_A0_danca_cadeira.mp4`

Gatilho (reação) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 5–8 s · evento: presente grande

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Celebration: she dances happily in the chair, shoulders bouncing and head bopping to a beat for a few seconds, then settles.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `87_GATILHO_A1_ve_seguidor.mp4`

Gatilho (reação) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 5–8 s · evento: follow

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She notices a name on the screen, smiles, and a hand rises for a tiny wave toward the monitor, then lowers; she keeps reading.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `88_GATILHO_A1_gargalhada.mp4`

Gatilho (reação) · **1º frame:** `A1_chat.png` · **último frame:** `A1_chat.png` · **duração:** 5–8 s · evento: msg engraçada

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She reads something hilarious and laughs out loud, covering her mouth with a hand, then lowers it and settles back to reading.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `90_ESPECIAL_A0_alonga.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She stretches both arms up over her head (arms leave the top of the frame), arches slightly, then relaxes back to the pose.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `91_ESPECIAL_A0_bocejo.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A small polite yawn hidden behind her hand, followed by an embarrassed little laugh.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `92_ESPECIAL_A0_cabelo_dedos.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She runs her fingers through her hair toward the back, then lets it settle exactly as before.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `93_ESPECIAL_A0_pet.mp4`

Especial (beat raro) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 8–10 s

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: A small fluffy white pomeranian pops up into the frame from below, she smiles and gently pets it for a moment, then it hops back down out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `100_SEGMENTO_A3_responde_pensando.mp4`

Segmento (formato de live) · **1º frame:** `A3_perto.png` · **último frame:** `A3_perto.png` · **duração:** 6–9 s · evento: F3

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She tilts her head, thinks for a moment with her eyes up, then starts answering the camera with calm, thoughtful expressions and small hand gestures near the bottom edge. Silent.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `101_SEGMENTO_A0_voce_escolhe.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F4

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Playful: she points toward the camera with one finger as if saying "you choose", raises her eyebrows with a mischievous smile, then lowers the hand out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `102_SEGMENTO_A0_contagem.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F1

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: Excited countdown: one hand rises into frame showing three fingers, then two, then one, her smile growing with each number, then the hand lowers out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

#### `103_SEGMENTO_A0_brinde.mp4`

Segmento (formato de live) · **1º frame:** `A0_camera.png` · **último frame:** `A0_camera.png` · **duração:** 6–9 s · evento: F4/F5

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup, wearing a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin gold chain necklace with a tiny heart pendant. Live streaming at night in a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, and warm fairy lights, background softly out of focus. a white podcast microphone on a short arm with a colorful foam windscreen stays in the lower right corner. Warm 3000K key light, pink and lilac accents in the background, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: She lifts a pastel iced coffee cup with a straw into frame and raises it toward the camera in a toast, takes a small sip with a warm smile, and lowers it out of frame.

STYLE: Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural.

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

## Parte 3 — Conferir cada clipe

```bash
python scripts/check_idle_anchor.py --anchor assets/idle-kit/barbara/A0_camera.png assets/videos/barbara/<arquivo>.mp4
```

Precisa dar `ok/ok`. Transição: rode com a âncora de início e depois com a de fim.
Olhar também: rosto igual ao `ref_rosto_frente`, joias presentes, microfone no canto, mãos entram e saem.
