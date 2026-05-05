# 🚀 Guia de Configuração - PersonaStudio

## ✅ Pré-requisitos

- Node.js 18+
- Python 3.9+
- FFmpeg (para processamento de vídeos)
- Windows 10/11 (para PIL.ImageGrab)

---

## 📦 Instalação

### 1. Backend

```bash
cd server

# Instalar dependências Python
pip install -r requirements.txt

# Verificar se PIL (Pillow) está instalada
pip list | grep Pillow
# Se não estiver, instalar:
# pip install Pillow
```

### 2. Frontend

```bash
# Atualizar dependências (se necessário)
npm install

# Verificar se tudo está ok
npm run lint
```

---

## 🎬 Preparar Vídeos

### Passo 1: Organizar arquivos

Coloque seus vídeos em uma dessas pastas (em ordem de preferência):

1. **OneDrive (recomendado)**
   ```
   C:\Users\{SeuUsuário}\OneDrive\Videos\Captures\
   ```

2. **Videos local**
   ```
   C:\Users\{SeuUsuário}\Videos\Odessa\
   ```

3. **Downloads**
   ```
   C:\Users\{SeuUsuário}\Downloads\Videos\
   ```

### Passo 2: Nomear corretamente

Renomeie todos os vídeos seguindo este padrão:
```
video_01.mp4
video_02.mp4
video_03.mp4
...
video_16.mp4
```

**Script auxiliar (PowerShell):**
```powershell
# Já existe em: scripts/organize_videos.ps1
# Para executar:
.\scripts\organize_videos.ps1
```

### Passo 3: Validar

```bash
# No terminal, testar se API encontra vídeos
curl http://localhost:8000/api/video/available

# Deve retornar:
# {
#   "videos": [
#     {"id": "01", "filename": "video_01.mp4", ...},
#     ...
#   ],
#   "total": 16
# }
```

---

## ▶️ Iniciar o Sistema

### Terminal 1: Backend
```bash
cd server
python main.py
# Ou com uvicorn:
# uvicorn server.main:app --reload
```

### Terminal 2: Frontend
```bash
npm run dev
# Abre em: http://localhost:3000
```

---

## 🎯 Usar PersonaStudio

### Via UI
1. Abrir http://localhost:3000
2. Ir para aba **Studio Video** (🎬)
3. Clicar em **🎁 Gift Recebido** ou **💬 Chat Ativo**

### Via API (testar manualmente)
```bash
# Ver vídeos disponíveis
curl http://localhost:8000/api/video/available

# Reproduzir vídeo específico
curl http://localhost:8000/api/video/play/04 -o video.mp4

# Verificar saúde do sistema
curl http://localhost:8000/api/video/health
```

---

## 🎥 Configurar OBS

### Método 1: Browser Source

```
1. Abrir OBS
2. Cenas → Clique direito → Adicionar Source
3. Escolher "Browser"
4. Nome: "Persona Studio"
5. Configurar:
   - URL: http://localhost:3000/#persona-studio
   - Largura: 720
   - Altura: 1280
   - Refresh Rate: 60 FPS
6. Aplicar
```

### Método 2: Window/Game Capture

```
1. Abrir navegador com PersonaStudio
2. Redirecionar para tela específica (ex: segundo monitor)
3. Em OBS → Source → Window/Game Capture
4. Selecionar janela do navegador
```

---

## ⚙️ Personalizações

### Alterar sequência de Idles

**Arquivo:** `src/PersonaStudio.tsx`

```typescript
// Procure:
const IDLE_SEQUENCES: Record<string, string[]> = {
  calm: ['04', '14', '16', '05', '04'],
  engaged: ['16', '09', '05', '04', '14', '16'],
  reading: ['04', '07', '06', '05', '16'],
};

// Edite conforme desejar
```

### Alterar mapa de transições seguras

**Arquivo:** `src/PersonaStudio.tsx`

```typescript
// Procure:
const SAFE_TRANSITIONS: Record<string, string[]> = {
  '04': ['14', '16', '05', '07', '08', '03'],
  // ... resto
};

// Ou sincronize com: server/core/video_logic.py
```

### Mudar tempo de idle

**Arquivo:** `src/PersonaStudio.tsx`

```typescript
// Procure na seção useEffect do auto-cycle:
}, 8000); // ← Mude este valor (em milissegundos)

// 8000ms = 8 segundos
// Aumentar para mais tempo entre mudanças
```

---

## 🐛 Troubleshooting

