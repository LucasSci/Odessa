"""Configuração limpa do perfil do Tango no OBS, direto do Odessa.

Cenário real (04/10/2026): dois perfis "Tango Profile" (pastas "TangoProfile (7)"
e "TangoProfile2"), o ativo com tela 1080×1920 em vez do 720×1280 do modelo, e a
chave do Tango é um token que vence a cada 30 dias.
"""
import asyncio
import base64
import io
import json
import time
import zipfile

import pytest

from server.services import tango_profile as tp


def make_key(days: float) -> str:
    """Chave no formato do Tango (JWT) com validade em `days` dias."""
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'EdDSA'})}.{b64({'exp': int(time.time() + days * 86400), 'src': 'obs'})}.assinatura"


def write_profile(root, folder, name, *, server="rtmps://ingest.rtmp.tango.me/", key="", canvas=(720, 1280)):
    path = root / "basic" / "profiles" / folder
    path.mkdir(parents=True)
    (path / "basic.ini").write_text(
        f"[General]\nName={name}\n\n[Output]\nMode=Advanced\n\n[Video]\nBaseCX={canvas[0]}\nBaseCY={canvas[1]}\n"
        f"OutputCX={canvas[0]}\nOutputCY={canvas[1]}\nFPSCommon=30\n",
        encoding="utf-8",
    )
    (path / "service.json").write_text(json.dumps({"type": "rtmp_custom", "settings": {"server": server, "key": key}}), encoding="utf-8")
    return path


@pytest.fixture
def obs_root(tmp_path):
    root = tmp_path / "obs-studio"
    write_profile(root, "TangoProfile (7)", "Tango Profile", key=make_key(6), canvas=(1080, 1920))
    write_profile(root, "TangoProfile2", "Tango Profile", key="")
    write_profile(root, "Lolzin", "Lolzin", server="rtmps://outra.plataforma/live", key="chave-da-outra")
    (root / "user.ini").write_text(
        "[General]\nLanguage=pt-BR\n\n[Basic]\nProfile=Tango Profile\nProfileDir=TangoProfile (7)\nSceneCollection=Viktoria\n",
        encoding="utf-8",
    )
    return root


class FakeObs:
    def __init__(self, streaming=False, websocket_ok=True):
        self.streaming = streaming
        self.websocket_ok = websocket_ok
        self.canvas_width, self.canvas_height = 1080, 1920
        self.saved = False
        self.disconnected = False

    async def get_transmission_status(self):
        if not self.websocket_ok:
            raise RuntimeError("OBS WebSocket unavailable")
        return {"streamActive": self.streaming, "virtualCameraActive": False}

    async def disconnect(self):
        self.disconnected = True

    def _save_settings(self):
        self.saved = True


class FakeProcess:
    """OBS aberto/fechado + quem fechou/abriu."""

    def __init__(self, running=True, closes=True):
        self.running = running
        self.closes = closes
        self.closed = False
        self.started = None

    def processes(self):
        return [{"pid": 1, "path": r"C:\Program Files\obs-studio\bin\64bit\obs64.exe"}] if self.running else []

    def closer(self):
        self.closed = True
        if self.closes:
            self.running = False
        return self.closes

    def starter(self, exe):
        self.started = exe


def run(obs_root, obs=None, proc=None, **kwargs):
    proc = proc or FakeProcess()
    return asyncio.run(
        tp.clean_setup(
            obs or FakeObs(),
            root=obs_root,
            processes=proc.processes,
            closer=proc.closer,
            starter=proc.starter,
            **kwargs,
        )
    )


def profiles(root):
    return sorted(p.name for p in (root / "basic" / "profiles").iterdir())


def test_diagnostico_aponta_duplicados_tela_e_validade_sem_mostrar_a_chave(obs_root):
    report = tp.status(obs_root)
    text = json.dumps(report, ensure_ascii=False)
    assert report["ok"] is False
    assert [p["folder"] for p in report["profiles"]] == ["TangoProfile (7)", "TangoProfile2"]
    assert any("2 perfis do Tango" in p for p in report["problems"])
    assert any("BaseCX: 1080 (modelo 720)" in p for p in report["problems"])
    assert any("vence em" in p for p in report["problems"])
    assert any("sem chave" in p for p in report["problems"])
    active = next(p for p in report["profiles"] if p["active"])
    assert active["key"]["present"] and active["key"]["expiringSoon"]
    assert "assinatura" not in text and "chave-da-outra" not in text  # a chave nunca sai


