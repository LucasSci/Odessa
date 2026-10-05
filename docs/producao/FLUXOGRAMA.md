# Fluxograma da produção — da foto de rosto à live no Tango

Mesmo conteúdo da página interativa (com todos os prompts e botão de copiar).
Prompts por persona: [viktoria/PROMPTS.md](viktoria/PROMPTS.md) · [barbara/PROMPTS.md](barbara/PROMPTS.md)
(gerados por `scripts/build_idle_prompts.py`).

## A · Imagens da persona (kit da IDLE)

```mermaid
flowchart TD
  F0["Foto de rosto da persona<br/>única referência de identidade"] --> F1["Ficha em inglês<br/>IDENTITY, WARDROBE, ROOM, LIGHT,<br/>MIC, MOTION, DRINK, PET"]
  F1 --> I1["Etapa 1 · cenario_vazio.png · 9:16<br/>fundo sem pessoa"]
  F1 --> I2["Etapa 2 · figurino.png · 3:4<br/>roupa e joias fixas"]
  F0 --> I3
  I1 --> I3
  I2 --> I3["Etapa 3 · A0_camera.png e A0_camera_close.png<br/>pose-base olhando a lente"]
  I3 --> D1{"Colocar as duas no palco do Odessa:<br/>busto ou close?"}
  D1 -->|escolhe uma| A0["A0 definitiva<br/>1º e último frame dos vídeos"]
  A0 --> I4a["Etapa 4 · A1_chat.png<br/>lendo o chat, olhar à direita"]
  A0 --> I4b["Etapa 4 · A2_relaxada.png<br/>encostada, chat parado"]
  A0 --> I4c["Etapa 4 · A3_perto.png<br/>perto da câmera, conversando"]
  A0 --> I5["Etapa 5 · ref_rosto_frente, 34_esq, 34_dir<br/>trava o rosto no gerador de vídeo"]
  F0 --> I5
  I5 --> I6["Etapa 6 · ref_expressoes.png<br/>folha 3x3 de expressões"]
  I1 --> I7["Etapa 7 · ref_pet.png<br/>pet dos beats raros"]
  A0 --> I8["Etapa 8 · A0_brinde.png<br/>opcional, vídeo 103"]
  A0 --> I9["Etapa 9 · capas 1:1 e 9:16<br/>divulgação"]
  I4a --> QC{"Imagem aprovada?<br/>rosto igual à foto, mãos fora do quadro,<br/>fundo, microfone e joias iguais à A0"}
  I4b --> QC
  I4c --> QC
  I5 --> QC
  I6 --> QC
  QC -->|não| RG["Regerar 3 a 4 variações<br/>escolher a mais fiel ao rosto"]
  RG --> QC
  QC -->|sim| KIT["Kit completo<br/>assets/idle-kit/persona/"]
  I10["Etapa 10 · overlays sem pessoa<br/>cartela de segmento e moldura Top fã"] --> OBSX["vão para o OBS"]
```

## B · Vídeos, Odessa e OBS (preparar a live)

