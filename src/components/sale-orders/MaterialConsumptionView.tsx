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
import { computeBaseMaterialTotal, BASE_MATERIAL_COMPONENTS, BASE_GROUP_PATTERN } from '@/lib/baseMaterialTotal';
import { buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import ConsumptionDecisionRail, { type ConsumptionFilter } from '@/components/sale-orders/ConsumptionDecisionRail';
import { type ConsumptionRow, COMPONENT_ORDER, normTxt } from '@/lib/consumptionRows';
import { isBuyListRow } from '@/lib/buyList';
import { formatQty, formatUnit, pluralizeItens } from '@/lib/consumptionFormat';
import { buildMaterialConsumptionReportHtml, materialConsumptionReportFilename } from '@/lib/materialConsumptionReport';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';
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

  const handlePrintPdf = useCallback(() => {
    const target = openPrintTab();
    const html = buildMaterialConsumptionReportHtml({
      rows,
      artisanalStrapRows,
      title,
      orderHeaders,
    });
    void printHtmlAsPdf(html, {
      filename: materialConsumptionReportFilename(title),
      target,
    });
  }, [rows, title, artisanalStrapRows, orderHeaders]);

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
        {/* Manifesto operacional: contexto + decisão no mesmo plano, sem
            duplicar cartões soltos. O trilho à direita continua sendo a ação;
            esta faixa explica a leitura antes da tabela. */}
        <section className="grid overflow-hidden border-y-2 border-foreground bg-card sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(7rem,0.55fr))]" aria-label="Resumo operacional do consumo">
          <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
            <p className="eyebrow">Suprimentos · conferência do pedido</p>
            <h2 className="display mt-1 text-2xl leading-none sm:text-3xl">{title}</h2>
            <p className="mt-1.5 max-w-xl text-xs text-muted-foreground">
              Necessidade é consumo bruto; falta já desconta o estoque líquido e orienta a reposição.
            </p>
          </div>
          <dl className="border-r border-border px-3 py-3">
            <dt className="eyebrow">Material base</dt>
            <dd className="mt-1 font-mono text-xl font-bold leading-none tabular-nums">
              {baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}
            </dd>
            <dd className="mt-1 text-[10px] text-muted-foreground">necessidade de napa</dd>
          </dl>
          <dl className="border-r border-border px-3 py-3">
            <dt className="eyebrow">Em falta</dt>
            <dd className="mt-1 font-mono text-xl font-bold leading-none tabular-nums text-destructive">{emFaltaCount}</dd>
            <dd className="mt-1 text-[10px] text-muted-foreground">itens para repor</dd>
          </dl>
          <dl className="px-3 py-3">
            <dt className="eyebrow">Pendências</dt>
            <dd className="mt-1 font-mono text-xl font-bold leading-none tabular-nums">{pendingCount}</dd>
            <dd className="mt-1 text-[10px] text-muted-foreground">cadastros a revisar</dd>
          </dl>
        </section>

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
