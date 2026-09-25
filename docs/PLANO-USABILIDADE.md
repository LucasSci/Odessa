# Plano de melhoria de uso — início rápido, bridge multi-navegador e Copiloto

Versão 1 · 2026-09-24 · baseado no código de `main` (`8ca0bdb`) e em medições
feitas nesta máquina (Windows 11, Edge 153, Chrome instalado, Ollama em CPU).

---

## 0. Resumo

Quatro frentes (decisões de 2026-09-24 na seção 8):

| Frente | Problema hoje (medido) | Meta |
|---|---|---|
| **A. Início rápido** | Abrir o app leva de **13 s a 2 min 16 s**; em 9 de 23 aberturas o backend caiu antes de ficar pronto | Painel utilizável em **< 8 s**, com feedback visual desde o 1º segundo, e live pronta em **1 clique** |
| **B. Bridge em qualquer navegador** | Só abre o **Chrome**, mas o seu navegador padrão é o **Edge**. O instalador carrega um Chromium próprio que ocupa **70% do runtime** | Edge, Chrome, Brave, Opera e Vivaldi, detectados automaticamente. Testado: **Edge funciona** nos dois modos da bridge |
| **C. Conversa → Copiloto** | A aba só simula o chat da live e não enxerga a biblioteca, o fluxo nem a geração | Uma aba que **consulta, organiza e produz** conteúdo com ferramentas, aprovação e desfazer |
| **D. IA local embutida** | A IA local exige instalar o Ollama (~2,8 GB) e roda só na CPU: **2,0 tok/s**, ~20–30 s por resposta | Motor llama.cpp **embutido** (32,5 MB), sem Ollama: **validado**, com o 3B na GPU integrada respondendo o chat em **1,6–2,7 s** |

Mais uma frente **transversal**, pré-requisito das outras: **estado e chaves no servidor**.
Hoje ~25 configurações vivem no `localStorage` do navegador, e as chaves de IA
só podem ser configuradas editando o `.env`.

---

## 1. Diagnóstico (com evidências)

### 1.1 Inicialização

Log real do launcher (`%LOCALAPPDATA%\Odessa\logs\odessa.log`), todas as 23 aberturas registradas (15 a 20/09):

| Resultado | Vezes | Tempo |
|---|---|---|
| Pronto | 4 | 13 s, 17 s, 18 s, 59 s |
| "Não respondeu a tempo (45s)" | **10** | **2 min 16 s** cada |
| Backend caiu antes de ficar pronto | **9** | 3 s – 2 min 18 s |

Causas encontradas:

1. **8,1 s bloqueando a subida.** `server/main.py` (lifespan) importa
   `server.services.ai_service` antes do `yield`. Esse módulo importa `openai`
   (3,7 s) e `google.genai` (3,2 s) no topo, mesmo quando só o Ollama é usado.
   No backend instalado, o log mostra 9,4 s entre "starting up" e "startup complete".
2. **O "45 s" do launcher vale 135 s.** O laço em
   `desktop/launcher/start-odessa.ps1` faz 45 × (sleep de 1 s + `Invoke-WebRequest`
   com timeout de 2 s). Com o backend lento, cada volta dura 3 s.
3. **Nenhum feedback visual.** Nada aparece até o navegador abrir. O usuário clica
   de novo, e isso gera instâncias concorrentes e disputa pela porta.
4. **Quedas sem diagnóstico claro.** O launcher registra `código ` vazio, e o
   `backend.err.log` é sobrescrito a cada tentativa.

### 1.2 Bridge e navegador

- **Chrome fixo** em `server/services/bridge_manager.py`
  (`find_chrome_executable`, `launch_chrome_for_live`, `create_desktop_shortcut`)
  e na UI (`BridgeConnectionGuide.tsx`: "Abrir Chrome da Live").
- **Navegador padrão desta máquina:** `MSEdgeHTM` (Edge). O painel abre no Edge,
  mas a live exige o Chrome.
- **Modo standalone** usa o Chromium baixado pelo Playwright:
  **707 MB dos 1012 MB** do runtime Python do instalador
  (`desktop/build/python/.../.local-browsers`). O instalador atual tem **342 MB**.
- **Teste feito agora no Edge**, com perfil temporário e sem tocar no seu Edge:

| Teste | Resultado |
|---|---|
| Playwright `launch_persistent_context(channel="msedge")` | ✅ abre, executa JS, user-agent `Edg/`, **screencast CDP funcionando** (o que o monitor da live usa), 5,9 s |
| Edge com `--remote-debugging-port` + perfil dedicado → `connect_over_cdp` | ✅ `/json/version` = `Edg/153.0.4234.48`, acoplado em 5,2 s |
| Descoberta pelo registro (`App Paths\msedge.exe`, `chrome.exe`) | ✅ caminhos corretos |

### 1.3 Estado preso no navegador

~25 chaves de `localStorage`, entre elas: configuração de IA, regras de
automação, catálogo e aprendizado de presentes, biblioteca de pautas/roteiros,
perfis de OBS, config da live, TTS, memória da persona, perfis de usuários e
conversas do laboratório.

Consequência: **trocar de navegador** (Chrome → Edge), **mudar de porta**
(`:3000` no dev, `:8000` no instalado) ou limpar dados do site faz tudo
"sumir". Isso também impede o Copiloto (no backend) de enxergar esses dados.

### 1.4 Chaves de IA

- O `.env` de dev tem chaves de Gemini, Anthropic e OpenAI.
- O `.env` do **app instalado** só tem `AI_PROVIDER=ollama`, e o log confirma
  "No AI providers configured".
