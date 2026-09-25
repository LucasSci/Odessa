# Documentos legais (#248)

Nenhum texto legal vai para produção sem aprovação do jurídico registrada na
issue #248. Esta pasta reúne o material de apoio e o caminho até a publicação.

| Arquivo | O que é |
|---|---|
| `INVENTARIO-DE-DADOS.md` | O que o Odessa coleta, onde guarda, por quanto tempo, com quem compartilha e as perguntas em aberto para o jurídico |
| `rascunhos/TERMOS-DE-USO.md` | **Rascunho** da engenharia para o jurídico revisar. Não publicar |
| `rascunhos/POLITICA-DE-PRIVACIDADE.md` | **Rascunho** da engenharia para o jurídico revisar. Não publicar |

Nos rascunhos, as marcações **[A DEFINIR — P*n*]** são decisões do jurídico e
remetem às perguntas da seção 5 do inventário.

## Como publicar depois da aprovação

1. O jurídico aprova o texto final num comentário da issue #248, com a
   **versão** e a **data**.
2. Salve o texto aprovado como página estática em `public/legal/`:
   `termos-de-uso.html` e/ou `politica-de-privacidade.html`, com a versão e a
   data no topo.
3. Em `src/core/legalDocuments.ts`, preencha `version`, `approvedAt`
   (AAAA-MM-DD) e `approvalRef` (link do comentário de aprovação na #248).
4. Abra o PR. Os links aparecem sozinhos no login e na barra lateral, com a
   versão e a data.

A trava é automática: `src/core/legalDocuments.test.ts` reprova o CI se houver
qualquer arquivo em `public/legal/` sem aprovação registrada, ou documento
marcado como aprovado sem a página publicada.
