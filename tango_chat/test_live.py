"""
Teste rapido: conecta ao Chrome existente e verifica seletores do chat.
NAO mata o Chrome. NAO envia mensagem.
"""
import asyncio
import sys
import os
import io
import json

os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


async def test():
    from playwright.async_api import async_playwright

    print("[1] Conectando ao Chrome via CDP (127.0.0.1:9222)...")
    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
        print(f"[OK] Conectou! Contextos: {len(browser.contexts)}")

        tango_page = None
        for ctx in browser.contexts:
            for page in ctx.pages:
                url = page.url
                print(f"  Pagina: {url[:100]}")
                if "tango.me" in url.lower():
                    tango_page = page

        if not tango_page:
            print("[ERRO] Nenhuma aba do Tango encontrada")
            return

        print(f"\n[TANGO] {tango_page.url}")
        title = await tango_page.title()
        print(f"Titulo: {title}")

        await asyncio.sleep(2)

        # Testar textarea
        textarea = await tango_page.query_selector('[data-testid="textarea"]')
        print(f'\ntextarea [data-testid="textarea"]: {"ENCONTRADO" if textarea else "NAO ENCONTRADO"}')

        # Testar container do chat
        container = await tango_page.query_selector('[data-testid="virtuoso-item-list"]')
        print(f'chat container [virtuoso-item-list]: {"ENCONTRADO" if container else "NAO ENCONTRADO"}')

        # Testar seletores de username/texto
        usernames = await tango_page.query_selector_all(".Hhi6n")
        texts = await tango_page.query_selector_all(".KR99L")
        print(f"usernames (.Hhi6n): {len(usernames)}")
        print(f"textos (.KR99L): {len(texts)}")

        # Se o textarea NAO foi encontrado, buscar alternativas
        if not textarea:
            print("\nBuscando seletores alternativos...")
            for sel in [
                "textarea",
                'input[type="text"]',
                '[contenteditable="true"]',
                '[role="textbox"]',
                "[placeholder]",
            ]:
                els = await tango_page.query_selector_all(sel)
                for el in els:
                    info = await el.evaluate(
                        """el => ({
                            tag: el.tagName,
                            cls: el.className.substring(0,60),
                            ph: el.placeholder || "",
                            testid: el.dataset?.testid || "",
                            vis: el.offsetHeight > 0
                        })"""
                    )
                    if info.get("vis"):
                        print(f"  [VISIVEL] {sel} -> {info}")
                    else:
                        print(f"  [oculto] {sel} -> {info}")

        # Se container NAO encontrado, procurar estrutura do chat
        if not container:
            print("\nProcurando elementos com data-testid contendo 'chat'...")
            chat_html = await tango_page.evaluate(
                """() => {
                const chatEls = document.querySelectorAll('[data-testid*="chat"]');
                const results = [];
                chatEls.forEach(el => {
                    results.push({
                        testid: el.dataset.testid,
                        tag: el.tagName,
                        cls: el.className.substring(0,50)
                    });
                });
                return JSON.stringify(results, null, 2);
            }"""
            )
            print(f"  {chat_html[:1000]}")

            # Procurar virtuoso
            print("\nProcurando elementos com data-testid contendo 'virtuoso'...")
            virt_html = await tango_page.evaluate(
                """() => {
                const els = document.querySelectorAll('[data-testid*="virtuoso"]');
                const results = [];
                els.forEach(el => {
                    results.push({
                        testid: el.dataset.testid,
                        tag: el.tagName,
                        children: el.children.length
                    });
                });
                return JSON.stringify(results, null, 2);
            }"""
            )
            print(f"  {virt_html[:500]}")

        # Se ENCONTROU o textarea, testar digitacao
        if textarea:
            print("\n>>> TESTANDO DIGITACAO...")
            await textarea.click()
            await asyncio.sleep(0.3)
            await tango_page.keyboard.type("Teste Odessa Bridge", delay=80)
            await asyncio.sleep(0.5)
            value = await textarea.input_value()
            print(f'Valor digitado: "{value}"')
            if value:
                print("[OK] DIGITACAO FUNCIONA!")
            else:
                print("[ERRO] Texto nao apareceu")
            # Limpar sem enviar
            await tango_page.keyboard.press("Control+a")
            await tango_page.keyboard.press("Backspace")
            print("Textarea limpo (nao enviou)")

        # Se seletores de classe hash nao encontraram nada mas container existe
        if container and len(usernames) == 0:
            print("\nSeletores de classe hash podem ter mudado!")
            print("Extraindo HTML de amostra...")
            sample = await container.evaluate(
                """el => {
                const items = el.querySelectorAll('[data-testid^="chat-event-"]');
                if (items.length === 0) return 'NENHUM chat-event encontrado';
                const last = items[items.length - 1];
                return last.outerHTML.substring(0, 1000);
            }"""
            )
            safe = sample.encode("ascii", errors="replace").decode("ascii")
            print(f"  {safe}")

        print("\n" + "=" * 50)
        print("RESULTADO:")
        if textarea:
            print("  -> textarea OK, digitacao funciona")
        else:
            print("  -> textarea NAO encontrado (chat nao visivel?)")
        if container:
            print("  -> chat container OK")
        else:
            print("  -> chat container NAO encontrado")
        print("=" * 50)

    except Exception as e:
        print(f"[ERRO] {e}")
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(test())
