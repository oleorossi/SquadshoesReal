import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import PageHeader from '@/components/layout/PageHeader';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
 import { Clock, Plus, PencilSimple as Pencil, Trash as Trash2, CircleNotch as Loader2, Info, Lightning as Zap } from '@phosphor-icons/react';
import { useShoeCategories } from '@/hooks/useShoeCategories';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';
 import { useCapacityDrivenLeadTimes } from '@/hooks/usePurchaseOrders';

interface DefaultLeadTime {
  id: string;
  shoe_category: string;
  lead_time_corte_dias: number;
  lead_time_costura_dias: number;
  lead_time_silk_dias: number;
  lead_time_colagem_dias: number;
  lead_time_montagem_dias: number;
  lead_time_acabamento_dias: number;
  lead_time_expedicao_dias: number;
  lead_time_buffer_material_dias: number;
  cutting_capacity_per_day: number;
  sewing_capacity_per_day: number;
  assembly_capacity_per_day: number;
  finishing_capacity_per_day: number;
   silk_capacity_per_day: number;
   gluing_capacity_per_day: number;
    expedition_capacity_per_day: number; // Used for Expedição
  notes: string | null;
}

// Colunas do Lead Time Dinâmico (v_capacity_driven_lead_times) — F1-03:
// a view foi reconstruída com aliases canônicos por setor, os 10 setores do
// fluxo e total respeitando o paralelismo dos preps (MAX(Corte Palmilha,
// Corte Forração, Costura, Aviamento) + sequenciais + buffer).
const DYNAMIC_SECTORS = [
  { label: 'Corte Palmilha', days: 'dynamic_days_corte_palmilha', load: 'current_load_corte_palmilha' },
  { label: 'Corte Forração', days: 'dynamic_days_corte_forracao', load: 'current_load_corte_forracao' },
  { label: 'Costura', days: 'dynamic_days_costura', load: 'current_load_costura' },
  { label: 'Aviamento', days: 'dynamic_days_aviamento', load: 'current_load_aviamento' },
  { label: 'Silk', days: 'dynamic_days_silk', load: 'current_load_silk' },
  { label: 'Colagem', days: 'dynamic_days_colagem', load: 'current_load_colagem' },
  { label: 'Montagem', days: 'dynamic_days_montagem', load: 'current_load_montagem' },
  { label: 'Solagem', days: 'dynamic_days_solagem', load: 'current_load_solagem' },
  { label: 'Acabamento', days: 'dynamic_days_acabamento', load: 'current_load_acabamento' },
  { label: 'Expedição', days: 'dynamic_days_expedicao', load: 'current_load_expedicao' },
] as const;

const emptyForm: Omit<DefaultLeadTime, 'id'> = {
  shoe_category: '',
  lead_time_corte_dias: 2,
  lead_time_costura_dias: 3,
  lead_time_silk_dias: 1,
  lead_time_colagem_dias: 1,
  lead_time_montagem_dias: 2,
  lead_time_acabamento_dias: 1,
  lead_time_expedicao_dias: 2,
  lead_time_buffer_material_dias: 2,
  cutting_capacity_per_day: 150,
  sewing_capacity_per_day: 100,
   assembly_capacity_per_day: 120,
   finishing_capacity_per_day: 180,
   silk_capacity_per_day: 0,
  gluing_capacity_per_day: 0,
  expedition_capacity_per_day: 0,
  notes: '',
};

