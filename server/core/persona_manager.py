"""
persona_manager.py — Gerenciamento de perfis de IA (personas).

Cada persona tem seus próprios vídeos, fluxo, gatilhos e personalidade,
persistidos em um arquivo de config separado. Um índice (personas.json) lista
as personas e aponta qual é a ativa.

"Odessa" é o nome do SOFTWARE, não de uma persona. Instalações antigas tinham
uma persona "odessa" (criada por engano como padrão) cujo conteúdo — vídeos,
fluxo publicado, gatilhos — era na verdade da Viktoria. Na primeira leitura do
índice ela é unida à Viktoria e removida (ver _migrate_legacy_odessa).
"""
import functools
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar

from server.core.atomic_json import file_lock, read_json, write_json

logger = logging.getLogger("odessa.persona")

DATA_DIR = Path(__file__).parent.parent / "data"
PERSONAS_INDEX_PATH = DATA_DIR / "personas.json"
DEFAULT_CONFIG_PATH = DATA_DIR / "persona_config.json"

DEFAULT_PERSONA_ID = "viktoria"
# Persona criada por engano com o nome do software; unida à Viktoria.
LEGACY_PERSONA_ID = "odessa"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_index() -> Dict[str, Any]:
    return {"activePersonaId": DEFAULT_PERSONA_ID, "personas": []}


PERSONA_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


class InvalidPersonaId(ValueError):
    """id de persona fora do padrão (vira parte do nome do arquivo de config)."""


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())[:40].strip("-")
    return slug or "persona"


def _load_index() -> Dict[str, Any]:
    if not PERSONAS_INDEX_PATH.exists():
        return _empty_index()
    try:
        # Índice corrompido NÃO vira "só a Odessa" (o que apagaria as outras
        # personas do índice no próximo salvamento): o arquivo ruim é isolado e
        # o .bak, se íntegro, é restaurado (ver atomic_json.read_json).
        data = read_json(PERSONAS_INDEX_PATH, default_factory=_empty_index)
        if not isinstance(data, dict):
            return _empty_index()
        data.setdefault("activePersonaId", DEFAULT_PERSONA_ID)
        data.setdefault("personas", [])
        return data
    except Exception as exc:
        logger.error("Erro ao carregar índice de personas: %s", exc)
        return _empty_index()


def _save_index(index: Dict[str, Any]) -> bool:
    try:
        write_json(PERSONAS_INDEX_PATH, index)
        return True
    except Exception as exc:
        logger.error("Erro ao salvar índice de personas: %s", exc)
        return False


F = TypeVar("F", bound=Callable[..., Any])


def index_transaction(func: F) -> F:
    """Segura a trava do índice durante todo o ler-modificar-salvar da função.

    Sem isso, duas requisições (ou uma thread de geração de foto) que carregam o
    índice ao mesmo tempo salvam uma por cima da outra e uma alteração se perde.
    A trava é reentrante: funções decoradas podem chamar outras decoradas.
    """

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        with file_lock(PERSONAS_INDEX_PATH):
            return func(*args, **kwargs)

    return wrapper  # type: ignore[return-value]


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _merge_configs(primary: Dict[str, Any], secondary: Dict[str, Any]) -> Dict[str, Any]:
    """`primary` manda; de `secondary` entra o que falta (vídeos por id, chaves vazias)."""
    merged = dict(primary)
    for key, value in secondary.items():
        if key == "videos" and isinstance(value, list):
            known = {v.get("id") for v in merged.get("videos") or [] if isinstance(v, dict)}
            merged["videos"] = list(merged.get("videos") or []) + [
                v for v in value if isinstance(v, dict) and v.get("id") not in known
            ]
        elif _is_empty(merged.get(key)) and not _is_empty(value):
            merged[key] = value
    return merged


def _backup(path: Path, stamp: str) -> None:
    if path.exists():
        shutil.copy2(path, path.with_name(f"{path.stem}.antes-unir-odessa-{stamp}{path.suffix}"))


def _migrate_legacy_odessa(index: Dict[str, Any]) -> bool:
    """Une a persona "odessa" (nome do software) à Viktoria e a remove. Idempotente.

    O config da "odessa" era o completo (fluxo publicado, todos os vídeos,
    gatilhos, presentes) e o da Viktoria uma cópia antiga: a Viktoria passa a ter
    o config da "odessa" + o que só ela tinha (ex.: config de transmissão). A
    identidade da Viktoria (personalidade, fotos) é mantida. Tudo com backup.
    """
    personas = index.get("personas", [])
    legacy = next((p for p in personas if p.get("id") == LEGACY_PERSONA_ID), None)
    if legacy is None:
        return False
    target = next((p for p in personas if p.get("id") == DEFAULT_PERSONA_ID), None)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    _backup(PERSONAS_INDEX_PATH, stamp)

    if target is None:
        # Só existia a "odessa": ela É a Viktoria (mesmo config).
        legacy["id"] = DEFAULT_PERSONA_ID
        legacy["name"] = "Viktoria"
        legacy["personality"] = (legacy.get("personality") or "").replace("Odessa", "Viktoria")
    else:
        legacy_cfg = DATA_DIR / (legacy.get("configPath") or DEFAULT_CONFIG_PATH.name)
        target_cfg = DATA_DIR / (target.get("configPath") or f"persona_{DEFAULT_PERSONA_ID}.json")
        _backup(legacy_cfg, stamp)
        _backup(target_cfg, stamp)
        primary = read_json(legacy_cfg, default_factory=dict) if legacy_cfg.exists() else {}
        secondary = read_json(target_cfg, default_factory=dict) if target_cfg.exists() else {}
        write_json(target_cfg, _merge_configs(primary if isinstance(primary, dict) else {}, secondary if isinstance(secondary, dict) else {}))
        for key in ("avatarUrl",):
            if _is_empty(target.get(key)) and not _is_empty(legacy.get(key)):
                target[key] = legacy[key]
        personas.remove(legacy)

    if index.get("activePersonaId") in (LEGACY_PERSONA_ID, None, ""):
        index["activePersonaId"] = DEFAULT_PERSONA_ID
    logger.info("Persona 'odessa' unida à Viktoria (backup: *.antes-unir-odessa-%s.json)", stamp)
    return True


