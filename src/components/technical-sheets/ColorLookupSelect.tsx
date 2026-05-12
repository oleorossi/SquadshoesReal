import { useState, useMemo } from 'react';
import { useColors, useAddColor, useColorStock, Color } from '@/hooks/useColors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, CaretUpDown as ChevronsUpDown, Plus, Circle, Warning as AlertTriangle, Package } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ColorLookupSelectProps {
  label: string;
  value: string | null; // color id
  onChange: (colorId: string | null) => void;
  required?: boolean;
}

function StockIndicator({ colorId }: { colorId: string | null }) {
  const { data: stock } = useColorStock(colorId);
  if (!colorId || !stock) return null;

  const level = stock.totalStock > 100 ? 'ok' : stock.totalStock > 0 ? 'low' : 'none';
  const colorClass = level === 'ok' ? 'text-green-500' : level === 'low' ? 'text-amber-500' : 'text-destructive';
  const bgClass = level === 'ok' ? 'bg-green-500/10' : level === 'low' ? 'bg-amber-500/10' : 'bg-destructive/10';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('text-[10px] gap-1 cursor-help', bgClass, colorClass)}>
            <Circle className={cn('h-2 w-2 fill-current')} />
            {stock.totalStock.toLocaleString('pt-BR')} un
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="text-xs font-semibold">Estoque: {stock.colorName}</p>
            {Object.entries(stock.byCategory).map(([cat, qty]) => (
              <div key={cat} className="flex justify-between text-xs gap-4">
                <span className="text-muted-foreground">{cat}:</span>
                <span className="font-mono">{(qty as number).toLocaleString('pt-BR')}</span>
              </div>
            ))}
            {stock.totalStock === 0 && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Sem estoque disponível
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ColorLookupSelect({ label, value, onChange, required }: ColorLookupSelectProps) {
  const { data: colors = [] } = useColors();
  const addColor = useAddColor();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('');

  const selectedColor = useMemo(() => colors.find(c => c.id === value), [colors, value]);

  const filtered = useMemo(() => {
    if (!search.trim()) return colors;
    const q = search.toLowerCase();
    return colors.filter(c =>
      c.nome.toLowerCase().includes(q) ||
      c.cor_id.toLowerCase().includes(q) ||
      c.referencia_hex?.toLowerCase().includes(q) ||
      c.referencia_pantone?.toLowerCase().includes(q)
    );
  }, [colors, search]);

  const handleAddColor = async () => {
    if (!newColorName.trim()) return;
    const result = await addColor.mutateAsync({
      nome: newColorName.trim(),
      referencia_hex: newColorHex.trim(),
      referencia_pantone: '',
      imagem_swatch: '',
      acabamento_disponivel: [],
      materiais_compativeis: [],
      status: 'ativo',
    });
    if (result) {
      onChange(result.id);
      setShowAddDialog(false);
      setNewColorName('');
      setNewColorHex('');
    }
  };

  const isHexValid = (hex: string) => !hex || /^#([A-Fa-f0-9]{6})$/.test(hex);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}{required && ' *'}</Label>
      <div className="flex items-center gap-2 mt-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="h-9 flex-1 justify-between text-sm font-normal">
              {selectedColor ? (
                <div className="flex items-center gap-2">
                  {selectedColor.referencia_hex && (
                    <span className="h-4 w-4 rounded-full border shrink-0" style={{ backgroundColor: selectedColor.referencia_hex }} />
                  )}
                  <span>{selectedColor.nome}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{selectedColor.cor_id}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Selecionar cor...</span>
              )}
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[350px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Buscar cor..." value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>Nenhuma cor encontrada</CommandEmpty>
                <CommandGroup heading={`Cores disponíveis (${filtered.length})`}>
                  {filtered.map(c => (
                    <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c.id); setOpen(false); setSearch(''); }}>
                      <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                      <div className="flex items-center gap-2 flex-1">
                        {c.referencia_hex && (
                          <span className="h-4 w-4 rounded-full border shrink-0" style={{ backgroundColor: c.referencia_hex }} />
                        )}
                        <div className="flex flex-col">
                          <span className="text-sm">{c.nome}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {c.cor_id}
                            {c.referencia_hex && ` • ${c.referencia_hex}`}
                            {c.referencia_pantone && ` • ${c.referencia_pantone}`}
                          </span>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
              <div className="border-t p-2">
                <Button variant="ghost" size="sm" className="w-full gap-1.5 text-xs" onClick={() => { setShowAddDialog(true); setOpen(false); }}>
                  <Plus className="h-3.5 w-3.5" /> Nova Cor
                </Button>
              </div>
            </Command>
          </PopoverContent>
        </Popover>

        <StockIndicator colorId={value} />

        {value && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => onChange(null)}>
            ✕
          </Button>
        )}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Cor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Nome da Cor *</Label>
              <Input value={newColorName} onChange={e => setNewColorName(e.target.value)} className="mt-1" placeholder="Ex: Bridal, Preto, Caramelo" />
            </div>
            <div>
              <Label className="text-xs">Referência HEX</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value={newColorHex} onChange={e => setNewColorHex(e.target.value)} className="flex-1 font-mono" placeholder="#000000" />
                {newColorHex && isHexValid(newColorHex) && (
                  <span className="h-8 w-8 rounded-md border shrink-0" style={{ backgroundColor: newColorHex }} />
                )}
              </div>
              {newColorHex && !isHexValid(newColorHex) && (
                <p className="text-xs text-destructive mt-1">Formato HEX inválido. Use #RRGGBB.</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleAddColor} disabled={!newColorName.trim() || addColor.isPending || (!!newColorHex && !isHexValid(newColorHex))}>
                Criar Cor
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
