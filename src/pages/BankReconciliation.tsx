import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataListPage, dataListPageKey } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Scales as Scale, Info, UploadSimple as Upload } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/lib/utils';

// Cores semânticas dark-mode-safe (tint /10 + texto -600 + borda /20).
const STATUS: Record<string, string> = {
  em_andamento: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  conciliada: 'bg-green-500/10 text-green-600 border-green-500/20',
  divergencia: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  cancelada: 'bg-muted text-muted-foreground border-border',
};

const emptyForm = {
  reconciliation_date: format(new Date(), 'yyyy-MM-dd'),
  bank_account: '',
  total_credits: '',
  total_debits: '',
  notes: '',
};

/**
 * Histórico read-only de conciliações + form rápido pra criar sessão.
 * O matching detalhado contra AR/AP é feito na aba "Conciliação" do
 * /financeiro — esta página registra apenas os totais da sessão.
 */
export default function BankReconciliation() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.bank_account) throw new Error('Conta bancária é obrigatória');
      const { error } = await (supabase as any).from('bank_reconciliations').insert({
        reconciliation_date: form.reconciliation_date,
        bank_account: form.bank_account,
        total_credits: Number(form.total_credits) || 0,
        total_debits: Number(form.total_debits) || 0,
        matched_count: 0,
        unmatched_count: 0,
        status: 'em_andamento',
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dataListPageKey('bank_reconciliations') });
      setOpen(false);
      setForm(emptyForm);
      toast.success('Sessão de conciliação criada. Use /financeiro?tab=conciliacao pra matchar.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card className="border-blue-500/20 bg-blue-500/10">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-blue-600">
              Histórico de conciliações persistidas
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Use "Nova Conciliação" pra registrar uma sessão. Pra fazer o match detalhado
              contra AR/AP (com import OFX/CSV), abra a aba <span className="font-medium">Conciliação</span> dentro de Financeiro.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/financeiro?tab=conciliacao">Matching detalhado</Link>
          </Button>
        </CardContent>
      </Card>

      <DataListPage
        sectionLabel="FINANCEIRO · CONCILIAÇÃO"
        title="Conciliação Bancária"
        subtitle="Histórico de sessões salvas em bank_reconciliations"
        icon={Scale}
        table="bank_reconciliations"
        orderBy="reconciliation_date"
        emptyText="Nenhuma conciliação registrada"
        newButtonLabel="Nova Conciliação"
        newButtonOnClick={() => { setForm(emptyForm); setOpen(true); }}
        enableBulkDelete
        entityLabel="conciliação"
        displayLabel={(r: any) => `• ${format(new Date(r.reconciliation_date), 'dd/MM/yy')} — ${r.bank_account || 'sem conta'}`}
        columns={[
          { key: 'reconciliation_date', label: 'Data', render: r => format(new Date(r.reconciliation_date), 'dd/MM/yy') },
          { key: 'bank_account', label: 'Conta', render: r => <span className="text-xs font-mono">{r.bank_account || '—'}</span> },
          { key: 'total_credits', label: 'Créditos', align: 'right', render: r => <span className="text-green-600 font-mono text-xs tabular-nums">{formatCurrency(Number(r.total_credits))}</span> },
          { key: 'total_debits', label: 'Débitos', align: 'right', render: r => <span className="text-destructive font-mono text-xs tabular-nums">{formatCurrency(Number(r.total_debits))}</span> },
          { key: 'matched_count', label: 'Conciliados', align: 'right', render: r => <span className="tabular-nums">{r.matched_count}</span> },
          { key: 'unmatched_count', label: 'Pendentes', align: 'right', render: r => <span className={`tabular-nums ${r.unmatched_count > 0 ? 'text-amber-600 font-bold' : ''}`}>{r.unmatched_count}</span> },
          { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-xs capitalize`}>{r.status.replace('_',' ')}</Badge> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" /> Nova Sessão de Conciliação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Conta bancária *</Label>
              <Input value={form.bank_account}
                onChange={e => setForm({ ...form, bank_account: e.target.value })}
                placeholder="Ex.: BB 12345-6 / Itaú 4321-0" />
            </div>
            <div>
              <Label className="text-xs">Data da conciliação</Label>
              <Input type="date" value={form.reconciliation_date}
                onChange={e => setForm({ ...form, reconciliation_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Total créditos (R$)</Label>
                <Input type="number" step="0.01" value={form.total_credits}
                  onChange={e => setForm({ ...form, total_credits: e.target.value })}
                  placeholder="0,00" />
              </div>
              <div>
                <Label className="text-xs">Total débitos (R$)</Label>
                <Input type="number" step="0.01" value={form.total_debits}
                  onChange={e => setForm({ ...form, total_debits: e.target.value })}
                  placeholder="0,00" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Ex.: Conciliação mensal — extrato de abril/2026" />
            </div>
            <p className="text-xs text-muted-foreground">
              A sessão fica em "em_andamento" — você pode importar OFX e matchar
              contra AR/AP no módulo Financeiro &rarr; Conciliação pra fechar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.bank_account}>
              {create.isPending ? 'Criando...' : 'Criar sessão'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
