# Assets da IDLE por persona — prompts

Este guia replica **só o formato** dos vídeos atuais. Rosto, roupa, cenário e
jeito de se mexer são **de cada persona**: nada é copiado dos vídeos antigos
nem usado como referência de imagem.

Formato, arquitetura e lista de vídeos: [IDLE-PRODUCAO.md](IDLE-PRODUCAO.md).

---

## 0. O que é "o formato"

| Elemento | Regra do formato | É da persona |
|---|---|---|
| Tela | vertical 9:16, câmera travada, sem cortes | — |
| Enquadramento | **busto** (ver 0.1) | — |
| Situação | streamer ao vivo, de noite, sentada à mesa, falando com quem assiste | — |
| Sinais de "live" | microfone de streaming entrando por um canto de baixo; brilho frio de monitor fora do quadro num lado do rosto | modelo e cor do microfone |
| Monitor/chat | fora do quadro, à **direita do quadro** — olhar para lá = "lendo o chat" | — |
| Fundo | cômodo da persona, desfocado (bokeh), 2–3 luzes práticas reconhecíveis | tudo: estilo, cores, objetos |
| Luz | luz principal suave e quente + brilho frio do monitor + fundo mais escuro | temperatura e cor de destaque |
| Pose-base | olhando para a lente, expressão neutra-simpática, mãos fora do quadro | expressão típica |
| Rosto, cabelo, roupa, joias | — | tudo |
| Jeito de se mexer | movimentos sutis e curtos | intensidade e estilo (ficha) |

### 0.1 Enquadramento de busto (novo padrão)

- Topo da cabeça a ~6–8% do topo do quadro (pouco respiro).
- **Olhos a ~1/3 da altura** do quadro.
- Corte embaixo **na linha do busto / meio do peito**.
- Ombros ocupando ~70–80% da largura.
- Câmera na altura dos olhos ou levemente acima (~10°), lente ~50–65 mm, fundo bem desfocado.
- **Mãos fora do quadro em repouso** (apoiadas na mesa, abaixo do corte). Nos gestos
  (beijo, coração, aceno, cabelo) elas **sobem para dentro do quadro e saem de novo**.

Vantagens para a IDLE: expressões leem melhor no celular, o fundo desfocado
varia menos entre clipes, e mãos em repouso fora do quadro eliminam a maior
fonte de erros (dedos deformados, mão "pulando" entre clipes).

Para comparar, a etapa 3 gera também uma versão **close** (ombros para cima).

---

## 1. Ficha da persona (preencher antes de gerar)

Copie o bloco, preencha em inglês e salve em `assets/idle-kit/<persona>/ficha.md`.
Os prompts abaixo usam os campos entre `{chaves}`.

```text
{IDENTITY}   rosto e cabelo, descritos a partir da foto de rosto da persona:
             idade aparente, formato do rosto, olhos, sobrancelhas, pele, marcas (sardas, pintas),
             cabelo (cor, comprimento, corte, como está arrumado), maquiagem.
{WARDROBE}   roupa da parte de cima (é o que aparece no busto) + joias/acessórios.
{ROOM}       cômodo ao fundo: estilo, cores, 2–3 luzes práticas, 1–2 objetos marcantes.
{LIGHT}      temperatura da luz principal + cor de destaque do cômodo.
{MIC}        microfone: modelo/formato, cor, detalhe próprio.
{MOTION}     estilo de movimento (ver sugestões) — entra no fim de todo prompt de vídeo.
{DRINK}      o que ela bebe no clipe especial (caneca, taça, lata...).
{PET}        (opcional) pet que aparece em clipes raros.
```

### Sugestões iniciais para as personas atuais

Pontos de partida coerentes com a personalidade de cada uma — edite à vontade.
`{IDENTITY}` sempre vem da foto de rosto de cada uma.

**Barbara** — extrovertida, animada, próxima do público

```text
{WARDROBE} cropped cardigan in bright coral knit over a white fitted tank top, small gold hoop earrings, a thin gold chain with a tiny star pendant
{ROOM}     playful bedroom-studio: pastel lilac wall with a round neon sign glowing soft pink, shelves with plushies and small plants, warm fairy lights
{LIGHT}    warm 3000K key light, pink and lilac accents in the background
{MIC}      white podcast microphone on a short arm with a colorful foam windscreen
{MOTION}   energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural
{DRINK}    a pastel iced coffee cup with a straw
{PET}      a small fluffy white pomeranian
```

