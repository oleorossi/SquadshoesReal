/**
 * Cronoanálise / Custo por minuto — paridade Tutor32 (módulo 1).
 *
 * Captura ciclos cronometrados de uma operação e DERIVA o tempo-padrão aplicando
 * ritmo (avaliação do operador) e tolerância PF&D — método clássico de cronoanálise.
 * O resultado é aplicado em bom_operations.standard_time_minutes via RPC, alimentando
 * o calculate_order_cost (MOD) que já existe. Não cria motor de PCP paralelo.
 *
 * 2026-07-03: o form virou o componente compartilhado TimeStudyDialog (com
 * cronômetro ao vivo + "Salvar e aplicar ao BOM") — o mesmo dialog abre direto
 * da aba Operações da ficha técnica, pré-preenchido pela linha do BOM. Esta
 * página segue como visão GERAL (custo/min por setor + todos os estudos).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Timer, Plus, ArrowsClockwise as ApplyIcon, PencilSimple as Pencil } from '@phosphor-icons/react';
import TimeStudyDialog, { type TimeStudySheetOption } from '@/components/technical-sheets/TimeStudyDialog';
import {
  useTimeStudies, useSectorCostPerMinute, useDeleteTimeStudy, useApplyTimeStudyToBom,
  type TimeStudy,
} from '@/hooks/useTimeStudies';

const fmtBRL = (v: number) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (v: number) => `${(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} min`;

function useSheetOptions() {
  return useQuery({
    queryKey: ['technical_sheets_options'],
    queryFn: async (): Promise<TimeStudySheetOption[]> => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code')
        .order('name');
      if (error) throw error;
      return (data ?? []) as TimeStudySheetOption[];
    },
  });
}

export default function Cronoanalise() {
  const [sheetFilter, setSheetFilter] = useState<string>('all');
  const { data: sheets } = useSheetOptions();
  const { data: studies, isLoading } = useTimeStudies(sheetFilter === 'all' ? null : sheetFilter);
  const { data: sectorCosts } = useSectorCostPerMinute();

  const deleteStudy = useDeleteTimeStudy();
  const applyToBom = useApplyTimeStudyToBom();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TimeStudy | null>(null);

  const sheetName = (id: string) => {
    const s = sheets?.find((x) => x.id === id);
    return s ? (s.code ? `${s.code} · ${s.name}` : s.name) : '—';
  };

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: TimeStudy) {
    setEditing(s);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="PCP · ENGENHARIA DE TEMPOS"
        title="Cronoanálise"
        description="Cronometre ciclos, aplique ritmo e tolerância PF&D para derivar o tempo-padrão e o custo por minuto de cada operação. Dica: dá pra cronometrar direto da aba Operações da ficha técnica."
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
            <EmptyState icon={Timer} title="Nenhuma cronoanálise" description="Registre estudos de tempo para derivar o tempo-padrão e custear o MOD por operação. O caminho mais rápido: ficha técnica → aba Operações → botão de cronômetro na linha." />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
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
                <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
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

      <TimeStudyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        study={editing}
        sheets={sheets}
        defaultSheetId={sheetFilter === 'all' ? undefined : sheetFilter}
      />
    </div>
  );
}