```mermaid
flowchart TD
  KIT["Kit de imagens aprovado"] --> V0["Lote 0 · 5 clipes de teste<br/>40, 45, 52, 53, 74"]
  V0 --> G["Gerador image-to-video<br/>Kling, Veo 3.1, Seedance ou Wan<br/>1º frame + último frame + prompt + negativo<br/>9:16, 24 fps, sem áudio"]
  G --> C1{"check_idle_anchor.py dá ok/ok?<br/>rosto, joias, mãos entram e saem"}
  C1 -->|fim quase igual| CUT["Cortar os 2 a 4 frames finais"]
  CUT --> C1
  C1 -->|falhou| G
  C1 -->|ok| P0{"Lote 0 aprovado no palco do Odessa?<br/>busto funciona, encaixe sem pulo"}
  P0 -->|não| AJ["Ajustar A0, ficha ou prompt<br/>e refazer o lote 0"]
  AJ --> V0
  P0 -->|sim| V1["Lote 1 · +29 clipes<br/>34 no total: mínimo para ir ao ar"]
  V1 --> G1["Mesmo gerador e mesma conferência<br/>clipe a clipe"]
  G1 --> UP["Odessa · Estúdio da IDLE<br/>anexar e aprovar cada clipe no card<br/>(nome automático pela etapa)"]
  UP --> FL["Montar o fluxo da live (1 clique)<br/>cadastra os vídeos, nó IDLE = A0,<br/>ciclo natural A0–A3 e um gatilho por evento"]
  FL --> TG["Odessa · Automações<br/>revisar o rascunho, trocar faixa de presente<br/>por um presente específico se quiser"]
  TG --> PUB["Publicar o workflow"]
  PUB --> OBS["OBS · cena Odessa LIVE 1080x1920<br/>UMA fonte de navegador com o overlay do Odessa<br/>widgets LivePix: meta, QR, alertas<br/>cartelas de segmento"]
  OBS --> TX{"Como a imagem chega ao Tango"}
  TX -->|Câmera Virtual| EDGE["Tango no Edge, perfil logado<br/>câmera = OBS Virtual Camera"]
  TX -->|Stream| RTMP["Chave de stream do Tango no OBS"]
  EDGE --> EXT["Extensão Odessa na aba do Tango<br/>lê o chat, digita as respostas,<br/>mostra a aba no painel Ao Vivo"]
  RTMP --> EXT
  EXT --> READY["Pronto para ir ao ar"]
  V2["Lote 2 · +31 clipes<br/>variedade para lives de 2 h ou mais"] -.depois.-> UP
```

## C · A live rodando

```mermaid
flowchart LR
  subgraph TANGO["Tango"]
    CH["Chat da live"]
    EV["Presente ou novo seguidor"]
    TV["Vídeo da live"]
  end
  CH --> EXT["Extensão lê a mensagem"]
  EXT --> BR["Bridge<br/>descarta repetida por 15 min<br/>reconhece a fala da própria persona"]
  BR --> CEN["Odessa · Central da Live"]
  CEN --> MEM["Memória do chat<br/>quem é, se já presenteou"]
  CEN --> AUTO{"Modo Autônomo,<br/>janela líder e<br/>mensagem nova?"}
  AUTO -->|não| FEED["Só aparece no feed"]
  AUTO -->|sim| CT{"Pedido de contato?"}
  CT -->|sim| RC["Recusa pronta da persona"]
  CT -->|não| IA["IA escolhida no selo<br/>local, Gemini ou Mistral<br/>personalidade + tema + conversa em turnos"]
  MEM --> IA
  IA --> FI{"Copiou o chat? termo proibido?"}
  FI -->|barrado| WHY["Motivo aparece na Central"]
  FI -->|ok| GOV["Governador<br/>cooldown, limite por minuto, confiança"]
  RC --> GOV
  GOV --> SEND["Bridge manda para a extensão"]
  SEND --> TYPE["Extensão digita e envia no chat"]
  TYPE --> CH
  CEN --> KW["Gatilho por palavra-chave"]
  EV --> KW
  KW --> VM["Motor de vídeo<br/>força o clipe de reação"]
  VM --> OV["Overlay no OBS<br/>troca com crossfade, vídeos já na memória"]
  VM -->|clipe terminou| NX["Próximo clipe pela conexão do fluxo<br/>ou volta para a IDLE A0"]
  NX --> OV
  OV --> OBS["OBS"]
  OBS --> CAM["Câmera Virtual ou stream"]
  CAM --> TV
  ST["PRÓXIMO PASSO<br/>estado A0, A1, A2 ou A3 pelo ritmo do chat,<br/>energia e beats raros com cooldown"] -.ainda não implementado.-> VM
```

> O motor por estados (A1 quando o chat agita, A2 quando esfria, A3 enquanto a IA responde) está
> desenhado em IDLE-PRODUCAO.md, mas ainda não foi implementado: hoje o vídeo segue as conexões do fluxo e os gatilhos.
