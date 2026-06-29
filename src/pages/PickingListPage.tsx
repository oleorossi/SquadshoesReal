import { useState, useMemo, useCallback } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
import { ClipboardText as ClipboardList, Package, Printer, Calendar, MagnifyingGlass as Search, CheckSquare, Square, ArrowCounterClockwise as RotateCcw, TrendUp as TrendingUp, CheckCircle as CheckCircle2, CircleNotch as Loader2, FileText, Hash, Warning as WarningIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { usePersistedState } from '@/hooks/usePersistedState';
import { cn } from '@/lib/utils';
import {
  calculateBomForOrders,
  calculateSoleBreakdownByGrade,
  calculateArtisanalStrapRollCut,
  type ConsumptionRow,
  type SoleBreakdownResult,
  COMPONENT_ORDER,
  formatUnit,
} from '@/lib/bomConsumption';
import { type ArtisanalStrapCutRow, ROLO_COMPRIMENTO_M, ROLO_LARGURA_MM, rollFillLabel } from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { todayISO, todayPlusDaysISO, safeParseISO, safeFormatBR } from '@/lib/date';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, differenceInDays } from 'date-fns';

// ─── Tipos & helpers ──────────────────────────────────────────────────────────

interface EligibleOp {
  id: string;
  order_number: string | null;
  status: string;
  planned_start: string | null;
  created_at: string;
  sale_order_id: string;
  sale_orders: {
    id: string;
    order_number: string | null;
    status: string;
    picking_individually_done_at: string | null;
    delivery_deadline: string | null;
  };
}

interface DateRange { from: string; to: string }

interface PvGroup {
  soId: string;
  pvNumber: string;
  ops: EligibleOp[];
  opCount: number;
  effStart: string | null;
  deadline: string | null;
}

// Data efetiva de "início de produção" da OP. planned_start é a base canônica;
// quando ausente (coluna nullable) cai em created_at pra a OP não sumir do filtro.
const effDateOf = (o: EligibleOp): string => o.planned_start || (o.created_at || '').slice(0, 10);

// Status reais no banco (acento + capital). A elegibilidade do picking é
// DIRIGIDA PELA OP: a OP tem que estar viva (Em Produção / Reservado) e o picking
// do PV não pode já ter sido feito em massa. O status do PV NÃO é allow-list —
// só EXCLUI PVs realmente mortos (Cancelado / Rascunho).
//
// ⚠ Antes era allow-list ['Aprovado','Em Produção'], que escondia OPs ainda
// EM PRODUÇÃO de PVs já FATURADOS. Como o faturamento ocorre DURANTE a produção
// neste negócio (~78% dos PVs faturados), ~11 OPs em produção sumiam do picking
// (bug reportado: "as que estão em produção não estão em picking"). Uma OP ativa
// precisa de separação mesmo que o PV já tenha sido faturado.
const ACTIVE_OP_STATUSES = ['Em Produção', 'Reservado'];
const NON_PICKABLE_PV_STATUSES = ['Cancelado', 'Cancelada', 'Rascunho'];

// Intervalo "sem filtro" (mostra todas as elegíveis).
const SEM_FILTRO: DateRange = { from: '0000-01-01', to: '9999-12-31' };

// ─── Component ────────────────────────────────────────────────────────────────

