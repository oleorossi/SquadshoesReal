import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CircleNotch as Loader2,
  ArrowsDownUp as ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Warning as WarningIcon,
  CheckCircle,
  MagnifyingGlass,
  CaretRight,
  CaretDown,
} from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { escapeHtml } from '@/lib/htmlUtils';
import { computeBaseMaterialTotal, BASE_MATERIAL_COMPONENTS, BASE_GROUP_PATTERN } from '@/lib/baseMaterialTotal';
import { soleMatrixHtml, buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import ConsumptionDecisionRail, { type ConsumptionFilter } from '@/components/sale-orders/ConsumptionDecisionRail';
import { type ConsumptionRow, COMPONENT_ORDER, normTxt } from '@/lib/consumptionRows';
import { buildBuyList, isBuyListRow } from '@/lib/buyList';
import { formatQty, formatUnit, pluralizeItens } from '@/lib/consumptionFormat';
import {
  aggregateItems,
  countPending,
  countShort,
  itemIsShort,
  itemKey,
  itemShortfall,
  rowAvailable,
  rowIsShort,
  rowKnown,
  rowShortfall,
  soleShortSizes,
  topShortfalls,
  type ItemGroup,
} from '@/lib/consumptionAvailability';

/**
 * Apresentação canônica do consumo de materiais — tela + PDF. FONTE ÚNICA
 * compartilhada pela página por-PV e pela página multi-PV (Consolidado), as duas
 * servidas por `SummaryConsumptionPanel`.
 *
 * PURA sobre `rows` (linhas do motor canônico já anotadas com disponibilidade via
 * `annotateConsumptionAvailability`) + `artisanalStrapRows`. Não busca dados.
 *
 * ── Reformulação de 05/08/2026 (buy-first) ─────────────────────────────────
 * A tela respondia "qual é o consumo por componente"; o PDF respondia "o que
 * comprar". Quem abria a tela pra decidir compra tinha que fazer a conta de
 * cabeça. Agora as duas respondem a MESMA pergunta:
 *
 *  - **Uma tabela mestra** com filtros (em falta / napa / coberto), busca e
 *    "agrupar por" — em vez de N tabelas por componente. É o que aguenta o
 *    Consolidado com muitos PVs.
 *  - **Coluna "Falta"** com o número. Antes existia só o selo "falta", sem
 *    dizer QUANTO — o comprador ia buscar em outra tela.
 *  - **Trilho de decisão** sticky (`ConsumptionDecisionRail`) com material base,
 *    itens em falta, maiores faltas e a ação primária "Gerar OC".
 *  - **Solado como linha expansível**: a grade abre mostrando necessidade,
 *    estoque e falta POR NÚMERO (antes a matriz mostrava só a necessidade, com o
 *    estoque escondido no `title` da célula).
 *  - Os três banners âmbar viraram um cartão recolhível no trilho.
 *
 * O que NÃO mudou de propósito: a aritmética. Disponibilidade, falta, agregação
 * por balde de estoque e conversão de tira→napa moram em
 * `consumptionAvailability.ts` e `buyList.ts`, testados à parte.
 */
export type OrderHeader = { order_number: string; client_order_number?: string | null };

type Props = {
  /** Linhas do motor canônico já anotadas (available / soleSizeStock / artisanal). */
  rows: ConsumptionRow[];
  /** Bloco de corte do rolo (tiras artesanais) já agregado por grupo+cor. */
  artisanalStrapRows: ArtisanalStrapCutRow[];
  /** Título usado no `<title>`/`<h1>` do PDF (ex.: "Consumo de Materiais — PV-00147"). */
  title: string;
  /** Multi-PV: lista de pedidos consolidados (exibida no topo da tela e no PDF). */
  orderHeaders?: OrderHeader[];
  loading?: boolean;
  /** Botão "Recalcular" do trilho — omitido quando não fornecido. */
  onRecalcular?: () => void;
  /** Ação PRIMÁRIA: abre a geração de OC do(s) PV(s). Omitida ⇒ botão não aparece. */
  onGerarOC?: () => void;
  emptyMessage?: string;
  /**
   * Blocos específicos do escopo (ex.: Corte de Cabedal — Terceirização, que só
   * existe no consumo de UM PV). Vão no fim da coluna principal, não no trilho:
   * o trilho tem 18rem e esses blocos têm select e tabela.
   */
  extraSections?: ReactNode;
};

// Separador interno da chave de seção composta cor|família (agrupamento por Cor).
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

type SortKey = 'componentType' | 'groupName' | 'materialName' | 'color' | 'totalQuantity' | 'productUnit';
type GroupBy = 'componentType' | 'groupName' | 'color' | 'status';

const GROUP_BY_LABEL: Record<GroupBy, string> = {
  componentType: 'Componente',
  groupName: 'Material',
  color: 'Cor',
  status: 'Status',
};

/** Rótulos das seções de status, na ordem em que aparecem (falta primeiro). */
const STATUS_SECTIONS = ['Em falta', 'Cadastro incompleto', 'Coberto pelo estoque'] as const;

/**
 * Grade do solado de UMA linha: necessidade, estoque e falta por número.
 *
 * A matriz antiga (numeração × cor) mostrava só a necessidade e escondia o
 * estoque no `title` da célula — quem precisava saber o quanto comprar de cada
 * número não tinha o dado na tela.
 */
function SoleGradeDetail({ row }: { row: ConsumptionRow }) {
  const sizes = useMemo(
    () => Object.keys(row.sizeBreakdown || {}).sort((a, b) => sizeSortKey(a) - sizeSortKey(b)),
    [row.sizeBreakdown],
  );
  const avail = useMemo(
    () => buildColAvailability(row.soleSizeStock, sizes, row.sizeBreakdown || {}),
    [row.soleSizeStock, sizes, row.sizeBreakdown],
  );

  if (sizes.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Este solado não tem consumo por numeração — o cálculo usou o escalar da ficha, então não há
        grade pra conferir. Cadastre o consumo por número em <strong>Materiais → Solado</strong>.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto px-3 py-2">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="border border-border bg-muted/50 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Numeração
            </th>
            {sizes.map((s) => (
              <th key={s} className="border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] font-bold tabular-nums">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {([
            { label: 'Necessidade', get: (s: string) => Number(row.sizeBreakdown?.[s]) || 0 },
            { label: 'Em estoque', get: (s: string) => Number(avail[s]) || 0 },
            { label: 'Falta', get: (s: string) => Math.max(0, (Number(row.sizeBreakdown?.[s]) || 0) - (Number(avail[s]) || 0)) },
          ] as const).map(({ label, get }) => (
            <tr key={label}>
              <th className="border border-border bg-muted/30 px-2 py-1 text-left text-[11px] font-semibold">
                {label}
              </th>
              {sizes.map((s) => {
                const v = get(s);
                const isFalta = label === 'Falta' && v > 0;
                return (
                  <td
                    key={s}
                    className={`border border-border px-2 py-1 text-center font-mono tabular-nums ${
                      isFalta ? 'font-bold text-red-600 dark:text-red-400' : 'text-foreground'
                    }`}
                  >
                    {v > 0 ? formatQty(v, 'par') : <span className="text-muted-foreground">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MaterialConsumptionView({
  rows,
  artisanalStrapRows,
  title,
  orderHeaders,
  loading = false,
  onRecalcular,
  onGerarOC,
  emptyMessage = 'Nenhum consumo de material encontrado.',
  extraSections,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [groupBy, setGroupBy] = useState<GroupBy>('componentType');
  const [filter, setFilter] = useState<ConsumptionFilter>('all');
  const [search, setSearch] = useState('');
  const [openSoles, setOpenSoles] = useState<Record<string, boolean>>({});

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
    if (sortKey !== col) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  // ── Falta por ITEM (balde de estoque) ────────────────────────────────────
  // Um material aparece uma vez por APLICAÇÃO e as aplicações dividem o mesmo
  // estoque: a falta é do ITEM, não da linha. O filtro "em falta" precisa trazer
  // TODAS as linhas do item curto, senão a soma na tela não fecha com o motivo.
  const shortItemKeys = useMemo(() => {
    const s = new Set<string>();
    for (const it of aggregateItems(rows.filter((r) => r.componentType !== 'Solado'))) {
      if (itemIsShort(it)) s.add(it.key);
    }
    return s;
  }, [rows]);

  const isShortRow = useCallback(
    (r: ConsumptionRow) => (r.componentType === 'Solado' ? rowIsShort(r) : shortItemKeys.has(itemKey(r))),
    [shortItemKeys],
  );
  const isPendingRow = (r: ConsumptionRow) => !!(r.widthMissing || r.warning);

  const visibleRows = useMemo(() => {
    const q = normTxt(search);
    return rows.filter((r) => {
      if (q && !`${normTxt(r.groupName)} ${normTxt(r.materialName)} ${normTxt(r.color)}`.includes(q)) {
        return false;
      }
      switch (filter) {
        case 'short': return isShortRow(r);
        case 'pending': return isPendingRow(r);
        case 'napa': return isBuyListRow(r);
        case 'ok': return !isPendingRow(r) && !isShortRow(r);
        default: return true;
      }
    });
  }, [rows, search, filter, isShortRow]);

  const sortedRows = useMemo(() => {
    const canonical = (a: ConsumptionRow, b: ConsumptionRow) => {
      const t = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number])
        - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
      if (t !== 0) return t;
      return a.groupName.localeCompare(b.groupName, 'pt-BR')
        || a.materialName.localeCompare(b.materialName, 'pt-BR')
        || a.color.localeCompare(b.color, 'pt-BR');
    };
    if (!sortKey) return [...visibleRows].sort(canonical);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...visibleRows].sort((a, b) => {
      if (sortKey === 'totalQuantity') return (a.totalQuantity - b.totalQuantity) * dir;
      const aVal = (a[sortKey] || '').toLowerCase();
      const bVal = (b[sortKey] || '').toLowerCase();
      return aVal.localeCompare(bVal, 'pt-BR') * dir || canonical(a, b);
    });
  }, [visibleRows, sortKey, sortDir]);

  /**
   * Seções da tabela mestra. `groupBy` decide a SEGMENTAÇÃO e as colunas decidem
   * a ORDEM dentro dela — antes as duas coisas eram a mesma (ordenar por Cor
   * montava seções por cor), o que impedia, por exemplo, ver tudo agrupado por
   * componente e ordenado por quantidade.
   */
  const grouped = useMemo(() => {
    const out = new Map<string, ConsumptionRow[]>();

    if (groupBy === 'componentType') {
      for (const row of sortedRows) {
        if (!out.has(row.componentType)) out.set(row.componentType, []);
        out.get(row.componentType)!.push(row);
      }
      return out;
    }

    if (groupBy === 'status') {
      const bucket = (r: ConsumptionRow) =>
        isPendingRow(r) ? STATUS_SECTIONS[1] : isShortRow(r) ? STATUS_SECTIONS[0] : STATUS_SECTIONS[2];
      for (const label of STATUS_SECTIONS) {
        const secRows = sortedRows.filter((r) => bucket(r) === label);
        if (secRows.length) out.set(label, secRows);
      }
      return out;
    }

    // groupName | color — valor vazio/"—" primeiro, depois alfabético.
    const key = groupBy;
    const emptyLabel = key === 'color' ? 'Sem cor' : 'Sem grupo';
    const empties: ConsumptionRow[] = [];
    const byVal = new Map<string, ConsumptionRow[]>();
    for (const row of sortedRows) {
      const v = (row[key] || '').trim();
      if (!v || v === '—') { empties.push(row); continue; }
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v)!.push(row);
    }
    // Na visão por COR, quebra cada cor por FAMÍLIA de napa (NAPA SOFT × NAPA
    // MADRID viram seções separadas). SECTION_SEP separa cor|família na chave.
    const emitSection = (label: string, secRows: ConsumptionRow[]) => {
      if (key !== 'color') { out.set(label, secRows); return; }
      const fams = new Map<string, ConsumptionRow[]>();
      const neutral: ConsumptionRow[] = [];
      for (const r of secRows) {
        const f = rowFamily(r);
        if (f) { if (!fams.has(f)) fams.set(f, []); fams.get(f)!.push(r); }
        else neutral.push(r);
      }
      if (fams.size === 0) { out.set(label, secRows); return; }
      for (const f of Array.from(fams.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        out.set(`${label}${SECTION_SEP}${f}`, fams.get(f)!);
      }
      if (neutral.length) out.set(label, neutral);
    };
    if (empties.length) emitSection(emptyLabel, empties);
    for (const k of Array.from(byVal.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      emitSection(k, byVal.get(k)!);
    }
    return out;
  }, [sortedRows, groupBy, isShortRow]);

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    return map;
  }, [rows]);

  // ── Números do trilho (sempre sobre TODAS as linhas, não sobre o filtro) ──
  const baseTotal = useMemo(() => computeBaseMaterialTotal(rows), [rows]);
  const emFaltaCount = useMemo(() => countShort(rows), [rows]);
  const pendingCount = useMemo(() => countPending(rows), [rows]);
  const topShort = useMemo(() => topShortfalls(rows, 5), [rows]);
  const napaCount = useMemo(() => rows.filter(isBuyListRow).length, [rows]);
  const okCount = useMemo(
    () => rows.filter((r) => !isPendingRow(r) && !isShortRow(r)).length,
    [rows, isShortRow],
  );
  const pendingReasons = useMemo(() => ({
    widthMissing: rows.some((r) => r.widthMissing),
    noQty: rows.some((r) => r.warning && !(r.totalQuantity > 0)),
    withQty: rows.some((r) => r.warning && r.totalQuantity > 0),
  }), [rows]);

  const buyList = useMemo(() => buildBuyList(rows), [rows]);

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
    // Lidera com a LISTA DE COMPRA de napa por família → cor, depois o que está
    // PENDENTE de cadastro, depois os demais materiais e o corte do rolo. O
    // agrupamento vem de `buildBuyList` — o MESMO que alimenta a tela, pra o
    // papel nunca mais divergir dela.
    const napaAccent = (name: string): string => {
      const n = normTxt(name);
      if (n.includes('sudani')) return '#a75232';
      if (n.includes('madrid')) return '#9a5b2e';
      if (n.includes('palha')) return '#8a7320';
      if (n.includes('soft')) return '#3f5c93';
      if (BASE_GROUP_PATTERN.test(name)) return '#5a6b4a';
      return '#6b7280';
    };

    const { families: napaFams, grandTotal: grandNapa, pendingStraps, otherRows } = buyList;

    // (a) MATERIAL BASE (NAPA) A COMPRAR — família → cor, com selo de pendência.
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
            const status = c.pending > 0
              ? `<span style="font-size:8pt;font-weight:700;background:#fbefd8;color:#b45309;border:1px solid #ead4a4;padding:1px 6px;border-radius:20px">+${c.pending} a cadastrar</span>`
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
          <div style="background:#fef2f2;color:#dc2626;padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;border-radius:4px">✂️ Tiras artesanais — separação da napa-base</div>
          <p style="font-size:8.5pt;color:#dc2626;margin:4px 0">Metragem calculada por tira pronta ÷ rendimento confirmado da receita aprovada.</p>
          <table style="width:100%;border-collapse:collapse;font-size:9.5pt;border:1px solid #fca5a5">
            <thead><tr style="color:#dc2626;background:#fef2f2">
              <th style="padding:4px 6px;text-align:left;font-size:8.5pt;text-transform:uppercase">Tira e snapshot da receita</th>
              <th style="padding:4px 6px;text-align:right;font-size:8.5pt;text-transform:uppercase">Separar napa</th>
            </tr></thead>
            <tbody>${artisanalStrapRows.map((r) => {
              const snapshot = r.canonical;
              const blocked = !snapshot || snapshot.baseRequiredM <= 0
                || snapshot.confirmedYieldMPerM <= 0 || snapshot.blockingReasons.length > 0;
              const separar = !blocked && snapshot
                ? `<span style="font-weight:700;font-size:11pt">${snapshot.baseRequiredM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m</span>`
                : `<span style="font-size:8.5pt">⚠ ${escapeHtml(snapshot?.blockingReasons.join(' · ') || 'snapshot canônico incompleto')}</span>`;
              const details = snapshot
                ? `Tira ${r.metros_necessarios.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m · rendimento ${snapshot.confirmedYieldMPerM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m/m${snapshot.usableBaseWidthMm > 0 ? ` · largura útil ${snapshot.usableBaseWidthMm.toLocaleString('pt-BR')} mm` : ''}${r.largura_mm > 0 ? ` · banda ${r.largura_mm.toLocaleString('pt-BR')} mm` : ''}`
                : 'Sem receita canônica';
              return `<tr style="color:#dc2626">
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;font-weight:600">${escapeHtml(r.groupName)}${r.color && r.color !== '—' ? ` · ${escapeHtml(r.color)}` : ''}${r.baseName ? ` · base ${escapeHtml(r.baseName)}` : ''}<div style="font-size:7.5pt;font-weight:400;color:#6b7280">${escapeHtml(details)}</div></td>
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;text-align:right;font-family:monospace">${separar}</td>
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
        <p class="sub">Gerado em ${new Date().toLocaleDateString('pt-BR')} · ${napaFams.length} napa(s) a comprar${pendingStraps.length ? ` · ${pendingStraps.length} pendente(s) de cadastro` : ''}</p>
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
  }, [buyList, totalsByUnit, title, artisanalStrapRows, orderHeaders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">{emptyMessage}</p>;
  }

  // ── Render de uma linha da tabela mestra ────────────────────────────────
  const renderRow = (row: ConsumptionRow, index: number, neutralStock: boolean, sectionKey: string) => {
    const known = rowKnown(row);
    const avail = rowAvailable(row);
    const short = rowShortfall(row);
    const ok = known && short === 0;
    const isSole = row.componentType === 'Solado';
    const soleKey = `${sectionKey}|${row.groupName}|${row.color}|${index}`;
    const isOpen = !!openSoles[soleKey];

    const main = (
      <TableRow key={`${sectionKey}-${row.groupName}-${row.materialName}-${row.color}-${index}`}>
        <TableCell className={`font-medium ${!neutralStock && known && !ok ? 'border-l-2 border-red-500/60' : ''}`}>
          <div className="flex items-center gap-1.5">
            {isSole && (
              <button
                type="button"
                onClick={() => setOpenSoles((p) => ({ ...p, [soleKey]: !p[soleKey] }))}
                aria-expanded={isOpen}
                aria-label={isOpen ? 'Fechar grade por numeração' : 'Abrir grade por numeração'}
                className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              >
                {isOpen
                  ? <CaretDown className="h-3.5 w-3.5" aria-hidden="true" />
                  : <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            )}
            {row.widthMissing && (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <WarningIcon weight="fill" className="h-4 w-4 shrink-0 text-amber-600" />
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
                    <WarningIcon weight="fill" className="h-4 w-4 shrink-0 text-amber-600" />
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
            ? <span className="font-normal text-muted-foreground">—</span>
            : formatQty(row.totalQuantity, row.productUnit)}
          {row.artisanal && (
            row.artisanal.pending ? (
              <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-amber-600 dark:text-amber-400">
                base {row.artisanal.baseName} · rendimento a cadastrar
              </div>
            ) : (
              <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                ≈ {formatQty(row.artisanal.baseQty, 'm')} m {row.artisanal.baseName}
                <span className="opacity-70"> · artesanal (1 m → {row.artisanal.yieldPerMeter} m)</span>
              </div>
            )
          )}
        </TableCell>
        <TableCell
          className="text-right"
          aria-label={neutralStock ? 'total do item na faixa acima' : !known ? 'cadastro incompleto' : ok ? 'em estoque' : 'em falta'}
        >
          {neutralStock || !known ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="inline-flex items-center justify-end gap-1">
              {ok && <CheckCircle weight="fill" className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />}
              <span className={`font-mono tabular-nums ${ok ? 'text-foreground' : 'text-red-600 dark:text-red-400'}`}>
                {formatQty(avail, row.productUnit)}
              </span>
            </span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {neutralStock || !known || short === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="inline-flex items-center justify-end gap-1 font-mono font-bold tabular-nums text-red-600 dark:text-red-400">
              <WarningIcon weight="fill" className="h-3 w-3 shrink-0" aria-hidden="true" />
              {formatQty(short, row.productUnit)}
              {isSole && soleShortSizes(row).length > 0 && (
                <span className="ml-0.5 text-[10px] font-normal">em {soleShortSizes(row).length} nº</span>
              )}
            </span>
          )}
        </TableCell>
        <TableCell className="text-center text-xs text-muted-foreground">{formatUnit(row.productUnit)}</TableCell>
      </TableRow>
    );

    if (!isSole || !isOpen) return [main];
    return [
      main,
      <TableRow key={`${soleKey}-grade`} className="border-0 hover:bg-transparent">
        <TableCell colSpan={7} className="bg-muted/30 p-0">
          <SoleGradeDetail row={row} />
        </TableCell>
      </TableRow>,
    ];
  };

  const renderBand = (item: ItemGroup) => {
    const short = itemShortfall(item);
    const ok = item.known && short === 0;
    return (
      <TableRow key={`band-${item.key}`} className="border-0 hover:bg-transparent">
        <TableCell colSpan={7} className="p-0">
          <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y px-3 py-2 ${item.known ? 'border-green-600/25 bg-green-500/5' : 'border-amber-600/25 bg-amber-500/5'}`}>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${item.known ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
              Total do item · {item.groupName}
            </span>
            <span className={`font-mono text-lg font-bold tabular-nums ${item.known ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
              {formatQty(item.total, item.productUnit)}<span className="ml-0.5 text-xs font-semibold">{formatUnit(item.productUnit)}</span>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              = {item.rows.map((r) => `${formatQty(r.totalQuantity, r.productUnit)} ${r.materialName || 'aplicação'}`).join(' + ')}
            </span>
            {!item.known ? (
              <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">estoque não comparável — cadastro incompleto</span>
            ) : ok ? (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px]">
                <CheckCircle weight="fill" className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
                <span className="text-muted-foreground">em estoque</span>
                <span className="font-mono tabular-nums text-foreground">{formatQty(item.available, item.productUnit)} {formatUnit(item.productUnit)}</span>
              </span>
            ) : (
              <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
                <WarningIcon weight="fill" className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                <span className="text-muted-foreground">em estoque {formatQty(item.available, item.productUnit)} {formatUnit(item.productUnit)} ·</span>
                <span className="font-medium text-red-600 dark:text-red-400">faltam {formatQty(short, item.productUnit)} {formatUnit(item.productUnit)}</span>
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const filterLabel: Record<ConsumptionFilter, string> = {
    all: '', short: 'em falta', pending: 'com cadastro incompleto', napa: 'de napa', ok: 'cobertas pelo estoque',
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-3">
        {orderHeaders && orderHeaders.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            {orderHeaders.map((h, i) => (
              <span key={`${h.order_number}-${i}`} className="text-foreground">
                <span className="text-muted-foreground">Pedido:</span> <span className="font-medium">{h.order_number}</span>
                {h.client_order_number && <span className="text-muted-foreground"> · Pedido Cliente: {h.client_order_number}</span>}
              </span>
            ))}
          </div>
        )}

        {/* ── Barra de controle: agrupar, buscar, totais ─────────────────── */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Agrupar</span>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-8 w-[9.5rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((k) => (
                  <SelectItem key={k} value={k}>{GROUP_BY_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar material, aplicação ou cor…"
              aria-label="Buscar material, aplicação ou cor"
              className="h-8 w-56 pl-7 text-xs"
            />
          </div>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
              <span key={unit} className="flex items-center gap-1">
                <span className="font-mono font-semibold tabular-nums text-foreground">{formatQty(total, unit)}</span>
                {formatUnit(unit)}
              </span>
            ))}
            <span>{pluralizeItens(rows.length)}</span>
          </span>
          {(filter !== 'all' || search) && (
            <button
              type="button"
              onClick={() => { setFilter('all'); setSearch(''); }}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              mostrando {visibleRows.length} de {rows.length}
              {filter !== 'all' ? ` · ${filterLabel[filter]}` : ''} · limpar
            </button>
          )}
        </div>

        {visibleRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma linha {filter !== 'all' ? filterLabel[filter] : ''} {search ? `para “${search}”` : ''}.
          </p>
        ) : (
          <div className="overflow-hidden overflow-x-auto rounded-lg border">
            <Table className="[&_tbody_tr]:border-dashed [&_tbody_tr]:border-border/70 [&_td]:py-2">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead aria-sort={sortKey === 'groupName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full select-none items-center hover:text-foreground" onClick={() => handleSort('groupName')}>Grupo de material <SortIcon col="groupName" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'materialName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full select-none items-center hover:text-foreground" onClick={() => handleSort('materialName')}>Aplicação <SortIcon col="materialName" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'color' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full select-none items-center hover:text-foreground" onClick={() => handleSort('color')}>Cor <SortIcon col="color" /></button>
                  </TableHead>
                  <TableHead aria-sort={sortKey === 'totalQuantity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="flex w-full select-none items-center justify-end hover:text-foreground" onClick={() => handleSort('totalQuantity')}>Necessidade <SortIcon col="totalQuantity" /></button>
                  </TableHead>
                  <TableHead className="w-32 text-right">Em estoque</TableHead>
                  <TableHead className="w-32 text-right">Falta</TableHead>
                  <TableHead aria-sort={sortKey === 'productUnit' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined} className="w-20">
                    <button type="button" className="flex w-full select-none items-center justify-center hover:text-foreground" onClick={() => handleSort('productUnit')}>Un <SortIcon col="productUnit" /></button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(grouped.entries()).flatMap(([sectionKey, sectionRows]) => {
                  const out: JSX.Element[] = [];

                  // Cabeçalho da seção como linha da própria tabela — mantém o
                  // alinhamento das colunas entre seções, que N tabelas separadas
                  // não davam (cada uma calculava a largura sozinha).
                  const subt = new Map<string, number>();
                  for (const r of sectionRows) subt.set(r.productUnit, (subt.get(r.productUnit) || 0) + r.totalQuantity);
                  const subtotal = Array.from(subt.entries()).map(([u, v]) => `${formatQty(v, u)} ${formatUnit(u)}`).join(' · ');
                  const short = countShort(sectionRows);
                  const [secLabel, secFamily] = String(sectionKey).split(SECTION_SEP);
                  out.push(
                    <TableRow key={`sec-${sectionKey}`} className="border-0 hover:bg-transparent">
                      <TableCell colSpan={7} className="border-y border-border bg-muted/60 py-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                            <span aria-hidden="true" className="inline-block h-3.5 w-[3px] rounded-sm bg-primary" />
                            {secLabel}
                            {secFamily && (
                              <Badge variant="outline" className="text-[10px] font-semibold tracking-wide">{secFamily}</Badge>
                            )}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {subtotal}
                            {short > 0 && <span className="font-medium text-red-600 dark:text-red-400"> · {short} em falta</span>}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>,
                  );

                  // Dentro da seção: solado linha a linha (avaliado por numeração)
                  // e o resto por balde de estoque, com faixa quando o mesmo
                  // material aparece em mais de uma aplicação.
                  const soleRows = sectionRows.filter((r) => r.componentType === 'Solado');
                  const items = aggregateItems(sectionRows.filter((r) => r.componentType !== 'Solado'));
                  for (const item of items) {
                    const multi = item.rows.length > 1;
                    if (multi) out.push(renderBand(item));
                    item.rows.forEach((row, i) => out.push(...renderRow(row, i, multi, sectionKey)));
                  }
                  soleRows.forEach((row, i) => out.push(...renderRow(row, i, false, sectionKey)));
                  return out;
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Bloco separado: tiras artesanais cortadas do rolo (vermelho) */}
        <ArtisanalStrapRollCutBlock rows={artisanalStrapRows} />

        {extraSections}
      </div>

      <ConsumptionDecisionRail
        baseTotal={baseTotal}
        shortCount={emFaltaCount}
        pendingCount={pendingCount}
        pendingReasons={pendingReasons}
        topShort={topShort}
        napaCount={napaCount}
        okCount={okCount}
        totalItems={rows.length}
        filter={filter}
        onFilterChange={setFilter}
        onGerarOC={onGerarOC}
        onRecalcular={onRecalcular}
        onPrintPdf={handlePrintPdf}
        loading={loading}
      />
    </div>
  );
}
