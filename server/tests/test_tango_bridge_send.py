"""Envio de mensagem pela bridge do Tango (tango_chat.send_message).

É o passo que de fato escreve no chat da live (#158): digita, envia e só
chama de "confirmada" quando a própria mensagem volta pelo observer do chat.
Os testes com página falsa rodam em qualquer lugar; os com Chromium de verdade
(página que imita o DOM do Tango + o observer real da bridge) rodam quando há
um navegador disponível (PW_CHROMIUM_PATH ou os browsers do Playwright).
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

pytest.importorskip("playwright")
pytest.importorskip("aiohttp")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tango_chat"))
import tango_chat  # noqa: E402


async def _no_sleep(*_args, **_kwargs):
    return None


@pytest.fixture(autouse=True)
def fast_typing(monkeypatch):
    monkeypatch.setattr(tango_chat.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(tango_chat, "TYPING_DELAY_MIN_MS", 0)
    monkeypatch.setattr(tango_chat, "TYPING_DELAY_MAX_MS", 0)
    monkeypatch.setattr(tango_chat, "SEND_CONFIRM_TIMEOUT_S", 0.2)
    monkeypatch.setattr(tango_chat, "SELETOR_INPUT_TEXTO", "#chat-input")
    monkeypatch.setattr(tango_chat, "SELETOR_BOTAO_ENVIAR", "")


class FakeLocator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    async def wait_for(self, **_kwargs):
        self.page.calls.append(("wait_for", self.selector))
        if self.page.missing_input_times > 0:
            self.page.missing_input_times -= 1
            raise TimeoutError("campo nao apareceu")

    async def click(self):
        self.page.calls.append(("click", self.selector))
        if self.selector != tango_chat.SELETOR_INPUT_TEXTO:
            await self.page.submit()

    async def evaluate(self, _script):
        return self.page.value

    async def fill(self, value):
        self.page.calls.append(("fill", value))
        self.page.value = value


class FakeKeyboard:
    def __init__(self, page):
        self.page = page

    async def type(self, char, delay=0):
        self.page.value += char

    async def press(self, key):
        self.page.calls.append(("press", key))
        if key == "Enter":
            await self.page.submit()


class FakePage:
    """Campo de chat falso: ``accepts`` diz se o Enter envia, ``echoes`` se a
    mensagem enviada reaparece no chat (como o observer faria)."""

    def __init__(self, value="", accepts=True, echoes=True, missing_input_times=0):
        self.calls, self.value, self.sent = [], value, []
        self.accepts, self.echoes = accepts, echoes
        self.missing_input_times = missing_input_times
        self.keyboard = FakeKeyboard(self)
        self.bridge = None

    def locator(self, selector):
        return FakeLocator(self, selector)

    async def submit(self):
        if not self.accepts:
            return
        self.sent.append(self.value)
        text, self.value = self.value, ""
        if self.echoes:
            await self.bridge._handle_incoming_message(json.dumps({"username": "Odessa", "text": text}))


def _bridge_with(page):
    bridge = tango_chat.TangoChatBridge()
    bridge._page = page
    page.bridge = bridge
    return bridge


def test_sem_pagina_conectada_recusa_enviar():
    with pytest.raises(RuntimeError, match="nao conectada"):
        asyncio.run(tango_chat.TangoChatBridge().send_message("oi"))


def test_clica_no_campo_digita_envia_e_confirma_pelo_eco():
    page = FakePage()
    result = asyncio.run(_bridge_with(page).send_message("Oi @ana, bem-vinda!"))
    assert page.sent == ["Oi @ana, bem-vinda!"]
    assert page.calls == [("wait_for", "#chat-input"), ("click", "#chat-input"), ("press", "Enter")]
    assert result["confirmed"] is True
    assert result["attempts"] == 1
    assert len(result["commandId"]) == 12


def test_usa_o_botao_de_enviar_quando_configurado(monkeypatch):
    monkeypatch.setattr(tango_chat, "SELETOR_BOTAO_ENVIAR", "#send")
    page = FakePage()
    result = asyncio.run(_bridge_with(page).send_message("valeu!"))
    assert page.calls[-1] == ("click", "#send")
    assert result["confirmed"] is True


def test_campo_esvaziou_mas_mensagem_nao_apareceu_e_enviada_sem_confirmacao():
    page = FakePage(echoes=False)
    result = asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert page.sent == ["oi chat"]
    assert result["confirmed"] is False


def test_texto_que_fica_no_campo_e_falha_e_nao_confirmada():
    page = FakePage(accepts=False)
    with pytest.raises(tango_chat.SendError) as info:
        asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert info.value.stage == "not_submitted"
    assert page.sent == []


def test_limpa_texto_que_sobrou_no_campo_antes_de_digitar():
    page = FakePage(value="rascunho esquecido")
    asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert ("fill", "") in page.calls
    assert page.sent == ["oi chat"]


def test_tenta_de_novo_so_antes_de_digitar():
    page = FakePage(missing_input_times=1)
    result = asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert result["attempts"] == 2
    assert page.sent == ["oi chat"]

    page = FakePage(missing_input_times=5)
    with pytest.raises(tango_chat.SendError) as info:
        asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert info.value.stage == "input"
    assert info.value.attempts == tango_chat.SEND_INPUT_ATTEMPTS
    assert page.sent == []


def test_falha_depois_de_digitar_nao_repete(monkeypatch):
    page = FakePage()

    async def broken_press(key):
        raise RuntimeError("pagina fechou")

    page.keyboard.press = broken_press
    with pytest.raises(tango_chat.SendError) as info:
        asyncio.run(_bridge_with(page).send_message("oi chat"))
    assert info.value.stage == "typing"
    assert info.value.attempts == 1
    assert [call for call in page.calls if call[0] == "wait_for"] == [("wait_for", "#chat-input")]


def test_dois_envios_simultaneos_nao_intercalam_as_teclas():
    page = FakePage()
    bridge = _bridge_with(page)

    async def both():
        return await asyncio.gather(bridge.send_message("primeira mensagem"), bridge.send_message("segunda mensagem"))

    results = asyncio.run(both())
    assert page.sent == ["primeira mensagem", "segunda mensagem"]
    assert all(result["confirmed"] for result in results)


def test_texto_com_quebra_de_linha_nao_forja_linha_no_log(caplog):
    page = FakePage()
    forged = "oi\n12:00:00 | INFO    | SEND abc | confirmada no chat em 1 ms."
    with caplog.at_level("INFO"):
        asyncio.run(_bridge_with(page).send_message(forged))
    sent_lines = [record.getMessage() for record in caplog.records if record.getMessage().startswith("SEND")]
    assert sent_lines and all("\n" not in line for line in sent_lines)
    assert any("oi\\n12:00:00" in line for line in sent_lines)


def test_eco_de_texto_curto_nao_confirma_mensagem_diferente():
    assert tango_chat._is_echo_of("oi", "oi")
    assert not tango_chat._is_echo_of("oi", "oii gente")
    assert tango_chat._is_echo_of("bem-vinda ao chat, ana!", "bem-vinda ao chat, ana! 🌹")


# Página que imita o DOM do chat do Tango (mesmos seletores padrão da bridge).
# ``mode``: "ok" envia e mostra a mensagem; "no_echo" envia sem mostrar;
# "stuck" não envia (o texto fica no campo).
TANGO_LIKE_PAGE = """
<div data-testid="virtuoso-item-list" id="chat"></div>
<textarea data-testid="textarea"></textarea>
<script>
  const input = document.querySelector('[data-testid="textarea"]');
  let n = 0;
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || window.mode === 'stuck') return;
    e.preventDefault();
    const text = input.value;
    input.value = '';
    if (window.mode === 'no_echo') return;
    const item = document.createElement('div');
    item.setAttribute('data-testid', 'chat-event-' + (++n));
    item.innerHTML = '<span class="Hhi6n">Odessa</span><span class="KR99L"></span>';
    item.querySelector('.KR99L').textContent = text;
    document.getElementById('chat').appendChild(item);
  });