**Viktoria** — elegante, misteriosa, sofisticada

```text
{WARDROBE} black satin blouse with a deep elegant neckline, a single thin silver necklace with a small dark stone, small diamond studs
{ROOM}     dark moody apartment: deep green velvet walls, brass wall sconce, a bookshelf with old books, a single candle, city lights far in the window
{LIGHT}    low warm 2400K key light from the side, strong shadows, emerald and amber accents
{MIC}      matte black broadcast microphone on a boom arm with brass details
{MOTION}   slow, composed and subtle: half-smiles, lingering glances, a raised eyebrow; never rushed, never exaggerated
{DRINK}    a glass of red wine
{PET}      a sleek black cat
```

**Odessa** — carinhosa, bem-humorada, atenciosa

```text
{WARDROBE} soft oversized cream knit sweater slightly off one shoulder, delicate gold necklace, small pearl earrings
{ROOM}     cozy modern living room at night: warm wood shelves, a paper lantern lamp, a leafy plant, soft amber string lights, a big window with city bokeh
{LIGHT}    warm 2700K key light, amber accents, cool monitor glow on the right
{MIC}      compact silver microphone with a matte finish on a desk arm
{MOTION}   warm and gentle: soft smiles, attentive nods, relaxed natural rhythm
{DRINK}    a ceramic mug of tea
{PET}      a fluffy orange tabby cat
```

---

## 2. Regras gerais

- **Ferramenta:** modelo de imagem com referência (Nano Banana / Gemini Image, Seedream 4,
  Flux Kontext, GPT-Image). A **única** referência de identidade é a foto de rosto da persona.
- **Nunca** usar frames dos vídeos antigos como referência.
- **Proporção:** 9:16 para cenas; 3:4 ou 1:1 para folhas de referência.
- **Pasta:** `assets/idle-kit/<persona>/` com os nomes indicados.
- Gere 3–4 variações de cada e escolha a mais **fiel ao rosto**, não a mais bonita.
- **Regerar se:** rosto diferente da foto, mãos visíveis na pose-base, fundo nítido
  demais, microfone fora do canto, luz diferente da ficha.

---

## 3. Etapas

### Etapa 1 — Cenário vazio · `cenario_vazio.png` · 9:16

Sem pessoa. Serve de base para a âncora e para checar se o fundo se mantém.

```text
Vertical 9:16 photo of an empty live-streaming seat at night, shot from eye level with a 55mm lens at f/2. {ROOM}. The background is softly out of focus with the practical lights turned into gentle bokeh. In the foreground, the empty backrest of a chair, and {MIC} entering the frame from the lower right corner, partly cropped. A soft cool glow from an off-screen monitor on the right. {LIGHT}. Photorealistic, natural film grain, no people, no text.
```

### Etapa 2 — Figurino · `figurino.png` · 3:4

```text
Flat-lay product photo of this outfit, no person: {WARDROBE}. Arranged neatly on a neutral linen surface, soft even light, true colors, fabric texture and details clearly visible. Wardrobe reference, photorealistic.
```

### Etapa 3 — Âncora A0 (câmera) · `A0_camera.png` · 9:16 ⭐ o asset mais importante

**Entradas:** foto de rosto da persona + `cenario_vazio.png` + `figurino.png`

```text
Vertical 9:16 chest-up portrait of the woman from the face reference, live streaming at night, seated in the chair from the scene reference, in exactly that room and light. Identity must match the face reference exactly: {IDENTITY}. She wears {WARDROBE}.

Framing: small headroom above her head, eyes at one third from the top, frame cut at mid-chest, shoulders filling most of the width, camera at eye level, 55mm lens at f/2, background softly out of focus. {MIC} enters from the lower right corner, partly cropped. Soft cool glow from an off-screen monitor on the right side of her face. {LIGHT}.

Pose: shoulders square to the camera, looking straight into the lens, relaxed friendly expression with a soft closed-mouth smile. Both hands are out of frame, resting on the desk below. Photorealistic, natural skin texture, gentle film grain, no text.
```

**Teste de enquadramento** · `A0_camera_close.png` — mesmo prompt, trocando o parágrafo *Framing* por:

```text
Framing: close shoulders-up portrait, eyes at one third from the top, frame cut just below the collarbones, face filling about half of the frame height, camera at eye level, 65mm lens at f/1.8, background softly out of focus. {MIC} barely visible in the lower right corner.
```

