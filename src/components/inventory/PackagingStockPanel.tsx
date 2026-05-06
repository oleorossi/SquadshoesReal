import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { Box, Pencil, Save, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';

export default function PackagingStockPanel() {
  const qc = useQueryClient();
  const [editDialogId, setEditDialogId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    dimensions_length: 0, dimensions_width: 0, dimensions_height: 0,
    dimensions_unit: 'cm', yield_per_meter: 1, quantity: 0, min_stock: 0,
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['packaging_stock_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('category', 'Embalagem')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });

  const totalItems = products.length;
  const totalUnits = products.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const lowStock = products.filter(p => Number(p.quantity || 0) <= Number(p.min_stock || 0) && Number(p.min_stock) > 0).length;

  const openEditDialog = (p: any) => {
    setEditDialogId(p.id);
    setEditForm({
      dimensions_length: Number(p.dimensions_length || 0),
      dimensions_width: Number(p.dimensions_width || 0),
      dimensions_height: Number(p.dimensions_height || 0),
      dimensions_unit: p.dimensions_unit || 'cm',
      yield_per_meter: Number(p.yield_per_meter || 1),
      quantity: Number(p.quantity || 0),
      min_stock: Number(p.min_stock || 0),
    });
  };

  const handleSave = async () => {
    if (!editDialogId) return;
    try {
      const product = products.find(p => p.id === editDialogId);
      const prevStock = Number(product?.quantity || 0);

      // Non-stock metadata update
      const { error } = await supabase.from('products').update({
        dimensions_length: editForm.dimensions_length,
        dimensions_width: editForm.dimensions_width,
        dimensions_height: editForm.dimensions_height,
        dimensions_unit: editForm.dimensions_unit,
        yield_per_meter: editForm.yield_per_meter,
        min_stock: editForm.min_stock,
      }).eq('id', editDialogId);
      if (error) throw error;

      // Quantity change via atomic RPC (avoids race condition)
      if (editForm.quantity !== prevStock) {
        const result = await adjustStockSafe({
          productId: editDialogId,
          expectedPrevious: prevStock,
          newQty: editForm.quantity,
          reason: 'Ajuste manual de estoque de embalagem',
        });
        if (!result.success) throw new Error(result.errorMessage);
      }

      toast.success('Embalagem atualizada!');
      qc.invalidateQueries({ queryKey: ['packaging_stock_products'] });
      setEditDialogId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('products').update({ active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Embalagem desativada!');
    qc.invalidateQueries({ queryKey: ['packaging_stock_products'] });
  };

  const fmtDim = (p: any) => {
    const l = Number(p.dimensions_length || 0);
    const w = Number(p.dimensions_width || 0);
    const h = Number(p.dimensions_height || 0);
    if (!l && !w && !h) return '—';
    const u = p.dimensions_unit || 'cm';
    return `${l}×${w}×${h} ${u}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" /> Estoque de Embalagens
        </h3>
        <p className="text-xs text-muted-foreground">
          Produtos com categoria "Embalagem" do estoque principal
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{totalItems}</p>
            <p className="text-xs text-muted-foreground">Tipos de Embalagem</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold">{totalUnits}</p>
            <p className="text-xs text-muted-foreground">Unidades em Estoque</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-destructive">{lowStock}</p>
            <p className="text-xs text-muted-foreground">Estoque Baixo</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Carregando...</p>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Box className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Nenhuma embalagem encontrada</p>
            <p className="text-xs mt-1">Cadastre produtos com a categoria "Embalagem" no estoque principal para vê-los aqui.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Nome</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead className="text-center">Dimensões (C×L×A)</TableHead>
                <TableHead className="text-center">Consumo Un.</TableHead>
                <TableHead className="text-center">Estoque</TableHead>
                <TableHead className="text-center">Mín</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map(p => {
                const qty = Number(p.quantity || 0);
                const minStock = Number(p.min_stock || 0);
                const isLow = minStock > 0 && qty <= minStock;

                return (
                  <TableRow key={p.id} className={isLow ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-medium text-sm">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                    <TableCell className="text-sm">{p.color || '—'}</TableCell>
                    <TableCell className="text-center text-xs">{fmtDim(p)}</TableCell>
                    <TableCell className="text-center text-sm">{Number(p.yield_per_meter || 1)}</TableCell>
                    <TableCell className="text-center">
                      <span className={`font-semibold ${isLow ? 'text-destructive' : ''}`}>
                        {qty}
                        {isLow && <Badge variant="destructive" className="ml-1 text-[9px] px-1">BAIXO</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{minStock}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEditDialog(p)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <DeleteConfirmButton onConfirm={() => handleDelete(p.id)} size="sm" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editDialogId} onOpenChange={open => { if (!open) setEditDialogId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler className="h-5 w-5 text-primary" /> Editar Embalagem
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground mb-2 block">Dimensões ({editForm.dimensions_unit})</Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Comprimento</Label>
                  <NumberInput value={editForm.dimensions_length} onChange={v => setEditForm(f => ({ ...f, dimensions_length: v }))} min={0} step="0.1" decimals={2} />
                </div>
                <div>
                  <Label className="text-xs">Largura</Label>
                  <NumberInput value={editForm.dimensions_width} onChange={v => setEditForm(f => ({ ...f, dimensions_width: v }))} min={0} step="0.1" decimals={2} />
                </div>
                <div>
                  <Label className="text-xs">Altura</Label>
                  <NumberInput value={editForm.dimensions_height} onChange={v => setEditForm(f => ({ ...f, dimensions_height: v }))} min={0} step="0.1" decimals={2} />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Consumo Unitário (unidades por par)</Label>
              <NumberInput value={editForm.yield_per_meter} onChange={v => setEditForm(f => ({ ...f, yield_per_meter: v }))} min={0} step="1" decimals={0} />
              <p className="text-[10px] text-muted-foreground mt-1">Quantas unidades desta embalagem são consumidas por par produzido</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Estoque Atual</Label>
                <NumberInput value={editForm.quantity} onChange={v => setEditForm(f => ({ ...f, quantity: v }))} min={0} step="1" decimals={0} />
              </div>
              <div>
                <Label className="text-xs">Estoque Mínimo</Label>
                <NumberInput value={editForm.min_stock} onChange={v => setEditForm(f => ({ ...f, min_stock: v }))} min={0} step="1" decimals={0} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogId(null)}>Cancelar</Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
