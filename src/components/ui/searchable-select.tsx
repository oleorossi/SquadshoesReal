import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, CaretUpDown as ChevronsUpDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

export interface SearchableOption {
  value: string;
  label: string;
  /** Linha secundária (cinza) no item e no trigger. */
  description?: string;
  /** Texto extra pra busca (código, sinônimos…), não exibido. */
  keywords?: string;
}

export interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Ícone à esquerda do placeholder (quando nada selecionado). */
  icon?: ReactNode;
  /** Heading do grupo; omitir = sem heading. A contagem vive na faixa de busca. */
  heading?: string;
  /** Rótulo curto da faixa de localização acima da busca. */
  searchLabel?: string;
  /** Nome acessível do gatilho; por padrão usa o placeholder. */
  'aria-label'?: string;
}

/**
 * Seletor genérico COM BUSCA (Command + Popover), acento/caixa-insensível via
 * normalizeForSearch. Espelha o padrão do EmployeeCombobox/ColorLookupSelect pra
 * qualquer lista de opções {value,label,description}. Use no lugar de <Select>
 * quando a lista for grande o suficiente pra justificar digitar e filtrar.
 */
export function SearchableSelect({
  value, onChange, options,
  placeholder = 'Selecione...', searchPlaceholder = 'Buscar...', emptyText = 'Nada encontrado.',
  disabled, className, icon, heading, searchLabel = 'Localizar opção', 'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => options.find(o => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    // Motor padrão do sistema: espaço/"/" = termos AND, OR entre campos.
    return options.filter(o => searchMatchesAllTerms(search, o.label, o.description, o.keywords));
  }, [options, search]);

  // Teto de renderização: com catálogos de centenas de itens, montar tudo de
  // uma vez trava a abertura do popover — o refino vem da busca, não do scroll.
  const RENDER_CAP = 100;
  const visible = filtered.length > RENDER_CAP ? filtered.slice(0, RENDER_CAP) : filtered;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          aria-label={ariaLabel ?? placeholder}
          className={cn('h-11 w-full justify-between text-sm font-normal md:h-9', className)}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              {/* title: recurso de hover pra ler o dado completo quando truncar */}
              <span className="truncate" title={selected.label}>{selected.label}</span>
              {selected.description && (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline" title={selected.description}>{selected.description}</span>
              )}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              {icon}<span className="truncate">{placeholder}</span>
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[260px] p-0" align="start">
        <Command shouldFilter={false} label={searchPlaceholder}>
          <div className="flex items-center justify-between gap-3 border-b border-foreground/10 bg-muted-soft px-2.5 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{searchLabel}</span>
            <span aria-live="polite" className="shrink-0 tabular-nums">
              {search ? `${filtered.length} de ` : ''}{options.length.toLocaleString('pt-BR')}
            </span>
          </div>
          <CommandInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup heading={heading}>
              {visible.map(o => (
                <CommandItem
                  key={o.value} value={o.value}
                  onSelect={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                  className="gap-2"
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm" title={o.label}>{o.label}</span>
                    {o.description && <span className="truncate text-xs text-muted-foreground" title={o.description}>{o.description}</span>}
                  </div>
                </CommandItem>
              ))}
              {filtered.length > RENDER_CAP && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Mostrando {RENDER_CAP} de {filtered.length} — digite pra refinar
                </div>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
