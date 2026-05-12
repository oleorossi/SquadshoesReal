import { useState } from 'react';
import { CreditCard, Plus, Trash as Trash2, CalendarBlank as CalendarIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type Installment = {
  dueDate: string;
  amount: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  supplierId: string | null;
  supplierName: string;
  invoiceNumber: string;
  totalValue: number;
  issueDate: string | null;
};

export default function AddBoletoFinanceDialog({
  open, onOpenChange, invoiceId, supplierId, supplierName, invoiceNumber, totalValue, issueDate,
}: Props) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('boleto');
  const [installments, setInstallments] = useState<Installment[]>(() => {
    const due = new Date();
    due.setDate(due.getDate() + 30);
    return [{ dueDate: due.toISOString().slice(0, 10), amount: totalValue }];
  });

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const addInstallment = () => {
    const lastDate = installments.length > 0
      ? new Date(installments[installments.length - 1].dueDate + 'T00:00:00')
      : new Date();
    lastDate.setDate(lastDate.getDate() + 30);
    const remaining = totalValue - installments.reduce((s, i) => s + i.amount, 0);
    setInstallments([...installments, {
      dueDate: lastDate.toISOString().slice(0, 10),
      amount: Math.max(remaining, 0),
    }]);
  };

  const removeInstallment = (idx: number) => {
    setInstallments(installments.filter((_, i) => i !== idx));
  };

  const updateInstallment = (idx: number, field: keyof Installment, value: string | number) => {
    setInstallments(installments.map((inst, i) =>
      i === idx ? { ...inst, [field]: value } : inst
    ));
  };

  const distributeEvenly = () => {
    const count = installments.length;
    if (count === 0) return;
    const perInstallment = Math.round((totalValue / count) * 100) / 100;
    const lastInstallment = Math.round((totalValue - perInstallment * (count - 1)) * 100) / 100;
    setInstallments(installments.map((inst, i) => ({
      ...inst,
      amount: i === count - 1 ? lastInstallment : perInstallment,
    })));
  };

  const totalInstallments = installments.reduce((s, i) => s + i.amount, 0);
  const diff = Math.abs(totalValue - totalInstallments);

  const handleSave = async () => {
    if (installments.length === 0) { toast.error('Adicione ao menos uma parcela'); return; }
    if (diff > 0.02) { toast.error('A soma das parcelas não confere com o valor total da NF'); return; }

    setSaving(true);
    try {
      const payables = installments.map((inst, idx) => ({
        description: `NF ${invoiceNumber} - Parcela ${idx + 1}/${installments.length} - ${supplierName}`,
        supplier_id: supplierId,
        invoice_id: invoiceId,
        category: 'material',
        due_date: inst.dueDate,
        amount: inst.amount,
        amount_paid: 0,
        status: 'pending',
        payment_method: paymentMethod,
        installment_number: idx + 1,
        total_installments: installments.length,
      }));

      const { error } = await supabase.from('accounts_payable').insert(payables as any);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success(`${installments.length} parcela(s) adicionada(s) ao financeiro!`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Adicionar Boleto ao Financeiro?
          </DialogTitle>
          <DialogDescription>
            Deseja lançar as parcelas desta nota fiscal no controle financeiro?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold">NF {invoiceNumber}</span>
            <span className="text-sm font-bold font-mono">{fmt(totalValue)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{supplierName}</p>
          {issueDate && (
            <p className="text-xs text-muted-foreground">
              Emissão: {new Date(issueDate + 'T00:00:00').toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Forma de pagamento</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
                <SelectItem value="cartao">Cartão</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Parcelas ({installments.length})</Label>
            <div className="flex gap-1">
              {installments.length > 1 && (
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={distributeEvenly}>
                  Distribuir igual
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={addInstallment}>
                <Plus className="h-3 w-3" /> Parcela
              </Button>
            </div>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {installments.map((inst, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-6 shrink-0">{idx + 1}.</span>
                <Input
                  type="date"
                  value={inst.dueDate}
                  onChange={e => updateInstallment(idx, 'dueDate', e.target.value)}
                  className="text-xs h-8"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={inst.amount}
                  onChange={e => updateInstallment(idx, 'amount', parseFloat(e.target.value) || 0)}
                  className="text-xs h-8 w-28 font-mono"
                />
                {installments.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeInstallment(idx)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {diff > 0.02 && (
            <p className="text-xs text-destructive">
              Diferença de {fmt(diff)} entre valor da NF e soma das parcelas.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Não, obrigado
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : 'Sim, lançar no financeiro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
