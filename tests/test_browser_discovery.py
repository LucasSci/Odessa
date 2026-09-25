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


def test_perfil_antigo_do_chrome_e_movido_para_fora_da_pasta_do_programa(tmp_path, monkeypatch):
    """O login do Tango ficava em server/runtime e o instalador apagava a cada update."""
    from server import config
    from server.services import bridge_manager as bm

    runtime = tmp_path / "runtime"
    legacy = runtime / "chrome-debug-profile" / "Default"
    legacy.mkdir(parents=True)
    (legacy / "Cookies").write_text("login do tango")
    monkeypatch.setattr(bm, "RUNTIME_DIR", runtime)
    monkeypatch.setattr(config, "BROWSER_PROFILES_DIR", tmp_path / "perfis")

    path = bm.debug_profile_dir_for("chrome")

    assert path == tmp_path / "perfis" / "chrome"
    assert (path / "Default" / "Cookies").read_text() == "login do tango"
    assert not (runtime / "chrome-debug-profile").exists()
    # Chamadas seguintes reutilizam o perfil novo, sem mexer em nada.
    assert bm.debug_profile_dir_for("chrome") == path
    assert bm.debug_profile_dir_for("edge") == tmp_path / "perfis" / "edge"
