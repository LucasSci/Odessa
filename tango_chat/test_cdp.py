"""
Teste completo: abre Chrome com CDP, conecta via Playwright, e tenta enviar mensagem.
Executa tudo num unico processo para garantir que o Chrome nao morre entre os passos.
"""
import asyncio
import json
import subprocess
import sys
import time
import urllib.request
import os

# Forcar UTF-8 no stdout
os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.stdout.encoding != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

CDP_PORT = 9222
CDP_URL = f"http://127.0.0.1:{CDP_PORT}"


def wait_for_cdp(timeout=15):
    """Espera ate o Chrome CDP estar pronto."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{CDP_URL}/json/version")
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                return data
        except Exception:
            time.sleep(1)
    return None


def list_pages():
    """Lista as paginas abertas via CDP HTTP."""
    try:
        req = urllib.request.Request(f"{CDP_URL}/json")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return []


async def main():
    print("=" * 62)
    print("  TANGO CHAT BRIDGE -- TESTE COMPLETO")
    print("=" * 62)
    print()

    # -- Passo 1: Matar Chrome existente --
    print("[1/6] Fechando Chrome existente...")
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"],
                    capture_output=True, text=True)
    await asyncio.sleep(3)

    # -- Passo 2: Abrir Chrome com CDP --
    print("[2/6] Abrindo Chrome com --remote-debugging-port=9222...")

    import tempfile
    profile_dir = os.path.join(tempfile.gettempdir(), "chrome-cdp-odessa")

    chrome_args = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "https://tango.me",
    ]

    chrome_proc = subprocess.Popen(
        chrome_args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"       Chrome PID: {chrome_proc.pid}")

    # -- Passo 3: Esperar CDP --
    print("[3/6] Esperando CDP responder...", end="", flush=True)
    version = wait_for_cdp(timeout=20)
    if not version:
        print(" FALHOU!")
        print("       Chrome CDP nao respondeu em 20s.")
        sys.exit(1)
    print(f" OK! ({version.get('Browser', '?')})")

    # -- Passo 4: Listar abas --
    print("[4/6] Listando abas...")
    await asyncio.sleep(5)  # Deixa carregar
    pages = list_pages()
    tango_found = False
    for p in pages:
        url = p.get("url", "")
        if p.get("type") == "page":
            marker = " <<< TANGO" if "tango.me" in url.lower() else ""
            print(f"       {url[:80]}{marker}")
            if "tango.me" in url.lower():
                tango_found = True

    if not tango_found:
        print("       [!] Tango nao encontrado nas abas. Pode estar carregando.")

    # -- Passo 5: Conectar via Playwright --
    print("[5/6] Conectando via Playwright CDP...")
    from playwright.async_api import async_playwright

    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        print(f"       [OK] Conectou! Contextos: {len(browser.contexts)}")

        tango_page = None
        for ctx in browser.contexts:
            for page in ctx.pages:
                print(f"       Pagina: {page.url[:80]}")
                if "tango.me" in page.url.lower():
                    tango_page = page

        if tango_page:
            print(f"\n       [TANGO] Aba do Tango: {tango_page.url}")

            # Verificar seletores
            print("\n[6/6] Verificando seletores do chat...")

            # Esperar a pagina carregar
            await asyncio.sleep(5)

            # Titulo da pagina
            title = await tango_page.title()
            print(f"       Titulo da pagina: {title}")

            # Textarea
            textarea = await tango_page.query_selector('[data-testid="textarea"]')
            if textarea:
                print('       [OK] textarea [data-testid="textarea"] encontrado!')

                # TESTE DE ESCRITA
                print('\n       >>> TESTANDO ESCRITA NO CHAT...')
                print('       Digitando: "Teste do Odessa Bridge"')

                await textarea.click()
                await asyncio.sleep(0.3)
                await tango_page.keyboard.type("Teste do Odessa Bridge", delay=80)
                await asyncio.sleep(0.5)

                # Verificar se o texto foi digitado
                value = await textarea.input_value()
                print(f'       Valor no textarea: "{value}"')

                if value:
                    print("       [OK] TEXTO DIGITADO COM SUCESSO!")
                    print("\n       [!] NAO vou apertar Enter para nao enviar.")
                    print("       Para enviar de verdade, rode com --send")
                    
                    if "--send" in sys.argv:
                        await tango_page.keyboard.press("Enter")
                        print("       [OK] ENTER pressionado -- mensagem enviada!")
                else:
                    print("       [ERRO] Texto nao apareceu no textarea")
            else:
                print('       [ERRO] textarea [data-testid="textarea"] NAO encontrado')
                print('       O chat pode nao estar visivel na pagina.')
                print('       Verifique se voce esta logado e numa sala de chat.')

                # Buscar alternativas
                print("\n       Buscando seletores alternativos...")
                for sel in ['textarea', 'input[type="text"]', '[contenteditable="true"]', '[role="textbox"]']:
                    el = await tango_page.query_selector(sel)
                    if el:
                        tag = await el.evaluate("el => `${el.tagName}.${el.className}`")
                        print(f'       [ALT] Encontrado: {sel} -> {tag}')

                # Tentar pegar o HTML da pagina para debug
                body_html = await tango_page.evaluate("document.body.innerHTML.substring(0, 2000)")
                print(f"\n       [DEBUG] Primeiros 2000 chars do body:")
                # Sanitizar para cp1252
                safe_html = body_html.encode("ascii", errors="replace").decode("ascii")
                print(f"       {safe_html[:500]}")

            # Container do chat
            container = await tango_page.query_selector('[data-testid="virtuoso-item-list"]')
            if container:
                msgs = await tango_page.query_selector_all('[data-testid^="chat-event-"]')
                print(f'\n       Chat container OK: {len(msgs)} mensagens visiveis')
            else:
                print('\n       [!] Chat container nao encontrado (normal se nao estiver numa live)')

        else:
            print("\n       [!] Nenhuma aba do Tango encontrada")
            print("       Abra o Tango nesse Chrome e rode o teste novamente")

    except Exception as e:
        print(f"       [ERRO] Playwright: {e}")
    finally:
        await pw.stop()

    print()
    print("=" * 62)
    print("  TESTE CONCLUIDO")
    print("=" * 62)
    print()
    print("  Chrome continua aberto na porta CDP 9222.")
    print("  Proximo passo: faca login no Tango e entre numa live,")
    print("  depois rode: python tango_chat/tango_chat.py")
    print()


if __name__ == "__main__":
    asyncio.run(main())
