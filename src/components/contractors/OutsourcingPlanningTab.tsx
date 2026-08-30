import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, addWeeks, format, startOfWeek } from 'date-fns';
import {
  Info, Warning as AlertTriangle, CheckCircle as CheckCircle2, Buildings,
  PaperPlaneTilt, Scissors, Calendar as CalendarIcon,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { ContractorSectionHeader } from '@/components/contractors/ContractorSectionHeader';
import { ContractorSummaryRail } from '@/components/contractors/ContractorSummaryRail';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useSaleOrders, useSaleOrderAllItems } from '@/hooks/useSaleOrders';
import { useContractors, useServiceOrders, useCreateServiceOrder } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import { sheetHasSector } from '@/lib/sectors';

/**
 * Aba "Planejamento" de /terceirizados — projeção semanal (8 semanas) de
 * DEMANDA programada vs CAPACIDADE interna pros setores terceirizáveis:
 * Corte Cabedal e Costura.
 *
 * Demanda: pares dos PVs ativos (status não-terminal) com delivery_deadline
 * na semana, somando só os itens cuja ficha técnica passa pelo setor:
 *   • Costura      → production_sectors contém 'Costura' (via sheetHasSector,
 *                    mesma taxonomia de src/lib/sectors usada pelo motor de
 *                    capacidade sectorCapacity.ts — não divergir).
 *   • Corte Cabedal→ has_straps === false (regra canônica: ficha SEM tiras
 *                    corta cabedal; com tiras o corte é o fluxo de tiras).
 *
 * Capacidade interna semanal — APROXIMAÇÃO documentada:
 * a capacidade/dia é cadastrada POR FICHA TÉCNICA (costura_capacity_per_day /
 * cutting_capacity_per_day), mas a semana mistura fichas diferentes. Usamos a
 * MÉDIA PONDERADA POR PARES das fichas com demanda na semana × 5 dias úteis.
 * Fichas sem capacidade cadastrada entram com 0 no peso (conservador) e geram
 * aviso pra cadastrar. Não é um sequenciamento real (o motor fino por janela
 * vive em src/lib/sectorCapacity.ts) — é uma régua gerencial pra decidir
 * QUANDO designar excedente pra terceirizada.
 */

const WEEKS_AHEAD = 8;
const WORK_DAYS_PER_WEEK = 5;

interface PlanningSheet {
  id: string;
  name: string | null;
  code: string | null;
  production_sectors: unknown;
  has_straps: boolean | null;
  costura_capacity_per_day: number | null;
  cutting_capacity_per_day: number | null;
}

const PLANNING_SECTORS: {
  key: string;
  label: string;
  icon: any;
  appliesTo: (sheet: PlanningSheet) => boolean;
  capPerDay: (sheet: PlanningSheet) => number;
}[] = [
  {
    key: 'corte_cabedal',
    label: 'Corte Cabedal',
    icon: Scissors,
    // Regra canônica: cabedal é cortado quando a ficha NÃO é de tiras.
    appliesTo: (s) => s.has_straps === false,
    capPerDay: (s) => Number(s.cutting_capacity_per_day || 0),
  },
  {
    key: 'costura',
    label: 'Costura',
    icon: Buildings,
    appliesTo: (s) => sheetHasSector(s, 'Costura'),
    capPerDay: (s) => Number(s.costura_capacity_per_day || 0),
  },
];

