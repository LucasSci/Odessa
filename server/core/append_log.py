"""Gravação de linhas em arquivos de log (JSONL) sem reabrir o arquivo a cada linha.

Cada mensagem do chat gerava ~6 aberturas e fechamentos de arquivo (log de
execução da automação + histórico da sessão). No Windows, cada fechamento passa
pelo antivírus: era a maior parte dos ~100 ms por mensagem em /automation/ingest.
Aqui o arquivo fica aberto, cada linha é gravada e enviada ao disco (flush), e o
log é rotacionado ao passar do limite (fica uma geração anterior, `.1`).
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import IO, Dict

MAX_BYTES = 10 * 1024 * 1024

_lock = threading.Lock()
_handles: Dict[str, IO[str]] = {}


def _rotate(path: Path) -> None:
    previous = Path(str(path) + ".1")
    try:
        os.replace(path, previous)
    except OSError:
        pass  # outro processo segurando o arquivo: tenta de novo na próxima linha


def append_line(path: Path, line: str, *, max_bytes: int = MAX_BYTES) -> None:
    key = str(path)
    with _lock:
        handle = _handles.get(key)
        if handle is not None and handle.tell() > max_bytes:
            handle.close()
            del _handles[key]
            _rotate(path)
            handle = None
        if handle is None:
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = _handles[key] = open(path, "a", encoding="utf-8")
        handle.write(line + "\n")
        handle.flush()


def close(path: Path) -> None:
    with _lock:
        handle = _handles.pop(str(path), None)
    if handle is not None:
        handle.close()


def close_all() -> None:
    with _lock:
        handles = list(_handles.values())
        _handles.clear()
    for handle in handles:
        try:
            handle.close()
        except OSError:
            pass
