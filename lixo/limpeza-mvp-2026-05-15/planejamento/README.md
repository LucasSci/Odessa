# 🌌 Odessa: Sua Persona de IA para Lives

[![Odessa CI](https://github.com/LucasSci/Odessa/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasSci/Odessa/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python-green)](https://fastapi.tiangolo.com/)

Odessa é um ecossistema de **Persona AI Orchestration** projetado especificamente para streamers. Através de OCR em tempo real e uma engine de comportamento inteligente, a Odessa entende o que acontece na sua live e reage instantaneamente através de uma persona virtual sincronizada.

---

## ✨ Principais Funcionalidades

- 🧠 **Persona Behavioral Engine**: Sistema de 16 estados comportamentais com transições suaves e inteligentes.
- 👁️ **Real-time OCR**: Captura e interpretação de eventos da live (mensagens, presentes, metas) via leitura de tela.
- 🔄 **Precision Sync**: Sincronização de milissegundos entre o Dashboard de controle e o Overlay do OBS.
- ⚡ **Background Persistence**: Processamento imortal via Web Workers que mantém a persona ativa mesmo com a aba em segundo plano.
- 🛠️ **Modo Captura Profissional**: Interface limpa e otimizada para captura de janela no OBS Studio.
- 🔗 **Extensibilidade**: Pronta para integração com n8n, OpenAI, Groq e ElevenLabs.

---

## 🚀 Quickstart (Desenvolvedor)

### 1. Requisitos

- Python 3.10+
- Node.js 18+

### 2. Instalação

```bash
# Clone o repositório
git clone https://github.com/LucasSci/Odessa.git
cd Odessa

# Setup do Backend
pip install -r server/requirements.txt
python server/main.py

# Setup do Frontend (em outro terminal)
npm install
npm run dev
```

### 3. Acesso

- **Dashboard**: `http://localhost:5173`
- **Modo Captura**: Ative o ícone de raio no topo do Dashboard para limpar a tela para o OBS.

---

## 🏗️ Arquitetura

O projeto é dividido em dois núcleos principais:

1.  **Odessa Server (Python/FastAPI)**: Gerencia o OCR, a lógica de decisão da IA e o streaming de vídeo.
2.  **Odessa Studio (React/TS)**: Interface de alta performance para monitoramento e visualização da persona.

---

## ✅ Testes & Qualidade

Odessa possui uma suíte de testes rigorosa com meta de **85%+ de cobertura**.

- **Backend**: `python -m pytest tests/`
- **Frontend**: `npm run test`

---

## 🤝 Contribuição

Contribuições são o que fazem a comunidade open source um lugar incrível para aprender, inspirar e criar.

1. Faça um Fork do projeto
2. Crie sua Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Faça o Commit de suas alterações (`git commit -m 'Add some AmazingFeature'`)
4. Faça o Push para a Branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

---

_Odessa: Sua persona de IA que realmente entende sua live._
