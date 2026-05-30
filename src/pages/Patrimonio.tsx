/**
 * Patrimônio / Imobilizado — paridade Tutor32 (módulo 3).
 *
 * Cadastro de bens, depreciação linear (calculada na view v_fixed_assets) e baixa.
 * KPIs: custo total dos ativos, depreciação acumulada, valor contábil líquido.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Buildings, Plus, PencilSimple as Pencil, ArrowBendDownLeft as Revert, SignOut as Dispose } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import {
  useFixedAssets, useAddFixedAsset, useUpdateFixedAsset, useDeleteFixedAsset,
  useDisposeFixedAsset, useReactivateFixedAsset, deriveDepreciation,
  ASSET_CATEGORIES, type FixedAsset, type FixedAssetFormData,
} from '@/hooks/useFixedAssets';

const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'dd/MM/yyyy') : '—');

function useNamedList(table: string) {
  return useQuery({
    queryKey: [`${table}_named`],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase.from(table as any).select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

const emptyForm = (): FixedAssetFormData => ({
  asset_code: '', name: '', category: '', supplier_id: null, cost_center_id: null,
  acquisition_date: format(new Date(), 'yyyy-MM-dd'), acquisition_cost: 0, residual_value: 0,
  useful_life_months: 60, notes: '',
});

const NONE = '__none__';

export default function Patrimonio() {
  const { data: assets, isLoading } = useFixedAssets();
  const { data: suppliers } = useNamedList('suppliers');
  const { data: costCenters } = useNamedList('cost_centers');
  const add = useAddFixedAsset();
  const update = useUpdateFixedAsset();
  const del = useDeleteFixedAsset();
  const dispose = useDisposeFixedAsset();
  const reactivate = useReactivateFixedAsset();

  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'baixado'>('ativo');
  const [catFilter, setCatFilter] = useState<string>('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FixedAssetFormData>(emptyForm());

  const [disposeAsset, setDisposeAsset] = useState<FixedAsset | null>(null);
  const [disposeForm, setDisposeForm] = useState({ disposal_date: format(new Date(), 'yyyy-MM-dd'), disposal_value: '', disposal_reason: '' });

  const filtered = useMemo(() => {
    let list = assets ?? [];
    if (statusFilter !== 'todos') list = list.filter((a) => a.status === statusFilter);
    if (catFilter !== 'all') list = list.filter((a) => a.category === catFilter);
    return list;
  }, [assets, statusFilter, catFilter]);

  const kpis = useMemo(() => {
    const active = (assets ?? []).filter((a) => a.status === 'ativo');
    return {
      count: active.length,
      cost: active.reduce((s, a) => s + (a.acquisition_cost || 0), 0),
      accumulated: active.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0),
      book: active.reduce((s, a) => s + (a.book_value || 0), 0),
    };
  }, [assets]);

  const preview = useMemo(
    () => deriveDepreciation(form.acquisition_cost, form.residual_value, form.useful_life_months, form.acquisition_date),
    [form.acquisition_cost, form.residual_value, form.useful_life_months, form.acquisition_date],
  );

  function openCreate() { setEditingId(null); setForm(emptyForm()); setDialogOpen(true); }
  function openEdit(a: FixedAsset) {
    setEditingId(a.id);
    setForm({
      asset_code: a.asset_code, name: a.name, category: a.category,
      supplier_id: a.supplier_id, cost_center_id: a.cost_center_id,
      acquisition_date: a.acquisition_date, acquisition_cost: a.acquisition_cost,
      residual_value: a.residual_value, useful_life_months: a.useful_life_months, notes: a.notes,
    });
    setDialogOpen(true);
  }
  async function save() {
    // mutateAsync rejeita em erro (toast no onError) — só fecha se resolver.
    if (editingId) await update.mutateAsync({ id: editingId, data: form });
    else await add.mutateAsync(form);
    setDialogOpen(false);
  }
  function openDispose(a: FixedAsset) {
    setDisposeAsset(a);
    setDisposeForm({ disposal_date: format(new Date(), 'yyyy-MM-dd'), disposal_value: '', disposal_reason: '' });
  }
  async function confirmDispose() {
    if (!disposeAsset) return;
    await dispose.mutateAsync({
      id: disposeAsset.id,
      disposal_date: disposeForm.disposal_date,
      disposal_value: parseFloat(disposeForm.disposal_value.replace(',', '.')) || 0,
      disposal_reason: disposeForm.disposal_reason,
    });
    setDisposeAsset(null);
  }

  const saving = add.isPending || update.isPending;
  const disposeBook = disposeAsset ? disposeAsset.book_value : 0;
  const disposeGainLoss = (parseFloat(disposeForm.disposal_value.replace(',', '.')) || 0) - disposeBook;

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="FINANCEIRO · IMOBILIZADO"
        title="Patrimônio"
        description="Cadastro de bens, depreciação linear automática e baixa de imobilizado."
        actions={<Button onClick={openCreate} className="gap-2"><Plus className="size-4" /> Novo bem</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Bens ativos', value: String(kpis.count), money: false },
          { label: 'Custo de aquisição', value: formatCurrency(kpis.cost), money: true },
          { label: 'Depreciação acumulada', value: formatCurrency(kpis.accumulated), money: true },
          { label: 'Valor contábil líquido', value: formatCurrency(kpis.book), money: true },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-lg font-bold text-foreground tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <Panel
        eyebrow="IMOBILIZADO"
        title="Bens"
        actions={
          <div className="flex items-center gap-2">
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {ASSET_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativos</SelectItem>
                <SelectItem value="baixado">Baixados</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        flush
      >
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !filtered.length ? (
          <div className="p-6"><EmptyState icon={Buildings} title="Nenhum bem" description="Cadastre máquinas, móveis, veículos e equipamentos para acompanhar depreciação e valor contábil." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Bem</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Aquisição</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Deprec. acum.</TableHead>
                <TableHead className="text-right">Valor contábil</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">{a.asset_code || '—'}</TableCell>
                  <TableCell className="font-medium">{a.name}{a.cost_center_name && <span className="block text-[11px] text-muted-foreground">{a.cost_center_name}</span>}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{a.category}</Badge></TableCell>
                  <TableCell className="text-xs">{fmtDate(a.acquisition_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(a.acquisition_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(a.accumulated_depreciation)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(a.book_value)}</TableCell>
                  <TableCell>
                    {a.status === 'baixado' ? (
                      <Badge variant="outline" className="text-xs" title={a.disposal_gain_loss != null ? `Resultado: ${formatCurrency(a.disposal_gain_loss)}` : undefined}>
                        baixado {fmtDate(a.disposal_date)}
                      </Badge>
                    ) : a.fully_depreciated ? (
                      <Badge variant="secondary" className="text-xs">depreciado</Badge>
                    ) : (
                      <Badge className="text-xs">ativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {a.status === 'ativo' ? (
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => openDispose(a)} title="Dar baixa"><Dispose className="size-3.5" /> Baixa</Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => reactivate.mutate(a.id)} title="Reverter baixa"><Revert className="size-3.5" /> Reativar</Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="size-3.5" /></Button>
                      <DeleteConfirmButton onConfirm={() => del.mutate(a.id)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Dialog criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Buildings className="size-5" /> {editingId ? 'Editar' : 'Novo'} bem</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Código / plaqueta</Label><Input value={form.asset_code} onChange={(e) => setForm((f) => ({ ...f, asset_code: e.target.value }))} placeholder="ex.: PAT-001" /></div>
              <div className="space-y-1.5 md:col-span-2"><Label>Nome do bem</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="ex.: Máquina de costura Singer" /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{ASSET_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fornecedor</Label>
                <Select value={form.supplier_id ?? NONE} onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v === NONE ? null : v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>—</SelectItem>{suppliers?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Centro de custo</Label>
                <Select value={form.cost_center_id ?? NONE} onValueChange={(v) => setForm((f) => ({ ...f, cost_center_id: v === NONE ? null : v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>—</SelectItem>{costCenters?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5"><Label>Data aquisição</Label><Input type="date" value={form.acquisition_date} onChange={(e) => setForm((f) => ({ ...f, acquisition_date: e.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label>Custo <span className="text-muted-foreground font-normal">(R$)</span></Label>
                <Input type="number" value={form.acquisition_cost} onChange={(e) => setForm((f) => ({ ...f, acquisition_cost: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Residual <span className="text-muted-foreground font-normal">(R$)</span></Label>
                <Input type="number" value={form.residual_value} onChange={(e) => setForm((f) => ({ ...f, residual_value: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Vida útil <span className="text-muted-foreground font-normal">(meses)</span></Label>
                <Input type="number" value={form.useful_life_months} onChange={(e) => setForm((f) => ({ ...f, useful_life_months: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="space-y-1.5"><Label>Observações</Label><Textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={1} /></div>

            <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-4 flex-wrap text-sm">
              <span className="text-muted-foreground">Depreciação mensal: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(preview.monthly)}</span></span>
              <span className="text-muted-foreground">Acumulada ({preview.months}m): <span className="font-semibold text-foreground tabular-nums">{formatCurrency(preview.accumulated)}</span></span>
              <span className="text-muted-foreground">Valor contábil hoje: <span className="font-bold text-foreground tabular-nums">{formatCurrency(preview.bookValue)}</span></span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog baixa */}
      <Dialog open={!!disposeAsset} onOpenChange={(v) => { if (!v) setDisposeAsset(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Dispose className="size-5" /> Baixa — {disposeAsset?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Valor contábil atual: <span className="font-semibold text-foreground tabular-nums">{formatCurrency(disposeBook)}</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Data da baixa</Label><Input type="date" value={disposeForm.disposal_date} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_date: e.target.value }))} /></div>
              <div className="space-y-1.5">
                <Label>Valor obtido <span className="text-muted-foreground font-normal">(R$)</span></Label>
                <Input value={disposeForm.disposal_value} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_value: e.target.value }))} inputMode="decimal" placeholder="0,00" />
              </div>
            </div>
            <div className="space-y-1.5"><Label>Motivo</Label><Input value={disposeForm.disposal_reason} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_reason: e.target.value }))} placeholder="Venda, sucata, perda…" /></div>
            <div className="rounded-md bg-muted/40 border border-border p-2 text-sm">
              Resultado da baixa: <span className={`font-bold tabular-nums ${disposeGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(disposeGainLoss)}</span>
              <span className="text-muted-foreground"> ({disposeGainLoss >= 0 ? 'ganho' : 'perda'} de capital)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeAsset(null)}>Cancelar</Button>
            <Button onClick={confirmDispose} disabled={dispose.isPending}>{dispose.isPending ? 'Processando…' : 'Confirmar baixa'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
