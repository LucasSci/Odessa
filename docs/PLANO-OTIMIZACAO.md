# Plano de otimização — servidor que não trava, telas leves e live com folga de CPU

Versão 1 · 2026-10-03 · baseado na branch `perf/inicio-e-estabilidade` (`a0dc6fb`)
e numa bateria de testes feita no PC da live (Ryzen 5 5500U, 15 GB, iGPU Vega,
Windows 11, Ollama em CPU com `qwen3:4b-instruct`).

> **Condição da medição:** o PC estava em uso durante a bateria (cliente do
> League, Discord, Edge com a aba do Tango; CPU em ~90%, 2,5 GB de RAM livre).
> Os tempos absolutos ficaram piores do que num PC livre; as **causas** são as
> mesmas e foram confirmadas com profiler, não deduzidas.

---

## 0. Resumo

| # | Problema (medido) | Causa raiz | Meta |
|---|---|---|---|
| 1 | Com chat entrando, o servidor ficou **bloqueado 96% do tempo** (1.670 s de 1.740 s); `/health` chegou a **109 s**; o palco e o overlay param junto | Cada mensagem do chat chama a **geração automática de vídeo**, que pede um "prompt" à IA local **de forma síncrona dentro do event loop** | Nenhuma pausa > 250 ms com chat a 1 msg/4 s |
| 2 | Em 40 min, **68 chamadas de IA só para o "prompt de vídeo"** (tantas quanto o chat) e **28 trocas de modelo** no Ollama | O prompt de vídeo usa `qwen2.5:3b` (padrão do servidor) e o chat usa `qwen3:4b-instruct`: o Ollama descarrega um e carrega o outro (~3 GB) | 1 modelo, IA de fundo desligada por padrão |
| 3 | Servidor a **40–205% de CPU** com chat; 2 threads nativas a 100% por 20+ min | Cliente HTTP novo (com contexto SSL, que lê o repositório de certificados do Windows) **a cada pedido** — proxy da bridge, Ollama, checagem do Ollama | CPU do servidor < 15% com chat |
| 4 | Só **3 respostas da IA em 30 min** de chat simulado (810 mensagens) | Consequência de 1–3: a IA do chat disputa o Ollama com a IA de fundo e o servidor está travado | Resposta em < 10 s (CPU) / < 3 s (iGPU) |
| 5 | Três rotas devolvem **~450 KB** cada (`/video/config`, `/personas/active`, `/workflow/published`), até **3 s** no p95 | O fluxo vai **três vezes** na mesma resposta (atual + rascunho + publicado); cada leitura faz `deepcopy` de 480 KB | < 60 KB e < 50 ms |
| 6 | "Desligar" levou **81 s** e precisou matar a janela com chat ativo (3 s sem chat) | O servidor está preso numa geração de IA síncrona | < 5 s sempre |
| 7 | Páginas com **4–5 s de tarefas longas** (Conversar, Personas, Diagnóstico); DOM chega a **36 mil nós** | Todas as páginas visitadas ficam montadas; listas grandes sem virtualização | Nenhuma tarefa > 200 ms na troca de página |
| 8 | Estúdio IDLE baixa **5,5 MB** em 97 imagens ao abrir | Imagens em tamanho original como miniatura | < 600 KB |
| 9 | Overlay do OBS: memória de **68 → 207 MB em 30 min** | Pré-carrega os 129 clipes do fluxo (304 MB em disco) em memória | Teto fixo (LRU) de ~150 MB |
| 10 | OBS com **4% de quadros pulados** na última live | CPU disputada: x264 + IA local + Edge + Odessa | 0% de quadros pulados |

**A ordem importa:** os itens 1–4 são uma única cadeia. Resolvê-los (Onda 1)
deve acabar com o "trava depois de algumas horas" sozinho, porque a trava não é
um vazamento: é o servidor parado esperando a IA, cada vez mais vezes conforme
o chat cresce.

---

## 1. Bateria de testes executada

