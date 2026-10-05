"""O mural de planejamento precisa salvar de verdade (antes o conteúdo era descartado)."""
from server.api.v1.endpoints import planning


def test_mural_salva_e_volta(client, tmp_path, monkeypatch):
    monkeypatch.setattr(planning, "canvas_path", lambda: tmp_path / "planning_canvas.json")
    assert client.get("/api/v1/planning/canvas").json() == {"items": [], "connections": []}
    canvas = {
        "items": [{"id": "a", "position": {"x": 1, "y": 2}, "data": {"type": "sticky", "content": "Roteiro", "color": "yellow"}}],
        "connections": [{"id": "e", "source": "a", "target": "a"}],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }
    assert client.put("/api/v1/planning/canvas", json=canvas).json()["items"] == 1
    assert client.get("/api/v1/planning/canvas").json() == canvas
