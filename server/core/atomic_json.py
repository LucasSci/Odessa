"""Leitura/gravação segura dos arquivos JSON de dados do app.

O app guarda personas, fluxos, vídeos, webhooks etc. em arquivos JSON que várias
requisições e threads leem e reescrevem. O padrão anterior (`open(path, "w")` +
`json.dump`, e "se der erro devolve vazio") tinha dois defeitos que perdem dados:

  1. Escrita no lugar: um crash ou queda de energia no meio deixa o arquivo
     truncado; duas escritas simultâneas se misturam.
  2. Erro de leitura virava "config vazia", e o próximo salvamento gravava esse
     vazio por cima do arquivo original (perdendo gatilhos, fluxo, vídeos).

Aqui:
  - `write_json`: grava num temporário na mesma pasta, faz fsync e troca o nome
    (`os.replace`, atômico); guarda a versão anterior em `<arquivo>.bak`.
  - `read_json`: se o arquivo estiver corrompido, NUNCA devolve vazio por cima
    dele: move o arquivo ruim para `<arquivo>.corrupt-<data>` (nada é apagado),
    restaura o `.bak` se ele estiver íntegro e registra o evento.
  - `update_json`: ler-modificar-gravar sob a trava do arquivo (sem perder
    atualizações concorrentes).
"""

import copy
import json
import logging
import os
import shutil
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

logger = logging.getLogger("odessa.atomic_json")

_locks: Dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()

_events: List[Dict[str, Any]] = []
_MAX_EVENTS = 50


def _key(path: Path) -> str:
    return str(Path(path).resolve())


@contextmanager
def file_lock(path: Path) -> Iterator[None]:
    """Trava reentrante por arquivo (mesmo processo)."""
    key = _key(path)
    with _locks_guard:
        lock = _locks.setdefault(key, threading.RLock())
    with lock:
        yield


def backup_path(path: Path) -> Path:
    return Path(str(path) + ".bak")


def recovery_events() -> List[Dict[str, Any]]:
    """Recuperações recentes de arquivos corrompidos (para diagnóstico/UI)."""
    return copy.deepcopy(_events)


def clear_recovery_events() -> None:
    _events.clear()


def _record(event: Dict[str, Any]) -> None:
    event["at"] = datetime.now().isoformat(timespec="seconds")
    _events.append(event)
    del _events[:-_MAX_EVENTS]


def write_json(
    path: Path,
    data: Any,
    *,
    indent: Optional[int] = 2,
    ensure_ascii: bool = False,
    backup: bool = True,
) -> None:
    """Grava `data` em `path` de forma atômica (levanta em caso de falha; o original fica intacto)."""
    path = Path(path)
    with file_lock(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=indent, ensure_ascii=ensure_ascii)
                handle.flush()
                os.fsync(handle.fileno())
            if backup and path.exists():
                try:
                    shutil.copy2(path, backup_path(path))
                except OSError as exc:
                    logger.warning("Não foi possível criar backup de %s: %s", path.name, exc)
            os.replace(tmp_name, path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise


def _parse(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _quarantine(path: Path) -> Optional[Path]:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = path.with_name(f"{path.name}.corrupt-{stamp}")
    counter = 1
    while target.exists():
        counter += 1
        target = path.with_name(f"{path.name}.corrupt-{stamp}-{counter}")
    try:
        os.replace(path, target)
        return target
    except OSError as exc:
        logger.error("Não foi possível isolar %s corrompido: %s", path.name, exc)
        return None


def read_json(path: Path, default: Any = None, *, default_factory: Optional[Callable[[], Any]] = None) -> Any:
    """Lê o JSON de `path`.

    Ausente → o padrão. Corrompido → isola o arquivo ruim (nunca o sobrescreve),
    tenta o `.bak` e, se ele também não servir, devolve o padrão.
    """

    def fallback() -> Any:
        return default_factory() if default_factory is not None else copy.deepcopy(default)

    path = Path(path)
    with file_lock(path):
        try:
            return _parse(path)
        except FileNotFoundError:
            return fallback()
        except (ValueError, UnicodeDecodeError) as exc:
            logger.error("JSON corrompido em %s: %s", path.name, exc)
        except OSError as exc:
            # Sem permissão/arquivo travado: não mexe no arquivo, só não consegue ler agora.
            logger.warning("Não foi possível ler %s: %s", path.name, exc)
            return fallback()

        quarantined = _quarantine(path)
        bak = backup_path(path)
        try:
            data = _parse(bak)
        except (OSError, ValueError, UnicodeDecodeError):
            _record({"path": path.name, "action": "quarantined", "quarantinePath": quarantined.name if quarantined else None})
            logger.error("%s isolado em %s e sem backup utilizável: usando o padrão.", path.name, quarantined)
            return fallback()

        try:
            shutil.copy2(bak, path)
        except OSError as exc:
            logger.error("Backup de %s é válido mas não foi restaurado: %s", path.name, exc)
        _record({"path": path.name, "action": "restored_from_backup", "quarantinePath": quarantined.name if quarantined else None})
        logger.error("%s corrompido: restaurado a partir do .bak (original em %s).", path.name, quarantined)
        return data


def update_json(
    path: Path,
    mutator: Callable[[Any], Any],
    *,
    default_factory: Callable[[], Any] = dict,
    **write_kwargs: Any,
) -> Any:
    """Ler-modificar-gravar sob a trava do arquivo.

    `mutator` recebe os dados e pode alterá-los no lugar; se devolver algo que não
    seja None, isso vira o novo conteúdo. Devolve o conteúdo gravado.
    """
    path = Path(path)
    with file_lock(path):
        data = read_json(path, default_factory=default_factory)
        result = mutator(data)
        if result is not None:
            data = result
        write_json(path, data, **write_kwargs)
        return data
