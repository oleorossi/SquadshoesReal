import { useState } from 'react';
import { addDays, addYears, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { useSaveCfoPlan } from '@/hooks/useCfo';
import { todayISO } from '@/lib/date';
import { isCfoDate } from '@/lib/cfoDates';
import type { CfoPlan, CfoPlanInput } from '@/types/cfo';

interface Props { plan?: CfoPlan; onClose: () => void; onSaved: (plan: CfoPlan) => void }

export default function CfoPlanDialog({ plan, onClose, onSaved }: Props) {
  const today = todayISO();
  const december = `${today.slice(0, 4)}-12-15`;
  const [form, setForm] = useState<CfoPlanInput>(() => plan ? { ...plan } : {
    nome: 'Planejamento CFO', data_inicio: today,
    data_fim: december > today ? december : format(addDays(parseISO(today), 90), 'yyyy-MM-dd'),
    saldo_inicial: 0, reserva_minima: 0,
  });
  const save = useSaveCfoPlan();
  const change = (key: keyof CfoPlanInput, value: string | number) => setForm(f => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim() || !isCfoDate(form.data_inicio) || !isCfoDate(form.data_fim) || form.data_fim < form.data_inicio) {
      toast.error('Informe o nome e um período válido.'); return;
    }
    if (!Number.isFinite(form.saldo_inicial) || !Number.isFinite(form.reserva_minima) || form.reserva_minima < 0) {
      toast.error('Confira o saldo e a reserva mínima.'); return;
    }
    if (parseISO(form.data_fim) > addYears(parseISO(form.data_inicio), 2)) {
      toast.error('Use um período de até dois anos.'); return;
    }
    try { const saved = await save.mutateAsync({ ...form, nome: form.nome.trim() }); onSaved(saved); onClose(); } catch { /* toast do hook */ }
  }
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{plan ? 'Configurar planejamento' : 'Criar planejamento CFO'}</DialogTitle>
        <DialogDescription>Defina o período e o dinheiro disponível no início do primeiro dia.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="cfo-plan-name">Nome</Label><Input id="cfo-plan-name" value={form.nome} onChange={e => change('nome', e.target.value)} maxLength={120} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="cfo-plan-start">Data inicial</Label><Input id="cfo-plan-start" type="date" value={form.data_inicio} onChange={e => change('data_inicio', e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-plan-end">Projetar até</Label><Input id="cfo-plan-end" type="date" value={form.data_fim} min={form.data_inicio} onChange={e => change('data_fim', e.target.value)} required /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cfo-plan-balance">Saldo inicial disponível</Label><CurrencyInput id="cfo-plan-balance" value={form.saldo_inicial} onChange={v => change('saldo_inicial', v)} required />
          <p className="text-xs text-muted-foreground">Pode ser negativo. Valores pagos ou recebidos antes da data inicial já devem estar neste saldo.</p></div>
        <div className="space-y-1.5"><Label htmlFor="cfo-plan-reserve">Reserva mínima desejada</Label><CurrencyInput id="cfo-plan-reserve" value={form.reserva_minima} onChange={v => change('reserva_minima', v)} />
          <p className="text-xs text-muted-foreground">O CFO avisa quando o saldo fica abaixo deste valor.</p></div>
        {plan && <p className="text-sm text-warning">Ao alterar o período, confira o saldo inicial e os totais semanais, especialmente nas semanas que ficarem incompletas. Os lançamentos permanecem salvos nas datas originais.</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar planejamento'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