Coloque as duas no palco do app (fit *contain*, 9:16) e decida antes de seguir.
Depois, todas as etapas seguintes usam a versão escolhida como `A0_camera.png`.

### Etapa 4 — Âncoras de estado · entrada: `A0_camera.png` · 9:16

Mesma abertura em todas:

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change her pose as described. Photorealistic, same grain and color grading.
```

Complementos:

**A1 lendo o chat** · `A1_chat.png`
```text
She turns her head about 30 degrees toward the right side of the frame, eyes reading an off-screen monitor, attentive relaxed expression with the faintest smile. The cool monitor glow now falls more on her face. Hands stay out of frame.
```

**A2 relaxada** · `A2_relaxada.png`
```text
She leans back a little into the chair, so she sits slightly further from the camera, head tilted gently, calm content half-smile, eyes softly on the lens. Hands stay out of frame.
```

**A3 perto** · `A3_perto.png`
```text
She leans forward toward the camera with her forearms resting on the desk, face a little closer to the lens, warm engaged smile, looking directly into the camera. Her hands, loosely together, are just visible at the bottom edge of the frame.
```

✅ Conferir: fundo e microfone parados; em A0, A1 e A2 nenhuma mão aparece.
Se o fundo mudar, me mande: eu recolo o fundo da A0 e mantenho só a pessoa.

### Etapa 5 — Referências de identidade · 3:4

**Entradas:** foto de rosto + `A0_camera.png`

`ref_rosto_frente.png`
```text
Close-up head-and-shoulders portrait of the same woman as the references, identical face and features: {IDENTITY}. Same hair, makeup, jewelry and outfit ({WARDROBE}). Facing the camera, neutral soft smile, same light as the A0 image, background softly blurred. Identity reference photo, photorealistic, sharp focus on the eyes, natural skin texture, no retouching.
```

`ref_rosto_34_esq.png` / `ref_rosto_34_dir.png`
```text
Same woman as the references, identical face and features, same hair, jewelry, outfit and lighting. Three-quarter view, head turned about 40 degrees to HER LEFT, soft smile. Identity reference photo, photorealistic.
```
(Para a outra, trocar `HER LEFT` por `HER RIGHT`.)

### Etapa 6 — Folha de expressões · `ref_expressoes.png` · 1:1

**Entradas:** `ref_rosto_frente.png` + `ref_rosto_34_esq.png`

```text
A 3x3 grid expression sheet of the exact same woman in every panel — identical face, hair, makeup, jewelry and outfit, chest-up crop, same lighting, same blurred background, thin white gutters, no text.
1 neutral calm · 2 soft closed-mouth smile · 3 big genuine smile with teeth · 4 laughing with eyes squinting · 5 pleasantly surprised, lips parted · 6 shy smile looking down · 7 blowing a kiss, fingertips at her lips · 8 playful eye-roll with a smirk · 9 thoughtful, finger on chin.
Expressions in her own style: {MOTION}. Natural and believable, not cartoonish. Photorealistic.
```

### Etapa 7 (opcional) — Pet da persona · `ref_pet.png` · 1:1

Um pet que aparece em clipes raros é o que mais quebra a sensação de loop.

```text
A {PET} resting calmly in {ROOM}, same warm night lighting, full body visible. Photorealistic pet reference.
```

---

## 4. Kit final por persona

```
assets/idle-kit/<persona>/
├── ficha.md
├── cenario_vazio.png       etapa 1
├── figurino.png            etapa 2
├── A0_camera.png           etapa 3  ⭐
├── A0_camera_close.png     etapa 3  (teste)
├── A1_chat.png             etapa 4
├── A2_relaxada.png         etapa 4
├── A3_perto.png            etapa 4
├── ref_rosto_frente.png    etapa 5
├── ref_rosto_34_esq.png    etapa 5
├── ref_rosto_34_dir.png    etapa 5
├── ref_expressoes.png      etapa 6
└── ref_pet.png             etapa 7 (opcional)
```

Se o modelo de vídeo aceitar **personagem salvo** (Kling Elements, Higgsfield Soul etc.),
crie o personagem com `ref_rosto_frente`, `ref_rosto_34_esq`, `ref_rosto_34_dir` e `A0_camera`.

Comece por **uma** persona, valide o enquadramento e o lote 1, e só então replique para as outras.
