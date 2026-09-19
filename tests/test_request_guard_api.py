def test_get_normal_continua_funcionando(client):
    assert client.get("/health").status_code == 200


def test_host_de_atacante_e_recusado(client):
    response = client.get("/health", headers={"host": "evil.example"})
    assert response.status_code == 400


def test_post_cross_site_e_recusado_antes_de_chegar_na_rota(client):
    response = client.post(
        "/api/v1/session-history/events",
        json={"type": "chat.received", "data": {}},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_post_same_origin_nao_e_barrado_pela_guarda(client):
    response = client.post(
        "/api/v1/session-history/events",
        json={"type": "tipo-que-nao-existe", "data": {}},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 400  # chegou na rota (tipo inválido), não foi 403


def test_origin_null_de_iframe_sandboxado_nao_pode_alterar_estado(client):
    response = client.post(
        "/api/v1/session-history/events",
        json={"type": "chat.received", "data": {}},
        headers={"Origin": "null"},
    )
    assert response.status_code == 403
