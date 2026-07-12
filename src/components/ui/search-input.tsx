import * as React from 'react';
import { MagnifyingGlass as Search, X } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * SearchInput — barra de busca PADRÃO do sistema (spec melhorias-busca-sistema).
 *
 * Toda busca de tela/dialog usa este componente com `searchMatchesAllTerms`
 * (filtro local) ou `searchNormOrFilter` (server-side). Provê:
 * - lupa + botão × pra limpar (só com texto);
 * - placeholder específico por tela ("Buscar por referência, cliente, cor…");
 * - hint do refinamento (espaço/"/" = termos AND) no ícone da lupa;
 * - contador "N de M" quando `totalCount` é passado e há query ativa;
 * - debounce opcional (`debounceMs` — use ~300 pra busca server-side);
 * - atalho global "/" foca a busca visível mais recente (dialogs têm prioridade
 *   por montarem depois). Dentro de um campo editável, "/" é caractere normal.
 */

const HINT_TEXT =
  'Espaço ou "/" combinam termos: "stx alcineu" acha o registro que contém os dois. ' +
  'Acentos, maiúsculas e pontuação são ignorados.';

// ── Atalho "/" ──────────────────────────────────────────────────────────────
// Registry módulo-level: cada SearchInput montado (sem disableSlashFocus) entra
// aqui; o listener único foca o ÚLTIMO registrado que esteja visível — dialogs
// montam por último, então ganham do fundo da tela, que é o esperado.
const slashTargets: HTMLInputElement[] = [];
let slashListenerAttached = false;

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function handleSlashKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isEditableTarget(e.target)) return;
  for (let i = slashTargets.length - 1; i >= 0; i--) {
    const el = slashTargets[i];
    // offsetParent === null ⇒ escondido (display:none / aba inativa)
    if (el.isConnected && el.offsetParent !== null) {
      e.preventDefault();
      el.focus();
      el.select();
      return;
    }
  }
}

function registerSlashTarget(el: HTMLInputElement) {
  slashTargets.push(el);
  if (!slashListenerAttached) {
    document.addEventListener('keydown', handleSlashKey);
    slashListenerAttached = true;
  }
  return () => {
    const idx = slashTargets.indexOf(el);
    if (idx >= 0) slashTargets.splice(idx, 1);
    if (slashTargets.length === 0 && slashListenerAttached) {
      document.removeEventListener('keydown', handleSlashKey);
      slashListenerAttached = false;
    }
  };
}

export interface SearchInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onKeyDown' | 'onFocus'> {
  value: string;
  onChange: (value: string) => void;
  /** Diga O QUE a tela busca: "Buscar por referência, cliente, cor…" */
  placeholder?: string;
  /** Resultados após o filtro — exibe "N de M" junto com totalCount. */
  resultCount?: number;
  /** Total sem filtro — exibe "N de M" quando há query ativa. */
  totalCount?: number;
  /** Debounce do onChange em ms. 0 = imediato (filtro local); ~300 p/ server. */
  debounceMs?: number;
  /** Esconde o tooltip de dica do refinamento. */
  hideHint?: boolean;
  /** Não participa do atalho global "/" (raro — buscas secundárias). */
  disableSlashFocus?: boolean;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  'aria-label'?: string;
  id?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Buscar…',
      resultCount,
      totalCount,
      debounceMs = 0,
      hideHint = false,
      disableSlashFocus = false,
      className,
      inputClassName,
      autoFocus,
      onKeyDown,
      onFocus,
      id,
      'aria-label': ariaLabel,
      // rest vai pro wrapper div — necessário p/ composição via Slot/asChild
      // (ex.: SmartSearch embrulha em PopoverTrigger, que injeta handlers).
      ...rest
    },
    forwardedRef,
  ) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    // Estado local pro debounce: a digitação atualiza `local` na hora; o
    // onChange do consumidor dispara depois de `debounceMs`.
    const [local, setLocal] = React.useState(value);
    React.useEffect(() => setLocal(value), [value]);
    React.useEffect(() => {
      if (!debounceMs || local === value) return;
      const t = setTimeout(() => onChange(local), debounceMs);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [local, debounceMs]);

    const handleChange = (v: string) => {
      setLocal(v);
      if (!debounceMs) onChange(v);
    };

    const clear = () => {
      setLocal('');
      onChange(''); // limpar não espera debounce
      inputRef.current?.focus();
    };

    React.useEffect(() => {
      if (disableSlashFocus) return;
      const el = inputRef.current;
      if (!el) return;
      return registerSlashTarget(el);
    }, [disableSlashFocus]);

    const showCounter = totalCount != null && local.trim().length > 0;

    return (
      <div className={cn('relative', className)} {...rest}>
        {hideHint ? (
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
          />
        ) : (
          /* Provider próprio: o componente precisa funcionar também fora do
             TooltipProvider global (testes isolados, portais). Aninhar é ok. */
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={-1}
                  aria-label="Dica de busca"
                  className="absolute left-3 top-1/2 -translate-y-1/2 cursor-help"
                >
                  <Search aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[280px] text-xs">
                {HINT_TEXT}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Input
          ref={inputRef}
          id={id}
          value={local}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            // Consumidor primeiro (ex.: SmartSearch fecha o popover com Esc);
            // se ele tratou (preventDefault), não limpamos por cima.
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Escape' && local) {
              e.preventDefault();
              e.stopPropagation();
              clear();
            }
          }}
          onFocus={onFocus}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-label={ariaLabel ?? placeholder}
          className={cn(
            'pl-9',
            showCounter ? 'pr-[6.5rem]' : local ? 'pr-9' : 'pr-3',
            inputClassName,
          )}
        />
        {showCounter && (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted-foreground whitespace-nowrap"
          >
            {(resultCount ?? 0).toLocaleString('pt-BR')} de {totalCount.toLocaleString('pt-BR')}
          </span>
        )}
        {local && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Limpar busca"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';
