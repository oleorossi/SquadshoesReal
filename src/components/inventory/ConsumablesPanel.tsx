import { useState, useMemo } from 'react';
import { Plus, Trash as Trash2, Minus, CircleNotch as Loader2, MagnifyingGlass as Search, CheckSquare, Package } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Product } from '@/types/inventory';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface Props {
  products: Product[];
  onEdit: (p: Product) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export default function ConsumablesPanel({ products, onEdit, onDelete, onAdd }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchNotes, setBatchNotes] = useState('');
  const [batchQuantities, setBatchQuantities] = useState<Record<string, number>>({});
  const [processing, setProcessing] = useState(false);
  const qc = useQueryClient();

  const filtered = useMemo(() =>
    products.filter(p => {
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    }),
    [products, search]
  );

  const totalValue = useMemo(() =>
    products.reduce((s, p) => s + p.quantity * p.unit_price, 0),
    [products]
  );

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  };

  const openBatchDeduction = () => {
    const quantities: Record<string, number> = {};
    selected.forEach(id => { quantities[id] = 1; });
    setBatchQuantities(quantities);
    setBatchNotes('');
    setBatchDialogOpen(true);
  };

  const handleBatchDeduction = async () => {
    setProcessing(true);
    try {
      for (const [productId, qty] of Object.entries(batchQuantities)) {
        if (qty <= 0) continue;
        const product = products.find(p => p.id === productId);
        if (!product) continue;

        const prevStock = Number(product.quantity);
        const newStock = Math.max(0, prevStock - qty);
        const actualDeducted = prevStock - newStock;

        const { data, error: rpcErr } = await supabase.rpc('adjust_stock' as any, {
          p_product_id: productId,
          p_expected_previous_qty: prevStock,
          p_new_qty: newStock,
          p_delta: -actualDeducted,
          p_reason: `Baixa consumível${batchNotes ? ` — ${batchNotes}` : ''}`,
        });
        if (rpcErr) throw rpcErr;
        const result = Array.isArray(data) ? data[0] : data;
        if (result && result.success === false) {
          throw new Error(result.error_message || 'Falha ao ajustar estoque');
        }
      }

      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      toast.success(`Baixa realizada em ${Object.keys(batchQuantities).length} itens`);
      setBatchDialogOpen(false);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Consumíveis e Materiais Auxiliares</h3>
          <p className="text-xs text-muted-foreground">
            Itens que não entram na produção (escritório, limpeza, etc.) — {products.length} itens · Valor: {formatCurrency(totalValue)}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={openBatchDeduction}>
              <Minus className="h-3.5 w-3.5" /> Baixa em Lote ({selected.size})
            </Button>
          )}
          <Button size="sm" className="gap-1.5" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Novo Consumível
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar consumível..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-50" />
            <p>Nenhum consumível cadastrado</p>
            <p className="text-xs mt-1">
              Cadastre itens com categoria: Escritório, Limpeza, Manutenção, TI ou Outros
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Valor Unit.</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id} className={selected.has(p.id) ? 'bg-primary/5' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggleSelect(p.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <span className={p.quantity <= p.min_stock ? 'text-destructive font-bold' : ''}>
                        {p.quantity}
                      </span>
                      <span className="text-muted-foreground text-xs ml-1">{p.unit}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(p.unit_price)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(p)}>
                          <CheckSquare className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Batch deduction dialog */}
      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Minus className="h-5 w-5" /> Baixa em Lote — {Object.keys(batchQuantities).length} itens
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="w-24 text-right">Baixa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(batchQuantities).map(([id, qty]) => {
                    const product = products.find(p => p.id === id);
                    if (!product) return null;
                    return (
                      <TableRow key={id}>
                        <TableCell className="text-sm font-medium">{product.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{product.quantity} {product.unit}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            max={product.quantity}
                            value={qty}
                            onChange={e => setBatchQuantities(prev => ({ ...prev, [id]: Number(e.target.value) }))}
                            className="w-20 h-8 font-mono text-right ml-auto"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div>
              <Label>Motivo / Observações</Label>
              <Textarea
                value={batchNotes}
                onChange={e => setBatchNotes(e.target.value)}
                className="mt-1"
                rows={2}
                placeholder="Ex: Reposição mensal de escritório"
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleBatchDeduction} disabled={processing} className="gap-1.5">
                {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Minus className="h-4 w-4" />}
                Confirmar Baixa
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