def test_configuracao_limpa_com_obs_aberto(obs_root):
    proc = FakeProcess()
    obs = FakeObs()
    current_key = json.loads((obs_root / "basic/profiles/TangoProfile (7)/service.json").read_text())["settings"]["key"]

    result = run(obs_root, obs=obs, proc=proc)

    # Fechou, trocou e abriu de novo; o perfil da outra plataforma ficou intacto.
    assert proc.closed and proc.started and obs.disconnected
    assert profiles(obs_root) == ["Lolzin", "Tango_Profile"]
    assert sorted(result["removed"]) == ["TangoProfile (7)", "TangoProfile2"]
    backup = obs_root / "basic" / tp.BACKUP_DIR_NAME
    assert sorted(p.name for p in next(backup.iterdir()).iterdir()) == ["TangoProfile (7)", "TangoProfile2"]

    new = obs_root / "basic/profiles/Tango_Profile"
    basic = new.joinpath("basic.ini").read_text(encoding="utf-8")
    assert "Name=Tango Profile" in basic and "BaseCX=720" in basic and "[Panels]" not in basic
    assert " = " not in basic  # formato do OBS: Chave=Valor
    service = json.loads(new.joinpath("service.json").read_text())
    assert service["settings"]["server"].startswith("rtmps://ingest.rtmp.tango.me")
    assert service["settings"]["key"] == current_key  # reaproveitou a chave válida
    assert json.loads(new.joinpath("streamEncoder.json").read_text())["keyint_sec"] == 1

    user_ini = (obs_root / "user.ini").read_text(encoding="utf-8")
    assert "ProfileDir=Tango_Profile" in user_ini and "Profile=Tango Profile" in user_ini
    assert "SceneCollection=Viktoria" in user_ini and "Language=pt-BR" in user_ini  # resto preservado

    assert result["keySource"] == "perfil atual" and result["obsRestarted"] is True
    assert current_key not in json.dumps(result)
    assert (obs.canvas_width, obs.canvas_height, obs.saved) == (720, 1280, True)


def test_chave_colada_vence_e_chave_vencida_e_recusada_sem_mexer_em_nada(obs_root):
    nova = make_key(30)
    run(obs_root, stream_key=f"  {nova}  ")
    service = json.loads((obs_root / "basic/profiles/Tango_Profile/service.json").read_text())
    assert service["settings"]["key"] == nova

    proc = FakeProcess()
    with pytest.raises(tp.ProfileError) as err:
        run(obs_root, proc=proc, stream_key=make_key(-1))
    assert err.value.status == 400 and "venceu" in err.value.message
    assert proc.closed is False  # nem fechou o OBS


def test_recusa_com_live_no_ar_ou_sem_conseguir_conferir(obs_root):
    for obs in (FakeObs(streaming=True), FakeObs(websocket_ok=False)):
        proc = FakeProcess()
        with pytest.raises(tp.ProfileError) as err:
            run(obs_root, obs=obs, proc=proc)
        assert err.value.status == 409
        assert proc.closed is False
    assert "TangoProfile (7)" in profiles(obs_root)


def test_obs_que_nao_fecha_nao_e_mexido(obs_root):
    proc = FakeProcess(closes=False)
    with pytest.raises(tp.ProfileError) as err:
        run(obs_root, proc=proc)
    assert err.value.status == 409
    assert "TangoProfile (7)" in profiles(obs_root) and proc.started is None


def test_com_obs_fechado_so_escreve(obs_root):
    proc = FakeProcess(running=False)
    result = run(obs_root, proc=proc)
    assert proc.closed is False and proc.started is None
    assert result["obsRestarted"] is False and "Tango_Profile" in profiles(obs_root)


def test_zip_do_tango_com_chave_vira_o_perfil(obs_root):
    key = make_key(29)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("TangoProfile/basic.ini", "[General]\nName=Qualquer\n[Video]\nBaseCX=720\nBaseCY=1280\n[Panels]\nCookieId=X\n")
        archive.writestr("TangoProfile/service.json", json.dumps({"type": "rtmp_custom", "settings": {"server": "rtmps://ingest.rtmp.tango.me/", "key": key}}))
        archive.writestr("TangoProfile/streamEncoder.json", json.dumps({"keyint_sec": 1}))
    result = run(obs_root, zip_bytes=buffer.getvalue())
    new = obs_root / "basic/profiles/Tango_Profile"
    assert result["keySource"] == "zip"
    assert json.loads(new.joinpath("service.json").read_text())["settings"]["key"] == key
    basic = new.joinpath("basic.ini").read_text(encoding="utf-8")
    assert "Name=Tango Profile" in basic and "CookieId" not in basic


