"""Reação de gatilho entra emendada: espera o clipe no ar terminar na pose dela."""
import time

from server.services.video_service import PENDING_REACTION_MAX_S, VideoService

IDLE = "v_40_FLUXO_A0_respira"
A0_CLIP = "v_41_FLUXO_A0_inclina"
TO_A1 = "v_52_TRANSICAO_A0-A1_vira_chat"
A1_CLIP = "v_58_FLUXO_A1_lendo"
TO_A0 = "v_53_TRANSICAO_A1-A0_volta_camera"
REACTION = "v_74_GATILHO_A0_beijo"


def node(video_id):
    return {"nodeId": f"n-{video_id}", "videoId": video_id, "playback": {"startSec": 0, "endSec": None, "transitionMs": 220}}


def make_service():
    chain = [IDLE, A0_CLIP, TO_A1, A1_CLIP, TO_A0]
    svc = VideoService()
    svc._config = {
        "idleVideoId": IDLE,
        "videos": [{"id": v} for v in chain + [REACTION]],
        "flowNodes": [node(v) for v in chain + [REACTION]],
        "flowConnections": [
            {"id": f"c{i}", "fromNodeId": f"n-{a}", "toNodeId": f"n-{b}", "triggerId": ""}
            for i, (a, b) in enumerate(zip(chain, chain[1:] + [IDLE]))
        ]
        + [{"id": "ct", "fromNodeId": f"n-{IDLE}", "toNodeId": f"n-{REACTION}", "triggerId": "t1"}],
        "triggers": [{"id": "t1", "eventType": "gift"}],
    }
    svc.pending_reaction = None
    return svc


def play(svc, video_id):
    svc.force_clip(svc._clip_from_node(node(video_id)))


def react(svc, **extra):
    return svc.handle_video_action({"type": "play_video", "nodeId": f"n-{REACTION}", "videoId": REACTION, **extra})


def test_pose_vem_do_nome_e_da_descricao():
    svc = make_service()
    assert svc._poses(A0_CLIP) == ("A0", "A0")
    assert svc._poses(TO_A1) == ("A0", "A1")
    assert svc._poses("qualquer_video") is None
    svc._config["videos"].append({"id": "x", "description": "Estúdio da IDLE · Fluxo · A2→A0"})
    assert svc._poses("x") == ("A2", "A0")
    svc._config["videos"].append({"id": "y", "startPose": "a1", "endPose": "a1"})
    assert svc._poses("y") == ("A1", "A1")


def test_reacao_espera_o_clipe_terminar_na_mesma_pose():
    svc = make_service()
    play(svc, A0_CLIP)
    result = react(svc)
    assert result["deferred"] is True
    # o clipe no ar não foi cortado; a reação é o próximo
    assert svc.current_video_id == A0_CLIP
    assert svc.get_state()["upcoming"][0]["videoId"] == REACTION
    svc.advance(from_video_id=A0_CLIP)
    assert svc.current_video_id == REACTION
    assert svc.pending_reaction is None
    # depois dela, volta ao idle normalmente
    svc.advance(from_video_id=REACTION)
    assert svc.current_video_id == IDLE


def test_reacao_noutra_pose_passa_antes_pela_transicao_de_volta():
    svc = make_service()
    play(svc, A1_CLIP)
    react(svc)
    assert svc.get_state()["upcoming"][0]["videoId"] == TO_A0
    svc.advance(from_video_id=A1_CLIP)
    assert svc.current_video_id == TO_A0
    svc.advance(from_video_id=TO_A0)
    assert svc.current_video_id == REACTION


def test_transicao_de_volta_prefere_a_da_cadeia_a_uma_copia_solta():
    svc = make_service()
    copia = "53_TRANSICAO_A1-A0_volta_camera"  # cópia antiga, fora da cadeia, listada antes
    svc._config["videos"].insert(0, {"id": copia})
    svc._config["flowNodes"].insert(0, node(copia))
    play(svc, A1_CLIP)
    react(svc)
    assert svc.get_state()["upcoming"][0]["videoId"] == TO_A0


def test_sem_pose_conhecida_a_reacao_entra_na_hora():
    svc = make_service()
    play(svc, A0_CLIP)
    svc._config["videos"].append({"id": "clip_solto"})
    svc._config["flowNodes"].append(node("clip_solto"))
    result = svc.handle_video_action({"type": "play_video", "nodeId": "n-clip_solto", "videoId": "clip_solto"})
    assert not result.get("deferred")
    assert svc.current_video_id == "clip_solto"


def test_pedido_imediato_nao_espera():
    svc = make_service()
    play(svc, A0_CLIP)
    react(svc, immediate=True)
    assert svc.current_video_id == REACTION


def test_reacao_esquecida_expira():
    svc = make_service()
    play(svc, A0_CLIP)
    react(svc)
    svc.pending_reaction_at = time.time() - PENDING_REACTION_MAX_S - 1
    assert svc.get_state()["upcoming"][0]["videoId"] != REACTION
    assert svc.pending_reaction is None


def test_reacao_pendente_avisa_o_overlay():
    svc = make_service()
    play(svc, A0_CLIP)
    before = svc.last_state_update
    react(svc)
    assert svc.last_state_update == before + 1
