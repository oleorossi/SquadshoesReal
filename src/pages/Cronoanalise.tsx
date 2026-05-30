/**
 * Cronoanálise / Custo por minuto — paridade Tutor32 (módulo 1).
 *
 * Captura ciclos cronometrados de uma operação e DERIVA o tempo-padrão aplicando
 * ritmo (avaliação do operador) e tolerância PF&D — método clássico de cronoanálise.
 * O resultado é aplicado em bom_operations.standard_time_minutes via RPC, alimentando
 * o calculate_order_cost (MOD) que já existe. Não cria motor de PCP paralelo.
 *
 *   tempo normal   = média_observada(s) × ritmo/100 ÷ 60
 *   tempo-padrão   = tempo normal × (1 + tolerância/100)
 *   custo/minuto   = R$/h ÷ 60
 *   custo/par      = tempo-padrão × custo/minuto
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import {
  Timer, Plus, X, ArrowsClockwise as ApplyIcon, PencilSimple as Pencil, Gauge,
} from '@phosphor-icons/react';
import { PRODUCTION_STAGES } from '@/hooks/useBomOperations';
import {
  useTimeStudies, useSectorCostPerMinute, useAddTimeStudy, useUpdateTimeStudy,
  useDeleteTimeStudy, useApplyTimeStudyToBom, deriveTimeStudy,
  type TimeStudy, type TimeStudyFormData,
} from '@/hooks/useTimeStudies';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (v: number) => `${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} min`;

interface SheetOption { id: string; name: string; code: string; }

function useSheetOptions() {
  return useQuery({
    queryKey: ['technical_sheets_options'],
    queryFn: async (): Promise<SheetOption[]> => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return (data ?? []) as SheetOption[];
    },
  });
}

const emptyForm = (sheetId = ''): TimeStudyFormData => ({
  sheet_id: sheetId,
  bom_operation_id: null,
  operation_name: '',
  stage: '',
  cycles_seconds: [],
  rating_pct: 100,
  allowance_pct: 15,
  cost_per_hour: 0,
  observed_by: '',
  notes: '',
});

export default function Cronoanalise() {
  const [sheetFilter, setSheetFilter] = useState<string>('all');
  const { data: sheets } = useSheetOptions();
  const { data: studies, isLoading } = useTimeStudies(sheetFilter === 'all' ? null : sheetFilter);
  const { data: sectorCosts } = useSectorCostPerMinute();

  const addStudy = useAddTimeStudy();
  const updateStudy = useUpdateTimeStudy();
  const deleteStudy = useDeleteTimeStudy();
  const applyToBom = useApplyTimeStudyToBom();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TimeStudyFormData>(emptyForm());
  const [cycleInput, setCycleInput] = useState('');

  const sheetName = (id: string) => {
    const s = sheets?.find((x) => x.id === id);
    return s ? (s.code ? `${s.code} · ${s.name}` : s.name) : '—';
  };

  const derived = useMemo(
    () => deriveTimeStudy(form.cycles_seconds, form.rating_pct, form.allowance_pct, form.cost_per_hour),
    [form.cycles_seconds, form.rating_pct, form.allowance_pct, form.cost_per_hour],
  );

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm(sheetFilter === 'all' ? '' : sheetFilter));
    setCycleInput('');
    setDialogOpen(true);
  }

  function openEdit(s: TimeStudy) {
    setEditingId(s.id);
    setForm({
      sheet_id: s.sheet_id,
      bom_operation_id: s.bom_operation_id,
      operation_name: s.operation_name,
      stage: s.stage,
      cycles_seconds: s.cycles_seconds ?? [],
      rating_pct: s.rating_pct,
      allowance_pct: s.allowance_pct,
      cost_per_hour: s.cost_per_hour,
      observed_by: s.observed_by,
      notes: s.notes,
    });
    setCycleInput('');
    setDialogOpen(true);
  }

  function addCycle() {
    const v = parseFloat(cycleInput.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    setForm((f) => ({ ...f, cycles_seconds: [...f.cycles_seconds, v] }));
    setCycleInput('');
  }

  function removeCycle(idx: number) {
    setForm((f) => ({ ...f, cycles_seconds: f.cycles_seconds.filter((_, i) => i !== idx) }));
  }

  async function save() {
    if (editingId) await updateStudy.mutateAsync({ id: editingId, data: form });
    else await addStudy.mutateAsync(form);
    if (!updateStudy.isError && !addStudy.isError) setDialogOpen(false);
  }

  const saving = addStudy.isPending || updateStudy.isPending;

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="PCP · ENGENHARIA DE TEMPOS"
        title="Cronoanálise"
        description="Cronometre ciclos, aplique ritmo e tolerância PF&D para derivar o tempo-padrão e o custo por minuto de cada operação."
        actions={
          <Button onClick={openCreate} className="gap-2">
            <Plus className="size-4" /> Nova cronoanálise
          </Button>
        }
      />

      {/* Custo por minuto por setor */}
      <Panel eyebrow="CUSTO/MINUTO POR SETOR" title="Resumo gerencial" subtitle="Médias derivadas das cronoanálises ativas">
        {!sectorCosts?.length ? (
          <p className="text-sm text-muted-foreground">Sem cronoanálises ainda. Registre a primeira para ver o custo/minuto por setor.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {sectorCosts.map((c) => (
              <div key={c.stage} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs font-semibold text-foreground truncate">{c.stage}</div>
                <div className="mt-1 text-lg font-bold text-foreground tabular-nums">
                  {fmtBRL(c.avg_cost_per_minute)}<span className="text-xs font-normal text-muted-foreground">/min</span>
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {fmtMin(c.avg_standard_time_minutes)} · {fmtBRL(c.avg_cost_per_pair)}/par
                </div>
                <div className="text-[11px] text-muted-foreground">{c.study_count} estudo(s)</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Lista de cronoanálises */}
      <Panel
        eyebrow="CRONOANÁLISES"
        title="Estudos de tempo"
        actions={
          <Select value={sheetFilter} onValueChange={setSheetFilter}>
            <SelectTrigger className="h-8 w-[260px]"><SelectValue placeholder="Filtrar por referência" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as referências</SelectItem>
              {sheets?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.code ? `${s.code} · ${s.name}` : s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        flush
      >
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !studies?.length ? (
          <div className="p-6">
            <EmptyState icon={Timer} title="Nenhuma cronoanálise" description="Registre estudos de tempo para derivar o tempo-padrão e custear o MOD por operação." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referência</TableHead>
                <TableHead>Operação</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead className="text-right">Amostras</TableHead>
                <TableHead className="text-right">Ritmo</TableHead>
                <TableHead className="text-right">Toler.</TableHead>
                <TableHead className="text-right">Tempo-padrão</TableHead>
                <TableHead className="text-right">Custo/min</TableHead>
                <TableHead className="text-right">Custo/par</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{sheetName(s.sheet_id)}</TableCell>
                  <TableCell className="font-medium">
                    {s.operation_name}
                    {s.bom_operation_id && <Badge variant="outline" className="ml-2 text-[10px]">no BOM</Badge>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{s.stage}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{s.sample_size}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.rating_pct}%</TableCell>
                  <TableCell className="text-right tabular-nums">{s.allowance_pct}%</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmtMin(s.standard_time_minutes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRL(s.cost_per_minute)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmtBRL(s.cost_per_pair)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => applyToBom.mutate(s.id)} disabled={applyToBom.isPending} title="Aplicar tempo-padrão ao BOM (custeio)">
                        <ApplyIcon className="size-3.5" /> BOM
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}><Pencil className="size-3.5" /></Button>
                      <DeleteConfirmButton onConfirm={() => deleteStudy.mutate(s.id)} />
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
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Timer className="size-5" /> {editingId ? 'Editar' : 'Nova'} cronoanálise</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Referência (ficha técnica)</Label>
                <Select value={form.sheet_id} onValueChange={(v) => setForm((f) => ({ ...f, sheet_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {sheets?.map((s) => <SelectItem key={s.id} value={s.id}>{s.code ? `${s.code} · ${s.name}` : s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Setor</Label>
                <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {PRODUCTION_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Operação</Label>
              <Input value={form.operation_name} onChange={(e) => setForm((f) => ({ ...f, operation_name: e.target.value }))} placeholder="Ex.: Costura do cabedal" />
            </div>

            {/* Cronômetro de ciclos */}
            <div className="space-y-1.5">
              <Label>Ciclos cronometrados <span className="text-muted-foreground font-normal">(segundos por par)</span></Label>
              <div className="flex gap-2">
                <Input
                  value={cycleInput}
                  onChange={(e) => setCycleInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCycle(); } }}
                  placeholder="ex.: 42"
                  inputMode="decimal"
                  className="w-32"
                />
                <span className="self-center text-sm text-muted-foreground">s</span>
                <Button type="button" variant="outline" onClick={addCycle} className="gap-1"><Plus className="size-4" /> Adicionar ciclo</Button>
              </div>
              {form.cycles_seconds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {form.cycles_seconds.map((c, i) => (
                    <Badge key={i} variant="secondary" className="gap-1 tabular-nums">
                      {c}s
                      <button type="button" onClick={() => removeCycle(i)} className="hover:text-destructive"><X className="size-3" /></button>
                    </Badge>
                  ))}
                  <Badge variant="outline" className="tabular-nums">média {derived.observedAvgSeconds.toFixed(1)}s</Badge>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Ritmo / avaliação <span className="text-muted-foreground font-normal">(%)</span></Label>
                <div className="flex items-center gap-1">
                  <Input type="number" value={form.rating_pct} onChange={(e) => setForm((f) => ({ ...f, rating_pct: parseFloat(e.target.value) || 0 }))} />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tolerância PF&D <span className="text-muted-foreground font-normal">(%)</span></Label>
                <div className="flex items-center gap-1">
                  <Input type="number" value={form.allowance_pct} onChange={(e) => setForm((f) => ({ ...f, allowance_pct: parseFloat(e.target.value) || 0 }))} />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Custo do recurso <span className="text-muted-foreground font-normal">(R$/h)</span></Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <Input type="number" value={form.cost_per_hour} onChange={(e) => setForm((f) => ({ ...f, cost_per_hour: parseFloat(e.target.value) || 0 }))} />
                  <span className="text-sm text-muted-foreground">/h</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Observado por</Label>
                <Input value={form.observed_by ?? ''} onChange={(e) => setForm((f) => ({ ...f, observed_by: e.target.value }))} placeholder="Nome do cronoanalista" />
              </div>
              <div className="space-y-1.5">
                <Label>Observações</Label>
                <Textarea value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={1} />
              </div>
            </div>

            {/* Resultado derivado ao vivo */}
            <div className="rounded-lg border border-border bg-muted/40 p-3 flex items-center gap-4 flex-wrap">
              <Gauge className="size-5 text-muted-foreground" />
              <div className="text-sm">
                <span className="text-muted-foreground">Tempo normal: </span>
                <span className="font-semibold tabular-nums">{fmtMin(derived.normalMin)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Tempo-padrão: </span>
                <span className="font-bold tabular-nums">{fmtMin(derived.standardMin)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Custo/min: </span>
                <span className="font-semibold tabular-nums">{fmtBRL(derived.costPerMinute)}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Custo/par: </span>
                <span className="font-bold tabular-nums">{fmtBRL(derived.costPerPair)}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