def _ensure_default_persona(index: Dict[str, Any]) -> Dict[str, Any]:
    """Índice sempre utilizável: migra a "odessa" legada e garante uma persona ativa."""
    with file_lock(PERSONAS_INDEX_PATH):
        changed = _migrate_legacy_odessa(index)
        personas = index.setdefault("personas", [])
        if not personas:
            # Instalação nova: a Viktoria usa o config legado (persona_config.json).
            personas.append(
                {
                    "id": DEFAULT_PERSONA_ID,
                    "name": "Viktoria",
                    "description": "Persona elegante e misteriosa, com tom sofisticado e sedutor.",
                    "personality": "",
                    "configPath": DEFAULT_CONFIG_PATH.name,
                    "createdAt": _now(),
                }
            )
            changed = True
        ids = [p.get("id") for p in personas]
        if index.get("activePersonaId") not in ids:
            index["activePersonaId"] = DEFAULT_PERSONA_ID if DEFAULT_PERSONA_ID in ids else ids[0]
            changed = True
        if changed:
            _save_index(index)
    return index


def list_personas() -> List[Dict[str, Any]]:
    index = _ensure_default_persona(_load_index())
    return index.get("personas", [])


def get_active_persona_id() -> str:
    index = _ensure_default_persona(_load_index())
    return index.get("activePersonaId") or DEFAULT_PERSONA_ID


def get_persona(persona_id: str) -> Optional[Dict[str, Any]]:
    index = _ensure_default_persona(_load_index())
    return next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)


def get_active_persona() -> Dict[str, Any]:
    pid = get_active_persona_id()
    persona = get_persona(pid)
    if persona is None:
        persona = {"id": pid, "name": pid, "configPath": f"persona_{pid}.json"}
    return persona


def get_persona_config_path(persona_id: Optional[str] = None) -> Path:
    """Caminho do arquivo de config da persona (ativa por padrão)."""
    pid = persona_id or get_active_persona_id()
    persona = get_persona(pid)
    if persona and persona.get("configPath"):
        return DATA_DIR / persona["configPath"]
    return DEFAULT_CONFIG_PATH


@index_transaction
def set_active_persona(persona_id: str) -> bool:
    index = _ensure_default_persona(_load_index())
    if not any(p.get("id") == persona_id for p in index.get("personas", [])):
        return False
    index["activePersonaId"] = persona_id
    return _save_index(index)


@index_transaction
def create_persona(meta: Dict[str, Any]) -> Dict[str, Any]:
    index = _ensure_default_persona(_load_index())
    persona_id = str(meta.get("id") or "").strip() or _slugify(meta.get("name") or "persona")
    # O id entra no nome do arquivo (persona_<id>.json): "../x" escreveria fora de data/.
    if not PERSONA_ID_RE.fullmatch(persona_id):
        raise InvalidPersonaId("id inválido: use 1-40 letras minúsculas, números, '-' ou '_'")
    if any(p.get("id") == persona_id for p in index.get("personas", [])):
        raise ValueError(f"Persona '{persona_id}' já existe")
    config_path = f"persona_{persona_id}.json"
    persona = {
        "id": persona_id,
        "name": str(meta.get("name") or persona_id),
        "description": str(meta.get("description") or ""),
        "personality": str(meta.get("personality") or ""),
        "avatarUrl": str(meta.get("avatarUrl") or ""),
        "configPath": config_path,
        "createdAt": _now(),
    }
    index["personas"].append(persona)
    if not _save_index(index):
        raise RuntimeError("Falha ao salvar índice de personas")

    # Cria o arquivo de config vazio da nova persona (import lazy p/ evitar ciclo)
    from server.core.config_manager import _empty_config

    cfg_path = DATA_DIR / config_path
    if not cfg_path.exists():
        write_json(cfg_path, _empty_config(), backup=False)
    return persona


def get_persona_personality(persona_id: Optional[str] = None) -> str:
    """Retorna a personalidade (prompt de sistema) de uma persona."""
    pid = persona_id or get_active_persona_id()
    persona = get_persona(pid)
    if persona and persona.get("personality"):
        return persona["personality"]
    return ""


@index_transaction
def set_persona_personality(persona_id: str, personality: str) -> bool:
    """Define a personalidade (prompt de sistema) de uma persona."""
    index = _ensure_default_persona(_load_index())
    persona = next((p for p in index.get("personas", []) if p.get("id") == persona_id), None)
    if persona is None:
        return False
    persona["personality"] = personality
    return _save_index(index)


@index_transaction
def delete_persona(persona_id: str) -> bool:
    index = _ensure_default_persona(_load_index())
    personas = [p for p in index.get("personas", []) if p.get("id") != persona_id]
    if len(personas) == len(index.get("personas", [])):
        return False
    if not personas:
        raise ValueError("Não é possível excluir a única persona")
    index["personas"] = personas
    if index.get("activePersonaId") == persona_id:
        index["activePersonaId"] = personas[0]["id"]
    _save_index(index)
    return True
