# 📋 Fase 1: Fundação de Qualidade - Checklist Detalhado

**Objetivo:** Estabelecer padrões de código, testes unitários e automação de qualidade.

**Estimado:** 5-7 dias | **Prioridade:** 🔴 ALTA (Bloqueador para produção)

---

## 🔧 Parte 1: Lints & Formatters (1 dia)

### 1.1 - Frontend: ESLint + Prettier

**Objective:** Garantir código limpo e padronizado

#### Status Atual

- ✅ ESLint instalado em devDependencies
- ✅ Prettier instalado em devDependencies
- ✅ `eslint.config.js` existe (configurado)
- ✅ Scripts `npm run lint` e `npm run format` existem
- ⚠️ **Ação:** Executar e corrigir todos os erros

#### Subtarefas:

- [ ] **1.1.1** - Rodar `npm run lint` e documentar erros encontrados
- [ ] **1.1.2** - Rodar `npm run lint:fix` para corrigir automaticamente
- [ ] **1.1.3** - Revisar mudanças (git diff) e aprovar
- [ ] **1.1.4** - Rodar `npm run format` para padronizar formatação final
- [ ] **1.1.5** - Confirmar que `npm run lint` passa sem erros
- [ ] **1.1.6** - Adicionar pre-commit hook (opcional, mas recomendado)

#### Comandos

```bash
npm run lint                    # Verificar
npm run lint:fix              # Corrigir
npm run format                # Formatar
```

---

### 1.2 - Backend: Ruff

**Objective:** Garantir código Python limpo

#### Status Atual

- ✅ `ruff.toml` existe (configurado)
- ⚠️ Ruff não está instalado explicitamente no `requirements.txt`
- ⚠️ **Ação:** Instalar Ruff e rodar verificações

#### Subtarefas:

- [ ] **1.2.1** - Instalar `ruff` globalmente ou no venv
- [ ] **1.2.2** - Rodar `ruff check server/` e documentar erros
- [ ] **1.2.3** - Rodar `ruff check server/ --fix` para corrigir
- [ ] **1.2.4** - Revisar mudanças (git diff) e aprovar
- [ ] **1.2.5** - Confirmar que `ruff check` passa sem warnings

#### Comandos

```bash
pip install ruff                # Instalar
ruff check server/              # Verificar
ruff check server/ --fix        # Corrigir
```

---

## 🧪 Parte 2: Testes Frontend (Vitest) (2-3 dias)

### 2.1 - Configurar Vitest

**Objective:** Framework de testes para React/TypeScript

#### Status Atual

- ✅ Vitest em devDependencies (v4.1.5)
- ✅ `@testing-library/react` em devDependencies
- ⚠️ `vitest.config.ts` provavelmente não existe
- ⚠️ `npm run test` provavelmente não está configurado

#### Subtarefas:

- [ ] **2.1.1** - Criar `vitest.config.ts` na raiz do projeto
- [ ] **2.1.2** - Configurar path aliases (`@/` → `src/`)
- [ ] **2.1.3** - Adicionar `npm run test` script no package.json
- [ ] **2.1.4** - Adicionar `npm run test:watch` script (desenvolvimento)
- [ ] **2.1.5** - Adicionar `npm run test:coverage` script

#### Configuração Vitest

```typescript
// vitest.config.ts
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

#### Package.json updates

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  }
}
```

---

### 2.2 - Testes para `src/core/eventClassifier.ts`

**Objective:** Validar classificação de eventos

#### O que testar:

- Classificação correta de tipo de evento (chat, gift, alert, etc)
- Extração de metadata
- Edge cases (mensagens vazias, formatos inválidos)

#### Subtarefas:

- [ ] **2.2.1** - Criar `src/core/eventClassifier.test.ts`
- [ ] **2.2.2** - Escrever 5+ testes de casos normais
- [ ] **2.2.3** - Escrever 3+ testes de edge cases
- [ ] **2.2.4** - Atingir coverage ≥ 80% do arquivo
- [ ] **2.2.5** - Rodar e validar

---

### 2.3 - Testes para `src/core/personaRuntime.ts`

**Objective:** Validar execução da persona

#### O que testar:

- Inicialização da persona
- Geração de resposta (mock de fetch)
- Aplicação de controles (energy, warmth, etc)
- Tratamento de erros da API

