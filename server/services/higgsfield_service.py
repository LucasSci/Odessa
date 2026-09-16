"""
higgsfield_service.py — Cliente compartilhado da API do Higgsfield
(https://api.higgsfield.ai), usado tanto pra fotos (SoulId, consistência de
personagem entre gerações) quanto pra vídeos (image2video/dop) da persona.

Modelo assíncrono por job (confirmado na documentação pública do Higgsfield):
  submit -> recebe {request_id, status_url, cancel_url}
  -> poll em status_url até status virar completed/failed/nsfw
  -> lê a URL da mídia em jobs[0].results.raw.url e baixa os bytes.

Autenticação: header "Authorization: Key KEY_ID:KEY_SECRET".

Nota: os nomes exatos de campo dos payloads de request (`prompt`,
`reference_image` etc.) foram montados a partir da documentação pública do
Higgsfield, não de testes contra a API real com credenciais válidas — ao
ativar HIGGSFIELD_KEY_ID/HIGGSFIELD_KEY_SECRET pela primeira vez, vale
conferir a resposta de um job real contra docs.higgsfield.ai e ajustar aqui
se algum campo tiver mudado de nome.
"""
from __future__ import annotations

import base64
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from server.config import (
    HIGGSFIELD_BASE_URL,
    HIGGSFIELD_KEY_ID,
    HIGGSFIELD_KEY_SECRET,
    HIGGSFIELD_POLL_INTERVAL_SEC,
    HIGGSFIELD_POLL_TIMEOUT_SEC,
)
from server.core.persona_assets import get_asset_path, get_primary_asset

logger = logging.getLogger("odessa.higgsfield")


class HiggsfieldError(RuntimeError):
    """Erro de qualquer etapa do fluxo submit -> poll -> download."""


def _auth_header() -> dict[str, str]:
    if not HIGGSFIELD_KEY_ID or not HIGGSFIELD_KEY_SECRET:
        raise HiggsfieldError(
            "HIGGSFIELD_KEY_ID/HIGGSFIELD_KEY_SECRET não estão configuradas no backend"
        )
    return {"Authorization": f"Key {HIGGSFIELD_KEY_ID}:{HIGGSFIELD_KEY_SECRET}"}


def submit_job(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    """POSTa para um endpoint do Higgsfield (ex.: "/v1/text2image/soul") e
    retorna {"request_id", "status_url", "cancel_url"}."""
    url = endpoint if endpoint.startswith("http") else f"{HIGGSFIELD_BASE_URL}{endpoint}"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, json=payload, headers=_auth_header())
    resp.raise_for_status()
    data = resp.json()
    if not data.get("status_url"):
        raise HiggsfieldError(f"Resposta inesperada do Higgsfield ao submeter job: {data}")
    return data


def poll_job(
    status_url: str,
    *,
    interval_sec: float | None = None,
    timeout_sec: float | None = None,
) -> dict[str, Any]:
    """Faz polling em status_url até completed/failed/nsfw ou até estourar o
    timeout — nunca fica preso pra sempre num job travado do Higgsfield."""
    interval = interval_sec if interval_sec is not None else HIGGSFIELD_POLL_INTERVAL_SEC
    timeout = timeout_sec if timeout_sec is not None else HIGGSFIELD_POLL_TIMEOUT_SEC
    deadline = time.monotonic() + timeout

    with httpx.Client(timeout=30.0) as client:
        while True:
            resp = client.get(status_url, headers=_auth_header())
            resp.raise_for_status()
            data = resp.json()
            status = str(data.get("status") or "").lower()
            if status in {"completed", "failed", "nsfw", "error"}:
                return data
            if time.monotonic() >= deadline:
                raise HiggsfieldError(f"Job do Higgsfield excedeu o tempo limite ({timeout:.0f}s)")
            time.sleep(interval)


def download_result(job_result: dict[str, Any]) -> bytes:
    """Extrai a URL da mídia final do resultado do job e baixa os bytes."""
    jobs = job_result.get("jobs") or []
    if not jobs:
        raise HiggsfieldError(f"Job do Higgsfield sem resultados: {job_result}")
    results = jobs[0].get("results") or {}
    media_url = (results.get("raw") or {}).get("url") or (results.get("min") or {}).get("url")
    if not media_url:
        raise HiggsfieldError(f"Job do Higgsfield sem URL de mídia no resultado: {job_result}")
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(media_url)
    resp.raise_for_status()
    return resp.content


def _run_job(endpoint: str, payload: dict[str, Any]) -> bytes:
    """Fluxo completo: submit -> poll -> download. Levanta HiggsfieldError
    em qualquer falha (chamador decide o fallback, ex.: Gemini pra fotos)."""
    submitted = submit_job(endpoint, payload)
    result = poll_job(submitted["status_url"])
    status = str(result.get("status") or "").lower()
    if status != "completed":
        raise HiggsfieldError(f"Job do Higgsfield terminou com status '{status}'")
    return download_result(result)


def _face_reference_b64(persona_id: str) -> str | None:
    """Codifica o rosto principal da persona em base64, pra usar como
    referência de personagem (SoulId) — sem isso a foto/vídeo gerado não
    tem garantia de parecer com a persona."""
    primary_face = get_primary_asset(persona_id, "faces")
    if not primary_face:
        return None
    face_path = get_asset_path(persona_id, "faces", primary_face["id"])
    if not face_path or not face_path.exists():
        return None
    return base64.b64encode(face_path.read_bytes()).decode("ascii")


def generate_character_photo(persona_id: str, prompt: str) -> bytes:
    """Gera uma foto nova via SoulId (texto->imagem com referência de
    personagem), usando o rosto principal já cadastrado da persona como
    referência — é isso que mantém a "cara" consistente entre gerações.
    Levanta HiggsfieldError em qualquer falha (chamador decide o fallback).
    """
    payload: dict[str, Any] = {"prompt": prompt}
    reference_b64 = _face_reference_b64(persona_id)
    if reference_b64:
        payload["reference_image"] = reference_b64
    return _run_job("/v1/text2image/soul", payload)


def generate_video_from_image(
    image_path: Path,
    prompt: str,
    *,
    duration_sec: float = 4.0,
) -> bytes:
    """Anima uma imagem base num vídeo curto via image2video/dop (controle
    de câmera) — usado pelo HiggsfieldVideoProvider do pipeline de
    video-gen. `image_path` já É o rosto/frame de referência (resolvido por
    video_gen_service._resolve_base_image antes de chegar aqui), então não
    precisa de uma referência de personagem separada como em
    generate_character_photo — animar essa mesma imagem já preserva a cara.
    """
    image_b64 = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
    payload: dict[str, Any] = {"image": image_b64, "prompt": prompt, "duration": duration_sec}
    return _run_job("/v1/image2video/dop", payload)
