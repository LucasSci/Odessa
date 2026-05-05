# 🎬 Implementação: PersonaStudio com Alternância de Vídeos

**Data:** 04 de Maio de 2026
**Status:** ✅ Implementado e Integrado
**Objetivo:** Permitir que o Persona Studio alterne entre vídeos de forma natural, acionado por gatilhos de chat e com estados idle que pareçam humanos.

---

## 🔧 Mudanças Implementadas

### 1. **Correção da Falha de OCR** ✅

**Problema Identificado:** A captura OCR parava de funcionar quando o usuário alternava entre abas do navegador (perdia o foco da janela).

**Solução Implementada:**
- Substituída captura via `pyautogui.screenshot()` por `PIL.ImageGrab.grab()`
- `PIL.ImageGrab` funciona com Windows API de baixo nível e **não depende do foco da janela**
- Adicionado fallback para captura de tela inteira se a região falhar

**Arquivo modificado:**
```
server/services/ocr_service.py
- Importação: pyautogui → PIL.ImageGrab
- Método: image_from_request() → usa PIL.ImageGrab com bbox seguro
```

**Benefício:** OCR agora persiste mesmo quando você alterna entre abas.

---

### 2. **Novo Componente: PersonaStudio** ✅

**Arquivo criado:** `src/PersonaStudio.tsx`

Um novo componente React completo que oferece:

- **Exibição de Vídeos:** Renderiza vídeos de persona com controles
- **Alternância com Transições Suaves:** Crossfade de 0.5s entre vídeos
- **Validação de Segurança:** Usa o mapa de transições de `video_logic.py` para evitar "jumps" visuais
- **Estados Idle Automáticos:** Cicla entre sequências pré-configuradas (calm, engaged, reading)
- **Gatilhos Manuais:** Botões para acionar reações a gifts e mensagens
- **Histórico de Gatilhos:** Mostra os últimos eventos que causaram mudanças

**Recursos principais:**

```typescript
// Sequências de Idle predefinidas
const IDLE_SEQUENCES = {
  calm: ['04', '14', '16', '05', '04'],      // Relaxado
  engaged: ['16', '09', '05', '04', '14', '16'], // Engajado
  reading: ['04', '07', '06', '05', '16'],   // Lendo chat
};

// Mapa de transições seguras (Hub-and-Spoke)
const SAFE_TRANSITIONS = {
  '04': ['14', '16', '05', '07', '08', '03'],
  '05': ['16', '04', '09', '15', '03'],
  // ... etc
};
```

---

### 3. **Hook de Gatilhos: usePersonaTriggers** ✅

**Arquivo criado:** `src/core/usePersonaTriggers.ts`

Monitora as mensagens capturadas e aciona transições automáticas:

```typescript
usePersonaTriggers(capturedText, {
  enableGiftTrigger: true,
  enableMessageTrigger: true,
  enableReactionTrigger: true,
  giftKeywords: ['gift', 'doação', 'presente'],
  reactionKeywords: ['wow', 'legal', 'top'],
}, (trigger) => {
  // Acionar transição de vídeo
});
```

**Comportamento:**
- Detecta menções de gifts → Toca vídeos de agradecimento (01, 02, 03)
- Detecta mensagens de reação → Toca movimentos naturais (07, 08, 09)
- Detecta mensagens normais → Toca movimentos de leitura/atenção
- Cooldown de 2 segundos entre gatilhos para evitar spam

---

### 4. **Rotas Backend para Vídeos** ✅

**Arquivo criado:** `server/routes/video.py`
**Arquivo criado:** `server/core/video_files.py`

Novas endpoints da API:

```bash
GET /api/video/available
# Lista todos os vídeos disponíveis (video_01.mp4 até video_16.mp4)

GET /api/video/play/{video_id}
# Serve o arquivo de vídeo (ex: /api/video/play/04)

GET /api/video/health
# Verifica se o sistema de vídeos está funcionando
```

**Recurso de Auto-descoberta:**
- Procura vídeos em múltiplos locais (em ordem de preferência):
  1. OneDrive Videos/Captures
  2. Videos/Odessa (local)
  3. Downloads/Videos
  4. Project assets/videos

---

### 5. **Integração no OdessaLiveCenter** ✅

**Arquivo modificado:** `src/OdessaLiveCenter.tsx`

Adicionado novo tab "Studio Video" (🎬):

```typescript
<TabButton
  active={activeTab === 'persona-studio'}
  onClick={() => setActiveTab('persona-studio')}
  label="Studio Video"
  icon={<Video className="h-3.5 w-3.5" />}
/>
```

O PersonaStudio agora aparece na interface principal ao lado de "Odessa" (trainer).

---

## 📊 Fluxo Completo (Conforme Solicitado)

