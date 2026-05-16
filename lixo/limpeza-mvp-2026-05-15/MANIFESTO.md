# Manifesto de limpeza MVP - 2026-05-15

Nada foi apagado permanentemente. Os itens abaixo foram movidos para manter o caminho ativo do projeto focado em runtime, build, testes e instalador.

| Original | Destino | Categoria | Motivo | Risco |
| --- | --- | --- | --- | --- |
| ANALISE_PROJETO_STATUS.md | lixo\limpeza-mvp-2026-05-15\planejamento\ANALISE_PROJETO_STATUS.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| CHANGELOG_PERSONA_STUDIO.md | lixo\limpeza-mvp-2026-05-15\planejamento\CHANGELOG_PERSONA_STUDIO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| FASE_1_CHECKLIST_DETALHADO.md | lixo\limpeza-mvp-2026-05-15\planejamento\FASE_1_CHECKLIST_DETALHADO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| FASE_1_CONCLUIDA_85PORCENTO.md | lixo\limpeza-mvp-2026-05-15\planejamento\FASE_1_CONCLUIDA_85PORCENTO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| FASE_1_RESUMO_EXECUTIVO.md | lixo\limpeza-mvp-2026-05-15\planejamento\FASE_1_RESUMO_EXECUTIVO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_ARQUITETURA.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_ARQUITETURA.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_FINAL_SUMMARY.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_FINAL_SUMMARY.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_IMPLEMENTACAO.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_IMPLEMENTACAO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_INDICE.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_INDICE.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_PT-BR.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_PT-BR.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_QUICKSTART.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_QUICKSTART.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_RESUMO.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_RESUMO.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PERSONA_STUDIO_SETUP.md | lixo\limpeza-mvp-2026-05-15\planejamento\PERSONA_STUDIO_SETUP.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| PROGRESSO_FASE_1.md | lixo\limpeza-mvp-2026-05-15\planejamento\PROGRESSO_FASE_1.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| README.md | lixo\limpeza-mvp-2026-05-15\planejamento\README.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| relatorio_avanco_odessa.md | lixo\limpeza-mvp-2026-05-15\planejamento\relatorio_avanco_odessa.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| RELATORIO_EVOLUCAO_ODESSA.md | lixo\limpeza-mvp-2026-05-15\planejamento\RELATORIO_EVOLUCAO_ODESSA.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| TESTING.md | lixo\limpeza-mvp-2026-05-15\planejamento\TESTING.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| UI_UX_DESIGN.md | lixo\limpeza-mvp-2026-05-15\planejamento\UI_UX_DESIGN.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| VIDEO_GUIDE.md | lixo\limpeza-mvp-2026-05-15\planejamento\VIDEO_GUIDE.md | planejamento | Documento Markdown de planejamento/status/documentacao, nao necessario para execucao do runtime MVP. | baixo |
| docs | lixo\limpeza-mvp-2026-05-15\docs-nao-runtime\docs | docs-nao-runtime | Documentacao e fluxogramas auxiliares; o MVP roda com codigo/configs sem depender desta pasta. | medio |
| logs | lixo\limpeza-mvp-2026-05-15\logs\logs | logs | Logs locais de desenvolvimento; nao fazem parte do runtime instalavel. | baixo |
| server\data\logs | lixo\limpeza-mvp-2026-05-15\logs\server\data\logs | logs | Logs persistidos do backend local; nao sao necessarios para build/runtime limpo. | baixo |
| .pytest_cache | lixo\limpeza-mvp-2026-05-15\caches\.pytest_cache | caches | Cache de pytest regeneravel. | baixo |
| .coverage | lixo\limpeza-mvp-2026-05-15\caches\.coverage | caches | Relatorio de cobertura regeneravel. | baixo |
| dist | lixo\limpeza-mvp-2026-05-15\artifacts\dist | artifacts | Build web gerado; sera recriado por npm run build. | baixo |
| artifacts | lixo\limpeza-mvp-2026-05-15\artifacts\artifacts | artifacts | Artefatos e relatorios intermediarios nao-runtime. | baixo |
| scratch | lixo\limpeza-mvp-2026-05-15\scratch\scratch | scratch | Arquivos experimentais e auxiliares soltos. | baixo |
| patch_video.py | lixo\limpeza-mvp-2026-05-15\scratch\patch_video.py | scratch | Script avulso experimental fora do caminho principal de runtime. | medio |
| archive | lixo\limpeza-mvp-2026-05-15\archives\archive | archives | Legado arquivado anteriormente; nao participa da execucao atual. | baixo |
| lixo temporario | lixo\limpeza-mvp-2026-05-15\archives\lixo temporario | archives | Lixeira temporaria anterior consolidada dentro da nova pasta lixo solicitada. | baixo |
| .claude | lixo\limpeza-mvp-2026-05-15\docs-nao-runtime\.claude | docs-nao-runtime | Metadados de ferramenta/assistente, nao necessarios para usuario final executar o MVP. | baixo |
| .jules | lixo\limpeza-mvp-2026-05-15\docs-nao-runtime\.jules | docs-nao-runtime | Metadados de ferramenta/assistente, nao necessarios para usuario final executar o MVP. | baixo |
