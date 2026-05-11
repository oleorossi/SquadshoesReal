import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { useEmitNfeDevolucao, useNfeDevolucoes } from '@/hooks/useNfe';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nfeId: string;
  nfeNumero?: string | null;
  saleOrderId: string | null;
  clientName?: string;
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/**
 * Dialog pra emitir NF-e de devolução (NF de entrada modelo 55, finalidade 4)
 * referenciando uma NF de venda já autorizada. Permite devolução parcial:
 * usuário escolhe quantos pares de cada item devolver.
 */
export function NfeDevolucaoDialog({ open, onOpenChange, nfeId, nfeNumero, saleOrderId, clientName }: Props) {
  const emitDevolucao = useEmitNfeDevolucao();
  const { data: devolucoesPrevias = [] } = useNfeDevolucoes(nfeId);

  // Carrega itens do PV vinculado à NF
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['sale_order_items_for_devolucao', saleOrderId],
    enabled: !!saleOrderId && open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sale_order_items')
        .select('id, reference_id, color, quantity, unit_price, qty_devolvida, technical_sheets(code, name)')
        .eq('sale_order_id', saleOrderId)
        .order('created_at');
      return data || [];
    },
    staleTime: 30_000,
  });

  // qty editável por item
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (!open) {
      setQtyMap({});
      setMotivo('');
    }
  }, [open]);

  const itemsWithSaldo = useMemo(() => {
    return (items as any[]).map(it => ({
      ...it,
      qtyOriginal: Number(it.quantity || 0),
      qtyJaDevolvida: Number(it.qty_devolvida || 0),
      saldo: Math.max(0, Number(it.quantity || 0) - Number(it.qty_devolvida || 0)),
      unitPrice: Number(it.unit_price || 0),
    }));
  }, [items]);

  const selecaoTotal = useMemo(() => {
    let pares = 0;
    let valor = 0;
    for (const it of itemsWithSaldo) {
      const q = Math.max(0, Math.min(it.saldo, Number(qtyMap[it.id] || 0)));
      pares += q;
      valor += q * it.unitPrice;
    }
    return { pares, valor };
  }, [qtyMap, itemsWithSaldo]);

  const validacaoMotivo = motivo.trim().length >= 15;
  const podeEmitir = selecaoTotal.pares > 0 && validacaoMotivo && !emitDevolucao.isPending;

  const onSubmit = async () => {
    const itens = itemsWithSaldo
      .map(it => ({ sale_order_item_id: it.id, qty: Number(qtyMap[it.id] || 0) }))
      .filter(p => p.qty > 0);
    if (itens.length === 0) return;
    try {
      await emitDevolucao.mutateAsync({ nfeOriginalId: nfeId, itens, motivo });
      onOpenChange(false);
    } catch {
      // toast já mostrado pelo onError
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !emitDevolucao.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            Emitir NF-e de Devolução
          </DialogTitle>
          <DialogDescription>
            NF original <strong>#{nfeNumero || '—'}</strong> · {clientName || 'Cliente'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-1 py-2">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-700 dark:text-amber-300">Devolução de NF emitida</p>
              <p className="text-muted-foreground">
                Será emitida uma <strong>NF-e de entrada (modelo 55, finalidade 4)</strong> referenciando
                a chave da NF original. Mercadoria volta ao estoque, e a conta a receber é reduzida
                proporcionalmente.
              </p>
            </div>
          </div>

          {devolucoesPrevias.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-semibold mb-2">Devoluções anteriores nessa NF:</p>
              <div className="space-y-1">
                {devolucoesPrevias.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between text-[11px]">
                    <span className="font-mono">#{d.numero || '—'} · {d.status}</span>
                    <span className="font-mono">{formatCurrency(Number(d.valor_total || 0))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs font-bold uppercase text-muted-foreground mb-2 block">Itens a devolver</Label>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> Carregando…
              </div>
            ) : itemsWithSaldo.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">Nenhum item no pedido.</div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Ref / Cor</th>
                      <th className="text-right px-3 py-2 font-semibold">Original</th>
                      <th className="text-right px-3 py-2 font-semibold">Já devolvido</th>
                      <th className="text-right px-3 py-2 font-semibold">Saldo</th>
                      <th className="text-right px-3 py-2 font-semibold">Devolver</th>
                      <th className="text-right px-3 py-2 font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsWithSaldo.map(it => {
                      const qty = Math.max(0, Math.min(it.saldo, Number(qtyMap[it.id] || 0)));
                      const blocked = it.saldo === 0;
                      return (
                        <tr key={it.id} className={`border-t ${blocked ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="font-semibold">{(it as any).technical_sheets?.code || '—'}</div>
                            <div className="text-muted-foreground text-[10px]">{it.color || '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{it.qtyOriginal}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-600">{it.qtyJaDevolvida}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">{it.saldo}</td>
                          <td className="px-3 py-2 text-right">
                            <Input
                              type="number"
                              min="0"
                              max={it.saldo}
                              value={qtyMap[it.id] ?? ''}
                              onChange={e => {
                                const v = e.target.value === '' ? 0 : Math.max(0, Math.min(it.saldo, Number(e.target.value)));
                                setQtyMap(prev => ({ ...prev, [it.id]: v }));
                              }}
                              disabled={blocked}
                              className="h-7 w-20 text-right font-mono"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {qty > 0 ? formatCurrency(qty * it.unitPrice) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/40 border-t">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right font-bold">Total:</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{selecaoTotal.pares} pares</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-primary">{formatCurrency(selecaoTotal.valor)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="motivo-dev" className="text-xs font-bold uppercase text-muted-foreground mb-1 block">
              Motivo <span className="text-destructive">*</span> <span className="font-normal normal-case text-[10px]">(mínimo 15 caracteres)</span>
            </Label>
            <Textarea
              id="motivo-dev"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ex: Cliente devolveu por defeito de costura. Produto retornará ao estoque pra revenda."
              rows={3}
              className={!validacaoMotivo && motivo.length > 0 ? 'border-destructive' : ''}
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {motivo.trim().length}/15 caracteres mínimos
              {validacaoMotivo && <Badge variant="outline" className="ml-2 h-4 text-[9px] bg-emerald-500/15 text-emerald-700 border-emerald-500/30">OK</Badge>}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={emitDevolucao.isPending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={!podeEmitir} className="gap-2">
            {emitDevolucao.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Emitir devolução ({selecaoTotal.pares} pares · {formatCurrency(selecaoTotal.valor)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
