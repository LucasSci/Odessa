"""Status da bridge desligada não espera ~2 s a cada consulta (conexão recusada no Windows)."""
import asyncio

from server.services import bridge_manager as bm


def test_bridge_desligada_e_lembrada_por_alguns_segundos(monkeypatch):
    manager = bm.BridgeProcessManager()
    probes = []
    monkeypatch.setattr(manager, "_probe_bridge", lambda port: probes.append(port) or None)
    monkeypatch.setattr(bm, "load_bridge_config", lambda: {"port": 7555})

    async def twice():
        await manager.get_status()
        await manager.get_status()

    asyncio.run(twice())
    assert len(probes) == 1  # a segunda consulta usou o "desligada" lembrado

    manager._unreachable_until = 0.0  # passou o tempo (ou a bridge foi iniciada)
    asyncio.run(manager.get_status())
    assert len(probes) == 2
