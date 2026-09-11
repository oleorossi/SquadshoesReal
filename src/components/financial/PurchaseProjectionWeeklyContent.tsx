import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Warning as AlertTriangle,
  CircleNotch as Loader2,
  ShoppingCart,
  CalendarBlank,
} from '@phosphor-icons/react';
import { useAccessControl } from '@/hooks/useAccessControl';
import { useGeneratePOFromMrp } from '@/hooks/useMrp';
import { usePurchaseProjectionWeekly } from '@/hooks/usePurchaseProjectionWeekly';
import {
  FIRM_HORIZON_WEEKS,
  type PeriodMode,
} from '@/lib/purchaseProjectionWeekly';
import { SECTOR_OPTIONS } from '@/lib/categoryFromGroup';
import { formatCurrency } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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

function formatWeekLabel(weekStart: string): string {
  try {
    const d = parseISO(weekStart);
    return format(d, "dd/MM", { locale: ptBR });
  } catch {
    return weekStart;
  }
}

function formatQty(n: number, unit: string): string {
  const v = Number.isFinite(n) ? n : 0;
  const rounded = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  return `${rounded} ${unit}`;
}

export default function PurchaseProjectionWeeklyContent() {
  const { canSeeFinancialValues } = useAccessControl();
  const genPO = useGeneratePOFromMrp();

  const [horizonWeeks, setHorizonWeeks] = useState(FIRM_HORIZON_WEEKS);
  const [periodMode, setPeriodMode] = useState<PeriodMode>('semana');
  const [sector, setSector] = useState<string>('Todos');
  const [groupId, setGroupId] = useState<string>('Todos');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyGap, setOnlyGap] = useState(false);
  const [onlyNoPrice, setOnlyNoPrice] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    weeks,
    rows,
    monthlyRows,
    cashByWeek,
    groups,
    isLoading,
    isError,
    refetch,
  } = usePurchaseProjectionWeekly({
    horizonWeeks,
    sector: sector === 'Todos' ? null : sector,
    groupId: groupId === 'Todos' ? null : groupId,
    periodMode,
    onlyOverdue,
    onlyGap,
    onlyNoPrice,
  });

  const groupsForSector = useMemo(() => {
    if (sector === 'Todos') return groups;
    if (sector === 'Sem setor') return groups.filter((g) => !g.sector || g.sector === '—');
    return groups.filter((g) => g.sector === sector);
  }, [groups, sector]);

  const selectableRows = rows.filter((r) => r.selectable);
  const showMonthly = periodMode !== 'semana';

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === selectableRows.length
        ? new Set()
        : new Set(selectableRows.map((r) => r.productId)),
    );
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = () => {
    const ids = selected.size ? [...selected] : undefined;
    genPO.mutate(ids, {
      onSuccess: () => {
        setSelected(new Set());
        refetch();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Não foi possível carregar a projeção"
        description="Falha ao buscar necessidades do MRP. Tente de novo."
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Período
          </label>
          <Select
            value={periodMode}
            onValueChange={(v) => setPeriodMode(v as PeriodMode)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semana">Semana</SelectItem>
              <SelectItem value="quinzena1">1ª quinzena</SelectItem>
              <SelectItem value="quinzena2">2ª quinzena</SelectItem>
              <SelectItem value="mes">Mês</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Horizonte
          </label>
          <Select
            value={String(horizonWeeks)}
            onValueChange={(v) => setHorizonWeeks(Number(v))}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 semanas</SelectItem>
              <SelectItem value="6">6 semanas</SelectItem>
              <SelectItem value="8">8 semanas</SelectItem>
              <SelectItem value="12">12 semanas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Setor
          </label>
          <Select
            value={sector}
            onValueChange={(v) => {
              setSector(v);
              setGroupId('Todos');
            }}
          >
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos</SelectItem>
              <SelectItem value="Sem setor">Sem setor</SelectItem>
              {SECTOR_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Grupo
          </label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todos">Todos</SelectItem>
              {groupsForSector.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground pb-2">
          <Checkbox
            checked={onlyOverdue}
            onCheckedChange={(v) => setOnlyOverdue(Boolean(v))}
          />
          Só atrasados
        </label>
        {showMonthly && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground pb-2">
            <Checkbox
              checked={onlyGap}
              onCheckedChange={(v) => setOnlyGap(Boolean(v))}
            />
            Só com gap
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground pb-2">
          <Checkbox
            checked={onlyNoPrice}
            onCheckedChange={(v) => setOnlyNoPrice(Boolean(v))}
          />
          Sem preço
        </label>

        <div className="ml-auto flex items-center gap-2 pb-0.5">
          <Button
            size="sm"
            disabled={genPO.isPending || selectableRows.length === 0}
            onClick={handleGenerate}
          >
            {genPO.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            {selected.size > 0
              ? `Gerar OC (${selected.size})`
              : 'Gerar OC (selecionáveis)'}
          </Button>
        </div>
      </div>

      {/* Totais de caixa por semana de compra */}
      {!showMonthly && canSeeFinancialValues && (
        <div className="flex flex-wrap gap-2">
          {weeks.map((w) => {
            const total = cashByWeek[w.weekStart] || 0;
            return (
              <div
                key={w.weekStart}
                className="rounded-sm border border-border bg-muted/30 px-3 py-2 min-w-[110px]"
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Caixa · sem {formatWeekLabel(w.weekStart)}
                  {w.allowsForecast ? ' · forecast' : ''}
                </p>
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatCurrency(total)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {horizonWeeks > FIRM_HORIZON_WEEKS && (
        <p className="text-xs text-muted-foreground">
          Semanas 5+ podem incluir forecast (quando disponível). Compra integrada
          só aceita demanda firme.
        </p>
      )}

      {/* Grade semanal */}
      {!showMonthly && (
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState
              icon={CalendarBlank}
              title="Nenhuma necessidade no horizonte"
              description="Não há material a comprar nas semanas filtradas. Confira PVs/OPs ativos ou amplie o horizonte."
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link to="/sales">Ver pedidos</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          selectableRows.length > 0 &&
                          selected.size === selectableRows.length
                        }
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Grupo</TableHead>
                    <TableHead className="text-right">Necessidade</TableHead>
                    <TableHead>Usar em</TableHead>
                    <TableHead>Comprar até</TableHead>
                    {canSeeFinancialValues && (
                      <TableHead className="text-right">R$</TableHead>
                    )}
                    <TableHead>Alertas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.key}
                      className={r.overdue ? 'bg-destructive/5' : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          disabled={!r.selectable}
                          checked={selected.has(r.productId)}
                          onCheckedChange={() => toggleRow(r.productId)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.productName}</div>
                        {r.color && (
                          <div className="text-[11px] text-muted-foreground">
                            {r.color}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.sector}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.groupName || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(r.qtyNet, r.unit)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.useDate
                          ? format(parseISO(r.useDate), 'dd/MM/yyyy')
                          : '—'}
                        {r.useWeekStart && (
                          <div className="text-[10px] text-muted-foreground">
                            sem {formatWeekLabel(r.useWeekStart)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.buyByDate ? (
                          <span
                            className={
                              r.overdue
                                ? 'text-sm font-semibold text-destructive'
                                : 'text-sm font-semibold text-foreground'
                            }
                          >
                            {format(parseISO(r.buyByDate), 'dd/MM/yyyy')}
                          </span>
                        ) : (
                          '—'
                        )}
                        {r.buyWeekStart && (
                          <div className="text-[10px] text-muted-foreground">
                            caixa sem {formatWeekLabel(r.buyWeekStart)}
                          </div>
                        )}
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.amountNeed)}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.overdue && (
                            <Badge variant="destructive" className="text-[10px]">
                              Atrasado
                            </Badge>
                          )}
                          {r.noPrice && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
                            >
                              Sem preço no cadastro
                            </Badge>
                          )}
                          {r.leadTimeMissing && (
                            <Badge variant="outline" className="text-[10px]">
                              Lead time ausente
                            </Badge>
                          )}
                          {r.isForecast && (
                            <Badge variant="secondary" className="text-[10px]">
                              Forecast
                            </Badge>
                          )}
                          {r.isArtisanal && (
                            <Badge variant="secondary" className="text-[10px]">
                              Artesanal
                            </Badge>
                          )}
                          {r.isPackaging && (
                            <Badge variant="secondary" className="text-[10px]">
                              Embalagem
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      )}

      {/* Modo mês / quinzena — avaliação */}
      {showMonthly && (
        <Panel flush>
          {monthlyRows.length === 0 ? (
            <EmptyState
              icon={CalendarBlank}
              title="Sem dados no período"
              description="Nenhuma necessidade no filtro atual de quinzena/mês."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead className="text-right">Necessidade</TableHead>
                    {canSeeFinancialValues && (
                      <TableHead className="text-right">Nec. R$</TableHead>
                    )}
                    <TableHead className="text-right">OC aberta</TableHead>
                    {canSeeFinancialValues && (
                      <TableHead className="text-right">OC R$</TableHead>
                    )}
                    <TableHead className="text-right">Recebido</TableHead>
                    {canSeeFinancialValues && (
                      <TableHead className="text-right">Rec. R$</TableHead>
                    )}
                    <TableHead className="text-right">Gap</TableHead>
                    <TableHead className="text-right">Cobertura</TableHead>
                    <TableHead>Alertas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyRows.map((r) => (
                    <TableRow key={r.productId}>
                      <TableCell className="font-medium text-sm">
                        {r.productName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.sector}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(r.needQty, r.unit)}
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.needBrl)}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(r.ocOpenQty, r.unit)}
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.ocOpenBrl)}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(r.receivedQty, r.unit)}
                      </TableCell>
                      {canSeeFinancialValues && (
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.receivedBrl)}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(r.gap, r.unit)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {(r.coveragePct * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.overdue && (
                            <Badge variant="destructive" className="text-[10px]">
                              Atrasado
                            </Badge>
                          )}
                          {r.noPrice && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
                            >
                              Sem preço
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
