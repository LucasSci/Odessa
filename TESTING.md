# 📚 Guia de Testes - Odessa

**Versão:** 1.0 | **Data:** 03 de Maio de 2026 | **Status:** Fase 1 Concluída

---

## Visão Geral

Este documento descreve como executar, escrever e manter testes na Odessa. Covers both frontend (Vitest) and backend (Pytest) testing strategies.

---

## 🚀 Quick Start

### Backend (Python)

```bash
# Instalar dependências
pip install -r server/requirements.txt

# Rodar todos os testes
venv\Scripts\python.exe -m pytest tests/ -v

# Rodar apenas testes de unidade
venv\Scripts\python.exe -m pytest tests/ -m unit -v

# Gerar coverage report
venv\Scripts\python.exe -m pytest tests/ --cov=server --cov-report=html

# Rodar teste específico
venv\Scripts\python.exe -m pytest tests/test_health.py -v
```

### Frontend (TypeScript)

```bash
# Instalar dependências
npm install

# Rodar testes
npm run test

# Modo watch (desenvolvimento)
npm run test:watch

# Gerar coverage report
npm run test:coverage
```

---

## 📊 Estrutura de Testes

### Backend (`tests/`)

```
tests/
├── conftest.py           # Fixtures globais
├── test_health.py        # Testes do endpoint /health
├── test_ocr.py          # Testes do endpoint /ocr
├── test_ai.py           # Testes dos endpoints /ai/*
├── test_tts.py          # Testes dos endpoints /tts/*
└── test_n8n.py          # (Futuro) Testes da integração n8n
```

### Frontend (`src/**/*.test.ts`)

```
src/
├── core/
│   ├── eventClassifier.test.ts    # Testes de classificação de eventos
│   ├── personaRuntime.test.ts     # Testes de execução da persona
│   └── actionExecutor.test.ts     # Testes de despacho de ações
└── lib/
    └── ...
```

---

## ✍️ Escrevendo Testes

### Convenções de Naming

**Backend (Pytest):**

- Arquivo: `test_<feature>.py`
- Função: `test_<specific_behavior>`
- Classe: `Test<Feature>`

```python
# ✅ Correto
def test_health_endpoint_returns_200():
    pass

def test_ocr_with_invalid_image_returns_400():
    pass

# ❌ Incorreto
def healthCheck():
    pass

def test_ocr():  # Muito genérico
    pass
```

**Frontend (Vitest):**

- Arquivo: `<file>.test.ts`
- Suite: `describe('<Component>', () => {})`
- Teste: `it('should <behavior>', () => {})`

```typescript
// ✅ Correto
describe('eventClassifier', () => {
  it('should classify chat events correctly', () => {
    expect(result).toBe(expected);
  });
});

// ❌ Incorreto
describe('Tests', () => {
  it('works', () => {});
});
```

---

## 🎯 Testes Unitários

### Backend - Exemplo Completo

```python
# tests/test_ocr.py
import pytest

@pytest.mark.unit
def test_ocr_endpoint_with_valid_image(client, sample_image_base64):
    """Test OCR endpoint with valid base64 image."""
    response = client.post(
        "/ocr",
        json={
            "image": sample_image_base64,
            "zone_id": "zone-test",
            "zone_name": "Test Zone",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "text" in data or "full_text" in data
```

**Padrão 3-A (Arrange-Act-Assert):**

1. **Arrange:** Preparar dados de entrada
2. **Act:** Executar a função/endpoint
3. **Assert:** Validar o resultado

### Frontend - Exemplo Completo

```typescript
// src/core/eventClassifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyEvent } from './eventClassifier';

describe('eventClassifier', () => {
  it('should classify chat events', () => {
    // Arrange
    const event = {
      id: 'test-1',
      text: 'Hello there!',
      kind: 'chat',
      // ...
    };

    // Act
    const classified = classifyEvent(event);

    // Assert
    expect(classified.kind).toBe('chat');
  });
});
```

---

## 🔧 Mocking

### Backend - Mock de Chamadas HTTP

```python
from unittest.mock import patch

@patch('server.main.gemini_client.models.generate_content')
def test_ai_respond(mock_gemini, client):
    # Setup
    mock_gemini.return_value.text = "Resposta da IA"

    # Act
    response = client.post("/ai/respond", json={"prompt": "Teste"})

    # Assert
    assert response.status_code == 200
```