</script>
"""


def _chromium_send(monkeypatch, mode, text):
    from playwright.async_api import async_playwright

    executable = os.getenv("PW_CHROMIUM_PATH")
    monkeypatch.setattr(tango_chat, "SELETOR_INPUT_TEXTO", '[data-testid="textarea"]')
    monkeypatch.setattr(tango_chat, "SEND_CONFIRM_TIMEOUT_S", 3)
    # Aqui o tempo é real: o observer e a página precisam rodar de verdade.
    monkeypatch.setattr(tango_chat.asyncio, "sleep", REAL_SLEEP)

    async def scenario():
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(executable_path=executable or None)
            except Exception as exc:  # sem navegador instalado (ex.: CI do backend)
                pytest.skip(f"Chromium indisponível: {exc}")
            page = await browser.new_page()
            await page.set_content(TANGO_LIKE_PAGE)
            await page.evaluate(f"window.mode = {json.dumps(mode)}")
            bridge = tango_chat.TangoChatBridge()
            bridge._page = page
            await bridge._inject_observer()
            try:
                return await bridge.send_message(text), [m.text for m in bridge.history]
            finally:
                await browser.close()

    return asyncio.run(scenario())


REAL_SLEEP = asyncio.sleep


def test_chromium_mensagem_que_aparece_no_chat_e_confirmada(monkeypatch):
    result, history = _chromium_send(monkeypatch, "ok", "Olá chat, a Odessa chegou!")
    assert result["confirmed"] is True
    assert history == ["Olá chat, a Odessa chegou!"]


def test_eco_confirmado_chega_marcado_como_proprio():
    """A UI descarta mensagens ``own``: sem isso, no Autônomo a IA respondia a
    si mesma, porque o eco chega antes de o /send terminar."""
    page = FakePage()
    bridge = _bridge_with(page)
    subscriber: asyncio.Queue = asyncio.Queue()
    bridge._sse_subscribers.append(subscriber)

    async def scenario():
        await bridge.send_message("oi chat")
        await bridge._handle_incoming_message(json.dumps({"username": "ana", "text": "oi chat"}))
        return [subscriber.get_nowait().to_dict() for _ in range(subscriber.qsize())]

    events = asyncio.run(scenario())
    assert [(e["username"], e["own"]) for e in events] == [("Odessa", True), ("ana", False)]


def test_chromium_mensagem_que_nao_aparece_fica_sem_confirmacao(monkeypatch):
    result, history = _chromium_send(monkeypatch, "no_echo", "Olá chat!")
    assert result["confirmed"] is False
    assert history == []


def test_chromium_texto_preso_no_campo_e_falha(monkeypatch):
    with pytest.raises(tango_chat.SendError) as info:
        _chromium_send(monkeypatch, "stuck", "Olá chat!")
    assert info.value.stage == "not_submitted"
