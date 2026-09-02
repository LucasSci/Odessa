"""
video_gen — Pipeline de geração de vídeo em tempo real para a live.

Fluxo: interações de chat (mensagens + gatilhos) alimentam um buffer de
prompts -> o prompt gera um vídeo usando o último frame do vídeo em reprodução
como imagem base -> o vídeo gerado é organizado na fila e registrado no fluxo
da persona ativa.

Módulos:
- base: interface VideoGenProvider + VideoGenResult
- registry: fábrica de provedores por VIDEO_GEN_PROVIDER
- providers: implementações concretas (placeholder, routellm)
- storage: persistência por persona (prompts, frames, vídeos, fila, histórico)
- prompt_service: buffer de interações + geração de prompt via RouteLLM
- video_gen_service: orquestrador (prompt + frame -> provedor -> fila -> fluxo)
"""
