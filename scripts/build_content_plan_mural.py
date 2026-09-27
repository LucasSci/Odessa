"""Monta o mural do "Plano de conteúdo da live" (docs/PLANO-CONTEUDO-LIVE.md).

Uso:
    python scripts/build_content_plan_mural.py                 # grava no Odessa local
    python scripts/build_content_plan_mural.py --url http://127.0.0.1:8000 --out mural.json

O mural é substituído pelo plano. O conteúdo anterior é salvo em
`mural-antes-<data>.json` ao lado do script (a menos que esteja vazio).
"""
from __future__ import annotations

import argparse
import json
import textwrap
import urllib.request
from datetime import datetime
from pathlib import Path

WRAP = {"sticky": 38, "text": 64}
LINE_PX = {"sticky": 22, "text": 21}
COL_W = 520
GAP = 24

# ── Conteúdo ────────────────────────────────────────────────────────────────
# (coluna, título, cor, [cartões]) — cartão: (tipo, texto) ; tipo sticky|text

PESQUISA = [
    ("sticky", "1 · TEMA + META vencem papo aberto\nLives com propósito (\"Noite X\", \"vamos bater 500 diamantes\") superam conversa solta em engajamento E presentes.\nFonte: Tango Blog — Monetization 101"),
    ("sticky", "2 · AGRADECER PELO NOME, NA HORA\nQuem vê o agradecimento entende que presente gera reconhecimento real — e presenteia também.\nFonte: Tango Blog"),
    ("sticky", "3 · TOP FANS\nRanking visível cria competição amigável e presente recorrente. 5–7% dos usuários geram >70% da receita → tratar o top fã como VIP.\nFontes: Tango Blog, CanvasBusinessModel"),
    ("sticky", "4 · CONSTÂNCIA E DURAÇÃO\nTodo dia, ≥1 h. Bater a própria média de duração dá +10/15/20% de diamantes. Horário fixo; quem volta presenteia mais.\nFonte: Tango Help Center"),
    ("sticky", "5 · POR QUE PRESENTEIAM\nAtratividade, \"expertise\" (algo que ela domina), interação parassocial (sentir-se visto) e status de quem presenteia.\nFonte: PLOS One 2024"),
    ("sticky", "6 · STREAMER DE IA\nFã fica pela personalidade CONSISTENTE e se encanta com momentos IMPREVISÍVEIS. Frustra: resposta genérica, persona que muda, esquecer as pessoas, repetição.\nFonte: arXiv 2025 (AI VTuber fandom)"),
    ("sticky", "7 · PÚBLICO\nMaioria masculina, 25–34 anos; EUA, Brasil, Filipinas. Celular (9:16).\nFonte: Similarweb (estimativa)"),
    ("text", "Documento completo com links: docs/PLANO-CONTEUDO-LIVE.md (seção 1)."),
]

FORMATOS = [
    ("sticky", "F1 · TEMA E META (toda live)\nNome fixo por dia + meta na barra do LivePix.\nVídeos: 95 abertura · 96 anuncia meta · 102 contagem · 97 meta batida"),
    ("sticky", "F2 · BOAS-VINDAS E GRATIDÃO NOMINAL\nAceno para quem entra; agradecimento pelo nome, proporcional ao presente.\nVídeos: 73/87 · 74/75/79 · 76 · 77/85"),
    ("sticky", "F3 · PERGUNTE À PERSONA (Q&A)\n\"Pergunta com rosa vai pra frente.\" Aqui ela mostra o que domina (Viktoria: vinho, livros, cinema; Barbara: reality, música).\nVídeos: 99 lê · 100 responde · 82 pensativa"),
    ("sticky", "F4 · O TOP FÃ ESCOLHE\nTopo do ranking escolhe assunto/dedicatória.\nVídeos: 98 dedicatória · 101 você escolhe · 103 brinde"),
    ("sticky", "F5 · CONFESSIONÁRIO / RESENHA\nBloco íntimo e calmo. Viktoria: confissões com vinho; Barbara: fofoca do BBB.\nEstados A2/A3 + beats 89 bebida, 93 pet"),
    ("text", "ROTEIRO 60–90 MIN\n0–3 abertura (95) → 3–5 meta (96) → 5–25 conversa + gratidão (F2) → 25–40 Q&A (F3) → 40–50 top fã (F4) → 50–75 confessionário (F5) → perto da meta: contagem (102) e comemoração (97) → fim: 104 e 94 tchau."),
    ("sticky", "FORA POR ENQUANTO\nBattle e Party (precisam de outra pessoa ao vivo). Karaokê (vídeos sem áudio)."),
]

