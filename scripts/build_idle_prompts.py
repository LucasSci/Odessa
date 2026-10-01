"""Gera TODOS os prompts de produção da IDLE, prontos para colar, por persona.

Fonte única dos clipes: docs/IDLE-PRODUCAO.md §3 (40–94) e
docs/PLANO-CONTEUDO-LIVE.md §5.1 (95–104). A ficha de cada persona fica aqui
(FICHAS). Para uma persona nova: acrescente a ficha e rode o script.

Saída por persona:
    docs/producao/<persona>/PROMPTS.md   imagens (etapa a etapa) + vídeos (clipe a clipe)
    docs/producao/<persona>/prompts.csv  um clipe por linha, para geração em lote
    server/data/idle_plan.json           o plano inteiro, lido pelo Estúdio da IDLE no app

Uso:
    python scripts/build_idle_prompts.py [--json saida.json]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

# ── Fichas (inglês: é o que os geradores entendem melhor) ──────────────────
# DRINK e PET sem artigo: as ações já trazem "a {DRINK}" / "A {PET}".
FICHAS: dict[str, dict[str, str]] = {
    "viktoria": {
        "name": "Viktoria",
        "IDENTITY": (
            "a woman in her early thirties with an oval face, high defined cheekbones and a soft narrow chin; "
            "almond-shaped pale grey-green eyes with a thin black winged eyeliner; thin straight light-brown eyebrows; "
            "fair skin with a few faint freckles across the nose and cheeks; full soft lips in a muted nude-pink; "
            "long straight honey-platinum blonde hair falling past her chest, center part, with long blunt curtain "
            "bangs that just brush her eyebrows; minimal refined makeup"
        ),
        "WARDROBE": (
            "a black silk satin blouse with an elegant V-neckline, a single thin silver necklace with a small dark "
            "onyx stone, and small diamond stud earrings"
        ),
        "ROOM": (
            "a dark, moody apartment: deep emerald-green velvet walls, a brass wall sconce glowing warm, a bookshelf "
            "with old leather-bound books, a single lit candle on a side table, and distant city lights through a window"
        ),
        "LIGHT": "Low warm 2400K key light from the side with soft shadows, emerald and amber accents in the background",
        "MIC": "a matte black broadcast microphone on a boom arm with small brass details",
        "MOTION": (
            "Slow, composed and subtle: half-smiles, lingering glances, a slightly raised eyebrow; never rushed, "
            "never exaggerated."
        ),
        "DRINK": "glass of red wine",
        "PET": "sleek black cat with amber eyes",
        "PALETTE": "deep emerald green, warm amber and black",
    },
    "barbara": {
        "name": "Barbara",
        "IDENTITY": (
            "a woman in her mid-twenties with a heart-shaped face and a softly defined jaw; almond-shaped light blue "
            "eyes with long natural lashes; straight dark eyebrows; warm golden-tan skin with many small brown "
            "freckles across her nose and cheeks; full lips in a natural rosy nude; a sleek glossy jet-black bob cut "
            "just below the jaw, center part, one side tucked behind her ear; dewy minimal makeup"
        ),
        "WARDROBE": (
            "a cropped bright coral knit cardigan over a white fitted tank top, small gold hoop earrings, and a thin "
            "gold chain necklace with a tiny heart pendant"
        ),
        "ROOM": (
            "a playful bedroom-studio: a pastel lilac wall with a round neon sign glowing soft pink, shelves with "
            "plushies and small plants, and warm fairy lights"
        ),
        "LIGHT": "Warm 3000K key light, pink and lilac accents in the background",
        "MIC": "a white podcast microphone on a short arm with a colorful foam windscreen",
        "MOTION": (
            "Energetic and expressive: bigger smiles, lively head movements, quick bright reactions, but still natural."
        ),
        "DRINK": "pastel iced coffee cup with a straw",
        "PET": "small fluffy white pomeranian",
        "PALETTE": "soft pink, lilac and coral",
    },
}

ANCHOR_FILES = {"A0": "A0_camera.png", "A1": "A1_chat.png", "A2": "A2_relaxada.png", "A3": "A3_perto.png"}
ANCHOR_TEXT = {
    "A0": "facing the camera, looking into the lens with a soft closed-mouth smile, hands out of frame",
    "A1": "head turned toward the right side of the frame, reading an off-screen monitor, hands out of frame",
    "A2": "leaning back slightly in the chair, calm half-smile at the lens, hands out of frame",
    "A3": "leaning toward the camera, forearms on the desk, hands together at the bottom edge, warm smile",
}
NEGATIVE = (
    "camera movement, zoom, pan, dolly, cut, scene change, morphing face, different person, changing hairstyle, "
    "changing outfit, missing jewelry, extra fingers, deformed hands, hands lingering in frame, extra people, new "
    "objects, flickering light, exposure change, text, subtitles, watermark, logo, exaggerated cartoon expressions, "
    "fast motion"
)
DURATION = {"FLUXO": "4–5 s", "TRANSICAO": "2–3 s", "GATILHO": "5–8 s", "ESPECIAL": "8–10 s", "SEGMENTO": "6–9 s"}
CATEGORY_LABEL = {
    "FLUXO": "Fluxo (micro-idle)",
    "TRANSICAO": "Transição",
    "GATILHO": "Gatilho (reação)",
    "ESPECIAL": "Especial (beat raro)",
    "SEGMENTO": "Segmento (formato de live)",
}

ROW_RE = re.compile(r"^\|\s*(?P<marks>[⭐🔁]*)\s*`(?P<file>\d{2,3}_[A-Z]+_A\d(?:-A\d)?_[^`]+)`(?P<rest>.*)$")


def parse_clips() -> list[dict]:
    """Lê as tabelas de clipes dos dois documentos (fonte única)."""
    clips: dict[str, dict] = {}
    for doc in (DOCS / "IDLE-PRODUCAO.md", DOCS / "PLANO-CONTEUDO-LIVE.md"):
        for line in doc.read_text(encoding="utf-8").splitlines():
            match = ROW_RE.match(line.strip())
            if not match:
                continue
            file = match["file"]
            cells = [c.strip() for c in match["rest"].split("|")]
            actions = [c for c in cells if c.startswith("`") and c.endswith("`") and len(c) > 20]
            if not actions:
                continue
            number, category, anchors = file.split("_")[:3]
            start, _, end = anchors.partition("-")
            event = next((c for c in cells if c and not c.startswith("`") and "→" not in c), "")
            clips[file] = {
                "file": file,
                "number": int(number),
                "category": category,
                "start": start,
                "end": end or start,
                "lote1": "⭐" in match["marks"],
                "pingpong": "🔁" in match["marks"],
                "event": event if category in ("GATILHO", "SEGMENTO") else "",
                "action": actions[-1].strip("`"),
            }
    ordered = sorted(clips.values(), key=lambda c: c["number"])
    lote0 = {40, 45, 52, 53, 74}
    for clip in ordered:
        clip["lote"] = 0 if clip["number"] in lote0 else (1 if clip["lote1"] else 2)
    return ordered


def fill(text: str, ficha: dict[str, str]) -> str:
    for key, value in ficha.items():
        text = text.replace("{" + key + "}", value)
    return text


def video_prompt(clip: dict, ficha: dict[str, str]) -> str:
    action = fill(clip["action"], ficha)
    if clip["start"] == clip["end"]:
        loop = (
            f"LOOP RULES: Starts on the start frame and ends on exactly the same pose as the end frame — "
            f"{ANCHOR_TEXT[clip['end']]}."
        )
    else:
        loop = (
            f"TRANSITION RULES: Starts on the start frame — {ANCHOR_TEXT[clip['start']]} — and ends on exactly the "
            f"pose of the end frame — {ANCHOR_TEXT[clip['end']]}."
        )
    return fill(
        "SCENE LOCK — Static locked-off camera, vertical 9:16 chest-up shot, identical framing to the start frame. "
        "The same woman as the start frame: {IDENTITY}, wearing {WARDROBE}. Live streaming at night in {ROOM}, "
        "background softly out of focus. {MIC} stays in the lower right corner. {LIGHT}, with a soft cool glow from "
        "an off-screen monitor on the right. Photorealistic.\n\n"
        f"ACTION: {action}\n\n"
        "STYLE: {MOTION}\n\n"
        f"{loop} Hands stay out of frame unless the action brings them up, and they leave the frame again before the "
        "end. Relaxed breathing and natural blinks throughout. Camera completely static. Background, microphone and "
        "lighting never change. No sound.",
        ficha,
    )


# ── Imagens (etapas) ───────────────────────────────────────────────────────
EDIT_OPEN = (
    "Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and "
    "jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change her "
    "pose as described. Photorealistic, same grain and color grading.\n\n"
)
IMAGE_STEPS = [
    {
        "step": "1", "file": "cenario_vazio.png", "ratio": "9:16", "inputs": "nenhuma",
        "why": "Fundo sem pessoa: base da A0 e referência para conferir se o fundo mudou em algum clipe.",
        "prompt": "Vertical 9:16 photo of an empty live-streaming seat at night, shot from eye level with a 55mm lens at f/2. {ROOM}. The background is softly out of focus with the practical lights turned into gentle bokeh. In the foreground, the empty backrest of a chair, and {MIC} entering the frame from the lower right corner, partly cropped. A soft cool glow from an off-screen monitor on the right. {LIGHT}. Photorealistic, natural film grain, no people, no text.",
    },
    {
        "step": "2", "file": "figurino.png", "ratio": "3:4", "inputs": "nenhuma",
        "why": "Roupa e joias fixas: nenhuma joia some entre os clipes.",
        "prompt": "Flat-lay product photo of this outfit, no person: {WARDROBE}. Arranged neatly on a neutral linen surface, soft even light, true colors, fabric texture and details clearly visible. Wardrobe reference, photorealistic.",
    },
    {
        "step": "3 ⭐", "file": "A0_camera.png", "ratio": "9:16", "inputs": "foto de rosto + cenario_vazio.png + figurino.png",
        "why": "A imagem mais importante: é o primeiro e o último frame de quase todos os vídeos.",
        "prompt": "Vertical 9:16 chest-up portrait of the woman from the face reference, an adult live streamer at night, seated in the chair from the scene reference, in exactly that room and light. Identity must match the face reference exactly: {IDENTITY}. She wears {WARDROBE}.\n\nFraming: small headroom above her head, eyes at one third from the top, frame cut at mid-chest, shoulders filling most of the width, camera at eye level, 55mm lens at f/2, background softly out of focus. {MIC} enters from the lower right corner, partly cropped. Soft cool glow from an off-screen monitor on the right side of her face. {LIGHT}.\n\nPose: shoulders square to the camera, looking straight into the lens, relaxed friendly expression with a soft closed-mouth smile. Both hands are out of frame, resting on the desk below. Photorealistic, natural skin texture, gentle film grain, no text.",
    },
    {
        "step": "3b", "file": "A0_camera_close.png", "ratio": "9:16", "inputs": "foto de rosto + cenario_vazio.png + figurino.png",
        "why": "Teste de enquadramento mais fechado. Compare as duas no palco do Odessa e fique com uma como A0.",
        "prompt": "Vertical 9:16 close portrait of the woman from the face reference, an adult live streamer at night, seated in the chair from the scene reference, in exactly that room and light. Identity must match the face reference exactly: {IDENTITY}. She wears {WARDROBE}.\n\nFraming: close shoulders-up portrait, eyes at one third from the top, frame cut just below the collarbones, face filling about half of the frame height, camera at eye level, 65mm lens at f/1.8, background softly out of focus. {MIC} barely visible in the lower right corner. Soft cool glow from an off-screen monitor on the right side of her face. {LIGHT}.\n\nPose: shoulders square to the camera, looking straight into the lens, relaxed friendly expression with a soft closed-mouth smile. Both hands are out of frame. Photorealistic, natural skin texture, gentle film grain, no text.",
    },
    {
        "step": "4", "file": "A1_chat.png", "ratio": "9:16", "inputs": "A0_camera.png",
        "why": "Estado \"lendo o chat\" (chat agitado).",
        "prompt": EDIT_OPEN + "She turns her head about 30 degrees toward the right side of the frame, eyes reading an off-screen monitor, attentive relaxed expression with the faintest smile. The cool monitor glow now falls more on her face. Hands stay out of frame.",
    },
    {
        "step": "4", "file": "A2_relaxada.png", "ratio": "9:16", "inputs": "A0_camera.png",
        "why": "Estado \"relaxada\" (chat parado).",
        "prompt": EDIT_OPEN + "She leans back a little into the chair, so she sits slightly further from the camera, head tilted gently, calm content half-smile, eyes softly on the lens. Hands stay out of frame.",
    },
    {
        "step": "4", "file": "A3_perto.png", "ratio": "9:16", "inputs": "A0_camera.png",
        "why": "Estado \"perto / conversando\" (a IA está respondendo alguém).",
        "prompt": EDIT_OPEN + "She leans forward toward the camera with her forearms resting on the desk, face a little closer to the lens, warm engaged smile, looking directly into the camera. Her hands, loosely together, are just visible at the bottom edge of the frame.",
    },
    {
        "step": "5", "file": "ref_rosto_frente.png", "ratio": "3:4", "inputs": "foto de rosto + A0_camera.png",
        "why": "Trava o rosto no gerador de vídeo (personagem salvo).",
        "prompt": "Close-up head-and-shoulders portrait of the same woman as the references, identical face and features: {IDENTITY}. Same hair, makeup, jewelry and outfit ({WARDROBE}). Facing the camera, neutral soft smile, same light as the A0 image, background softly blurred. Identity reference photo, photorealistic, sharp focus on the eyes, natural skin texture, no retouching.",
    },
    {
        "step": "5", "file": "ref_rosto_34_esq.png", "ratio": "3:4", "inputs": "foto de rosto + A0_camera.png",
        "why": "Mantém o rosto quando ela vira a cabeça.",
        "prompt": "Same woman as the references, identical face and features: {IDENTITY}. Same hair, jewelry, outfit and lighting. Three-quarter view, head turned about 40 degrees to HER LEFT, soft smile. Identity reference photo, photorealistic.",
    },
    {
        "step": "5", "file": "ref_rosto_34_dir.png", "ratio": "3:4", "inputs": "foto de rosto + A0_camera.png",
        "why": "Mantém o rosto quando ela olha para o chat (direita do quadro).",
        "prompt": "Same woman as the references, identical face and features: {IDENTITY}. Same hair, jewelry, outfit and lighting. Three-quarter view, head turned about 40 degrees to HER RIGHT, soft smile. Identity reference photo, photorealistic.",
    },
    {
        "step": "6", "file": "ref_expressoes.png", "ratio": "1:1", "inputs": "ref_rosto_frente.png + ref_rosto_34_esq.png",
        "why": "Sorriso, riso e timidez iguais em todas as reações.",
        "prompt": "A 3x3 grid expression sheet of the exact same woman in every panel — identical face, hair, makeup, jewelry and outfit, chest-up crop, same lighting, same blurred background, thin white gutters, no text.\n1 neutral calm · 2 soft closed-mouth smile · 3 big genuine smile with teeth · 4 laughing with eyes squinting · 5 pleasantly surprised, lips parted · 6 shy smile looking down · 7 blowing a kiss, fingertips at her lips · 8 playful eye-roll with a smirk · 9 thoughtful, finger on chin.\nExpressions in her own style: {MOTION} Natural and believable, not cartoonish. Photorealistic.",
    },
    {
        "step": "7", "file": "ref_pet.png", "ratio": "1:1", "inputs": "cenario_vazio.png",
        "why": "O pet aparece em beats raros e está no prompt da personalidade: o que se vê bate com o que ela diz.",
        "prompt": "A {PET} resting calmly in {ROOM}, same warm night lighting, full body visible. Photorealistic pet reference.",
    },
    {
        "step": "8", "file": "A0_brinde.png", "ratio": "9:16", "inputs": "A0_camera.png",
        "why": "Opcional: pose do brinde (vídeo 103).",
        "prompt": "Edit this image with minimal change. Keep absolutely identical: her identity, face, hair, makeup, outfit and jewelry, the microphone, the background, the lighting, the camera position and the framing. Only change: she raises a {DRINK} into frame at chest height toward the camera in a toast, warm smile at the lens. Photorealistic, same grain and color grading.",
    },
    {
        "step": "9", "file": "capa_live_1x1.png", "ratio": "1:1", "inputs": "A0_camera.png + ref_rosto_frente.png",
        "why": "Divulgação (Instagram vinculado ao Tango).",
        "prompt": "Promotional cover photo for a live stream, the same adult woman as the references with identical face, hair, makeup, outfit and jewelry: {IDENTITY}, wearing {WARDROBE}. Warm inviting expression looking into the lens, {ROOM} softly out of focus behind her. {LIGHT}. Clean composition with empty space at the top for a title to be added later. Photorealistic, natural skin texture, no text, no logos.",
    },
    {
        "step": "9", "file": "capa_live_9x16.png", "ratio": "9:16", "inputs": "A0_camera.png + ref_rosto_frente.png",
        "why": "Divulgação em formato de story.",
        "prompt": "Vertical promotional cover photo for a live stream, the same adult woman as the references with identical face, hair, makeup, outfit and jewelry: {IDENTITY}, wearing {WARDROBE}. Warm inviting expression looking into the lens, {ROOM} softly out of focus behind her. {LIGHT}. Clean composition with empty space at the bottom third for a title to be added later. Photorealistic, natural skin texture, no text, no logos.",
    },
    {
        "step": "10", "file": "overlay_cartela_segmento.png", "ratio": "9:16 (PNG transparente)", "inputs": "nenhuma",
        "why": "Cartela que aparece no OBS ao mudar de bloco (F1–F5).",
        "prompt": "Minimal transparent-background overlay graphic for a vertical 9:16 live stream: a segment title card. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette {PALETTE}. Leave clear empty space where text will be added in OBS. No text, no letters, no logos, PNG with transparency.",
    },
    {
        "step": "10", "file": "overlay_top_fan.png", "ratio": "9:16 (PNG transparente)", "inputs": "nenhuma",
        "why": "Moldura \"Top fã da noite\" (formato F4).",
        "prompt": "Minimal transparent-background overlay graphic for a vertical 9:16 live stream: a \"top fan of the night\" name frame with a subtle crown motif. Elegant, legible on a phone screen, rounded shapes, soft glow, color palette {PALETTE}. Leave clear empty space where the name will be added in OBS. No text, no letters, no logos, PNG with transparency.",
    },
]


def build_persona(pid: str, clips: list[dict]) -> dict:
    ficha = FICHAS[pid]
    images = [{**s, "prompt": fill(s["prompt"], ficha)} for s in IMAGE_STEPS]
    videos = []
    for clip in clips:
        videos.append({
            **{k: clip[k] for k in ("file", "number", "category", "start", "end", "lote", "pingpong", "event")},
            "categoryLabel": CATEGORY_LABEL[clip["category"]],
            "duration": DURATION[clip["category"]],
            "firstFrame": ANCHOR_FILES[clip["start"]],
            "lastFrame": ANCHOR_FILES[clip["end"]],
            "prompt": video_prompt(clip, ficha),
        })
    return {"id": pid, "name": ficha["name"], "ficha": ficha, "images": images, "videos": videos, "negative": NEGATIVE}


def write_markdown(data: dict, out_dir: Path) -> None:
    f = data["ficha"]
    lines = [
        f"# {data['name']} — todos os prompts de produção (IDLE)",
        "",
        "> Gerado por `scripts/build_idle_prompts.py` — não edite à mão: mude a ficha no script ou a lista de",
        "> clipes em `docs/IDLE-PRODUCAO.md` / `docs/PLANO-CONTEUDO-LIVE.md` e rode de novo.",
        "",
        "Pasta das imagens: `assets/idle-kit/" + data["id"] + "/` · pasta dos vídeos: `assets/videos/" + data["id"] + "/`",
        "",
        "## Ficha",
        "",
        "| Campo | Valor |",
        "|---|---|",
    ]
    for key in ("IDENTITY", "WARDROBE", "ROOM", "LIGHT", "MIC", "MOTION", "DRINK", "PET"):
        lines.append(f"| `{key}` | {f[key]} |")
    lines += [
        "",
        "## Parte 1 — Imagens (na ordem)",
        "",
        "Modelo de imagem com referência (Nano Banana / Gemini Image, Seedream 4, Flux Kontext, GPT-Image).",
        "Gere 3–4 variações de cada e escolha a mais **fiel ao rosto**, não a mais bonita.",
        "",
    ]
    for img in data["images"]:
        lines += [
            f"### Etapa {img['step']} · `{img['file']}` · {img['ratio']}",
            "",
            f"**Entradas:** {img['inputs']} · **Para quê:** {img['why']}",
            "",
            "```text",
            img["prompt"],
            "```",
            "",
        ]
    lines += [
        "## Parte 2 — Vídeos (image-to-video, primeiro + último frame)",
        "",
        "Modelos com first + last frame: Kling (start/end frame), Veo 3.1, Seedance, Wan FLF2V.",
        "Saída: 9:16, 24 fps, **sem áudio**. Personagem salvo, se o modelo aceitar: `ref_rosto_frente`,",
        "`ref_rosto_34_esq`, `ref_rosto_34_dir` e `A0_camera`.",
        "",
        "**Prompt negativo (igual para todos os clipes):**",
        "",
        "```text",
        data["negative"],
        "```",
        "",
        "Lotes: **0** = teste (5 clipes, faça primeiro) · **1** = mínimo para ir ao ar · **2** = variedade.",
        "",
    ]
    for lote in (0, 1, 2):
        group = [v for v in data["videos"] if v["lote"] == lote]
        lines += [f"### Lote {lote} — {len(group)} clipes", ""]
        for v in group:
            extra = f" · evento: {v['event']}" if v["event"] else ""
            pp = " · 🔁 pode tocar invertido" if v["pingpong"] else ""
            lines += [
                f"#### `{v['file']}.mp4`",
                "",
                f"{v['categoryLabel']} · **1º frame:** `{v['firstFrame']}` · **último frame:** `{v['lastFrame']}` · "
                f"**duração:** {v['duration']}{extra}{pp}",
                "",
                "```text",
                v["prompt"],
                "```",
                "",
            ]
    lines += [
        "## Parte 3 — Conferir cada clipe",
        "",
        "```bash",
        f"python scripts/check_idle_anchor.py --anchor assets/idle-kit/{data['id']}/A0_camera.png assets/videos/{data['id']}/<arquivo>.mp4",
        "```",
        "",
        "Precisa dar `ok/ok`. Transição: rode com a âncora de início e depois com a de fim.",
        "Olhar também: rosto igual ao `ref_rosto_frente`, joias presentes, microfone no canto, mãos entram e saem.",
        "",
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "PROMPTS.md").write_text("\n".join(lines), encoding="utf-8")
    with (out_dir / "prompts.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["lote", "arquivo", "categoria", "primeiro_frame", "ultimo_frame", "duracao", "evento", "prompt", "negativo"])
        for v in data["videos"]:
            writer.writerow([v["lote"], v["file"] + ".mp4", v["categoryLabel"], v["firstFrame"], v["lastFrame"],
                             v["duration"], v["event"], v["prompt"], data["negative"]])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", help="também grava tudo num JSON (usado pela página de produção)")
    args = parser.parse_args()
    clips = parse_clips()
    result = []
    for pid in FICHAS:
        data = build_persona(pid, clips)
        write_markdown(data, DOCS / "producao" / pid)
        result.append(data)
        print(f"{data['name']}: {len(data['images'])} imagens, {len(data['videos'])} vídeos "
              f"(lote0 {sum(v['lote'] == 0 for v in data['videos'])}, lote1 {sum(v['lote'] == 1 for v in data['videos'])}, "
              f"lote2 {sum(v['lote'] == 2 for v in data['videos'])})")
    # O Estúdio da IDLE dentro do Odessa lê o plano daqui.
    (ROOT / "server" / "data" / "idle_plan.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
