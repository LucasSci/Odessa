"""Recriar o perfil do Tango no OBS com um clique (sem perder a chave, sem abrir o OBS)."""
import asyncio
import json

import pytest

from server.services import tango_profile


class FakeObs:
    """OBS falso: guarda as chamadas e simula a pasta de perfis no disco."""

    def __init__(self, root, profiles, current, key="chave-antiga", server="rtmps://ingest.rtmp.tango.me/", streaming=False):
        self.root = root
        self.profiles = list(profiles)
        self.current = current
        self.service = {"server": server, "key": key}
        self.streaming = streaming
        self.calls = []
        self.canvas_width, self.canvas_height = 1080, 1920
        self.saved = False
        for name in self.profiles:
            self._write_dir(name)

    def _write_dir(self, name):
        folder = self.root / name.replace(" ", "_")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "basic.ini").write_text(f"[General]\nName={name}\n", encoding="utf-8")

    async def get_transmission_status(self):
        return {"streamActive": self.streaming, "virtualCameraActive": False}

    def _save_settings(self):
        self.saved = True

    async def _call(self, request, data=None, timeout=None):
        self.calls.append((request, data or {}))
        if request == "GetStreamServiceSettings":
            return {"streamServiceType": "rtmp_custom", "streamServiceSettings": dict(self.service)}
        if request == "GetProfileList":
            return {"profiles": list(self.profiles), "currentProfileName": self.current}
        if request == "SetCurrentProfile":
            assert data["profileName"] in self.profiles
            self.current = data["profileName"]
        elif request == "CreateProfile":
            self.profiles.append(data["profileName"])
            self.current = data["profileName"]
            self._write_dir(data["profileName"])
        elif request == "RemoveProfile":
            assert data["profileName"] != self.current, "o OBS não apaga o perfil em uso"
            self.profiles.remove(data["profileName"])
        elif request == "SetStreamServiceSettings":
            self.service = dict(data["streamServiceSettings"])
        return {}

    def names(self, request):
        return [d for r, d in self.calls if r == request]


def run(coro):
    return asyncio.run(coro)


def test_recria_o_perfil_reaproveitando_a_chave_do_obs(tmp_path):
    obs = FakeObs(tmp_path, ["Tango Profile", "Sem título"], current="Tango Profile")
    result = run(tango_profile.rebuild(obs, profiles_root=tmp_path))

    assert result == {"ok": True, "profile": "Tango Profile", "keyReused": True, "encoderApplied": True, "canvas": {"width": 720, "height": 1280}}
    assert "chave-antiga" not in json.dumps(result)
    # Saiu do perfil quebrado antes de apagar, criou de novo e terminou nele.
    assert obs.names("RemoveProfile") == [{"profileName": "Tango Profile"}]
    assert obs.current == "Tango Profile"
    assert obs.service == {"server": "rtmps://ingest.rtmp.tango.me/", "use_auth": False, "bwtest": False, "key": "chave-antiga"}
    params = {(d["parameterCategory"], d["parameterName"]): d["parameterValue"] for d in obs.names("SetProfileParameter")}
    assert params[("Output", "Mode")] == "Advanced"
    assert params[("Video", "BaseCX")] == "720" and params[("Video", "OutputCY")] == "1280"
    assert ("General", "Name") not in params
    encoder = json.loads((tmp_path / "Tango_Profile" / "streamEncoder.json").read_text(encoding="utf-8"))
    assert encoder == {"keyint_sec": 1, "bframes": False, "profile": "high", "x264opts": "bframes=0"}
    # O "Preparar OBS" passa a usar a tela do Tango.
    assert (obs.canvas_width, obs.canvas_height, obs.saved) == (720, 1280, True)


def test_chave_colada_vence_e_cria_perfil_temporario_quando_so_existe_o_do_tango(tmp_path):
    obs = FakeObs(tmp_path, ["Tango Profile"], current="Tango Profile", key="")
    result = run(tango_profile.rebuild(obs, "  chave-nova  ", profiles_root=tmp_path))
    assert result["keyReused"] is False
    assert obs.service["key"] == "chave-nova"
    assert obs.profiles == ["Tango Profile"], "o perfil temporário é apagado no fim"
    assert {"profileName": tango_profile.TEMP_PROFILE} in obs.names("CreateProfile")


