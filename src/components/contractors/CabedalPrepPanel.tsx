/**
 * Aba Preparação de cabedal em /terceirizados.
 * Fila de demandas (PV aprovado) → distribuição por ateliê → plano → OS.
 */
import { useMemo, useState } from 'react';
import {
  CircleNotch as Loader2,
  FileArrowDown,
  Factory,
  ArrowsClockwise,
  Plus,
  Scissors,
  Trash as Trash2,
  Warning as AlertTriangle,
  CheckCircle as CheckCircle2,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CABEDAL_PREP_SECTORS,
  CABEDAL_PREP_SECTOR_LABEL,
  scheduleAllocation,
  type CabedalPrepSector,
  validateDistribution,
} from '@/lib/cabedalPrep';
import {
  useCabedalPrepContractors,
  useCabedalPrepDemands,
  useBackfillCabedalPrepDemands,
  useContractorModelCapacities,
  useGenerateCabedalPrepServiceOrders,
  useReadjustCabedalPrepPlan,
  useSaveCabedalPrepAllocations,
  useUpsertContractorModelCapacity,
  type CabedalPrepDemandRow,
  type SaveAllocationInput,
} from '@/hooks/useCabedalPrep';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type ViewMode = 'deadline' | 'contractor' | 'pv';

interface DraftRow {
  key: string;
  contractorId: string;
  sector: CabedalPrepSector;
  pairs: string;
  pairsPerDay: string;
  leaveDate: string;
}

interface CapacityRow {
  contractor_id: string;
  technical_sheet_id: string;
  sector: string;
  capacity_pairs_per_day: number;
}

function formatIsoBr(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
}

function defaultSectorForDemand(d: CabedalPrepDemandRow): CabedalPrepSector {
  if (d.requires_cut) return 'corte_cabedal';
  if (d.requires_sewing) return 'costura_cabedal';
  return 'aviamento';
}

