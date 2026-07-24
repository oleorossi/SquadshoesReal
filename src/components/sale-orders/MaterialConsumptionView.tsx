import { useState, useMemo, useCallback } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, FileText, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown, Warning as WarningIcon, CheckCircle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { escapeHtml } from '@/lib/htmlUtils';
import { computeBaseMaterialTotal, BASE_MATERIAL_COMPONENTS, BASE_GROUP_PATTERN, BASE_LINEAR_UNITS } from '@/lib/baseMaterialTotal';
import { soleMatrixHtml, buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import { rollFillLabel, strapRollBarHtml, type ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import { type ConsumptionRow, COMPONENT_ORDER, normTxt } from '@/lib/consumptionRows';

/**
 * Apresentação canônica do consumo de materiais — tela + PDF + faixas de
 * disponibilidade. FONTE ÚNICA compartilhada pelo modal por-PV
 * (`MaterialConsumptionDialog`) e pela tela multi-PV (`SummaryConsumptionPanel`).
 * Extraída do modal em 2026-07-22 (`specs/consumo-consolidado-padronizacao.md`).
 *
 * PURA sobre `rows` (linhas do motor canônico já anotadas com disponibilidade via
 * `annotateConsumptionAvailability`) + `artisanalStrapRows`. Não busca dados. A
 * aquisição (motor + anotação) e as partes específicas (Corte de Cabedal do modal,
 * lista de PVs do Consolidado) ficam nos wrappers.
 */
export type OrderHeader = { order_number: string; client_order_number?: string | null };

type Props = {
  /** Linhas do motor canônico já anotadas (available / soleSizeStock / artisanal). */
  rows: ConsumptionRow[];
  /** Bloco de corte do rolo (tiras artesanais) já agregado por grupo+cor. */
  artisanalStrapRows: ArtisanalStrapCutRow[];
  /** Título usado no `<title>`/`<h1>` do PDF (ex.: "Consumo de Materiais — PV-00147"
   *  ou "Consumo Consolidado"). */
  title: string;
  /** Multi-PV: lista de pedidos consolidados (exibida no topo da tela e no PDF). */
  orderHeaders?: OrderHeader[];
  loading?: boolean;
  /** Botão "Recalcular" da toolbar — omitido quando não fornecido. */
  onRecalcular?: () => void;
  emptyMessage?: string;
  /** Sangria horizontal da toolbar sticky. Default `-mx-6 px-6` (casa com o `p-6`
   *  do DialogContent do modal). O Consolidado, dentro do `<main>` com padding
   *  responsivo, passa `''` pra não estourar horizontalmente. */
  stickyBleedClass?: string;
};

// Separador interno da chave de seção composta cor|família (visão por Cor).
const SECTION_SEP = String.fromCharCode(31);

// Família de napa de uma linha, pra segmentar por cor × família.
const rowFamily = (r: ConsumptionRow): string | null => {
  if (r.componentType === 'Tiras') return (r.materialFamily || '').trim() || null;
  if (BASE_MATERIAL_COMPONENTS.has(r.componentType)) {
    const g = (r.groupName || '').trim();
    return g && BASE_GROUP_PATTERN.test(g) ? g : null;
  }
  return null;
};

// ── Formatação de quantidade pt-BR (DISPLAY-ONLY) ──────────────────────────
const INTEGER_UNITS = new Set(['par', 'un', 'placa']);
const formatQty = (value: number, unit: string): string => {
  const isInt = INTEGER_UNITS.has((unit || '').toLowerCase());
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: isInt ? 0 : 2,
  }).format(Number(value) || 0);
};
const pluralizeItens = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

const formatUnit = (unit: string) => {
  const labels: Record<string, string> = {
    metro: 'm',
    m: 'm',
    'm²': 'm²',
    dm2: 'dm²',
    par: 'par',
    un: 'un',
    kg: 'kg',
    litro: 'L',
    placa: 'placa(s)',
  };
  return labels[unit] || unit || 'un';
};

// Disponível efetivo da linha (solado soma o stock_grade; demais usam `available`).
const rowAvailable = (r: ConsumptionRow): number =>
  r.componentType === 'Solado'
    ? Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0)
    : (r.available ?? 0);
// Solado é avaliado POR NUMERAÇÃO (igual à matriz): falta se ALGUM número não é
// coberto pelo stock_grade distribuído por `buildColAvailability`.
const soleRowShort = (r: ConsumptionRow): boolean => {
  const breakdown = r.sizeBreakdown || {};
  const sizes = Object.keys(breakdown);
  if (sizes.length === 0) return rowAvailable(r) < r.totalQuantity;
  const avail = buildColAvailability(r.soleSizeStock, sizes, breakdown);
  return sizes.some((s) => (Number(breakdown[s]) || 0) > (Number(avail[s]) || 0));
};
const rowIsShort = (r: ConsumptionRow): boolean => {
  if (r.widthMissing || (r.warning && !(r.totalQuantity > 0))) return false;
  if (r.componentType === 'Solado') return soleRowShort(r);
  return rowAvailable(r) < r.totalQuantity;
};

