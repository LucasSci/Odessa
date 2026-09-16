# Documentação do Projeto Odessa

Sistema de persona virtual para lives (TikTok/Tango Live): um player inteligente
de vídeo que reage a presentes, comentários e agendamentos em tempo real,
controlado por um editor visual de fluxo (ReactiveFlow) e exibido como Browser
Source no OBS.

## Índice

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Arquitetura do sistema, os runtimes, fluxo de dados e decisões |
| [SETUP.md](SETUP.md) | Setup e execução em desenvolvimento local |
| [../desktop/README.md](../desktop/README.md) | Instalador desktop Windows — como gerar, assinar e distribuir |
| [DEPLOY.md](DEPLOY.md) | Build e deploy na Hostinger — **legado, não usado atualmente** |
| [API.md](API.md) | Referência dos endpoints da API (Python + Node) |
| [OBS-TANGO.md](OBS-TANGO.md) | Configuração do OBS e da bridge do Tango |
| [PERSONAS.md](PERSONAS.md) | Perfis de persona e conversa automática com IA |
| [VIDEO-GEN.md](VIDEO-GEN.md) | Geração de vídeo em tempo real a partir do chat |
| [SESSION-HISTORY.md](SESSION-HISTORY.md) | Histórico exportável da live (mensagens, presentes, vídeos, respostas) |
| [TESTING.md](TESTING.md) | Como rodar os testes (frontend + backend) |
| [CHANGELOG.md](CHANGELOG.md) | Histórico de mudanças e versões |

## Início rápido

```powershell
# 1. Setup (instala dependências, cria venv e .env)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-local.ps1

# 2. Rodar (backend FastAPI + frontend Vite)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-odessa.ps1
```

Acesse o painel em `http://localhost:3000`.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + Tailwind CSS 4 + TypeScript |
| Backend (dev/desktop) | Python FastAPI / uvicorn |
| Backend (produção web, legado) | Node.js (`hostinger-server.mjs` + `api/`) — Hostinger não está mais em uso |
| Bridge do Tango | Python aiohttp (porta 7555) + Playwright/CDP |
| IA generativa | Ollama (local) / RouteLLM da Abacus.AI / Gemini / OpenAI |
| Persistência | KV em disco (`~/odessa-data/`) + SQLite (`server/runtime/`) |
| Distribuição | Instalador desktop Windows (`desktop/`) |
