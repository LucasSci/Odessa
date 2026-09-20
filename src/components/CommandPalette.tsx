import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { filterCommands, type PaletteCommand } from '../core/commandPalette';
import { cn } from '../lib/utils';
import { useModalFocus } from '../core/useModalFocus';

/**
 * Paleta de comandos (Ctrl+K): busca única para navegar, pôr um clip no ar,
 * trocar a cena do OBS, ligar a voz etc. — sem procurar em abas.
 */
export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  useModalFocus(dialogRef, open, 'input');

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [index, results]);

  if (!open) return null;

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    void Promise.resolve(command.run()).catch((err) => console.warn('[palette] comando falhou', err));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[index]);
    }
  };

  let lastGroup = '';
  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border2)] bg-[var(--bg2)] shadow-[var(--shadow-3)]"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border2)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[var(--t3)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar comando, clip, cena…"
            aria-label="Buscar comando"
            aria-controls="command-palette-list"
            role="combobox"
            aria-expanded="true"
            aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
            className="w-full bg-transparent text-sm text-[var(--t1)] outline-none placeholder:text-[var(--t3)]"
          />
          <kbd className="rounded bg-[var(--bg4)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--t3)]">Esc</kbd>
        </div>
        <ul id="command-palette-list" ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-xs text-[var(--t3)]">Nada encontrado para “{query}”.</li>}
          {results.map((command, i) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <li key={command.id} role="presentation">
                {showGroup && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--t3)]">{command.group}</div>
                )}
                <div
                  id={`cmd-${command.id}`}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(command)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm',
                    i === index ? 'bg-[var(--sky)]/15 text-[var(--t1)]' : 'text-[var(--t2)]',
                  )}
                >
                  <span className="min-w-0 truncate">{command.title}</span>
                  {command.hint && <span className="shrink-0 font-mono text-[10px] text-[var(--t3)]">{command.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-3 border-t border-[var(--border2)] px-4 py-2 text-[10px] text-[var(--t3)]">
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">Enter</kbd> executar</span>
          <span className="ml-auto">{results.length} resultado(s)</span>
        </div>
      </div>
    </div>
  );
}