### Frontend - Mock de Fetch

```typescript
import { vi } from 'vitest';

const mockResponse = {
  ok: true,
  json: async () => ({ response: 'Hello' }),
};
global.fetch = vi.fn().mockResolvedValueOnce(mockResponse);

// Seu teste aqui
expect(global.fetch).toHaveBeenCalled();
```

---

## 📈 Coverage

### Targets de Cobertura

| Tipo           | Target | Crítico |
| -------------- | ------ | ------- |
| **Linhas**     | 80%    | Sim     |
| **Funções**    | 80%    | Sim     |
| **Branches**   | 75%    | Não     |
| **Statements** | 80%    | Sim     |

### Gerar Reports

**Backend HTML:**

```bash
venv\Scripts\python.exe -m pytest tests/ --cov=server --cov-report=html
# Abre em htmlcov/index.html
```

**Frontend HTML:**

```bash
npm run test:coverage
# Abre em coverage/index.html
```

### Ignorar Cobertura

Se for necessário, marque código como não-testável:

**Python:**

```python
# pragma: no cover
def function_not_testable():
    pass
```

**TypeScript:**

```typescript
// v8 ignore
export function unreachable() {
  return never;
}
```

---

## 🏷️ Marcadores (Markers)

### Pytest Markers

```bash
# Rodar apenas testes de unidade
pytest -m unit

# Rodar apenas testes de integração
pytest -m integration

# Rodar testes lentos
pytest -m slow

# Rodar tudo MENOS testes lentos
pytest -m "not slow"
```

**Registrar novo marker em `pytest.ini`:**

```ini
markers =
    unit: marks tests as unit tests
    integration: marks tests as integration tests
    slow: marks tests as slow
```

---

## 🐛 Debugging de Testes

### Backend

```bash
# Verbose output
pytest -vv

# Com prints
pytest -s

# Parar no primeiro erro
pytest -x

# Parar e entrar no debugger
pytest --pdb

# Mostrar locais (variáveis)
pytest -l

# Últimos 10 testes falhados
pytest --lf

# Falhos + passou
pytest --ff
```

### Frontend

```bash
# Modo watch
npm run test:watch

# Debug no browser
npm run test:watch -- --browser=chrome

# Single run
npm run test
```

---

## 📋 Checklist para PRs

Antes de commitar testes:

- [ ] Teste nominalizado corretamente
- [ ] Segue padrão 3-A (Arrange-Act-Assert)
- [ ] Mocks configurados corretamente
- [ ] Coverage ≥ 80% para linhas críticas
- [ ] `npm run lint` passa
- [ ] `npm run test` passa
- [ ] `pytest` passa
- [ ] Sem console.logs ou debug statements
- [ ] Sem `.only` ou `.skip` deixado acidentalmente

---

## 🔄 Integração Contínua

Todos os testes devem passar antes de merge:

```bash
# Validação completa
npm run lint
npm run format
venv\Scripts\python.exe -m pytest tests/ -v
npm run test
```

---

## 📚 Recursos

### Documentação Oficial

- **Vitest:** https://vitest.dev/
- **Pytest:** https://docs.pytest.org/
- **Testing Library:** https://testing-library.com/

### Best Practices

- Keep tests DRY - use fixtures and helpers
- Test behavior, not implementation
- Use descriptive names
- Keep tests fast - mock external dependencies
- One assertion per test (idealmente)

---

## ❓ FAQ

**P: Como testar código assíncrono?**

Backend:

```python
@pytest.mark.asyncio
async def test_async_function():
    result = await async_function()
    assert result == expected
```

Frontend:

```typescript
it('should handle async', async () => {
  const result = await asyncFunction();
  expect(result).toBe(expected);
});
```

**P: Como usar fixtures?**

Backend (pytest):

```python
@pytest.fixture
def sample_data():
    return {"name": "test"}

def test_with_fixture(sample_data):
    assert sample_data["name"] == "test"
```

Frontend (vitest):

```typescript
const setup = () => ({ value: 42 });

it('uses setup', () => {
  const { value } = setup();
  expect(value).toBe(42);
});
```

---

**Última atualização:** 03 de Maio de 2026  
**Mantido por:** GitHub Copilot - Odessa Dev
