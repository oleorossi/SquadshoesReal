import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Product } from '@/types/inventory';
import { Package as PackageMinus, Warning as AlertTriangle } from '@phosphor-icons/react';

interface ManualStockOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
}

export function ManualStockOutDialog({ open, onOpenChange, product }: ManualStockOutDialogProps) {
  const [quantity, setQuantity] = useState(0);
  const [orderNumber, setOrderNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || quantity <= 0) return;

    if (quantity > Number(product.quantity)) {
      toast.error('Quantidade de baixa maior que o estoque disponível');
      return;
    }

    setLoading(true);
    try {
      const previousStock = Number(product.quantity);
      const newStock = previousStock - quantity;
      const description = `Baixa manual${orderNumber ? ` - Pedido: ${orderNumber}` : ''}${notes ? ` | ${notes}` : ''}`;

      // Resolve optional order number text → sale_orders.id for audit traceability
      let orderId: string | null = null;
      if (orderNumber.trim()) {
        const { data: so } = await supabase
          .from('sale_orders').select('id').ilike('order_number', orderNumber.trim()).maybeSingle();
        orderId = so?.id ?? null;
      }

      // Concurrency-safe via SELECT FOR UPDATE inside the RPC; rejects if the
      // expected_previous no longer matches the DB row.
      const { data, error: rpcErr } = await supabase.rpc('adjust_stock' as any, {
        p_product_id: product.id,
        p_expected_previous_qty: previousStock,
        p_new_qty: newStock,
        p_delta: -quantity,
        p_reason: description,
        p_order_id: orderId,
      });
      if (rpcErr) throw rpcErr;
      const result = Array.isArray(data) ? data[0] : data;
      if (result && result.success === false) {
        throw new Error(
          result.error_message === 'CONCURRENCY_ERROR'
            ? 'Estoque foi alterado por outro usuário. Recarregue e tente novamente.'
            : (result.error_message || 'Falha ao ajustar estoque'),
        );
      }

      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      toast.success(`Baixa de ${quantity} ${product.unit} realizada em "${product.name}"`);
      onOpenChange(false);
      setQuantity(0);
      setOrderNumber('');
      setNotes('');
    } catch (err: any) {
      toast.error(`Erro ao dar baixa: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-5 w-5 text-destructive" />
            Baixa Manual de Estoque
          </DialogTitle>
        </DialogHeader>
        {product && (
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-semibold">{product.name}</p>
              <p className="text-xs text-muted-foreground">
                SKU: {product.sku} | Estoque atual: <span className="font-mono font-semibold text-foreground">{Number(product.quantity).toLocaleString('pt-BR')} {product.unit}</span>
              </p>
              {/* E9 (audit): exibe reservado quando > 0. Antes: usuário via "Estoque atual"
                  e pensava que tinha tudo disponível, mas reservado já estava comprometido
                  com OPs em aberto — risco de baixa indevida. */}
              {Number(product.reserved_stock ?? 0) > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  <AlertTriangle className="h-3 w-3 inline-block mr-1 -mt-0.5" />
                  Reservado em OPs:{' '}
                  <span className="font-mono font-semibold">
                    {Number(product.reserved_stock).toLocaleString('pt-BR')} {product.unit}
                  </span>
                  {' · '}Disponível real:{' '}
                  <span className="font-mono font-semibold">
                    {Math.max(0, Number(product.quantity) - Number(product.reserved_stock)).toLocaleString('pt-BR')} {product.unit}
                  </span>
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="out-qty">Quantidade da Baixa ({product.unit}) *</Label>
              <NumberInput
                id="out-qty"
                min={0.0001}
                step="0.0001"
                value={quantity}
                onChange={setQuantity}
                required
                className="mt-1"
                placeholder="0"
              />
              {quantity > 0 && Number(product.quantity) > 0 && quantity / Number(product.quantity) > 0.8 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Esta baixa representa {Math.round(quantity / Number(product.quantity) * 100)}% do estoque atual.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="order-number">Nº do Pedido</Label>
              <Input
                id="order-number"
                value={orderNumber}
                onChange={e => setOrderNumber(e.target.value)}
                className="mt-1 font-mono"
                placeholder="Ex: OP-2026-00012"
              />
            </div>

            <div>
              <Label htmlFor="out-notes">Observações</Label>
              <Textarea
                id="out-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="mt-1"
                rows={2}
                placeholder="Motivo da baixa, destino do material..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={loading || quantity <= 0}>
                {loading ? 'Processando...' : 'Confirmar Baixa'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
