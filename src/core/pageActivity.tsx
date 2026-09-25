/**
 * pageActivity — diz a um componente se a página (aba) dele está visível.
 *
 * O shell mantém as páginas já visitadas montadas e só esconde as inativas,
 * para a troca de aba ser instantânea e preservar estado (rolagem, subaba,
 * rascunhos). Em troca, tudo que consome recurso numa página escondida precisa
 * parar: polling (o `usePolling` já consulta este contexto sozinho), players de
 * vídeo (seguram conexões HTTP/1.1) e atalhos de teclado globais.
 *
 * Fora de um provider o valor é `true` — componentes usados sem o shell (testes,
 * overlay do OBS) continuam funcionando como antes.
 */
import { createContext, useContext, type ReactNode } from 'react';

const PageActivityContext = createContext(true);

export function PageActivity({ active, children }: { active: boolean; children: ReactNode }) {
  return <PageActivityContext.Provider value={active}>{children}</PageActivityContext.Provider>;
}

/** `true` quando a página que contém o componente está visível. */
export function usePageActive(): boolean {
  return useContext(PageActivityContext);
}