| Teste | Como | Resultado |
|---|---|---|
| Esteira de qualidade | `pnpm check`, `pnpm build && pnpm budget`, `pnpm test:e2e`, `pytest` | ver §2.6 |
| Abertura do programa | 3 ciclos abrir → medir → Desligar, pelo atalho de depuração | §2.1 |
| Latência da API | 30 chamadas por rota + 20 clientes simultâneos em `/video/state` | §2.2 |
| Navegação | Cada uma das 9 páginas, primeira visita e volta (CDP: pedidos, KB, long tasks, heap, nós) | §2.3 |
| Live simulada (30 min) | **Bridge falsa** na porta 7555 (chat com 40 espectadores, 1 msg/4 s, 12% presentes, vídeo da aba a 5 quadros/s) + **overlay do OBS** num Chromium separado + amostragem a cada 30 s + sonda de travamento (`/health` a cada 200 ms) | §2.4 |
| Profiler do servidor | `py-spy` (amostragem sem parar o processo) + origem nativa das threads (ctypes) | §2.5 |
| Profiler da janela | CPU profile de 20 s do renderer | §2.5 |

Os dados do PC foram copiados antes (`server/runtime`, 12,5 MB) e restaurados
depois: os espectadores falsos e os vídeos de teste não ficaram no Odessa. O modo
do chat voltou para "Assistido".

Scripts usados (no scratchpad da sessão; a Onda 6 propõe trazê-los para
`scripts/bench/`): `fake_bridge.py`, `bench.mjs` (nav/api/soak),
`overlay_runner.py`, `looplag.mjs`, `thread_watch.py`, `thread_origin.py`.

---

## 2. Resultados

### 2.1 Abertura e desligamento

| | Servidor no ar | Janela | Tela pronta | Desligar |
|---|---|---|---|---|
| PC livre (após `a0dc6fb`) | 8,9 s | 8,9 s | +0,6 s | **3 s** |
| PC em uso, ciclo 1 | 27,1 s | 28,0 s | 34,5 s | 16,9 s |
| PC em uso, ciclo 2 | 23,1 s | 23,7 s | 32,7 s | 15,9 s |
| PC em uso, ciclo 3 | 17,3 s | 17,5 s | 20,3 s | 11,4 s |
| Com chat ativo | — | — | — | **81 s + kill** |

Antes desta branch: 14–55 s para abrir e janela em branco às vezes.

### 2.2 API (30 chamadas, PC em uso, sem chat)

| Rota | Tamanho | p50 | p95 | máx |
|---|---|---|---|---|
| `/video/state` | 1 KB | 6 ms | 11 ms | 150 ms |
| `/video/config` | **449 KB** | 154 ms | 210 ms | 324 ms |
| `/personas/active` | **451 KB** | 535 ms | **2.983 ms** | 5.253 ms |
| `/workflow/published` | **461 KB** | 365 ms | 1.205 ms | 1.209 ms |
| `/health/deps` | 0,2 KB | **1.391 ms** | 9.319 ms | 15.015 ms |
| `/memory/context` | 0,4 KB | 21 ms | 97 ms | 4.619 ms |
| `/automation/ingest` (1 msg do chat) | 8 KB | **620 ms** | — | 2.634 ms |
| `/video/state` × 20 simultâneos | — | 196 ms | 388 ms | 523 ms (94 req/s) |

### 2.3 Navegação (primeira visita → volta)

| Página | Pronta | Estável | Pedidos / KB | Long tasks | Nós |
|---|---|---|---|---|---|
| Ao Vivo | 114 ms | 3,3 s | 10 / 73 | 0 | 3.063 |
| Biblioteca | 310 ms | 2,5 s | 29 / 71 | 181 ms | 9.795 |
| Estúdio IDLE | 936 ms | 6,9 s | 114 / **5.548** | 170 ms | 28.981 |
| Automações | 3,3 s | 5,7 s | 11 / 543 | 1,5 s | 34.063 |
| Conversar | 2,7 s | 8,2 s | 155 / 1.042 | **4,5 s** | 34.014 |
| Personas | 3,1 s | 5,9 s | 14 / **4.525** | **3,9 s** | 34.730 |
| Histórico | 1,0 s | 3,1 s | 9 / 1.396 | 1,3 s | 35.024 |
| Configurações | 1,8 s | 6,7 s | 25 / 3.180 | 0,8 s | 35.688 |
| Diagnóstico | **8,3 s** | 9,1 s | 20 / 1.763 | **5,0 s** | 35.898 |
| Volta a qualquer página | 0,2–1,6 s | 1–5 s | 0–11 | 0,4–4,4 s | ~36.400 |

Ao Vivo, depois da troca das miniaturas por JPEG: **1 pedido de vídeo** (era 174).

### 2.4 Live simulada (30 min, 810 mensagens, 109 presentes)