- Chaves de Anthropic, OpenAI e Higgsfield só podem ser colocadas editando o
  arquivo oculto `%LOCALAPPDATA%\OdessaStudio\.env`.

### 1.5 Aba Conversa hoje

- `PersonaChatLab.tsx` usa `generateTangoChatReply`: é um **simulador do chat da
  live** (respostas curtas, voz da persona).
- A única "ação" é um protocolo em texto (`<autoconfig>{...}</autoconfig>`) para
  a persona mudar a si mesma: nome, descrição, avatar e foto nova.
- Não consulta biblioteca, fluxo, gatilhos, fila de geração nem histórico da live.
- A camada de IA (`ai_service.py`) é de **turno único** (system + user), **sem
  chamada de ferramentas nativa** e **sem streaming**.

Teste de ferramentas com a IA local (qwen2.5 7B no Ollama, 3 ferramentas, pedido em português):

| Turno | Resultado | Tempo |
|---|---|---|
| 1 — "quais vídeos de beijo eu tenho?" | ✅ chamou `library_search_videos(category="gatilho", query="beijo")` | **89 s** |
| 2 — recebeu a lista com os duplicados | ❌ escreveu "vou arquivar…" **sem chamar** a ferramenta | **167 s** |

O Ollama roda **100% na CPU**: a GPU integrada AMD foi descartada, a máquina
tem 15,4 GB de RAM e havia 4,9 GB livres. O `gemma4:26b` instalado (18 GB) não
cabe na RAM livre.

**Conclusão:** o modelo local serve para comandos simples e para o chat da
live, mas **não para um copiloto de vários passos** nesta máquina.

---

## 2. Frente T — Estado e chaves no servidor (transversal)

Vem primeiro porque destrava B (trocar de navegador sem perder nada) e C (o
Copiloto precisa ler tudo pelo backend).

### T1. Store de preferências no backend

- `GET/PUT /api/v1/prefs/{namespace}`: JSON por namespace, gravado com
  `atomic_json` (já existe, com lock, `.bak` e recuperação).
- Namespaces = as chaves atuais (`ai-config`, `automation-rules`,
  `gift-catalog`, `content-library`, `obs-profiles`, `live-config`, `tts-settings`…).
- No frontend, um hook `usePersistentState(namespace)`:
  1. lê o cache local,
  2. busca no servidor,
  3. grava no servidor com debounce.
- `localStorage` passa a ser **só cache**, o mesmo padrão que `videoEdits.ts` já usa.
- **Migração automática** na 1ª abertura: se o servidor estiver vazio e o
  navegador tiver dados, sobe para o servidor e registra num log de migração.
- Ficam no navegador só as preferências de tela: aba aberta, painel recolhido etc.

### T2. Chaves e provedores pela interface

- Tela "Conexões" com os campos: Anthropic, OpenAI, Gemini, Higgsfield,
  vídeo (RouteLLM) e senha do OBS.
- Botão **Testar** em cada campo, que faz uma chamada mínima e mostra ✅/❌ com o motivo.
- As chaves ficam no servidor, **cifradas com DPAPI** do Windows (por usuário) e
  **nunca voltam** para o navegador: a UI só vê "configurada ✅ · termina em …a1f3".
- O `.env` continua valendo como override (dev e Docker).

Arquivos: `server/config.py` (ler do store após o `.env`), novo
`server/core/secrets_store.py`, `AiConfigPanel.tsx`, `SettingsPanel.tsx`.

**Critério de aceite:** abrir o painel no Edge depois de usar no Chrome mostra
as mesmas regras, presentes, pautas e configurações de IA; configurar a chave
da Anthropic sem abrir arquivo nenhum.

---

## 3. Frente A — Início rápido

### A1. Backend pronto em < 3 s

- `ai_service.py`: importar `openai` e `google.genai` **dentro** dos métodos que
  os usam (import tardio) e criar os clientes na 1ª chamada.
- `main.py` (lifespan): disparar o keep-alive do Ollama como tarefa que importa
  o módulo **dentro** dela, depois do `yield` lógico, sem bloquear a subida.
- Auditar com `python -X importtime -c "import server.main"` e travar num teste:
  import de `server.main` < 2,5 s no runtime do instalador.
- `desktop_runtime.mark_boot_event` já existe: expor `boot_metrics` no
  Diagnóstico (tempo até health, até core e até heavy).

### A2. Launcher com feedback imediato e sondagem correta

- **Tela de abertura em < 1 s:** o launcher abre `launcher/splash.html` (arquivo
  local) no navegador. A página consulta `http://127.0.0.1:8000/health` a cada
  300 ms, mostra etapas ("iniciando servidor → carregando personas → pronto") e
  redireciona sozinha. Clicar duas vezes no atalho deixa de gerar corrida.
- **Sondagem por prazo, não por contagem:** prazo total de 60 s medido no
  relógio, timeout de 500 ms por tentativa.
- **Falha legível:**
  - guardar o código de saída de verdade;
  - rotacionar o `backend.err.log` **antes** de cada tentativa (hoje ele é
    sobrescrito);
  - mostrar na splash as últimas 20 linhas do erro, com um botão "Copiar diagnóstico".
- **Janela de app:** abrir o painel com `--app=http://localhost:8000` no
  navegador escolhido (Edge ou Chrome). Sem abas nem barra de endereço, parece
  um programa, e nunca abre no Firefox por engano.
