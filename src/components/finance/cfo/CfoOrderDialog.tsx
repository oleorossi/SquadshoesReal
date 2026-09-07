import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useCfoSaleOrders, useSaveCfoOrder } from '@/hooks/useCfo';
import { isCfoDate } from '@/lib/cfoDates';
import type { CfoOrder, CfoOrderInput, CfoPlan } from '@/types/cfo';

interface Props { plan: CfoPlan; order?: CfoOrder; onClose: () => void; onSaved: (order: CfoOrder) => void }

export default function CfoOrderDialog({ plan, order, onClose, onSaved }: Props) {
  const [form, setForm] = useState<CfoOrderInput>(() => order ? { ...order } : {
    plano_id: plan.id, pedido_venda_id: null, descricao: '', entrega_em: plan.data_inicio,
    lucro_informado: 0, lucro_liquido: true, receita_total: null, status: 'ativo',
  });
  const sales = useCfoSaleOrders();
  const save = useSaveCfoOrder();
  const change = (key: keyof CfoOrderInput, value: string | number | boolean | null) => setForm(f => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descricao.trim() || !isCfoDate(form.entrega_em) || !Number.isFinite(form.lucro_informado)
      || (form.receita_total !== null && (!Number.isFinite(form.receita_total) || form.receita_total < 0))) {
      toast.error('Confira a descrição, a entrega e os valores do pedido.'); return;
    }
    try { const saved = await save.mutateAsync({ ...form, descricao: form.descricao.trim() }); onSaved(saved); onClose(); } catch { /* toast do hook */ }
  }
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{order ? 'Editar pedido projetado' : 'Projetar pedido'}</DialogTitle>
        <DialogDescription>Informe a entrega e o lucro total. Depois programe as compras e os recebimentos.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label>Pedido de venda (opcional)</Label><SearchableSelect aria-label="Pedido de venda" value={form.pedido_venda_id ?? 'manual'}
          options={[{ value: 'manual', label: 'Pedido informado manualmente' }, ...(sales.data ?? []).map(s => ({ value: s.id, label: `${s.order_number} — ${s.client_name || 'Sem cliente'}` }))]}
          onChange={id => {
            const selected = sales.data?.find(s => s.id === id);
            setForm(f => ({ ...f, pedido_venda_id: selected?.id ?? null,
              ...(selected ? { descricao: `${selected.order_number} — ${selected.client_name || 'Sem cliente'}`, receita_total: Number(selected.total), entrega_em: selected.delivery_date || f.entrega_em } : {}),
            }));
          }} placeholder={sales.isLoading ? 'Carregando pedidos…' : 'Buscar pedido de venda'} />
          {sales.error && <p className="text-xs text-warning">Não foi possível buscar os PVs. Você pode informar o pedido manualmente.</p>}
          <p className="text-xs text-muted-foreground">O vínculo copia os dados para este plano. Alterações posteriores no PV não mudam a projeção.</p>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cfo-order-name">Pedido / cliente</Label><Input id="cfo-order-name" value={form.descricao} onChange={e => change('descricao', e.target.value)} maxLength={240} placeholder="Ex.: PV-00193 — Cliente" required /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="cfo-order-delivery">Data de entrega</Label><Input id="cfo-order-delivery" type="date" value={form.entrega_em} onChange={e => change('entrega_em', e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="cfo-order-profit">Lucro total previsto</Label><CurrencyInput id="cfo-order-profit" value={form.lucro_informado} onChange={v => change('lucro_informado', v)} required /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cfo-profit-kind">Como você calculou esse lucro?</Label>
          <Select value={form.lucro_liquido ? 'liquido' : 'antes-materiais'} onValueChange={v => change('lucro_liquido', v === 'liquido')}><SelectTrigger id="cfo-profit-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="liquido">Já descontei os materiais</SelectItem><SelectItem value="antes-materiais">Ainda vou descontar os materiais</SelectItem></SelectContent></Select>
          <p className="text-xs text-muted-foreground">{form.lucro_liquido ? 'As compras afetam o caixa. O lucro informado permanece igual, sem descontar o material novamente.' : 'O CFO desconta deste lucro todas as compras de material vinculadas ao pedido.'} Para registrar prejuízo, informe um valor negativo.</p>
        </div>
        <div className="space-y-1.5"><div className="flex items-center justify-between"><Label htmlFor="cfo-order-revenue">Valor total a receber do cliente (opcional)</Label>
          {form.receita_total !== null && <Button size="sm" type="button" variant="ghost" onClick={() => change('receita_total', null)}>Limpar</Button>}</div>
          <CurrencyInput id="cfo-order-revenue" value={form.receita_total ?? 0} onChange={v => change('receita_total', v)} />
          <p className="text-xs text-muted-foreground">{form.receita_total === null ? 'Ainda não informado. ' : ''}É o recebimento integral, incluindo custos e lucro. O dinheiro só entra na projeção quando você agenda um recebimento.</p></div>
        {order && <div className="space-y-1.5"><Label htmlFor="cfo-order-status">Situação do pedido</Label><Select value={form.status} onValueChange={v => change('status', v)}><SelectTrigger id="cfo-order-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="cancelado">Cancelado</SelectItem></SelectContent></Select>
          <p className="text-xs text-muted-foreground">Cancelar remove as previsões, mas preserva pagamentos e recebimentos já realizados.</p></div>}
        {(form.entrega_em < plan.data_inicio || form.entrega_em > plan.data_fim) && <p className="text-sm text-warning">A entrega está fora do período deste plano. O pedido será salvo, mas seu lucro não aparecerá nas semanas atuais.</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancelar</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar pedido'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
