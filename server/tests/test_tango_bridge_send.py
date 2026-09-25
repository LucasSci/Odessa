"""Envio de mensagem pela bridge do Tango (tango_chat.send_message).

É o passo que de fato escreve no chat da live (#158). O teste com página
falsa roda em qualquer lugar; o com Chromium de verdade roda quando há um
navegador disponível (PW_CHROMIUM_PATH ou os browsers do Playwright).
"""

import asyncio
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


class FakeLocator:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    async def wait_for(self, **_kwargs):
        self.page.calls.append(("wait_for", self.selector))

    async def click(self):
        self.page.calls.append(("click", self.selector))


class FakeKeyboard:
    def __init__(self, page):
        self.page = page

    async def type(self, char, delay=0):
        self.page.typed += char

    async def press(self, key):
        self.page.calls.append(("press", key))


class FakePage:
    def __init__(self):
        self.calls, self.typed = [], ""
        self.keyboard = FakeKeyboard(self)

    def locator(self, selector):
        return FakeLocator(self, selector)


def _bridge_with(page):
    bridge = tango_chat.TangoChatBridge()
    bridge._page = page
    return bridge


def test_sem_pagina_conectada_recusa_enviar():
    with pytest.raises(RuntimeError, match="nao conectada"):
        asyncio.run(tango_chat.TangoChatBridge().send_message("oi"))


def test_clica_no_campo_digita_tudo_e_envia_com_enter(monkeypatch):
    monkeypatch.setattr(tango_chat, "SELETOR_INPUT_TEXTO", "#chat-input")
    monkeypatch.setattr(tango_chat, "SELETOR_BOTAO_ENVIAR", "")
    page = FakePage()
    asyncio.run(_bridge_with(page).send_message("Oi @ana, bem-vinda!"))
    assert page.typed == "Oi @ana, bem-vinda!"
    assert page.calls == [("wait_for", "#chat-input"), ("click", "#chat-input"), ("press", "Enter")]


def test_usa_o_botao_de_enviar_quando_configurado(monkeypatch):
    monkeypatch.setattr(tango_chat, "SELETOR_INPUT_TEXTO", "#chat-input")
    monkeypatch.setattr(tango_chat, "SELETOR_BOTAO_ENVIAR", "#send")
    page = FakePage()
    asyncio.run(_bridge_with(page).send_message("valeu!"))
    assert page.calls[-1] == ("click", "#send")


CHAT_PAGE = """
<textarea data-testid="textarea"></textarea>
<ul id="sent"></ul>
<script>
  const input = document.querySelector('[data-testid="textarea"]');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const li = document.createElement('li');
      li.textContent = input.value;
      document.getElementById('sent').appendChild(li);
      input.value = '';
    }
  });
</script>
"""


def test_envia_de_verdade_num_chromium(monkeypatch):
    from playwright.async_api import async_playwright

    executable = os.getenv("PW_CHROMIUM_PATH")
    monkeypatch.setattr(tango_chat, "SELETOR_INPUT_TEXTO", '[data-testid="textarea"]')
    monkeypatch.setattr(tango_chat, "SELETOR_BOTAO_ENVIAR", "")

    async def scenario():
        async with async_playwright() as p:
            try:
                browser = await p.chromium.launch(executable_path=executable or None)
            except Exception as exc:  # sem navegador instalado (ex.: CI do backend)
                pytest.skip(f"Chromium indisponível: {exc}")
            page = await browser.new_page()
            await page.set_content(CHAT_PAGE)
            await _bridge_with(page).send_message("Olá chat, a Odessa chegou!")
            sent = await page.locator("#sent li").all_inner_texts()
            await browser.close()
            return sent

    assert asyncio.run(scenario()) == ["Olá chat, a Odessa chegou!"]
