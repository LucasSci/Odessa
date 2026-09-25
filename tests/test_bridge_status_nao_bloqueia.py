"""A sonda da bridge (porta 7555) não pode congelar o servidor: no Windows uma
conexão recusada em localhost leva ~2 s, e o Palco/overlay consultam
/video/state a cada 600 ms."""
import asyncio
import time

from server.services import bridge_manager as bm


def test_get_status_nao_bloqueia_o_event_loop(monkeypatch):
    fim_da_sonda = []

    def sonda_lenta(self, port):
        time.sleep(0.5)  # simula a conexão recusada lenta do Windows
        fim_da_sonda.append(time.perf_counter())
        return None

    monkeypatch.setattr(bm.BridgeProcessManager, "_probe_bridge", sonda_lenta)
    manager = bm.BridgeProcessManager()

    async def cenario():
        atendido_em = []

        async def outro_pedido():  # ex.: /video/state do overlay
            await asyncio.sleep(0.05)
            atendido_em.append(time.perf_counter())

        await asyncio.gather(manager.get_status(), outro_pedido())
        return atendido_em[0]

    atendido = asyncio.run(cenario())
    # O outro pedido tem de ser atendido ANTES de a sonda terminar.
    assert atendido < fim_da_sonda[0]


def test_chrome_tabs_nao_bloqueia_o_event_loop(monkeypatch):
    monkeypatch.setattr(bm, "_chrome_debug_tabs_sync", lambda port: (time.sleep(0.5), {"runningWithDebug": False})[1])

    async def cenario():
        marks = []

        async def outro_pedido():
            await asyncio.sleep(0.05)
            marks.append(time.perf_counter())

        start = time.perf_counter()
        await asyncio.gather(bm.get_chrome_debug_tabs(9222), outro_pedido())
        return marks[0] - start

    assert asyncio.run(cenario()) < 0.3