export default function PickingListPage() {
  // Janela temporal por INÍCIO DE PRODUÇÃO (orders.planned_start). Persistida.
  const [range, setRange] = usePersistedState<DateRange>('picking_date_range_v1', {
    from: todayPlusDaysISO(-90),
    to: todayISO(),
  });
  const [pvSearch, setPvSearch] = useState('');
  // Seleção "item a item": PVs escolhidos na checklist.
  const [selectedPvIds, setSelectedPvIds] = useState<Set<string>>(new Set());
  const [pvInput, setPvInput] = useState('');
  const [opInput, setOpInput] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Origem do relatório atual (só p/ rótulo no header/print).
  const [reportKind, setReportKind] = useState<'pv' | 'op'>('pv');

  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [soleBreakdown, setSoleBreakdown] = useState<SoleBreakdownResult>({ rows: [], allSizes: [], grandTotal: 0 });
  const [strapCut, setStrapCut] = useState<ArtisanalStrapCutRow[]>([]);
  const [reportTitle, setReportTitle] = useState('');
  const [reportOrderCount, setReportOrderCount] = useState(0);
  // Números dos pedidos (PV ou OP) que compõem o relatório atual — exibidos no
  // cabeçalho (tela + impressão).
  const [reportOrderNumbers, setReportOrderNumbers] = useState<string[]>([]);
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

  // ── Data: OPs ELEGÍVEIS para picking ──────────────────────────────────────
  // Fonte = orders (OP), não sale_orders: é o nível onde vivem o status de
  // produção e a base temporal (planned_start), e é o que calculateBomForOrders
  // recebe. Filtra: OP ativa + PV pickável + não debitado em massa
  // (picking_individually_done_at IS NULL — evita duplo débito). O filtro do PV
  // é feito em JS sobre o embed (SELECT-only é robusto no PostgREST).
  // queryKey mantido ('picking_active_sale_orders') porque useSaleOrders o
  // invalida após commit_picking_for_sale_order — renomear quebraria isso.
  const { data: eligibleOps = [], isLoading: opsLoading } = useQuery({
    queryKey: ['picking_active_sale_orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        // FK explícita: orders tem 2 FKs p/ sale_orders (sale_order_id e
        // cross_dock_sale_order_id) — sem o nome da constraint o embed fica
        // ambíguo ("more than one relationship was found").
        .select('id, order_number, status, planned_start, created_at, sale_order_id, sale_orders!orders_sale_order_id_fkey!inner(id, order_number, status, picking_individually_done_at, delivery_deadline)')
        .in('status', ACTIVE_OP_STATUSES)
        .order('planned_start', { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data || []).filter((o: any) => {
        const so = o.sale_orders;
        return so
          && !NON_PICKABLE_PV_STATUSES.includes(so.status)
          && so.picking_individually_done_at == null;
      }) as EligibleOp[];
    },
    staleTime: 60_000,
  });

  // ── Janela temporal + fallback ────────────────────────────────────────────
  // Se a janela vier vazia (cenário real hoje: todos os planned_start estão no
  // passado), NÃO abrir vazio — mostra todas as elegíveis com aviso âmbar.
  const opsInWindow = useMemo(() => {
    const lo = range.from <= range.to ? range.from : range.to;
    const hi = range.from <= range.to ? range.to : range.from;
    return eligibleOps.filter(o => {
      const d = effDateOf(o);
      return d >= lo && d <= hi;
    });
  }, [eligibleOps, range]);

  const usedFallback = opsInWindow.length === 0 && eligibleOps.length > 0;
  const visibleOps = usedFallback ? eligibleOps : opsInWindow;

  // ── Agrupa OPs visíveis por PV (cada linha da checklist = 1 PV) ────────────
  const pvGroups = useMemo((): PvGroup[] => {
    const map = new Map<string, PvGroup>();
    for (const o of visibleOps) {
      const so = o.sale_orders;
      if (!so) continue;
      if (!map.has(so.id)) {
        map.set(so.id, {
          soId: so.id,
          pvNumber: so.order_number || so.id.slice(0, 8),
          ops: [],
          opCount: 0,
          effStart: null,
          deadline: so.delivery_deadline,
        });
      }
      map.get(so.id)!.ops.push(o);
    }
    return Array.from(map.values()).map(g => {
      const dates = g.ops.map(effDateOf).filter(Boolean).sort();
      return { ...g, opCount: g.ops.length, effStart: dates[0] || null };
    }).sort((a, b) => (a.effStart || '9999').localeCompare(b.effStart || '9999'));
  }, [visibleOps]);

  const filteredPvGroups = useMemo(() => {
    const q = pvSearch.trim().toLowerCase();
    if (!q) return pvGroups;
    return pvGroups.filter(g => g.pvNumber.toLowerCase().includes(q));
  }, [pvGroups, pvSearch]);

  // ── Presets de período (base = início de produção) ────────────────────────
  const presets = useMemo(() => {
    const t = todayISO();
    const d = safeParseISO(t)!;
    const iso = (x: Date) => format(x, 'yyyy-MM-dd');
    return [
      { label: 'Esta semana', from: iso(startOfWeek(d, { weekStartsOn: 1 })), to: iso(endOfWeek(d, { weekStartsOn: 1 })) },
      { label: 'Próximos 30 dias', from: t, to: todayPlusDaysISO(30) },
      { label: 'Este mês', from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) },
      { label: 'Últimos 30 dias', from: todayPlusDaysISO(-30), to: t },
      { label: 'Últimos 90 dias', from: todayPlusDaysISO(-90), to: t },
    ];
  }, []);

  const isSemFiltro = range.from === SEM_FILTRO.from && range.to === SEM_FILTRO.to;

  // ── Calculation trigger ────────────────────────────────────────────────────

  const runCalculation = useCallback(async (orderIds: string[], title: string, orderNumbers: string[] = []) => {
    if (orderIds.length === 0) {
      setRows([]);
      setSoleBreakdown({ rows: [], allSizes: [], grandTotal: 0 });
      setStrapCut([]);
      setReportTitle(title);
      setReportOrderCount(0);
      setReportOrderNumbers(orderNumbers);
      return;
    }
    setIsCalculating(true);
    try {
      const [bomResult, soleResult, strapCutResult] = await Promise.all([
        calculateBomForOrders(orderIds),
        calculateSoleBreakdownByGrade(orderIds),
        calculateArtisanalStrapRollCut(orderIds),
      ]);
      setRows(bomResult);
      setSoleBreakdown(soleResult);
      setStrapCut(strapCutResult);
      setReportTitle(title);
      setReportOrderCount(orderIds.length);
      setReportOrderNumbers(orderNumbers);
    } catch (err: any) {
      toast.error('Erro ao calcular consumo', { description: err?.message });
      setRows([]);
      setSoleBreakdown({ rows: [], allSizes: [], grandTotal: 0 });
      setStrapCut([]);
    } finally {
      setIsCalculating(false);
    }
  }, []);

  // ── Gerar separação a partir dos PVs marcados na checklist ────────────────
  // Junta os IDs de TODAS as OPs (já elegíveis e carregadas) dos PVs marcados —
  // sem novo fetch e sem re-filtrar status (elegibilidade já resolvida na query).
  const handleGenerateSelectedPvs = useCallback(async () => {
    const selected = pvGroups.filter(g => selectedPvIds.has(g.soId));
    if (selected.length === 0) return;
    const opIds = selected.flatMap(g => g.ops.map(o => o.id));
    const pvNumbers = selected.map(g => g.pvNumber);
    setReportKind('pv');
    await runCalculation(opIds, `Separação · ${pvNumbers.length} PV(s)`, pvNumbers);
  }, [pvGroups, selectedPvIds, runCalculation]);

  const togglePv = useCallback((id: string) => {
    setSelectedPvIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }, []);

  // ── Busca avançada: colar números de PV ───────────────────────────────────
  // Resolve OPs ativas dos PVs colados, independente da janela/elegibilidade —
  // útil pra PVs já faturados/fora da lista. Mantém o filtro de exclusão.
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
      const pvNumbers = (sos || []).map((so: any) => so.order_number).filter(Boolean);
      setReportKind('pv');
      await runCalculation(opIds, `PVs: ${pvNumbers.join(', ')}`, pvNumbers);
    } catch (err: any) {
      toast.error('Erro ao buscar PVs', { description: err?.message });
      setIsCalculating(false);
    }
  }, [pvInput, runCalculation]);

  // ── Busca avançada: colar números de OP ───────────────────────────────────
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
      const opNumbers = (ops || []).map((o: any) => o.order_number).filter(Boolean);
      setReportKind('op');
      await runCalculation(opIds, `OPs: ${opNumbers.join(', ')}`, opNumbers);
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
    // Solado vai pra tabela matricial separada (numeração × cor); demais
    // componentes ficam na tabela flat normal.
    const nonSoleRows = rows.filter(r => r.componentType !== 'Solado');
    const tableRows = nonSoleRows.map(row => {
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

    // Matriz de solados por numeração + cor
    let soleMatrixHtml = '';
    if (soleBreakdown.rows.length > 0) {
      const sizesHeader = soleBreakdown.allSizes
        .map(s => `<th style="text-align:center;width:36px;font-family:monospace">${escapeHtml(s)}</th>`)
        .join('');
      const bodyRows = soleBreakdown.rows.map(srow => {
        const key = `Solado||${srow.soleGroup}||${srow.soleColor}||par`;
        const done = pickedSet.has(key);
        const sizeCells = soleBreakdown.allSizes.map(s => {
          const qty = srow.sizes[s] || 0;
          return `<td style="text-align:center;font-family:monospace;${qty > 0 ? 'font-weight:700' : 'color:#d1d5db'};padding:4px 6px">${qty > 0 ? qty : '·'}</td>`;
        }).join('');
        return `<tr${done ? ' style="background:#f0fdf4"' : ''}>
          <td style="text-align:center;font-size:14px;padding:4px 6px">${done ? '✅' : '☐'}</td>
          <td style="padding:4px 8px;font-weight:600">${escapeHtml(srow.soleGroup)}</td>
          <td style="padding:4px 8px">${escapeHtml(srow.soleColor)}</td>
          ${sizeCells}
          <td style="text-align:right;padding:4px 8px;font-family:monospace;font-weight:700">${srow.total} par</td>
        </tr>`;
      }).join('');
      const totalRow = `<tr style="background:#f3f4f6;font-weight:700;border-top:2px solid #9ca3af">
        <td></td>
        <td style="padding:4px 8px;text-transform:uppercase;font-size:10px;color:#6b7280" colspan="2">Total por numeração</td>
        ${soleBreakdown.allSizes.map(s => {
          const sum = soleBreakdown.rows.reduce((acc, r) => acc + (r.sizes[s] || 0), 0);
          return `<td style="text-align:center;font-family:monospace;font-weight:700;padding:4px 6px">${sum > 0 ? sum : '·'}</td>`;
        }).join('')}
        <td style="text-align:right;padding:4px 8px;font-family:monospace;font-weight:700">${soleBreakdown.grandTotal} par</td>
      </tr>`;
      soleMatrixHtml = `
        <h2 style="font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.5px">🥿 Solados — quantidade por numeração e cor</h2>
        <table>
          <thead><tr>
            <th style="width:24px">✓</th>
            <th>Solado</th>
            <th>Cor</th>
            ${sizesHeader}
            <th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>${bodyRows}${totalRow}</tbody>
        </table>
      `;
    }

    // Bloco vermelho: tiras artesanais — corte do rolo. UMA linha por (grupo+cor),
    // com os metros já somados (aggregateArtisanalStrapCut). Quando passa de 1 rolo
    // (137 cm), mostra o breakdown "N rolos completos + X cm" embaixo do cm total.
    let strapCutHtml = '';
    if (strapCut.length > 0) {
      const ROLO_CM = ROLO_LARGURA_MM / 10; // 137 cm — largura útil do rolo
      // Barra B&W do corte (hachura preta = a cortar; branco = sobra). A faixa é UM
      // rolo (137 cm); rolos cheios viram mini-blocos antes da faixa do último rolo.
      // print-color-adjust:exact garante que a hachura saia na impressora.
      const hatch = 'background:#fff;background-image:repeating-linear-gradient(45deg,#000 0 1.2px,transparent 1.2px 5px);-webkit-print-color-adjust:exact;print-color-adjust:exact';
      const barHtml = (cut: ArtisanalStrapCutRow['cut']) => {
        if (!cut.valid) return '';
        const last = cut.cm_no_ultimo_rolo;
        const pct = last > 0 ? Math.min(100, (last / ROLO_CM) * 100) : 100;
        const fullMini = last > 0 ? cut.n_rolos_completos : Math.max(0, cut.n_rolos_completos - 1);
        const miniShown = Math.min(fullMini, 6);
        const miniExtra = fullMini - miniShown;
        const minis = Array.from({ length: miniShown })
          .map(() => `<span style="display:inline-block;width:9px;height:12px;border:1px solid #000;${hatch}"></span>`)
          .join('');
        const extra = miniExtra > 0 ? `<span style="font-size:9px;font-family:monospace">+${miniExtra}</span>` : '';
        return `<div style="display:flex;align-items:center;gap:2px;margin-top:3px;justify-content:flex-end">
          ${minis}${extra}
          <span style="position:relative;display:inline-block;width:118px;height:12px;border:1px solid #000;background:#fff">
            <span style="position:absolute;left:0;top:0;bottom:0;width:${pct.toFixed(1)}%;${hatch}"></span>
          </span>
          <span style="font-size:9px;font-family:monospace;color:#555;white-space:nowrap">137 cm</span>
        </div>`;
      };
      const strapRows = strapCut.map((r) => {
        const { cut } = r;
        const cortar = cut.valid
          ? `<span style="font-weight:700;font-size:14px">${cut.cm_a_cortar.toFixed(1)} cm</span>`
          : `<span style="font-size:11px">⚠ ${escapeHtml(cut.warning || 'sem largura')}</span>`;
        const fill = rollFillLabel(cut);
        const breakdownHtml = fill
          ? `<div style="font-size:10px;color:#dc2626;opacity:.85;font-family:system-ui">${escapeHtml(fill)}</div>`
          : '';
        const larguraTxt = cut.widthMissing ? '' : ` · ${r.largura_mm.toFixed(0)} mm`;
        const colorTxt = r.color && r.color !== '—' ? ` · ${escapeHtml(r.color)}` : '';
        return `<tr style="color:#dc2626">
          <td style="padding:4px 8px;font-weight:600">${escapeHtml(r.groupName)}${colorTxt}${larguraTxt}</td>
          <td style="padding:4px 8px;text-align:right;font-family:monospace">${cortar}${barHtml(cut)}${breakdownHtml}</td>
        </tr>`;
      }).join('');
      strapCutHtml = `
        <h2 style="font-size:13px;margin:18px 0 4px;color:#dc2626;text-transform:uppercase;letter-spacing:.5px">✂️ Tiras artesanais — corte do rolo (${ROLO_COMPRIMENTO_M}m × ${ROLO_LARGURA_MM}mm)</h2>
        <p style="font-size:11px;color:#dc2626;margin:0 0 6px">Agrupadas por grupo + cor (metros somados antes do corte). Cortar do rolo — não é consumo direto de estoque.</p>
        <table style="border:1px solid #fca5a5">
          <thead><tr style="color:#dc2626">
            <th style="background:#fef2f2">Tira (cor · largura)</th>
            <th style="background:#fef2f2;text-align:right">Cortar do rolo (cm)</th>
          </tr></thead>
          <tbody>${strapRows}</tbody>
        </table>`;
    }

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
      ${reportOrderNumbers.length > 0 ? `<p class="sub" style="margin-top:-6px"><strong>${reportKind === 'op' ? 'OPs' : 'Pedidos'} (${reportOrderNumbers.length}):</strong> ${reportOrderNumbers.map(escapeHtml).join(', ')}</p>` : ''}
      <div style="margin-bottom:12px">${totalsHtml}</div>
      ${soleMatrixHtml}
      <h2 style="font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.5px">📋 Demais materiais</h2>
      <table>
        <thead><tr>
          <th>✓</th><th>Tipo</th><th>Grupo de Material</th><th>Aplicação</th><th>Cor</th>
          <th style="text-align:right">Consumo</th><th style="text-align:center">Un</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${strapCutHtml}
      <p style="margin-top:24px;font-size:11px;border-top:1px solid #ccc;padding-top:8px">
        Responsável pela separação: ___________________________ &nbsp;&nbsp; Data: ___/___/______
      </p>
      </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 300); }
  }, [rows, pickedSet, totalsByUnit, reportTitle, totalItems, reportOrderCount, reportOrderNumbers, reportKind, soleBreakdown, strapCut]);

  // ── Render ────────────────────────────────────────────────────────────────

  const today = todayISO();
  const allSelected = filteredPvGroups.length > 0 && filteredPvGroups.every(g => selectedPvIds.has(g.soId));

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <EditorialPageHeader
        sectionLabel="LOGÍSTICA · PICKING"
        title="Lista de Separação"
        actions={
          <>
            {reportTitle && (
              <Badge variant="secondary" className="text-xs max-w-xs truncate">{reportTitle}</Badge>
            )}
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
          </>
        }
      />

      {/* Seletor de janela temporal + checklist de OPs */}
      <Panel bodyClassName="space-y-3">
        {/* Intervalo de datas (início de produção) */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            Janela de produção · por início (planned_start)
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">De</Label>
              <Input
                type="date"
                value={isSemFiltro ? '' : range.from}
                onChange={e => setRange(r => ({ ...r, from: e.target.value || SEM_FILTRO.from }))}
                className="h-8 w-40 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Até</Label>
              <Input
                type="date"
                value={isSemFiltro ? '' : range.to}
                onChange={e => setRange(r => ({ ...r, to: e.target.value || SEM_FILTRO.to }))}
                className="h-8 w-40 text-sm"
              />
            </div>
          </div>
          {/* Presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {presets.map(p => {
              const active = range.from === p.from && range.to === p.to;
              return (
                <Button
                  key={p.label}
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setRange({ from: p.from, to: p.to })}
                >
                  {p.label}
                </Button>
              );
            })}
            <Button
              size="sm"
              variant={isSemFiltro ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setRange(SEM_FILTRO)}
            >
              Sem filtro de data
            </Button>
          </div>
        </div>

        {/* Aviso de fallback */}
        {usedFallback && !isSemFiltro && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <WarningIcon className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Nenhuma OP inicia produção entre {safeFormatBR(range.from)} e {safeFormatBR(range.to)}.
              Mostrando <strong>todas as {eligibleOps.length} OPs ativas</strong> (algumas atrasadas) — ajuste a janela acima ou selecione abaixo.
            </span>
          </div>
        )}

        {/* Checklist de PVs/OPs elegíveis */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar PV pelo número..."
                value={pvSearch}
                onChange={e => setPvSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Button size="sm" variant="ghost" className="h-8 text-xs"
              onClick={() => setSelectedPvIds(new Set(filteredPvGroups.map(g => g.soId)))}
              disabled={filteredPvGroups.length === 0 || allSelected}>
              Selecionar todos
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs"
              onClick={() => setSelectedPvIds(new Set())} disabled={selectedPvIds.size === 0}>
              Limpar
            </Button>
            <Button size="sm" className="h-8 gap-1.5"
              onClick={handleGenerateSelectedPvs} disabled={selectedPvIds.size === 0 || isCalculating}>
              <CheckCircle2 className="h-4 w-4" />
              Gerar separação ({selectedPvIds.size})
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {opsLoading ? (
              <p className="text-xs text-muted-foreground p-3 text-center flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando OPs em produção...
              </p>
            ) : filteredPvGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">
                {eligibleOps.length === 0
                  ? 'Nenhuma OP ativa em produção (sem picking pendente).'
                  : 'Nenhum PV corresponde à busca.'}
              </p>
            ) : filteredPvGroups.map(g => {
              const checked = selectedPvIds.has(g.soId);
              const days = g.effStart ? differenceInDays(safeParseISO(today)!, safeParseISO(g.effStart)!) : null;
              const stale = days != null && days > 30;
              return (
                <button key={g.soId} type="button" onClick={() => togglePv(g.soId)}
                  className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors hover:bg-muted/40', checked && 'bg-primary/5')}>
                  {checked
                    ? <CheckSquare className="h-4 w-4 text-primary shrink-0" weight="fill" />
                    : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="font-medium font-mono">{g.pvNumber}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">{g.opCount} OP{g.opCount !== 1 ? 's' : ''}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
                    <span title="início de produção">{safeFormatBR(g.effStart)}</span>
                    {days != null && (
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] h-4 px-1.5', stale && 'border-amber-300 bg-amber-500/10 text-amber-600')}
                      >
                        {days < 0 ? `em ${-days}d` : `há ${days}d`}
                      </Badge>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Busca avançada: colar números (PVs já faturados / OPs avulsas) */}
          <details className="text-xs" open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-muted-foreground select-none">Busca avançada · colar números de PV ou OP (fora da janela)</summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><FileText className="h-3 w-3" /> Por PV</Label>
                  <Textarea
                    placeholder="PV-2026-001, PV-2026-002"
                    value={pvInput}
                    onChange={e => setPvInput(e.target.value)}
                    className="min-h-16 text-sm font-mono resize-none"
                  />
                </div>
                <Button onClick={handleSearchByPV} disabled={!pvInput.trim() || isCalculating} className="shrink-0 mt-6" size="sm">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Hash className="h-3 w-3" /> Por OP</Label>
                  <Textarea
                    placeholder="OP-2026-001, OP-2026-002"
                    value={opInput}
                    onChange={e => setOpInput(e.target.value)}
                    className="min-h-16 text-sm font-mono resize-none"
                  />
                </div>
                <Button onClick={handleSearchByOP} disabled={!opInput.trim() || isCalculating} className="shrink-0 mt-6" size="sm">
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </details>
        </div>
      </Panel>

      {/* Loading */}
      {isCalculating && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Calculando consumo de materiais...
        </div>
      )}

      {/* Cabeçalho: pedidos que compõem este relatório */}
      {!isCalculating && reportOrderNumbers.length > 0 && (
        <Panel bodyClassName="py-2.5">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0 mt-1">
              {reportKind === 'op' ? 'OPs' : 'Pedidos'} neste relatório ({reportOrderNumbers.length}):
            </span>
            <div className="flex flex-wrap gap-1">
              {reportOrderNumbers.map(n => (
                <Badge key={n} variant="outline" className="text-xs font-mono">{n}</Badge>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {/* KPIs — kit editorial (StatCard) derivado de dados reais */}
      {!isCalculating && totalItems > 0 && (
        <StatGrid>
          <StatCard
            label="Total de Itens"
            value={totalItems}
            hint="no relatório"
          />
          <StatCard
            label="Separados"
            value={pickedItems}
            hint={allDone ? 'tudo separado' : 'marcados'}
            tone={pickedItems > 0 ? 'success' : 'default'}
          />
          <StatCard
            label="Pendentes"
            value={totalItems - pickedItems}
            hint="a separar"
            tone={totalItems - pickedItems > 0 ? 'warning' : 'success'}
          />
          <StatCard
            label="Progresso"
            value={`${completionPct}%`}
            hint="separação concluída"
            icon={TrendingUp}
          />
        </StatGrid>
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
        <Panel flush>
          <EmptyState
            icon={Package}
            title="Nenhum consumo de material calculado para esta seleção"
            description="Verifique se os pedidos possuem fichas técnicas cadastradas."
          />
        </Panel>
      )}

      {/* Estado inicial: sem relatório ainda */}
      {!isCalculating && rows.length === 0 && !reportTitle && (
        <Panel flush>
          <EmptyState
            icon={ClipboardList}
            title="Selecione os PVs e gere a separação"
            description="Ajuste a janela de produção acima, marque os PVs/OPs desejados e clique em “Gerar separação”."
          />
        </Panel>
      )}

      {/* Results grouped by component */}
      {!isCalculating && grouped.size > 0 && (
        <div className="space-y-3">
          {COMPONENT_ORDER.map(componentType => {
            const componentRows = grouped.get(componentType);
            if (!componentRows || componentRows.length === 0) return null;

            // Solado: usa matriz solado×numeração quando o breakdown está
            // populado. Fallback pra tabela flat quando o breakdown veio vazio
            // (ex: orders sem grade).
            const useSoleMatrix = componentType === 'Solado' && soleBreakdown.rows.length > 0;
            const effectiveCount = useSoleMatrix ? soleBreakdown.rows.length : componentRows.length;
            const compPicked = useSoleMatrix
              ? soleBreakdown.rows.filter(r => pickedSet.has(`Solado||${r.soleGroup}||${r.soleColor}||par`)).length
              : componentRows.filter(r => pickedSet.has(rowKey(r))).length;
            const compDone = compPicked === effectiveCount;

            return (
              <Panel
                key={componentType}
                className={cn('border-l-4', compDone ? 'border-l-green-500' : 'border-l-primary')}
                title={
                  <span className="flex items-center gap-2">
                    {compDone
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <Package className="h-4 w-4 text-primary" />}
                    <span className="uppercase tracking-wide">{componentType}</span>
                    <Badge variant="outline" className="text-xs ml-1">
                      {effectiveCount} item(ns)
                    </Badge>
                    {useSoleMatrix && (
                      <Badge variant="secondary" className="text-xs">
                        {soleBreakdown.grandTotal} pares · {soleBreakdown.allSizes.length} numerações
                      </Badge>
                    )}
                  </span>
                }
                subtitle={`${compPicked}/${effectiveCount} separados`}
                flush
              >
                <div className="px-4 pt-3">
                  <Progress
                    value={effectiveCount > 0 ? Math.round((compPicked / effectiveCount) * 100) : 0}
                    className={cn('h-1', compDone ? '[&>div]:bg-green-500' : '')}
                  />
                </div>
                {useSoleMatrix ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                          <TableHead className="w-10 py-2">✓</TableHead>
                          <TableHead className="py-2 min-w-[200px]">Solado</TableHead>
                          <TableHead className="py-2 min-w-[100px]">Cor</TableHead>
                          {soleBreakdown.allSizes.map(s => (
                            <TableHead key={s} className="text-center py-2 w-12 font-mono">
                              {s}
                            </TableHead>
                          ))}
                          <TableHead className="text-right py-2 w-20">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {soleBreakdown.rows.map((srow) => {
                          const key = `Solado||${srow.soleGroup}||${srow.soleColor}||par`;
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
                                {srow.soleGroup}
                              </TableCell>
                              <TableCell className="py-2">
                                {srow.soleColor !== '—'
                                  ? <Badge variant="outline" className="text-xs">{srow.soleColor}</Badge>
                                  : <span className="text-muted-foreground text-xs">—</span>}
                              </TableCell>
                              {soleBreakdown.allSizes.map(s => {
                                const qty = srow.sizes[s] || 0;
                                return (
                                  <TableCell
                                    key={s}
                                    className={cn(
                                      'py-2 text-center font-mono',
                                      qty > 0 ? 'font-bold' : 'text-muted-foreground/40',
                                      isPicked && 'line-through text-muted-foreground',
                                    )}
                                  >
                                    {qty > 0 ? qty : '·'}
                                  </TableCell>
                                );
                              })}
                              <TableCell className={cn('py-2 text-right font-mono font-bold', isPicked && 'line-through text-muted-foreground')}>
                                {srow.total} <span className="text-muted-foreground text-xs font-normal">par</span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {/* Linha de total por numeração */}
                        <TableRow className="bg-muted/30 font-bold border-t-2">
                          <TableCell className="py-2" />
                          <TableCell className="py-2 text-xs uppercase tracking-wider text-muted-foreground" colSpan={2}>
                            Total por numeração
                          </TableCell>
                          {soleBreakdown.allSizes.map(s => {
                            const sum = soleBreakdown.rows.reduce((acc, r) => acc + (r.sizes[s] || 0), 0);
                            return (
                              <TableCell key={s} className="py-2 text-center font-mono font-bold">
                                {sum > 0 ? sum : '·'}
                              </TableCell>
                            );
                          })}
                          <TableCell className="py-2 text-right font-mono font-bold">
                            {soleBreakdown.grandTotal} <span className="text-muted-foreground text-xs font-normal">par</span>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
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
                              {row.widthMissing && (
                                <div className="text-[10px] text-amber-600 mt-0.5" title="Ficha de componente sem largura cadastrada — valor em dm² (não convertido para metros)">
                                  ⚠ sem largura
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </Panel>
            );
          })}

          {/* Bloco separado: tiras artesanais cortadas do rolo (vermelho) */}
          <ArtisanalStrapRollCutBlock rows={strapCut} />
        </div>
      )}
    </div>
  );
}
