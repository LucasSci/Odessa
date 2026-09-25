# Política de Privacidade do Odessa — RASCUNHO

> ⚠️ **RASCUNHO PARA REVISÃO JURÍDICA. NÃO PUBLICAR.**
> Escrito pela engenharia a partir do código (`docs/legal/INVENTARIO-DE-DADOS.md`)
> para servir de ponto de partida ao jurídico (issue #248). Não é texto legal
> final e não vale como política até a aprovação ser registrada na #248.
> Marcações **[A DEFINIR — P*n*]** são decisões do jurídico e remetem às
> perguntas da seção 5 do inventário.

Versão: [A DEFINIR] · Aprovada em: [A DEFINIR]

## 1. Quem somos e a quem esta política se aplica

O Odessa é um software para operar lives com uma persona virtual: ele lê o chat
da live no Tango, gera respostas com inteligência artificial e pode falar,
exibir vídeos e escrever no chat pela conta do operador.

Controlador dos dados: **[A DEFINIR — P8: o operador da live, o mantenedor do
Odessa ou ambos, conforme o cenário de uso]**.

Esta política vale para:
- **espectadores** das lives em que o Odessa está ligado;
- **operadores** que usam o painel do Odessa;
- a **pessoa retratada** pela persona, quando houver.

## 2. Quais dados tratamos

**Espectadores**
- Nome de usuário e texto das mensagens enviadas no chat da live.
- Presentes enviados na live (tipo e quantidade).
- Um perfil por espectador: quantas mensagens e presentes enviou, quando foi
  visto pela última vez e as interações mais recentes.
- Preferências deduzidas do chat (por exemplo, pedidos e gostos) e tendências
  gerais do chat.

Na memória por espectador, e-mails e números de telefone são mascarados, e
mensagens com link, contato externo, ofensa ou tentativa de golpe não entram.
O histórico da sessão guarda, para auditoria, o texto das mensagens a que a IA
respondeu ou deixou de responder, junto com o motivo.

**Operadores**
- Credenciais de acesso ao painel e o token da sessão.
- Configurações do painel, chaves dos serviços de IA e conversas feitas no
  laboratório da persona.

**Pessoa retratada pela persona**
- Fotos e demais materiais enviados para compor a identidade visual da persona
  e gerar imagens e vídeos.

## 3. Para que usamos os dados

| Finalidade | Dados | Base legal |
|---|---|---|
| Mostrar o chat ao operador e responder aos espectadores | Nome e mensagens | [A DEFINIR — P1] |
| Reconhecer quem volta e agradecer presentes | Perfil do espectador | [A DEFINIR — P1] |
| Auditar o que a IA respondeu ou deixou de responder, e por quê | Histórico da sessão | [A DEFINIR — P1] |
| Gerar a imagem e a voz da persona | Fotos da pessoa retratada | [A DEFINIR — P5] |
| Diagnosticar falhas técnicas (só quando ativado) | Erros técnicos, sem dados pessoais | [A DEFINIR] |

Aviso aos espectadores durante a live: [A DEFINIR — P1].

## 4. Com quem compartilhamos

Para funcionar, o Odessa envia dados a estes serviços, conforme o que o
operador ligar:

- **Provedores de IA**: Google (Gemini), OpenAI/RouteLLM, Anthropic (Claude).
  Recebem o texto da persona, as mensagens recentes do chat (com nomes) e um
  resumo do que se sabe de quem está falando. Com o Ollama local, nada sai da
  máquina.
- **Microsoft (edge-tts)**: o texto das falas da persona, para gerar a voz.
- **Higgsfield**: fotos da persona e descrições, para gerar imagens e vídeos.
- **Tango**: as mensagens que a persona escreve no chat.
- **Automação (n8n/webhooks)**: eventos da live, quando o operador configura.
- **Sentry** (opcional): erros técnicos, sem usuário, cookies, cabeçalhos ou
  mensagens do chat.
- **Hostinger**: hospedagem da versão em nuvem.

Vários desses serviços ficam fora do Brasil. Transferência internacional:
[A DEFINIR — P4].

## 5. Por quanto tempo guardamos

| Dado | Prazo |
|---|---|
| Mensagens exibidas no painel | Até fechar a página |
| Histórico da sessão | [A DEFINIR — P2] (hoje não há limpeza automática) |
| Perfil do espectador e interações | [A DEFINIR — P2] (hoje até o operador apagar) |
| Preferências e tendências no navegador | [A DEFINIR — P2] (hoje até o operador resetar) |
| Fotos da persona | Até o operador remover |

## 6. Direitos do titular

Pela LGPD (art. 18), o titular pode pedir confirmação e acesso aos dados,
correção, anonimização, bloqueio ou eliminação, portabilidade, informação sobre
com quem os dados foram compartilhados e revogação do consentimento, quando o
consentimento for a base legal.

O que o painel já permite ao operador:
- **ver** um espectador e o que está guardado dele;
- **ocultar** o espectador das respostas da IA, sem apagar;
- **esquecer** o espectador, apagando o perfil e as interações;
- **resetar** todo o aprendizado do chat;
- **exportar** o histórico da sessão (JSON/CSV).

Canal para pedidos e prazo de resposta: [A DEFINIR — P3].

## 7. Segurança

- Painel com login e limite de tentativas; a ponte com o Tango só aceita
  pedidos do próprio servidor.
- Mascaramento de e-mails e telefones na memória por espectador.
- Monitoramento de erros sem dados pessoais.

## 8. Crianças e adolescentes

[A DEFINIR — P7]

## 9. Armazenamento no navegador

O painel guarda no navegador do operador as configurações, o token da sessão,
as tendências do chat e os eventos recentes da live. Nada disso é usado para
publicidade nem compartilhado com terceiros além do descrito na seção 4.

## 10. Alterações

Mudanças nesta política recebem nova versão e data de aprovação, exibidas junto
ao link da política no painel.

## 11. Contato

Encarregado (DPO) e canal de contato: [A DEFINIR — P3/P8].