/** PV em status terminal não gera demanda futura (já saiu da fábrica ou morreu). */
function isTerminalPvStatus(status: string | null | undefined): boolean {
  const s = (status || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return (
    s.startsWith('cancelad') ||
    s.startsWith('faturado') ||
    s.startsWith('expedido') ||
    s.startsWith('concluid') ||
    s.startsWith('finalizad') ||
    s.startsWith('entregue')
  );
}

const OS_TERMINAL_STATUSES = new Set([
  'Concluído', 'Concluido', 'concluido', 'received', 'finalizado', 'Finalizado',
  'Cancelado', 'cancelled', 'cancelado',
]);

interface WeekSectorCell {
  weekIso: string;          // segunda-feira ISO (chave da semana)
  weekLabel: string;
  sectorKey: string;
  sectorLabel: string;
  demand: number;           // pares programados
  capacityWeek: number;     // média ponderada/dia × 5
  capacityPerDay: number;   // média ponderada
  pairsWithoutCap: number;  // pares de fichas sem capacidade cadastrada
  excess: number;           // max(0, demand - capacityWeek)
  pvIds: string[];
  pvNumbers: string[];
  saleOrderItemIds: string[];
}

export function filterOperationalOutsourcingItems<
  T extends { production_excluded_at?: string | null },
>(items: readonly T[]): T[] {
  return items.filter((item) => !item.production_excluded_at);
}

export function buildOutsourcingServiceOrderProvenance(
  cell: Pick<WeekSectorCell, 'pvIds' | 'saleOrderItemIds'>,
) {
  return {
    linked_sale_order_ids: cell.pvIds,
    selected_sale_order_item_ids: cell.saleOrderItemIds,
  };
}

export function OutsourcingPlanningTab() {
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: allItems = [] } = useSaleOrderAllItems();
  const { data: contractors = [] } = useContractors();
  const { data: serviceOrders = [] } = useServiceOrders();
  const createOrder = useCreateServiceOrder();

  // Fichas técnicas: só os campos que o planejamento usa.
  const { data: sheets = [] } = useQuery({
    queryKey: ['technical_sheets_planning'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, name, code, production_sectors, has_straps, costura_capacity_per_day, cutting_capacity_per_day');
      if (error) throw error;
      return (data || []) as PlanningSheet[];
    },
    staleTime: 5 * 60_000,
  });

  // Mini-form "Designar p/ terceirizada"
  const [assignTarget, setAssignTarget] = useState<WeekSectorCell | null>(null);
  const [assignContractorId, setAssignContractorId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const sheetMap = useMemo(() => {
    const m = new Map<string, PlanningSheet>();
    sheets.forEach((s) => m.set(s.id, s));
    return m;
  }, [sheets]);

  const itemsByPv = useMemo(() => {
    const m = new Map<string, any[]>();
    filterOperationalOutsourcingItems(allItems as any[]).forEach((it) => {
      if (!it.sale_order_id) return;
      if (!m.has(it.sale_order_id)) m.set(it.sale_order_id, []);
      m.get(it.sale_order_id)!.push(it);
    });
    return m;
  }, [allItems]);

  const weeks = useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
      const ws = addWeeks(start, i);
      return {
        iso: format(ws, 'yyyy-MM-dd'),
        start: ws,
        end: addDays(ws, 6),
        label: `${format(ws, 'dd/MM')} – ${format(addDays(ws, 6), 'dd/MM')}`,
      };
    });
  }, []);

  /** Rótulo da OS de excedente (display na description). */
  const dedupToken = (cell: Pick<WeekSectorCell, 'sectorLabel' | 'weekIso'>) =>
    `Excedente ${cell.sectorLabel} semana ${cell.weekIso}`;

  /** Já existe OS ATIVA designada pra mesma semana/setor?
   *  Anti-duplicação ESTRUTURAL pelas colunas bottleneck_week + target_sector
   *  (antes era token textual na description — frágil). */
  const hasActiveOsFor = (cell: WeekSectorCell) =>
    serviceOrders.some(
      (o: any) => !OS_TERMINAL_STATUSES.has(o.status)
        && o.bottleneck_week === cell.weekIso
        && (o.target_sector || '') === cell.sectorKey,
    );

  /** Pares JÁ na rua em OSs ativas do mesmo setor cobrindo algum dos PVs —
   *  descontados do excedente (ex.: atalho do PV já mandou corte de cabedal). */
  const pairsAlreadyOutsourced = (sectorKey: string, pvIds: string[]) => {
    const pvSet = new Set(pvIds);
    let pairs = 0;
    for (const o of serviceOrders as any[]) {
      if (OS_TERMINAL_STATUSES.has(o.status)) continue;
      if ((o.target_sector || '') !== sectorKey) continue;
      const linked: string[] = Array.isArray(o.linked_sale_order_ids) ? o.linked_sale_order_ids : [];
      const touches = (o.sale_order_id && pvSet.has(o.sale_order_id)) || linked.some((id) => pvSet.has(id));
      if (touches) pairs += Number(o.quantity || 0);
    }
    return pairs;
  };

  const cells = useMemo<WeekSectorCell[]>(() => {
    const result: WeekSectorCell[] = [];
    const activePvs = (saleOrders as any[]).filter(
      (so) => so.delivery_deadline && !isTerminalPvStatus(so.status),
    );

    for (const week of weeks) {
      const weekEndIso = format(week.end, 'yyyy-MM-dd');
      const pvsInWeek = activePvs.filter(
        (so) => so.delivery_deadline >= week.iso && so.delivery_deadline <= weekEndIso,
      );
      if (pvsInWeek.length === 0) continue;

      for (const sector of PLANNING_SECTORS) {
        let demand = 0;
        let capWeight = 0;        // Σ(pares_i × cap_dia_da_ficha_i)
        let pairsWithoutCap = 0;
        const pvIds = new Set<string>();
        const pvNumbers = new Set<string>();
        const saleOrderItemIds = new Set<string>();

        for (const pv of pvsInWeek) {
          for (const item of itemsByPv.get(pv.id) || []) {
            const qty = Number(item.quantity || 0);
            if (qty <= 0) continue;
            const sheet = item.reference_id ? sheetMap.get(item.reference_id) : undefined;
            if (!sheet || !sector.appliesTo(sheet)) continue;
            demand += qty;
            const cap = sector.capPerDay(sheet);
            if (cap > 0) capWeight += qty * cap;
            else pairsWithoutCap += qty;
            pvIds.add(pv.id);
            pvNumbers.add(pv.order_number || pv.id.slice(0, 8));
            if (item.id) saleOrderItemIds.add(item.id);
          }
        }

        if (demand <= 0) continue;

        // Média ponderada por pares (fichas sem capacidade pesam 0 — conservador).
        const capacityPerDay = demand > 0 ? capWeight / demand : 0;
        const capacityWeek = Math.round(capacityPerDay * WORK_DAYS_PER_WEEK);
        // Desconta o que JÁ está na rua pra este setor×PVs (atalho do PV etc.)
        const alreadyOut = pairsAlreadyOutsourced(sector.key, Array.from(pvIds));
        const excess = Math.max(0, Math.ceil(demand - capacityWeek - alreadyOut));

        result.push({
          weekIso: week.iso,
          weekLabel: week.label,
          sectorKey: sector.key,
          sectorLabel: sector.label,
          demand,
          capacityWeek,
          capacityPerDay,
          pairsWithoutCap,
          excess,
          pvIds: Array.from(pvIds),
          pvNumbers: Array.from(pvNumbers).sort(),
          saleOrderItemIds: Array.from(saleOrderItemIds).sort(),
        });
      }
    }
    return result;
  }, [weeks, saleOrders, itemsByPv, sheetMap]);

  const handleAssign = async () => {
    if (!assignTarget || !assignContractorId) return;
    setAssigning(true);
    try {
      // Tarifa vigente serviço×prestadora — OS de excedente não nasce mais sem preço
      let unitPrice = 0;
      try {
        const { data: rate } = await (supabase as any).rpc('get_contractor_rate', {
          p_contractor_id: assignContractorId,
          p_sector: assignTarget.sectorKey,
          p_date: format(new Date(), 'yyyy-MM-dd'),
        });
        unitPrice = rate != null ? Number(rate) : 0;
      } catch { /* sem tarifa */ }
      if (unitPrice <= 0) {
        toast.error('Cadastre a tarifa R$/par deste prestador e setor antes de emitir a OS.');
        return;
      }
      // Fluxo de planejamento não está ligado a uma OP única, mas preserva a
      // mesma regra operacional: tarifa válida + despacho físico explícito.
      const order_number = await generateServiceOrderNumber();
      await createOrder.mutateAsync({
        contractor_id: assignContractorId,
        order_number,
        description: `${dedupToken(assignTarget)} — ${assignTarget.excess} pares (PVs: ${assignTarget.pvNumbers.join(', ')})`,
        service_date: format(new Date(), 'yyyy-MM-dd'),
        quantity: assignTarget.excess,
        unit_price: unitPrice,
        total_value: unitPrice > 0 ? unitPrice * assignTarget.excess : 0,
        status: 'Pendente',
        target_sector: assignTarget.sectorKey,
        bottleneck_week: assignTarget.weekIso,
        ...buildOutsourcingServiceOrderProvenance(assignTarget),
        dispatch_tracked: true,
        notes: 'Gerada pela aba Planejamento (demanda > capacidade interna). Preço pela tabela vigente.',
      } as any);
      toast.success(`OS de excedente criada — ${assignTarget.sectorLabel}, semana de ${format(new Date(assignTarget.weekIso + 'T00:00:00'), 'dd/MM/yyyy')}.`);
      setAssignTarget(null);
      setAssignContractorId('');
    } catch {
      // useCreateServiceOrder já dispara toast de erro no onError.
    } finally {
      setAssigning(false);
    }
  };

  const activeContractors = contractors.filter((c) => c.active);
  const planningSummary = useMemo(() => cells.reduce((summary, cell) => ({
    demand: summary.demand + cell.demand,
    capacity: summary.capacity + cell.capacityWeek,
    excess: summary.excess + cell.excess,
    withoutCapacity: summary.withoutCapacity + cell.pairsWithoutCap,
    overloadedWindows: summary.overloadedWindows + (cell.excess > 0 ? 1 : 0),
  }), { demand: 0, capacity: 0, excess: 0, withoutCapacity: 0, overloadedWindows: 0 }), [cells]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <ContractorSectionHeader
          eyebrow="PLANEJAMENTO · CAPACIDADE EXTERNA"
          title="Antecipação de excedentes"
          description={`Compare demanda e capacidade nas próximas ${WEEKS_AHEAD} semanas e transforme o excedente em OS antes que ele vire atraso.`}
          actions={(
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                  <Info className="h-3.5 w-3.5" /> Como calculamos
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[320px] text-xs">
                A capacidade/dia é cadastrada por ficha técnica. A semana usa a
                <strong> média ponderada por pares</strong> × {WORK_DAYS_PER_WEEK} dias úteis.
                Fichas sem capacidade pesam zero, de forma conservadora.
              </TooltipContent>
            </Tooltip>
          )}
        />

        <ContractorSummaryRail
          ariaLabel="Resumo do planejamento de terceirização"
          lead={{
            label: 'Janela analisada',
            value: WEEKS_AHEAD,
            hint: 'semanas futuras',
            meta: `${activeContractors.length} prestadores ativos`,
            icon: CalendarIcon,
            progress: Math.min(100, (cells.length / (WEEKS_AHEAD * PLANNING_SECTORS.length)) * 100),
          }}
          metrics={[
            { label: 'Demanda', value: planningSummary.demand.toLocaleString('pt-BR'), hint: 'pares programados', icon: Buildings },
            { label: 'Capacidade', value: planningSummary.capacity.toLocaleString('pt-BR'), hint: 'pares estimados', icon: CheckCircle2, tone: 'success' },
            { label: 'Excedente', value: planningSummary.excess.toLocaleString('pt-BR'), hint: `${planningSummary.overloadedWindows} janelas estouradas`, icon: AlertTriangle, tone: planningSummary.excess > 0 ? 'destructive' : 'default' },
            { label: 'Sem cadastro', value: planningSummary.withoutCapacity.toLocaleString('pt-BR'), hint: 'pares sem capacidade na ficha', icon: Info, tone: planningSummary.withoutCapacity > 0 ? 'warning' : 'default' },
          ]}
        />

        {cells.length === 0 ? (
          <Panel
            eyebrow={`${cells.length} JANELAS · CORTE E COSTURA`}
            title="Mapa semanal de excedentes"
            subtitle="Vermelho exige designação; verde cabe na capacidade interna estimada."
            flush
          >
            <EmptyState
              icon={CalendarIcon}
              title="Nenhuma demanda programada"
              description={`Nenhum PV ativo com prazo de entrega nas próximas ${WEEKS_AHEAD} semanas passa por Corte Cabedal ou Costura.`}
            />
          </Panel>
        ) : (
          <Panel flush>
            <div className="rounded-md border-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead className="w-[130px]">Semana</TableHead>
                    <TableHead className="w-[130px]">Setor</TableHead>
                    <TableHead className="text-right w-[110px]">Demanda</TableHead>
                    <TableHead className="text-right w-[150px]">
                      <span className="inline-flex items-center gap-1">
                        Capacidade/sem
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3 w-3 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[280px] text-xs">
                            Média ponderada por pares da capacidade/dia das fichas da
                            semana × {WORK_DAYS_PER_WEEK} dias úteis (aproximação).
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-right w-[120px]">Excedente</TableHead>
                    <TableHead>PVs</TableHead>
                    <TableHead className="text-right w-[190px]">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cells.map((cell) => {
                    const overloaded = cell.excess > 0;
                    const alreadyAssigned = overloaded && hasActiveOsFor(cell);
                    return (
                      <TableRow
                        key={`${cell.weekIso}-${cell.sectorKey}`}
                        className={cn('transition-colors', overloaded && 'bg-red-500/5 hover:bg-red-500/10')}
                      >
                        <TableCell className="text-xs font-medium tabular-nums whitespace-nowrap">
                          {cell.weekLabel}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{cell.sectorLabel}</TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          {cell.demand.toLocaleString('pt-BR')} pares
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono tabular-nums">
                          {cell.capacityWeek > 0 ? (
                            <div>
                              {cell.capacityWeek.toLocaleString('pt-BR')}
                              <div className="text-[10px] text-muted-foreground font-sans">
                                ~{Math.round(cell.capacityPerDay).toLocaleString('pt-BR')}/dia × {WORK_DAYS_PER_WEEK}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                          {cell.pairsWithoutCap > 0 && (
                            <Badge variant="outline" className="mt-0.5 text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400">
                              {cell.pairsWithoutCap.toLocaleString('pt-BR')} pares sem capacidade na ficha
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {overloaded ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold font-mono text-red-600 dark:text-red-400">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              +{cell.excess.toLocaleString('pt-BR')}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={cell.pvNumbers.join(', ')}>
                          {cell.pvNumbers.join(', ')}
                        </TableCell>
                        <TableCell className="text-right">
                          {overloaded && (
                            alreadyAssigned ? (
                              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> OS já designada
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 text-xs"
                                onClick={() => { setAssignContractorId(''); setAssignTarget(cell); }}
                              >
                                <PaperPlaneTilt className="h-3.5 w-3.5" />
                                Designar p/ terceirizada
                              </Button>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}

        {/* Mini-form de designação do excedente */}
        <Dialog open={!!assignTarget} onOpenChange={(open) => { if (!open) setAssignTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PaperPlaneTilt className="h-5 w-5 text-primary" />
                Designar excedente pra terceirizada
              </DialogTitle>
              <DialogDescription>
                Cria uma OS Pendente com o excedente da semana. O valor por par é definido depois, na própria OS.
              </DialogDescription>
            </DialogHeader>
            {assignTarget && (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Setor</span><span className="font-medium">{assignTarget.sectorLabel}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Semana</span><span className="font-mono tabular-nums">{assignTarget.weekLabel}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Excedente</span><span className="font-mono font-semibold text-red-600 dark:text-red-400">{assignTarget.excess.toLocaleString('pt-BR')} pares</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground shrink-0">PVs</span><span className="text-xs text-right">{assignTarget.pvNumbers.join(', ')}</span></div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Contratada *</label>
                  <Select value={assignContractorId} onValueChange={setAssignContractorId}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecionar contratada ativa..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeContractors.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">Nenhuma contratada ativa cadastrada.</div>
                      )}
                      {activeContractors.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.trade_name || c.name}{c.service_type ? ` — ${c.service_type}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" className="h-9" onClick={() => setAssignTarget(null)} disabled={assigning}>
                Cancelar
              </Button>
              <Button className="h-9 gap-1.5" onClick={handleAssign} disabled={!assignContractorId || assigning}>
                <PaperPlaneTilt className="h-4 w-4" />
                {assigning ? 'Criando OS...' : 'Criar OS de excedente'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
