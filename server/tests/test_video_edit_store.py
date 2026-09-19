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


def test_historico_registra_versoes_da_mais_nova_para_a_mais_antiga(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {"volume": 0.2})
    store.put("v1", {"volume": 0.5})
    versions = store.history("v1")
    assert [v["edit"]["volume"] for v in versions] == [0.5, 0.2]
    assert all(v["action"] == "save" and v["savedAt"] for v in versions)


def test_put_identico_nao_polui_o_historico(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {"volume": 0.2})
    store.put("v1", {"volume": 0.2})
    assert len(store.history("v1")) == 1


def test_historico_limitado_e_por_clip(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    for i in range(30):
        store.put("v1", {"transitionMs": i * 10})
    store.put("v2", {"volume": 0.1})
    assert len(store.history("v1")) == 20
    assert store.history("v1")[0]["edit"]["transitionMs"] == 290
    assert len(store.history("v2")) == 1


def test_apagar_fica_recuperavel_no_historico(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {"segments": [{"startSec": 0, "endSec": 2}]})
    store.delete("v1")
    latest = store.history("v1")[0]
    assert latest["action"] == "delete"
    assert latest["edit"]["segments"] == [{"startSec": 0.0, "endSec": 2.0}]


def test_historico_nao_guarda_trilha_embutida(tmp_path):
    store = VideoEditStore(tmp_path / "e.json")
    store.put("v1", {"audioMode": "track", "trackUrl": "data:audio/mp3;base64," + "A" * 1000})
    version = store.history("v1")[0]["edit"]
    assert version["trackUrl"] is None and version["trackDropped"] is True
    assert store.get("v1")["trackUrl"].startswith("data:")  # a edição atual mantém a trilha
    store.put("v2", {"audioMode": "track", "trackUrl": "https://x.test/a.mp3"})
    assert store.history("v2")[0]["edit"]["trackUrl"] == "https://x.test/a.mp3"


def test_historico_de_clip_sem_versoes_e_vazio(tmp_path):
    assert VideoEditStore(tmp_path / "e.json").history("nada") == []


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
