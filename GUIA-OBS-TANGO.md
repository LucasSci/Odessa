# Guia Fase 4 — OBS → Tango: acabar com os quadros perdidos

> Objetivo: resolver os **"Quadros perdidos 529 (90,6%)" + 0 kbps** e deixar a
> transmissão estável. Isto é configuração **manual no OBS** — o app só dispara o
> `StartStream`; o servidor RTMP, a chave e o encoder são do **perfil do Tango**
> que você baixa e configura no OBS.

---

## 0. Primeiro: entenda o que o número quer dizer

No OBS existem **3 tipos diferentes** de "frame perdido". Abra o painel de
estatísticas pra ver qual é o seu: **Exibir → Painéis → Estatísticas**.

| Estatística | Causa | Onde resolver |
|---|---|---|
| **Quadros perdidos (rede)** ← o seu (90,6%) | O OBS não consegue **enviar** pro servidor | Chave/servidor do Tango + **rede** (seções 1, 2 e 5) |
| Quadros perdidos por *encoding lag* | Encoder sobrecarregado | Encoder mais leve (seção 3) |
| Quadros perdidos por *rendering lag* | GPU sobrecarregada | Aceleração de hardware / fechar apps de GPU |

**O seu caso (90,6% + 0 kbps) é REDE.** 0 kbps de saída = o OBS está mandando
**zero** pro Tango → o cano está quebrado. Isso é **chave/servidor/conexão**,
**não** o encoder. Por isso "rebaixar o perfil" resolve: você pega uma **chave e
um servidor novos**. Ataque nesta ordem: 1 → 2 → 5 → 3 → 4.

---

## 1. Chave e servidor do Tango (a causa nº 1 do 0 kbps)

**Configurações → Transmissão:**
- **Serviço:** Personalizado (Custom).
- **Servidor:** a URL RTMP do perfil **mais recente** do Tango (`rtmp://...`).
- **Chave de transmissão:** a chave do perfil **mais recente** do Tango.

⚠️ **A chave do Tango costuma expirar / ser por sessão.** É exatamente por isso
que baixar um perfil novo conserta. Regra de ouro:
- **Sempre comece a live com um perfil recém-baixado** do Tango.
- Se os "quadros perdidos (rede)" subirem no meio da live, a chave/servidor
  provavelmente caducou — pare, baixe o perfil de novo, recomece.
- Se o Tango te der opção de **região/servidor**, escolha o **mais próximo de
  você** (menos saltos de rede = menos perda).

---

## 2. Reconexão + bitrate dinâmico (o amortecedor contra perda)

**Configurações → Avançado → Rede:**
- ✅ **"Mudar o bitrate dinamicamente para gerenciar congestionamento (Beta)"**
  → **LIGUE.** Esse é o mais importante: quando a rede aperta, o OBS **abaixa o
  bitrate** em vez de **derrubar frames**. Ataca direto o 90,6%.
- ✅ **"Ativar novo código de rede"** (Enable new networking code) → ligado.
- "Vincular ao IP" (Bind to IP): deixe no adaptador de **cabo** se tiver.

**Reconexão automática** (em *Configurações → Transmissão*, parte de baixo, ou em
*Geral*, dependendo da versão do OBS):
- ✅ Reconectar automaticamente: **ligado**, atraso **2 s**, máximo de tentativas alto.

---

## 3. Encoder (estabilidade e CPU baixa)

**Configurações → Saída → Modo de saída: Avançado → aba Transmissão:**

- **Encoder:** prefira **hardware** (libera a CPU):
  - NVIDIA → **NVIDIA NVENC H.264**
  - Intel → **QuickSync H.264**
  - AMD → **AMD HW H.264 (AVC)**
  - Sem GPU → **x264** com preset **veryfast**
- **Controle de taxa (Rate Control):** **CBR** — obrigatório pra live/RTMP.
- **Bitrate:** **2500–4000 kbps** pra vertical 720×1280@30. Comece em **3000**.
  - Se a perda de rede continuar, **abaixe pra 2500**. O bitrate tem que ser bem
    menor que seu **upload** (veja a seção 5).
- **Intervalo de keyframe:** **2** (segundos). ⚠️ Obrigatório pra ingest RTMP —
  com 0/automático muitos servidores recusam ou cortam.
- **Preset (NVENC):** **Quality (P5)**. Se aparecer *encoding lag*, baixe pra
  **P4** ou **P1 (Max Performance)**.
- **Perfil:** high. **Tuning:** Low-Latency (bom pra live).
- **Look-ahead:** desligado. **Psycho Visual Tuning:** desligado (menos carga e
  mais estável).

---

## 4. Vídeo (casar com o 9:16 do Tango)

**Configurações → Vídeo:**
- **Resolução de base (canvas):** **1080×1920** (o app já força isso ao "Preparar OBS").
- **Resolução de saída (escalada):** **720×1280** → mais leve, exige menos bitrate,
  **menos perda de rede**. (Use 1080×1920 só se o upload sobrar — veja seção 5.)
- **Filtro de redução:** **Lanczos**.
- **FPS:** **30** (a fonte do overlay já é pinada nesse FPS pela Fase 3).

---

## 5. Rede física (onde os "quadros perdidos" nascem de verdade)

A perda de rede quase sempre é **Wi-Fi ou upload insuficiente**:

- 🔌 **Use cabo Ethernet, não Wi-Fi.** Wi-Fi instável é a causa nº 1 de quadros
  perdidos. Se for obrigatório Wi-Fi, fique perto do roteador, 5 GHz.
- 📈 **Teste seu upload** (speedtest). O **bitrate da seção 3 tem que ser ≤ ~70%
  do upload** disponível. Ex.: upload de 5 Mbps → bitrate no máximo ~3500 kbps.
- 🛑 **Feche quem disputa a banda durante a live:**
  - ⚠️ **OneDrive** — este projeto fica numa pasta do OneDrive. Se ele sincronizar
    no meio da live, **come o upload** e gera quadros perdidos. Pause a
    sincronização do OneDrive enquanto estiver ao vivo.
  - Downloads, atualizações, backups em nuvem, outras transmissões/abas pesadas.
- 🌐 Se possível, **QoS no roteador** priorizando o PC da live.

---

## 6. Validar (prova de que resolveu)

1. Abra **Exibir → Painéis → Estatísticas**.
2. Comece a transmitir e observe por alguns minutos:
   - **Quadros perdidos (rede)** deve ficar **< 1%** (idealmente 0).
   - O **kbps de saída** deve mostrar ~o bitrate configurado (não 0!).
3. Diagnóstico rápido pelo que subir:
   - **Quadros perdidos (rede)** sobe → chave/servidor (1), bitrate alto vs upload (5),
     ou bitrate dinâmico desligado (2).
   - **Encoding lag** sobe → encoder pesado: preset mais rápido / bitrate ou
     resolução menores (3, 4).
   - **Rendering lag** sobe → GPU: confirme a **aceleração de hardware de fontes de
     navegador** (Configurações → Avançado) e feche apps que usam GPU.

---

## Checklist rápido (na ordem)

- [ ] Perfil do Tango **recém-baixado** (servidor + chave novos) — seção 1
- [ ] **Bitrate dinâmico (Beta) LIGADO** + reconexão automática — seção 2
- [ ] Encoder **hardware**, **CBR**, **keyframe 2 s**, bitrate ~3000 — seção 3
- [ ] Saída **720×1280 @ 30**, Lanczos — seção 4
- [ ] **Cabo Ethernet**, upload com folga, **OneDrive pausado** na live — seção 5
- [ ] Painel de Estatísticas aberto, **perda de rede < 1%** — seção 6
