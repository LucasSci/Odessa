def test_api_recusa_session_id_invalido(client):
    assert client.get("/api/v1/session-history", params={"sessionId": "../../etc/passwd"}).status_code == 400
    assert client.get("/api/v1/session-history/export", params={"sessionId": "..\\x"}).status_code == 400


def test_api_aceita_consulta_sem_session_id(client):
    assert client.get("/api/v1/session-history").status_code == 200


def test_api_recusa_persona_id_com_traversal(client):
    response = client.post("/api/v1/personas", json={"id": "../evil", "name": "x"})
    assert response.status_code == 400