#### Subtarefas:

- [ ] **2.3.1** - Criar `src/core/personaRuntime.test.ts`
- [ ] **2.3.2** - Mock da fetch API com vitest
- [ ] **2.3.3** - Escrever testes de resposta bem-sucedida
- [ ] **2.3.4** - Escrever testes de erro (fallback, retry)
- [ ] **2.3.5** - Atingir coverage ≥ 80%

---

### 2.4 - Testes para `src/core/actionExecutor.ts`

**Objective:** Validar despacho de ações

#### O que testar:

- Execução de ação 'speak'
- Execução de ação 'chat_reply'
- Execução de ação 'ack_gift'
- Status de erro e simulação
- Tratamento de ações desconhecidas

#### Subtarefas:

- [ ] **2.4.1** - Criar `src/core/actionExecutor.test.ts`
- [ ] **2.4.2** - Escrever testes para cada tipo de ação
- [ ] **2.4.3** - Testar transição de status (pending → completed → error)
- [ ] **2.4.4** - Atingir coverage ≥ 80%

---

### 2.5 - Configurar Coverage

**Objective:** Medir e relatar cobertura de testes

#### Subtarefas:

- [ ] **2.5.1** - Instalar `@vitest/coverage-v8` (ou provider de escolha)
- [ ] **2.5.2** - Configurar threshold mínimo (80%)
- [ ] **2.5.3** - Gerar relatório de coverage
- [ ] **2.5.4** - Documentar em README.md

---

## 🐍 Parte 3: Testes Backend (Pytest) (2-3 dias)

### 3.1 - Configurar Pytest

**Objective:** Framework de testes para Python

#### Status Atual

- ❌ Pytest não está em `server/requirements.txt`
- ❌ `pytest.ini` existe mas pode estar vazio

#### Subtarefas:

- [ ] **3.1.1** - Adicionar ao `server/requirements.txt`:
  ```
  pytest>=7.4.0
  pytest-asyncio>=0.21.0
  httpx>=0.24.0
  ```
- [ ] **3.1.2** - Instalar `pip install -r server/requirements.txt`
- [ ] **3.1.3** - Criar/atualizar `pytest.ini`
- [ ] **3.1.4** - Criar estrutura `tests/` com `__init__.py`
- [ ] **3.1.5** - Configurar `tests/conftest.py` (fixtures globais)

#### pytest.ini

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
asyncio_mode = auto
```

#### conftest.py

```python
import pytest
from fastapi.testclient import TestClient
from server.main import app

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def sample_image():
    # Imagem base64 de teste
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
```

---

### 3.2 - Testes para `/health`

**Objective:** Validar health check

#### Subtarefas:

- [ ] **3.2.1** - Criar `tests/test_health.py`
- [ ] **3.2.2** - Testar resposta bem-sucedida (200 OK)
- [ ] **3.2.3** - Validar estructura da resposta (status, ocr, gemini_configured, etc)
- [ ] **3.2.4** - Testar timeout/indisponibilidade de serviços (mock)

#### Teste Exemplo

```python
def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert data["status"] in ["ok", "degraded"]
```

---

### 3.3 - Testes para `/ocr`

**Objective:** Validar endpoint de OCR

#### Subtarefas:

- [ ] **3.3.1** - Criar `tests/test_ocr.py`
- [ ] **3.3.2** - Testar com imagem válida (base64)
- [ ] **3.3.3** - Testar com imagem inválida
- [ ] **3.3.4** - Testar validação de zona_id
- [ ] **3.3.5** - Testar timeout

#### Teste Exemplo

```python
def test_ocr_valid_image(client, sample_image):
    response = client.post("/ocr", json={
        "image": sample_image,
        "zone_id": "zone-chat",
        "zone_name": "Chat"
    })
    assert response.status_code == 200
    data = response.json()
    assert "text" in data
```

---

### 3.4 - Testes para `/ai/respond`

**Objective:** Validar resposta simples da persona

#### Status Atual

- ⚠️ Requer `GEMINI_API_KEY` ou `OPENAI_API_KEY` (mockar)

#### Subtarefas:

- [ ] **3.4.1** - Criar `tests/test_ai.py`
- [ ] **3.4.2** - Mock das chamadas a Gemini/OpenAI
- [ ] **3.4.3** - Testar resposta bem-sucedida
- [ ] **3.4.4** - Testar fallback (Gemini → OpenAI)
- [ ] **3.4.5** - Testar tratamento de erro (ambos falham)

#### Mock Exemplo

```python
from unittest.mock import patch

