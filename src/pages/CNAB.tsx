import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
<<<<<<< Updated upstream
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
=======
>>>>>>> Stashed changes
import { FileXls as FileSpreadsheet } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  gerado: 'bg-blue-100 text-blue-700',
  enviado: 'bg-amber-100 text-amber-700',
  retornado: 'bg-indigo-100 text-indigo-700',
  processado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-destructive/10 text-destructive',
};

const emptyForm = {
  cnab_layout: '240',
  bank_code: '001',
  selected_ar: new Set<string>(),
};

const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '104': 'Caixa Econômica',
  '237': 'Bradesco',
  '341': 'Itaú',
  '745': 'Citibank',
};

export default function CNAB() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: arPendentes = [] } = useQuery({
    queryKey: ['cnab_ar_pendentes'],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('accounts_receivable')
        .select('id, amount, due_date, customer_name, description')
        .eq('status', 'pendente')
        .order('due_date', { ascending: true })
        .limit(100);
      return data || [];
    },
  });

  const totalSelected = arPendentes
    .filter((ar: any) => form.selected_ar.has(ar.id))
    .reduce((s: number, ar: any) => s + Number(ar.amount || 0), 0);

  const create = useMutation({
    mutationFn: async () => {
      if (form.selected_ar.size === 0) throw new Error('Selecione ao menos 1 conta a receber');
      const filename = `CNAB${form.cnab_layout}_${form.bank_code}_${format(new Date(), 'yyyyMMdd_HHmm')}.REM`;
      const { error } = await (supabase as any).from('cnab_remittance_files').insert({
        filename,
        cnab_layout: form.cnab_layout,
        bank_code: form.bank_code,
        generated_at: new Date().toISOString(),
        total_records: form.selected_ar.size,
        total_value: totalSelected,
        status: 'gerado',
        ar_ids: Array.from(form.selected_ar),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-list-page'] });
      setOpen(false);
      setForm({ ...emptyForm, selected_ar: new Set() });
      toast.success('Arquivo CNAB gerado. Envie ao banco pela internet banking.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleAr = (id: string) => {
    const next = new Set(form.selected_ar);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm({ ...form, selected_ar: next });
  };

  return (
    <>
      <DataListPage
        title="CNAB · Boletos Remessa/Retorno"
        subtitle="Arquivos CNAB 240/400 — remessa de boletos ao banco e processamento de retorno"
        icon={FileSpreadsheet}
        table="cnab_remittance_files"
        orderBy="generated_at"
        emptyText="Nenhum arquivo CNAB gerado"
        newButtonLabel="Gerar Remessa"
        newButtonOnClick={() => { setForm({ ...emptyForm, selected_ar: new Set() }); setOpen(true); }}
        columns={[
          { key: 'filename', label: 'Arquivo', render: r => <span className="font-mono text-xs">{r.filename}</span> },
          { key: 'cnab_layout', label: 'Layout', render: r => <Badge variant="outline" className="text-[10px]">{r.cnab_layout}</Badge> },
          { key: 'generated_at', label: 'Gerado', render: r => <span className="text-xs">{format(new Date(r.generated_at), 'dd/MM/yy HH:mm')}</span> },
          { key: 'total_records', label: 'Registros', align: 'right' },
          { key: 'total_value', label: 'Valor Total', align: 'right', render: r => <span className="font-mono text-xs font-bold">R$ {Number(r.total_value || 0).toFixed(2)}</span> },
          { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Gerar Remessa CNAB</DialogTitle></DialogHeader>
          <div className="space-y-3 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Banco</Label>
                <Select value={form.bank_code} onValueChange={v => setForm({ ...form, bank_code: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(BANKS).map(([code, name]) => (
                      <SelectItem key={code} value={code}>{code} — {name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Layout CNAB</Label>
                <Select value={form.cnab_layout} onValueChange={v => setForm({ ...form, cnab_layout: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="240">CNAB 240 (FEBRABAN)</SelectItem>
                    <SelectItem value="400">CNAB 400 (legado)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">Contas a Receber Pendentes ({arPendentes.length})</Label>
                <span className="text-xs text-muted-foreground">
                  {form.selected_ar.size} selecionada(s) · R$ {totalSelected.toFixed(2)}
                </span>
              </div>
              {arPendentes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-4 text-center">
                  Nenhuma conta a receber pendente. Crie boletos primeiro.
                </p>
              ) : (
                <div className="border rounded max-h-64 overflow-y-auto">
                  {arPendentes.map((ar: any) => (
                    <label key={ar.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-0 hover:bg-muted/30 cursor-pointer text-sm">
                      <Checkbox checked={form.selected_ar.has(ar.id)} onCheckedChange={() => toggleAr(ar.id)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs truncate">{ar.customer_name || ar.description || '—'}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Venc.: {ar.due_date ? format(new Date(ar.due_date), 'dd/MM/yy') : '—'}
                        </p>
                      </div>
                      <span className="font-mono text-xs font-semibold">R$ {Number(ar.amount).toFixed(2)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              O CNAB de remessa fica disponível pra download e envio ao banco via internet banking.
              O retorno (.RET) é processado em uma operação separada após o banco confirmar pagamentos.
            </p>
          </div>
          <DialogFooter className="border-t pt-3">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || form.selected_ar.size === 0}>
              {create.isPending ? 'Gerando...' : `Gerar ${form.cnab_layout} (${form.selected_ar.size})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