- **Ícone na bandeja** (`NotifyIcon` no próprio supervisor, que já fica vivo):
  - Abrir painel
  - Reiniciar backend
  - Abrir logs
  - Iniciar com o Windows (liga/desliga)
  - Sair

### A3. "Pronto para live" em 1 clique

Hoje, para capturar o chat: abrir a aba → abrir o Chrome → iniciar a bridge →
acoplar → conectar o OBS → conferir o fluxo. Proposta:

1. **Retomar a última sessão:** ao abrir, o backend já sobe a bridge com o
   navegador e a sala salvos. `ODESSA_AUTOSTART_BRIDGE` passa a ser **ligado
   por padrão** no desktop, mas só depois de a bridge ter funcionado uma vez.
2. **Tela única "Preflight"** na Central da Live. Cada item tem estado e um
   botão **Consertar** que resolve em 1 clique:
   - servidor
   - IA (local ou nuvem, com latência medida)
   - navegador da live
   - login no Tango
   - chat capturado
   - OBS conectado e cena certa
   - persona ativa e fluxo publicado
   - vídeo idle
3. Botão principal **"Entrar ao vivo"**: só habilita com tudo verde, ou com
   "entrar mesmo assim" listando o que falta.
4. **Reuso:** `liveReadinessSupervisor.ts` e `ValidationChecklist.tsx` já
   calculam boa parte desses estados. O trabalho é unificar numa tela só e
   ligar as ações de conserto.

### A4. Ambiente de dev

- `scripts/start-odessa.ps1`: trocar o `Start-Sleep -Seconds 4` fixo por espera no `/health`.
- `npm run dev:all`: backend e frontend num comando só, com saída prefixada.

**Critério de aceite A:**
- p95 do duplo-clique até o painel utilizável < 8 s em 10 aberturas seguidas, sem queda;
- com a bridge já configurada uma vez, "chat capturado" sem nenhum clique.

---

## 4. Frente B — Bridge em qualquer navegador (Chromium)

### B1. Descoberta de navegadores

Novo `server/services/browser_discovery.py`:

```python
BrowserInfo = {id, name, exe, version, family: "chromium", isDefault, source}
# ids: edge, chrome, brave, opera, vivaldi, chromium-bundled
```

Ordem de busca:
1. registro `App Paths` (HKLM/HKCU);
2. caminhos conhecidos (`Program Files`, `Program Files (x86)`, `LOCALAPPDATA`);
3. `PATH`;
4. Chromium do Playwright, se existir.

O navegador padrão vem de
`HKCU\...\UrlAssociations\https\UserChoice\ProgId`
(`MSEdgeHTM`, `ChromeHTML`, `BraveHTML`…). A versão vem das informações de
arquivo do `.exe`.

API `GET /api/v1/chat-automation/bridge/browsers` → lista + recomendado.

**"Automático"** (padrão), com **escolha manual** pelo usuário salva no config da bridge:
1. o navegador padrão, se for Chromium;
2. senão, o Edge (vem com todo Windows 10/11);
3. senão, o Chrome;
4. senão, o Chromium embutido.

### B2. Modo **Gerenciado** (recomendado, padrão)

O Odessa abre o navegador escolhido **ele mesmo**, via Playwright:

- Edge e Chrome: `launch_persistent_context(channel="msedge"|"chrome")`;
- demais: `executable_path=<exe>`.

Regras:
- Perfil **dedicado por navegador** em `runtime/browser-profiles/<id>/`. Login
  no Tango **uma vez**; depois a sessão persiste.
- Sem porta de depuração, então sem conflito com o navegador pessoal aberto.
- O screencast e a interação remota do `LiveVisionMonitor` continuam iguais
  (testado no Edge).
- Os args e a supressão do `--enable-automation` que já existem em
  `_try_standalone` passam a valer para todos.

Em `tango_chat.py`, `_try_standalone` ganha `browser_id`, que resolve para
`channel` ou `executable_path` vindo do config que o `bridge_manager` já repassa
via `--config`.

### B3. Modo **Acoplar** (avançado)

Para quem quer usar uma janela aberta à parte:

- `launch_browser_for_live(browser_id, url)` substitui `launch_chrome_for_live`:
  - mesmo padrão de perfil dedicado (obrigatório no Chrome 136+ e necessário no Edge);
  - **porta livre automática**, 9222 ou a próxima livre, salva no config da bridge.
- `get_debug_tabs` lê também `/json/version` e mostra **qual navegador**
  acoplou ("Edge 153").
- O atalho na área de trabalho é criado para o navegador escolhido
  (`create_desktop_shortcut(browser_id)`).

### B4. Chromium embutido continua (decidido em 2026-09-24)

- O instalador **mantém** o Chromium do Playwright. Ele vira a **última opção**
  do Automático e aparece no seletor como "Navegador interno do Odessa".
- Garante que a live funcione mesmo sem Edge ou Chrome, ou quando uma política
  corporativa bloquear a depuração no navegador do sistema.
- Nada muda no `build-runtime.ps1`.

### B5. Interface

- Seletor **"Navegador da live"**: Automático · Edge · Chrome · Brave…, com ícone
  e versão e o selo "padrão do sistema".
- O guia de conexão cai de 4 para 2 passos:
  1. **Abrir navegador da live** (abre já na sala do Tango);
  2. **Faça login no Tango uma vez** (detectado sozinho).

  "Iniciar bridge" e "Acoplar" somem do caminho feliz e ficam em "Avançado".
- Os textos "Chrome" viram "navegador da live" em `BridgeConnectionGuide.tsx`,
  `TangoChatPanel.tsx`, `LiveVisionMonitor.tsx` e `docs/OBS-TANGO.md`.