@patch('server.main.gemini_client.models.generate_content')
def test_ai_respond(mock_gemini, client):
    mock_gemini.return_value.text = "Resposta da IA"
    response = client.post("/ai/respond", json={
        "prompt": "Teste"
    })
    assert response.status_code == 200
    assert "response" in response.json()
```

---

### 3.5 - Testes para `/ai/decide`

**Objective:** Validar decisão estruturada do Autopilot

#### Subtarefas:

- [ ] **3.5.1** - Criar testes para `/ai/decide`
- [ ] **3.5.2** - Validar estrutura: `actions`, `speech`, `confidence`
- [ ] **3.5.3** - Testar ações válidas (speak, chat_reply, etc)
- [ ] **3.5.4** - Testar rejeição de ações inválidas
- [ ] **3.5.5** - Mock de múltiplos eventos

---

### 3.6 - Testes para `/tts`

**Objective:** Validar síntese de voz

#### Subtarefas:

- [ ] **3.6.1** - Criar `tests/test_tts.py`
- [ ] **3.6.2** - Testar com Edge TTS (grátis)
- [ ] **3.6.3** - Testar com Kokoro (se disponível)
- [ ] **3.6.4** - Testar resposta em áudio (arquivo)
- [ ] **3.6.5** - Testar validação de voz desconhecida

---

### 3.7 - Configurar Coverage Backend

**Objective:** Medir cobertura de testes

#### Subtarefas:

- [ ] **3.7.1** - Instalar `pytest-cov`
- [ ] **3.7.2** - Rodar `pytest --cov=server tests/`
- [ ] **3.7.3** - Documentar Coverage target ≥ 80%

#### Comando

```bash
pytest --cov=server --cov-report=html tests/
```

---

## ✅ Validação Final da Fase 1

### Checklist de Conclusão

- [ ] `npm run lint` passa sem erros
- [ ] `npm run format` não faz mudanças (código já formatado)
- [ ] `ruff check server/` passa sem warnings
- [ ] `npm run test` executa e passa todos os testes
- [ ] `npm run test:coverage` mostra ≥ 80% coverage frontend
- [ ] `pytest --cov=server` mostra ≥ 80% coverage backend
- [ ] Nenhum arquivo `.todo` ou `.fixme` comentado
- [ ] README.md atualizado com instruções de testes

---

## 📝 Documentação a Criar

### README.md - Seção de Testes

```markdown
## Testes

### Frontend

- `npm run test` - Executar testes
- `npm run test:watch` - Modo desenvolvimento (reexecuta ao salvar)
- `npm run test:coverage` - Gerar relatório de coverage

### Backend

- `pytest` - Executar todos os testes
- `pytest -v` - Verbose (mostra cada teste)
- `pytest --cov=server` - Com coverage
- `pytest tests/test_health.py` - Teste específico
```

### TESTING.md - Guia de Testes

- Como escrever testes
- Padrões de naming
- Mocking strategy
- Coverage expectations

---

## 🚀 Execução Recomendada

### Dia 1: Lints (1-2 horas)

1. Rodar `npm run lint` e documentar
2. Corrigir com `npm run lint:fix`
3. Rodar `ruff` e corrigir

### Dia 2-3: Vitest + Testes Frontend (8-12 horas)

1. Configurar Vitest
2. Criar 3 test files (eventClassifier, personaRuntime, actionExecutor)
3. Atingir 80% coverage

### Dia 4-5: Pytest + Testes Backend (8-12 horas)

1. Instalar Pytest
2. Criar 4 test files (health, ocr, ai, tts)
3. Atingir 80% coverage

### Dia 6: Review + Documentação (4-6 horas)

1. Code review dos testes
2. Atualizar README
3. Criar TESTING.md

---

**Total Estimado:** 5-7 dias com dedicação full-time  
**Total Estimado:** 1-2 semanas com dedicação part-time

Próximos passos após Fase 1 concluída:
→ Fase 2: Refatoração Backend (Desmembramento de main.py)
