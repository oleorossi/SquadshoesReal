/**
 * Tela full-bleed pós-aprovação: distribui Prep. cabedal (costura_cabedal +
 * aviamento) e trava o plano. Spec: specs/aprovacao-distribuicao-prep-cabedal.md
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  Factory,
  Handshake,
  CheckCircle,
  Scissors,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import {
  cabedalReadyDate,
  scheduleAllocation,
  type CabedalPrepSector,
} from '@/lib/cabedalPrep';
import {
  buildAutoBillingReport,
  defaultPostApprovalSector,
  postApprovalSectorLabel,
  sectorsForPostApprovalDemand,
  type AutoBillingReportRow,
} from '@/lib/postApprovalCabedalDistribute';
import {
  syncCabedalPrepDemandsForSaleOrders,
  useCabedalPrepContractors,
  useCabedalPrepDemands,
  useSaveCabedalPrepAllocations,
  type CabedalPrepDemandRow,
  type SaveAllocationInput,
} from '@/hooks/useCabedalPrep';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const INTERNAL_VALUE = '__interno__';

interface DraftLine {
  demandId: string;
  sector: CabedalPrepSector;
  contractorId: string; // '' | INTERNAL_VALUE | uuid
  pairsPerDay: string;
  leaveDate: string;
}

interface ReportOrder {
  id: string;
  order_number: string;
  delivery_deadline?: string | null;
}

interface Props {
  open: boolean;
  saleOrderIds: string[];
  /** Pedidos do lote (ou do individual) para o relatório de datas. */
  reportOrders?: ReportOrder[];
  minBillingById?: Map<string, string | null | undefined> | Record<string, string | null | undefined>;
  onDone: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatIsoBr(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  return new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR');
}

function effectiveReadyDate(d: CabedalPrepDemandRow): string | null {
  if (d.ready_date) return d.ready_date;
  if (!d.billing_week || !d.assembly_capacity_per_day) return null;
  return cabedalReadyDate({
    billingWeek: d.billing_week,
    pairs: Number(d.pairs),
    assemblyCapacityPerDay: Number(d.assembly_capacity_per_day),
  });
}

function buildInitialDrafts(
  demands: CabedalPrepDemandRow[],
  factoryId: string | null,
): DraftLine[] {
  const today = todayIso();
  const lines: DraftLine[] = [];
  for (const d of demands) {
    const sector = defaultPostApprovalSector(d);
    if (!sector) continue;
    const existing = (d.cabedal_prep_allocations ?? []).find(
      (a) => a.sector === sector || (sector === 'costura_cabedal' && a.sector === 'costura_cabedal'),
    );
    let contractorId = existing?.contractor_id ?? '';
    if (!contractorId && factoryId) {
      // Sem intenção prévia: deixa vazio pra usuário escolher; não força fábrica.
      contractorId = '';
    }
    lines.push({
      demandId: d.id,
      sector,
      contractorId,
      pairsPerDay: existing ? String(existing.pairs_per_day) : String(Math.max(1, Number(d.pairs) || 1)),
      leaveDate: existing?.leave_date || today,
    });
  }
  return lines;
}