def test_zip_invalido_e_recusado(obs_root):
    with pytest.raises(tp.ProfileError):
        run(obs_root, zip_bytes=b"nao e zip")
    assert "TangoProfile (7)" in profiles(obs_root)


def test_sem_chave_nenhuma_pede_para_colar(tmp_path):
    root = tmp_path / "obs"
    write_profile(root, "TangoProfile2", "Tango Profile", key="")
    with pytest.raises(tp.ProfileError) as err:
        run(root, proc=FakeProcess(running=False))
    assert err.value.status == 400 and "Cole a chave" in err.value.message


def test_guarda_so_os_ultimos_backups(obs_root):
    for _ in range(tp.KEEP_BACKUPS + 2):
        run(obs_root, proc=FakeProcess(running=False))
        time.sleep(1.05)  # nome do backup tem segundos
    assert len(list((obs_root / "basic" / tp.BACKUP_DIR_NAME).iterdir())) == tp.KEEP_BACKUPS


def test_modelo_do_repositorio_nao_guarda_chave():
    template = tp.load_template()
    assert template["service"]["settings"]["key"] == ""
    assert template["basic"].get("Video", "BaseCX") == "720"


def auto(obs_root, proc, allow_restart):
    return asyncio.run(
        tp.auto_fix(FakeObs(), allow_restart=allow_restart, root=obs_root, processes=proc.processes, closer=proc.closer, starter=proc.starter)
    )


def test_automatico_com_obs_fechado_conserta_sem_ninguem_ver(obs_root):
    proc = FakeProcess(running=False)
    outcome = auto(obs_root, proc, allow_restart=False)
    assert outcome["action"] == "fixed" and "perfis do Tango duplicados" in outcome["reasons"]
    assert profiles(obs_root) == ["Lolzin", "Tango_Profile"]
    assert proc.closed is False and proc.started is None
    # Na volta seguinte não há mais o que fazer.
    assert auto(obs_root, proc, allow_restart=False)["action"] == "none"


def test_automatico_com_obs_aberto_espera_o_iniciar_live(obs_root):
    proc = FakeProcess(running=True)
    assert auto(obs_root, proc, allow_restart=False)["action"] == "deferred"
    assert "TangoProfile (7)" in profiles(obs_root) and proc.closed is False
    assert auto(obs_root, proc, allow_restart=True)["action"] == "fixed"
    assert proc.closed and proc.started


def test_automatico_nao_inventa_com_chave_vencida(tmp_path):
    root = tmp_path / "obs"
    write_profile(root, "TangoProfile (7)", "Tango Profile", key=make_key(-2))
    (root / "user.ini").write_text("[Basic]\nProfile=Tango Profile\nProfileDir=TangoProfile (7)\n", encoding="utf-8")
    outcome = auto(root, FakeProcess(running=False), allow_restart=True)
    assert outcome["action"] == "blocked" and "venceu" in outcome["message"]
    assert "TangoProfile (7)" in profiles(root)


def test_ativo_com_chave_vencida_usa_a_valida_do_outro_perfil(tmp_path):
    root = tmp_path / "obs"
    write_profile(root, "TangoProfile (7)", "Tango Profile", key=make_key(-2))
    valida = make_key(20)
    write_profile(root, "TangoProfile2", "Tango Profile", key=valida)
    (root / "user.ini").write_text("[Basic]\nProfile=Tango Profile\nProfileDir=TangoProfile (7)\n", encoding="utf-8")
    outcome = auto(root, FakeProcess(running=False), allow_restart=False)
    assert outcome["action"] == "fixed"
    service = json.loads((root / "basic/profiles/Tango_Profile/service.json").read_text())
    assert service["settings"]["key"] == valida


def test_perfil_em_ordem_nao_e_mexido(tmp_path):
    root = tmp_path / "obs"
    write_profile(root, "Tango_Profile", "Tango Profile", key=make_key(20))
    (root / "user.ini").write_text("[Basic]\nProfile=Tango Profile\nProfileDir=Tango_Profile\n", encoding="utf-8")
    assert auto(root, FakeProcess(running=False), allow_restart=True)["action"] == "none"
