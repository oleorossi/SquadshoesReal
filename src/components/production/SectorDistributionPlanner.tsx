/**
 * SectorDistributionPlanner — capacidade dinâmica por referência (Fases A+B).
 *
 * Tela única que combina:
 *  1. Picker de semana (4 semanas pra frente)
 *  2. Botão "Auto-distribuir" (greedy via RPC)
 *  3. Overview matrix (refs × setores): demanda + capacidade + bottleneck
 *  4. Editor expansível por setor (refs × dias Seg-Sex), com lock + inline edit
 *
 * NÃO suporta drag-and-drop ainda — input numérico inline. Dia bloqueado é
 * pulado pelo auto-fill (gestor pode travar uma alocação antes de re-rodar).
 */
import { useMemo, useState } from 'react';
import { Lock, LockOpen, MagicWand as Wand, ChartBar, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useSectorLoadByReference, useSectorDistribution, useAutoFillSectorDistribution,
  useUpsertDistributionCell, SECTORS, SECTOR_CAP_FIELD, isoWeekStart,
  type SectorLoadByRef, type SectorName,
} from '@/hooks/useSectorDistribution';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/ErrorState';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'] as const;

/** Lista de semanas a oferecer no picker (atual + 4 próximas). */
function nextWeeks(count = 5): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i * 7);
    const iso = isoWeekStart(d);
    const start = new Date(iso + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    out.push({ iso, label: `${fmt(start)} a ${fmt(end)}` });
  }
  return out;
}

