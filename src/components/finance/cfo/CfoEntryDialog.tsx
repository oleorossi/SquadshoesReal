import { useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useCreateCfoEntries, useSaveCfoEntry } from '@/hooks/useCfo';
import { todayISO } from '@/lib/date';
import { isCfoDate } from '@/lib/cfoDates';
import type { CfoEntry, CfoEntryInput, CfoEntryType, CfoOrder, CfoPlan } from '@/types/cfo';
import { CFO_ENTRY_LABELS } from '@/lib/cfoLabels';
interface Props {
  plan: CfoPlan; orders: CfoOrder[]; entries: CfoEntry[]; entry?: CfoEntry;
  initialOrderId?: string; initialType?: CfoEntryType; onClose: () => void;
}

export default function CfoEntryDialog({ plan, orders, entries, entry, initialOrderId, initialType, onClose }: Props) {
  const initialOrder = orders.find(o => o.id === initialOrderId);
  const type = initialType ?? 'material';
  const receiptRemainder = (order: CfoOrder) => Math.max(0, (order.receita_total ?? 0) - entries
    .filter(e => e.pedido_id === order.id && e.tipo === 'recebimento' && e.status !== 'cancelado' && e.id !== entry?.id)
    .reduce((sum, e) => sum + (e.status === 'realizado' ? e.valor_realizado ?? 0 : e.valor_previsto), 0));
  const [form, setForm] = useState<CfoEntryInput>(() => entry ? { ...entry } : {
    plano_id: plan.id, pedido_id: initialOrder?.id ?? null, tipo: type,
    descricao: `${CFO_ENTRY_LABELS[type]}${initialOrder ? ` — ${initialOrder.descricao}` : ''}`,
    data_prevista: type === 'recebimento' && initialOrder ? initialOrder.entrega_em : [plan.data_inicio, todayISO()].sort()[1],
    valor_previsto: type === 'recebimento' && initialOrder ? receiptRemainder(initialOrder) : 0,
    data_realizada: null, valor_realizado: null, status: 'previsto',
  });
  const [repeat, setRepeat] = useState(1);
  const save = useSaveCfoEntry();
  const createBatch = useCreateCfoEntries();
  const pending = save.isPending || createBatch.isPending;
  const change = (key: keyof CfoEntryInput, value: string | number | null) => setForm(f => ({ ...f, [key]: value }));
  const currentOrder = orders.find(o => o.id === form.pedido_id);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descricao.trim() || !isCfoDate(form.data_prevista) || !Number.isFinite(form.valor_previsto) || form.valor_previsto < 0
      || (form.status === 'realizado' && (!isCfoDate(form.data_realizada) || form.valor_realizado === null || !Number.isFinite(form.valor_realizado) || form.valor_realizado < 0))) {
      toast.error('Preencha a descrição, as datas e os valores. Valores não podem ser negativos.'); return;
    }
    if (form.tipo === 'recebimento' && !form.pedido_id) { toast.error('Vincule o recebimento a um pedido. Para dinheiro externo, use Aporte.'); return; }
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 104) { toast.error('Use de 1 a 104 ocorrências semanais.'); return; }
    if (!entry && repeat > 1 && form.status === 'previsto' && !isCfoDate(lastDate)) {
      toast.error('A última repetição ultrapassa o limite de datas. Reduza as ocorrências.'); return;
    }
    try {
      const payload = { ...form, descricao: form.descricao.trim(),
        data_realizada: form.status === 'realizado' ? form.data_realizada : null,
        valor_realizado: form.status === 'realizado' ? form.valor_realizado : null,
      };
      if (!entry && repeat > 1 && form.status === 'previsto') {
        await createBatch.mutateAsync(Array.from({ length: repeat }, (_, i) => ({ ...payload,
          data_prevista: format(addDays(parseISO(form.data_prevista), i * 7), 'yyyy-MM-dd'),
          descricao: `${payload.descricao} (${i + 1}/${repeat})`,
        })));
      } else await save.mutateAsync(payload);
      onClose();
    } catch { /* toast do hook */ }
  }
  const safeRepeat = Number.isInteger(repeat) && repeat >= 1 && repeat <= 104 ? repeat : 1;
  const lastDate = isCfoDate(form.data_prevista) ? format(addDays(parseISO(form.data_prevista), (safeRepeat - 1) * 7), 'yyyy-MM-dd') : '';
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{entry ? 'Editar lançamento' : 'Programar entrada ou saída'}</DialogTitle><DialogDescription>Use a data em que o dinheiro entra ou sai. Cadastre cada parcela com seu vencimento.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="cfo-entry-type">Tipo</Label><Select value={form.tipo} onValueChange={v => change('tipo', v)}><SelectTrigger id="cfo-entry-type"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CFO_ENTRY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Pedido vinculado{form.tipo !== 'recebimento' && ' (opcional)'}</Label><SearchableSelect aria-label="Pedido vinculado ao lançamento" value={form.pedido_id ?? 'none'} options={[
          { value: 'none', label: 'Sem pedido específico' }, ...orders.filter(o => o.status === 'ativo' || o.id === form.pedido_id).map(o => ({ value: o.id, label: o.descricao })),
        ]} onChange={id => {
          const selected = orders.find(o => o.id === id);
          setForm(f => ({ ...f, pedido_id: selected?.id ?? null,
            ...(!entry && selected && f.tipo === 'recebimento' ? { valor_previsto: receiptRemainder(selected), data_prevista: selected.entrega_em } : {}),
          }));
        }} /></div>
        <div className="space-y-1.5"><Label htmlFor="cfo-entry-name">Descrição</Label><Input id="cfo-entry-name" value={form.descricao} onChange={e => change('descricao', e.target.value)} maxLength={220} required placeholder="Ex.: Napa — parcela 1 de 2" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="cfo-entry-date">Data prevista</Label><Input id="cfo-entry-date" type="date" value={form.data_prevista} onChange={e => change('data_prevista', e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-entry-value">Valor previsto</Label><CurrencyInput id="cfo-entry-value" value={form.valor_previsto} onChange={v => change('valor_previsto', v)} required /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cfo-entry-status">Situação</Label><Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as CfoEntry['status'],
          ...(v === 'realizado' ? { data_realizada: f.data_realizada ?? todayISO(), valor_realizado: f.valor_realizado ?? f.valor_previsto } : {}),
        }))}><SelectTrigger id="cfo-entry-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="previsto">Previsto</SelectItem><SelectItem value="realizado">Já pago / recebido</SelectItem>{entry && <SelectItem value="cancelado">Cancelado</SelectItem>}</SelectContent></Select></div>
        {form.status === 'realizado' && <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-3">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="cfo-entry-actual-date">Data efetiva</Label><Input id="cfo-entry-actual-date" type="date" value={form.data_realizada ?? ''} onChange={e => change('data_realizada', e.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="cfo-entry-actual-value">Valor efetivo</Label><CurrencyInput id="cfo-entry-actual-value" value={form.valor_realizado ?? 0} onChange={v => change('valor_realizado', v)} required /></div></div>
          <p className="text-xs text-muted-foreground">O realizado substitui a previsão. Para pagamento parcial, mantenha o restante em outro lançamento previsto.</p>
        </div>}
        {!entry && form.status === 'previsto' && <div className="space-y-1.5"><Label htmlFor="cfo-entry-repeat">Ocorrências semanais</Label><Input id="cfo-entry-repeat" type="number" min={1} max={104} step={1} value={repeat} onChange={e => setRepeat(Number(e.target.value))} required />
          <p className="text-xs text-muted-foreground">1 = lançamento único. Para despesas recorrentes, o mesmo valor é programado a cada 7 dias; cada ocorrência pode ser editada depois.</p></div>}
        {currentOrder?.status === 'cancelado' && <p className="text-sm text-warning">O pedido foi cancelado. Somente valores já realizados entram no caixa.</p>}
        {(form.data_prevista < plan.data_inicio || lastDate > plan.data_fim) && <p className="text-sm text-warning">Há datas fora do período do plano. Os lançamentos serão salvos, mas apenas os valores dentro do período entram no caixa mostrado.</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Salvando…' : repeat > 1 && !entry && form.status === 'previsto' ? `Programar ${repeat} semanas` : 'Salvar lançamento'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
