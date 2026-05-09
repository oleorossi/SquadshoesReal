import { useState, useMemo, useCallback, useEffect } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
import {
  ClipboardList, Package, Printer, Calendar, Search,
  CheckSquare, Square, RotateCcw, TrendingUp, CheckCircle2,
  Loader2, FileText, Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePersistedState } from '@/hooks/usePersistedState';
import { cn } from '@/lib/utils';
import { calculateBomForOrders, type ConsumptionRow, COMPONENT_ORDER, formatUnit } from '@/lib/bomConsumption';
import { toast } from 'sonner';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function getISOWeek(d: Date): { year: number; week: number; monday: Date; sunday: Date } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const original = new Date(d);
  const dow = original.getDay() || 7;
  const monday = new Date(original);
  monday.setDate(original.getDate() - dow + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { year: date.getUTCFullYear(), week, monday, sunday };
}

function fmtBR(d: Date) { return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; }

function currentISOWeekCode(): string {
  const { year, week } = getISOWeek(new Date());
  return `W${year}-${pad(week)}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterMode = 'week' | 'pv' | 'op';

interface WeekGroup {
  code: string;
  monday: Date;
  sunday: Date;
  saleOrderNumbers: string[];
  orderIds: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PickingListPage() {
  const [filterMode, setFilterMode] = useState<FilterMode>('week');
  const [selectedWeek, setSelectedWeek] = useState<string>(currentISOWeekCode());
  const [pvInput, setPvInput] = useState('');
  const [opInput, setOpInput] = useState('');

  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [reportTitle, setReportTitle] = useState('');
  const [reportOrderCount, setReportOrderCount] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);

  const [pickedKeys, setPickedKeys] = usePersistedState<string[]>('picking_bom_checked_v1', []);
  const pickedSet = useMemo(() => new Set(pickedKeys), [pickedKeys]);

  const togglePicked = useCallback((key: string) => {
    setPickedKeys(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return Array.from(s);
    });
  }, [setPickedKeys]);

  const clearPicked = useCallback(() => setPickedKeys([]), [setPickedKeys]);

  // ── Data: all active sale orders (for week grouping) ─────────────────────

  const { data: activeSaleOrders = [] } = useQuery({
    queryKey: ['picking_active_sale_orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_orders')
        .select('id, order_number, delivery_deadline, status')
        .in('status', ['Em Produção', 'Aprovado'])
        .order('delivery_deadline', { ascending: true })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  // ── Week groups derived from active sale orders ───────────────────────────

  const weekGroups = useMemo((): WeekGroup[] => {
    const map = new Map<string, WeekGroup>();
    for (const so of activeSaleOrders) {
      if (!so.delivery_deadline) continue;
      const dl = new Date(so.delivery_deadline);
      if (isNaN(dl.getTime())) continue;
      const iso = getISOWeek(dl);
      const code = `W${iso.year}-${pad(iso.week)}`;
      if (!map.has(code)) {
        map.set(code, { code, monday: iso.monday, sunday: iso.sunday, saleOrderNumbers: [], orderIds: [] });
      }
      map.get(code)!.saleOrderNumbers.push(so.order_number || so.id);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [activeSaleOrders]);

  // ── Calculation trigger ──────────────────────────────────────────────────

  const runCalculation = useCallback(async (orderIds: string[], title: string) => {
    if (orderIds.length === 0) {
      setRows([]);
      setReportTitle(title);
      setReportOrderCount(0);
      return;
    }
    setIsCalculating(true);
    try {
      const result = await calculateBomForOrders(orderIds);
      setRows(result);
      setReportTitle(title);
      setReportOrderCount(orderIds.length);
    } catch (err: any) {
      toast.error('Erro ao calcular consumo', { description: err?.message });
      setRows([]);
    } finally {
      setIsCalculating(false);
    }
  }, []);

  // ── Auto-select first available week when current week has no orders ───────

  useEffect(() => {
    if (filterMode !== 'week') return;
    if (weekGroups.length === 0) return;
    const hasCurrentWeek = weekGroups.some(g => g.code === selectedWeek);
    if (!hasCurrentWeek) setSelectedWeek(weekGroups[0].code);
  }, [filterMode, weekGroups]); // intentionally omitting selectedWeek — only runs when weekGroups changes

  // ── Week mode: fetch OPs and calculate BOM when week selection changes ────

  useEffect(() => {
    if (filterMode !== 'week') return;
    const group = weekGroups.find(g => g.code === selectedWeek);
    if (!group) { setRows([]); return; }

    const soNumbers = group.saleOrderNumbers;
    if (soNumbers.length === 0) { setRows([]); return; }

    const soIds = activeSaleOrders
      .filter(so => soNumbers.includes(so.order_number || so.id))
      .map(so => so.id);

    if (soIds.length === 0) { setRows([]); return; }

    let cancelled = false;

    (async () => {
      setIsCalculating(true);
      try {
        const { data: ops } = await supabase
          .from('orders')
          .select('id')
          .in('sale_order_id', soIds)
          // Include lower-case + alternate spellings — picking list must skip
          // cancelled / finalized OPs regardless of casing.
          .not('status', 'in', '("Cancelada","cancelada","Finalizado","finalizado","Cancelado","cancelado")');
        if (cancelled) return;
        const opIds = (ops || []).map((o: any) => o.id);
        const title = `Onda ${group.code} · ${fmtBR(group.monday)}–${fmtBR(group.sunday)} (${soNumbers.length} PVs)`;
        await runCalculation(opIds, title);
      } catch (err: any) {
        if (!cancelled) {
          toast.error('Erro ao buscar OPs da semana', { description: err?.message });
          setIsCalculating(false);
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, selectedWeek, weekGroups]);

  // ── PV search ────────────────────────────────────────────────────────────

  const handleSearchByPV = useCallback(async () => {
    const numbers = pvInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (numbers.length === 0) return;
    setIsCalculating(true);
    try {
      const { data: sos } = await supabase
        .from('sale_orders')
        .select('id, order_number')
        .in('order_number', numbers);
      const soIds = (sos || []).map((so: any) => so.id);
      const { data: ops } = await supabase
        .from('orders')
        .select('id')
        .in('sale_order_id', soIds)
        .not('status', 'in', '("Cancelada","cancelada","Finalizado","finalizado","Cancelado","cancelado")');
      const opIds = (ops || []).map((o: any) => o.id);
      const pvList = (sos || []).map((so: any) => so.order_number).join(', ');
      await runCalculation(opIds, `PVs: ${pvList}`);
    } catch (err: any) {
      toast.error('Erro ao buscar PVs', { description: err?.message });
      setIsCalculating(false);
    }
  }, [pvInput, runCalculation]);

  // ── OP search ────────────────────────────────────────────────────────────

  const handleSearchByOP = useCallback(async () => {
    const numbers = opInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (numbers.length === 0) return;
    setIsCalculating(true);
    try {
      const { data: ops } = await supabase
        .from('orders')
        .select('id, order_number')
        .in('order_number', numbers);
      const opIds = (ops || []).map((o: any) => o.id);
      const opList = (ops || []).map((o: any) => o.order_number).join(', ');
      await runCalculation(opIds, `OPs: ${opList}`);
    } catch (err: any) {
      toast.error('Erro ao buscar OPs', { description: err?.message });
      setIsCalculating(false);
    }
  }, [opInput, runCalculation]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const rowKey = (row: ConsumptionRow) =>
    `${row.componentType}||${row.groupName}||${row.color}||${row.productUnit}`;

  const grouped = useMemo(() => {
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of rows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [rows]);

  const totalItems = rows.length;
  const pickedItems = rows.filter(r => pickedSet.has(rowKey(r))).length;
  const completionPct = totalItems > 0 ? Math.round((pickedItems / totalItems) * 100) : 0;
  const allDone = totalItems > 0 && pickedItems === totalItems;

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    return map;
  }, [rows]);

  // ── Print ─────────────────────────────────────────────────────────────────

  const handlePrint = useCallback(() => {
    const tableRows = rows.map(row => {
      const key = rowKey(row);
      const done = pickedSet.has(key);
      return `<tr${done ? ' style="background:#f0fdf4"' : ''}>
        <td style="text-align:center;font-size:16px;padding:4px 8px">${done ? '✅' : '☐'}</td>
        <td style="padding:4px 8px;font-weight:600;color:#6b7280;font-size:11px;text-transform:uppercase">${escapeHtml(row.componentType)}</td>
        <td style="padding:4px 8px;font-weight:500">${escapeHtml(row.groupName)}</td>
        <td style="padding:4px 8px">${row.materialName !== row.groupName ? escapeHtml(row.materialName) : ''}</td>
        <td style="padding:4px 8px">${escapeHtml(row.color)}</td>
        <td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:700">${row.totalQuantity.toFixed(2)}</td>
        <td style="padding:4px 8px;text-align:center">${formatUnit(row.productUnit)}</td>
      </tr>`;
    }).join('');

    const totalsHtml = Array.from(totalsByUnit.entries())
      .map(([unit, total]) =>
        `<span style="display:inline-block;background:#f3f4f6;padding:4px 12px;border-radius:6px;margin-right:8px;font-size:13px;font-weight:600">${total.toFixed(2)} ${formatUnit(unit)}</span>`)
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Lista de Separação — ${reportTitle}</title>
      <style>
        @page { size: A4; margin: 8mm 6mm; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #111; margin: 0; padding: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #f9fafb; padding: 6px 8px; text-align: left; border-bottom: 2px solid #d1d5db; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
        td { border-bottom: 1px solid #f3f4f6; }
        h1 { font-size: 16px; margin: 0 0 4px; }
        p.sub { color: #6b7280; font-size: 12px; margin: 0 0 10px; }
        .section { font-weight: 700; background: #f9fafb; }
      </style>
      </head><body>
      <h1>📦 Lista de Separação — ${reportTitle}</h1>
      <p class="sub">${totalItems} item(ns) · ${reportOrderCount} OP(s) · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      <div style="margin-bottom:12px">${totalsHtml}</div>
      <table>
        <thead><tr>
          <th>✓</th><th>Tipo</th><th>Grupo de Material</th><th>Aplicação</th><th>Cor</th>
          <th style="text-align:right">Consumo</th><th style="text-align:center">Un</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;border-top:1px solid #ccc;padding-top:8px">
        Responsável pela separação: ___________________________ &nbsp;&nbsp; Data: ___/___/______
      </p>
      </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300); }
  }, [rows, pickedSet, totalsByUnit, reportTitle, totalItems, reportOrderCount]);

  // ── Render ────────────────────────────────────────────────────────────────

  const currentWeekGroup = weekGroups.find(g => g.code === selectedWeek);

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="display text-xl">Lista de Separação</h1>
          {reportTitle && (
            <Badge variant="secondary" className="text-xs max-w-xs truncate">{reportTitle}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pickedItems > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5 text-muted-foreground" onClick={clearPicked}>
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar progresso
            </Button>
          )}
          {rows.length > 0 && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
          )}
        </div>
      </div>

      {/* Filter modes */}
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <Tabs value={filterMode} onValueChange={v => { setFilterMode(v as FilterMode); setRows([]); }}>
            <TabsList className="h-8">
              <TabsTrigger value="week" className="gap-1.5 text-xs h-7">
                <Calendar className="h-3.5 w-3.5" /> Onda Semanal
              </TabsTrigger>
              <TabsTrigger value="pv" className="gap-1.5 text-xs h-7">
                <FileText className="h-3.5 w-3.5" /> Por PV
              </TabsTrigger>
              <TabsTrigger value="op" className="gap-1.5 text-xs h-7">
                <Hash className="h-3.5 w-3.5" /> Por OP
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {filterMode === 'week' && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Selecionar semana" />
                </SelectTrigger>
                <SelectContent>
                  {weekGroups.map(g => (
                    <SelectItem key={g.code} value={g.code}>
                      {g.code} · {fmtBR(g.monday)}–{fmtBR(g.sunday)} ({g.saleOrderNumbers.length} PVs)
                    </SelectItem>
                  ))}
                  {weekGroups.length === 0 && (
                    <SelectItem value="__empty" disabled>Nenhuma onda ativa</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {currentWeekGroup && (
                <span className="text-xs text-muted-foreground">
                  PVs: {currentWeekGroup.saleOrderNumbers.slice(0, 5).join(', ')}
                  {currentWeekGroup.saleOrderNumbers.length > 5 && ` +${currentWeekGroup.saleOrderNumbers.length - 5}`}
                </span>
              )}
            </div>
          )}

          {filterMode === 'pv' && (
            <div className="flex items-start gap-2">
              <Textarea
                placeholder="Cole os números dos PVs (um por linha ou separados por vírgula)&#10;Ex: PV-2026-001, PV-2026-002"
                value={pvInput}
                onChange={e => setPvInput(e.target.value)}
                className="min-h-20 text-sm font-mono resize-none"
              />
              <Button onClick={handleSearchByPV} disabled={!pvInput.trim() || isCalculating} className="shrink-0">
                <Search className="h-4 w-4 mr-1" />
                Buscar
              </Button>
            </div>
          )}

          {filterMode === 'op' && (
            <div className="flex items-start gap-2">
              <Textarea
                placeholder="Cole os números das OPs (um por linha ou separados por vírgula)&#10;Ex: OP-2026-001, OP-2026-002"
                value={opInput}
                onChange={e => setOpInput(e.target.value)}
                className="min-h-20 text-sm font-mono resize-none"
              />
              <Button onClick={handleSearchByOP} disabled={!opInput.trim() || isCalculating} className="shrink-0">
                <Search className="h-4 w-4 mr-1" />
                Buscar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {isCalculating && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Calculando consumo de materiais...
        </div>
      )}

      {/* KPIs */}
      {!isCalculating && totalItems > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total de Itens</p>
              <p className="display text-xl tabular-nums font-mono mt-0.5">{totalItems}</p>
            </CardContent>
          </Card>
          <Card className={cn(allDone ? 'border-green-500/40 bg-green-500/5' : '')}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Separados</p>
              <p className={cn('display text-xl tabular-nums font-mono mt-0.5', pickedItems > 0 ? 'text-green-600' : '')}>
                {pickedItems}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Pendentes</p>
              <p className={cn('display text-xl tabular-nums font-mono mt-0.5', totalItems - pickedItems > 0 ? 'text-amber-600' : 'text-green-600')}>
                {totalItems - pickedItems}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Progresso</p>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="display text-xl tabular-nums font-mono">{completionPct}%</p>
              <Progress value={completionPct} className="h-1.5 mt-1" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Totals by unit */}
      {!isCalculating && totalsByUnit.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Totais:</span>
          {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
            <Badge key={unit} variant="secondary" className="text-sm px-3 py-1">
              {total.toFixed(2)} {formatUnit(unit)}
            </Badge>
          ))}
          <Badge variant="outline" className="text-sm px-3 py-1">
            {reportOrderCount} OP(s)
          </Badge>
        </div>
      )}

      {/* Empty state */}
      {!isCalculating && rows.length === 0 && reportTitle && (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-2 opacity-40" />
          <p>Nenhum consumo de material calculado para esta seleção.</p>
          <p className="text-xs mt-1">Verifique se os pedidos possuem fichas técnicas cadastradas.</p>
        </div>
      )}

      {/* Results grouped by component */}
      {!isCalculating && grouped.size > 0 && (
        <div className="space-y-3">
          {COMPONENT_ORDER.map(componentType => {
            const componentRows = grouped.get(componentType);
            if (!componentRows || componentRows.length === 0) return null;

            const compPicked = componentRows.filter(r => pickedSet.has(rowKey(r))).length;
            const compDone = compPicked === componentRows.length;

            return (
              <Card
                key={componentType}
                className={cn('border-l-4', compDone ? 'border-l-green-500' : 'border-l-primary')}
              >
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    {compDone
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <Package className="h-4 w-4 text-primary" />}
                    <span className="uppercase tracking-wide">{componentType}</span>
                    <Badge variant="outline" className="text-xs ml-1">
                      {componentRows.length} item(ns)
                    </Badge>
                    <span className="text-xs text-muted-foreground font-normal">
                      {compPicked}/{componentRows.length} separados
                    </span>
                  </CardTitle>
                  <Progress
                    value={componentRows.length > 0 ? Math.round((compPicked / componentRows.length) * 100) : 0}
                    className={cn('h-1', compDone ? '[&>div]:bg-green-500' : '')}
                  />
                </CardHeader>
                <CardContent className="pt-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="w-10 py-2">✓</TableHead>
                        <TableHead className="py-2">Grupo de Material</TableHead>
                        <TableHead className="py-2">Aplicação</TableHead>
                        <TableHead className="py-2">Cor</TableHead>
                        <TableHead className="text-right py-2">Consumo Total</TableHead>
                        <TableHead className="text-center w-20 py-2">Unidade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentRows.map((row) => {
                        const key = rowKey(row);
                        const isPicked = pickedSet.has(key);
                        return (
                          <TableRow
                            key={key}
                            className={cn(
                              'cursor-pointer transition-colors',
                              isPicked ? 'bg-green-500/5 opacity-60 hover:opacity-80' : 'hover:bg-muted/30',
                            )}
                            onClick={() => togglePicked(key)}
                          >
                            <TableCell className="py-2">
                              {isPicked
                                ? <CheckSquare className="h-4 w-4 text-green-600" />
                                : <Square className="h-4 w-4 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className={cn('py-2 font-medium', isPicked && 'line-through text-muted-foreground')}>
                              {row.groupName}
                            </TableCell>
                            <TableCell className={cn('py-2 text-sm', isPicked && 'line-through text-muted-foreground')}>
                              {row.materialName !== row.groupName ? row.materialName : '—'}
                            </TableCell>
                            <TableCell className="py-2">
                              {row.color !== '—'
                                ? <Badge variant="outline" className="text-xs">{row.color}</Badge>
                                : <span className="text-muted-foreground text-xs">—</span>}
                            </TableCell>
                            <TableCell className="py-2 text-right font-mono font-bold">
                              {row.totalQuantity.toFixed(2)}
                            </TableCell>
                            <TableCell className="py-2 text-center text-muted-foreground text-sm">
                              {formatUnit(row.productUnit)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