IMAGENS = [
    ("sticky", "POR PERSONA\n0 · Ficha (texto) — prompt 7.1\n1–7 · Kit IDLE: cenário vazio, figurino, A0 ⭐, A1–A3, refs de rosto (3), expressões, pet\n8 · Capa da live ×2 (1:1 e 9:16)\n9 · Pose de brinde (opcional)"),
    ("sticky", "COMPARTILHADAS (overlay OBS, sem pessoa)\n10 · Cartela de segmento F1–F5\n11 · Moldura \"Top fã da noite\"\nViktoria: esmeralda/âmbar/preto · Barbara: rosa/lilás/coral"),
    ("text", "PROMPT 7.1 · FICHA (assistente de texto + foto de rosto)\nYou are a character designer for a vertical live-streaming persona. From the attached face photo and the personality below, write the persona sheet in English, one line per field, concrete and visual, no names of real people or brands:\n{IDENTITY} apparent age, face shape, eyes, brows, skin, marks, hair, makeup.\n{WARDROBE} top that shows in a chest-up shot + 2–3 jewelry pieces that stay identical.\n{ROOM} room at night: style, colors, 2–3 practical lights, 1–2 signature objects.\n{LIGHT} key light temperature + accent color.\n{MIC} streaming microphone: shape, color, one detail.\n{MOTION} how she moves on camera, one sentence.\n{DRINK} what she drinks on stream.\n{PET} a pet that fits her (or none).\nPersonality: <personalidade da persona>"),
    ("text", "KIT IDLE (etapas 1–7): prompts completos em docs/IDLE-ASSETS-PROMPTS.md §3.\nOrdem: cenário vazio → figurino → A0 (+ versão close, escolher no palco) → A1/A2/A3 (edição mínima da A0) → refs de rosto frente/¾ → folha 3×3 de expressões → pet."),
    ("text", "PROMPT 7.2 · CAPA DA LIVE (entradas: A0 + ref_rosto_frente)\nPromotional cover photo for a live stream, the same woman as the references with identical face, hair, makeup, outfit and jewelry: {IDENTITY}, wearing {WARDROBE}. Warm inviting expression looking into the lens, {ROOM} softly out of focus behind her, {LIGHT}. Clean composition with empty space at the {top/bottom} for a title to be added later. Photorealistic, natural skin texture, no text, no logos."),
    ("text", "PROMPT 7.3 · POSE DE BRINDE (entrada: A0)\nEdit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change: she raises a {DRINK} into frame at chest height toward the camera in a toast, warm smile at the lens. Photorealistic, same grain and color grading."),
    ("text", "PROMPT 7.4 · OVERLAY (sem pessoa)\nMinimal transparent-background overlay graphic for a vertical 9:16 live stream, {segment title card | top fan of the night frame}. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette {cores da persona}. Leave clear empty space where text will be added in OBS. No text, no letters, no logos, PNG with transparency."),
]

REFERENCIAS = [
    ("sticky", "FOTO DE ROSTO — única referência de identidade.\nPor quê: persona consistente é o que segura o fã (pesquisa 6). Rosto que muda = quebra de identidade."),
    ("sticky", "A0_camera — 1º E último frame de todo vídeo.\nPor quê: começa e termina na mesma pose → encaixa com qualquer clipe, a IDLE nunca \"pula\"."),
    ("sticky", "A1/A2/A3 — âncoras de estado.\nPor quê: mudar de estado conforme o chat = parece reagir, não loop."),
    ("sticky", "CENÁRIO VAZIO + FIGURINO\nPor quê: fundo, roupa e joias idênticos em todos os clipes (joia que some é erro clássico)."),
    ("sticky", "REFS DE ROSTO + EXPRESSÕES\nPor quê: rosto mantido ao virar a cabeça; sorriso/riso/timidez iguais em todos os gatilhos."),
    ("sticky", "NENHUMA imagem de vídeos antigos ou de streamers reais.\nPor quê: replicamos só o FORMATO; clima descrito em texto ({ROOM}, {LIGHT}). Evita problema de direito de imagem."),
]

PORQUES = [
    ("sticky", "BUSTO 9:16 → Tango é celular; rosto grande = emoção legível = parassocial."),
    ("sticky", "OLHAR NA LENTE → \"falando com você\": a pessoa se sente vista."),
    ("sticky", "LUZ QUENTE + MONITOR FRIO À DIREITA → \"casa, à noite, ao vivo\"; olhar p/ direita = lendo o chat."),
    ("sticky", "FUNDO PESSOAL (pet, bebida) → vira assunto, e o prompt da persona sabe responder; desfocado varia menos."),
    ("sticky", "MÃOS FORA DO QUADRO → maior fonte de erro da IA some; falha visual quebra a imersão."),
    ("sticky", "APARÊNCIA CUIDADA E COERENTE → atratividade pesa no presente (pesquisa 5). Viktoria sóbria/noir; Barbara colorida."),
]

