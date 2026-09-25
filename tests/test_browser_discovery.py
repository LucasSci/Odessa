"""Escolha do navegador da live: fixado pelo usuário > padrão do sistema > Edge > Chrome."""
from server.services import browser_discovery as bd


def _fake(monkeypatch, installed: dict[str, str], default_prog_id: str | None):
    monkeypatch.setattr(bd, "_find_path", lambda spec: installed.get(spec.id))
    monkeypatch.setattr(bd, "default_prog_id", lambda: default_prog_id)


def test_automatico_segue_o_navegador_padrao(monkeypatch):
    _fake(monkeypatch, {"edge": "e.exe", "chrome": "c.exe"}, "ChromeHTML")
    assert bd.resolve_browser("auto").id == "chrome"


def test_automatico_sem_padrao_chromium_prefere_edge(monkeypatch):
    _fake(monkeypatch, {"edge": "e.exe", "chrome": "c.exe"}, "FirefoxURL-308046B0AF4A39CB")
    assert bd.resolve_browser("auto").id == "edge"


def test_escolha_do_usuario_vence(monkeypatch):
    _fake(monkeypatch, {"edge": "e.exe", "chrome": "c.exe"}, "MSEdgeHTM")
    assert bd.resolve_browser("chrome").id == "chrome"


def test_escolha_nao_instalada_cai_no_automatico(monkeypatch):
    _fake(monkeypatch, {"edge": "e.exe"}, None)
    assert bd.resolve_browser("brave").id == "edge"


def test_sem_navegador_devolve_none(monkeypatch):
    _fake(monkeypatch, {}, None)
    assert bd.resolve_browser("auto") is None


def test_edge_e_chrome_usam_canal_do_playwright(monkeypatch):
    _fake(monkeypatch, {"edge": "e.exe", "chrome": "c.exe", "brave": "b.exe"}, None)
    canais = {b.id: b.playwrightChannel for b in bd.list_browsers()}
    assert canais == {"edge": "msedge", "chrome": "chrome", "brave": None}


def test_config_da_bridge_valida_o_navegador(tmp_path, monkeypatch):
    from server.services import bridge_manager as bm

    monkeypatch.setattr(bm, "BRIDGE_CONFIG_FILE", tmp_path / "bridge.json")
    assert bm.save_bridge_config({"browser": "edge"})["browser"] == "edge"
    assert bm.save_bridge_config({"port": 7555})["browser"] == "edge"  # sem o campo: mantém
    assert bm.save_bridge_config({"browser": "firefox"})["browser"] == "auto"  # não suportado
