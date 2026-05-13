import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyInput } from '@/components/ui/currency-input';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { X, Plus } from '@phosphor-icons/react';
import { ProductFormData, UNITS, LOCATIONS } from '@/types/inventory';
import { deriveCategoryFromGroup } from '@/lib/categoryFromGroup';
import { useGroups } from '@/hooks/useGroups';

interface BatchColorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (items: ProductFormData[]) => void;
}

export function BatchColorDialog({ open, onOpenChange, onSubmit }: BatchColorDialogProps) {
  const { data: groups = [] } = useGroups();
  const [baseName, setBaseName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('un');
  const [unitPrice, setUnitPrice] = useState(0);
  const [minStock, setMinStock] = useState(0);
  const [maxStock, setMaxStock] = useState(0);
  const [location, setLocation] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [colorInput, setColorInput] = useState('');

  useEffect(() => {
    if (!open) {
      setBaseName('');
      setSkuPrefix('');
      setCategory('');
      setUnit('un');
      setUnitPrice(0);
      setMinStock(0);
      setMaxStock(0);
      setLocation('');
      setGroupId(null);
      setColors([]);
      setColorInput('');
    }
  }, [open]);

  const addColor = () => {
    const c = colorInput.trim();
    if (c && !colors.includes(c)) {
      setColors(prev => [...prev, c]);
      setColorInput('');
    }
  };

  const removeColor = (color: string) => {
    setColors(prev => prev.filter(c => c !== color));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addColor();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (colors.length === 0) return;

    const items: ProductFormData[] = colors.map((color, idx) => ({
      name: baseName,
      sku: `${skuPrefix}-${String(idx + 1).padStart(2, '0')}`,
      category: deriveCategoryFromGroup(groups.find(g => g.id === groupId)?.name),
      color,
      quantity: 0,
      min_stock: minStock,
      max_stock: maxStock,
      unit,
      unit_price: unitPrice,
      location,
      group_id: groupId,
      active: true,
      image_url: '',
    }));

    onSubmit(items);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Cadastro em Grupo (Variações de Cor)</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="batch-name">Descrição do Material</Label>
              <Input
                id="batch-name"
                value={baseName}
                onChange={e => setBaseName(e.target.value)}
                required
                className="mt-1"
                placeholder="Ex: NAPA SOFT, LINHA60"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Cada cor será cadastrada como um item separado com este nome
              </p>
            </div>

            <div>
              <Label htmlFor="batch-sku">Prefixo SKU</Label>
              <Input
                id="batch-sku"
                value={skuPrefix}
                onChange={e => setSkuPrefix(e.target.value)}
                required
                className="mt-1 font-mono"
                placeholder="Ex: CAB-NAPA"
              />
            </div>

            <div>
              <Label>Tipo do Material</Label>
              <Input
                className="mt-1"
                value={groupId ? deriveCategoryFromGroup(groups.find(g => g.id === groupId)?.name) : 'Selecione um grupo'}
                disabled
              />
              <p className="text-[10px] text-muted-foreground mt-1">Derivado do grupo</p>
            </div>

            <div>
              <Label>Grupo</Label>
              <Select value={groupId || 'none'} onValueChange={v => setGroupId(v === 'none' ? null : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem grupo</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Unidade</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Custo Médio (R$)</Label>
              <CurrencyInput value={unitPrice} onChange={setUnitPrice} className="mt-1" />
            </div>

            <div>
              <Label>Estoque Mínimo</Label>
              <NumberInput min={0} step="0.01" value={minStock} onChange={setMinStock} className="mt-1" />
            </div>

            {/* Estoque Máximo removido em 2026-05 — não usado em business logic. */}

            <div>
              <Label>Localização</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Colors section */}
            <div className="col-span-2 space-y-2">
              <Label>Cores / Variações</Label>
              <div className="flex gap-2">
                <Input
                  value={colorInput}
                  onChange={e => setColorInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite uma cor e pressione Enter"
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="icon" onClick={addColor}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {colors.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {colors.map(color => (
                    <Badge key={color} variant="secondary" className="gap-1 pr-1">
                      {color}
                      <button type="button" onClick={() => removeColor(color)} className="ml-1 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {colors.length > 0
                  ? `${colors.length} item(ns) serão criados`
                  : 'Adicione ao menos uma cor para continuar'}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={colors.length === 0}>
              Criar {colors.length} {colors.length === 1 ? 'Item' : 'Itens'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