function lookupCapacity(
  caps: CapacityRow[],
  contractorId: string,
  sector: CabedalPrepSector,
  sheetId: string | null | undefined,
): number | null {
  if (!contractorId || !sheetId) return null;
  const hit = caps.find(
    (c) =>
      c.contractor_id === contractorId
      && c.technical_sheet_id === sheetId
      && c.sector === sector,
  );
  const n = Number(hit?.capacity_pairs_per_day);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function statusBadge(status: string) {
  if (status === 'stale') {
    return <Badge variant="outline" className="border-amber-500/50 text-amber-600">Desatualizado</Badge>;
  }
  if (status === 'planned') {
    return <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Planejado</Badge>;
  }
  if (status === 'done') {
    return <Badge variant="secondary">Concluído</Badge>;
  }
  return <Badge variant="outline">Aberto</Badge>;
}

function exportReportCsv(rows: CabedalPrepDemandRow[]) {
  const header = [
    'pv', 'cliente', 'referencia', 'cor', 'pares', 'billing_week',
    'ready_date', 'status', 'prestadores',
  ];
  const lines = [header.join(';')];
  for (const d of rows) {
    const prest = (d.cabedal_prep_allocations ?? [])
      .map((a) => `${a.contractors?.name ?? a.contractor_id}:${a.sector}:${a.pairs}`)
      .join(' | ');
    lines.push([
      d.sale_orders?.order_number ?? '',
      d.sale_orders?.client_name ?? '',
      d.reference_code ?? '',
      d.color ?? '',
      String(d.pairs),
      d.billing_week ?? '',
      d.ready_date ?? '',
      d.status,
      prest,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prep-cabedal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CabedalPrepPanel() {
  const [color, setColor] = useState('');
  const [billingWeek, setBillingWeek] = useState('');
  const [materialType, setMaterialType] = useState('all');
  const [view, setView] = useState<ViewMode>('deadline');
  const [editing, setEditing] = useState<CabedalPrepDemandRow | null>(null);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [capOpen, setCapOpen] = useState(false);
  const [capSheetId, setCapSheetId] = useState('');
  const [capContractorId, setCapContractorId] = useState('');
  const [capSector, setCapSector] = useState<CabedalPrepSector>('corte_cabedal');
  const [capPairs, setCapPairs] = useState('50');

  const filters = {
    color: color.trim() || null,
    billingWeek: billingWeek.trim() || null,
    materialType: materialType === 'all' ? null : materialType,
    view,
  };
  const { data: demands = [], isLoading, isError, error } = useCabedalPrepDemands(filters);
  const { data: contractors = [] } = useCabedalPrepContractors();
  const { data: capacitiesRaw = [] } = useContractorModelCapacities(
    editing?.technical_sheet_id ?? null,
  );
  const capacities = capacitiesRaw as CapacityRow[];
  const savePlan = useSaveCabedalPrepAllocations();
  const readjust = useReadjustCabedalPrepPlan();
  const generateOs = useGenerateCabedalPrepServiceOrders();
  const backfill = useBackfillCabedalPrepDemands();
  const upsertCap = useUpsertContractorModelCapacity();

  const filtered = useMemo(() => {
    let rows = [...demands];
    if (materialType === 'corte') rows = rows.filter((d) => d.requires_cut);
    if (materialType === 'costura') rows = rows.filter((d) => d.requires_sewing);
    if (materialType === 'aviamento') rows = rows.filter((d) => d.requires_aviamento);
    if (view === 'pv') {
      rows.sort((a, b) =>
        String(a.sale_orders?.order_number ?? '').localeCompare(
          String(b.sale_orders?.order_number ?? ''),
        ),
      );
    } else if (view === 'contractor') {
      rows.sort((a, b) => {
        const an = a.cabedal_prep_allocations?.[0]?.contractors?.name ?? 'Ω';
        const bn = b.cabedal_prep_allocations?.[0]?.contractors?.name ?? 'Ω';
        return an.localeCompare(bn);
      });
    } else {
      rows.sort((a, b) => String(a.ready_date ?? '9999').localeCompare(String(b.ready_date ?? '9999')));
    }
    return rows;
  }, [demands, materialType, view]);

  const openEdit = (d: CabedalPrepDemandRow) => {
    setEditing(d);
    const existing = d.cabedal_prep_allocations ?? [];
    const today = new Date().toISOString().slice(0, 10);
    if (existing.length) {
      setDraftRows(existing.map((a, i) => ({
        key: `${a.id}-${i}`,
        contractorId: a.contractor_id,
        sector: (a.sector === 'package' ? 'corte_cabedal' : a.sector) as CabedalPrepSector,
        pairs: String(a.pairs),
        pairsPerDay: String(a.pairs_per_day),
        leaveDate: a.leave_date,
      })));
    } else {
      setDraftRows([{
        key: 'new-0',
        contractorId: '',
        sector: defaultSectorForDemand(d),
        pairs: String(d.pairs),
        pairsPerDay: '50',
        leaveDate: today,
      }]);
    }
  };

  const patchRow = (idx: number, patch: Partial<DraftRow>) => {
    setDraftRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        const contractorId = patch.contractorId ?? r.contractorId;
        const sector = (patch.sector ?? r.sector) as CabedalPrepSector;
        if (patch.contractorId != null || patch.sector != null) {
          const cap = lookupCapacity(
            capacities,
            contractorId,
            sector,
            editing?.technical_sheet_id,
          );
          if (cap != null && (patch.pairsPerDay == null)) {
            next.pairsPerDay = String(cap);
          }
        }
        return next;
      }),
    );
  };

  const removeRow = (idx: number) => {
    setDraftRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const draftValidation = useMemo(() => {
    if (!editing) return null;
    return validateDistribution({
      demandPairs: Number(editing.pairs),
      readyDate: editing.ready_date,
      allocations: draftRows
        .filter((r) => r.contractorId && Number(r.pairs) > 0)
        .map((r) => ({
          contractorId: r.contractorId,
          sector: r.sector,
          pairs: Number(r.pairs),
          pairsPerDay: Number(r.pairsPerDay),
          leaveDate: r.leaveDate,
        })),
    });
  }, [editing, draftRows]);

  const rowSchedules = useMemo(
    () =>
      draftRows.map((r) =>
        scheduleAllocation({
          contractorId: r.contractorId || '_',
          sector: r.sector,
          pairs: Number(r.pairs),
          pairsPerDay: Number(r.pairsPerDay),
          leaveDate: r.leaveDate,
        }),
      ),
    [draftRows],
  );

  const canLockPlan = Boolean(
    draftValidation
      && draftValidation.ok
      && draftValidation.pendingPairs === 0
      && draftValidation.fitsReadyDate !== false
      && draftRows.some((r) => r.contractorId && Number(r.pairs) > 0),
  );

  const onSave = async (lock: boolean) => {
    if (!editing) return;
    if (lock && !canLockPlan) {
      toast.error('Feche o saldo e o prazo antes de travar o plano');
      return;
    }
    const rows: SaveAllocationInput[] = draftRows
      .filter((r) => r.contractorId && Number(r.pairs) > 0)
      .map((r) => ({
        demandId: editing.id,
        contractorId: r.contractorId,
        sector: r.sector,
        pairs: Number(r.pairs),
        pairsPerDay: Number(r.pairsPerDay),
        leaveDate: r.leaveDate,
      }));
    await savePlan.mutateAsync({
      demandId: editing.id,
      demandPairs: Number(editing.pairs),
      readyDate: editing.ready_date,
      rows,
      lockPlan: lock,
    });
    setEditing(null);
  };

  const onAllocateOvertime = () => {
    if (!editing || !draftValidation) return;
    const pending = draftValidation.pendingPairs;
    if (pending <= 0) {
      toast.message('Não há saldo pendente');
      return;
    }
    const factory = contractors.find((c) => Number(c.payment_days) >= 999);
    if (!factory) {
      toast.error('Cadastre o prestador FÁBRICA (payment_days ≥ 999)');
      return;
    }
    const sector = defaultSectorForDemand(editing);
    const cap = lookupCapacity(
      capacities,
      factory.id,
      sector,
      editing.technical_sheet_id,
    );
    setDraftRows((prev) => [
      ...prev,
      {
        key: `ot-${Date.now()}`,
        contractorId: factory.id,
        sector,
        pairs: String(pending),
        pairsPerDay: String(cap ?? pending),
        leaveDate: new Date().toISOString().slice(0, 10),
      },
    ]);
  };

  if (isError) {
    return (
      <EmptyState
        title="Não foi possível carregar a preparação"
        description={(error as Error)?.message || 'Tente de novo em instantes.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Cor</Label>
          <Input
            className="h-9 w-40"
            placeholder="Ex.: PRETO"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Semana faturamento</Label>
          <Input
            className="h-9 w-40"
            placeholder="Ex.: 2026-10-S1"
            value={billingWeek}
            onChange={(e) => setBillingWeek(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo / setor</Label>
          <Select value={materialType} onValueChange={setMaterialType}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="corte">Corte cabedal</SelectItem>
              <SelectItem value="costura">Costura cabedal</SelectItem>
              <SelectItem value="aviamento">Aviamento</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Visão</Label>
          <Select value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deadline">Por data-limite</SelectItem>
              <SelectItem value="contractor">Por prestador</SelectItem>
              <SelectItem value="pv">Por PV</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={backfill.isPending}
          onClick={() => backfill.mutate()}
        >
          {backfill.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowsClockwise className="h-4 w-4" />
          )}
          Atualizar demandas
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => exportReportCsv(filtered)}
        >
          <FileArrowDown className="h-4 w-4" /> Relatório
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setCapOpen(true)}
        >
          <Factory className="h-4 w-4" /> Capacidade prestador
        </Button>
      </div>

      <Panel flush>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando demandas…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Scissors}
            title="Nenhuma demanda de preparação"
            description="PVs Aprovado/Em Produção com cabedal ou aviamento entram aqui. Use «Atualizar demandas» para sincronizar os pedidos já abertos."
            size="sm"
            action={
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={backfill.isPending}
                onClick={() => backfill.mutate()}
              >
                {backfill.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowsClockwise className="h-4 w-4" />
                )}
                Atualizar demandas
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PV</TableHead>
                <TableHead>Ref / cor</TableHead>
                <TableHead className="text-right">Pares</TableHead>
                <TableHead>Faturamento</TableHead>
                <TableHead>Pronto até</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const allocs = d.cabedal_prep_allocations ?? [];
                const pending = Math.max(
                  0,
                  Number(d.pairs) - allocs.reduce((s, a) => s + Number(a.pairs), 0),
                );
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.sale_orders?.order_number ?? '—'}
                      <div className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {d.sale_orders?.client_name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{d.reference_code ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{d.color ?? '—'}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.pairs}</TableCell>
                    <TableCell className="font-mono text-xs">{d.billing_week ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {formatIsoBr(d.ready_date)}
                    </TableCell>
                    <TableCell>{statusBadge(d.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {allocs.length === 0
                        ? 'Sem distribuição'
                        : `${allocs.length} linha(s)${pending > 0 ? ` · ${pending} pend.` : ''}`}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {d.status === 'stale' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1"
                            disabled={readjust.isPending}
                            onClick={() => readjust.mutate(d.id)}
                          >
                            <ArrowsClockwise className="h-3.5 w-3.5" /> Reajustar
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => openEdit(d)}
                        >
                          Distribuir
                        </Button>
                        {allocs.some((a) => !a.service_order_id) && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            disabled={generateOs.isPending}
                            onClick={() =>
                              generateOs.mutate(
                                allocs.filter((a) => !a.service_order_id).map((a) => a.id),
                              )
                            }
                          >
                            Gerar OS
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Distribuir · {editing?.sale_orders?.order_number} · {editing?.reference_code}{' '}
              {editing?.color}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {/* Resumo da demanda — sempre visível enquanto se edita as linhas */}
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Pronto até
                  </span>
                  <div className="font-display text-base tabular-nums text-foreground">
                    {formatIsoBr(editing?.ready_date)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Demanda
                  </span>
                  <div className="tabular-nums font-medium">{editing?.pairs} pares</div>
                </div>
                {editing?.assembly_capacity_per_day ? (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Montagem
                    </span>
                    <div className="tabular-nums text-muted-foreground">
                      {editing.assembly_capacity_per_day}/dia
                    </div>
                  </div>
                ) : null}
                {draftValidation && (
                  <>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Alocado
                      </span>
                      <div className="tabular-nums font-medium">
                        {draftValidation.allocatedPairs}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Pendente
                      </span>
                      <div
                        className={cn(
                          'tabular-nums font-semibold',
                          draftValidation.pendingPairs > 0
                            ? 'text-amber-600'
                            : 'text-emerald-600',
                        )}
                      >
                        {draftValidation.pendingPairs}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {draftValidation && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {draftValidation.fitsReadyDate === true && (
                    <span className="inline-flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Cabe na meta
                      {draftValidation.latestEndDate
                        ? ` · última etapa ${formatIsoBr(draftValidation.latestEndDate)}`
                        : ''}
                    </span>
                  )}
                  {draftValidation.fitsReadyDate === false && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Estoura a meta
                      {draftValidation.latestEndDate
                        ? ` · termina ${formatIsoBr(draftValidation.latestEndDate)}`
                        : ''}
                    </span>
                  )}
                  {draftValidation.pendingPairs > 0 && (
                    <span className="text-muted-foreground">
                      Faltam {draftValidation.pendingPairs} pares — rascunho ok; travar exige 100%.
                    </span>
                  )}
                </div>
              )}
              {(editing?.requires_cut || editing?.requires_sewing || editing?.requires_aviamento) && (
                <div className="flex flex-wrap gap-1.5">
                  {editing.requires_cut && (
                    <Badge variant="outline" className="text-[10px]">Corte</Badge>
                  )}
                  {editing.requires_sewing && (
                    <Badge variant="outline" className="text-[10px]">Costura</Badge>
                  )}
                  {editing.requires_aviamento && (
                    <Badge variant="outline" className="text-[10px]">Aviamento</Badge>
                  )}
                </div>
              )}
            </div>

            {draftRows.map((row, idx) => {
              const sched = rowSchedules[idx];
              const overMeta =
                Boolean(editing?.ready_date && sched?.endDate)
                && sched!.endDate > editing!.ready_date!;
              const suggestedCap = lookupCapacity(
                capacities,
                row.contractorId,
                row.sector,
                editing?.technical_sheet_id,
              );
              return (
                <div
                  key={row.key}
                  className="rounded-md border border-border/60 p-3 space-y-2"
                >
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                    <div className="space-y-1 col-span-2 md:col-span-2">
                      <Label>Prestador</Label>
                      <Select
                        value={row.contractorId || undefined}
                        onValueChange={(v) => patchRow(idx, { contractorId: v })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Escolher" />
                        </SelectTrigger>
                        <SelectContent>
                          {contractors.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Setor</Label>
                      <Select
                        value={row.sector}
                        onValueChange={(v) =>
                          patchRow(idx, { sector: v as CabedalPrepSector })
                        }
                      >
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CABEDAL_PREP_SECTORS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {CABEDAL_PREP_SECTOR_LABEL[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Pares</Label>
                      <Input
                        className="h-9"
                        type="number"
                        min={0}
                        value={row.pairs}
                        onChange={(e) => patchRow(idx, { pairs: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>
                        Pares/dia
                        {suggestedCap != null && Number(row.pairsPerDay) === suggestedCap && (
                          <span className="ml-1 font-normal text-muted-foreground">(cadastro)</span>
                        )}
                      </Label>
                      <Input
                        className="h-9"
                        type="number"
                        min={1}
                        value={row.pairsPerDay}
                        onChange={(e) => patchRow(idx, { pairsPerDay: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Saída</Label>
                      <Input
                        className="h-9"
                        type="date"
                        value={row.leaveDate}
                        onChange={(e) => patchRow(idx, { leaveDate: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div
                      className={cn(
                        'tabular-nums',
                        overMeta ? 'text-amber-600 font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {sched ? (
                        <>
                          Termina em <strong className="text-foreground">{formatIsoBr(sched.endDate)}</strong>
                          {' · '}
                          {sched.workDays} dia{sched.workDays === 1 ? '' : 's'} de trabalho
                          {overMeta ? ' · depois da meta' : ''}
                        </>
                      ) : (
                        <span>Informe pares/dia e saída p/ calcular o término</span>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-muted-foreground"
                      disabled={draftRows.length <= 1}
                      onClick={() => removeRow(idx)}
                      aria-label="Remover linha"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remover
                    </Button>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() =>
                  setDraftRows((prev) => [
                    ...prev,
                    {
                      key: `new-${Date.now()}`,
                      contractorId: '',
                      sector: editing
                        ? defaultSectorForDemand(editing)
                        : 'costura_cabedal',
                      pairs: String(draftValidation?.pendingPairs ?? 0),
                      pairsPerDay: '50',
                      leaveDate: new Date().toISOString().slice(0, 10),
                    },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Linha
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={onAllocateOvertime}
              >
                <Factory className="h-3.5 w-3.5" /> Alocar pendente na fábrica
              </Button>
            </div>

            {draftValidation && draftValidation.errors.length > 0 && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs space-y-1 text-amber-700 dark:text-amber-500">
                {draftValidation.errors.map((e) => (
                  <div key={e} className="flex gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{e}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={savePlan.isPending}
              onClick={() => onSave(false)}
            >
              Salvar rascunho
            </Button>
            <Button
              type="button"
              disabled={savePlan.isPending || !canLockPlan}
              title={
                canLockPlan
                  ? undefined
                  : 'Exige 100% alocado, sem erros e dentro da meta'
              }
              onClick={() => onSave(true)}
            >
              Travar plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={capOpen} onOpenChange={setCapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Capacidade por prestador × modelo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>ID da ficha técnica</Label>
              <Input
                className="h-9 font-mono text-xs"
                placeholder="uuid da ficha"
                value={capSheetId}
                onChange={(e) => setCapSheetId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Prestador</Label>
              <Select value={capContractorId || undefined} onValueChange={setCapContractorId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Escolher" /></SelectTrigger>
                <SelectContent>
                  {contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Setor</Label>
              <Select
                value={capSector}
                onValueChange={(v) => setCapSector(v as CabedalPrepSector)}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CABEDAL_PREP_SECTORS.map((s) => (
                    <SelectItem key={s} value={s}>{CABEDAL_PREP_SECTOR_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Pares / dia</Label>
              <Input
                className="h-9"
                type="number"
                min={1}
                value={capPairs}
                onChange={(e) => setCapPairs(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCapOpen(false)}>
              Fechar
            </Button>
            <Button
              type="button"
              disabled={upsertCap.isPending || !capSheetId || !capContractorId}
              onClick={async () => {
                await upsertCap.mutateAsync({
                  contractorId: capContractorId,
                  technicalSheetId: capSheetId,
                  sector: capSector,
                  capacityPairsPerDay: Number(capPairs),
                });
                setCapOpen(false);
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CabedalPrepPanel;
