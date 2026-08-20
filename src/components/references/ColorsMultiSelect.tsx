import { useState, useMemo } from 'react';
import { useColors } from '@/hooks/useColors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, CaretUpDown as ChevronsUpDown, Plus, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

interface ColorsMultiSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Cores que já existem no grupo e não podem ser escolhidas novamente. */
  excluded?: string[];
  placeholder?: string;
}

const normalizeColor = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

export function ColorsMultiSelect({ value, onChange, excluded = [], placeholder = 'Selecionar cores…' }: ColorsMultiSelectProps) {
  const { data: colors = [] } = useColors();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const systemColors = useMemo(() =>
    colors.map(c => ({ name: c.nome, hex: c.referencia_hex || '' })),
    [colors]
  );
  const excludedNames = useMemo(() => new Set(excluded.map(normalizeColor)), [excluded]);
  const availableColors = useMemo(
    () => systemColors.filter((color) => !excludedNames.has(normalizeColor(color.name))),
    [excludedNames, systemColors],
  );

  const selected = useMemo(() => {
    if (!value) return [] as string[];
    return value.split(',').map(c => c.trim()).filter(Boolean);
  }, [value]);

  const filteredColors = useMemo(() => {
    if (!search.trim()) return availableColors;
    return availableColors.filter(c => searchMatchesAllTerms(search, c.name));
  }, [availableColors, search]);

  const toggle = (color: string) => {
    const isSelected = selected.some((candidate) => normalizeColor(candidate) === normalizeColor(color));
    const next = isSelected
      ? selected.filter(c => normalizeColor(c) !== normalizeColor(color))
      : [...selected, color];
    onChange(next.join(', '));
  };

  const addCustom = () => {
    const t = search.trim().toUpperCase();
    if (t && !excludedNames.has(normalizeColor(t)) && !selected.some((candidate) => normalizeColor(candidate) === normalizeColor(t))) {
      onChange([...selected, t].join(', '));
    }
    setSearch('');
  };

  const remove = (color: string) => {
    onChange(selected.filter(c => c !== color).join(', '));
  };

  const searchedName = normalizeColor(search);
  const searchIsExcluded = Boolean(searchedName && excludedNames.has(searchedName));
  const showAddButton = Boolean(
    search.trim()
    && !searchIsExcluded
    && !systemColors.some(c => normalizeColor(c.name) === searchedName)
    && !selected.some((candidate) => normalizeColor(candidate) === searchedName),
  );

  const getHex = (name: string) => systemColors.find(c => normalizeColor(c.name) === normalizeColor(name))?.hex || '';

  return (
    <div className="mt-1 space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(color => {
            const hex = getHex(color);
            return (
              <Badge key={color} variant="secondary" className="gap-1.5 pr-1">
                {hex && (
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: hex }}
                  />
                )}
                {color}
                <button type="button" onClick={() => remove(color)} className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {selected.length > 0 ? `${selected.length} ${selected.length === 1 ? 'cor selecionada' : 'cores selecionadas'}` : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <SearchInput
            placeholder="Buscar ou digitar nova cor…"
            value={search}
            onChange={setSearch}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (showAddButton) addCustom();
              }
            }}
            resultCount={filteredColors.length}
            totalCount={availableColors.length}
            className="mb-2"
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filteredColors.map(color => (
              <button
                key={color.name}
                type="button"
                onClick={() => toggle(color.name)}
                className={cn(
                  'flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer',
                selected.some((candidate) => normalizeColor(candidate) === normalizeColor(color.name)) && 'bg-accent'
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', selected.some((candidate) => normalizeColor(candidate) === normalizeColor(color.name)) ? 'opacity-100' : 'opacity-0')} />
                {color.hex && (
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                )}
                {color.name}
              </button>
            ))}
            {filteredColors.length === 0 && !showAddButton && (
              searchIsExcluded ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">“{search.trim()}” já possui item neste grupo.</p>
              ) : search.trim() ? (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <p className="text-sm text-muted-foreground truncate">Nenhum resultado para "{search}"</p>
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs shrink-0" onClick={() => setSearch('')}>
                    Limpar busca
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground px-2 py-1.5">Nenhuma cor encontrada</p>
              )
            )}
            {showAddButton && (
              <button
                type="button"
                onClick={addCustom}
                className="flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-primary cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Adicionar "{search.trim()}"
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
