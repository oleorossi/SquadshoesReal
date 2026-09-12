import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { MagnifyingGlass as Search, Tag, Hash, Stack as Layers, FolderOpen } from '@phosphor-icons/react';
import { SearchInput } from '@/components/ui/search-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HighlightMatch } from '@/components/ui/highlight-match';
import { rankBySearchScore } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';

export type SmartSearchField = 'group' | 'name' | 'sku' | 'category' | 'custom';

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
  /** Enter no texto digitado (nada destacado): fecha a caixinha e confirma a busca. */
  onCommit?: (term: string) => void;
  /** Função que gera sugestões a partir do termo digitado */
  getSuggestions: (term: string) => SmartSearchSuggestion[] | Promise<SmartSearchSuggestion[]>;
  placeholder?: string;
  className?: string;
  /** Debounce em ms (default 200) */
  debounceMs?: number;
  /** Limite de sugestões por grupo */
  limitPerGroup?: number;
  /** Sobrescreve o rótulo da seção (ex.: Cliente no lugar de Nome). */
  fieldLabels?: Partial<Record<SmartSearchField, string>>;
}

const FIELD_ORDER: SmartSearchField[] = ['group', 'sku', 'name', 'category', 'custom'];

const FIELD_LABEL: Record<SmartSearchField, string> = {
  group: 'Grupo',
  name: 'Nome',
  sku: 'SKU',
  category: 'Categoria',
  custom: 'Outros',
};

const FIELD_ICON: Record<SmartSearchField, typeof Tag> = {
  group: FolderOpen,
  name: Tag,
  sku: Hash,
  category: Layers,
  custom: Search,
};

/**
 * Campo de busca único com sugestões agrupadas por tipo (Grupo, SKU, Nome, Categoria).
 * A digitação atualiza `value` em tempo real (busca livre);
 * o popover mostra sugestões debounced que o usuário pode clicar.
 * Enter sem sugestão destacada fecha a caixinha e confirma o termo digitado.
 */
function SmartSearchInner({
  value,
  onChange,
  onSelect,
  onCommit,
  getSuggestions,
  placeholder = 'Buscar por nome, SKU, categoria…',
  className,
  debounceMs = 200,
  limitPerGroup = 5,
  fieldLabels,
}: Props) {
  const [open, setOpen] = useState(false);
  const [debouncedValue] = useDebounce(value, debounceMs);
  const [suggestions, setSuggestions] = useState<SmartSearchSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);
  // Após selecionar uma sugestão (ou confirmar com Enter), suprime a reabertura
  // do popover pelo re-foco programático — só a próxima alteração de texto reabre.
  const suppressOpenRef = useRef(false);

  useEffect(() => {
    const term = debouncedValue.trim();
    if (term.length === 0) {
      setSuggestions([]);
      return;
    }
    const reqId = ++reqIdRef.current;
    Promise.resolve(getSuggestions(term)).then((s) => {
      if (reqId !== reqIdRef.current) return;
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

  const grouped = useMemo(() => {
    const map = new Map<SmartSearchField, SmartSearchSuggestion[]>();
    for (const s of suggestions) {
      const arr = map.get(s.field) ?? [];
      arr.push(s);
      map.set(s.field, arr);
    }
    const result: Array<[SmartSearchField, SmartSearchSuggestion[]]> = [];
    const seen = new Set<SmartSearchField>();
    for (const field of FIELD_ORDER) {
      const arr = map.get(field);
      if (!arr?.length) continue;
      seen.add(field);
      const ranked = rankBySearchScore(arr, debouncedValue, (item) => item.value);
      result.push([field, ranked.slice(0, limitPerGroup)]);
    }
    for (const [field, arr] of map) {
      if (seen.has(field) || !arr.length) continue;
      const ranked = rankBySearchScore(arr, debouncedValue, (item) => item.value);
      result.push([field, ranked.slice(0, limitPerGroup)]);
    }
    return result;
  }, [suggestions, limitPerGroup, debouncedValue]);

  const flatList = useMemo(
    () => grouped.flatMap(([, arr]) => arr),
    [grouped],
  );

  const closeAndKeepFocus = () => {
    setOpen(false);
    setActiveIdx(-1);
    suppressOpenRef.current = true;
    inputRef.current?.focus();
  };

  const handleSelect = (s: SmartSearchSuggestion) => {
    if (onSelect) onSelect(s);
    else onChange(s.value);
    closeAndKeepFocus();
  };

  const handleCommit = () => {
    onCommit?.(value);
    closeAndKeepFocus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!open || flatList.length === 0) return;
      e.preventDefault();
      if (activeIdx >= 0) handleSelect(flatList[activeIdx]);
      else handleCommit();
      return;
    }
    if (!open || flatList.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flatList.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? flatList.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  const showPopover = open && value.trim().length > 0 && flatList.length > 0;
  const labelOf = (field: SmartSearchField) => fieldLabels?.[field] || FIELD_LABEL[field];

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <SearchInput
          ref={inputRef}
          className={className}
          value={value}
          onChange={(v) => { suppressOpenRef.current = false; onChange(v); setOpen(true); setActiveIdx(-1); }}
          onFocus={() => { if (!suppressOpenRef.current) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0 w-[--radix-popover-trigger-width] max-h-[400px] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {grouped.map(([field, items]) => {
          const Icon = FIELD_ICON[field] ?? Search;
          return (
            <div key={field}>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-foreground/80 uppercase tracking-wide bg-muted border-b border-border/60 sticky top-0">
                <Icon className="h-3.5 w-3.5" />
                {labelOf(field)}
              </div>
              {items.map((s) => {
                const flatIdx = flatList.indexOf(s);
                const isActive = flatIdx === activeIdx;
                const RowIcon = FIELD_ICON[s.field] ?? Search;
                return (
                  <button
                    key={`${s.field}:${s.value}`}
                    type="button"
                    onMouseEnter={() => setActiveIdx(flatIdx)}
                    onClick={() => handleSelect(s)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted/60 transition-colors',
                      isActive && 'bg-muted/60',
                    )}
                    title={s.value}
                  >
                    <RowIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate min-w-0 flex-1">
                      <HighlightMatch text={s.value} term={value} />
                    </span>
                    {s.meta && (
                      <span className="text-xs text-muted-foreground ml-2 shrink-0 truncate max-w-[45%]">
                        <HighlightMatch text={s.meta} term={value} />
                      </span>
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