// ── Total de consumo SOMADO por item (grupo + cor) ─────────────────────────
// Um mesmo material aparece em várias linhas (uma por APLICAÇÃO). Elas dividem o
// MESMO estoque: somamos o consumo das aplicações e avaliamos o estoque UMA vez
// sobre esse total (representante de `available` — NUNCA somar). Solado fora: é
// avaliado por numeração.
type ItemGroup = {
  key: string;
  componentType: string;
  groupName: string;
  color: string;
  productUnit: string;
  rows: ConsumptionRow[];
  total: number;
  available: number;
  known: boolean;
};

// Item = BALDE de estoque (grupo + cor + unidade), INDEPENDENTE do componente.
const itemKey = (r: ConsumptionRow) =>
  `${r.groupName}||${r.color}||${r.productUnit}`;

const aggregateItems = (rows: ConsumptionRow[]): ItemGroup[] => {
  const map = new Map<string, ItemGroup>();
  for (const r of rows) {
    const k = itemKey(r);
    let it = map.get(k);
    if (!it) {
      it = {
        key: k,
        componentType: r.componentType,
        groupName: r.groupName,
        color: r.color,
        productUnit: r.productUnit,
        rows: [],
        total: 0,
        available: rowAvailable(r),
        known: true,
      };
      map.set(k, it);
    }
    it.rows.push(r);
    it.total += Number(r.totalQuantity) || 0;
    if (r.widthMissing || (r.warning && !(r.totalQuantity > 0))) it.known = false;
  }
  return Array.from(map.values());
};

const itemIsShort = (it: ItemGroup): boolean => it.known && it.available < it.total;

// Contagem "em falta" ITEM-a-item (não linha-a-linha). Solado por numeração.
const countShort = (rows: ConsumptionRow[]): number => {
  const sole = rows.filter(r => r.componentType === 'Solado' && rowIsShort(r)).length;
  const others = aggregateItems(rows.filter(r => r.componentType !== 'Solado')).filter(itemIsShort).length;
  return sole + others;
};

/**
 * Solado em matriz numeração × cor, colorida por disponibilidade.
 */
