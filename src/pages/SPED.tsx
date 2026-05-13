import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileText } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  gerado: 'bg-blue-100 text-blue-700',
  validado: 'bg-amber-100 text-amber-700',
  transmitido: 'bg-indigo-100 text-indigo-700',
  aceito: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-destructive/10 text-destructive',
};

const emptyForm = {
  sped_type: 'EFD_ICMS_IPI',
  period_start: format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), 'yyyy-MM-dd'),
  period_end: format(new Date(new Date().getFullYear(), new Date().getMonth(), 0), 'yyyy-MM-dd'),
  notes: '',
};

export default function SPED() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const create = useMutation({
    mutationFn: async () => {
      const today = new Date();
      const filename = `SPED_${form.sped_type}_${form.period_start.slice(0, 7).replace('-', '')}.txt`;
      const { error } = await (supabase as any).from('sped_exports').insert({
        sped_type: form.sped_type,
        period_start: form.period_start,
        period_end: form.period_end,
        filename,
        generated_at: today.toISOString(),
        total_records: 0,
        status: 'gerado',
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-list-page'] });
      setOpen(false);
      setForm(emptyForm);
      toast.success('SPED gerado. Validação e transmissão são feitas externamente.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <DataListPage
        title="SPED · Escrituração Digital"
        subtitle="EFD ICMS/IPI · EFD Contribuições · ECD · ECF · EFD-Reinf"
        icon={FileText}
        table="sped_exports"
        orderBy="period_start"
        emptyText="Nenhum SPED exportado"
        newButtonLabel="Gerar SPED"
        newButtonOnClick={() => { setForm(emptyForm); setOpen(true); }}
        columns={[
          { key: 'sped_type', label: 'Tipo', render: r => <Badge variant="outline" className="text-[10px]">{r.sped_type}</Badge> },
          { key: 'period', label: 'Período', render: r => <span className="text-xs">{format(new Date(r.period_start), 'MM/yy')} – {format(new Date(r.period_end), 'MM/yy')}</span> },
          { key: 'filename', label: 'Arquivo', render: r => <span className="font-mono text-xs">{r.filename}</span> },
          { key: 'generated_at', label: 'Gerado em', render: r => <span className="text-xs">{format(new Date(r.generated_at), 'dd/MM/yy HH:mm')}</span> },
          { key: 'total_records', label: 'Registros', align: 'right' },
          { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
        ]}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Gerar SPED</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tipo de SPED</Label>
              <Select value={form.sped_type} onValueChange={v => setForm({ ...form, sped_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EFD_ICMS_IPI">EFD ICMS/IPI (Fiscal)</SelectItem>
                  <SelectItem value="EFD_CONTRIBUICOES">EFD Contribuições (PIS/COFINS)</SelectItem>
                  <SelectItem value="ECD">ECD (Contábil)</SelectItem>
                  <SelectItem value="ECF">ECF (Fiscal)</SelectItem>
                  <SelectItem value="EFD_REINF">EFD-Reinf (Retenções)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Início do período</Label>
                <Input type="date" value={form.period_start}
                  onChange={e => setForm({ ...form, period_start: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Fim do período</Label>
                <Input type="date" value={form.period_end}
                  onChange={e => setForm({ ...form, period_end: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Ex.: SPED mensal 04/2026 — fechamento contábil" />
            </div>
            <p className="text-[10px] text-muted-foreground">
              O arquivo TXT é registrado no histórico. Geração efetiva, validação
              no PVA e transmissão à Receita são feitas pela contabilidade externa.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Gerando...' : 'Gerar SPED'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
