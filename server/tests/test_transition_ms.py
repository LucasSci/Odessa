from server.core.config_manager import (
    _connection_settings,
    _playback_settings,
    parse_transition_ms,
)
from server.services.video_edit_store import VideoEditStore


def test_zero_e_valido_e_nao_vira_o_padrao():
    assert parse_transition_ms(0) == 0
    assert parse_transition_ms("0") == 0
    assert parse_transition_ms(0.0) == 0


def test_padrao_so_quando_ausente_ou_invalido():
    assert parse_transition_ms(None) == 220
    assert parse_transition_ms("") == 220
    assert parse_transition_ms("abc") == 220
    assert parse_transition_ms(None, default=500) == 500


def test_limita_ao_intervalo():
    assert parse_transition_ms(99999) == 2000
    assert parse_transition_ms(-50) == 0
    assert parse_transition_ms(350) == 350


def test_playback_e_conexao_preservam_zero():
    assert _playback_settings({"transitionMs": 0})["transitionMs"] == 0
    assert _playback_settings({})["transitionMs"] == 220
    assert _connection_settings({"transitionMs": 0, "fadeMode": "cut"})["transitionMs"] == 0
    assert _connection_settings({})["transitionMs"] == 220


def test_edicao_com_transicao_zero_chega_ao_clip(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {"segments": [{"startSec": 0, "endSec": 2}], "transitionMs": 0})
    clip = {"videoId": "v1", "startSec": 0.0, "endSec": None, "transitionMs": 220,
            "playback": {"startSec": 0.0, "endSec": None, "transitionMs": 220}}
    out = store.apply_to_clip(clip)
    assert out["transitionMs"] == 0
    assert out["playback"]["transitionMs"] == 0