### ❌ "Vídeos não encontrados"

**Causa:** Pasta de vídeos não está na localização esperada

**Solução:**
1. Verificar onde estão os vídeos
2. Copiar para `OneDrive\Videos\Captures`
3. Ou editar `server/core/video_files.py` para apontar para a pasta correta

```python
# Em server/core/video_files.py
POSSIBLE_VIDEO_DIRS = [
    Path.home() / "seu/caminho/aqui",  # ← Adicionar caminho correto
    # ... resto
]
```

### ❌ "OCR não funciona em background"

**Causa:** PIL.ImageGrab pode ter problemas com multi-monitores

**Solução:**
1. Verificar se todos os monitores têm mesma taxa de refresh
2. Atualizar Pillow: `pip install --upgrade Pillow`
3. Testar com uma única tela

### ❌ "OBS não vê PersonaStudio"

**Causa:** URL incorreta ou firewall bloqueando

**Solução:**
1. Verificar se frontend está rodando: `http://localhost:3000`
2. Testar URL em navegador: `http://localhost:3000/#persona-studio`
3. Verificar firewall: permitir localhost:3000
4. Se em máquina diferente, usar IP local: `http://192.168.x.x:3000`

### ❌ "Vídeos ficam em preto"

**Causa:** Codec incompatível ou arquivo corrompido

**Solução:**
1. Converter vídeo com FFmpeg:
   ```bash
   ffmpeg -i video_original.mp4 -c:v libx264 -c:a aac video_01.mp4
   ```

2. Verificar resolução (deve ser 720x1280):
   ```bash
   ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 video_01.mp4
   ```

---

## 📊 Monitoramento

### Verificar Performance

```bash
# Backend logs
# Procure por:
# - "Successfully captured region via PIL.ImageGrab"
# - "[OCR SERVICE] Processed image in X ms"

# Frontend console (F12)
# Procure por:
# - "[Persona Studio] Video changed to: XX"
# - Sem erros de CORS
```

### Métricas

```bash
# Latência OCR
curl http://localhost:8000/api/ocr/region -X POST \
  -H "Content-Type: application/json" \
  -d '{"x":0,"y":0,"width":1920,"height":1080}'
# Ver "latency_ms" na resposta

# Verificar vídeos no backend
curl http://localhost:8000/api/video/health
```

---

## 🔐 Segurança

### Para Produção

1. **CORS restritivo:**
   ```python
   # server/main.py
   allow_origins=[
       "https://seudominio.com",
       "https://www.seudominio.com",
   ]
   ```

2. **Autenticação OBS:**
   - Implementar token JWT
   - Proteger endpoints de vídeo

3. **Rate limiting:**
   - Limitar requisições de OCR (ex: 10/min por IP)
   - Limitar acesso a vídeos

---

## 📈 Performance Tips

1. **Compresse vídeos:**
   - Resolução: 720x1280
   - Codec: H.264
   - Bitrate: 2-3 Mbps
   - FPS: 24fps

2. **Cache no navegador:**
   - Vídeos podem ser cacheados
   - Usar headers `Cache-Control`

3. **Limite OCR:**
   - Executar a cada 500ms (não contínuo)
   - Usar resolução menor (ex: 960x540)

4. **Multi-thread no backend:**
   - OCR usa processamento pesado
   - Considerar fila de tarefas (Celery)

---

## 🚨 Checklist de Deploy

- [ ] Vídeos organizados em pasta correta
- [ ] Todos os vídeos nomeados como `video_01.mp4` ... `video_16.mp4`
- [ ] Backend rodando em porta 8000
- [ ] Frontend rodando em porta 3000
- [ ] OCR testado em background (mudar de aba)
- [ ] PersonaStudio carregando vídeos
- [ ] Gatilhos (gift/chat) funcionando
- [ ] OBS conectado e capturando
- [ ] Sem erros no console do navegador
- [ ] Sem erros no terminal do backend

---

## 📞 Suporte

Se encontrar problemas:

1. Verificar logs:
   ```bash
   # Backend
   tail -f ~/.odessa/logs.txt
   
   # Frontend (console do navegador)
   F12 → Console
   ```

2. Testar endpoints individualmente:
   ```bash
   curl -v http://localhost:8000/api/video/health
   curl -v http://localhost:3000
   ```

3. Limpar cache:
   ```bash
   # Frontend
   npm run build
   
   # Backend
   rm -rf __pycache__ .pytest_cache
   ```

---

**Documento atualizado:** 04/05/2026
