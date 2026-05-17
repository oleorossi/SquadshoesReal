import { useState, useMemo } from 'react';
import { useColors } from '@/hooks/useColors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, CaretUpDown as ChevronsUpDown, Plus, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface ColorsMultiSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function ColorsMultiSelect({ value, onChange }: ColorsMultiSelectProps) {
  const { data: colors = [] } = useColors();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const systemColors = useMemo(() =>
    colors.map(c => ({ name: c.nome, hex: c.referencia_hex || '' })),
    [colors]
  );

  const selected = useMemo(() => {
    if (!value) return [] as string[];
    return value.split(',').map(c => c.trim()).filter(Boolean);
  }, [value]);

  const filteredColors = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return systemColors;
    return systemColors.filter(c => c.name.toLowerCase().includes(q));
  }, [systemColors, search]);

  const toggle = (color: string) => {
    const next = selected.includes(color)
      ? selected.filter(c => c !== color)
      : [...selected, color];
    onChange(next.join(', '));
  };

  const addCustom = () => {
    const t = search.trim();
    if (t && !selected.includes(t)) {
      onChange([...selected, t].join(', '));
    }
    setSearch('');
  };

  const remove = (color: string) => {
    onChange(selected.filter(c => c !== color).join(', '));
  };

  const showAddButton = search.trim() && !systemColors.some(c => c.name.toLowerCase() === search.trim().toLowerCase()) && !selected.includes(search.trim());

  const getHex = (name: string) => systemColors.find(c => c.name === name)?.hex || '';

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
            {selected.length > 0 ? `${selected.length} ${selected.length === 1 ? 'cor selecionada' : 'cores selecionadas'}` : 'Selecionar cores...'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
          <Input
            placeholder="Buscar ou digitar nova cor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (showAddButton) addCustom();
              }
            }}
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
                  selected.includes(color.name) && 'bg-accent'
                )}
              >
                <Check className={cn('h-4 w-4 shrink-0', selected.includes(color.name) ? 'opacity-100' : 'opacity-0')} />
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
              <p className="text-sm text-muted-foreground px-2 py-1.5">Nenhuma cor encontrada</p>
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
