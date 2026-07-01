import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, CurrencyDollar as DollarSign } from '@phosphor-icons/react';
import { toast } from 'sonner';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface PriceListItemsDialogProps {
  open: boolean;
  onClose: () => void;
  priceList: { id: string; name: string } | null;
}

/**
 * Editor de itens (preço por referência×cor) de uma tabela de preço.
 * Antes só existia o cabeçalho da tabela (PriceLists.tsx) — price_list_items
 * só era LIDO pelo app mobile e não havia como cadastrar preço por SKU senão
 * via SQL. Este dialog fecha esse gap. Cor vazia = preço default da referência.
 */
export function PriceListItemsDialog({ open, onClose, priceList }: PriceListItemsDialogProps) {
  const qc = useQueryClient();
  const [refId, setRefId] = useState('');
  const [color, setColor] = useState('');
  const [price, setPrice] = useState('');
  const [minQty, setMinQty] = useState('1');

  const { data: refs = [] } = useQuery({
    queryKey: ['technical_sheets_for_price_items'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; code: string | null }[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['price_list_items', priceList?.id],
    enabled: open && !!priceList?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list_items')
        .select('id, reference_id, color, unit_price, min_quantity')
        .eq('price_list_id', priceList!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; reference_id: string; color: string | null; unit_price: number; min_quantity: number | null }[];
    },
  });

  const refMap = useMemo(() => new Map(refs.map(r => [r.id, r])), [refs]);

  const addItem = useMutation({
    mutationFn: async () => {
      if (!priceList?.id) throw new Error('Tabela inválida');
      if (!refId) throw new Error('Selecione a referência');
      const p = Number(String(price).replace(',', '.'));
      if (!Number.isFinite(p) || p <= 0) throw new Error('Preço deve ser > 0');
      const { error } = await supabase.from('price_list_items').insert({
        price_list_id: priceList.id,
        reference_id: refId,
        color: color.trim() || null,
        unit_price: Number(p.toFixed(2)),
        min_quantity: Math.max(1, parseInt(minQty, 10) || 1),
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price_list_items', priceList?.id] });
      setRefId(''); setColor(''); setPrice(''); setMinQty('1');
      toast.success('Item adicionado à tabela.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('price_list_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price_list_items', priceList?.id] });
      toast.success('Item removido.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> Itens — {priceList?.name}
          </DialogTitle>
        <DialogDescription className="sr-only">Itens e preços desta tabela.</DialogDescription>
        </DialogHeader>

        {/* Form de adição */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_90px_auto] gap-2 items-end border-b border-border pb-3">
          <div>
            <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Referência</Label>
            <Select value={refId} onValueChange={setRefId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {refs.map(r => <SelectItem key={r.id} value={r.id}>{r.name}{r.code ? ` (${r.code})` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Cor</Label>
            <Input value={color} onChange={e => setColor(e.target.value)} placeholder="(todas)" className="h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Preço R$</Label>
            <Input value={price} onChange={e => setPrice(e.target.value)} placeholder="0,00" inputMode="decimal" className="h-9" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground uppercase font-bold mb-1 block">Qtd mín</Label>
            <Input value={minQty} onChange={e => setMinQty(e.target.value)} inputMode="numeric" className="h-9" />
          </div>
          <Button onClick={() => addItem.mutate()} disabled={!refId || !price || addItem.isPending} className="h-9 gap-1">
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>

        {/* Lista de itens */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Carregando...</p>
        ) : !items.length ? (
          <EmptyState icon={DollarSign} title="Tabela vazia" description="Adicione preços por referência (e cor, opcional) acima." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referência</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Qtd mín</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="text-sm font-semibold">{refMap.get(it.reference_id)?.name || '—'}</TableCell>
                  <TableCell className="text-sm">{it.color || <span className="text-muted-foreground">(todas)</span>}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{fmtBRL(Number(it.unit_price))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{it.min_quantity ?? 1}</TableCell>
                  <TableCell className="text-right">
                    <DeleteConfirmButton onConfirm={() => delItem.mutate(it.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