function SoleMatrix({ rows }: { rows: ConsumptionRow[] }) {
  const sizes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const s of Object.keys(r.sizeBreakdown || {})) set.add(s);
    return Array.from(set).sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  }, [rows]);
  const totalsBySize = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const [s, q] of Object.entries(r.sizeBreakdown || {})) m[s] = (m[s] || 0) + (Number(q) || 0);
    return m;
  }, [rows]);

  if (sizes.length === 0) {
    return (
      <div className="rounded-lg border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Solado</TableHead><TableHead>Cor</TableHead>
              <TableHead className="text-right">Consumo Total</TableHead>
              <TableHead className="text-right w-28">Em estoque</TableHead>
              <TableHead className="text-center w-24">Unidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const have = Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0);
              const ok = have >= r.totalQuantity;
              return (
                <TableRow key={i}>
                  <TableCell className={`font-medium ${!ok ? 'border-l-2 border-red-500/60' : ''}`}>{r.groupName}</TableCell>
                  <TableCell>{r.color}</TableCell>
                  <TableCell className="text-right font-mono font-bold tabular-nums">{formatQty(r.totalQuantity, 'par')}</TableCell>
                  <TableCell className="text-right" aria-label={ok ? 'em estoque' : 'em falta'}>
                    <span className="inline-flex items-center justify-end gap-1">
                      {ok
                        ? <CheckCircle weight="fill" className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" aria-hidden="true" />
                        : <WarningIcon weight="fill" className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />}
                      <span className={`font-mono tabular-nums font-semibold ${ok ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>{formatQty(have, 'par')}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">par</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto keep-together">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Cor</TableHead>
            {sizes.map((s) => <TableHead key={s} className="text-center px-2 whitespace-nowrap">{s}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const total = Object.values(r.sizeBreakdown || {}).reduce((s, v) => s + (Number(v) || 0), 0) || r.totalQuantity;
            return (
              <TableRow key={i}>
                <TableCell><Badge variant="outline" className="text-xs">{r.color}</Badge></TableCell>
                {(() => {
                  const avail = buildColAvailability(r.soleSizeStock, sizes, r.sizeBreakdown || {});
                  return sizes.map((s) => {
                  const need = r.sizeBreakdown?.[s] || 0;
                  const have = avail[s] || 0;
                  if (need <= 0) return <TableCell key={s} className="text-center text-muted-foreground">·</TableCell>;
                  const ok = have >= need;
                  return (
                    <TableCell
                      key={s}
                      title={`Necessário ${need} · Em estoque ${Math.round(have * 10) / 10}`}
                      aria-label={ok ? `${s}: em estoque` : `${s}: em falta`}
                      className={`text-center font-mono font-semibold tabular-nums ${ok ? 'text-foreground' : 'text-red-600 dark:text-red-400 border-b-2 border-red-500/60'}`}
                    >
                      {formatQty(need, 'par')}
                    </TableCell>
                  );
                  });
                })()}
                <TableCell className="text-right font-mono font-bold tabular-nums whitespace-nowrap">{formatQty(total, 'par')} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell>Total por numeração</TableCell>
            {sizes.map((s) => <TableCell key={s} className="text-center font-mono tabular-nums">{formatQty(totalsBySize[s] || 0, 'par')}</TableCell>)}
            <TableCell className="text-right font-mono tabular-nums">{formatQty(Object.values(totalsBySize).reduce((s, v) => s + v, 0), 'par')} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Seção Solado: uma MATRIZ POR (modelo + cor).
 */
function SoleSection({ rows }: { rows: ConsumptionRow[] }) {
  const bySole = useMemo(() => {
    const m = new Map<string, { sole: string; color: string; rows: ConsumptionRow[] }>();
    for (const r of rows) {
      const sole = r.groupName || '—';
      const color = r.color || '—';
      const k = `${sole}|||${color}`;
      if (!m.has(k)) m.set(k, { sole, color, rows: [] });
      m.get(k)!.rows.push(r);
    }
    return Array.from(m.values()).sort((a, b) => a.sole.localeCompare(b.sole, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
  }, [rows]);
  return (
    <div className="space-y-3">
      {bySole.map(({ sole, color, rows: soleRows }) => (
        <div key={`${sole}|||${color}`} className="space-y-1 keep-together">
          <div className="text-xs font-semibold flex items-center gap-2">
            <span className="inline-block rounded-sm border border-border px-2 py-0.5 text-foreground">{sole}</span>
            <span className="text-muted-foreground font-normal">{color}</span>
          </div>
          <SoleMatrix rows={soleRows} />
        </div>
      ))}
    </div>
  );
}

type SortKey = 'componentType' | 'groupName' | 'materialName' | 'color' | 'totalQuantity' | 'productUnit';

export default function MaterialConsumptionView({
  rows,
  artisanalStrapRows,
  title,
  orderHeaders,
  loading = false,
  onRecalcular,
  emptyMessage = 'Nenhum consumo de material encontrado.',
  stickyBleedClass = '-mx-6 px-6',
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'totalQuantity') return (a.totalQuantity - b.totalQuantity) * dir;
      const aVal = (a[sortKey] || '').toLowerCase();
      const bVal = (b[sortKey] || '').toLowerCase();
      return aVal.localeCompare(bVal, 'pt-BR') * dir;
    });
  }, [rows, sortKey, sortDir]);

  const grouped = useMemo(() => {
    // Visão SEGMENTADA: ao ordenar por qualquer coluna de TEXTO (Grupo, Aplicação,
    // Cor, Unidade), monta seções por valor daquela coluna — o valor vazio/sem no
    // topo e, depois, cada valor com TODOS os seus materiais em sequência.
    const SEGMENT_KEYS: SortKey[] = ['groupName', 'materialName', 'color', 'productUnit'];
    if (sortKey && SEGMENT_KEYS.includes(sortKey)) {
      const key = sortKey as 'groupName' | 'materialName' | 'color' | 'productUnit';
      const emptyLabel = key === 'color' ? 'Sem cor'
        : key === 'groupName' ? 'Sem grupo'
        : key === 'materialName' ? 'Sem aplicação'
        : 'Sem unidade';
      const sortWithin = (arr: ConsumptionRow[]) => [...arr].sort((a, b) => {
        const t = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number])
          - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
        if (t !== 0) return t;
        return a.groupName.localeCompare(b.groupName, 'pt-BR')
          || a.materialName.localeCompare(b.materialName, 'pt-BR')
          || a.color.localeCompare(b.color, 'pt-BR');
      });
      const empties: ConsumptionRow[] = [];
      const byVal = new Map<string, ConsumptionRow[]>();
      for (const row of rows) {
        const v = (row[key] || '').trim();
        if (!v || v === '—') { empties.push(row); continue; }
        if (!byVal.has(v)) byVal.set(v, []);
        byVal.get(v)!.push(row);
      }
      const dir = sortDir === 'asc' ? 1 : -1;
      const keys = Array.from(byVal.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR') * dir);
      const out = new Map<string, ConsumptionRow[]>();
      // Na visão por COR, quebra cada cor por FAMÍLIA de napa (NAPA SOFT × NAPA
      // MADRID viram seções separadas). SECTION_SEP separa cor|família na chave.
      const emitSection = (label: string, secRows: ConsumptionRow[]) => {
        if (key !== 'color') { out.set(label, sortWithin(secRows)); return; }
        const fams = new Map<string, ConsumptionRow[]>();
        const neutral: ConsumptionRow[] = [];
        for (const r of secRows) {
          const f = rowFamily(r);
          if (f) { if (!fams.has(f)) fams.set(f, []); fams.get(f)!.push(r); }
          else neutral.push(r);
        }
        if (fams.size === 0) { out.set(label, sortWithin(secRows)); return; }
        for (const f of Array.from(fams.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
          out.set(`${label}${SECTION_SEP}${f}`, sortWithin(fams.get(f)!));
        }
        if (neutral.length) out.set(label, sortWithin(neutral));
      };
      if (empties.length) emitSection(emptyLabel, empties); // sempre no topo
      for (const k of keys) emitSection(k, byVal.get(k)!);
      return out;
    }
    if (sortKey === 'totalQuantity') {
      return new Map([['Todos', sortedRows]]);
    }
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of sortedRows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [rows, sortedRows, sortKey, sortDir]);

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    }
    return map;
  }, [rows]);

  const emFaltaCount = useMemo(() => countShort(rows), [rows]);

  const handlePrintPdf = useCallback(() => {
    // Cores de cabeçalho por componentType (visual hierarchy)
    const componentColors: Record<string, { bg: string; border: string; text: string }> = {
      'Cabedal':    { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
      'Forração':      { bg: '#cffafe', border: '#06b6d4', text: '#155e75' },
      'Fachete':    { bg: '#cffafe', border: '#0891b2', text: '#155e75' },
      'Palmilha':   { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' },
      'Forração Palmilha': { bg: '#cffafe', border: '#06b6d4', text: '#155e75' },
      'Solado':     { bg: '#dcfce7', border: '#22c55e', text: '#14532d' },
      'Tiras':      { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
      'Químicos':   { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' },
      'Embalagem':  { bg: '#e0e7ff', border: '#6366f1', text: '#312e81' },
      'Outros':     { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' },
    };

    // ═══ PDF "Comprar primeiro" ═══
    // Lidera com a LISTA DE COMPRA de napa (material base) por família → cor,
    // depois o que está PENDENTE de cadastro, depois os demais materiais e o
    // corte do rolo. A conversão tira→napa e a família já vêm prontas nas linhas
    // do motor (row.artisanal / materialFamily); aqui só reorganiza a saída.
    const napaAccent = (name: string): string => {
      const n = normTxt(name);
      if (n.includes('sudani')) return '#a75232';
      if (n.includes('madrid')) return '#9a5b2e';
      if (n.includes('palha')) return '#8a7320';
      if (n.includes('soft')) return '#3f5c93';
      if (BASE_GROUP_PATTERN.test(name)) return '#5a6b4a';
      return '#6b7280';
    };
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // (a) lista de compra de napa por (família → cor); (b) pendentes; (c) resto.
    const napaBuy = new Map<string, Map<string, number>>();
    const pendingStraps: { tira: string; color: string; napa: string; tiraM: number }[] = [];
    const pendCountByKey = new Map<string, number>();
    const otherRows: ConsumptionRow[] = [];
    const addNapa = (napa: string, color: string, qty: number) => {
      if (!napaBuy.has(napa)) napaBuy.set(napa, new Map());
      const cm = napaBuy.get(napa)!;
      cm.set(color, (cm.get(color) || 0) + r2(qty));
    };
    for (const row of rows) {
      if (row.artisanal?.pending) {
        const napa = row.artisanal.baseName || 'Material base';
        pendingStraps.push({ tira: row.groupName, color: row.color, napa, tiraM: row.totalQuantity });
        const k = `${normTxt(napa)}||${normTxt(row.color)}`;
        pendCountByKey.set(k, (pendCountByKey.get(k) || 0) + 1);
        continue;
      }
      if (row.artisanal && row.artisanal.baseQty > 0) {
        addNapa(row.artisanal.baseName || 'Material base', row.color, row.artisanal.baseQty);
        continue;
      }
      const isNapaDireta = BASE_MATERIAL_COMPONENTS.has(row.componentType)
        && BASE_LINEAR_UNITS.has((row.productUnit || '').toLowerCase())
        && !row.widthMissing && !row.warning && row.totalQuantity > 0;
      if (isNapaDireta) { addNapa(row.groupName, row.color, row.totalQuantity); continue; }
      otherRows.push(row);
    }

    // (a) MATERIAL BASE (NAPA) A COMPRAR — família → cor, com selo de pendência.
    const napaFams = Array.from(napaBuy.entries()).map(([napa, cm]) => {
      const colors = Array.from(cm.entries()).map(([color, qty]) => ({ color, qty }))
        .sort((a, b) => b.qty - a.qty);
      const total = colors.reduce((s, c) => s + c.qty, 0);
      return { napa, colors, total };
    }).sort((a, b) => b.total - a.total);
    const grandNapa = napaFams.reduce((s, f) => s + f.total, 0);
    const napaSection = napaFams.length === 0 ? '' : `
      <div style="break-inside:avoid;margin-bottom:12px;border:1px solid #e6e1d8;border-radius:6px;overflow:hidden">
        <div style="background:#e7f4ec;border-bottom:1px solid #bce2c8;padding:6px 10px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span style="font-size:9pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#15803d">Material base (napa) a comprar</span>
          <span style="font-family:monospace;font-weight:800;color:#15803d;font-size:12pt">${formatQty(grandNapa, 'm')} m</span>
          <span style="margin-left:auto;font-size:8pt;color:#6b7280">napa cortada direto + tiras convertidas</span>
        </div>
        <table style="width:100%;border-collapse:collapse">${napaFams.map((f) => {
          const acc = napaAccent(f.napa);
          const famHead = `<tr><td colspan="3" style="padding:6px 8px;border-top:1.5px solid #1f2937;background:#faf8f4">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="display:inline-flex;align-items:center;gap:5px;font-size:8.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:${acc}">
                <span style="width:8px;height:8px;border-radius:2px;background:${acc};display:inline-block"></span>${escapeHtml(f.napa)}</span>
              <span style="margin-left:auto;font-family:monospace;font-weight:800;color:${acc}">${formatQty(f.total, 'm')} m</span>
            </div></td></tr>`;
          const colorRows = f.colors.map((c) => {
            const pend = pendCountByKey.get(`${normTxt(f.napa)}||${normTxt(c.color)}`) || 0;
            const status = pend > 0
              ? `<span style="font-size:8pt;font-weight:700;background:#fbefd8;color:#b45309;border:1px solid #ead4a4;padding:1px 6px;border-radius:20px">+${pend} a cadastrar</span>`
              : '';
            return `<tr>
              <td style="padding:4px 8px 4px 20px;border-bottom:1px solid #efeae1;font-weight:600">${escapeHtml(c.color || '—')}</td>
              <td style="padding:4px 8px;border-bottom:1px solid #efeae1;text-align:right;font-family:monospace;font-weight:700;color:${acc}">${formatQty(c.qty, 'm')} <span style="color:#9a9284;font-size:8pt">m</span></td>
              <td style="padding:4px 8px;border-bottom:1px solid #efeae1;text-align:right;width:120px">${status}</td>
            </tr>`;
          }).join('');
          return famHead + colorRows;
        }).join('')}</table>
      </div>`;

    // (b) PENDENTE DE CADASTRO — tiras cuja napa não tem rendimento cadastrado.
    const pendingSection = pendingStraps.length === 0 ? '' : `
      <div style="break-inside:avoid;margin-bottom:12px;border:1px solid #ead4a4;border-radius:6px;overflow:hidden">
        <div style="background:#fbefd8;padding:6px 10px;color:#b45309;font-weight:800;font-size:9pt;text-transform:uppercase;letter-spacing:.5px">
          ⚠ Pendente de cadastro · ${pendingStraps.length} tira${pendingStraps.length !== 1 ? 's' : ''} sem rendimento</div>
        <p style="font-size:8pt;color:#a8752f;margin:5px 10px 3px">Cadastre o rendimento da tira nessas napas pra estes metros entrarem no total a comprar acima.</p>
        <table style="width:100%;border-collapse:collapse">${pendingStraps.map((p) => `<tr>
          <td style="padding:3px 10px;border-bottom:1px solid #f0e7d8;font-weight:600;color:#b45309">${escapeHtml(p.tira)}<span style="color:#a8752f;font-weight:400"> · ${escapeHtml(p.color || '—')} · ${escapeHtml(p.napa)}</span></td>
          <td style="padding:3px 10px;border-bottom:1px solid #f0e7d8;text-align:right;font-family:monospace;color:#b45309">${formatQty(p.tiraM, 'm')} <span style="font-size:8pt;color:#a8752f">m de tira</span></td>
        </tr>`).join('')}</table>
      </div>`;

    // (c) OUTROS MATERIAIS (não-napa) — por componente; solado = matriz de grade.
    const otherByType = new Map<string, ConsumptionRow[]>();
    for (const row of otherRows) {
      if (!otherByType.has(row.componentType)) otherByType.set(row.componentType, []);
      otherByType.get(row.componentType)!.push(row);
    }
    const otherCards = Array.from(otherByType.entries()).map(([ct, crows]) => {
      const colors = componentColors[ct] || componentColors['Outros'];
      const subt = new Map<string, number>();
      for (const r of crows) subt.set(r.productUnit, (subt.get(r.productUnit) || 0) + r.totalQuantity);
      const totalSummary = Array.from(subt.entries()).map(([u, v]) => `${v.toFixed(1)} ${formatUnit(u)}`).join(' · ');
      const head = `<div style="background:${colors.bg};color:${colors.text};padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center"><span>▌${escapeHtml(ct)}</span><span style="font-size:8.5pt;font-weight:600;opacity:.8">${totalSummary}</span></div>`;
      if (ct === 'Solado') {
        return `<div class="card" style="grid-column:1 / -1;border:2px solid ${colors.border};border-radius:6px;overflow:hidden;margin-bottom:6px">${head}<div style="background:white;padding:0 6px 6px">${soleMatrixHtml(crows)}</div></div>`;
      }
      const body = crows.map((r) => {
        const app = r.materialName || r.groupName;
        return `<tr><td style="padding:3px 6px;border-bottom:1px solid #e5e7eb"><div style="font-weight:600;font-size:9.5pt">${escapeHtml(app)}</div><div style="color:#6b7280;font-size:8pt">${escapeHtml(r.groupName)}${r.color && r.color !== '—' ? ` · ${escapeHtml(r.color)}` : ''}</div></td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700;font-size:9.5pt">${r.totalQuantity.toFixed(2)} <span style="color:#6b7280;font-weight:400;font-size:8pt">${formatUnit(r.productUnit)}</span></td></tr>`;
      }).join('');
      return `<div class="card" style="border:2px solid ${colors.border};border-radius:6px;overflow:hidden;margin-bottom:6px">${head}<table style="width:100%;border-collapse:collapse;background:white"><tbody>${body}</tbody></table></div>`;
    }).join('');
    const otherSection = otherRows.length === 0 ? '' : `
      <div style="font-size:9pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#374151;margin:6px 0 6px;border-top:1.5px solid #d1d5db;padding-top:6px">Outros materiais</div>
      <div class="grid">${otherCards}</div>`;

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#1f2937;color:white;padding:3px 10px;border-radius:4px;margin-right:6px;font-size:9.5pt;font-weight:600">
        ${total.toFixed(1)} ${formatUnit(unit)}
      </span>`
    ).join('');

    // Cabeçalho multi-PV: lista de pedidos consolidados (só quando fornecida).
    const orderHeaderHtml = (orderHeaders && orderHeaders.length > 0) ? `
      <div style="margin:0 0 10px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:9pt">
        ${orderHeaders.map((h) => `<span><strong>PV ${escapeHtml(h.order_number)}</strong>${h.client_order_number ? ` <span style="color:#6b7280">· Cliente ${escapeHtml(h.client_order_number)}</span>` : ''}</span>`).join('')}
      </div>` : '';

    // Bloco vermelho: tiras artesanais — corte do rolo (mesmo conteúdo da tela).
    const strapCutHtml = artisanalStrapRows.length === 0 ? '' : `
        <div style="break-inside:avoid;margin-top:10px">
          <div style="background:#fef2f2;color:#dc2626;padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;border-radius:4px">✂️ Tiras artesanais — corte do rolo (40m × 1370mm)</div>
          <p style="font-size:8.5pt;color:#dc2626;margin:4px 0">Cortar do rolo — não é consumo direto de estoque.</p>
          <table style="width:100%;border-collapse:collapse;font-size:9.5pt;border:1px solid #fca5a5">
            <thead><tr style="color:#dc2626;background:#fef2f2">
              <th style="padding:4px 6px;text-align:left;font-size:8.5pt;text-transform:uppercase">Tira (cor · largura)</th>
              <th style="padding:4px 6px;text-align:right;font-size:8.5pt;text-transform:uppercase">Cortar do rolo (cm)</th>
            </tr></thead>
            <tbody>${artisanalStrapRows.map((r) => {
              const { cut } = r;
              const cortar = cut.valid
                ? `<span style="font-weight:700;font-size:11pt">${cut.cm_a_cortar.toFixed(1)} cm</span>`
                : `<span style="font-size:8.5pt">⚠ ${cut.warning || 'sem largura'}</span>`;
              const fill = rollFillLabel(cut);
              const breakdownHtml = fill ? `<div style="font-size:7.5pt;opacity:.85">${fill}</div>` : '';
              const larguraTxt = cut.widthMissing ? '' : ` · ${r.largura_mm.toFixed(0)} mm`;
              return `<tr style="color:#dc2626">
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;font-weight:600">${escapeHtml(r.groupName)}${r.color && r.color !== '—' ? ` · ${escapeHtml(r.color)}` : ''}${larguraTxt}</td>
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;text-align:right;font-family:monospace">${cortar}${strapRollBarHtml(cut)}${breakdownHtml}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
      <style>
        /* Margem 8mm (não 6mm) + box-sizing global p/ as bordas não serem
           cortadas na zona não-imprimível. Mesma correção de
           printLabels.ts/PrintWorkSheetsPage. */
        @page { size: A4 portrait; margin: 8mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #111; font-size: 10pt; line-height: 1.3; max-width: 100%; overflow-x: hidden; }
        h1 { font-size: 14pt; margin: 0 0 2px; }
        .sub { color: #6b7280; font-size: 9pt; margin: 0 0 8px; }
        .totals-strip { margin-bottom: 10px; padding: 6px 0; border-top: 2px solid #1f2937; border-bottom: 2px solid #1f2937; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
        .card { max-width: 100%; }
        table { max-width: 100%; }
        @media print {
          .card { break-inside: avoid; }
        }
      </style></head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p class="sub">Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${napaBuy.size} napa(s) a comprar${pendingStraps.length ? ` · ${pendingStraps.length} pendente(s) de cadastro` : ''}</p>
        ${orderHeaderHtml}
        <div class="totals-strip">${totalsHtml}</div>
        ${napaSection}
        ${pendingSection}
        ${otherSection}
        ${strapCutHtml}
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [rows, totalsByUnit, title, artisanalStrapRows, orderHeaders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-center text-muted-foreground py-8">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      {orderHeaders && orderHeaders.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {orderHeaders.map((h, i) => (
            <span key={`${h.order_number}-${i}`} className="text-foreground">
              <span className="text-muted-foreground">Pedido:</span> <span className="font-medium">{h.order_number}</span>
              {h.client_order_number && <span className="text-muted-foreground"> · Pedido Cliente: {h.client_order_number}</span>}
            </span>
          ))}
        </div>
      )}
      {rows.some(r => r.widthMissing) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
          <WarningIcon weight="fill" className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-300">Atenção — consumo pode estar inflado</p>
            <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
              Materiais marcados com <WarningIcon weight="fill" className="h-3 w-3 inline text-amber-600" /> não têm <strong>largura cadastrada</strong> na Ficha de Componente.
              Sem isso, o sistema trata dm² como metro, fazendo o consumo aparecer ~100× maior que o real.
              Cadastre em <strong>Materiais → produto → Ficha de Componente → Dimensões</strong> pra corrigir.
            </p>
          </div>
        </div>
      )}
      {rows.some(r => r.warning && !(r.totalQuantity > 0)) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
          <WarningIcon weight="fill" className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-300">Atenção — consumo não calculado por falta de cadastro</p>
            <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
              Linhas marcadas com <WarningIcon weight="fill" className="h-3 w-3 inline text-amber-600" /> aparecem <strong>sem quantidade</strong> porque falta cadastro (ex.: solado fachetado sem consumo de fachete). O consumo desses itens <strong>não entrou no total</strong> até você completar o cadastro em <strong>Materiais → Solado</strong>.
            </p>
          </div>
        </div>
      )}
      {rows.some(r => r.warning && r.totalQuantity > 0) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
          <WarningIcon weight="fill" className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-300">Atenção — consumo estimado pelo escalar da ficha</p>
            <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
              Algumas numerações da grade <strong>não têm consumo por número</strong> cadastrado no solado — nesses números o cálculo usou o <strong>escalar da ficha técnica</strong> (mesma regra do custeio/débito). Cadastre as numerações que faltam em <strong>Materiais → Solado</strong> pra ter o valor exato.
            </p>
          </div>
        </div>
      )}
      <div className={`sticky top-0 z-10 ${stickyBleedClass} py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
            <span key={unit} className="flex items-center gap-1.5">
              <span className="font-mono tabular-nums font-semibold text-foreground">{formatQty(total, unit)}</span>
              <span className="text-xs text-muted-foreground">{formatUnit(unit)}</span>
            </span>
          ))}
          <span className="text-xs text-muted-foreground">{pluralizeItens(rows.length)}</span>
          {emFaltaCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400">
              <WarningIcon weight="fill" className="h-3 w-3" aria-hidden="true" />{emFaltaCount} em falta
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400">
              <CheckCircle weight="fill" className="h-3 w-3" aria-hidden="true" />tudo em estoque
            </span>
          )}
          <span className="flex items-center gap-2 text-xs text-muted-foreground ml-1">
            <span className="flex items-center gap-1"><CheckCircle weight="fill" className="h-3 w-3 text-green-600 dark:text-green-400" aria-hidden="true" /> em estoque</span>
            <span className="inline-flex items-center gap-1 rounded-sm px-1 bg-red-500/10 text-red-600 dark:text-red-400"><WarningIcon weight="fill" className="h-3 w-3" aria-hidden="true" /> falta</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onRecalcular && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onRecalcular()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Recalcular
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintPdf}>
            <FileText className="h-4 w-4" /> Gerar PDF
          </Button>
        </div>
      </div>

      {Array.from(grouped.entries()).map(([componentType, componentRows]) => (
        <div key={componentType} className="space-y-1.5">
          {componentType !== 'Todos' && (() => {
            const subt = new Map<string, number>();
            for (const r of componentRows) subt.set(r.productUnit, (subt.get(r.productUnit) || 0) + r.totalQuantity);
            const subtotal = Array.from(subt.entries()).map(([u, v]) => `${formatQty(v, u)} ${formatUnit(u)}`).join(' · ');
            const short = countShort(componentRows);
            const [secLabel, secFamily] = String(componentType).split(SECTION_SEP);
            return (
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-foreground/60 pb-1.5">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                  <span aria-hidden="true" className="inline-block h-3.5 w-[3px] rounded-sm bg-primary" />
                  {secLabel}
                  {secFamily && (
                    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                      {secFamily}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {subtotal}
                  {short > 0 && <span className="text-red-600 dark:text-red-400 font-medium"> · {short} em falta</span>}
                </span>
              </div>
            );
          })()}
          {(() => {
            const base = computeBaseMaterialTotal(componentRows);
            if (!base) return null;
            return (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  Material base
                </span>
                <span className="font-mono tabular-nums text-lg font-bold text-primary">
                  {formatQty(base.total, 'm')}<span className="text-xs font-semibold ml-0.5">m</span>
                </span>
                {base.parts.length > 1 && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    = {base.parts.map(p => `${formatQty(p.qty, 'm')} ${p.name}`).join(' + ')}
                  </span>
                )}
                {base.skipped > 0 && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    {base.skipped} {base.skipped === 1 ? 'item ficou' : 'itens ficaram'} fora do total — cadastro incompleto
                  </span>
                )}
                {base.derived > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {base.derived} {base.derived === 1 ? 'tira com rendimento herdado' : 'tiras com rendimento herdado'} de outra napa
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  tiras convertidas em napa + napa cortada direto
                </span>
              </div>
            );
          })()}
          {componentType === 'Solado'
            ? <SoleSection rows={componentRows} />
            : (
           <div className="rounded-lg border overflow-hidden overflow-x-auto">
             <Table className="[&_td]:py-2 [&_tbody_tr]:border-dashed [&_tbody_tr]:border-border/70">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead aria-sort={sortKey === 'groupName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('groupName')}>Grupo de material <SortIcon col="groupName" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'materialName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('materialName')}>Aplicação <SortIcon col="materialName" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'color' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('color')}>Cor <SortIcon col="color" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'totalQuantity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('totalQuantity')}>Consumo Total <SortIcon col="totalQuantity" /></button>
                  </TableHead>
                  <TableHead className="text-right w-36">Em estoque</TableHead>
                  <TableHead aria-sort={sortKey === 'productUnit' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full items-center justify-center select-none hover:text-foreground" onClick={() => handleSort('productUnit')}>Unidade <SortIcon col="productUnit" /></button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const soleRows = componentRows.filter(r => r.componentType === 'Solado');
                  const items = aggregateItems(componentRows.filter(r => r.componentType !== 'Solado'));

                  const renderRow = (row: ConsumptionRow, index: number, neutralStock: boolean) => {
                    const known = !row.widthMissing && !(row.warning && !(row.totalQuantity > 0));
                    const avail = rowAvailable(row);
                    const ok = avail >= row.totalQuantity;
                    return (
                  <TableRow key={`${row.componentType}-${row.groupName}-${row.materialName}-${row.color}-${index}`}>
                    <TableCell className={`font-medium ${!neutralStock && known && !ok ? 'border-l-2 border-red-500/60' : ''}`}>
                      <div className="flex items-center gap-1.5">
                        {row.widthMissing && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <WarningIcon weight="fill" className="h-4 w-4 text-amber-600 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-xs">
                                  Largura do material não cadastrada em <strong>Materiais → Ficha de Componente</strong>.
                                  Consumo pode estar até <strong>100× inflado</strong>. Cadastre <code>dimensions_width</code> pra corrigir.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {row.warning && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <WarningIcon weight="fill" className="h-4 w-4 text-amber-600 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-xs">{row.warning}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {row.groupName}
                      </div>
                    </TableCell>
                    <TableCell>{row.materialName}</TableCell>
                    <TableCell>{row.color}</TableCell>
                    <TableCell className="text-right font-mono font-bold tabular-nums">
                      {row.warning && !(row.totalQuantity > 0)
                        ? <span className="text-muted-foreground font-normal">—</span>
                        : formatQty(row.totalQuantity, row.productUnit)}
                      {row.artisanal && (
                        row.artisanal.pending ? (
                          <div className="text-[10px] font-normal text-amber-600 dark:text-amber-400 mt-0.5 whitespace-nowrap">
                            base {row.artisanal.baseName} · rendimento a cadastrar
                          </div>
                        ) : (
                          <div className="text-[10px] font-normal text-muted-foreground mt-0.5 whitespace-nowrap">
                            ≈ {formatQty(row.artisanal.baseQty, 'm')} m {row.artisanal.baseName}
                            <span className="opacity-70"> · artesanal (1 m → {row.artisanal.yieldPerMeter} m)</span>
                            {row.artisanal.derivedFrom && (
                              <span className="opacity-70"> · rendimento herdado de {row.artisanal.derivedFrom}</span>
                            )}
                          </div>
                        )
                      )}
                    </TableCell>
                    <TableCell className="text-right" aria-label={neutralStock ? 'total do item na faixa acima' : !known ? 'largura não cadastrada' : ok ? 'em estoque' : 'em falta'}>
                      {neutralStock ? (
                        <span className="text-muted-foreground">—</span>
                      ) : !known ? (
                        <span className="text-muted-foreground">—</span>
                      ) : ok ? (
                        <span className="inline-flex items-center justify-end gap-1">
                          <CheckCircle weight="fill" className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" aria-hidden="true" />
                          <span className="font-mono tabular-nums text-foreground">{formatQty(avail, row.productUnit)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-1 flex-wrap">
                          <span className="font-mono tabular-nums text-red-600 dark:text-red-400">{formatQty(avail, row.productUnit)}</span>
                          <span
                            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-400"
                            title={`Faltam ${formatQty(row.totalQuantity - avail, row.productUnit)} ${formatUnit(row.productUnit)}`}
                          >
                            <WarningIcon weight="fill" className="h-3 w-3" aria-hidden="true" />falta
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">{formatUnit(row.productUnit)}</TableCell>
                  </TableRow>
                    );
                  };

                  const renderBand = (item: ItemGroup) => {
                    const ok = item.available >= item.total;
                    return (
                      <TableRow key={`band-${item.key}`} className="border-0 hover:bg-transparent">
                        <TableCell colSpan={6} className="p-0">
                          <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y px-3 py-2 ${item.known ? 'border-green-600/25 bg-green-500/5' : 'border-amber-600/25 bg-amber-500/5'}`}>
                            <span className={`text-[11px] font-bold uppercase tracking-wider ${item.known ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                              Total do item · {item.groupName}
                            </span>
                            <span className={`font-mono tabular-nums text-lg font-bold ${item.known ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                              {formatQty(item.total, item.productUnit)}<span className="text-xs font-semibold ml-0.5">{formatUnit(item.productUnit)}</span>
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              = {item.rows.map(r => `${formatQty(r.totalQuantity, r.productUnit)} ${r.materialName || 'aplicação'}`).join(' + ')}
                            </span>
                            {!item.known ? (
                              <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">estoque não comparável — cadastro incompleto</span>
                            ) : ok ? (
                              <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
                                <CheckCircle weight="fill" className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" aria-hidden="true" />
                                <span className="text-muted-foreground">em estoque</span>
                                <span className="font-mono tabular-nums text-foreground">{formatQty(item.available, item.productUnit)} {formatUnit(item.productUnit)}</span>
                              </span>
                            ) : (
                              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] flex-wrap justify-end">
                                <WarningIcon weight="fill" className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                                <span className="text-muted-foreground">em estoque {formatQty(item.available, item.productUnit)} {formatUnit(item.productUnit)} ·</span>
                                <span className="font-medium text-red-600 dark:text-red-400">faltam {formatQty(item.total - item.available, item.productUnit)} {formatUnit(item.productUnit)}</span>
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  };

                  const out: JSX.Element[] = [];
                  for (const item of items) {
                    const multi = item.rows.length > 1;
                    if (multi) out.push(renderBand(item));
                    item.rows.forEach((row, i) => out.push(renderRow(row, i, multi)));
                  }
                  soleRows.forEach((row, i) => out.push(renderRow(row, i, false)));
                  return out;
                })()}
              </TableBody>
            </Table>
          </div>
          )}
        </div>
      ))}

      {/* Bloco separado: tiras artesanais cortadas do rolo (vermelho) */}
      <ArtisanalStrapRollCutBlock rows={artisanalStrapRows} />
    </div>
  );
}