export default function LeadTime() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DefaultLeadTime | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<DefaultLeadTime, 'id'>>(emptyForm);
  const { data: shoeCategories = [] } = useShoeCategories();
  const shoeCategoryOptions = shoeCategories.length > 0 ? shoeCategories : SHOE_CATEGORIES;

  const { data: dynamicLeadTimes = [], isLoading: loadingDynamic } = useCapacityDrivenLeadTimes();

  const { data: leadTimes = [], isLoading } = useQuery({
    queryKey: ['default-lead-times'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('default_lead_times' as any)
        .select('*')
        .order('shoe_category', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as DefaultLeadTime[];
    },
  });

  // A taxonomia vem do catálogo editável; a constante mantém o formulário
  // utilizável enquanto a consulta ainda não respondeu.


  const upsertMutation = useMutation({
    mutationFn: async (payload: { id?: string; data: Omit<DefaultLeadTime, 'id'> }) => {
      if (payload.id) {
        const { error } = await supabase
          .from('default_lead_times' as any)
          .update(payload.data)
          .eq('id', payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('default_lead_times' as any).insert(payload.data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['default-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['production_reverse_schedule'] });
      toast.success(editing ? 'Lead time atualizado' : 'Lead time padrão criado');
      handleClose();
    },
    onError: (err: any) => {
      toast.error('Erro ao salvar', { description: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('default_lead_times' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['default-lead-times'] });
      queryClient.invalidateQueries({ queryKey: ['production_reverse_schedule'] });
      toast.success('Lead time removido');
    },
    onError: (err: any) => toast.error('Erro ao remover', { description: err.message }),
  });

  function handleOpenNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function handleEdit(row: DefaultLeadTime) {
    setEditing(row);
    setForm({
      shoe_category: row.shoe_category,
      lead_time_corte_dias: row.lead_time_corte_dias,
      lead_time_costura_dias: row.lead_time_costura_dias,
      lead_time_silk_dias: row.lead_time_silk_dias || 1,
      lead_time_colagem_dias: row.lead_time_colagem_dias || 1,
      lead_time_montagem_dias: row.lead_time_montagem_dias,
      lead_time_acabamento_dias: row.lead_time_acabamento_dias,
      lead_time_expedicao_dias: row.lead_time_expedicao_dias || 2,
      lead_time_buffer_material_dias: row.lead_time_buffer_material_dias,
      cutting_capacity_per_day: row.cutting_capacity_per_day || 150,
      sewing_capacity_per_day: row.sewing_capacity_per_day || 100,
       assembly_capacity_per_day: row.assembly_capacity_per_day || 120,
       finishing_capacity_per_day: row.finishing_capacity_per_day || 180,
       silk_capacity_per_day: row.silk_capacity_per_day || 0,
      gluing_capacity_per_day: row.gluing_capacity_per_day || 0,
      expedition_capacity_per_day: (row as any).expedition_capacity_per_day || 0,
      notes: row.notes ?? '',
    });
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.shoe_category.trim()) {
      toast.error('Informe a categoria do modelo');
      return;
    }
    upsertMutation.mutate({ id: editing?.id, data: form });
  }

  const totalDias = (r: DefaultLeadTime | typeof form) =>
    r.lead_time_corte_dias +
    r.lead_time_costura_dias +
    r.lead_time_silk_dias +
    r.lead_time_colagem_dias +
    r.lead_time_montagem_dias +
    r.lead_time_acabamento_dias +
    r.lead_time_expedicao_dias +
    r.lead_time_buffer_material_dias;

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · LEAD TIME"
        title="Configuração de Lead Times Padrão"
        description="Tempos de produção por categoria, usados como fallback quando a Ficha Técnica não possui tempos definidos."
        actions={
          <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenNew}>
                <Plus className="h-4 w-4 mr-2" /> Novo padrão
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>
                    {editing ? 'Editar Lead Time padrão' : 'Novo Lead Time padrão'}
                  </DialogTitle>
                  <DialogDescription>
                    Define os dias de cada setor para a categoria. Aplicado automaticamente quando a
                    Ficha Técnica não tem o valor preenchido.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="cat" className="text-sm font-semibold">Categoria de modelo</Label>
                    <Select
                      value={form.shoe_category}
                      onValueChange={(v) => setForm({ ...form, shoe_category: v })}
                      disabled={!!editing}
                    >
                      <SelectTrigger id="cat">
                        <SelectValue placeholder="Selecione a categoria (mesma lista da Ficha Técnica)" />
                      </SelectTrigger>
                      <SelectContent>
                        {shoeCategoryOptions.map((c) => {
                          const alreadyConfigured = leadTimes.some(
                            (lt) => lt.shoe_category === c && lt.id !== editing?.id,
                          );
                          return (
                            <SelectItem key={c} value={c} disabled={alreadyConfigured}>
                              {c}
                              {alreadyConfigured ? ' • já configurado' : ''}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      As opções seguem o mesmo padrão usado no cadastro da Ficha Técnica.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Lead Time (dias úteis)</Label>
                    <div className="bg-muted/30 p-4 rounded-xl border border-dashed overflow-x-auto">
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 min-w-[600px]">
                        <NumField
                           label="Corte"
                          unit="dias"
                          value={form.lead_time_corte_dias}
                          onChange={(v) => setForm({ ...form, lead_time_corte_dias: v })}
                        />
                         <NumField
                            label="Forração"
                           unit="dias"
                           value={form.lead_time_costura_dias}
                           onChange={(v) => setForm({ ...form, lead_time_costura_dias: v })}
                         />
                        <NumField
                          label="Silk"
                          unit="dias"
                          value={form.lead_time_silk_dias}
                          onChange={(v) => setForm({ ...form, lead_time_silk_dias: v })}
                        />
                        <NumField
                          label="Colagem"
                          unit="dias"
                          value={form.lead_time_colagem_dias}
                          onChange={(v) => setForm({ ...form, lead_time_colagem_dias: v })}
                        />
                        <NumField
                          label="Montagem"
                          unit="dias"
                          value={form.lead_time_montagem_dias}
                          onChange={(v) => setForm({ ...form, lead_time_montagem_dias: v })}
                        />
                        <NumField
                          label="Acabamento"
                          unit="dias"
                          value={form.lead_time_acabamento_dias}
                          onChange={(v) => setForm({ ...form, lead_time_acabamento_dias: v })}
                        />
                        <NumField
                          label="Exped."
                          unit="dias"
                          value={form.lead_time_expedicao_dias}
                          onChange={(v) => setForm({ ...form, lead_time_expedicao_dias: v })}
                        />
                        <NumField
                          label="Buffer Material"
                          unit="dias"
                          value={form.lead_time_buffer_material_dias}
                          onChange={(v) => setForm({ ...form, lead_time_buffer_material_dias: v })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                      <Info className="h-3 w-3" />
                      Esses valores são usados para o cronograma reverso quando a capacidade diária da ficha técnica é 0.
                    </p>
                  </div>

                   <div className="space-y-3">
                     <Label className="text-sm font-semibold">Capacidade Diária (pares/dia)</Label>
                     <div className="bg-warning/10 p-4 rounded-xl border border-warning/30 border-dashed">
                       <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                         <NumField
                           label="Corte"
                           unit="prs/dia"
                           value={form.cutting_capacity_per_day}
                           onChange={(v) => setForm({ ...form, cutting_capacity_per_day: v })}
                         />
                         <NumField
                           label="Forração"
                           unit="prs/dia"
                           value={form.sewing_capacity_per_day}
                           onChange={(v) => setForm({ ...form, sewing_capacity_per_day: v })}
                         />
                         <NumField
                           label="Silk"
                           unit="prs/dia"
                           value={form.silk_capacity_per_day}
                           onChange={(v) => setForm({ ...form, silk_capacity_per_day: v })}
                         />
                         <NumField
                           label="Colagem"
                           unit="prs/dia"
                           value={form.gluing_capacity_per_day}
                           onChange={(v) => setForm({ ...form, gluing_capacity_per_day: v })}
                         />
                         <NumField
                           label="Montagem"
                           unit="prs/dia"
                           value={form.assembly_capacity_per_day}
                           onChange={(v) => setForm({ ...form, assembly_capacity_per_day: v })}
                         />
                         <NumField
                           label="Acabamento"
                           unit="prs/dia"
                           value={form.finishing_capacity_per_day}
                           onChange={(v) => setForm({ ...form, finishing_capacity_per_day: v })}
                         />
                          <div className="space-y-1.5">
                            <Label className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Expedição</Label>
                            <NumberInput
                              decimals={0}
                              className="h-8 text-xs font-semibold"
                              value={form.expedition_capacity_per_day}
                              onChange={n => setForm({ ...form, expedition_capacity_per_day: n })}
                            />
                            <span className="text-xs text-muted-foreground/70">prs/dia</span>
                          </div>
                       </div>
                     </div>
                     <p className="text-xs text-warning flex items-center gap-1.5 px-1 font-medium">
                       <Zap className="h-3 w-3" />
                       Usado para calcular o Lead Time Dinâmico baseado no backlog atual de ordens.
                     </p>
                   </div>

                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center gap-2">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    Total do ciclo: <strong>{totalDias(form)} dias</strong> (do gatilho de
                    material até a entrega).
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Observações</Label>
                    <Textarea
                      id="notes"
                      rows={2}
                      value={form.notes ?? ''}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="Ex.: válido para coleção verão"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleClose}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={upsertMutation.isPending}>
                    {upsertMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Salvar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <Panel title="Como o sistema decide os dias">
        <p className="text-sm text-muted-foreground">
          Para cada Ordem de Produção, o cronograma reverso utiliza esta hierarquia: 1) valor da Ficha Técnica do modelo (se preenchido), 2) padrão configurado aqui pela categoria, 3) valor global de fallback (Corte 2d · Forração 3d · Silk 1d · Colagem 1d · Montagem 2d · Acabamento 1d · Expedição 2d).
        </p>
      </Panel>

      <Panel eyebrow="PRODUÇÃO · LEAD TIME" title="Lead Times Padrão por Categoria" flush>
          {isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : leadTimes.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Nenhum lead time padrão cadastrado"
              description="Cadastre tempos padrão para cada categoria de modelo (ex.: Sandália, Infantil)."
            />
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-center">Corte</TableHead>
                  <TableHead className="text-center">Forração</TableHead>
                  <TableHead className="text-center">Silk</TableHead>
                  <TableHead className="text-center">Colagem</TableHead>
                  <TableHead className="text-center">Montagem</TableHead>
                  <TableHead className="text-center">Acabamento</TableHead>
                  <TableHead className="text-center">Exped.</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">Capacidades (prs/dia)</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leadTimes.map((lt) => (
                  <TableRow key={lt.id}>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{lt.shoe_category}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_corte_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_costura_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_silk_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_colagem_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_montagem_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_acabamento_dias}d</TableCell>
                    <TableCell className="text-center text-xs font-mono">{lt.lead_time_expedicao_dias}d</TableCell>
                    <TableCell className="text-center">
                      <Badge className="bg-primary/10 text-primary border-primary/20">
                        {totalDias(lt)}d
                      </Badge>
                    </TableCell>
                    <TableCell>
                       <div className="flex flex-wrap gap-1 justify-center max-w-[220px]">
                          {lt.cutting_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Corte: {lt.cutting_capacity_per_day}</Badge>}
                          {lt.sewing_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Forr: {lt.sewing_capacity_per_day}</Badge>}
                         {lt.silk_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Silk: {lt.silk_capacity_per_day}</Badge>}
                         {lt.gluing_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Colag: {lt.gluing_capacity_per_day}</Badge>}
                         {lt.assembly_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Mont: {lt.assembly_capacity_per_day}</Badge>}
                         {lt.finishing_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Acab: {lt.finishing_capacity_per_day}</Badge>}
                          {lt.expedition_capacity_per_day > 0 && <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-warning/30 bg-warning/10 text-warning">Exp: {lt.expedition_capacity_per_day}</Badge>}
                          {!(lt.sewing_capacity_per_day || lt.cutting_capacity_per_day || lt.silk_capacity_per_day || lt.gluing_capacity_per_day || lt.assembly_capacity_per_day || lt.finishing_capacity_per_day || lt.expedition_capacity_per_day) && <span className="text-xs text-muted-foreground">Não def.</span>}
                       </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                      {lt.notes || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(lt)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm(`Remover lead time padrão de "${lt.shoe_category}"?`)) {
                              deleteMutation.mutate(lt.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
       </Panel>

      <div className="space-y-3 pt-4">
        <Panel
          eyebrow="PRODUÇÃO · LEAD TIME"
          title="Lead Time Dinâmico (Projeção por Backlog)"
          subtitle="Projeção de dias por setor a partir do backlog atual de ordens"
          flush
        >
            {loadingDynamic ? (
              <div className="py-8 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                   <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                     <TableHead>Categoria</TableHead>
                     {DYNAMIC_SECTORS.map((s) => (
                       <TableHead key={s.label} className="text-center">{s.label}</TableHead>
                     ))}
                     <TableHead className="text-center">Total</TableHead>
                   </TableRow>
                </TableHeader>
                <TableBody>
                  {dynamicLeadTimes.map((dlt) => (
                    <TableRow key={dlt.shoe_category}>
                      <TableCell className="font-medium">{dlt.shoe_category}</TableCell>
                      {DYNAMIC_SECTORS.map((s) => (
                        <TableCell key={s.label} className="text-center text-muted-foreground">
                          {dlt[s.days] ?? 0}d
                          <div className="text-xs opacity-70">{dlt[s.load] ?? 0} prs</div>
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">
                          {dlt.total_dynamic_lead_time_days} dias úteis
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {dynamicLeadTimes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={DYNAMIC_SECTORS.length + 2} className="text-center py-8 text-muted-foreground">
                        Nenhum dado de backlog disponível para as categorias configuradas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
            )}
        </Panel>
        <p className="text-xs text-muted-foreground px-1 italic">
          * O cálculo dinâmico projeta quantos dias levará para processar todo o backlog atual + 1 novo pedido, 
          dividindo a carga pendente pela capacidade diária de cada setor.
        </p>
      </div>
    </div>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium leading-none text-muted-foreground uppercase tracking-wider">{label}</Label>
      <div className="relative">
        <NumberInput
          min={0}
          decimals={0}
          className="pr-12 h-9 text-sm"
          value={value}
          onChange={n => onChange(Math.max(0, n))}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          {unit}
        </span>
      </div>
    </div>
  );
}