- Migração: quem já usa o Chrome continua no Chrome (`browser="chrome"` gravado
  no 1º boot).

### B6. Compatibilidade

| Navegador | Suporte | Observação |
|---|---|---|
| Edge | ✅ testado | Gerenciado e Acoplar funcionando (Edge 153) |
| Chrome | ✅ atual | Mantido |
| Brave, Opera, Vivaldi, Arc | ✅ esperado | Chromium: mesmo caminho via `executable_path`; validar um por um |
| Firefox | ❌ | Não fala CDP. Só via **extensão** (fase futura, ver B8) |

### B7. Riscos específicos

- **Edge em segundo plano (Startup Boost):** processos do Edge continuam vivos e
  "engolem" novas flags se o perfil for o mesmo. O perfil dedicado resolve.
  Detectar e avisar se o perfil estiver travado.
- **Políticas corporativas** (`RemoteDebuggingAllowed` = falso): o CDP é
  bloqueado. Detectar pelo registro de políticas e explicar.
- **Telas de primeiro uso do Edge** num perfil novo: usar `--no-first-run`. Se
  ainda aparecer o assistente, pré-gravar o `Preferences` do perfil dedicado.
- **Anti-automação do Tango:** mesmo risco que já existe com o Chrome; manter o
  modo Acoplar como saída.

### B8. Futuro (avaliar depois): extensão de navegador

Uma extensão MV3 (Chrome/Edge Add-ons) com content script no `tango.me`:
- captura o chat e envia mensagens usando o **perfil normal** do usuário, sem
  perfil dedicado e sem porta;
