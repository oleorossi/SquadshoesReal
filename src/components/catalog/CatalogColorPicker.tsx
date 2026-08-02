import { useMemo, useState } from 'react';
import { Plus, Check, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CatalogColor, useAddCatalogColor, useDeleteCatalogColor } from '@/hooks/useCatalogColors';

interface Props {
  colors: CatalogColor[];
  selectedIds: Set<string>;
  onToggle: (color: CatalogColor) => void;
}

/**
 * Cartela de cores do catálogo: swatches agrupados (4 linhas do seed +
 * "Minhas cores"), seleção múltipla e cadastro inline de cor nova.
 */
export function CatalogColorPicker({ colors, selectedIds, onToggle }: Props) {
  const [newName, setNewName] = useState('');
  const [newHex, setNewHex] = useState('#88AA77');
  const addColor = useAddCatalogColor();
  const deleteColor = useDeleteCatalogColor();

  const groups = useMemo(() => {
    const map = new Map<string, CatalogColor[]>();
    for (const c of colors) {
      const key = c.grupo || 'Minhas cores';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()];
  }, [colors]);

  return (
    <div className="space-y-4">
      {groups.map(([grupo, items]) => (
        <div key={grupo}>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">{grupo}</p>
          <div className="flex flex-wrap gap-2">
            {items.map((color) => {
              const selected = selectedIds.has(color.id);
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => onToggle(color)}
                  className={cn(
                    'group relative w-[104px] rounded-lg border p-1.5 text-center transition-colors',
                    selected
                      ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                      : 'border-border bg-card hover:border-primary/50',
                  )}
                  title={`${color.nome} ${color.hex}`}
                >
                  <span
                    className="block h-9 rounded-md border border-border/60"
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="mt-1 block truncate text-[10.5px] font-semibold leading-tight">
                    {color.nome}
                  </span>
                  <span className="block text-[9px] text-muted-foreground">{color.hex}</span>
                  {selected && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" weight="bold" />
                    </span>
                  )}
                  {(color.grupo || 'Minhas cores') === 'Minhas cores' && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="absolute -left-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selected) onToggle(color);
                        deleteColor.mutate(color.id);
                      }}
                      title="Remover da cartela"
                    >
                      <X className="h-3 w-3" weight="bold" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
        <div className="space-y-1">
          <Label htmlFor="nova-cor-nome" className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Nova cor
          </Label>
          <Input
            id="nova-cor-nome"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ex.: VERDE MENTA"
            className="h-8 w-44"
          />
        </div>
        <input
          type="color"
          aria-label="Escolher tonalidade"
          value={newHex}
          onChange={(e) => setNewHex(e.target.value.toUpperCase())}
          className="h-8 w-12 cursor-pointer rounded-md border border-border bg-card p-0.5"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={addColor.isPending || !newName.trim()}
          onClick={() =>
            addColor.mutate(
              { nome: newName, hex: newHex },
              { onSuccess: () => setNewName('') },
            )
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
    </div>
  );
}