def test_perfil_do_tango_inativo_a_chave_vem_do_arquivo_dele(tmp_path):
    """Caso real: o OBS estava em outro perfil; a chave fica no service.json do Tango."""
    obs = FakeObs(tmp_path, ["Tango Profile", "Lolzin"], current="Lolzin", server="rtmp://live.twitch.tv", key="chave-da-twitch")
    (tmp_path / "Tango_Profile" / "service.json").write_text(
        json.dumps({"type": "rtmp_custom", "settings": {"server": "rtmps://ingest.rtmp.tango.me/", "key": "chave-do-tango"}}), encoding="utf-8"
    )
    result = run(tango_profile.rebuild(obs, profiles_root=tmp_path))
    assert result["keyReused"] is True
    assert obs.service["key"] == "chave-do-tango"
    assert obs.current == "Tango Profile"


def test_sem_perfil_antigo_so_cria(tmp_path):
    obs = FakeObs(tmp_path, ["Sem título"], current="Sem título")
    run(tango_profile.rebuild(obs, "k", profiles_root=tmp_path))
    assert obs.names("RemoveProfile") == []
    assert obs.current == "Tango Profile"


def test_recusa_com_live_no_ar_e_sem_chave(tmp_path):
    obs = FakeObs(tmp_path, ["Tango Profile"], current="Tango Profile", streaming=True)
    with pytest.raises(tango_profile.ProfileError) as err:
        run(tango_profile.rebuild(obs, profiles_root=tmp_path))
    assert err.value.status == 409
    assert obs.names("RemoveProfile") == []

    obs = FakeObs(tmp_path / "b", ["Outro"], current="Outro", server="rtmp://outra-plataforma", key="x")
    with pytest.raises(tango_profile.ProfileError) as err:
        run(tango_profile.rebuild(obs, profiles_root=tmp_path / "b"))
    assert err.value.status == 400  # chave de outra plataforma não é reaproveitada


def test_modelo_do_repositorio_nao_guarda_chave():
    template = tango_profile.load_template()
    assert template["service"]["settings"]["key"] == ""
    assert template["service"]["settings"]["server"].startswith("rtmps://ingest.rtmp.tango.me")


def test_espera_o_obs_terminar_a_troca_de_perfil(tmp_path, monkeypatch):
    """Visto no OBS 32: RemoveProfile logo depois da troca volta "not ready" (207)."""
    monkeypatch.setattr(tango_profile, "READY_DELAY_S", 0)
    obs = FakeObs(tmp_path, ["Tango Profile", "Lolzin"], current="Tango Profile")
    busy = {"RemoveProfile": 2}
    original = obs._call

    async def flaky(request, data=None, timeout=None):
        if busy.get(request):
            busy[request] -= 1
            raise RuntimeError("RemoveProfile rejected: RequestStatus(result=False, code=207, comment='OBS is not ready to perform the request.')")
        return await original(request, data, timeout)

    obs._call = flaky
    result = run(tango_profile.rebuild(obs, profiles_root=tmp_path))
    assert result["ok"] and obs.current == "Tango Profile"
    assert busy["RemoveProfile"] == 0


def test_espera_o_perfil_apagado_sumir_antes_de_criar_de_novo(tmp_path, monkeypatch):
    """Visto no OBS 32: CreateProfile logo depois de RemoveProfile volta 601 ("já existe")."""
    monkeypatch.setattr(tango_profile, "READY_DELAY_S", 0)
    obs = FakeObs(tmp_path, ["Tango Profile", "Lolzin"], current="Lolzin")
    lag = {"listing": 2, "create": 1}
    original = obs._call

    async def laggy(request, data=None, timeout=None):
        if request == "GetProfileList" and lag["listing"] and "Tango Profile" not in obs.profiles:
            lag["listing"] -= 1
            return {"profiles": obs.profiles + ["Tango Profile"], "currentProfileName": obs.current}
        if request == "CreateProfile" and data["profileName"] == "Tango Profile" and lag["create"]:
            lag["create"] -= 1
            raise RuntimeError("CreateProfile rejected: RequestStatus(result=False, code=601, comment=None)")
        return await original(request, data, timeout)

    obs._call = laggy
    assert run(tango_profile.rebuild(obs, profiles_root=tmp_path))["ok"]
    assert lag == {"listing": 0, "create": 0}
    assert obs.current == "Tango Profile"

