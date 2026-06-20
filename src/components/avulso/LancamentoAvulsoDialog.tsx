import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  MagnifyingGlass as Search, CircleNotch as Loader2, Package, Receipt, CurrencyDollar, CalendarBlank as Calendar,
} from '@phosphor-icons/react';
import { useSuppliers } from '@/hooks/useSuppliers';
import { useProducts } from '@/hooks/useProducts';
import { useContractors } from '@/hooks/useContractors';
import { useCreateAvulsoPurchaseOrder, useCreateAvulsoServiceOrder } from '@/hooks/useAvulso';
import { searchMatchesAny } from '@/lib/searchUtils';
import { formatCurrency } from '@/lib/utils';

/**
 * Dialog único para LANÇAMENTO AVULSO de Ordem de Compra (OC) e Ordem de Serviço
 * (OS). `mode` decide os campos:
 *  - 'oc': fornecedor + item do estoque + qtd × preço + (opcional) creditar
 *    estoque agora.
 *  - 'os': contratada/prestador + descrição + valor total.
 * Em ambos: data de pagamento (vira a conta a pagar no financeiro) + observações.
 */

export interface LancamentoAvulsoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'oc' | 'os';
}

const defaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

export function LancamentoAvulsoDialog({ open, onOpenChange, mode }: LancamentoAvulsoDialogProps) {
  const isOC = mode === 'oc';

  const { data: suppliers = [] } = useSuppliers();
  const { data: products = [] } = useProducts();
  const { data: contractors = [] } = useContractors();
  const createOC = useCreateAvulsoPurchaseOrder();
  const createOS = useCreateAvulsoServiceOrder();

  // Comuns
  const [counterpartyId, setCounterpartyId] = useState('');
  const [paymentDate, setPaymentDate] = useState(defaultDueDate());
  const [notes, setNotes] = useState('');

  // OC
  const [productId, setProductId] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const [addToStock, setAddToStock] = useState(true);

  // OS
  const [description, setDescription] = useState('');
  const [totalValue, setTotalValue] = useState(0);

  // Reset ao abrir/trocar de modo
  useEffect(() => {
    if (open) {
      setCounterpartyId('');
      setPaymentDate(defaultDueDate());
      setNotes('');
      setProductId('');
      setProductFilter('');
      setQuantity(0);
      setUnitPrice(0);
      setAddToStock(true);
      setDescription('');
      setTotalValue(0);
    }
  }, [open, mode]);

  const selectedProduct = useMemo(
    () => products.find((p: any) => p.id === productId),
    [products, productId],
  );

  const filteredProducts = useMemo(
    () => products.filter((p: any) => searchMatchesAny(productFilter, p.name, p.sku)).slice(0, 30),
    [products, productFilter],
  );

  const ocTotal = quantity * unitPrice;
  const total = isOC ? ocTotal : totalValue;

  const canSubmit = isOC
    ? !!counterpartyId && !!productId && quantity > 0 && unitPrice >= 0 && ocTotal > 0 && !!paymentDate
    : !!counterpartyId && !!description.trim() && totalValue > 0 && !!paymentDate;

  const isPending = createOC.isPending || createOS.isPending;

  const handleSubmit = async () => {
    try {
      if (isOC) {
        const supplier = suppliers.find((s: any) => s.id === counterpartyId);
        if (!supplier || !selectedProduct) return;
        await createOC.mutateAsync({
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          product_id: selectedProduct.id,
          product_name: selectedProduct.name,
          quantity,
          unit: selectedProduct.unit || 'un',
          unit_price: unitPrice,
          current_stock: Number(selectedProduct.quantity) || 0,
          min_stock: Number(selectedProduct.min_stock) || 0,
          max_stock: Number(selectedProduct.max_stock) || 0,
          payment_due_date: paymentDate,
          notes,
          add_to_stock: addToStock,
        });
      } else {
        const contractor = contractors.find((c: any) => c.id === counterpartyId);
        if (!contractor) return;
        await createOS.mutateAsync({
          contractor_id: contractor.id,
          contractor_name: contractor.trade_name || contractor.name,
          description,
          total_value: totalValue,
          payment_due_date: paymentDate,
          notes,
        });
      }
      onOpenChange(false);
    } catch {
      /* erro já exibido via toast no hook */
    }
  };

  const stockUnit = selectedProduct?.unit || 'un';
  const dueDateBr = paymentDate
    ? new Date(paymentDate + 'T00:00:00').toLocaleDateString('pt-BR')
    : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isOC ? <Package className="h-5 w-5 text-primary" /> : <Receipt className="h-5 w-5 text-primary" />}
            {isOC ? 'Lançar OC Avulsa' : 'Lançar OS Avulsa'}
          </DialogTitle>
          <DialogDescription>
            {isOC
              ? 'Selecione o item do estoque, a quantidade e o preço. A conta a pagar é gerada no financeiro com a data que você escolher.'
              : 'Descreva o serviço e o valor. A conta a pagar é gerada no financeiro com a data que você escolher.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Contraparte */}
          <div className="space-y-2">
            <Label className="text-xs">{isOC ? 'Fornecedor *' : 'Contratada / Prestador *'}</Label>
            <Select value={counterpartyId} onValueChange={setCounterpartyId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={isOC ? 'Selecione o fornecedor' : 'Selecione a contratada'} />
              </SelectTrigger>
              <SelectContent>
                {isOC
                  ? suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                  : contractors.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>
                    ))}
                {!isOC && contractors.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhuma contratada cadastrada. Cadastre em /terceirizados.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* ── OC: item + qtd + preço ─────────────────────────────────── */}
          {isOC && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Item do estoque *</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar produto por nome ou SKU..."
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border/60">
                  {filteredProducts.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-3 text-center">Nenhum produto encontrado</p>
                  ) : (
                    filteredProducts.map((p: any) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProductId(p.id)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted/40 ${productId === p.id ? 'bg-primary/10' : ''}`}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          SKU: {p.sku} · Estoque: {(Number(p.quantity) || 0).toLocaleString('pt-BR')} {p.unit || 'un'}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantidade *</Label>
                  <NumberInput value={quantity} onChange={setQuantity} step="0.01" min={0} unit={stockUnit} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <CurrencyDollar className="h-3 w-3" /> Preço unit. *
                  </Label>
                  <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} unit={`R$/${stockUnit}`} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Total</Label>
                  <div className="h-9 px-3 flex items-center justify-end rounded-md bg-primary/5 border border-primary/20">
                    <span className="font-bold tabular-nums text-foreground">{formatCurrency(ocTotal)}</span>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 cursor-pointer">
                <Checkbox checked={addToStock} onCheckedChange={(v) => setAddToStock(v === true)} />
                <div className="text-sm">
                  <div className="font-medium text-foreground">Adicionar ao estoque agora</div>
                  <div className="text-xs text-muted-foreground">
                    Lançamento retroativo: credita a quantidade no estoque do item (entrada).
                  </div>
                </div>
              </label>
            </>
          )}

          {/* ── OS: descrição + valor ──────────────────────────────────── */}
          {!isOC && (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Descrição do serviço *</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Manutenção de máquina de costura / serviço de frete / conserto..."
                  rows={2}
                  className="text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <CurrencyDollar className="h-3 w-3" /> Valor total *
                  </Label>
                  <NumberInput value={totalValue} onChange={setTotalValue} step="0.01" min={0} unit="R$" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Total</Label>
                  <div className="h-9 px-3 flex items-center justify-end rounded-md bg-primary/5 border border-primary/20">
                    <span className="font-bold tabular-nums text-foreground">{formatCurrency(totalValue)}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Data de pagamento (comum) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Data de pagamento *
              </Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observações</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional..." className="h-9" />
            </div>
          </div>

          {/* Resumo */}
          {total > 0 && (
            <div className="text-xs text-muted-foreground rounded-md bg-muted/40 border border-border/60 px-3 py-2 flex items-center justify-between">
              <span>Conta a pagar no financeiro</span>
              <span className="text-foreground font-medium">
                {formatCurrency(total)} · vence {dueDateBr}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lançar e enviar pro financeiro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