- **Sonda de travamento:** 271 respostas em 29 min (deveriam ser ~8.700);
  p50 441 ms, **p95 65 s, máx 109 s**; **1.670 s somados de servidor parado**.
- **IA:** 3 respostas enviadas em 30 min. Log: 68 chamadas `qwen2.5:3b` (prompt
  de vídeo) × 67 `qwen3:4b-instruct` (chat e memória), 28 trocas de modelo.
- **`/video/state`** na amostragem: 47 ms a 5,5 s (6 ms em repouso).
- **Janela do Odessa:** heap 17–38 MB, estável; nós ~7.500; sem vazamento.
  Renderer 182 → 312 MB, processo de GPU 258 → 616 MB.
- **Overlay do OBS (Chromium):** renderer 68 → 207 MB (pré-carga dos clipes).
- **Servidor:** 2.975 s de CPU em ~35 min (~1,4 núcleo sem parar).
- **Bug encontrado na simulação:** o chat chega à janela em rajadas (26 eventos
  em 20 s depois de 2 min parado), porque o servidor está bloqueado.
- **Otimização confirmada:** com a janela minimizada, o vídeo da aba do Tango
  fecha sozinho (0 quadros); reabre quando a janela volta.

### 2.5 Profilers

**Servidor (`py-spy`, 120 s com chat):** a thread principal (event loop) estava em
`automation.ingest_event → process_raw_text → _feed_video_gen →
video_gen_service.auto_generate → prompt_service._call_llm →
generate_ollama_text → httpx.Client.post` — **flagrada esperando o Ollama**.
Folhas mais quentes: `ssl.create_default_context` (116 amostras, criação de
cliente HTTP por pedido em `generate_ollama_text` e `proxy_tango_bridge`),
`jsonable_encoder`/`deepcopy` (config de 480 KB).

**Threads nativas a 100%:** duas threads do pool do Windows (`ntdll`), criadas
em 18:27 e 18:28, 1.300+ s de CPU cada. Num servidor novo sem chat: nenhuma.
Com chat: 40–205% de CPU espalhados. Suspeita principal: criação de contexto
SSL por pedido (CryptoAPI). Confirmar depois da Onda 1.

**Janela (CPU profile 20 s, com chat, minimizada):** 82% ocioso, 5,5% React,
**2,9% na biblioteca de ícones**, 1% código do Odessa. A janela não é o gargalo.

### 2.6 Esteira

| Etapa | Resultado |
|---|---|
| ESLint | 0 erros, 66 avisos |
| `tsc`, `arch-contract`, Knip | ok (Knip: 97 exports e 58 tipos sem uso, só aviso) |
| Vitest | 342 ok, 1 intermitente (`PersonaChatLab` › "envia com Enter…": falha com o PC carregado, passa sozinho 6/6). Na 1ª rodada, com a live simulada rodando, os *workers* nem subiram (timeout) |
| Build + orçamento | ok — entrada **134,8 / 140 KB** (no limite), JS total 396,7 / 460 KB |
| Playwright (e2e) | sem o Chromium do Playwright instalado não roda (`Executable doesn't exist`). Com `PW_CHROMIUM_PATH` no Chromium do instalador: **7 ok, 1 falha por tempo** ("navega por todas as páginas": 33 s com 4 workers > limite de 30 s; sozinho passa em 15 s) — reflexo das páginas lentas da §2.3 |
| pytest | 468 ok, 1 falha **intermitente** por rodada, sempre um teste diferente e que passa sozinho: `test_criar_personas_em_paralelo_nao_perde_nenhuma`, `test_generate_photo_background_saves_asset_and_updates_avatar`, `test_trocar_para_nuvem_desliga_a_ia_local` |

---

## 3. Plano em ondas

Cada item vira uma Issue (Melhoria/Correção) e um PR próprio, como manda
`docs/ENGINEERING-STANDARDS.md`. Esforço: P (≤ ½ dia), M (1–2 dias), G (3+ dias).

### Onda 1 — Destravar o servidor (prioridade máxima, ~3 dias)

Meta de saída: **live simulada de 30 min com nenhuma pausa > 250 ms**, IA
respondendo ≥ 1 vez por minuto e "Desligar" < 5 s com chat ativo.