```
┌─────────────────────────────────────────────────────────────┐
│                  PERSONA STUDIO WORKFLOW                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. PersonaStudio Widget (Frontend)                         │
│     ├─ Exibe vídeo atual (ex: video_04.mp4)               │
│     ├─ Alterna automaticamente entre idles                  │
│     └─ Recebe gatilhos (click ou chat-based)               │
│                                                             │
│  2. Gatilhos de Chat (Hook usePersonaTriggers)             │
│     ├─ OCR captura mensagens                               │
│     ├─ Detecta gifts, reações, etc                         │
│     └─ Aciona transição de vídeo                           │
│                                                             │
│  3. Motor de Transições (PersonaStudio Logic)              │
│     ├─ Valida segurança (SAFE_TRANSITIONS map)            │
│     ├─ Aplica crossfade (0.5s)                            │
│     └─ Muda src do video element                          │
│                                                             │
│  4. Backend Servindo Vídeos (FastAPI)                      │
│     ├─ GET /api/video/play/{id}                           │
│     ├─ Auto-descobre pasta de vídeos                       │
│     └─ Retorna arquivo MP4                                │
│                                                             │
│  5. OBS Capturando (Browser Source)                        │
│     ├─ Aponta para: http://localhost:3000/#persona        │
│     ├─ Captura PersonaStudio renderizado                  │
│     └─ Envia para live stream                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Como Usar

### 1. **Preparar os Vídeos**

Coloque seus arquivos de vídeo (video_01.mp4 até video_16.mp4) em uma destas pastas:
- `C:\Users\{SeuUsuário}\OneDrive\Videos\Captures\`
- `C:\Users\{SeuUsuário}\Videos\Odessa\`
- `C:\Users\{SeuUsuário}\Downloads\Videos\`

### 2. **Acessar o Studio**

Na interface Odessa:
```
Sidebar → Studio Video (tab com ícone 🎬)
```

### 3. **Controles Disponíveis**

- **🎁 Gift Recebido:** Toca vídeos de agradecimento
- **💬 Chat Ativo:** Toca movimentos de atenção/leitura
- **Seletor de Vídeo:** Dropdown para escolher manualmente
- **Play/Pause:** Controlar reprodução
- **Mute/Unmute:** Controlar som
- **Próximos Seguros:** Botões rápidos para transições seguras

### 4. **Configurar OBS (Opcional)**

Para capturar o PersonaStudio:

```
OBS → Adicionar Source → Browser Source
URL: http://localhost:3000/#persona
Largura: 720px | Altura: 1280px
Refresh: 60 FPS
```

---

## 🎯 Sequências de Comportamento

### **Modo Calm (Relaxado)** 
```
video_04 (âncora) → 
video_14 (piscada) → 
video_16 (close) → 
video_05 (soft) → 
[repete]
```

### **Modo Engaged (Engajado)**
```
video_16 (close) → 
video_09 (sorriso) → 
video_05 (soft) → 
video_04 (âncora) → 
video_14 (piscada) → 
[repete]
```

### **Modo Reading (Lendo Chat)**
```
video_04 (âncora) → 
video_07 (olhar lateral) → 
video_06 (leitura) → 
video_05 (soft) → 
video_16 (close) → 
[repete]
```

### **Reação a Gift**
```
[Estado atual] → 
video_14 (transição segura) → 
video_01/02/03 (agradecimento) → 
video_14 (volta) → 
video_05/04 (retorno ao idle)
```

---

## 🔍 Validação de Transições

Todas as transições são **validadas contra o mapa de transições seguras** (`SAFE_TRANSITIONS`). Se uma transição não estiver no mapa, o sistema automaticamente usa `video_14` (piscada) como ponte segura.

```typescript
// Exemplo
Transição solicitada: 04 → 11 (não está em SAFE_TRANSITIONS['04'])
↓
Sistema usa: 04 → 14 (piscada segura) → 11
```

---

## 📝 Próximos Passos (Fase 2)

- [ ] **WebSocket em Tempo Real:** Conectar PersonaStudio ao OBS via WebSocket para sincronizar transições
- [ ] **Integração n8n:** Acionar transições de vídeo via webhooks de eventos da live
- [ ] **Gravação de Sequências:** Permitir salvar e reproducir sequências complexas
- [ ] **Análise de Sentimento:** Detectar tom da mensagem e escolher vídeo apropriado
- [ ] **Mobile Preview:** Visualizar persona em resolução de smartphone

---

## 📋 Checklist de Testes

- [x] OCR funciona ao alternar abas
- [x] PersonaStudio carrega vídeos corretamente
- [x] Transições suaves entre vídeos
- [x] Gatilhos de chat funcionam
- [x] Idle sequences ciclam automaticamente
- [x] Validação de transições seguras
- [ ] OBS captura PersonaStudio corretamente
- [ ] Vídeos servidos sem lag pelo backend

---

**Desenvolvido por:** Antigravity Unit  
**Projeto:** Odessa AI Streamer  
**Status:** Pronto para Fase 2
