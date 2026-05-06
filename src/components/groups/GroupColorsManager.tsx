import { useState, useMemo } from 'react';
import { Palette, Plus, X, Check, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useColors } from '@/hooks/useColors';
import { useGroupColors, useAddGroupColor, useRemoveGroupColor } from '@/hooks/useGroupColors';
import { useProducts } from '@/hooks/useProducts';

interface GroupColorsManagerProps {
  groupId: string;
  groupName: string;
}

export default function GroupColorsManager({ groupId, groupName }: GroupColorsManagerProps) {
  const { data: allColors = [] } = useColors();
  const { data: groupColors = [], isLoading } = useGroupColors(groupId);
  const { data: allProducts = [] } = useProducts();
  const addColor = useAddGroupColor();
  const removeColor = useRemoveGroupColor();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Derive colors from products in this group as fallback
  const productDerivedColors = useMemo(() => {
    const products = allProducts.filter(p => p.group_id === groupId && p.color);
    const uniqueColors = new Map<string, string>();
    products.forEach(p => {
      if (p.color) {
        const key = p.color.trim().toUpperCase();
        if (!uniqueColors.has(key)) {
          uniqueColors.set(key, p.color.trim());
        }
      }
    });
    return Array.from(uniqueColors.values()).sort();
  }, [allProducts, groupId]);

  const linkedColorIds = useMemo(() => new Set(groupColors.map(gc => gc.color_id)), [groupColors]);

  const filteredColors = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = allColors.filter(c => !q || c.nome.toLowerCase().includes(q));
    return list;
  }, [allColors, search]);

  const handleToggle = (colorId: string) => {
    if (linkedColorIds.has(colorId)) {
      const gc = groupColors.find(gc => gc.color_id === colorId);
      if (gc) removeColor.mutate({ id: gc.id, groupId });
    } else {
      addColor.mutate({ groupId, colorId });
    }
  };

  const handleRemove = (gc: typeof groupColors[0]) => {
    removeColor.mutate({ id: gc.id, groupId });
  };

  // Show junction table colors if they exist, otherwise show product-derived colors
  const hasJunctionColors = groupColors.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Cores do Grupo</span>
          <Badge variant="secondary" className="text-xs">
            {hasJunctionColors ? groupColors.length : productDerivedColors.length}
          </Badge>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 h-8">
              <Plus className="h-3.5 w-3.5" />
              Vincular Cor
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="end">
            <div className="flex items-center gap-2 mb-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cor..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {filteredColors.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-3 text-center">Nenhuma cor encontrada</p>
              ) : filteredColors.map(color => {
                const isLinked = linkedColorIds.has(color.id);
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => handleToggle(color.id)}
                    className={cn(
                      'flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors',
                      isLinked && 'bg-primary/5'
                    )}
                  >
                    <Check className={cn('h-4 w-4 shrink-0 text-primary', isLinked ? 'opacity-100' : 'opacity-0')} />
                    {color.referencia_hex ? (
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-border shrink-0 shadow-sm"
                        style={{ backgroundColor: color.referencia_hex }}
                      />
                    ) : (
                      <span className="inline-block h-4 w-4 rounded-full border border-dashed border-muted-foreground/30 shrink-0" />
                    )}
                    <span className="truncate">{color.nome}</span>
                    {color.referencia_pantone && (
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{color.referencia_pantone}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {hasJunctionColors ? (
        <div className="flex flex-wrap gap-1.5">
          {groupColors.map(gc => (
            <Badge
              key={gc.id}
              variant="secondary"
              className="gap-1.5 pr-1 py-1 text-sm"
            >
              {gc.color_hex ? (
                <span
                  className="inline-block h-3 w-3 rounded-full border border-border shrink-0"
                  style={{ backgroundColor: gc.color_hex }}
                />
              ) : (
                <span className="inline-block h-3 w-3 rounded-full border border-dashed border-muted-foreground/30 shrink-0" />
              )}
              {gc.color_name}
              <button
                type="button"
                onClick={() => handleRemove(gc)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : productDerivedColors.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground italic">Cores detectadas dos produtos do grupo:</p>
          <div className="flex flex-wrap gap-1.5">
            {productDerivedColors.map(color => (
              <Badge key={color} variant="outline" className="text-xs py-1">
                {color}
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Nenhuma cor vinculada. Clique em "Vincular Cor" para adicionar.</p>
      )}
    </div>
  );
}