| # | Ação | Onde | Esforço |
|---|---|---|---|
| 1.1 | **Geração automática de vídeo desligada por padrão** (`VIDEO_GEN_AUTO=false`); quando ligada, roda numa fila em segundo plano, nunca dentro do pedido do chat, com cooldown de 5 min e só com o chat parado | `server/config.py`, `video_gen_service.py`, `automation_service._feed_video_gen` | P |
| 1.2 | **Nenhuma IA no event loop.** Rotas `async def` que chamam IA síncrona passam a `def` (threadpool) ou `await asyncio.to_thread(...)`: `automation/ingest` (via video_gen), `conversations/{id}/reply`, `video_gen/*`, `tts` | endpoints citados | M |
| 1.3 | **Teste de arquitetura** que falha se uma função `async def` chamar `generate_*`, `httpx.Client`, `requests.` ou `time.sleep` sem `to_thread` (o mesmo scan usado na bateria) | `server/tests/test_no_blocking_in_async.py` | P |
| 1.4 | **Clientes HTTP compartilhados**: um `httpx.Client` para o Ollama, um `httpx.AsyncClient` para o proxy da bridge e para `_check_ollama` (sem SSL para `http://127.0.0.1`); fechar no shutdown | `ai_service.py`, `main.py`, `endpoints/ai.py` | P |
| 1.5 | **Cache de 10 s do status do Ollama** (`/api/tags` era chamado a cada ~2 s) | `endpoints/ai.py` | P |
| 1.6 | **Um modelo só**: tudo que usa a IA local (prompt de vídeo, memória) usa o modelo escolhido na tela de IA, não o padrão do servidor | `ai_service`, `prompt_service`, `memory_learning` | P |
| 1.7 | **Fila única de IA com prioridade** (chat > memória > fundo), uma geração por vez, descartando pedidos de chat mais velhos que 30 s | novo `server/services/ai_queue.py` | M |
| 1.8 | Validar: repetir a live simulada; confirmar que as threads nativas a 100% sumiram | bateria | P |

### Onda 2 — Dados e API enxutos (~4 dias)

| # | Ação | Ganho esperado | Esforço |
|---|---|---|---|
| 2.1 | `/workflow/published` devolve **só o publicado**; `/video/config` e `/personas/active` sem `draftWorkflow`/`publishedWorkflow` duplicados (pedir à parte quando a tela precisar) | 450 KB → ~50–140 KB | M |
| 2.2 | **ETag/304** nessas rotas e versão do fluxo em `/video/state` (o overlay só busca o fluxo quando a versão muda, em vez de a cada 2 min) | menos rede e JSON | P |
| 2.3 | Config em memória **sem `deepcopy` a cada leitura** (dados imutáveis + cópia só onde se altera) | ms por pedido | M |
| 2.4 | Separar `persona_viktoria.json` (703 KB): fluxo publicado, rascunho e vídeos em arquivos próprios; gravar só o que mudou | gravações 10× menores | M |
| 2.5 | `/automation/ingest` < 50 ms: histórico da sessão gravado em lote (buffer de 1 s), nada pesado no caminho do chat | 620 ms → < 50 ms | P |
| 2.6 | SQLite em **WAL** (`journal_mode=delete` hoje) | escrita sem bloquear leitura | P |
| 2.7 | **Push em vez de polling** para o estado do palco: um SSE `/video/events` para overlay e telas (hoje overlay 2/s + tela 1/s + fluxo 1/s) | −90% de pedidos | G |

### Onda 3 — Telas leves (~1 semana)

| # | Ação | Ganho esperado | Esforço |
|---|---|---|---|
| 3.1 | Estúdio IDLE: **miniaturas redimensionadas** no servidor (240 px, cache), original só ao abrir/baixar | 5,5 MB → ~400 KB | P |
| 3.2 | Personas: mesmo tratamento das imagens (4,5 MB ao abrir) | idem | P |
| 3.3 | **Descarregar páginas** não visitadas há 10 min (hoje todas ficam montadas: 36 mil nós) mantendo o estado que importa | memória e GC | M |
| 3.4 | **Virtualizar listas grandes**: deck (166 clipes), Biblioteca, nós do fluxo (137), chat (até 400 mensagens) | tarefas longas | M |
| 3.5 | Perfilar e cortar as tarefas longas de Conversar (4,5 s), Personas (3,9 s), Diagnóstico (5,0 s), Histórico (4,4 s) — memoização e trabalho fora da renderização | < 200 ms | M |
| 3.6 | Ícones: componentes estáticos memoizados (2,9% da CPU da janela) | CPU | P |
| 3.7 | Overlay: **pré-carga com teto** (LRU por tamanho, ~150 MB; idle e próximos do fluxo primeiro) | 207 MB → ≤ 150 MB fixo | M |
| 3.8 | Chunk de entrada no limite (134,8/140 KB): mover para lazy o que não é da primeira tela | folga no orçamento | P |

