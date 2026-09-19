from server.services.video_edit_store import VideoEditStore, sanitize_edit, valid_video_id


def test_sanitize_descarta_segmentos_invalidos_e_preserva_ordem():
    edit = sanitize_edit("v1", {
        "segments": [
            {"startSec": 8, "endSec": 10},
            {"startSec": 5, "endSec": 5},
            "lixo",
            {"startSec": 1, "endSec": 3, "speed": 2},
        ],
    })
    assert edit["segments"] == [
        {"startSec": 8.0, "endSec": 10.0},
        {"startSec": 1.0, "endSec": 3.0, "speed": 2.0},
    ]


def test_sanitize_limita_velocidade_volume_e_transicao():
    edit = sanitize_edit("v1", {
        "segments": [{"startSec": 0, "endSec": 1, "speed": 99}],
        "volume": 7,
        "transitionMs": 99999,
        "audioMode": "estranho",
    })
    assert edit["segments"][0]["speed"] == 4.0
    assert edit["volume"] == 1.0
    assert edit["transitionMs"] == 4000
    assert edit["audioMode"] == "muted"


def test_sanitize_aceita_entrada_nao_dict():
    edit = sanitize_edit("v1", None)
    assert edit["segments"] == [] and edit["volume"] == 1.0 and edit["transitionMs"] == 220


def test_valid_video_id():
    assert valid_video_id("01_FLUXO_idle")
    assert not valid_video_id("")
    assert not valid_video_id("a/b")
    assert not valid_video_id("a\\b")
    assert not valid_video_id(None)


def test_put_get_delete_persistem_em_disco(tmp_path):
    path = tmp_path / "edits.json"
    store = VideoEditStore(path)
    assert store.get("v1") is None
    store.put("v1", {"segments": [{"startSec": 0, "endSec": 2}], "volume": 0.5})
    assert VideoEditStore(path).get("v1")["volume"] == 0.5
    assert store.delete("v1") is True
    assert store.delete("v1") is False
    assert VideoEditStore(path).all() == {}


def test_arquivo_corrompido_vira_vazio(tmp_path):
    path = tmp_path / "edits.json"
    path.write_text("{nao-e-json", encoding="utf-8")
    assert VideoEditStore(path).all() == {}


def test_apply_to_clip_sem_edicao_devolve_o_mesmo_clip(tmp_path):
    clip = {"videoId": "v1", "startSec": 0.0, "endSec": None, "transitionMs": 220}
    assert VideoEditStore(tmp_path / "e.json").apply_to_clip(clip) is clip


def test_apply_to_clip_aplica_cortes_velocidade_audio_e_transicao(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {
        "segments": [{"startSec": 8, "endSec": 10}, {"startSec": 1, "endSec": 3, "speed": 2}],
        "audioMode": "original",
        "volume": 0.4,
        "transitionMs": 500,
    })
    clip = {"videoId": "v1", "startSec": 0.0, "endSec": None, "transitionMs": 220,
            "playback": {"startSec": 0.0, "endSec": None, "transitionMs": 220},
            "audio": {"mode": "muted", "volume": 1.0, "trackId": "x"}}
    out = store.apply_to_clip(clip)
    assert out["startSec"] == 1.0 and out["endSec"] == 10.0
    assert out["segments"][1]["speed"] == 2.0
    assert out["transitionMs"] == 500 and out["playback"]["transitionMs"] == 500
    assert out["audio"]["mode"] == "original" and out["audio"]["volume"] == 0.4
    assert out["audio"]["trackId"] == "x"
    assert clip["endSec"] is None  # não muta o original
