import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CircleNotch as Loader2,
  ArrowsDownUp as ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Warning as WarningIcon,
  CheckCircle,
} from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { computeBaseMaterialTotal, BASE_MATERIAL_COMPONENTS, BASE_GROUP_PATTERN } from '@/lib/baseMaterialTotal';
import { buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';
import ConsumptionDecisionRail, { type ConsumptionFilter } from '@/components/sale-orders/ConsumptionDecisionRail';
import { type ConsumptionRow, COMPONENT_ORDER } from '@/lib/consumptionRows';
import { isBuyListRow } from '@/lib/buyList';
import { formatQty, formatUnit, pluralizeItens } from '@/lib/consumptionFormat';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
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
 *  - **Solado como mapa de compra prioritário**: a grade aparece aberta logo
 *    após o resumo, mostrando necessidade, estoque e falta POR NÚMERO. Solado
 *    não fica mais enterrado na ordenação nem depende de uma seta minúscula.
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-xs">
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
            { label: 'Estoque útil', get: (s: string) => Number(avail[s]) || 0 },
            { label: 'Falta', get: (s: string) => Math.max(0, (Number(row.sizeBreakdown?.[s]) || 0) - (Number(avail[s]) || 0)) },
          ] as const).map(({ label, get }) => (
            <tr key={label}>
              <th scope="row" className="border border-border bg-muted/30 px-2 py-1 text-left text-[11px] font-semibold">
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

/**
 * Solado é uma decisão de compra por grade, não mais uma linha genérica da
 * tabela. O bloco fica acima da dobra e sempre aberto no estado inicial.
 */
function SoleCoveragePanel({ rows }: { rows: ConsumptionRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card"
      aria-label="Solados por numeração"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div>
          <p className="eyebrow">Prioridade de compra</p>
          <h3 className="display mt-1 text-xl leading-none sm:text-2xl">Mapa de solados · grade por numeração</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Necessidade, estoque aproveitável e quantidade a comprar em cada número.
          </p>
        </div>
        <Badge variant="outline" className="font-mono tabular-nums">
          {rows.length} {rows.length === 1 ? 'solado' : 'solados'}
        </Badge>
      </header>

      <div className="divide-y divide-border">
        {rows.map((row, index) => {
          const known = rowKnown(row);
          const shortage = rowShortfall(row);
          const usefulStock = Math.max(0, row.totalQuantity - shortage);
          const shortSizes = soleShortSizes(row);
          const hasShortage = known && shortage > 0;
          return (
            <article
              key={`${row.groupName}-${row.color}-${row.productIds?.join(',') || index}`}
              className="px-4 py-3"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-bold text-foreground">{row.groupName}</h4>
                    {row.color && row.color !== '—' && (
                      <Badge variant="secondary" className="text-[10px]">{row.color}</Badge>
                    )}
                    {!known ? (
                      <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-700 dark:text-amber-400">
                        Cadastro incompleto
                      </Badge>
                    ) : hasShortage ? (
                      <Badge variant="destructive" className="text-[10px]">
                        Falta em {shortSizes.length || 1} {shortSizes.length === 1 ? 'número' : 'números'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-green-700 dark:text-green-400">
                        Grade coberta
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{row.materialName || 'Solado'}</p>
                  {row.warning && (
                    <p className="mt-1 max-w-2xl text-xs text-amber-700 dark:text-amber-400">
                      {row.warning}
                    </p>
                  )}
                </div>

                <dl className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-md border border-border bg-background text-right">
                  <div className="px-3 py-2">
                    <dt className="eyebrow">Necessidade</dt>
                    <dd className="mt-1 font-mono text-base font-bold tabular-nums">
                      {formatQty(row.totalQuantity, row.productUnit)} {formatUnit(row.productUnit)}
                    </dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="eyebrow">Estoque útil</dt>
                    <dd className="mt-1 font-mono text-base font-bold tabular-nums">
                      {known ? `${formatQty(usefulStock, row.productUnit)} ${formatUnit(row.productUnit)}` : '—'}
                    </dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="eyebrow">Comprar</dt>
                    <dd className={`mt-1 font-mono text-base font-bold tabular-nums ${
                      !known ? 'text-muted-foreground' : hasShortage ? 'text-destructive' : 'text-green-700 dark:text-green-400'
                    }`}>
                      {known ? `${formatQty(shortage, row.productUnit)} ${formatUnit(row.productUnit)}` : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              <SoleGradeDetail row={row} />
            </article>
          );
        })}
      </div>
    </section>
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
  const [napaOnly, setNapaOnly] = useState(false);
  const [search, setSearch] = useState('');

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
    return rows.filter((r) => {
      if (!searchMatchesAllTerms(search, r.groupName, r.materialName, r.color, r.componentType)) {
        return false;
      }
      if (napaOnly && !isBuyListRow(r)) return false;
      switch (filter) {
        case 'short': return isShortRow(r);
        case 'pending': return isPendingRow(r);
        case 'ok': return !isPendingRow(r) && !isShortRow(r);
        default: return true;
      }
    });
  }, [rows, search, filter, napaOnly, isShortRow]);

  const visibleSoleRows = useMemo(
    () => visibleRows.filter((row) => row.componentType === 'Solado'),
    [visibleRows],
  );
  const visibleMaterialRows = useMemo(
    () => visibleRows.filter((row) => row.componentType !== 'Solado'),
    [visibleRows],
  );

  const sortedRows = useMemo(() => {
    const canonical = (a: ConsumptionRow, b: ConsumptionRow) => {
      const t = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number])
        - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
      if (t !== 0) return t;
      return a.groupName.localeCompare(b.groupName, 'pt-BR')
        || a.materialName.localeCompare(b.materialName, 'pt-BR')
        || a.color.localeCompare(b.color, 'pt-BR');
    };
    if (!sortKey) return [...visibleMaterialRows].sort(canonical);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...visibleMaterialRows].sort((a, b) => {
      if (sortKey === 'totalQuantity') return (a.totalQuantity - b.totalQuantity) * dir;
      const aVal = (a[sortKey] || '').toLowerCase();
      const bVal = (b[sortKey] || '').toLowerCase();
      return aVal.localeCompare(bVal, 'pt-BR') * dir || canonical(a, b);
    });
  }, [visibleMaterialRows, sortKey, sortDir]);

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
    for (const row of visibleRows) map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    return map;
  }, [visibleRows]);

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
    const itemShort = isShortRow(row);
    // Item curto (mesmo material em várias aplicações) não pode aparecer
    // coberto só porque ESTA linha cabe no estoque — o balde inteiro não cabe.
    const ok = known && short === 0 && !itemShort;
    const hasQuantityPreview = !(row.totalQuantity > 0) && Number(row.previewQuantity) > 0;

    return (
      <TableRow key={`${sectionKey}-${row.groupName}-${row.materialName}-${row.color}-${index}`}>
        <TableCell className={`font-medium ${!neutralStock && known && !ok ? 'border-l-2 border-red-500/60' : ''}`}>
          <div className="flex items-center gap-1.5">
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
          {hasQuantityPreview ? (
            <>
              <span className="text-amber-700 dark:text-amber-400">
                ≈ {formatQty(Number(row.previewQuantity), row.productUnit)}
              </span>
              <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                prévia calculada pela ficha
              </div>
            </>
          ) : row.warning && !(row.totalQuantity > 0) ? (
            <span className="font-normal text-muted-foreground">—</span>
          ) : formatQty(row.totalQuantity, row.productUnit)}
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
            </span>
          )}
        </TableCell>
        <TableCell className="text-center text-xs text-muted-foreground">{formatUnit(row.productUnit)}</TableCell>
      </TableRow>
    );
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
    all: '', short: 'em falta', pending: 'com cadastro incompleto', ok: 'cobertas pelo estoque',
  };
  const filterActive = filter !== 'all' || napaOnly || !!search;
  const clearFilters = () => { setFilter('all'); setNapaOnly(false); setSearch(''); };
  const visibleShortItems = countShort(visibleRows);

  return (
    <div className="space-y-4">
      {/* O resumo ocupa toda a largura; abaixo dele, o mapa de solados abre a
          coluna principal enquanto o trilho mantém a ação de compra visível. */}
      <section className="grid overflow-hidden border-y-2 border-foreground bg-card sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(7rem,0.55fr))]" aria-label="Resumo operacional do consumo">
          <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
            <p className="eyebrow">Simulação atual · ficha e estoque agora</p>
            <h2 className="display mt-1 text-2xl leading-none sm:text-3xl">{title}</h2>
            <p className="mt-1.5 max-w-xl text-xs text-muted-foreground">
              Recalcula a ficha vigente. Uma OP já congelada pode manter o planejamento histórico usado na reserva e na baixa.
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
            <dd className="mt-1">
              <button
                type="button"
                onClick={() => setFilter((f) => f === 'short' ? 'all' : 'short')}
                aria-pressed={filter === 'short'}
                aria-label={filter === 'short' ? 'Mostrar todos os itens' : `Ver ${emFaltaCount} itens em falta`}
                className={`font-mono text-xl font-bold leading-none tabular-nums text-destructive hover:underline ${
                  filter === 'short' ? 'underline' : ''
                }`}
              >
                {emFaltaCount}
              </button>
            </dd>
            <dd className="mt-1 text-[10px] text-muted-foreground">itens para repor</dd>
          </dl>
          <dl className="px-3 py-3">
            <dt className="eyebrow">Pendências</dt>
            <dd className="mt-1">
              <button
                type="button"
                onClick={() => setFilter((f) => f === 'pending' ? 'all' : 'pending')}
                aria-pressed={filter === 'pending'}
                aria-label={filter === 'pending' ? 'Mostrar todos os itens' : `Ver ${pendingCount} cadastros a revisar`}
                className={`font-mono text-xl font-bold leading-none tabular-nums hover:underline ${
                  filter === 'pending' ? 'underline' : ''
                }`}
              >
                {pendingCount}
              </button>
            </dd>
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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <SoleCoveragePanel rows={visibleSoleRows} />

          <div>
            <p className="eyebrow">Materiais gerais</p>
            <h3 className="display mt-1 text-xl leading-none">Consumo e cobertura de estoque</h3>
          </div>

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
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar material, aplicação ou cor…"
            aria-label="Buscar material, aplicação ou cor"
            className="w-56"
            inputClassName="h-8 text-xs"
            resultCount={visibleRows.length}
            totalCount={rows.length}
          />
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
              <span key={unit} className="flex items-center gap-1">
                <span className="font-mono font-semibold tabular-nums text-foreground">{formatQty(total, unit)}</span>
                {formatUnit(unit)}
              </span>
            ))}
            <span>{pluralizeItens(visibleRows.length)}{filterActive && visibleRows.length !== rows.length ? ` de ${rows.length}` : ''}</span>
          </span>
          {filterActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
            >
              mostrando {visibleRows.length} de {rows.length}
              {filter !== 'all' ? ` · ${filterLabel[filter]}` : ''}
              {napaOnly ? ' · de napa' : ''}
              {filter === 'short' && visibleShortItems !== visibleRows.length
                ? ` · ${visibleShortItems} ${visibleShortItems === 1 ? 'item' : 'itens'}`
                : ''}
              {' · limpar'}
            </button>
          )}
        </div>

        {visibleRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma linha {filter !== 'all' ? filterLabel[filter] : ''}{napaOnly ? ' de napa' : ''} {search ? `para “${search}”` : ''}.
          </p>
        ) : visibleMaterialRows.length > 0 ? (
          <div className="overflow-hidden overflow-x-auto rounded-lg border">
            <Table aria-label="Materiais gerais" className="[&_tbody_tr]:border-dashed [&_tbody_tr]:border-border/70 [&_td]:py-2">
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
                  const previewSubt = new Map<string, number>();
                  for (const r of sectionRows) {
                    if (Number(r.previewQuantity) > 0) {
                      previewSubt.set(r.productUnit, (previewSubt.get(r.productUnit) || 0) + Number(r.previewQuantity));
                    }
                  }
                  const previewSubtotal = Array.from(previewSubt.entries())
                    .map(([u, v]) => `prévia ≈ ${formatQty(v, u)} ${formatUnit(u)}`)
                    .join(' · ');
                  const short = new Set(
                    sectionRows
                      .filter(isShortRow)
                      .map(itemKey),
                  ).size;
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
                            {previewSubtotal || subtotal}
                            {short > 0 && <span className="font-medium text-red-600 dark:text-red-400"> · {short} em falta</span>}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>,
                  );

                  // Dentro da seção: materiais por balde de estoque, com faixa
                  // quando o mesmo produto aparece em mais de uma aplicação.
                  // Solados ficam no mapa de grade dedicado, acima da tabela.
                  const items = aggregateItems(sectionRows);
                  for (const item of items) {
                    const multi = item.rows.length > 1;
                    if (multi) out.push(renderBand(item));
                    item.rows.forEach((row, i) => out.push(renderRow(row, i, multi, sectionKey)));
                  }
                  return out;
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}

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
        napaOnly={napaOnly}
        onNapaOnlyChange={setNapaOnly}
        onGerarOC={onGerarOC}
        onRecalcular={onRecalcular}
        onPrintPdf={handlePrintPdf}
        loading={loading}
        />
      </div>
    </div>
  );
}
