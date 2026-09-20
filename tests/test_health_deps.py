def test_health_deps_responde_com_problemas_e_acoes(client):
    response = client.get("/health/deps")
    assert response.status_code == 200
    body = response.json()
    assert set(body) >= {"ok", "ai", "issues"} and isinstance(body["issues"], list)
    for issue in body["issues"]:
        assert issue["code"] and issue["message"] and issue["severity"] in {"error", "warning"}