### Onda 4 — IA local mais rápida (alinha com a Frente D do `PLANO-USABILIDADE.md`)

| # | Ação | Ganho esperado | Esforço |
|---|---|---|---|
| 4.1 | Motor llama.cpp **embutido com a iGPU (Vulkan)**: já validado em 1,6–2,7 s por resposta com o 3B, contra 20–30 s em CPU | resposta 10× mais rápida e **CPU livre para o OBS** | G |
| 4.2 | Enquanto isso, no Ollama: `num_thread` 4 (já), `keep_alive` só durante a live, contexto menor (`num_ctx` 2048) e resposta curta (`num_predict`) | menos CPU/RAM | P |

### Onda 5 — Folga de CPU na live (configuração, sem código pesado)

| # | Ação | Ganho esperado | Esforço |
|---|---|---|---|
| 5.1 | Testar o **encoder de hardware da AMD (AMF H.264)** da iGPU no perfil do Tango no lugar do x264 (o modelo do perfil fica com uma variante AMF) | maior alívio de CPU da live; acaba com quadros pulados | P |
| 5.2 | Medir a live real com a extensão 1.6.1 (screencast limitado a 5 quadros/s) e o painel fechando o vídeo quando ninguém olha | Edge da live: de 5,5 h de CPU para uma fração | P |
| 5.3 | Checklist de live: fechar abas/jogos pesados; o Diagnóstico mostra CPU/RAM livres e avisa | operação | P |

### Onda 6 — Garantias contínuas (para não regredir)

| # | Ação | Esforço |
|---|---|---|
| 6.1 | Trazer a bateria para o repositório: `scripts/bench/` (bridge falsa, live simulada, sonda de travamento, navegação, API) com `pnpm bench:live` gerando um relatório JSON | M |
| 6.2 | Teste de integração: com um Ollama falso **lento** (2 s), `/health` responde em < 100 ms enquanto 5 mensagens passam por `/automation/ingest` | P |
| 6.3 | E2E rodando nesta máquina: `npx playwright install chromium` no setup, ou `PW_CHROMIUM_PATH` apontando para o Chromium já embutido no instalador | P |
| 6.4 | Corrigir os 3 testes Python intermitentes (concorrência/tempo); Vitest com `poolOptions` e timeout de worker maiores no Windows | M |
| 6.5 | Orçamentos novos na esteira: tamanho máximo das rotas de config (100 KB) e do JSON da persona; tempo de abertura medido no CI do desktop | P |

---

## 4. Ordem recomendada e impacto

| Ordem | Pacote | Por quê |
|---|---|---|
| 1 | **1.1 + 1.4 + 1.5 + 1.6** (um PR, ~1 dia) | Remove a maior parte da trava com risco baixo: desliga a IA de fundo, para de recriar clientes e de trocar de modelo |
| 2 | 1.2 + 1.3 + 1.7 + 1.8 | Garante que nenhuma IA volte a travar o servidor e mede de novo |
| 3 | 5.1 + 5.2 | Ganho grande na live só com configuração |
| 4 | Onda 2 | API e dados enxutos; prepara o push da 2.7 |
| 5 | Onda 3 | Telas fluidas |
| 6 | Onda 4 | IA rápida e CPU livre (maior esforço) |
| contínuo | Onda 6 | Cada onda entra com o teste que impede a regressão |

## 5. Riscos

- **Desligar a geração automática de vídeo** muda um comportamento padrão: quem
  usava passa a ligar em Configurações. Hoje o provedor é `placeholder` (vídeos
  falsos), então na prática ninguém perde nada.
- **Fila de IA** pode descartar respostas atrasadas de propósito; o motivo fica
  registrado no histórico da sessão, como os demais bloqueios do governador.
- **AMF**: qualidade um pouco menor que o x264 no mesmo bitrate; testar com o
  bitrate do Tango antes de trocar de vez (o perfil x264 continua no repositório).
- **Descarregar páginas** pode perder estado não salvo; fazer só em páginas sem
  formulário aberto.