VIDEOS = [
    ("sticky", "QUANTIDADE POR PERSONA\nTotal: 65 · Lote 1 (ir ao ar): 34 · Lote 0 (teste): 5\nFluxo A0 12(6) · Transições 6(6) · A1 6(3) · A2 5(2) · A3 4(2) · Gatilhos A0 13(6) · Gatilhos A1 3(1) · Especiais 6(2) · Segmentos 10(6)"),
    ("sticky", "POR QUE 34 PARA COMEÇAR\n• 60% do tempo em A0; 6 clipes (+4 invertidos) → micro-gesto volta a cada ~45 s, sutil demais para notar.\n• Gestos marcantes com cooldown 3 min → quem assiste 15 min vê cada um ~1×.\n• Todo evento da live e todo formato tem vídeo."),
    ("sticky", "POR QUE 65 NO TOTAL\nDobra a variedade e dá 2–3 opções por reação: lives de 2 h+ (bônus do Tango) sem repetir gesto marcante."),
    ("sticky", "LOTE 0 PRIMEIRO\n40, 45, 52, 53, 74 de UMA persona → valida rosto, busto e encaixe antes de gastar créditos."),
    ("text", "PROMPT-BASE DE VÍDEO (first+last frame)\nSCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. The same woman as the start frame: {IDENTITY}, wearing {WARDROBE}. Live streaming at night in {ROOM}, background softly out of focus. {MIC} stays in the lower right corner. {LIGHT}, with a soft cool glow from an off-screen monitor on the right. Photorealistic.\nACTION: <ação do clipe>\nSTYLE: {MOTION}\nLOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — <âncora>. Hands stay out of frame unless the action brings them up, and they leave the frame again before the end. Relaxed breathing and natural blinks. Camera completely static. Background, microphone and lighting never change. No sound."),
    ("text", "SEGMENTOS NOVOS (6–9 s) — ACTION\n⭐95 A0 abertura: She settles into the chair as if just arriving, looks into the lens with a bright smile, one hand rises for a small hello wave, then lowers out of frame.\n⭐96 A3 anuncia meta: Leaning toward the camera, she talks excitedly as if announcing tonight's goal, then points down toward the bottom of the frame, eyebrows raised, inviting. Silent.\n⭐97 A0 meta batida: She gasps, both hands fly up into frame in celebration, she laughs and claps quickly, beaming, then lowers her hands out of frame.\n⭐98 A3 dedicatória top fã: Hand over her heart, deep grateful look into the lens, a small slow nod.\n⭐99 A1 lê pergunta: Reads a longer message line by line, expression shifts to curious interest, small thoughtful nod.\n100 A3 responde pensando: Tilts her head, thinks with eyes up, then answers calmly with small hand gestures near the bottom edge. Silent.\n101 A0 você escolhe: Points toward the camera as if saying \"you choose\", mischievous smile, lowers the hand.\n102 A0 contagem: One hand shows three, two, one fingers, smile growing, then lowers.\n103 A0 brinde: Lifts a {DRINK} toward the camera in a toast, small sip, lowers it out of frame.\n⭐104 A0 agradece/encerra: Hands form a heart in front of her chest, mouths \"thank you\", lowers the hands. Silent."),
    ("text", "BASE 40–94 (fluxos, transições, gatilhos, especiais): ACTION de cada clipe em docs/IDLE-PRODUCAO.md §3. Negativo e texto das âncoras em §2.1."),
    ("sticky", "VÍDEOS ATUAIS DA VIKTORIA (70, formato antigo: plano aberto, 10 s, mãos no teclado)\nFicam no ar até o lote 1 do formato novo; depois são arquivados."),
]

ETAPAS = [
    ("sticky", "1 · FICHA\n1.1 escolher a foto de rosto\n1.2 prompt 7.1\n1.3 revisar com a personalidade"),
    ("sticky", "2 · KIT DE IMAGENS (13)\n2.1 cenário · 2.2 figurino · 2.3 A0 + close (escolher no palco) · 2.4 A1–A3 · 2.5 refs de rosto · 2.6 expressões · 2.7 pet"),
    ("sticky", "3 · LOTE 0 (5 vídeos)\n3.1 gerar · 3.2 check_idle_anchor.py (ok/ok) · 3.3 ver no palco"),
    ("sticky", "4 · LOTE 1 (34 vídeos)\n4.1 gerar os ⭐ · 4.2 controle de qualidade · 4.3 cadastrar no Odessa (pools por estado + gatilhos)"),
    ("sticky", "5 · FORMATOS NO AR\n5.1 nome e meta da live · 5.2 barra de meta LivePix · 5.3 cartelas do overlay (7.4) · 5.4 tema no prompt da IA"),
    ("sticky", "6 · LOTE 2 (+31) e CAPAS\n6.1 variedade para lives longas · 6.2 capas (7.2)"),
    ("sticky", "7 · MEDIR (4–8 semanas)\n7.1 duração média, presentes/hora, quem voltou · 7.2 ajustar formatos com dados"),
    ("text", "TEMA NO PROMPT DA IA (etapa 5.4) — acrescentar à personalidade na live do dia:\nLIVE DE HOJE: \"{nome da live}\". Meta: {meta}. Se alguém perguntar o que está rolando, explique o tema e a meta em uma frase. Quando a meta estiver perto, anime o chat sem pedir presente diretamente."),
]

