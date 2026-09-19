import json
import threading

import pytest

from server.core import atomic_json as aj


@pytest.fixture(autouse=True)
def _limpa_eventos():
    aj.clear_recovery_events()
    yield
    aj.clear_recovery_events()


def test_ida_e_volta_com_acentos(tmp_path):
    path = tmp_path / "a.json"
    aj.write_json(path, {"nome": "Bárbara", "n": [1, 2]})
    assert aj.read_json(path) == {"nome": "Bárbara", "n": [1, 2]}
    assert "Bárbara" in path.read_text(encoding="utf-8")  # sem escapar unicode


def test_arquivo_ausente_devolve_o_padrao_sem_compartilhar_o_objeto(tmp_path):
    padrao = {"videos": []}
    first = aj.read_json(tmp_path / "x.json", default=padrao)
    first["videos"].append(1)
    assert padrao == {"videos": []}
    assert aj.read_json(tmp_path / "x.json", default_factory=list) == []


def test_falha_no_meio_da_escrita_nao_toca_no_original_e_nao_deixa_lixo(tmp_path, monkeypatch):
    path = tmp_path / "a.json"
    aj.write_json(path, {"v": 1})

    def quebra(data, handle, **kwargs):
        handle.write('{"v": 2, "parc')
        raise OSError("disco cheio")

    monkeypatch.setattr(aj.json, "dump", quebra)
    with pytest.raises(OSError):
        aj.write_json(path, {"v": 2})
    monkeypatch.undo()

    assert json.loads(path.read_text(encoding="utf-8")) == {"v": 1}
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []


def test_cada_gravacao_guarda_a_versao_anterior_em_bak(tmp_path):
    path = tmp_path / "a.json"
    aj.write_json(path, {"v": 1})
    assert not aj.backup_path(path).exists()  # primeira gravação: nada a guardar
    aj.write_json(path, {"v": 2})
    assert json.loads(aj.backup_path(path).read_text(encoding="utf-8")) == {"v": 1}
    aj.write_json(path, {"v": 3}, backup=False)
    assert json.loads(aj.backup_path(path).read_text(encoding="utf-8")) == {"v": 1}


def test_corrompido_com_bak_restaura_e_preserva_o_arquivo_ruim(tmp_path):
    path = tmp_path / "config.json"
    aj.write_json(path, {"gatilhos": [1, 2, 3]})
    aj.write_json(path, {"gatilhos": [1, 2, 3, 4]})
    path.write_text('{"gatilhos": [1, 2,', encoding="utf-8")  # truncado

    assert aj.read_json(path, default={}) == {"gatilhos": [1, 2, 3]}
    assert json.loads(path.read_text(encoding="utf-8")) == {"gatilhos": [1, 2, 3]}
    ruins = list(tmp_path.glob("config.json.corrupt-*"))
    assert len(ruins) == 1 and ruins[0].read_text(encoding="utf-8") == '{"gatilhos": [1, 2,'
    events = aj.recovery_events()
    assert events[-1]["action"] == "restored_from_backup" and events[-1]["path"] == "config.json"


def test_corrompido_sem_bak_isola_e_devolve_o_padrao_sem_apagar_nada(tmp_path):
    path = tmp_path / "config.json"
    path.write_text("{lixo", encoding="utf-8")
    assert aj.read_json(path, default={"vazio": True}) == {"vazio": True}
    assert not path.exists()  # o próximo salvamento cria um arquivo novo…
    ruins = list(tmp_path.glob("config.json.corrupt-*"))
    assert len(ruins) == 1 and ruins[0].read_text(encoding="utf-8") == "{lixo"  # …e o original continua guardado
    assert aj.recovery_events()[-1]["action"] == "quarantined"


def test_arquivo_vazio_conta_como_corrompido(tmp_path):
    path = tmp_path / "a.json"
    aj.write_json(path, {"v": 1})
    aj.write_json(path, {"v": 2})
    path.write_text("", encoding="utf-8")
    assert aj.read_json(path) == {"v": 1}


def test_bom_do_windows_e_tolerado(tmp_path):
    path = tmp_path / "a.json"
    path.write_bytes(b"\xef\xbb\xbf" + json.dumps({"ok": True}).encode("utf-8"))
    assert aj.read_json(path) == {"ok": True}
    assert list(tmp_path.glob("*.corrupt-*")) == []


def test_quarentenas_repetidas_nao_se_sobrescrevem(tmp_path):
    path = tmp_path / "a.json"
    for i in range(3):
        path.write_text(f"{{ruim{i}", encoding="utf-8")
        aj.read_json(path, default={})
    assert len(list(tmp_path.glob("a.json.corrupt-*"))) == 3


def test_update_json_nao_perde_atualizacoes_concorrentes(tmp_path):
    path = tmp_path / "contador.json"
    aj.write_json(path, {"n": 0})

    def incrementa():
        for _ in range(25):
            aj.update_json(path, lambda d: d.__setitem__("n", d["n"] + 1))

    threads = [threading.Thread(target=incrementa) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert aj.read_json(path) == {"n": 200}


def test_update_json_cria_o_arquivo_a_partir_do_padrao(tmp_path):
    path = tmp_path / "novo.json"
    aj.update_json(path, lambda d: d.update(a=1), default_factory=dict)
    assert aj.read_json(path) == {"a": 1}


def test_update_json_pode_devolver_um_novo_conteudo(tmp_path):
    path = tmp_path / "lista.json"
    aj.write_json(path, [1])
    assert aj.update_json(path, lambda d: d + [2], default_factory=list) == [1, 2]
    assert aj.read_json(path) == [1, 2]
