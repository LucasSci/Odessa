import pytest

import server.services.memory_service as memory_module
from server.core.database import Database
from server.services.memory_service import MemoryService


@pytest.fixture()
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(memory_module, "db", Database(tmp_path / "memory.db"))
    return MemoryService()


def _event(user, text, kind="chat", **metadata):
    return {"kind": kind, "text": text, "source": "bridge", "metadata": {"user": user, **metadata}}


def test_lote_da_bridge_com_mesmo_usuario_nao_colide(service):
    result = service.upsert_round_memory([_event("ana", "oi"), _event("ana", "tudo bem?"), _event("ana", "kkk")])
    assert result["usersRecognized"] == 1
    profile = service.get_profile("ana")
    assert profile["profile"]["total_messages"] == 3
    assert len(profile["interactions"]) == 3


def test_reconhece_recorrente_e_presenteador(service):
    first = service.upsert_round_memory([_event("bia", "primeira vez aqui")])
    assert first["users"][0]["returning"] is False
    again = service.upsert_round_memory([_event("bia", "enviou Rosa", kind="gift", quantity=2)])
    assert again["users"][0]["returning"] is True
    assert again["users"][0]["totalGifts"] == 2


def test_resetar_aprendizado_apaga_tudo(service):
    service.upsert_round_memory([_event("ana", "oi"), _event("bia", "olá")])
    assert service.clear_all() == {"status": "cleared", "usersCleared": 2}
    assert service.get_profile("ana") is None
    assert service.list_profiles()["profiles"] == []


def test_ocultado_nao_entra_no_contexto_da_ia(service):
    service.upsert_round_memory([_event("ana", "oi")])
    service.hide_profile("ana", True)
    context = service.build_user_context("ana")
    assert context["hidden"] is True and context["context"] == ""
    summary = service.upsert_round_memory([_event("ana", "voltei")])
    assert summary["usersRecognized"] == 0 and summary["context"] == ""
    # Os contadores continuam: ocultar não apaga.
    assert service.get_profile("ana")["profile"]["total_messages"] == 2
    service.hide_profile("ana", False)
    assert service.build_user_context("ana")["context"].startswith("Usuario @ana")


def test_esquecer_um_espectador_nao_afeta_os_outros(service):
    service.upsert_round_memory([_event("ana", "oi"), _event("bia", "olá")])
    assert service.clear_profile("ana")["status"] == "cleared"
    assert service.get_profile("ana") is None
    assert service.get_profile("bia") is not None
