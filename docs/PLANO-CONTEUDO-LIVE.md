# Plano de conteúdo da live — formatos, imagens, vídeos e prompts

Planejamento para produzir os próximos conteúdos de **qualquer persona** (hoje: Viktoria e
Barbara) no Tango, **sem games**: só a persona, o público, conversa e interação.
Ele está resumido no **mural** do Odessa (Configurações → Mural), e este documento é a versão
completa, com todos os prompts.

Documentos que este plano estende (não repete):
- [IDLE-PRODUCAO.md](IDLE-PRODUCAO.md): arquitetura da IDLE (âncoras A0–A3, energia, beats) e os clipes 40–94.
- [IDLE-ASSETS-PROMPTS.md](IDLE-ASSETS-PROMPTS.md): ficha da persona e kit de imagens (etapas 1–7).
- [PERSONAS-PROMPTS.md](PERSONAS-PROMPTS.md): personalidade (texto) de cada persona.

---

## 1. O que a pesquisa diz

| # | Achado | Fonte | O que muda para nós |
|---|---|---|---|
| 1 | Lives com **tema e meta** superam o "papo aberto" em engajamento **e** em presentes. Exemplos do próprio Tango: "Karaoke night", "Let's hit 10,000 diamonds", "Top gifter picks the next topic". | [Tango Blog — Monetization 101](https://www.tango.me/blog/it-takes-you-to-tango/live-streaming-monetization-101) | Toda live tem nome + meta coletiva visível. |
| 2 | Metas concretas ("vamos bater 500 diamantes") funcionam melhor que pedido vago de apoio. | idem | A meta vira barra no overlay (LivePix) + vídeos de anúncio e comemoração. |
| 3 | **Agradecer pelo nome, na hora**, faz outros presentearem: quem vê o agradecimento entende que presente gera reconhecimento real. | idem | Reação de presente + fala da IA com o nome (já existe) + vídeo de agradecimento por faixa de presente. |
| 4 | **Top Fans** (ranking) cria competição amigável e presente recorrente. | idem | Segmento "o top fã escolhe" + vídeo de dedicatória. |
| 5 | Transmitir **todo dia, ≥ 1 h**; bater a própria média de duração dá **+10%, +15%, +20%** de diamantes. Cumprimentar quem entra, perguntar, lembrar de quem presenteou. | [Tango Help — How to become a popular broadcaster](https://help.tango.me/en/articles/2985208-how-to-become-a-popular-broadcaster) | Lives longas: a IDLE precisa aguentar horas sem parecer loop (define a quantidade de vídeos, seção 6). |
| 6 | 3+ lives por semana em horário fixo; quem volta presenteia mais que quem é novo; ganhos estabilizam em 4–8 semanas. | Tango Blog (idem) | Agenda fixa e ritual de abertura/encerramento reconhecível. |
| 7 | O que mais pesa na intenção de presentear: **atratividade** do streamer, **"expertise"** (algo que ele faz bem), **interação parassocial** (a pessoa se sentir vista) e **status** de quem presenteia. | [PLOS One 2024 — Gift-giving intentions in live streaming](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0296908) | Imagem bem cuidada (seção 4), um "assunto que ela domina" por persona, reconhecimento público de quem presenteia. |
| 8 | **Relação parassocial** é o motor do presente. | [ScienceDirect 2025](https://www.sciencedirect.com/science/article/abs/pii/S0969698925002152), [ResearchGate 2024](https://www.researchgate.net/publication/385985803_The_role_of_para-social_relationship_in_live_streaming_virtual_gift_purchase_a_two-stage_SEM-neural_network_analysis) | Olhar na lente, falar com a pessoa pelo nome, lembrar dela (memória de chat). |
| 9 | Streamer de IA: fãs se prendem a **personalidade consistente** e se atraem por **momentos imprevisíveis**. Frustra: resposta genérica, personalidade que muda, não lembrar de ninguém, conteúdo repetitivo. | [arXiv 2025 — AI VTuber fandom](https://arxiv.org/pdf/2509.10427) | Base previsível (âncoras) + beats raros e surpresas; "falhas de identidade" quebram a imersão. |
| 10 | Público do Tango: maioria **masculina**, 25–34 anos; EUA, Brasil e Filipinas no topo. **5–7% dos usuários geram > 70% da receita.** | [Similarweb](https://www.similarweb.com/website/tango.me/), [CanvasBusinessModel](https://canvasbusinessmodel.com/blogs/target-market/tangome-target-market) | Tratar o "top fã" como VIP; português e inglês (a IA já responde no idioma da pessoa). |
| 11 | Formatos nativos do Tango: **Battle** (duas lives disputam presentes) e **Party** (até 3 convidados). | [Tango (Google Play)](https://play.google.com/store/apps/details?id=com.sgiggle.production), Tango Blog | Ficam para depois: exigem outra pessoa ao vivo (seção 9). |

> Números de audiência vêm de ferramentas de terceiros e são estimativas. As regras de bônus (+10–20%) são do Help Center do Tango e podem mudar.

---

## 2. Formatos de live que vamos usar

Todos funcionam só com persona + chat. Cada um diz **o que a persona faz**, **quais vídeos usa**
(seção 5) e **como o Odessa aciona**.

### F1 · Live com tema e meta (base de toda live) — achados 1, 2, 6

- **Nome da live** fixo por dia da semana (ritual). Ex.: Viktoria → "Noite do Vinho"; Barbara → "Resenha da Babi".
- **Meta coletiva** visível na barra do LivePix: "meta: 500 diamantes = brinde ao vivo".
- Vídeos: `95` abertura, `96` anuncia a meta, `102` contagem regressiva, `97` meta batida.
- Odessa: a meta batida dispara o gatilho `meta`; a IA recebe o tema no prompt (seção 7).

### F2 · Ritual de boas-vindas e gratidão nominal — achados 3, 5, 8

- Quem entra: aceno. Quem presenteia: agradecimento **pelo nome**, proporcional ao presente.
- Vídeos: `73`/`87` aceno; `74`/`75`/`79` presente pequeno; `76` médio; `77`/`85` grande.
- Odessa: gatilhos por presente (já existem) + resposta da IA com o nome + memória de quem já presenteou.

### F3 · Pergunte à persona (Q&A) — achados 1, 7

- Janela de perguntas: "manda sua pergunta; pergunta com rosa vai pra frente".
- Vídeos: `99` lê a pergunta, `100` responde pensando, `82` pensativa.
- Odessa: palavra-chave "pergunta"/"?" → estado A1/A3; a IA responde com base na ficha dela (é aqui que ela mostra "expertise": vinho e livros na Viktoria, reality e música na Barbara).

### F4 · O top fã escolhe — achados 4, 7, 10

- Quem está no topo do Top Fans escolhe o próximo assunto, a música ambiente ou a "dedicatória".
- Vídeos: `98` dedicatória ao top fã, `101` "você escolhe", `103` brinde.
- Odessa: comando do operador ou presente grande → vídeo `98` + fala da IA citando o nome.

### F5 · Confessionário / resenha (bloco de conversa) — achados 8, 9

- Conversa mais íntima e calma, no fim da live ou em horário tardio. Viktoria: "confissões com vinho"; Barbara: "fofoca do BBB".
- Vídeos: estado A2 (relaxada) e A3 (perto), `72` queixo na mão, beats `89` bebida e `93` pet.
- Odessa: chat lento → A2; menção/pergunta → A3.

### Roteiro de uma live de 60–90 min

| Tempo | Bloco | Estado / vídeos |
|---|---|---|
| 0–3 min | Abertura: "cheguei!", tema da noite | `95` → A0 |
| 3–5 | Anuncia a meta | `96` (A3) |
| 5–25 | Conversa livre + boas-vindas + gratidão (F2) | A0 ⇄ A1, gatilhos |
| 25–40 | Pergunte à persona (F3) | `99` / `100`, A1 ⇄ A3 |
| 40–50 | O top fã escolhe (F4) | `98`, `101`, `103` |
| 50–75 | Confessionário (F5) | A2 ⇄ A3, beats raros |
| perto da meta | Contagem e comemoração | `102` → `97` |
| fim | Agradece e tchau | `104` → `94` |

---

## 3. Referências usadas e por quê

| Referência | Usada em | Por quê |
|---|---|---|
| **Foto de rosto da persona** (única referência de identidade) | todas as imagens | A consistência da persona é o que mantém o fã (achado 9). Rosto que muda é "quebra de identidade". |
| **`A0_camera.png`** (âncora) | primeiro **e** último frame dos vídeos | Clipe que começa e termina na mesma pose encaixa com qualquer outro: a IDLE nunca "pula". |
| `A1`/`A2`/`A3` | âncoras dos outros estados | Mudar de estado conforme o chat é o que faz parecer que ela está reagindo, e não num loop. |
| `cenario_vazio.png` | base da A0 | Fundo idêntico em todos os clipes; conferir se o fundo "mexeu". |
| `figurino.png` | A0 e referências | Roupa e joias iguais em todos os clipes (joia que some é erro clássico). |
| `ref_rosto_frente` / `34_esq` / `34_dir` | "personagem salvo" nos geradores de vídeo | Mantém o rosto quando ela vira a cabeça (lendo o chat). |
| `ref_expressoes.png` | reações | Garante que o sorriso, o riso e a timidez sejam **dela**, iguais em todos os gatilhos. |
| `ref_pet.png` | beat raro do pet | O pet aparece no vídeo **e** está no prompt de personalidade: o que se vê bate com o que ela diz. |
| **Nenhuma** imagem de vídeos antigos nem de streamers reais | — | Replicamos só o **formato**. Copiar pessoa ou roupa de outra streamer é problema de direito de imagem e de identidade. O "clima" vem descrito em texto (`{ROOM}`, `{LIGHT}`). |

---

## 4. Por que essas imagens funcionam

1. **Busto na vertical (9:16):** o Tango é celular; rosto grande = emoção legível, que é onde a interação parassocial acontece (achados 7, 8).
2. **Olhar na lente na pose-base:** é o "falar com você". A pessoa se sente vista (achado 8).
3. **Luz quente + brilho frio do monitor à direita:** sinaliza "casa, à noite, ao vivo". Quando ela olha para a direita, o público entende que está lendo o chat.
4. **Fundo pessoal e desfocado (pet, bebida, objetos):** gera assunto ("que gata linda!") e o prompt da persona sabe responder. Desfocado também varia menos entre clipes.
5. **Mãos fora do quadro em repouso:** mãos são a maior fonte de erro de IA. Falha visual quebra a imersão (achado 9).
6. **Aparência bem cuidada e coerente com a personalidade:** atratividade pesa na intenção de presentear (achado 7). Viktoria sóbria e noir; Barbara colorida e expansiva.

---

## 5. Vídeos: o que produzir

Formato e prompts-base: [IDLE-PRODUCAO.md §2](IDLE-PRODUCAO.md). Clipes **40–94** estão lá (base
"viva": fluxos, transições, gatilhos e especiais). Novos, para os formatos da seção 2:

### 5.1 SEGMENTO (6–9 s)

| Arquivo | Âncora (início → fim) | Formato | ACTION |
|---|---|---|---|
| ⭐ `95_SEGMENTO_A0_abertura` | A0 → A0 | F1 | `She settles into the chair as if just arriving, looks into the lens with a bright smile, one hand rises for a small "hello, I'm here" wave, then lowers out of frame.` |
| ⭐ `96_SEGMENTO_A3_anuncia_meta` | A3 → A3 | F1 | `Leaning toward the camera, she talks excitedly as if announcing tonight's goal, then points down toward the bottom of the frame with one finger, eyebrows raised, inviting. Silent.` |
| ⭐ `97_SEGMENTO_A0_meta_batida` | A0 → A0 | F1 | `Goal reached: she gasps, both hands fly up into frame in celebration, she laughs and claps quickly, beaming at the lens, then lowers her hands out of frame.` |
| ⭐ `98_SEGMENTO_A3_dedicatoria_top_fan` | A3 → A3 | F4 | `Leaning in, she places one hand over her heart, looks deeply into the lens with a grateful smile, and gives a small slow nod, as if dedicating the moment to someone special.` |
| ⭐ `99_SEGMENTO_A1_le_pergunta` | A1 → A1 | F3 | `Reading carefully from the monitor, her eyes follow a longer message line by line, her expression shifts to curious interest, then she gives a small thoughtful nod.` |
| `100_SEGMENTO_A3_responde_pensando` | A3 → A3 | F3 | `She tilts her head, thinks for a moment with her eyes up, then starts answering the camera with calm, thoughtful expressions and small hand gestures near the bottom edge. Silent.` |
| `101_SEGMENTO_A0_voce_escolhe` | A0 → A0 | F4 | `Playful: she points toward the camera with one finger as if saying "you choose", raises her eyebrows with a mischievous smile, then lowers the hand out of frame.` |
| `102_SEGMENTO_A0_contagem` | A0 → A0 | F1 | `Excited countdown: one hand rises into frame showing three fingers, then two, then one, her smile growing with each number, then the hand lowers out of frame.` |
| `103_SEGMENTO_A0_brinde` | A0 → A0 | F4/F5 | `She lifts a {DRINK} into frame and raises it toward the camera in a toast, takes a small sip with a warm smile, and lowers it out of frame.` |
| ⭐ `104_SEGMENTO_A0_agradece_encerra` | A0 → A0 | F1 | `End of the live: she smiles gratefully, both hands rise to form a heart in front of her chest, she mouths "thank you" to the camera, then lowers her hands out of frame. Silent.` |

`{DRINK}` vem da ficha (Viktoria: taça de vinho tinto; Barbara: café gelado de canudinho).

### 5.2 Prompt-base de vídeo (todas as categorias)

```text
SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: {IDENTITY}, wearing {WARDROBE}. Live streaming at night in {ROOM}, background softly out of focus. {MIC} stays in the lower right corner. {LIGHT}, with a soft cool glow from an off-screen monitor on the right. Photorealistic.

ACTION: <ACTION da tabela>

STYLE: {MOTION}

LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — <texto da âncora>. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and lighting never change. No sound.
```

Negativo e texto das âncoras: [IDLE-PRODUCAO.md §2.1](IDLE-PRODUCAO.md).

---

## 6. Quantidade de vídeos (por persona)

| Categoria | Arquivos | Quantidade | Lote 1 (mínimo para ir ao ar) |
|---|---|---|---|
| Fluxo A0 (câmera) | 40–51 | 12 | 6 |
| Transições | 52–57 | 6 | 6 |
| Fluxo A1 (lendo chat) | 58–63 | 6 | 3 |
| Fluxo A2 (relaxada) | 64–68 | 5 | 2 |
| Fluxo A3 (perto/falando) | 69–72 | 4 | 2 |
| Gatilhos A0 | 73–85 | 13 | 6 |
| Gatilhos A1 | 86–88 | 3 | 1 |
| Especiais (beats raros) | 89–94 | 6 | 2 |
| **Segmentos (novos)** | 95–104 | 10 | 6 |
| **Total** | | **65** | **34** |

**Por que esses números** (estimativa, não medição):
- Na IDLE, ela passa ~60% do tempo em A0. Com clipes de ~4,5 s e a regra "nada dos últimos 4", o **lote 1** (6 clipes A0; 4 tocam também invertidos = 10 variações) faz um mesmo micro-movimento voltar a cada ~45 s em média. Como são sutis (respirar, piscar, inclinar), isso não se percebe.
- O que o espectador **percebe** são os gestos marcantes (bebida, pet, alongar). Com cooldown de 3 min e 6 especiais, quem assiste 15 min vê cada um no máximo ~1 vez. É o que mata a sensação de loop.
- Toda reação da tabela 1.3 da IDLE e todo formato da seção 2 tem pelo menos 1 vídeo no lote 1. Não existe evento da live "sem resposta" na tela.
- **Lote 2** (+31) dobra a variedade dos fluxos e dá 2–3 opções por reação. Com isso, **lives de 2 h+** (bônus do Tango) não repetem gesto marcante.
- Comece pelo **lote 0** (5 clipes: `40`, `45`, `52`, `53`, `74`) de **uma** persona para validar rosto, busto e encaixe, antes de gastar créditos no resto.

Os 70 vídeos atuais da Viktoria são do formato antigo (plano aberto, 10 s, mãos no teclado).
Continuam no ar até o lote 1 do formato novo ficar pronto; depois são arquivados.

---

## 7. Imagens: o que gerar (por persona)

| # | Imagem | Proporção | Para quê | Prompt |
|---|---|---|---|---|
| 0 | **Ficha** (texto) | — | preencher `{IDENTITY}`, `{WARDROBE}`… | 7.1 |
| 1–7 | Kit da IDLE: cenário vazio, figurino, **A0**, A1–A3, refs de rosto, folha de expressões, pet | 9:16 / 3:4 / 1:1 | produzir os vídeos | [IDLE-ASSETS-PROMPTS.md §3](IDLE-ASSETS-PROMPTS.md) |
| 8 | Capa da live (2 variações) | 1:1 e 9:16 | divulgação (Instagram vinculado ao Tango, achado 5) | 7.2 |
| 9 | Pose de brinde `A0_brinde.png` | 9:16 | âncora opcional para `103` | 7.3 |

Compartilhadas pelas personas (design gráfico, sem pessoa), para o overlay do OBS:

| # | Imagem | Para quê | Prompt |
|---|---|---|---|
| 10 | Cartela de segmento (F1–F5) | aparece ao mudar de bloco | 7.4 |
| 11 | Moldura "Top fã da noite" | F4 | 7.4 |

### 7.1 Ficha da persona (para um assistente de texto, a partir da foto de rosto)

```text
You are a character designer for a vertical live-streaming persona. From the attached face photo and the personality below, write the persona sheet in English, one line per field, concrete and visual, no names of real people or brands:
{IDENTITY} apparent age, face shape, eyes, brows, skin, marks, hair (color, length, cut, styling), makeup.
{WARDROBE} top that shows in a chest-up shot + jewelry (2–3 pieces that must stay identical in every clip).
{ROOM} room behind her at night: style, colors, 2–3 practical lights, 1–2 signature objects.
{LIGHT} key light temperature + accent color.
{MIC} streaming microphone: shape, color, one distinctive detail.
{MOTION} how she moves on camera (energy, speed, typical gestures), in one sentence.
{DRINK} what she drinks on stream.
{PET} a pet that fits her (or "none").
Personality: <cole aqui a personalidade da persona de PERSONAS-PROMPTS.md>
```

### 7.2 Capa da live

**Entradas:** `A0_camera.png` + `ref_rosto_frente.png`

```text
Promotional cover photo for a live stream, the same woman as the references with identical face, hair, makeup, outfit and jewelry: {IDENTITY}, wearing {WARDROBE}. Warm inviting expression looking into the lens, {ROOM} softly out of focus behind her, {LIGHT}. Clean composition with empty space at the {top/bottom} for a title to be added later. Photorealistic, natural skin texture, no text, no logos.
```

### 7.3 Pose de brinde (âncora opcional)

**Entrada:** `A0_camera.png`

```text
Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change: she raises a {DRINK} into frame at chest height toward the camera in a toast, warm smile at the lens. Photorealistic, same grain and color grading.
```

### 7.4 Overlay (sem pessoa)

```text
Minimal transparent-background overlay graphic for a vertical 9:16 live stream, {tema: "segment title card" | "top fan of the night frame"}. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette {cores da persona}. Leave clear empty space where text will be added in OBS. No text, no letters, no logos, PNG with transparency.
```

Viktoria: verde-esmeralda, âmbar e preto. Barbara: rosa, lilás e coral.

---

## 8. Etapas de produção (ordem)

| Etapa | Subetapas | Saída | Onde |
|---|---|---|---|
| **1. Ficha** | 1.1 foto de rosto escolhida · 1.2 prompt 7.1 · 1.3 revisar coerência com a personalidade | `ficha.md` | seção 7.1 |
| **2. Kit de imagens** | 2.1 cenário · 2.2 figurino · 2.3 **A0 (+close)** e escolha no palco · 2.4 A1–A3 · 2.5 refs de rosto · 2.6 expressões · 2.7 pet | 13 imagens | IDLE-ASSETS §3 |
| **3. Lote 0** | 3.1 gerar 5 clipes · 3.2 `check_idle_anchor.py` · 3.3 ver no palco | ok/ajustes | IDLE-PRODUCAO §3.9, §4 |
| **4. Lote 1** | 4.1 gerar os 34 ⭐ · 4.2 QC · 4.3 cadastrar no Odessa (pools por estado, gatilhos) | IDLE que aguenta a live | seções 5 e 6 |
| **5. Formatos** | 5.1 nome e meta da live · 5.2 barra de meta no LivePix · 5.3 cartelas do overlay (7.4) · 5.4 tema no prompt da IA | primeira live com formato | seção 2 |
| **6. Lote 2** | 6.1 +31 clipes · 6.2 capas (7.2) | variedade para lives longas | seção 6 |
| **7. Medir** | 7.1 duração média, presentes por hora, quem voltou · 7.2 ajustar formatos após 4–8 semanas | decisão com dados | achado 6 |

**Tema no prompt da IA (etapa 5.4):** acrescente ao fim da personalidade, na live do dia:

```text
LIVE DE HOJE: "{nome da live}". Meta: {meta}. Se alguém perguntar o que está rolando, explique o tema e a meta em uma frase. Quando a meta estiver perto, anime o chat sem pedir presente diretamente.
```

---

## 9. Fora do plano por enquanto

- **Battle** e **Party** (achado 11): precisam de outra pessoa ao vivo. Voltam quando houver parceria com outra streamer, ou quando uma persona puder "visitar" a outra.
- **Karaokê / música ao vivo:** exige áudio da persona; hoje os vídeos são sem som.
