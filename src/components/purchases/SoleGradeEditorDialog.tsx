import { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, FloppyDisk as Save, DownloadSimple } from '@phosphor-icons/react';
import { useUpdatePurchaseOrderItem } from '@/hooks/usePurchaseOrders';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  productName: string;
  productColor?: string | null;
  totalQuantity: number;
  /** Tamanhos disponíveis do solado (chaves de products.stock_grade, sem prefixo _). */
  availableSizes: string[];
  /** Grade atual do item (pode ser null ou objeto). */
  currentGrade?: Record<string, number> | null;
  /** PVs vinculados à OC — fonte da "necessidade do pedido" pra puxar a numeração. */
  linkedSaleOrderIds?: string[];
  /** Cor do item (pra casar com a cor das OPs ao puxar a demanda). */
  itemColor?: string | null;
}

/**
 * Editor de distribuição por numeração pra item-solado de OC.
 *
 * Usado quando a OC foi criada sem grade detalhada (vinha como "20 pares" sem
 * quebra). O total digitado deve bater com totalQuantity — força o usuário a
 * distribuir EXATAMENTE o que foi pedido, sem inflar nem reduzir.
 */
export function SoleGradeEditorDialog({
  open,
  onOpenChange,
  itemId,
  productName,
  productColor,
  totalQuantity,
  availableSizes,
  currentGrade,
  linkedSaleOrderIds,
  itemColor,
}: Props) {
  const updateItem = useUpdatePurchaseOrderItem();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pulling, setPulling] = useState(false);

  // Sincroniza estado quando abre / muda item
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const s of availableSizes) {
      initial[s] = String((currentGrade?.[s] ?? 0));
    }
    setValues(initial);
  }, [open, itemId, availableSizes, currentGrade]);

  const total = useMemo(
    () => Object.values(values).reduce((s, v) => s + (parseInt(v, 10) || 0), 0),
    [values],
  );
  const diff = total - totalQuantity;

  const handleSave = async () => {
    if (diff !== 0) {
      toast.error(`Total ${total} não bate com o pedido (${totalQuantity}). Ajuste antes de salvar.`);
      return;
    }
    const grade: Record<string, number> = {};
    for (const [size, raw] of Object.entries(values)) {
      const n = parseInt(raw, 10) || 0;
      if (n > 0) grade[size] = n;
    }
    if (Object.keys(grade).length === 0) {
      toast.error('Distribua ao menos uma numeração antes de salvar.');
      return;
    }
    try {
      await updateItem.mutateAsync({ id: itemId, data: { grade } });
      toast.success('Distribuição salva!');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDistEqual = () => {
    if (availableSizes.length === 0) return;
    const base = Math.floor(totalQuantity / availableSizes.length);
    const remainder = totalQuantity - base * availableSizes.length;
    const next: Record<string, string> = {};
    availableSizes.forEach((s, i) => {
      next[s] = String(base + (i < remainder ? 1 : 0));
    });
    setValues(next);
  };

  /**
   * Distribui usando o SHAPE da demanda dos PVs vinculados (a "necessidade do
   * pedido", não o range do modelo): soma a grade das OPs (orders.grade = pares
   * por numeração) que casam na cor, e rateia o total do item proporcionalmente
   * por maior-resto. Total sempre fecha com o pedido.
   */
  const normColor = (s?: string | null) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  const handlePullFromOrder = async () => {
    if (!linkedSaleOrderIds || linkedSaleOrderIds.length === 0) return;
    setPulling(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('grade, color, status')
        .in('sale_order_id', linkedSaleOrderIds);
      if (error) throw error;
      const rows = (data || []).filter((o: any) => o.status !== 'Cancelada' && o.status !== 'Cancelado');
      const wanted = normColor(itemColor);
      const colorRows = wanted ? rows.filter((o: any) => normColor(o.color) === wanted) : rows;
      const src = colorRows.length ? colorRows : rows;

      const demand: Record<string, number> = {};
      for (const o of src) {
        const g = (o.grade || {}) as Record<string, number>;
        for (const [k, v] of Object.entries(g)) {
          if (k.startsWith('_') || !availableSizes.includes(k)) continue;
          demand[k] = (demand[k] || 0) + (Number(v) || 0);
        }
      }
      const demandTotal = Object.values(demand).reduce((s, v) => s + v, 0);
      if (demandTotal <= 0) {
        toast.error('Os pedidos vinculados não têm numeração compatível com este solado.');
        return;
      }
      // Rateio proporcional (maior resto) → soma exatamente totalQuantity.
      const parts = availableSizes.map(s => {
        const exact = ((demand[s] || 0) / demandTotal) * totalQuantity;
        const base = Math.floor(exact);
        return { s, base, frac: exact - base };
      });
      let remainder = totalQuantity - parts.reduce((acc, p) => acc + p.base, 0);
      const order = [...parts].sort((a, b) => b.frac - a.frac);
      const bonus = new Set<string>();
      for (const p of order) { if (remainder <= 0) break; bonus.add(p.s); remainder--; }
      const next: Record<string, string> = {};
      for (const p of parts) next[p.s] = String(p.base + (bonus.has(p.s) ? 1 : 0));
      setValues(next);
      toast.success('Numeração puxada da demanda do pedido — ajuste se precisar.');
    } catch (e: any) {
      toast.error(e.message || 'Falha ao puxar a numeração do pedido.');
    } finally {
      setPulling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Distribuir por numeração — {productName}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 mt-1">
            {productColor && <Badge variant="outline" className="text-xs">{productColor}</Badge>}
            Total do pedido: <span className="font-bold">{totalQuantity}</span> pares
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {availableSizes.map(size => (
              <div key={size} className="space-y-1">
                <Label className="text-xs text-muted-foreground text-center block font-mono">{size}</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-9 text-center font-mono"
                  value={values[size] ?? '0'}
                  onChange={e => setValues(prev => ({ ...prev, [size]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Total distribuído: </span>
              <span className={`font-bold font-mono ${diff === 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {total}
              </span>
              <span className="text-muted-foreground"> / {totalQuantity}</span>
              {diff !== 0 && (
                <span className="text-destructive text-xs ml-2">
                  ({diff > 0 ? `+${diff}` : diff})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {linkedSaleOrderIds && linkedSaleOrderIds.length > 0 && (
                <Button variant="outline" size="sm" onClick={handlePullFromOrder} type="button" disabled={pulling}>
                  {pulling ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <DownloadSimple className="h-3.5 w-3.5 mr-1.5" />}
                  Puxar do pedido
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleDistEqual} type="button">
                Distribuir igualmente
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={updateItem.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={updateItem.isPending || diff !== 0}>
            {updateItem.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Salvar distribuição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
