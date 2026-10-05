"""
idle_studio.py — Estúdio da IDLE: do prompt ao fluxo reativo, dentro do Odessa.

O plano (fichas, imagens do kit e os 65 clipes com 1º/último frame) vem de
server/data/idle_plan.json, gerado por scripts/build_idle_prompts.py. Aqui
fica o que muda com o uso:

- cada etapa (imagem do kit ou clipe) guarda status, anexos e o escolhido em
  server/data/idle_studio/<persona>/state.json, e os arquivos ao lado, em files/;
- o nome dos anexos é automático pelo nome da etapa (o escolhido leva o nome
  exato, as outras variações _v2, _v3…);
- `build_flow` copia os clipes aprovados para a pasta de vídeos e monta o
  rascunho do fluxo reativo (IDLE, ciclo natural pelos estados A0–A3 e
  gatilhos por evento), para revisar e publicar em Automações;
- `start_generation` gera uma etapa por API (imagem: Gemini/Higgsfield; vídeo:
  provedor de VIDEO_GEN_PROVIDER) e anexa o resultado.
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from server.core.atomic_json import read_json, update_json
from server.core.persona_manager import DATA_DIR

logger = logging.getLogger("odessa.idle_studio")

PLAN_PATH = DATA_DIR / "idle_plan.json"
FACE_KEY = "foto_rosto"
STATUSES = ("pendente", "gerado", "refazer", "aprovado")
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
_ASSET_ID = re.compile(r"^[0-9a-f]{32}$")
_FILE_EXT = re.compile(r"\.(png|jpe?g|webp|mp4|webm)$", re.IGNORECASE)


class StudioError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Plano ──────────────────────────────────────────────────────────────────

_plan_cache: Dict[str, Any] = {}


def load_plan() -> List[Dict[str, Any]]:
    try:
        mtime = PLAN_PATH.stat().st_mtime
    except OSError:
        return []
    if _plan_cache.get("mtime") != mtime:
        _plan_cache["data"] = read_json(PLAN_PATH, default_factory=list) or []
        _plan_cache["mtime"] = mtime
    return _plan_cache["data"]


def persona_plan(persona_id: str) -> Dict[str, Any]:
    plan = next((p for p in load_plan() if p.get("id") == persona_id), None)
    if plan is None:
        raise StudioError(404, f"Não há plano de produção para a persona '{persona_id}'.")
    return plan


def _items(plan: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Todas as etapas da persona por chave: foto de rosto, imagens e vídeos."""
    items: Dict[str, Dict[str, Any]] = {FACE_KEY: {"kind": "image", "key": FACE_KEY}}
    for image in plan.get("images", []):
        items[image["file"]] = {"kind": "image", "key": image["file"], **image}
    for video in plan.get("videos", []):
        items[video["file"]] = {"kind": "video", "key": video["file"], **video}
    return items


def _item(persona_id: str, key: str) -> Dict[str, Any]:
    item = _items(persona_plan(persona_id)).get(key)
    if item is None:
        raise StudioError(404, f"Etapa '{key}' não existe no plano.")
    return item


# ── Estado e arquivos ──────────────────────────────────────────────────────

def _dir(persona_id: str) -> Path:
    return DATA_DIR / "idle_studio" / persona_id


def _state_path(persona_id: str) -> Path:
    return _dir(persona_id) / "state.json"


def _files_dir(persona_id: str) -> Path:
    return _dir(persona_id) / "files"


def _read_state(persona_id: str) -> Dict[str, Any]:
    state = read_json(_state_path(persona_id), default_factory=dict) or {}
    state.setdefault("items", {})
    return state


def _update_item(persona_id: str, key: str, mutate: Callable[[Dict[str, Any]], None]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}

    def mutator(state: Dict[str, Any]) -> None:
        items = state.setdefault("items", {})
        entry = items.setdefault(key, {"status": "pendente", "assets": [], "chosen": None})
        mutate(entry)
        entry["updatedAt"] = _now()
        result.update(entry)

    _state_path(persona_id).parent.mkdir(parents=True, exist_ok=True)
    update_json(_state_path(persona_id), mutator)
    return result