export default function SectorDistributionPlanner() {
  const weeks = useMemo(() => nextWeeks(5), []);
  const [weekStart, setWeekStart] = useState<string>(weeks[0].iso);
  const [expandedSector, setExpandedSector] = useState<SectorName | null>(null);

  const loadQ = useSectorLoadByReference(weekStart);
  const planQ = useSectorDistribution(weekStart);
  const autoFill = useAutoFillSectorDistribution();
  const upsert = useUpsertDistributionCell();

  // ⚠ Os dois `?? []` abaixo são o default de CONVENIÊNCIA, não de verdade:
  // quando a consulta falha eles produzem exatamente a mesma tela de "semana
  // sem nada planejado". Por isso `isError` é lido nos dois — a carga bloqueia
  // a tela com erro, e o plano salvo bloqueia a EDIÇÃO (célula vazia por falha
  // não pode ser confundida com célula zerada de propósito).
  const loads = loadQ.data ?? [];
  const plan = planQ.data ?? [];

  // Por (sector, ref, day) → pairs_planned (default 0)
  const planMap = useMemo(() => {
    const m = new Map<string, { pairs: number; locked: boolean; id?: string }>();
    for (const p of plan) {
      m.set(`${p.sector}|${p.tech_sheet_id}|${p.day_of_week}`, {
        pairs: p.pairs_planned, locked: p.is_locked, id: p.id,
      });
    }
    return m;
  }, [plan]);

  // Por sector → { totalDemand, weightedCap, daysUsedSum, status, refs[] }
  const sectorStats = useMemo(() => {
    const out = new Map<SectorName, {
      refs: Array<SectorLoadByRef & { cap: number; daysNeeded: number }>;
      totalDemand: number;
      weightedCapDay: number;
      daysNeededSum: number;
    }>();
    for (const s of SECTORS) {
      const refsHere = loads
        .map(r => ({ ...r, cap: r[SECTOR_CAP_FIELD[s]] || 0 }))
        .filter(r => r.cap > 0)
        .map(r => ({ ...r, daysNeeded: r.cap > 0 ? r.total_qty / r.cap : 0 }));
      const totalDemand = refsHere.reduce((a, b) => a + b.total_qty, 0);
      const weightedCapDay = refsHere.length > 0
        ? refsHere.reduce((a, b) => a + b.cap * b.total_qty, 0) / Math.max(totalDemand, 1)
        : 0;
      const daysNeededSum = refsHere.reduce((a, b) => a + b.daysNeeded, 0);
      out.set(s, { refs: refsHere, totalDemand, weightedCapDay, daysNeededSum });
    }
    return out;
  }, [loads]);

  const overallBottleneck = Array.from(sectorStats.values()).some(s => s.daysNeededSum > 5);

  /**
   * Duas falhas DIFERENTES do plano salvo, com consequências diferentes:
   *
   *  • `planNeverLoaded` — erro sem nenhum sucesso antes: `planQ.data` é
   *    `undefined`, o `planMap` nasce vazio e TODA célula do editor lê
   *    `0 / destravada`. Editar aí grava zero por cima do que está no banco e
   *    destrava célula travada (o upsert manda `is_locked: locked`, lido do
   *    mapa fantasma). Por isso a edição fica bloqueada.
   *  • `planStale` — o refetch falhou mas o react-query preservou o último
   *    `data` bom: as células mostram valores REAIS, só velhos. Aqui basta
   *    avisar; bloquear seria alarme falso.
   */
  const planNeverLoaded = planQ.isError && planQ.data === undefined;
  const planStale = planQ.isError && planQ.data !== undefined;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="py-3 px-4 bg-muted/30 border-b flex flex-row items-center gap-3 flex-wrap">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <ChartBar className="h-4 w-4 text-primary" />
          Distribuição por referência
        </CardTitle>
        <div className="flex-1" />
        <Select value={weekStart} onValueChange={setWeekStart}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {weeks.map((w, i) => (
              <SelectItem key={w.iso} value={w.iso}>
                {i === 0 ? 'Esta semana' : i === 1 ? 'Próxima semana' : `Semana de ${w.label}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="default"
          className="h-8 gap-1.5"
          disabled={autoFill.isPending || loads.length === 0}
          onClick={() => autoFill.mutate(weekStart)}
        >
          <Wand className="h-3.5 w-3.5" />
          Auto-distribuir (greedy)
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {loadQ.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : loadQ.isError ? (
          <ErrorState
            size="sm"
            title="Não foi possível carregar a carga da semana"
            description={`A consulta falhou — isto NÃO quer dizer semana sem OP planejada. ${
              (loadQ.error as Error)?.message || ''
            }`.trim()}
            onRetry={() => void loadQ.refetch()}
          />
        ) : loads.length === 0 ? (
          <EmptyState
            icon={ChartBar}
            title="Nenhuma OP planejada nesta semana"
            description="Defina planned_delivery em OPs ativas pra ver a distribuição."
            size="sm"
          />
        ) : Array.from(sectorStats.values()).every(s => s.refs.length === 0) ? (
          <EmptyState
            icon={AlertTriangle}
            title="Fichas técnicas sem capacidade configurada"
            description="As referências planejadas nesta semana não têm capacidade/dia definida em nenhum setor (corte/costura/montagem/etc). Configure em Fichas Técnicas → aba Operações pra ativar a distribuição."
            size="sm"
          />
        ) : (
          <>
            {/* A matriz abaixo vem da CARGA (loads), não do plano — segue válida
                e visível mesmo quando o plano salvo falha. O que o plano quebra
                é só o editor por dia. */}
            {(planNeverLoaded || planStale) && (
              <div
                className={cn(
                  'px-4 py-2 border-b text-xs flex items-center gap-2 flex-wrap',
                  planNeverLoaded
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-500',
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 min-w-[220px]">
                  {planNeverLoaded ? (
                    <>
                      O plano já salvo desta semana <strong>não carregou</strong> — as células do editor
                      mostrariam 0 por falha de consulta, não por estarem vazias. Edição bloqueada até recarregar.
                    </>
                  ) : (
                    <>
                      A última atualização do plano <strong>falhou</strong> — os dias abaixo são a leitura
                      anterior, podem estar desatualizados.
                    </>
                  )}
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => void planQ.refetch()}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {overallBottleneck && (
              <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/30 text-xs text-destructive flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Pelo menos um setor está acima da capacidade semanal (5 dias úteis). Veja células vermelhas abaixo.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b border-border/60">
                  <tr>
                    <th className="text-left px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Setor</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Refs</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Pares</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Cap/dia (média)</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Dias necessários</th>
                    <th className="text-center px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground">Status</th>
                    <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-xs text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {SECTORS.map((sector) => {
                    const s = sectorStats.get(sector)!;
                    if (s.refs.length === 0) return null;
                    const isExpanded = expandedSector === sector;
                    const statusColor = s.daysNeededSum > 5 ? 'destructive'
                                     : s.daysNeededSum > 4 ? 'warning'
                                     : 'success';
                    return (
                      <>
                        <tr key={sector} className={cn('hover:bg-muted/30', isExpanded && 'bg-muted/20')}>
                          <td className="px-3 py-2 font-medium">{sector}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.refs.length}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.totalDemand.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{Math.round(s.weightedCapDay)}</td>
                          <td className={cn('px-3 py-2 text-right font-mono font-semibold',
                            s.daysNeededSum > 5 ? 'text-destructive'
                            : s.daysNeededSum > 4 ? 'text-amber-600 dark:text-amber-500'
                            : 'text-emerald-600 dark:text-emerald-500'
                          )}>
                            {s.daysNeededSum.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="outline" className={cn(
                              'text-xs uppercase tracking-wider',
                              statusColor === 'destructive' && 'border-destructive/40 text-destructive',
                              statusColor === 'warning' && 'border-amber-500/40 text-amber-600 dark:text-amber-500',
                              statusColor === 'success' && 'border-emerald-500/40 text-emerald-600 dark:text-emerald-500',
                            )}>
                              {statusColor === 'destructive' ? 'Gargalo' : statusColor === 'warning' ? 'Apertado' : 'OK'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={planNeverLoaded}
                              title={planNeverLoaded ? 'O plano salvo não carregou — recarregue antes de editar os dias' : undefined}
                              onClick={() => setExpandedSector(isExpanded ? null : sector)}
                            >
                              {isExpanded ? 'Ocultar' : 'Editar dias'}
                            </Button>
                          </td>
                        </tr>
                        {isExpanded && !planNeverLoaded && (
                          <tr>
                            <td colSpan={7} className="p-0 bg-muted/10 border-t border-border/40">
                              <SectorDayEditor
                                sector={sector}
                                refs={s.refs}
                                planMap={planMap}
                                weekStart={weekStart}
                                onUpsert={(args) => upsert.mutate(args)}
                                isSaving={upsert.isPending}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Sub-tabela: refs × Seg-Sex pra um setor, com input editável por célula. */
function SectorDayEditor({
  sector, refs, planMap, weekStart, onUpsert, isSaving,
}: {
  sector: SectorName;
  refs: Array<SectorLoadByRef & { cap: number; daysNeeded: number }>;
  planMap: Map<string, { pairs: number; locked: boolean; id?: string }>;
  weekStart: string;
  onUpsert: (args: { week_start: string; sector: string; tech_sheet_id: string; day_of_week: number; pairs_planned: number; is_locked?: boolean }) => void;
  isSaving: boolean;
}) {
  // Totais por dia (todas as refs deste setor)
  const dayTotals = [1, 2, 3, 4, 5].map(d =>
    refs.reduce((acc, r) => acc + (planMap.get(`${sector}|${r.tech_sheet_id}|${d}`)?.pairs ?? 0), 0)
  );

  // Capacidade ponderada do dia (referência pra mostrar % de uso)
  const totalDemand = refs.reduce((a, b) => a + b.total_qty, 0);
  const weightedDailyCap = totalDemand > 0
    ? refs.reduce((a, b) => a + b.cap * b.total_qty, 0) / totalDemand
    : 0;

  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-xs uppercase tracking-wider">
            <th className="text-left px-2 py-1">Referência</th>
            <th className="text-right px-2 py-1">Total OP</th>
            <th className="text-right px-2 py-1">Cap/dia</th>
            {DAY_LABELS.map((d, i) => (
              <th key={i} className="text-center px-2 py-1">{d}</th>
            ))}
            <th className="text-right px-2 py-1">Planejado</th>
            <th className="text-right px-2 py-1">Restante</th>
          </tr>
        </thead>
        <tbody>
          {refs.map((ref) => {
            const planned = [1, 2, 3, 4, 5].reduce((acc, d) =>
              acc + (planMap.get(`${sector}|${ref.tech_sheet_id}|${d}`)?.pairs ?? 0), 0);
            const remaining = ref.total_qty - planned;
            return (
              <tr key={ref.tech_sheet_id} className="border-t border-border/30">
                <td className="px-2 py-1">
                  <div className="font-medium text-foreground">{ref.reference_code}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[160px]">{ref.reference_name}</div>
                </td>
                <td className="px-2 py-1 text-right font-mono">{ref.total_qty}</td>
                <td className="px-2 py-1 text-right">
                  <span className="font-mono text-muted-foreground">{ref.cap}</span>
                  {ref.capacity_source === 'categoria' && (
                    <span className="ml-1 text-xs uppercase tracking-wider text-amber-600 dark:text-amber-500" title={`Capacidade veio do default de ${ref.shoe_category || 'categoria'} — defina valor próprio na ficha pra customizar`}>cat</span>
                  )}
                  {ref.capacity_source === 'nenhuma' && (
                    <span className="ml-1 text-xs uppercase tracking-wider text-destructive" title="Sem capacidade configurada — defina na ficha ou em default_lead_times">—</span>
                  )}
                </td>
                {[1, 2, 3, 4, 5].map((d) => {
                  const cell = planMap.get(`${sector}|${ref.tech_sheet_id}|${d}`);
                  const val = cell?.pairs ?? 0;
                  const locked = cell?.locked ?? false;
                  return (
                    <td key={d} className="px-1 py-1 text-center">
                      <div className="flex items-center gap-0.5 justify-center">
                        <NumberInput
                          min={0}
                          decimals={0}
                          value={val}
                          disabled={isSaving}
                          onChange={(n) => {
                            const clamped = Math.max(0, Math.min(ref.cap, n));
                            onUpsert({
                              week_start: weekStart, sector, tech_sheet_id: ref.tech_sheet_id,
                              day_of_week: d, pairs_planned: clamped, is_locked: locked,
                            });
                          }}
                          className="h-7 w-14 text-center text-xs font-mono px-1"
                          placeholder="—"
                        />
                        <button
                          type="button"
                          onClick={() => onUpsert({
                            week_start: weekStart, sector, tech_sheet_id: ref.tech_sheet_id,
                            day_of_week: d, pairs_planned: val, is_locked: !locked,
                          })}
                          className={cn('shrink-0', locked ? 'text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground')}
                          title={locked ? 'Travada (não muda no auto-distribuir)' : 'Destravada'}
                        >
                          {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                        </button>
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right font-mono">{planned}</td>
                <td className={cn('px-2 py-1 text-right font-mono', remaining > 0 && 'text-destructive font-semibold')}>
                  {remaining > 0 ? `+${remaining}` : remaining === 0 ? '✓' : remaining}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground">Total dia</td>
            <td colSpan={2}></td>
            {dayTotals.map((t, i) => {
              const pct = weightedDailyCap > 0 ? (t / weightedDailyCap) * 100 : 0;
              return (
                <td key={i} className="px-2 py-1.5 text-center">
                  <div className="font-mono">{t}</div>
                  <div className={cn('text-xs',
                    pct > 100 ? 'text-destructive font-bold' : pct > 80 ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'
                  )}>
                    {pct.toFixed(0)}%
                  </div>
                </td>
              );
            })}
            <td className="px-2 py-1.5 text-right font-mono">{dayTotals.reduce((a, b) => a + b, 0)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
