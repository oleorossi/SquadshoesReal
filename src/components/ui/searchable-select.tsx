import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, CaretUpDown as ChevronsUpDown } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';

export interface SearchableOption {
  value: string;
  label: string;
  /** Linha secundária (cinza) no item e no trigger. */
  description?: string;
  /** Texto extra pra busca (código, sinônimos…), não exibido. */
  keywords?: string;
}

interface SearchableSelectProps {
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
  /** Heading do grupo (mostra a contagem filtrada); omitir = sem heading. */
  heading?: string;
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
  disabled, className, icon, heading,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = useMemo(() => options.find(o => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = normalizeForSearch(search);
    return options.filter(o =>
      normalizeForSearch(o.label).includes(q) ||
      normalizeForSearch(o.description ?? '').includes(q) ||
      normalizeForSearch(o.keywords ?? '').includes(q),
    );
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
          className={cn('h-9 w-full justify-between text-sm font-normal', className)}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{selected.label}</span>
              {selected.description && (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{selected.description}</span>
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
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup heading={heading ? `${heading} (${filtered.length})` : undefined}>
              {visible.map(o => (
                <CommandItem
                  key={o.value} value={o.value}
                  onSelect={() => { onChange(o.value); setOpen(false); setSearch(''); }}
                  className="gap-2"
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{o.label}</span>
                    {o.description && <span className="truncate text-xs text-muted-foreground">{o.description}</span>}
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
