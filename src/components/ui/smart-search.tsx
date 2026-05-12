import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { MagnifyingGlass as Search, X, Tag, Hash, Stack as Layers } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type SmartSearchField = 'name' | 'sku' | 'category' | 'custom';

export interface SmartSearchSuggestion {
  /** Tipo da sugestão — define o ícone e o agrupamento */
  field: SmartSearchField;
  /** Texto exibido (e que vai para o campo ao selecionar) */
  value: string;
  /** Texto secundário opcional (ex: "12 itens") */
  meta?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Callback ao selecionar uma sugestão (default: aplica como busca) */
  onSelect?: (suggestion: SmartSearchSuggestion) => void;
  /** Função que gera sugestões a partir do termo digitado */
  getSuggestions: (term: string) => SmartSearchSuggestion[] | Promise<SmartSearchSuggestion[]>;
  placeholder?: string;
  className?: string;
  /** Debounce em ms (default 200) */
  debounceMs?: number;
  /** Limite de sugestões por grupo */
  limitPerGroup?: number;
}

const FIELD_LABEL: Record<SmartSearchField, string> = {
  name: 'Nome',
  sku: 'SKU',
  category: 'Categoria',
  custom: 'Outros',
};

const FIELD_ICON: Record<SmartSearchField, typeof Tag> = {
  name: Tag,
  sku: Hash,
  category: Layers,
  custom: Search,
};

/**
 * Campo de busca único com sugestões agrupadas por tipo (Nome, SKU, Categoria).
 * A digitação atualiza `value` em tempo real (busca livre);
 * o popover mostra sugestões debounced que o usuário pode clicar.
 */
function SmartSearchInner({
  value,
  onChange,
  onSelect,
  getSuggestions,
  placeholder = 'Buscar por nome, SKU, categoria…',
  className,
  debounceMs = 200,
  limitPerGroup = 5,
}: Props) {
  const [open, setOpen] = useState(false);
  const [debouncedValue] = useDebounce(value, debounceMs);
  const [suggestions, setSuggestions] = useState<SmartSearchSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const term = debouncedValue.trim();
    if (term.length === 0) {
      setSuggestions([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    Promise.resolve(getSuggestions(term)).then((s) => {
      if (reqId !== reqIdRef.current) return;
      // Deduplicação interna por field:value (segura mesmo quando o consumidor esquece)
      const seen = new Set<string>();
      const unique: SmartSearchSuggestion[] = [];
      for (const item of s || []) {
        const key = `${item.field}:${item.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
      }
      setSuggestions(unique);
    }).catch(() => {
      if (reqId === reqIdRef.current) setSuggestions([]);
    });
  }, [debouncedValue, getSuggestions]);

  // Agrupa sugestões por field, mantendo ordem
  const grouped = useMemo(() => {
    const map = new Map<SmartSearchField, SmartSearchSuggestion[]>();
    for (const s of suggestions) {
      const arr = map.get(s.field) ?? [];
      if (arr.length < limitPerGroup) arr.push(s);
      map.set(s.field, arr);
    }
    return Array.from(map.entries());
  }, [suggestions, limitPerGroup]);

  const flatList = useMemo(
    () => grouped.flatMap(([, arr]) => arr),
    [grouped],
  );

  const handleSelect = (s: SmartSearchSuggestion) => {
    if (onSelect) onSelect(s);
    else onChange(s.value);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || flatList.length === 0) {
      if (e.key === 'Escape' && value) {
        e.preventDefault();
        onChange('');
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flatList.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? flatList.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(flatList[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  const showPopover = open && value.trim().length > 0 && flatList.length > 0;

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className={cn('relative', className)}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="pl-9 pr-9"
            autoComplete="off"
          />
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0 w-[--radix-popover-trigger-width] max-h-[400px] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {grouped.map(([field, items]) => {
          const Icon = FIELD_ICON[field];
          return (
            <div key={field}>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 sticky top-0">
                <Icon className="h-3 w-3" />
                {FIELD_LABEL[field]}
              </div>
              {items.map((s) => {
                const flatIdx = flatList.indexOf(s);
                const isActive = flatIdx === activeIdx;
                return (
                  <button
                    key={`${s.field}:${s.value}`}
                    type="button"
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                    onClick={() => handleSelect(s)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-muted/60 transition-colors',
                      isActive && 'bg-muted/60',
                    )}
                  >
                    <span className="truncate">{s.value}</span>
                    {s.meta && (
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">{s.meta}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/**
 * SmartSearch é memoizado para evitar re-renderizações quando o consumidor passa
 * o mesmo `value`/callbacks. Para máxima eficiência, envolva `getSuggestions` em
 * `useCallback` e mantenha índices precomputados em `useMemo`.
 */
export const SmartSearch = memo(SmartSearchInner);
SmartSearch.displayName = 'SmartSearch';

export default SmartSearch;