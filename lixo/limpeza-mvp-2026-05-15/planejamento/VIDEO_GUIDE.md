# 🎥 Guia de Vídeos da Odessa

Este documento descreve a arquitetura de transição e o sistema de "clipes de estado" para a persona Odessa.

## 🏗️ Arquitetura Hub-and-Spoke

Em vez de alternar livremente entre todos os vídeos, a Odessa utiliza um sistema de **Âncora → Ação → Retorno**. Isso esconde os cortes e evita saltos perceptíveis (como mãos surgindo do nada).

- **Hub (Âncoras):** Vídeos neutros e frontais (Ex: `video_04`, `video_16`).
- **Spoke (Ações):** Vídeos de reação ou movimento (Ex: `video_10` - Mexer no cabelo).
- **Ponte:** Vídeos curtos de transição (Ex: `video_14` - Piscada).

---

## 📂 Grupos de Vídeos

### Grupo A — Base / Idle / Retorno

Estes formam o "loop vivo" da Odessa.

- `video_04`: Âncora principal / Idle base.
- `video_16`: Âncora próxima da câmera.
- `video_14`: Ponte de piscada (ótimo para conectar tudo).
- `video_05`: Retorno suave.

### Grupo B — Olhar Lateral

- `video_07`, `video_08`: Olhar para o lado (leitura ou desvio).
- `video_09`: Sorriso fechado.
- `video_15`: Retorno de olhar.

### Grupo C — Movimento de Mão (Cabelo)

- `video_10`, `video_11`, `video_12`, `video_13`: Diferentes toques no cabelo e pescoço.
  > **Dica:** Evite entrar nestes clipes direto de um plano muito diferente. A mão deve aparecer de forma fluida.

### Grupo D — Agradecimentos

- `video_01`: Agradecimento forte/emocional.
- `video_02`: Reação a Gift/Doação.
- `video_03`: Agradecimento suave.

---

## 🚀 Sequências Recomendadas

### Sem Interação (Idle Loop)

`04` → `14` → `16` → `09` → `05` → `04`

### Reação a Elogio

`04` ou `16` → `03` → `14` → `05` → `04`

### Lendo Chat

`04` → `07` → `06` (Leitura) → `05` → `16`

---

## 🛠️ Como Usar no OBS

1. Execute o script `scripts/organize_videos.ps1` para renomear os arquivos na pasta de Downloads.
2. No OBS, adicione as fontes de mídia apontando para os novos nomes (`video_01.mp4`, etc).
3. Use um **Micro Crossfade** de **0.12s a 0.25s** (3 a 6 frames) para as transições.

---

## 📄 Lógica Programática

A lógica de transição está codificada em `server/core/video_logic.py`, permitindo que o sistema recomende o próximo clipe seguro automaticamente.