- com `chrome.debugger`, também faz screencast (mostra a faixa "está depurando
  este navegador");
- é o único caminho para o Firefox (só o chat, sem screencast).

Custo: publicação nas lojas. Só vale se o modo Gerenciado não bastar.

**Critério de aceite B:**
- numa máquina só com Edge, instalar → abrir → login no Tango → chat capturado
  e tela da live no monitor, sem instalar o Chrome;
- instalador sem o Chromium embutido.

---

## 5. Frente C — Aba Conversa vira **Copiloto de produção**

### C0. Visão

A aba passa a ter dois modos:

| Modo | Para quê | Voz |
|---|---|---|
| **Persona** (o atual) | Testar a personalidade e simular o chat da live | Voz da persona |
| **Produção** (novo) | Operar o conteúdo: consultar, organizar, gerar | Assistente do operador, com a persona ativa como contexto |

Exemplos do que o modo Produção resolve:

- "Quais gatilhos de beijo eu tenho? Arquiva os duplicados."
- "O que falta no roteiro da Barbara para a IDLE v3?" → mostra as lacunas por
  âncora e oferece gerar os prompts.
- "Gera o lote 0 da Barbara." → monta os 5 prompts a partir da ficha, mostra o
  custo e, com o seu OK, enfileira; quando os vídeos chegam, roda o verificador
  de âncora e propõe adicionar ao pool.
- "Cria um gatilho: rosa → vídeo de coração." → edita o **rascunho** do fluxo e
  mostra o diff.
- "Como foi a live de ontem?" → top presentes, horários de pico e vídeos mais
  tocados, a partir do histórico da sessão.

### C1. Arquitetura

```
 Aba Conversa (modo Produção)
   │  POST /api/v1/assistant/threads/{id}/messages   (resposta em SSE)
   ▼
 assistant/agent_loop.py ── até N passos: modelo → ferramenta → resultado → modelo
   │            │
   │            ├─ providers/  (adaptadores com tool calling NATIVO + streaming)
   │            │    anthropic · openai · gemini · ollama   (+ fallback JSON p/ modelos sem tools)
   │            │
   │            └─ tools/registry.py  (nome, descrição, JSON schema, nível de risco, handler)
   │                   │  chama os SERVIÇOS Python direto (não HTTP):
   │                   ▼
   │     video · workflow (rascunho) · personas/assets · photogen · video_gen
   │     session_history · prefs (pautas/CTA) · tts · idle (verificador de âncora)
   │
   ├─ approvals/  → cartão "aprovar/rejeitar" para ações com escrita ou custo
   ├─ jobs/       → geração longa vira job com progresso; o Copiloto avisa no fim
   └─ audit_log   → toda escrita registra a operação inversa ⇒ botão "Desfazer"
```

- **Threads no servidor** (reusa o padrão de `conversation_service.py`), então a
  conversa segue em qualquer navegador.
- **Eventos SSE** para a UI: `text_delta`, `tool_call`, `tool_result`,
  `approval_required`, `job_started`, `job_update`, `done`, `error`.
- `ai_service.py` ganha `chat(messages, tools, stream)` por provedor. O método
  de turno único atual continua para o chat da live.

### C2. Catálogo de ferramentas (1ª versão)

Todas mapeadas para código que já existe.

| Ferramenta | Risco | Serviço/rota existente |
|---|---|---|
| `library.search_videos(query, categoria, âncora, persona, arquivados)` | leitura | `/video/library`, config da persona |
| `library.coverage(persona)` | leitura | `computeCoverage` (portar para Python) + lista da IDLE v3 |
| `library.duplicates(persona)` | leitura | hash de conteúdo (lógica do `check_idle_anchor.py`) |
| `library.get_video(id)` | leitura | `/video/{id}/timeline-metadata`, edições |
| `flow.get(persona, rascunho\|publicado)` · `flow.validate` | leitura | `/workflow/draft`, `/workflow/draft/validate` |
| `triggers.list(persona)` | leitura | config da persona (triggers, gift_map) |
| `personas.list` · `personas.get` · `assets.list(categoria)` | leitura | `/personas`, `/personas/{id}/assets/{cat}` |
| `content.list(persona)` | leitura | `/personas/{id}/content` |
| `videogen.state` · `queue` · `history` | leitura | `/video-gen/state`, `/queue`, `/history` |
| `session.summary(período)` | leitura | `/session-history`, `/sessions` |
| `pautas.list` | leitura | `prefs/content-library` (após T1) |
| `idle.check_anchor(videos, âncora)` | leitura | `scripts/check_idle_anchor.py` como função |
| `prompts.draft_video(persona, clipe)` | leitura | `persona_templates` + ficha da persona (sem custo) |
| `photo.generate(persona, prompt, referência)` | **custo** | `/personas/{id}/selfconfig/generate-photo` |
| `video.generate(persona, prompt, frame, template)` | **custo** | `/video-gen/generate`, `/generate-from-template` |
| `tts.speak(texto, voz)` | baixo | `/tts` |
| `library.update_meta(id, rótulo, descrição, categoria)` | escrita | config da persona |
| `library.archive(ids)` · `library.restore(ids)` | escrita reversível | `/video/{id}/archive`, `/restore`, `/archive/bulk` |
| `flow.add_node` · `flow.connect` · `flow.set_idle` | escrita no **rascunho** | `/workflow/draft` |
| `triggers.upsert(evento, condição, vídeo)` | escrita no **rascunho** | `/workflow/draft` |
| `pautas.create` · `pautas.update` | escrita | `prefs/content-library` |
| `persona.update(campos)` | escrita | `/personas/{id}/selfconfig/apply` (já com histórico) |

**Fora do Copiloto de propósito** (continuam só em botão manual):
`flow.publish`, `video.purge`, `video/all/clear`, `personas.delete`.

### C3. Regras de segurança

| Risco | Comportamento |
|---|---|
| Leitura | Executa direto; o cartão mostra o que foi consultado |
| Escrita reversível / rascunho | **Cartão de aprovação com diff** (antes → depois) e **Desfazer** depois de aplicado |
| Custo (geração) | Aprovação obrigatória com **estimativa de custo** e **teto diário** configurável |
| Destrutivo | Não existe como ferramenta |

- Reusa a **autonomia** que já existe (`manual` / `assistido` / `auto`, em
  `aiConfig.ts`) e o `requiresApproval` do `toolRegistry.ts`. Em "auto", só as
  escritas reversíveis dispensam aprovação; custo **sempre** pede.
- Organização mexe **só no rascunho** do fluxo; publicar continua sendo um
  botão seu. Isso também evita disputa com a live, que lê o fluxo **publicado**.
- Toda escrita entra no `audit_log` com a operação inversa (arquivar ↔
  restaurar; rascunho ↔ snapshot anterior).

### C4. Contexto automático

A cada turno, o Copiloto recebe um **retrato compacto do workspace**
(< 1.500 tokens) montado pelo backend:
- persona ativa;
- contagem por categoria e âncora e lacunas da IDLE;
- duplicatas;
- fila de geração;
- se o rascunho do fluxo difere do publicado;
- resumo da última live;
- créditos gastos hoje.

Assim a maioria das perguntas nem precisa de ferramenta, e as respostas partem
do estado real.

### C5. Modelo

Pelo teste da seção 1.5, a regra é:

| Situação | Motor |
|---|---|
| Há chave de nuvem (Claude, OpenAI ou Gemini) | Copiloto completo, vários passos, com tool calling nativo. Provedor **ainda não decidido**; o adaptador suporta os três |
| Só IA local (**embutida**, ver Frente D, ou Ollama) | **Modo leve:** ferramentas de leitura e 1 passo por vez, com aviso de latência. O motor embutido usa a mesma API do adaptador OpenAI, então é o mesmo código |
| Qualquer caso | **Comandos de barra determinísticos**, sem IA: `/lacunas`, `/duplicados`, `/fila`, `/gerar-lote <persona> <lote>`, `/live-ontem`. Respondem em < 1 s |

### C6. Interface

- **Cartões ricos no chat:**
  - vídeo com miniatura e play;
  - aprovação com diff;
  - progresso de job (reusa `GenerationProgressCard`);
  - galeria de resultados com "Adicionar ao pool A0", "Arquivar", "Abrir no editor".
- **@menções:** `@09_GATILHO…`, `@barbara`, `@A1_chat`. **Arrastar da
  Biblioteca** para o chat anexa como referência.
- **Chips de sugestão** gerados do retrato: "Faltam 6 transições — gerar prompts?",
  "3 duplicados — arquivar?".
- **Painel lateral de "Ações desta conversa"**, com tudo o que foi aplicado e o
  botão Desfazer em cada item.
- O modo Persona continua como está. Um seletor no topo alterna **Persona ⇄ Produção**.

### C7. Cenários de aceite (ponta a ponta)

1. **Organizar:** "arquiva os duplicados da Barbara"
   → `library.duplicates` → cartão com 11 itens
   → aprovar → arquivados
   → Desfazer restaura todos.
2. **Produzir a IDLE:** "gera o lote 0 da Barbara"
   → `prompts.draft_video` × 5 → cartão de custo
   → aprovar → 5 jobs com progresso
   → ao terminar, `idle.check_anchor` → "4 ok, 1 com pulo — regerar?"
   → os aprovados entram no pool A0 do **rascunho**.
3. **Pós-live:** "como foi ontem?"
   → `session.summary` → resumo com top presentes e vídeos mais tocados
   → sugestão de 2 gatilhos novos, como proposta.

---

## 5B. Frente D — IA local embutida no Odessa (sem Ollama)

**Resposta curta: dá para fazer.** O Ollama usa por baixo o motor **llama.cpp**.
O Odessa pode embarcar esse mesmo motor e gerenciar ele sozinho, do mesmo jeito
que já gerencia a bridge do Tango. O usuário não instala nada à parte.

O ganho de **velocidade** não vem de trocar o Ollama (é o mesmo motor). Vem de:
1. **ligar a GPU integrada**, que o Ollama descarta por padrão;
2. **escolher o tamanho de modelo** certo para a máquina.

### D1. Medições nesta máquina (2026-09-24/25)

Hardware: Ryzen 5 5500U (6 núcleos), Radeon Vega 7 integrada, 16 GB DDR4-3200.

**Etapa 1 — Ollama, CPU contra GPU integrada** (qwen2.5 7B, resposta de 128
tokens, modelo já carregado):

| Motor | Geração | Leitura do prompt | Tempo da resposta |
|---|---|---|---|
| Ollama, CPU (padrão) | 2,0 tok/s | 176 tok/s | 65 s |
| Ollama, GPU integrada (`OLLAMA_IGPU_ENABLE=1`) | 3,2 tok/s | 291 tok/s | 46 s |

**Etapa 2 — motor embutido, sem Ollama** (`llama-server` b11173, Vulkan).
"Chat" = resposta curta da persona Barbara a 3 mensagens reais de live:

| Modelo | Carga | RAM | Geração | Resposta do chat | Ferramenta, 1º passo | 2º passo (arquivar certo) |
|---|---|---|---|---|---|---|
| 1.5B — GPU integrada | 2,9 s | 1,4 GB | ~17 tok/s | **1,0–1,6 s** | 7 de 8 | 1 de 8 |
| 1.5B — só CPU | 5,5 s | 1,4 GB | ~9–10 tok/s | 2,4–4,9 s | 1 de 1 | 0 de 1 |
| **3B — GPU integrada** | **3,0 s** | **2,5 GB** | **~12 tok/s** | **1,6–2,7 s** | 8 de 8 | 1 de 8 |
| 7B (arquivo do Ollama) — GPU integrada | 13–24 s | 5,0 GB | ~4 tok/s | 8,5–11,9 s | 3 de 3 | 1 de 3 |

Conclusões:

1. **Funciona sem Ollama**, inclusive com o 7B que já estava baixado. E ficou
   mais rápido que o próprio Ollama na mesma GPU (4 contra 3,2 tok/s).
2. **Para o chat da live, o 3B na GPU integrada é o padrão:** ~2 s por
   resposta (hoje ~20–30 s), 2,5 GB de RAM e texto natural. O 1.5B fica como
   opção "Leve" (~1 s, 1,4 GB).
3. **Nenhum modelo local faz ação de vários passos com confiabilidade.**
   Eles acertam **a 1ª ferramenta** (qual consulta fazer) quase sempre, mas
   raramente dão o 2º passo, e às vezes erram de forma perigosa:
   - o 7B arquivou o único vídeo sem cópia;
   - o 3B tentou arquivar **IDs inventados** (`result_id_1`,
     `<ids-of-gatilho-beijo>`) no mesmo turno da consulta, antes de ver os dados.

   Com uma ferramenta "de alto nível" que já devolve a sugestão, o acerto
   continuou baixo (1 de 5 no 1.5B e no 3B, 1 de 2 no 7B).

4. **Regra de desenho que resolve isso (vale para o Copiloto, seção C):**
   - **Ações propostas pela ferramenta:** consultas como
     `library.duplicates` devolvem `acoes_propostas`, e o **sistema** monta o
     cartão de aprovação, sem esperar o modelo dar o 2º passo. O modelo local só
     precisa escolher a consulta certa, o que faz bem, e narrar o resultado.
   - **Validar todo argumento de escrita** contra o estado real: IDs que não
     existem na biblioteca são rejeitados antes do cartão.
   - **Consultas primeiro, escritas depois:** escrita pedida no mesmo turno de
     uma consulta é descartada e o modelo é chamado de novo com o resultado.
   - Tarefas longas de vários passos (ex.: "produzir o lote 0") usam **modelo
     de nuvem**, quando você decidir o provedor, ou **comandos de barra**
     determinísticos.

### D2. Arquitetura escolhida: `llama-server` embutido como processo filho

```
 backend FastAPI
   └─ local_llm/runtime.py  ── inicia/para/monitora ──►  llama-server.exe (llama.cpp oficial, Vulkan + CPU)
                                                           · 127.0.0.1:<porta livre>, com token (igual à bridge)
                                                           · API compatível com OpenAI: /v1/chat/completions
                                                           · streaming + tool calling (--jinja)
   └─ ai_service: provedor "local" = cliente OpenAI apontando para esse endereço
```

- **Tamanho no instalador:** o build oficial `llama-b11173-bin-win-vulkan-x64.zip`
  tem **32,5 MB** (GitHub `ggml-org/llama.cpp`, SHA-256 conferido). O
  **conjunto mínimo testado** é de 23 arquivos e 84 MB descompactados:
  - `llama-server.exe`, `llama-server-impl.dll`, `llama.dll`, `llama-common.dll`;
  - `ggml*.dll` (incluindo `ggml-vulkan.dll` e as variantes `ggml-cpu-*`);
  - `libomp.dll`, `mtmd.dll`.

  Para comparar, o Ollama instalado aqui ocupa ~2,8 GB, quase todo em
  bibliotecas CUDA/ROCm que esta máquina nem usa. A versão fica fixada no build
  e atualiza junto com o Odessa.
- **A GPU é detectada sem configuração:** `llama-server --list-devices` →
  `Vulkan0: AMD Radeon(TM) Graphics (8133 MiB)`.
- **Mesmo código para nuvem e local:** o provedor "local" fala a API da OpenAI, e
  a biblioteca `openai` já é dependência. O Copiloto (Frente C) usa um adaptador
  só para OpenAI e para o local, com tool calling e streaming.
- **Isolado do backend:** se o motor travar ou faltar memória, só ele reinicia e
  a live continua. Dá para **descarregar o modelo** quando ele não está em uso
  e devolver RAM ao OBS e ao navegador.

Por que não as alternativas:

| Alternativa | Por que não agora |
|---|---|
| `llama-cpp-python` dentro do processo do backend | No Windows, Vulkan exige compilar com o Vulkan SDK; uma falha nativa derruba o backend e a live junto |
| ONNX Runtime + DirectML | Não reaproveita os arquivos GGUF do Ollama, tem catálogo menor de modelos e o DirectML está em manutenção. Pode ser reavaliado depois |
| IA no navegador (WebGPU) | O modelo só existe com a aba aberta e fica guardado por navegador (o oposto da meta de trocar de navegador sem perder nada); a bridge e as respostas automáticas rodam no backend |

### D3. Modelos

- Pasta própria: `%LOCALAPPDATA%\OdessaStudio\models\`.
- **Importar do Ollama sem baixar de novo:** os arquivos do Ollama são GGUF
  comuns (conferido: o `sha256-2bada8a…` do qwen2.5 começa com `GGUF`). O Odessa
  lê os manifests em `~/.ollama/models/manifests` e usa o arquivo no lugar, sem copiar.
- Catálogo curto na interface, com recomendação automática pela RAM:

| Opção | Modelo base (validado em D6) | Download | Indicado para |
|---|---|---|---|
| Leve | Qwen2.5 1.5B Instruct Q4_K_M | 1,12 GB | 8 GB de RAM, ou live com OBS pesado (~1 s por resposta, 1,4 GB) |
| **Equilibrado** (padrão com 16 GB) | Qwen2.5 3B Instruct Q4_K_M | 2,1 GB | chat da live (~2 s, 2,5 GB) + Copiloto em modo leve |
| Qualidade | Qwen2.5 7B Instruct Q4_K_M (ou o do Ollama) | 4,7 GB | ≥ 24 GB de RAM, ou fora da live (~10 s, 5 GB) |

- Download com progresso, retomada e conferência de **SHA-256** (o Hugging Face
  publica o hash de cada arquivo).
- A lista de modelos fica num arquivo de catálogo, então trocar por uma família
  mais nova não exige mexer em código.

### D4. Dispositivo e memória

- Na 1ª execução, o `llama-server --list-devices` detecta a GPU (Vulkan).
- Um **teste de 20 s** mede CPU contra GPU integrada e salva o mais rápido. O
  botão "Refazer teste de velocidade" fica no Diagnóstico.
- **Política de RAM:**
  - carrega sob demanda;
  - fica "quente" durante a live;
  - descarrega após 10 min sem uso fora da live;
  - se a RAM livre ficar abaixo de ~1,5 GB, avisa e sugere o modelo Leve.
- **Contexto de 4096 tokens** por padrão: suficiente para o chat e para o
  retrato do workspace do Copiloto.

### D5. Interface e migração

- Em Configurações → IA, o provedor **"IA local do Odessa"** vira o padrão
  para instalações novas. "Ollama" continua disponível para quem já usa.
- Assistente de 1ª execução: "Usar IA local (baixar 2,1 GB)" · "Importar do
  Ollama (encontrado: qwen2.5 7B)" · "Usar só nuvem".
- O Diagnóstico mostra modelo carregado, dispositivo (GPU integrada ou CPU),
  tok/s medido e RAM usada.
- O keep-alive do Ollama (`ollama_keepalive_loop`) passa a valer para o motor ativo.

### D6. Validação — ✅ feita em 2026-09-25

- Motor oficial, SHA-256 conferido, rodando de pasta temporária sem instalar nada.
- Modelos 1.5B e 3B baixados do Hugging Face, com SHA-256 conferido. O 7B foi
  reaproveitado do Ollama sem o Ollama rodando.
- Resultados na tabela D1. **Decisão técnica: 3B como padrão, 1.5B como "Leve".**
- O script de benchmark foi salvo em `scripts/bench_local_llm.py` e vira base de um teste de
  fumaça do motor e do botão "Refazer teste de velocidade" (D4).

**Critério de aceite D:**
- instalação limpa, sem Ollama → a persona responde no chat da live e no
  laboratório com a IA local;
- chat da live com o modelo padrão em ≤ 3 s por resposta nesta máquina (medido: 1,6–2,7 s);
- se o motor morrer, reinicia sem derrubar o backend.

---

## 6. Sequência e estimativa

Estimativas em dias de trabalho focado (implementação + testes). Servem para
ordenar, não são prazo.

| # | Entrega | Depende de | Estimativa |
|---|---|---|---|
| 1 | **A1** backend < 3 s + **A2** splash, sondagem e falha legível | — | 1–2 d |
| 2 | **B1 + B2 + B3** descoberta, modo Gerenciado e Acoplar para qualquer Chromium | — | 3–4 d |
| 3 | **B5** interface do navegador da live (2 passos) | 2 | 1–2 d |
| 4 | **T1** store de preferências + migração do `localStorage` | — | 3–4 d |
| 5 | **T2** chaves pela interface (DPAPI + Testar) | 4 | 2 d |
| 6 | **A3** Preflight + "Entrar ao vivo" + autostart da bridge | 2, 3 | 3 d |
| 7 | ~~**D6** validação da IA embutida~~ ✅ feita | — | — |
| 8 | **D2–D5** IA local embutida: runtime, modelos, importar do Ollama, interface | 7 | 4–5 d |
| 9 | **C-a** Copiloto de leitura: adaptadores com tools + SSE + retrato + comandos de barra | 4, 5, 8 | 4–5 d |
| 10 | **C-b** geração: jobs + custo + teto + check de âncora | 9 | 3–4 d |
| 11 | **C-c** organização: rascunho, diff, audit log, Desfazer | 9 | 4–5 d |
| 12 | **C-d** interface: cartões, @menções, arrastar, chips | 9–11 | 3–4 d |
| 13 | **A2** bandeja + iniciar com o Windows · **A4** dev | 1 | 1 d |

Caminho mais curto para sentir diferença: **1 → 2 → 3** (cerca de uma semana).
Com isso, abrir o app fica rápido e a live funciona no Edge.
A validação **7** não depende de nada e pode rodar em paralelo, logo no início.

---

## 7. Métricas

| Métrica | Hoje | Meta |
|---|---|---|
| Duplo-clique → painel utilizável (p95) | 2 min 16 s | < 8 s |
| Aberturas com queda antes de ficar pronto | 9 de 23 | 0 |
| Primeiro sinal visual após o clique | só quando o navegador abre (13 s+) | < 1 s (splash) |
| Cliques para "chat capturado" (já configurado) | ~4–6 | 0 (retoma sozinho) |
| Navegadores suportados na live | Chrome (+ Chromium embutido) | Automático + escolha do usuário: Edge, Chrome, Brave, Opera, Vivaldi, interno |
| IA local sem instalar programa à parte | não (exige Ollama, ~2,8 GB) | sim (motor de 32,5 MB embutido) |
| Resposta do chat com IA local nesta máquina | ~20–30 s (7B em CPU) | ≤ 3 s (3B + GPU integrada; medido 1,6–2,7 s) |
| Configurações perdidas ao trocar de navegador | ~25 grupos | 0 |
| Organizar duplicatas pela Conversa | impossível | 1 pedido + 1 aprovação |

---

## 8. Decisões

Tomadas em 2026-09-24:

- ✅ **Navegador da live:** Automático (padrão do sistema → Edge → Chrome →
  interno), com **escolha manual** do usuário salva nas configurações.
- ✅ **Chromium embutido:** continua no instalador, como última opção (B4).
- ✅ **Hostinger:** fora do plano; não é mais usada. As rotas novas existem só
  no backend FastAPI.
- ✅ **IA local:** tentar o motor embutido, sem Ollama (Frente D), começando pela validação D6.

Em aberto:

1. **Provedor de nuvem do Copiloto e teto de gasto** (Claude, OpenAI ou Gemini).
   Não bloqueia: o Copiloto começa com a IA local em modo leve e com os
   comandos de barra.
2. **Autonomia padrão do Copiloto:** sugiro "assistido", com aprovação em toda
   escrita e custo.
3. ~~Modelo local padrão~~ → 3B (Equilibrado), medido no D6.

---

## Apêndice — onde mexe

| Área | Arquivos |
|---|---|
| Boot | `server/main.py`, `server/services/ai_service.py`, `server/core/desktop_runtime.py`, `desktop/launcher/start-odessa.ps1`, novo `desktop/launcher/splash.html` |
| Bridge | `server/services/bridge_manager.py`, novo `server/services/browser_discovery.py`, `tango_chat/tango_chat.py`, `server/api/v1/endpoints/chat_automation.py`, `src/components/BridgeConnectionGuide.tsx`, `src/components/TangoChatPanel.tsx`, `src/components/LiveVisionMonitor.tsx`, `desktop/build-runtime.ps1`, `desktop/odessa.nsi` |
| Estado | novo `server/api/v1/endpoints/prefs.py`, novo `server/core/secrets_store.py`, `server/config.py`, ~15 módulos em `src/core/*` que usam `localStorage` |
| Preflight | `src/core/liveReadinessSupervisor.ts`, `src/components/ValidationChecklist.tsx`, `src/components/UnifiedLivePanel.tsx` |
| Copiloto | novo `server/services/assistant/` (agent_loop, providers, tools, approvals, jobs, audit), novo `server/api/v1/endpoints/assistant.py`, `src/components/PersonaChatLab.tsx` (modo Persona), novo `src/components/copilot/*` |
| IA embutida | novo `server/services/local_llm/` (runtime, catálogo, download, import do Ollama, benchmark), `server/services/ai_service.py` (provedor "local"), `server/config.py`, `src/components/AiConfigPanel.tsx`, `desktop/build-runtime.ps1` + `desktop/stage.ps1` (empacotar o `llama-server`), `desktop/odessa.nsi` |

Evidências reproduzíveis:
- tempo de import: `python -X importtime -c "import server.main"`;
- teste do Edge e teste de tools no Ollama: scripts usados nesta análise, que
  podem virar testes em `tests/`.
