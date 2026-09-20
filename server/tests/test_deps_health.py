from server.services.deps_health import build_deps_report

MODEL = "qwen2.5:latest"


def ollama(reachable=False, installed_model=False):
    return {"reachable": reachable, "modelInstalled": installed_model, "model": MODEL}


def codes(report):
    return [item["code"] for item in report["issues"]]


def test_ollama_pronto_nao_tem_problemas():
    report = build_deps_report(provider="ollama", ollama=ollama(True, True), ollama_installed=True, keys={})
    assert report["ok"] is True and report["issues"] == [] and report["ai"]["usable"] is True


def test_ollama_nao_instalado_oferece_download():
    report = build_deps_report(provider="ollama", ollama=ollama(), ollama_installed=False, keys={})
    assert codes(report) == ["ollama_not_installed"]
    assert report["issues"][0]["action"]["kind"] == "link"
    assert report["ok"] is False and report["ai"]["usable"] is False


def test_ollama_instalado_mas_parado_oferece_iniciar():
    report = build_deps_report(provider="ollama", ollama=ollama(), ollama_installed=True, keys={})
    assert codes(report) == ["ollama_unreachable"]
    assert report["issues"][0]["action"] == {"kind": "post", "label": "Iniciar o Ollama", "path": "/ai/ollama/connect"}


def test_ollama_sem_modelo_oferece_baixar_o_modelo_certo():
    report = build_deps_report(provider="ollama", ollama=ollama(True, False), ollama_installed=True, keys={})
    assert codes(report) == ["ollama_model_missing"]
    assert MODEL in report["issues"][0]["message"] and MODEL in report["issues"][0]["action"]["label"]
    assert report["ok"] is False


def test_ollama_fora_com_chave_de_nuvem_vira_aviso_e_ia_segue_utilizavel():
    report = build_deps_report(provider="ollama", ollama=ollama(), ollama_installed=True, keys={"gemini": True})
    assert report["issues"][0]["severity"] == "warning"
    assert report["ai"]["usable"] is True and report["ok"] is True


def test_nuvem_sem_nenhuma_chave_e_erro():
    report = build_deps_report(provider="gemini", ollama=ollama(True, True), ollama_installed=True, keys={"gemini": False})
    assert "no_ai_provider" in codes(report)
    assert report["ok"] is False


def test_nuvem_com_chave_esta_ok_e_lista_provedores():
    report = build_deps_report(provider="gemini", ollama=ollama(), ollama_installed=False, keys={"gemini": True, "openai": False})
    assert report["issues"] == [] and report["ai"]["cloudProviders"] == ["gemini"]

