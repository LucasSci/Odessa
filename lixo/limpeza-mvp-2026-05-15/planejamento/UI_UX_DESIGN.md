# Odessa Live Studio — UI/UX Design System (Atual)

Este documento descreve a arquitetura visual, o tema e os componentes do painel de controle do **Odessa Live Automation Engine**, refletindo o estado atual da interface gráfica construída em React + Tailwind CSS.

## 🎨 1. Sistema de Cores e Tema (Tailwind)

O design adota uma estética _Dark Mode Premium_ (estilo Vercel/Linear), focado em alto contraste para uso em ambientes de live stream, com elementos de "glassmorphism" (vidro fosco) e micro-animações.

### 1.1. Paleta Base (Backgrounds e Superfícies)

- **Fundo Principal:** Gradiente profundo (`bg-gradient-to-br from-slate-900 to-slate-950`).
- **Cartões e Painéis:** Fundo translúcido (`bg-slate-800/50` ou `bg-slate-900/50`) com efeito de desfoque (`backdrop-blur-sm`).
- **Bordas:** Delimitadores sutis (`border-slate-700/50`), que clareiam no hover (`hover:border-slate-600`).
- **Palcos de Vídeo:** Fundo absoluto (`bg-black`) para garantir que as proporções dos vídeos não mostrem bordas claras.

### 1.2. Cores de Destaque (Acentos e Status)

- 🔵 **Azul (`blue-400` / `blue-600`):** Cor primária para ações principais, abas ativas, ícones de configuração e bordas com foco.
- 🟢 **Esmeralda (`emerald-400` / `emerald-500`):** Indicador de sucesso, status "Ao Vivo", Toggles ativados e Logs do OCR.
- 🟠 **Âmbar (`amber-400` / `amber-500`):** Indicadores de espera (Fila/READY), avisos de desenvolvimento e ícones de ações rápidas.
- 🔴 **Rosa/Vermelho (`rose-600` / `red-400`):** Ações destrutivas (excluir gatilho) ou de interrupção forçada (Simulador de Presente).

### 1.3. Tipografia

- **Títulos:** Fonte _sans-serif_ limpa, com peso `font-bold` e cores claras (`text-white`).
- **Subtítulos/Labels:** Estilo técnico de painel de controle: tamanho minúsculo (`text-[10px]` ou `text-xs`), tudo maiúsculo (`uppercase`), muito espaçamento entre letras (`tracking-widest`) e cor atenuada (`text-slate-400` ou `text-slate-500`).
- **Logs:** Fonte monoespaçada (`font-mono`) para facilitar a leitura técnica de dados brutos e timestamps.

---

## 🏗️ 2. Arquitetura de Navegação

A interface abandonou a visão monolítica em favor de um sistema de abas focado no fluxo lógico do usuário.

### Menu Superior (Tabs)

Localizado no topo esquerdo, utiliza botões em linha com ícones da biblioteca `lucide-react`. A aba ativa recebe destaque azul sólido.

1.  ▶️ **Live Control:** O painel de execução principal.
2.  🎞️ **Video Library:** Gerenciamento de mídia.
3.  ⚡ **Trigger Editor:** Regras de automação (Se -> Então).
4.  ⚙️ **OCR Setup:** Calibração de leitura e simulação.

_(Existe um botão global isolado à direita chamado "Modo Captura" que remove todas as margens e a UI para que o OBS possa capturar apenas os vídeos limpos)._

---

## 🧩 3. Componentes Principais (Telas)

### 3.1. Tela: Live Control (`PersonaStudio.tsx`)

A visão de "cockpit" do streamer.

- **Main Stage (Topo):** Um container responsivo que contém dois `<video>` sobrepostos para fazer _crossfade_ transparente entre o vídeo atual e o próximo.
- **Painel Esquerdo (Fluxo em Tempo Real):** Mostra o vídeo "Reproduzindo" atualmente e o "Próximo na Fila". Usa bordas coloridas (Azul para atual, Rosa piscante se agendado na fila) para guiar o olhar.
- **Painel Direito (Controles e Logs):**
  - _Ações Rápidas:_ Botões grandes e com gradientes (Rosa/Azul) para injetar testes rapidamente na fila.
  - _Seletor Manual:_ Um `<select>` para forçar um vídeo imediato.
  - _Execution Log:_ Um terminal embutido (`min-h-[200px]`, `overflow-y-auto`) que exibe linhas monoespaçadas com timestamps e identificadores de módulo (OCR, PARSER, ENGINE, QUEUE) coloridos de acordo com o status.

### 3.2. Tela: Video Library (`PersonaMediaLibrary.tsx`)

Grid de gerenciamento de assets.

- **Layout:** Grade (`grid-cols-2` ou `grid-cols-3` dependendo da tela) de cartões de vídeo.
- **Video Card:** Exibe uma miniatura (thumbnail gerada ou preview mute), título, grupo de pertencimento e botões de ação (testar, excluir) que aparecem no _hover_.
- **Upload Area:** Área pontilhada para arrastar e soltar (`border-dashed`), com destaque visual quando arquivos são arrastados sobre ela.

### 3.3. Tela: Trigger Editor (`TriggerEditor.tsx`)

Editor visual de regras complexas transformado em formulários intuitivos.

- **Trigger Card:** Cada regra é um bloco expansivo.
- **Layout Interno do Cartão:**
  - _Coluna Esquerda:_ Status Toggle (`emerald-500` se on, `slate-600` se off) e botão de lixeira invisível que aparece no _hover_.
  - _Coluna Direita:_ Dividida estruturalmente em três seções semânticas:
    1.  **Quando Ocorrer:** Define a condição (Event Type + Keywords).
    2.  **Então Executar:** Define a ação (Play Video + Dropdown de seleção).
    3.  **Ajustes:** Cooldown e Prioridade (controles finos numéricos).
- **Salvar:** Botão azul de destaque fixo no topo da tela para persistir o JSON inteiro de uma vez.

### 3.4. Tela: OCR Setup (`OcrSetup.tsx`)

Painel técnico dividido em duas metades (Split View).

- **Coluna Esquerda (Calibração e Visão):**
  - _Configuração da Região:_ Grid compacto (2x2) de inputs numéricos (X, Y, Largura, Altura) para definir onde o Python deve olhar na tela.
  - _Leitura ao Vivo:_ Uma caixa grande escura que faz polling no backend para exibir em fonte verde (estilo matrix/terminal) o que as zonas configuradas estão capturando naquele segundo.
- **Coluna Direita (Simulação):**
  - _Injetor:_ Um `<textarea>` para digitar frases do chat e um botão forte ("Injetar Texto") para testar os gatilhos criados no Trigger Editor.
  - _Box de Ajuda:_ Instruções em azul pálido explicando a gramática que o Parser entende (ex: `[Usuário] enviou [Presente]`).

---

## ⚡ 4. Padrões de Interação e Feedback Visual

1.  **Botões e Inputs:** Usam bordas `transparent` por padrão, revelando a cor `blue-500` ao receberem foco (estado `:focus`).
2.  **Feedback de Fila:** Quando uma automação joga um vídeo para a fila, a caixa de "Próximo" na tela de Live Control pulsa (`animate-pulse`) e muda sua tag de "READY" (Âmbar) para "AGENDADO" (Rosa vibrante).
3.  **Transições de Tela:** O React alterna entre as abas condicionalmente (`activeTab === 'live'`), sem recarregar a página, garantindo que o vídeo principal (Main Stage) que está sendo renderizado no topo **nunca** pare de tocar enquanto o usuário navega pelas configurações abaixo dele.