def chosen_asset(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    assets = entry.get("assets") or []
    return next((a for a in assets if a.get("id") == entry.get("chosen")), None) or (assets[0] if assets else None)


def auto_name(key: str, entry: Dict[str, Any], asset: Dict[str, Any]) -> str:
    """Nome pelo da etapa: o escolhido leva o nome exato, as outras variações _v2, _v3…"""
    base = _FILE_EXT.sub("", key)
    ext = Path(asset.get("file") or "").suffix.lower()
    chosen = chosen_asset(entry)
    if chosen and chosen.get("id") == asset.get("id"):
        return f"{base}{ext}"
    others = [a for a in entry.get("assets") or [] if not chosen or a.get("id") != chosen.get("id")]
    index = next((i for i, a in enumerate(others) if a.get("id") == asset.get("id")), 0)
    return f"{base}_v{index + 2}{ext}"


def asset_path(persona_id: str, asset: Dict[str, Any]) -> Path:
    return _files_dir(persona_id) / Path(asset.get("file") or "").name


def _public_entry(persona_id: str, key: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    chosen = chosen_asset(entry)
    assets = [
        {
            "id": a["id"],
            "type": a.get("type"),
            "originalName": a.get("name"),
            "name": auto_name(key, entry, a),
            "at": a.get("at"),
            "source": a.get("source", "upload"),
            "url": f"/api/v1/idle-studio/{persona_id}/assets/{a['id']}",
        }
        for a in entry.get("assets") or []
    ]
    return {
        "status": entry.get("status", "pendente"),
        "assets": assets,
        "chosen": chosen["id"] if chosen else None,
        "updatedAt": entry.get("updatedAt"),
    }


def studio_view(persona_id: str) -> Dict[str, Any]:
    plan = persona_plan(persona_id)
    state = _read_state(persona_id)
    items = {key: _public_entry(persona_id, key, entry) for key, entry in state["items"].items()}
    return {
        "persona": {k: plan[k] for k in ("id", "name", "ficha", "negative") if k in plan},
        "images": plan.get("images", []),
        "videos": plan.get("videos", []),
        "items": items,
        "lastFlow": state.get("lastFlow"),
        "providers": providers_status(),
    }


def list_personas() -> List[Dict[str, str]]:
    return [{"id": p["id"], "name": p.get("name") or p["id"]} for p in load_plan() if p.get("id")]


# ── Anexos ─────────────────────────────────────────────────────────────────

def add_asset(persona_id: str, key: str, data: bytes, content_type: str, original_name: str, source: str = "upload") -> Dict[str, Any]:
    item = _item(persona_id, key)
    allowed = VIDEO_TYPES if item["kind"] == "video" else IMAGE_TYPES
    ext = allowed.get((content_type or "").split(";")[0].strip().lower())
    if ext is None:
        kinds = "MP4 ou WebM" if item["kind"] == "video" else "PNG, JPG ou WEBP"
        raise StudioError(400, f"Formato não aceito nesta etapa: envie {kinds}.")
    if not data:
        raise StudioError(400, "Arquivo vazio.")
    if item["kind"] == "image" and len(data) > MAX_IMAGE_BYTES:
        raise StudioError(413, "Imagem acima de 20 MB.")

    asset_id = uuid.uuid4().hex
    files = _files_dir(persona_id)
    files.mkdir(parents=True, exist_ok=True)
    (files / f"{asset_id}{ext}").write_bytes(data)
    asset = {
        "id": asset_id,
        "file": f"{asset_id}{ext}",
        "type": content_type.split(";")[0].strip().lower(),
        "name": Path(original_name or f"{key}{ext}").name[:160],
        "at": _now(),
        "source": source,
    }

    def mutate(entry: Dict[str, Any]) -> None:
        entry.setdefault("assets", []).append(asset)
        if not entry.get("chosen"):
            entry["chosen"] = asset_id
        if entry.get("status") in (None, "pendente", "refazer"):
            entry["status"] = "gerado"

    return _public_entry(persona_id, key, _update_item(persona_id, key, mutate))


def remove_asset(persona_id: str, key: str, asset_id: str) -> Dict[str, Any]:
    _item(persona_id, key)
    removed: List[Dict[str, Any]] = []

    def mutate(entry: Dict[str, Any]) -> None:
        assets = entry.get("assets") or []
        removed.extend(a for a in assets if a.get("id") == asset_id)
        entry["assets"] = [a for a in assets if a.get("id") != asset_id]
        if entry.get("chosen") == asset_id:
            entry["chosen"] = entry["assets"][0]["id"] if entry["assets"] else None
        if not entry["assets"]:
            entry["status"] = "pendente"

    entry = _update_item(persona_id, key, mutate)
    if not removed:
        raise StudioError(404, "Anexo não encontrado.")
    try:
        asset_path(persona_id, removed[0]).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("Não consegui apagar o arquivo do anexo %s: %s", asset_id, exc)
    return _public_entry(persona_id, key, entry)


def update_item(persona_id: str, key: str, *, status: Optional[str] = None, chosen: Optional[str] = None) -> Dict[str, Any]:
    _item(persona_id, key)
    if status is not None and status not in STATUSES:
        raise StudioError(400, f"Status inválido: {status}")

    def mutate(entry: Dict[str, Any]) -> None:
        if chosen is not None:
            if not any(a.get("id") == chosen for a in entry.get("assets") or []):
                raise StudioError(404, "Anexo não encontrado.")
            entry["chosen"] = chosen
        if status is not None:
            if status == "aprovado" and not entry.get("assets"):
                raise StudioError(400, "Anexe o resultado antes de aprovar.")
            entry["status"] = status

    return _public_entry(persona_id, key, _update_item(persona_id, key, mutate))


def find_asset(persona_id: str, asset_id: str) -> tuple[str, Dict[str, Any], Dict[str, Any]]:
    """(chave da etapa, entrada, anexo) de um anexo; StudioError 404 se não existir."""
    if not _ASSET_ID.match(asset_id or ""):
        raise StudioError(404, "Anexo não encontrado.")
    persona_plan(persona_id)
    for key, entry in _read_state(persona_id)["items"].items():
        for asset in entry.get("assets") or []:
            if asset.get("id") == asset_id and asset_path(persona_id, asset).exists():
                return key, entry, asset
    raise StudioError(404, "Anexo não encontrado.")


def _approved_path(persona_id: str, state: Dict[str, Any], key: str) -> Optional[Path]:
    entry = state["items"].get(key) or {}
    asset = chosen_asset(entry) if entry.get("status") == "aprovado" else None
    path = asset_path(persona_id, asset) if asset else None
    return path if path and path.exists() else None


# ── Fluxo reativo a partir dos clipes aprovados ───────────────────────────

def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower().strip()


# Evento do plano → gatilho do motor (gift / comment / alert / manual).
# Faixas de presente por quantidade: o motor ainda não sabe o valor em moedas;
# dá para trocar por um presente específico em Automações › Gatilhos.
EVENT_TRIGGERS: Dict[str, Dict[str, Any]] = {
    "follow": {"eventType": "alert", "conditions": {}, "label": "Novo seguidor", "priority": 2},
    "presente": {"eventType": "gift", "conditions": {}, "label": "Presente", "priority": 1},
    "presente pequeno": {"eventType": "gift", "conditions": {}, "label": "Presente pequeno", "priority": 1},
    "presente medio": {"eventType": "gift", "conditions": {"minQuantity": 5}, "label": "Presente médio (5+)", "priority": 2},
    "presente grande": {"eventType": "gift", "conditions": {"minQuantity": 20}, "label": "Presente grande (20+)", "priority": 3},
    "msg engracada": {"eventType": "comment", "conditions": {"keyword": "kkk"}, "label": "Chat ri (kkk)", "priority": 1},
    "elogio": {"eventType": "comment", "conditions": {"keyword": "linda"}, "label": "Elogio (linda)", "priority": 1},
    "pergunta": {"eventType": "comment", "conditions": {"keyword": "?"}, "label": "Pergunta no chat", "priority": 0},
    "provocacao": {"eventType": "comment", "conditions": {"keyword": "feia"}, "label": "Provocação (feia)", "priority": 1},
}


def _trigger_spec(video: Dict[str, Any]) -> Dict[str, Any]:
    spec = EVENT_TRIGGERS.get(_fold(video.get("event", "")))
    if spec:
        return spec
    # Meta, segmentos (F1…F5) e o que não tem evento automático: disparo manual.
    label = video.get("event") or video.get("categoryLabel") or "manual"
    return {"eventType": "manual", "conditions": {"keyword": video["file"]}, "label": f"Manual · {label}", "priority": 1}


LOOP_CATEGORIES = ("FLUXO", "TRANSICAO", "ESPECIAL")


def natural_cycle(clips: List[Dict[str, Any]], idle_file: str) -> tuple[List[str], List[str]]:
    """Ordem do ciclo natural (sem a IDLE) e os clipes que ficaram de fora.

    Anda pelos estados: parte de A0, alterna um clipe A0→A0 com uma "saída"
    (A0→X) e, em X, toca os X→X antes de voltar (X→A0). Só sai de A0 para X se
    existir um clipe aprovado X→A0, para o ciclo nunca terminar fora da pose
    da IDLE (o que daria um corte seco).
    """
    remaining = sorted((c for c in clips if c["file"] != idle_file), key=lambda c: c.get("number", 0))
    returns = {c["start"] for c in remaining if c["end"] == "A0" and c["start"] != "A0"}
    order: List[str] = []
    state, excursion_next = "A0", False

    def take(predicate: Callable[[Dict[str, Any]], bool]) -> Optional[Dict[str, Any]]:
        clip = next((c for c in remaining if predicate(c)), None)
        if clip:
            remaining.remove(clip)
            order.append(clip["file"])
        return clip

    while True:
        if state == "A0":
            loop = lambda c: c["start"] == "A0" and c["end"] == "A0"
            out = lambda c: c["start"] == "A0" and c["end"] != "A0" and c["end"] in returns
            if excursion_next:
                clip = take(out) or take(loop)
            else:
                clip = take(loop) or take(out)
            excursion_next = not excursion_next
        else:
            here = state
            clip = take(lambda c: c["start"] == here and c["end"] == here) or take(
                lambda c: c["start"] == here and c["end"] == "A0"
            )
        if clip is None:
            break
        state = clip["end"]
    return order, [c["file"] for c in remaining]


def _video_id(persona_id: str, file: str) -> str:
    return f"{persona_id}_{file}"


def build_flow(persona_id: str, *, publish: bool = False) -> Dict[str, Any]:
    from server.config import VIDEO_TRIGGER_COOLDOWN_MS
    from server.core import persona_manager
    from server.core.config_manager import load_persona_config, save_persona_config
    from server.core.video_files import get_video_directory
    from server.services.workflow_service import workflow_service

    plan = persona_plan(persona_id)
    if persona_manager.get_active_persona_id() != persona_id:
        raise StudioError(409, f"Ative a persona {plan.get('name') or persona_id} antes de montar o fluxo: ele é salvo na persona ativa.")

    state = _read_state(persona_id)
    approved = [(v, p) for v in plan.get("videos", []) if (p := _approved_path(persona_id, state, v["file"]))]
    if not approved:
        raise StudioError(400, "Aprove pelo menos um vídeo para montar o fluxo.")

    # 1. Arquivos na pasta de vídeos do palco (id com a persona: a pasta é única).
    video_dir = get_video_directory() or Path(__file__).resolve().parents[2] / "assets" / "videos"
    video_dir.mkdir(parents=True, exist_ok=True)
    for video, path in approved:
        vid = _video_id(persona_id, video["file"])
        for old in video_dir.glob(f"{vid}.*"):
            if old.suffix.lower() in (".mp4", ".webm") and old.suffix.lower() != path.suffix.lower():
                old.unlink(missing_ok=True)
        target = video_dir / f"{vid}{path.suffix.lower()}"
        if not target.exists() or target.stat().st_size != path.stat().st_size:
            shutil.copyfile(path, target)

    clips = [v for v, _ in approved]
    loop_clips = [v for v in clips if v["category"] in LOOP_CATEGORIES]
    idle = next(
        (v for v in loop_clips if v["start"] == v["end"] == "A0" and v["category"] == "FLUXO"),
        next((v for v in loop_clips if v["start"] == "A0"), clips[0]),
    )
    idle_id = _video_id(persona_id, idle["file"])
    cycle, out_of_cycle = natural_cycle(loop_clips, idle["file"])

    # 2. Vídeos cadastrados na persona (sem apagar os que já existiam).
    config = load_persona_config()
    by_id = {v.get("id"): v for v in config.get("videos", [])}
    for video in clips:
        vid = _video_id(persona_id, video["file"])
        entry = by_id.get(vid) or {"id": vid}
        entry.update(
            {
                "label": video["file"].replace("_", " "),
                "group": video["category"].lower(),
                "description": f"Estúdio da IDLE · {video.get('categoryLabel', '')} · {video['start']}→{video['end']}",
                # Pose do primeiro e do último quadro: o palco usa para emendar
                # uma reação só quando o clipe no ar termina na pose dela.
                "startPose": video["start"],
                "endPose": video["end"],
                "loop": vid == idle_id,
                "missingFile": False,
                "studio": True,
            }
        )
        if vid not in by_id:
            config.setdefault("videos", []).append(entry)
            by_id[vid] = entry
    if not save_persona_config(config):
        raise StudioError(500, "Não consegui salvar os vídeos na persona.")

    # 3. Rascunho do fluxo: troca só o que o Estúdio criou antes.
    draft = workflow_service.get_versioned_workflow("draft")
    def keep(items: Any) -> List[Dict[str, Any]]:
        # O quadro de Automações pode não devolver o campo "studio": o prefixo do id também marca.
        return [
            i for i in items or []
            if not (i.get("studio") or str(i.get("nodeId") or i.get("id") or "").startswith("studio-"))
        ]

    nodes, connections, triggers = keep(draft.get("flowNodes")), keep(draft.get("flowConnections")), keep(draft.get("triggers"))

    node_of: Dict[str, str] = {}
    columns = {"FLUXO": 0, "TRANSICAO": 0, "ESPECIAL": 0, "GATILHO": 1, "SEGMENTO": 2}
    rows: Dict[int, int] = {}
    for video in [idle] + [v for v in clips if v is not idle]:
        col = columns.get(video["category"], 2)
        row = rows.get(col, 0)
        rows[col] = row + 1
        vid = _video_id(persona_id, video["file"])
        node_of[video["file"]] = f"studio-{vid}"
        nodes.append(
            {
                "nodeId": node_of[video["file"]],
                "videoId": vid,
                "label": video["file"].replace("_", " "),
                "position": {"x": 80 + col * 360 + (row % 2) * 150, "y": 80 + row * 110},
                "playback": {"startSec": 0.0, "endSec": None, "transitionMs": 220},
                "audio": {"mode": "muted", "volume": 1.0, "trackId": "", "trackUrl": ""},
                "studio": True,
            }
        )

    def connect(src: str, dst: str, trigger_id: str = "") -> None:
        connections.append(
            {
                "id": f"studio-flow-{len(connections)}-{src}-{dst}"[:120],
                "fromNodeId": node_of[src],
                "toNodeId": node_of[dst],
                "fromVideoId": _video_id(persona_id, src),
                "toVideoId": _video_id(persona_id, dst),
                "triggerId": trigger_id,
                "returnToIdle": True,
                "connectionSettings": {"transitionMs": 220, "fadeMode": "crossfade", "previewTailSec": 2.0, "previewHeadSec": 2.0},
                "studio": True,
            }
        )

    chain = [idle["file"]] + cycle
    if len(chain) > 1:
        for src, dst in zip(chain, chain[1:] + [idle["file"]]):
            connect(src, dst)

    seen: set[str] = set()
    for video in clips:
        if video["category"] in LOOP_CATEGORIES:
            continue
        spec = _trigger_spec(video)
        signature = f"{spec['eventType']}:{sorted(spec['conditions'].items())}"
        alternative = signature in seen and spec["eventType"] != "manual"
        seen.add(signature)
        vid = _video_id(persona_id, video["file"])
        trigger_id = f"studio-trigger-{vid}"
        triggers.append(
            {
                "id": trigger_id,
                "name": f"{spec['label']} → {video['file']}" + (" (alternativa)" if alternative else ""),
                "enabled": not alternative,
                "eventType": spec["eventType"],
                "conditions": dict(spec["conditions"]),
                "actions": [
                    {
                        "type": "play_video",
                        "nodeId": node_of[video["file"]],
                        "videoId": vid,
                        "playback": {"startSec": 0, "endSec": None, "transitionMs": 220},
                        "returnToIdle": True,
                    }
                ],
                "priority": spec["priority"],
                "cooldown_ms": VIDEO_TRIGGER_COOLDOWN_MS,
                "studio": True,
            }
        )
        connect(idle["file"], video["file"], trigger_id)

    canvas_ids = list(dict.fromkeys([*(draft.get("flowCanvasVideoIds") or []), *(_video_id(persona_id, v["file"]) for v in clips)]))
    try:
        workflow_service.save_draft(
            {
                "workflowName": draft.get("workflowName") or f"IDLE {plan.get('name') or persona_id}",
                "idleVideoId": idle_id,
                "flowNodes": nodes,
                "flowConnections": connections,
                "triggers": triggers,
            }
        )
        config = load_persona_config()
        config["flowCanvasVideoIds"] = canvas_ids
        save_persona_config(config)
        published = bool(publish)
        if publish:
            workflow_service.publish_draft()
    except (RuntimeError, ValueError) as exc:
        raise StudioError(500, f"Não consegui salvar o fluxo: {exc}") from exc

    summary = {
        "at": _now(),
        "published": published,
        "idleVideoId": idle_id,
        "videos": len(clips),
        "cycle": len(chain),
        "outOfCycle": out_of_cycle,
        "triggers": sum(1 for t in triggers if t.get("studio")),
        "alternatives": sum(1 for t in triggers if t.get("studio") and not t.get("enabled")),
    }
    update_json(_state_path(persona_id), lambda s: s.__setitem__("lastFlow", summary))
    return summary


# ── Geração por API ────────────────────────────────────────────────────────

_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def providers_status() -> Dict[str, Any]:
    from server.config import GEMINI_API_KEY, HIGGSFIELD_KEY_ID, PHOTO_GEN_PROVIDER, VIDEO_GEN_PROVIDER

    image_ready = bool(HIGGSFIELD_KEY_ID) if PHOTO_GEN_PROVIDER == "higgsfield" else bool(GEMINI_API_KEY)
    video_ready = VIDEO_GEN_PROVIDER not in ("", "placeholder")
    return {
        "image": {"name": PHOTO_GEN_PROVIDER, "ready": image_ready or bool(GEMINI_API_KEY)},
        "video": {"name": VIDEO_GEN_PROVIDER or "placeholder", "ready": video_ready},
    }


def _job_set(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        _jobs.setdefault(job_id, {}).update(fields)


def job_status(job_id: str) -> Dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise StudioError(404, "Geração não encontrada (o Odessa pode ter reiniciado).")
        return dict(job)


def _input_paths(persona_id: str, state: Dict[str, Any], item: Dict[str, Any]) -> List[Path]:
    if item["kind"] == "video":
        keys = [item["firstFrame"], item["lastFrame"]]
    else:
        inputs = item.get("inputs") or ""
        keys = [] if inputs in ("", "nenhuma") else [
            FACE_KEY if k.strip().startswith("foto de rosto") else k.strip() for k in inputs.split("+")
        ]
    paths = [_approved_path(persona_id, state, k) for k in dict.fromkeys(keys)]
    missing = [k for k, p in zip(dict.fromkeys(keys), paths) if p is None]
    if missing:
        raise StudioError(409, "Aprove antes: " + ", ".join(missing))
    return [p for p in paths if p]


def start_generation(persona_id: str, key: str) -> Dict[str, Any]:
    plan = persona_plan(persona_id)
    item = _item(persona_id, key)
    if key == FACE_KEY or not item.get("prompt"):
        raise StudioError(400, "Esta etapa não tem prompt para gerar.")
    status = providers_status()[item["kind"]]
    if not status["ready"]:
        what = "vídeo (VIDEO_GEN_PROVIDER)" if item["kind"] == "video" else "imagem (GEMINI_API_KEY ou Higgsfield)"
        raise StudioError(409, f"Nenhum provedor de {what} configurado no backend.")
    inputs = _input_paths(persona_id, _read_state(persona_id), item)
    with _jobs_lock:
        running = next((j for j in _jobs.values() if j.get("key") == key and j.get("personaId") == persona_id and j.get("status") == "generating"), None)
    if running:
        return running
    job_id = uuid.uuid4().hex
    _job_set(job_id, jobId=job_id, personaId=persona_id, key=key, status="generating", provider=status["name"], startedAt=_now())
    prompt = item["prompt"] if item["kind"] == "image" else f"{item['prompt']}\n\nAvoid: {plan.get('negative', '')}"
    threading.Thread(target=_run_generation, args=(job_id, persona_id, item, prompt, inputs), daemon=True).start()
    return job_status(job_id)


def _run_generation(job_id: str, persona_id: str, item: Dict[str, Any], prompt: str, inputs: List[Path]) -> None:
    try:
        if item["kind"] == "image":
            from server.api.v1.endpoints.persona_photogen import _generate_image_bytes  # noqa: PLC0415
            from server.services.ai_service import ai_service

            if inputs:
                data, provider = ai_service.generate_gemini_image(prompt, reference_image_path=inputs[0]), "gemini"
            else:
                data, provider = _generate_image_bytes(persona_id, prompt)
            content_type = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
        else:
            from server.services.video_gen.registry import get_provider

            out = _files_dir(persona_id) / f".gen-{job_id}.mp4"
            result = get_provider().generate(
                prompt=prompt,
                base_image_path=inputs[0],
                output_path=out,
                reference_images=inputs[1:],
            )
            if not result.ok or not result.video_path or not Path(result.video_path).exists():
                raise RuntimeError(result.error or "o provedor não devolveu o vídeo")
            data, provider, content_type = Path(result.video_path).read_bytes(), result.provider, "video/mp4"
            Path(result.video_path).unlink(missing_ok=True)
        entry = add_asset(persona_id, item["key"], data, content_type, f"{item['key']}-{provider}", source=provider)
        _job_set(job_id, status="done", finishedAt=_now(), item=entry)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[idle-studio] geração de %s falhou: %s", item["key"], exc)
        _job_set(job_id, status="error", finishedAt=_now(), error=str(exc)[:300])