COLUMNS = [
    ("1 · PESQUISA — o que funciona no Tango", "yellow", PESQUISA),
    ("2 · FORMATOS DE LIVE (sem games)", "blue", FORMATOS),
    ("3 · IMAGENS A GERAR + PROMPTS", "purple", IMAGENS),
    ("4 · REFERÊNCIAS E POR QUÊ", "pink", REFERENCIAS),
    ("5 · POR QUE AS IMAGENS FUNCIONAM", "pink", PORQUES),
    ("6 · VÍDEOS: QUANTIDADE + PROMPTS", "green", VIDEOS),
    ("7 · ETAPAS DE PRODUÇÃO", "orange", ETAPAS),
]


def wrap(text: str, width: int) -> str:
    out: list[str] = []
    for paragraph in text.split("\n"):
        out.extend(textwrap.wrap(paragraph, width=width) or [""])
    return "\n".join(out)


def card_height(kind: str, content: str) -> int:
    lines = content.count("\n") + 1
    return max(120 if kind == "sticky" else 60, lines * LINE_PX[kind] + 56)


def build() -> dict:
    items: list[dict] = []
    connections: list[dict] = []
    title = {
        "id": "plano-titulo",
        "position": {"x": 0, "y": -170},
        "data": {
            "type": "text",
            "content": "PLANO DE CONTEÚDO DA LIVE — Tango, sem games (persona + público + conversa)\nServe para qualquer persona: troque os {campos} pela ficha dela. Versão completa: docs/PLANO-CONTEUDO-LIVE.md",
            "color": "blue",
            "width": 900,
            "fontSize": 20,
        },
    }
    items.append(title)
    section_ids = []
    for col, (heading, color, cards) in enumerate(COLUMNS):
        x = col * COL_W
        y = 70
        card_ids = []
        for idx, (kind, text) in enumerate(cards):
            content = wrap(text, WRAP[kind])
            height = card_height(kind, content)
            cid = f"plano-c{col}-{idx}"
            data = {"type": kind, "content": content, "color": color, "width": 440}
            if kind == "sticky":
                data["height"] = height
            else:
                data["fontSize"] = 13
            items.append({"id": cid, "position": {"x": x + 20, "y": y}, "data": data})
            card_ids.append(cid)
            y += height + GAP
        sid = f"plano-s{col}"
        items.insert(
            1 + col,
            {
                "id": sid,
                "position": {"x": x, "y": 0},
                "data": {"type": "section", "content": heading, "color": color, "width": 480, "height": y + 10, "fontSize": 16},
            },
        )
        section_ids.append(sid)
        # etapas encadeadas
        if heading.startswith("7"):
            for a, b in zip(card_ids[:6], card_ids[1:7]):
                connections.append({"id": f"plano-e-{a}-{b}", "source": a, "target": b})
    links = [(0, 1, "define"), (1, 5, "usa vídeos"), (2, 5, "vira 1º/último frame"), (3, 2, "guia"), (4, 2, "justifica"), (5, 6, "entra no lote")]
    for a, b, label in links:
        connections.append({"id": f"plano-l{a}{b}", "source": section_ids[a], "target": section_ids[b], "label": label})
    return {"items": items, "connections": connections, "viewport": {"x": 40, "y": 220, "zoom": 0.45}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--out", help="também grava o JSON do mural neste arquivo")
    args = parser.parse_args()
    canvas = build()
    if args.out:
        Path(args.out).write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")
    endpoint = f"{args.url.rstrip('/')}/api/v1/planning/canvas"
    with urllib.request.urlopen(endpoint, timeout=15) as res:
        current = json.loads(res.read())
    if current.get("items"):
        backup = Path(__file__).with_name(f"mural-antes-{datetime.now():%Y%m%d-%H%M%S}.json")
        backup.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"mural anterior salvo em {backup}")
    req = urllib.request.Request(endpoint, method="PUT", data=json.dumps(canvas).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as res:
        print("mural gravado:", json.loads(res.read()))


if __name__ == "__main__":
    main()