export function PostApprovalCabedalDistributeScreen({
  open,
  saleOrderIds,
  reportOrders = [],
  minBillingById = {},
  onDone,
}: Props) {
  const ids = useMemo(
    () => [...new Set(saleOrderIds.filter(Boolean))],
    [saleOrderIds],
  );
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncedKey, setSyncedKey] = useState<string>('');
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [draftsReady, setDraftsReady] = useState(false);

  const syncKey = ids.slice().sort().join(',');

  useEffect(() => {
    if (!open || ids.length === 0) return;
    if (syncedKey === syncKey) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      setSyncError(null);
      setDraftsReady(false);
      try {
        await syncCabedalPrepDemandsForSaleOrders(ids);
        if (!cancelled) setSyncedKey(syncKey);
      } catch (e) {
        if (!cancelled) {
          setSyncError(e instanceof Error ? e.message : 'Falha ao sincronizar demandas');
        }
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, ids, syncKey, syncedKey]);

  const { data: demands = [], isLoading, isError, error, refetch } = useCabedalPrepDemands({
    saleOrderIds: open && syncedKey === syncKey ? ids : [],
  });
  const { data: contractors = [] } = useCabedalPrepContractors();
  const savePlan = useSaveCabedalPrepAllocations();

  const factoryId = useMemo(() => {
    const hit = contractors.find((c) => Number(c.payment_days) >= 999);
    return hit?.id ?? null;
  }, [contractors]);

  const eligibleDemands = useMemo(
    () => demands.filter((d) => sectorsForPostApprovalDemand(d).length > 0),
    [demands],
  );

  useEffect(() => {
    if (!open || syncing || syncedKey !== syncKey || isLoading) return;
    setDrafts(buildInitialDrafts(eligibleDemands, factoryId));
    setDraftsReady(true);
  }, [open, syncing, syncedKey, syncKey, isLoading, eligibleDemands, factoryId]);

  const reportRows: AutoBillingReportRow[] = useMemo(() => {
    if (reportOrders.length === 0) return [];
    return buildAutoBillingReport({ orders: reportOrders, minBillingById });
  }, [reportOrders, minBillingById]);

  const showReport = reportRows.length > 1 || reportRows.some((r) => r.isAutomaticMin || r.isInfeasible);

  const demandById = useMemo(() => {
    const m = new Map<string, CabedalPrepDemandRow>();
    for (const d of eligibleDemands) m.set(d.id, d);
    return m;
  }, [eligibleDemands]);

  const softWarnings = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of drafts) {
      const d = demandById.get(line.demandId);
      if (!d) continue;
      const contractorId = line.contractorId === INTERNAL_VALUE
        ? (factoryId || '')
        : line.contractorId;
      if (!contractorId) continue;
      const sched = scheduleAllocation({
        contractorId,
        sector: line.sector,
        pairs: Number(d.pairs),
        pairsPerDay: Number(line.pairsPerDay) || 1,
        leaveDate: line.leaveDate,
      });
      const ready = effectiveReadyDate(d);
      if (sched && ready && sched.endDate > ready) {
        map.set(
          line.demandId,
          `Término estimado ${formatIsoBr(sched.endDate)} depois da meta ${formatIsoBr(ready)}`,
        );
      }
    }
    return map;
  }, [drafts, demandById, factoryId]);

  const patchLine = (demandId: string, patch: Partial<DraftLine>) => {
    setDrafts((prev) =>
      prev.map((l) => (l.demandId === demandId ? { ...l, ...patch } : l)),
    );
  };

  const handleConfirm = async () => {
    if (eligibleDemands.length === 0) {
      onDone();
      return;
    }
    if (!factoryId && drafts.some((l) => !l.contractorId || l.contractorId === INTERNAL_VALUE)) {
      toast.error('Cadastre o prestador FÁBRICA (payment_days ≥ 999) para “Manter interno”.');
      return;
    }

    try {
      for (const d of eligibleDemands) {
        const line = drafts.find((l) => l.demandId === d.id);
        if (!line) continue;
        let contractorId = line.contractorId;
        if (!contractorId || contractorId === INTERNAL_VALUE) {
          contractorId = factoryId!;
        }
        const rows: SaveAllocationInput[] = [{
          demandId: d.id,
          contractorId,
          sector: line.sector,
          pairs: Number(d.pairs),
          pairsPerDay: Math.max(1, Number(line.pairsPerDay) || 1),
          leaveDate: line.leaveDate || todayIso(),
          isFactoryOvertime: contractorId === factoryId,
        }];
        await savePlan.mutateAsync({
          demandId: d.id,
          demandPairs: Number(d.pairs),
          readyDate: effectiveReadyDate(d),
          rows,
          lockPlan: true,
        });
      }
      toast.success('Distribuição de cabedal travada. Gere as OS depois em Terceirizados → Prep. cabedal.');
      onDone();
    } catch {
      // toast já no onError da mutation
    }
  };

  if (!open) return null;

  const loading = syncing || isLoading || !draftsReady;

  return (
    <div className="fixed inset-0 z-modal flex flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <div className="min-w-0 space-y-0.5">
          <p className="eyebrow text-muted-foreground">Aprovação · Prep. cabedal</p>
          <h1 className="truncate font-display text-lg tracking-tight text-foreground md:text-xl">
            Distribuir costura e aviamento
          </h1>
          <p className="text-sm text-muted-foreground">
            Escolha o ateliê (ou fábrica). Confirmar trava o plano — OS fica para o hub.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onDone} disabled={savePlan.isPending}>
            Pular (resolvo depois)
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={loading || savePlan.isPending || Boolean(syncError)}>
            {savePlan.isPending ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Salvando…</>
            ) : (
              <><CheckCircle className="mr-1.5 h-4 w-4" /> Confirmar e travar</>
            )}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {showReport && (
            <Panel className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Handshake className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Datas de faturamento</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Destaca pedidos cuja data de entrega/fat. é a mínima viável (entrada automática).
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">PV</th>
                      <th className="px-3 py-2 font-medium">Entrega / Fat.</th>
                      <th className="px-3 py-2 font-medium">Mín. viável</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((r) => (
                      <tr key={r.saleOrderId} className="border-t border-border">
                        <td className="px-3 py-2 font-mono font-semibold">{r.orderNumber}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{formatIsoBr(r.deliveryDeadline)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{formatIsoBr(r.minBillingDate)}</td>
                        <td className="px-3 py-2">
                          {r.isInfeasible ? (
                            <Badge variant="outline" className="border-destructive/40 text-destructive">Inviável (&lt; mín.)</Badge>
                          ) : r.isAutomaticMin ? (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-600">Na mínima automática</Badge>
                          ) : (
                            <span className="text-muted-foreground">Manual / folgada</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {syncError && (
            <Panel className="flex items-start gap-3 border-destructive/40 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-2">
                <p className="text-sm text-foreground">{syncError}</p>
                <Button size="sm" variant="outline" onClick={() => { setSyncedKey(''); setSyncError(null); }}>
                  Tentar de novo
                </Button>
              </div>
            </Panel>
          )}

          {loading && !syncError && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Preparando demandas de cabedal…
            </div>
          )}

          {isError && !loading && (
            <EmptyState
              icon={AlertTriangle}
              title="Não foi possível carregar as demandas"
              description={(error as Error)?.message || 'Tente de novo.'}
              action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Recarregar</Button>}
            />
          )}

          {!loading && !syncError && !isError && eligibleDemands.length === 0 && (
            <EmptyState
              icon={Scissors}
              title="Nada a distribuir em costura/aviamento"
              description="Este(s) pedido(s) não geraram demanda de Prep. cabedal nesses setores. Você pode pular e seguir."
              action={<Button size="sm" onClick={onDone}>Continuar</Button>}
            />
          )}

          {!loading && !syncError && drafts.length > 0 && (
            <div className="space-y-3">
              {drafts.map((line) => {
                const d = demandById.get(line.demandId);
                if (!d) return null;
                const sectorOptions = sectorsForPostApprovalDemand(d);
                const warn = softWarnings.get(line.demandId);
                const ready = effectiveReadyDate(d);
                return (
                  <Panel key={line.demandId} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">
                            {d.sale_orders?.order_number ?? 'PV'}
                          </span>
                          <Badge variant="outline">{d.reference_code || '—'}</Badge>
                          {d.color && (
                            <span className="text-xs text-muted-foreground">{d.color}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {Number(d.pairs).toLocaleString('pt-BR')} pares · meta{' '}
                          <span className="font-mono">{formatIsoBr(ready)}</span>
                          {d.billing_week ? ` · sem. ${d.billing_week}` : ''}
                        </p>
                      </div>
                      {warn && (
                        <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Capacidade / prazo
                        </Badge>
                      )}
                    </div>

                    {warn && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{warn}</p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Setor</Label>
                        <Select
                          value={line.sector}
                          onValueChange={(v) => patchLine(line.demandId, { sector: v as CabedalPrepSector })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {sectorOptions.map((s) => (
                              <SelectItem key={s} value={s}>{postApprovalSectorLabel(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Prestador</Label>
                        <Select
                          value={line.contractorId || undefined}
                          onValueChange={(v) => patchLine(line.demandId, { contractorId: v })}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="Selecionar…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={INTERNAL_VALUE}>
                              <span className="flex items-center gap-1.5">
                                <Factory className="h-3.5 w-3.5" /> Manter interno (fábrica)
                              </span>
                            </SelectItem>
                            {contractors
                              .filter((c) => Number(c.payment_days) < 999)
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <footer className={cn(
        'flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 md:px-6',
        'bg-muted/30',
      )}>
        <p className="text-xs text-muted-foreground">
          {eligibleDemands.length} demanda(s) · aviso âmbar não bloqueia — você pode manter interno.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onDone} disabled={savePlan.isPending}>
            Pular
          </Button>
          <Button size="sm" onClick={() => void handleConfirm()} disabled={loading || savePlan.isPending || Boolean(syncError)}>
            Confirmar e travar
          </Button>
        </div>
      </footer>
    </div>
  );
}
