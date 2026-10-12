import { computeBaseMaterialTotal, normalizeBaseFamilyName } from '@/lib/baseMaterialTotal';
import { buildBuyList } from '@/lib/buyList';
import { STRAP_ORIGIN_LABEL } from '@/lib/canonicalStrapDemandPreview';
import {
  aggregateItems,
  countPending,
  countShort,
  isFazerStrapRow,
  itemShortfall,
  pendingStrapMeters,
  rowAvailable,
  rowKnown,
  rowShortfall,
  soleShortSizes,
  topShortfalls,
  unitTotals,
} from '@/lib/consumptionAvailability';
import { consumptionApplicationText, formatQty, formatUnit, formatPricePerUnit } from '@/lib/consumptionFormat';
import { COMPONENT_ORDER, type ConsumptionRow, rowTotalCost } from '@/lib/consumptionRows';
import { escapeHtml } from '@/lib/htmlUtils';
import { buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';
import { aggregateStrapNapaSector } from '@/lib/strapRollCut';
import { formatCurrency, formatMoney } from '@/lib/utils';
import { buildOrderReferencePartitions } from '@/lib/consumptionPartitions';
import { formatNapaMeters } from '@/lib/strapConsumptionDisplay';

export type ConsumptionPartitionMode = 'none' | 'order_reference';

export interface MaterialConsumptionReportOrderHeader {
  order_number: string;
  client_order_number?: string | null;
}

export interface MaterialConsumptionReportInput {
  rows: ConsumptionRow[];
  artisanalStrapRows: ArtisanalStrapCutRow[];
  title: string;
  orderHeaders?: MaterialConsumptionReportOrderHeader[];
  /** Injetável para teste: o documento precisa ser determinístico. */
  generatedAt?: Date;
  /**
   * `coverage` (padrão) = o que comprar depois do estoque.
   * `total` = necessidade bruta do pedido, estoque ignorado.
   */
  mode?: 'coverage' | 'total';
  /** Quebra o PDF por PV → modelo quando `order_reference`. */
  partitionMode?: ConsumptionPartitionMode;
}

const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Anton&family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@400;500;600;700&display=swap';

const componentIndex = (componentType: string): number => {
  const index = COMPONENT_ORDER.indexOf(componentType as (typeof COMPONENT_ORDER)[number]);
  return index >= 0 ? index : COMPONENT_ORDER.length;
};

const itemComponentTypes = (rows: ConsumptionRow[]): string[] => Array.from(new Set(
  rows.map((row) => row.componentType).filter(Boolean),
)).sort((a, b) => componentIndex(a) - componentIndex(b) || a.localeCompare(b, 'pt-BR'));

const reportFilenamePart = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

export function materialConsumptionReportFilename(title: string): string {
  return reportFilenamePart(title) || 'consumo-de-materiais';
}

const renderScope = (orderHeaders?: MaterialConsumptionReportOrderHeader[]): string => {
  if (!orderHeaders?.length) return '';
  return `<div class="scope">
    <span class="scope-label">Pedidos no escopo</span>
    <div class="scope-list">${orderHeaders.map((order) => `
      <span><strong>${escapeHtml(order.order_number)}</strong>${order.client_order_number ? ` · cliente ${escapeHtml(order.client_order_number)}` : ''}</span>
    `).join('')}</div>
  </div>`;
};

const mCell = (qty: number): string =>
  qty > 0 ? `${formatQty(qty, 'm')} m` : '<span class="muted">—</span>';

/** Nome do bloco que carrega a napa das tiras — citado em nota e manifesto. */
const BLOCO_TIRAS = 'no bloco Tiras · prestador';

/**
 * O bloco "Tiras · prestador" só existe quando há tira de Prestador no escopo.
 * Num PV só de strass (ou sem tira) o documento não pode mandar o leitor para
 * um bloco que não foi impresso.
 */
const STRAP_SECTOR_NOTE = (hasStrapSector: boolean): string =>
  (hasStrapSector ? ` A napa das tiras está só ${BLOCO_TIRAS}.` : '');

/**
 * §01 — napa cortada DIRETO do rolo, por família → cor. Total da cor =
 * Cabedal + Forração (as duas colunas fecham com ele). Decisão do dono
 * (11/10/2026): a napa das tiras — convertida ou com rendimento pendente — não
 * entra aqui; mora só no bloco "Tiras · prestador", que também mostra o
 * "cadastro incompleto". A coluna "Situação" (contagem de tira pendente por cor) saiu
 * junto: sem tira no §01 ela seria só espaço morto.
 */
const renderBaseNeed = (rows: ConsumptionRow[], totalMode: boolean, hasStrapSector: boolean): string => {
  const { families } = buildBuyList(rows);
  if (!families.length) return '';

  const familyBlocks = families.map((family) => {
    // As duas colunas de aplicação só entram quando a família MISTURA as duas:
    // `qty` é exatamente cabedal + forração, então com uma aplicação só a
    // coluna dela repete o Total e a outra sai "—" em todas as linhas — era
    // uma coluna de papel em branco mais uma coluna duplicada (medido
    // 12/10/2026). Quem precisa da aplicação linha a linha tem o §02 logo
    // abaixo, que nomeia a de cada item (e sem o atalho cabedal/forração:
    // lá Fachete e Forração Palmilha aparecem com o próprio nome).
    const split = family.colors.some((color) => color.cabedal > 0)
      && family.colors.some((color) => color.forracao > 0);
    return `
    <article class="napa-family">
      <header class="napa-family-head">
        <span class="napa-family-name">${escapeHtml(family.napa)}</span>
        <span class="napa-family-meta">${family.colors.length} cor${family.colors.length === 1 ? '' : 'es'}</span>
        <span class="napa-family-qty">${formatQty(family.total, 'm')} m</span>
      </header>
      <table class="report-table napa-table">
        <thead><tr>
          <th>Cor</th>
          ${split ? '<th class="num">Cabedal</th><th class="num">Forração</th>' : ''}
          <th class="num">Total</th>
        </tr></thead>
        <tbody>${family.colors.map((color) => `
          <tr>
            <td>${escapeHtml(color.color || '—')}</td>
            ${split ? `<td class="num app-qty">${mCell(color.cabedal)}</td>
            <td class="num app-qty">${mCell(color.forracao)}</td>` : ''}
            <td class="num strong">${formatQty(color.qty, 'm')} m</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </article>`;
  }).join('');

  return `
    <section class="report-section priority-section">
      <div class="section-heading">
        <span class="section-number">01</span>
        <div><p class="section-kicker">Material base</p><h2>Necessidade de napa</h2></div>
        <p class="section-note">${totalMode
          ? `Estoque ignorado. Cabedal, Forração e Fachete — total por família e cor.${STRAP_SECTOR_NOTE(hasStrapSector)}`
          : `Cabedal, Forração e Fachete — total por família e cor; a falta por item está no §02.${STRAP_SECTOR_NOTE(hasStrapSector)}`}</p>
      </div>
      ${familyBlocks}
    </section>`;
};

const renderSoleGrade = (row: ConsumptionRow, totalMode: boolean): string => {
  const breakdown = row.sizeBreakdown || {};
  const sizes = Object.keys(breakdown).sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  if (!sizes.length) return '';
  const available = buildColAvailability(row.soleSizeStock, sizes, breakdown);
  const renderCells = (values: Record<string, number>, emphasizeShort = false) => sizes.map((size) => {
    const value = Number(values[size]) || 0;
    const isShort = emphasizeShort && value > 0;
    return `<td class="grade-num${isShort ? ' shortage' : ''}">${value > 0 ? formatQty(value, 'par') : '·'}</td>`;
  }).join('');
  const missing = Object.fromEntries(sizes.map((size) => [
    size,
    Math.max(0, (Number(breakdown[size]) || 0) - (Number(available[size]) || 0)),
  ]));

  return `<div class="sole-grade">
    <table>
      <thead><tr><th>Grade</th>${sizes.map((size) => `<th class="grade-num">${escapeHtml(size)}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><th>Necessidade</th>${renderCells(breakdown)}</tr>
        ${totalMode ? '' : `<tr><th>Estoque</th>${renderCells(available)}</tr>
        <tr><th>Falta</th>${renderCells(missing, true)}</tr>`}
      </tbody>
    </table>
  </div>`;
};

/**
 * A soma bruta de `stock_grade` pode estar concentrada em numerações que o
 * pedido não usa. O PDF mostra o mesmo "Estoque útil" da tela: necessidade
 * menos a falta calculada pela distribuição canônica dos baldes conjugados.
 */
const reportRowAvailable = (row: ConsumptionRow): number => {
  if (row.componentType !== 'Solado' || Object.keys(row.sizeBreakdown || {}).length === 0) {
    return rowAvailable(row);
  }
  return Math.max(0, (Number(row.totalQuantity) || 0) - rowShortfall(row));
};

/**
 * Soma o "Valor a gastar" exatamente como a seção 02 renderiza: itens
 * agregados (SKU compartilhado uma vez) + solados linha a linha. Tira
 * Comprar pronto / strass entra uma vez por balde do SKU — é o mesmo balde que
 * o bloco Tiras soma por tipo × cor. Tira de Prestador fica de fora — não se
 * compra tira pronta (D8/D9).
 */
export function computeMaterialsSpendTotal(rows: ConsumptionRow[]): number | null {
  let total = 0;
  let any = false;

  const nonSole = aggregateItems(
    rows.filter((row) => row.componentType !== 'Solado' && !isFazerStrapRow(row)),
  );
  for (const item of nonSole) {
    const unitPrice = item.rows.map((row) => row.unitPrice).find((price) => price != null && Number.isFinite(price)) ?? null;
    if (unitPrice == null) continue;
    total += item.total * unitPrice;
    any = true;
  }

  for (const row of rows.filter((entry) => entry.componentType === 'Solado')) {
    const cost = rowTotalCost(row);
    if (cost == null) continue;
    total += cost;
    any = true;
  }

  return any ? total : null;
};

const costCellsHtml = (unitPrice: number | null, totalCost: number | null, unit?: string): string => `
      <td class="num cost-unit">${unitPrice != null ? escapeHtml(formatPricePerUnit(unitPrice, unit || 'un', formatCurrency)) : '—'}</td>
      <td class="num cost-spend">${totalCost != null ? escapeHtml(formatMoney(totalCost)) : '—'}</td>`;

// ── §02 · bloco TIRAS (redesenho de 11/10/2026) ───────────────────────────
// Decisão do dono: no §02 a tira é só o TOTAL por tipo × cor — sem metros por
// numeração, sem pares e sem a nota "enviar ao prestador ≈ x m napa" (a napa
// das tiras mora só no bloco Tiras · prestador). Todas as linhas da ficha
// (TIRA 1..4, TRASEIRA) e de todas as referências do escopo viram UMA linha
// por tipo × cor; o strass (comprado pronto) entra no mesmo bloco, com a
// coluna Origem. Tabela própria: as colunas Aplicação, Un. e Preço/un. da
// tabela de materiais seriam espaço morto aqui (densidade vem de tirar espaço
// morto, nunca de reduzir fonte — Preferências de impressão do CLAUDE.md).

type StrapLineOrigin = 'fazer' | 'comprar' | null;

/** Uma linha do bloco Tiras do §02: total por tipo de tira × cor. */
export type StrapTypeColorLine = {
  /** Tipo sem a cor (ex.: "TIRA OVERLOCK 5 mm · GLOW METALIC"). */
  typeName: string;
  color: string;
  /** Prestador (`fazer`), Comprar pronto, ou null = origem ainda não resolvida. */
  origin: StrapLineOrigin;
  unit: string;
  /** Metros de TIRA — necessidade bruta somada de todas as linhas da ficha. */
  total: number;
  /** Metragem só prevista pela ficha (tira sem identidade canônica). */
  preview: number;
  /** Tira pronta em estoque — cada balde de SKU contado uma vez. */
  available: number;
  /** Estoque comparável (nenhuma linha com cadastro incompleto). */
  known: boolean;
  /** Comprar pronto: falta pelo balde do SKU. Prestador: sempre 0. */
  shortfall: number;
  /** Prestador: metros a fazer pelo prestador depois da tira pronta em estoque. */
  toMake: number;
  /** Σ necessidade × preço nos baldes com preço; null sem preço (Prestador: null). */
  spend: number | null;
  /** Alguma linha com pendência (rendimento/receita ou cadastro incompleto). */
  pending: boolean;
  warnings: string[];
  rows: ConsumptionRow[];
};

const strapLineOrigin = (row: ConsumptionRow): StrapLineOrigin => {
  if (isFazerStrapRow(row)) return 'fazer';
  if (row.strap?.origin === 'comprar' || row.strapSourceMode === 'buy_ready') return 'comprar';
  return null;
};

const STRAP_LINE_ORIGIN_TEXT = (origin: StrapLineOrigin): string =>
  origin ? STRAP_ORIGIN_LABEL[origin] : 'Origem pendente';

/** Tipo da tira sem o sufixo de cor do SKU ("… · CHAMPAGNE", "… - CHAMPAGNE"). */
const strapTypeName = (row: ConsumptionRow): string => {
  const name = (row.groupName || '').trim();
  if (!name) return 'Tira';
  return normalizeBaseFamilyName(name, row.color) || name;
};

const strapKeyPart = (value: string): string => (value || '')
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const isMeterUnit = (unit: string | null | undefined): boolean =>
  ['m', 'metro', 'metros'].includes((unit || '').toLowerCase().trim());

const firstFinitePrice = (rows: ConsumptionRow[]): number | null =>
  rows.map((row) => row.unitPrice).find((price) => price != null && Number.isFinite(price)) ?? null;

/**
 * Agrega TODAS as linhas de tira do escopo por tipo × cor. Origem e unidade
 * também vão na chave: Prestador e Comprar pronto do mesmo tipo × cor seguem
 * fluxos diferentes (prestador × compra) e metro nunca soma com outra unidade —
 * no caso normal tipo × cor tem uma origem só e a linha é uma.
 */
export function aggregateStrapTypeColorLines(rows: ConsumptionRow[]): StrapTypeColorLine[] {
  const groups = new Map<string, { typeName: string; color: string; origin: StrapLineOrigin; unit: string; rows: ConsumptionRow[] }>();
  for (const row of rows) {
    if (row.componentType !== 'Tiras') continue;
    const typeName = strapTypeName(row);
    const color = (row.color || '').trim() || '—';
    const origin = strapLineOrigin(row);
    const unit = row.productUnit || 'm';
    const key = [
      strapKeyPart(typeName),
      strapKeyPart(color),
      origin || 'pendente',
      isMeterUnit(unit) ? 'm' : strapKeyPart(unit),
    ].join('\u0000');
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { typeName, color, origin, unit, rows: [row] });
  }

  return Array.from(groups.values())
    .map((group) => {
      const fazer = group.origin === 'fazer';
      // Balde de estoque = SKU da tira pronta: as 4 linhas da ficha (TIRA 1..4)
      // apontam para o MESMO SKU — o estoque entra uma vez, não quatro.
      const items = aggregateItems(group.rows);
      let spend: number | null = null;
      if (!fazer) {
        for (const item of items) {
          const price = firstFinitePrice(item.rows);
          if (price == null) continue;
          spend = (spend ?? 0) + item.total * price;
        }
      }
      const warnings = Array.from(new Set(group.rows.flatMap((row) => [
        ...(row.warning ? row.warning.split(' · ') : []),
        ...(row.artisanal?.pending && row.artisanal.blockedReason ? [row.artisanal.blockedReason] : []),
      ].map((text) => text.trim()).filter(Boolean))));
      return {
        typeName: group.typeName,
        color: group.color,
        origin: group.origin,
        unit: group.unit,
        total: group.rows.reduce((sum, row) => sum + (Number(row.totalQuantity) || 0), 0),
        preview: group.rows.reduce((sum, row) => sum + Math.max(0, Number(row.previewQuantity) || 0), 0),
        available: items.reduce((sum, item) => sum + item.available, 0),
        known: items.every((item) => item.known),
        shortfall: fazer ? 0 : items.reduce((sum, item) => sum + itemShortfall(item), 0),
        toMake: fazer
          ? group.rows.reduce((sum, row) => sum + (row.strap ? row.strap.toMakeM : (Number(row.totalQuantity) || 0)), 0)
          : 0,
        spend,
        pending: group.rows.some((row) => !!row.artisanal?.pending || !rowKnown(row)),
        warnings,
        rows: group.rows,
      };
    })
    .sort((a, b) => a.typeName.localeCompare(b.typeName, 'pt-BR')
      || a.color.localeCompare(b.color, 'pt-BR')
      || STRAP_LINE_ORIGIN_TEXT(a.origin).localeCompare(STRAP_LINE_ORIGIN_TEXT(b.origin), 'pt-BR'));
}

/**
 * Napa por tipo × cor, indexada para casar com as linhas do §02.
 *
 * As duas agregações derivam o nome do tipo por caminhos diferentes — o §02 por
 * `normalizeBaseFamilyName` sobre `groupName`, o setor por `artisanalStrapTypeKey`
 * — então a chave é normalizada dos dois lados antes de casar. Medido no
 * PV-00195: as quatro chaves batem. Mas o casamento NÃO pode ser a única porta:
 * linha de tira sem row de corte (identidade canônica pendente) e row de corte
 * sem linha de tira precisam as duas aparecer, senão a absorção do antigo §03
 * perde material de vista.
 */
const napaKey = (typeName: string, color: string): string =>
  `${strapKeyPart(typeName)}\u0000${strapKeyPart(color)}`;

type NapaEntry = { napaM: number; blocked: boolean; blockedReason?: string; needsYield: boolean };

const buildNapaIndex = (cutRows: ArtisanalStrapCutRow[]): Map<string, NapaEntry> => {
  const index = new Map<string, NapaEntry>();
  for (const type of aggregateStrapNapaSector(cutRows).types) {
    const key = napaKey(type.typeName, type.color);
    const previous = index.get(key);
    index.set(key, {
      napaM: (previous?.napaM || 0) + type.napaM,
      blocked: (previous?.blocked || false) || type.blocked,
      blockedReason: type.blockedReason || previous?.blockedReason,
      needsYield: (previous?.needsYield || false) || type.needsYield,
    });
  }
  return index;
};

const napaCell = (entry: NapaEntry | undefined): string => {
  if (!entry || entry.blocked || !(entry.napaM > 0)) return '<span class="muted">—</span>';
  return `${formatNapaMeters(entry.napaM)} m`;
};

const situacaoCell = (entry: NapaEntry | undefined): string => {
  if (!entry) {
    return '<span class="flag warning">sem rendimento</span>';
  }
  if (entry.blocked) {
    return `<span class="flag warning">cadastro incompleto</span>${entry.blockedReason
      ? `<small class="row-warning">${escapeHtml(entry.blockedReason)}</small>` : ''}`;
  }
  return '<span class="flag ok">ok</span>';
};

/** Linha do bloco de prestador: vem da linha de tira do pedido ou da row de corte. */
type PrestadorRow = {
  typeName: string; color: string; unit: string;
  tiraM: number; preview: number; available: number; known: boolean;
  toMake: number; pending: boolean; warnings: string[]; napa?: NapaEntry;
};

/** Agrupa as linhas por TIPO preservando a ordem já ordenada. */
const groupByType = (lines: StrapTypeColorLine[]): { typeName: string; lines: StrapTypeColorLine[] }[] => {
  const out: { typeName: string; lines: StrapTypeColorLine[] }[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last && strapKeyPart(last.typeName) === strapKeyPart(line.typeName)) last.lines.push(line);
    else out.push({ typeName: line.typeName, lines: [line] });
  }
  return out;
};

const qtyCell = (line: StrapTypeColorLine): string => (line.preview > 0 && !(line.total > 0)
  ? `≈ ${formatQty(line.preview, line.unit)}<small class="qty-preview">prévia da ficha</small>`
  : formatQty(line.total, line.unit));

const warningsOf = (lines: StrapTypeColorLine[]): string => {
  const all = Array.from(new Set(lines.flatMap((line) => line.warnings)));
  return all.length ? `<div class="row-warning">▲ ${escapeHtml(all.join(' · '))}</div>` : '';
};

/**
 * ── §02 · TIRAS, partido por ORIGEM (12/10/2026) ───────────────────────────
 *
 * Decisão do dono, escolhendo entre cinco layouts: o tipo da tira é escrito UMA
 * vez e essa linha JÁ É o subtotal do tipo (metros e valor); as cores ficam
 * abaixo, como detalhe. E os dois destinos viram blocos separados, porque a
 * ação é outra em cada um:
 *
 *  - **Comprar pronto** fica com a coluna de dinheiro, que só ele preenche.
 *  - **Prestador** troca a coluna de dinheiro — que era "—" em TODA linha,
 *    porque `spend` é null por construção para tira de prestador — pela napa a
 *    enviar e pela situação do cadastro.
 *
 * Com isso o bloco do prestador passa a dizer tudo o que a seção "§03 Setor de
 * Tiras" dizia, e ela deixa de existir: as mesmas 12 tiras eram impressas duas
 * vezes, com o nome longo repetido 3× por família em cada uma.
 *
 * ⚠ A napa das tiras continua FORA de todo total de napa — herói, §01, chips de
 * família, "Necessidade total" e falta de napa seguem sem ela (decisão de
 * 11/10/2026). O que mudou é só ONDE ela é impressa.
 */
const renderStrapBlocks = (
  rows: ConsumptionRow[],
  cutRows: ArtisanalStrapCutRow[],
  totalMode: boolean,
): string[] => {
  const lines = aggregateStrapTypeColorLines(rows);
  const napaIndex = buildNapaIndex(cutRows);
  const buy = lines.filter((line) => line.origin !== 'fazer');
  const make = lines.filter((line) => line.origin === 'fazer');
  const blocks: string[] = [];

  // ── Comprar pronto ───────────────────────────────────────────────────────
  if (buy.length) {
    const body = groupByType(buy).map(({ typeName, lines: group }) => {
      const total = group.reduce((sum, line) => sum + line.total, 0);
      const spends = group.map((line) => line.spend).filter((value): value is number => value != null);
      const spend = spends.length ? spends.reduce((sum, value) => sum + value, 0) : null;
      const known = group.every((line) => line.known);
      const available = group.reduce((sum, line) => sum + line.available, 0);
      const short = totalMode ? 0 : group.reduce((sum, line) => sum + line.shortfall, 0);
      const unit = group[0]?.unit || 'm';
      const coverage = totalMode ? '' : `
        <td class="num">${known ? formatQty(available, unit) : '—'}</td>
        <td class="num${short > 0 ? ' shortage' : ''}">${known && short > 0 ? formatQty(short, unit) : '—'}</td>`;
      const head = `<tr class="strap-type${short > 0 ? ' is-short' : ''}${group.some((line) => line.pending) ? ' is-pending' : ''}">
        <td><strong>${escapeHtml(typeName)}</strong>${warningsOf(group)}</td>
        <td class="num strong">${formatQty(total, unit)} ${escapeHtml(formatUnit(unit))}</td>
        ${coverage}
        <td class="num cost-spend">${spend != null ? escapeHtml(formatMoney(spend)) : '<span class="no-price">sem preço</span>'}</td>
      </tr>`;
      const colors = group.map((line) => `<tr class="strap-color${line.pending ? ' is-pending' : ''}">
        <td>${escapeHtml(line.color)}</td>
        <td class="num">${qtyCell(line)}</td>
        ${totalMode ? '' : `<td class="num">${line.known ? formatQty(line.available, line.unit) : '—'}</td>
        <td class="num${line.shortfall > 0 ? ' shortage' : ''}">${line.known && line.shortfall > 0 ? formatQty(line.shortfall, line.unit) : '—'}</td>`}
        <td class="num cost-spend">${line.spend != null ? escapeHtml(formatMoney(line.spend)) : ''}</td>
      </tr>`).join('');
      return head + colors;
    }).join('');
    const grandTotal = buy.reduce((sum, line) => sum + line.total, 0);
    const grandSpendValues = buy.map((line) => line.spend).filter((value): value is number => value != null);
    const grandSpend = grandSpendValues.length ? grandSpendValues.reduce((sum, value) => sum + value, 0) : null;
    const head = totalMode
      ? '<tr><th style="width:56%">Tipo de tira / cor</th><th class="num" style="width:20%">Total<span class="unit-suffix"> (m)</span></th><th class="num col-spend" style="width:24%">A gastar</th></tr>'
      : '<tr><th style="width:40%">Tipo de tira / cor</th><th class="num" style="width:15%">Total<span class="unit-suffix"> (m)</span></th><th class="num" style="width:12%">Estoque</th><th class="num" style="width:12%">Falta</th><th class="num col-spend" style="width:21%">A gastar</th></tr>';
    blocks.push(`
      <div class="component-block">
        <div class="component-heading"><span>Tiras · comprar pronto</span><span>${groupByType(buy).length} tipo(s) · ${buy.length} linha(s)</span></div>
        <table class="report-table straps-table${totalMode ? ' total-mode' : ''}">
          <thead>${head}</thead>
          <tbody>${body}
            <tr class="strap-grand">
              <td>Total a comprar</td>
              <td class="num">${formatQty(grandTotal, 'm')} m</td>
              ${totalMode ? '' : '<td></td><td></td>'}
              <td class="num cost-spend">${grandSpend != null ? escapeHtml(formatMoney(grandSpend)) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>`);
  }

  // ── Prestador (absorve o antigo §03) ─────────────────────────────────────
  // As duas fontes entram na MESMA lista antes de agrupar: a linha de tira do
  // pedido (autoridade sobre o que foi vendido) e a row de corte (autoridade
  // sobre a napa). Row de corte sem linha de tira — identidade canônica que a
  // RPC devolveu mas o §02 não casou — entra assim mesmo: o antigo §03 a
  // mostrava, e sumir em silêncio seria perder napa de vista.
  const matched = new Set<string>();
  const prestadorRows: PrestadorRow[] = make.map((line) => {
    const key = napaKey(line.typeName, line.color);
    matched.add(key);
    return {
      typeName: line.typeName,
      color: line.color,
      unit: line.unit,
      tiraM: line.total,
      preview: line.preview,
      available: line.available,
      known: line.known,
      toMake: line.toMake,
      pending: line.pending,
      warnings: line.warnings,
      napa: napaIndex.get(key),
    };
  });
  for (const type of aggregateStrapNapaSector(cutRows).types) {
    const key = napaKey(type.typeName, type.color);
    if (matched.has(key)) continue;
    prestadorRows.push({
      typeName: type.typeName,
      color: type.color,
      unit: 'm',
      tiraM: type.strapM,
      preview: 0,
      available: 0,
      known: true,
      toMake: type.strapM,
      pending: false,
      warnings: [],
      napa: { napaM: type.napaM, blocked: type.blocked, blockedReason: type.blockedReason, needsYield: type.needsYield },
    });
  }

  if (prestadorRows.length) {
    const groups: { typeName: string; rows: PrestadorRow[] }[] = [];
    for (const row of prestadorRows) {
      const last = groups[groups.length - 1];
      if (last && strapKeyPart(last.typeName) === strapKeyPart(row.typeName)) last.rows.push(row);
      else groups.push({ typeName: row.typeName, rows: [row] });
    }
    const body = groups.map(({ typeName, rows: group }) => {
      const unit = group[0]?.unit || 'm';
      const typeEntry: NapaEntry = {
        napaM: group.reduce((sum, row) => sum + (row.napa?.napaM || 0), 0),
        blocked: group.some((row) => !row.napa || row.napa.blocked),
        blockedReason: group.find((row) => row.napa?.blockedReason)?.napa?.blockedReason,
        needsYield: group.some((row) => row.napa?.needsYield),
      };
      const total = group.reduce((sum, row) => sum + row.tiraM, 0);
      const toMake = group.reduce((sum, row) => sum + row.toMake, 0);
      const known = group.every((row) => row.known);
      const available = group.reduce((sum, row) => sum + row.available, 0);
      const warnings = Array.from(new Set(group.flatMap((row) => row.warnings)));
      const coverage = totalMode ? '' : `
        <td class="num">${known ? formatQty(available, unit) : '—'}</td>
        <td class="num muted">${toMake > 0 ? formatQty(toMake, unit) : 'coberta'}</td>`;
      const head = `<tr class="strap-type${group.some((row) => row.pending) ? ' is-pending' : ''}">
        <td><strong>${escapeHtml(typeName)}</strong>${warnings.length ? `<div class="row-warning">▲ ${escapeHtml(warnings.join(' · '))}</div>` : ''}</td>
        <td class="num strong">${formatQty(total, unit)} ${escapeHtml(formatUnit(unit))}</td>
        ${coverage}
        <td class="num">${napaCell(typeEntry.blocked ? undefined : typeEntry)}</td>
        <td>${situacaoCell(group.some((row) => !row.napa) ? undefined : typeEntry)}</td>
      </tr>`;
      const colors = group.map((row) => `<tr class="strap-color${row.pending ? ' is-pending' : ''}">
        <td>${escapeHtml(row.color)}</td>
        <td class="num">${row.preview > 0 && !(row.tiraM > 0)
          ? `≈ ${formatQty(row.preview, row.unit)}<small class="qty-preview">prévia da ficha</small>`
          : formatQty(row.tiraM, row.unit)}</td>
        ${totalMode ? '' : `<td class="num">${row.known ? formatQty(row.available, row.unit) : '—'}</td>
        <td class="num muted">${row.toMake > 0 ? formatQty(row.toMake, row.unit) : 'coberta'}</td>`}
        <td class="num">${napaCell(row.napa)}</td>
        <td></td>
      </tr>`).join('');
      return head + colors;
    }).join('');

    const napaTotal = prestadorRows.reduce((sum, row) => sum + (row.napa && !row.napa.blocked ? row.napa.napaM : 0), 0);
    const tiraTotal = prestadorRows.reduce((sum, row) => sum + row.tiraM, 0);
    const head = totalMode
      ? '<tr><th style="width:48%">Tipo de tira / cor</th><th class="num" style="width:17%">Tira<span class="unit-suffix"> (m)</span></th><th class="num" style="width:18%">Napa a enviar</th><th style="width:17%">Situação</th></tr>'
      : '<tr><th style="width:34%">Tipo de tira / cor</th><th class="num" style="width:13%">Tira<span class="unit-suffix"> (m)</span></th><th class="num" style="width:11%">Estoque</th><th class="num" style="width:11%">A fazer</th><th class="num" style="width:15%">Napa a enviar</th><th style="width:16%">Situação</th></tr>';
    blocks.push(`
      <div class="component-block">
        <div class="component-heading"><span>Tiras · prestador — a fábrica não corta tira</span><span>${groups.length} tipo(s) · ${prestadorRows.length} linha(s)</span></div>
        <table class="report-table straps-table${totalMode ? ' total-mode' : ''}">
          <thead>${head}</thead>
          <tbody>${body}
            <tr class="strap-grand">
              <td>Total a mandar pro prestador</td>
              <td class="num">${formatQty(tiraTotal, 'm')} m tira</td>
              ${totalMode ? '' : '<td></td><td></td>'}
              <td class="num">${napaTotal > 0 ? `${formatNapaMeters(napaTotal)} m napa` : '—'}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>`);
  }

  return blocks;
};

/**
 * Peso de cada coluna do §02. Como o bloco agora decide quais colunas existem
 * (Aplicação/Cor somem quando o bloco inteiro as deixa vazias), uma regra
 * `nth-child` fixa no CSS passaria a largura errada para a coluna errada. O
 * peso é normalizado sobre as colunas PRESENTES e sai inline no `<th>`, então
 * a soma fecha 100% em qualquer combinação e o `table-layout:fixed` não corta
 * número (regra de print 4 do CLAUDE.md).
 *
 * São PESOS relativos, não porcentagens: a largura final de cada coluna é
 * peso ÷ soma dos pesos presentes. No modo total com as 7 colunas a soma é 99,
 * então "A gastar" (18) fica com 18,18% — acima dos 8% que a regra de 2026-08
 * descartou por cortar o valor, e com folga para "R$ 3.420,00".
 */
const COLUMN_WEIGHT = {
  // Cor pesa 14 porque ela guarda o nome COMERCIAL da cor, não um código:
  // "CRISTAL C/ FUNDO BRANCO" e "ROSADO C/ FUNDO ROSADO" conviveram com
  // "CHAMPAGNE", que na cobertura (9 colunas, Cor a 10%) quebrava em
  // "CHAMPAGN"+"E" — regra de print 4: o que a tabela mostra tem de caber na
  // coluna. O peso saiu de Preço e A gastar, que sobravam.
  group: 18, app: 18, color: 14, need: 12, stock: 9, short: 9, unit: 6, price: 13, spend: 18,
} as const;

type ColumnKey = keyof typeof COLUMN_WEIGHT;

const columnWidths = (keys: ColumnKey[]): Record<string, string> => {
  const sum = keys.reduce((total, key) => total + COLUMN_WEIGHT[key], 0) || 1;
  return Object.fromEntries(keys.map((key) => [
    key,
    `width:${(COLUMN_WEIGHT[key] * 100 / sum).toFixed(2)}%`,
  ]));
};

/** Uma linha do §02 já desmontada em células, para o bloco decidir as colunas. */
type MaterialCells = {
  rowClass: string;
  group: string;
  application: string;
  /** Segunda linha da célula Aplicação (setor que consome), quando houver. */
  applicationNote: string;
  color: string;
  need: string;
  coverage: string;
  unit: string;
  cost: string;
  /** Sub-linha da grade do solado (ocupa a largura toda). */
  gradeHtml: string;
};

const renderMaterialSections = (
  rows: ConsumptionRow[],
  cutRows: ArtisanalStrapCutRow[],
  totalMode: boolean,
): string => {
  const sectionMap = new Map<string, MaterialCells[]>();
  const sectionOrder = new Map<string, number>();
  const append = (componentType: string, cells: MaterialCells, order: number) => {
    const current = sectionMap.get(componentType) || [];
    current.push(cells);
    sectionMap.set(componentType, current);
    sectionOrder.set(componentType, Math.min(sectionOrder.get(componentType) ?? order, order));
  };

  // Tira (Prestador, Comprar pronto, strass, prévia) vai inteira para o bloco
  // Tiras — dois blocos próprios por origem (`renderStrapBlocks`).
  const nonSole = aggregateItems(
    rows.filter((row) => row.componentType !== 'Solado' && row.componentType !== 'Tiras'),
  )
    .sort((a, b) => componentIndex(a.componentType) - componentIndex(b.componentType)
      || a.groupName.localeCompare(b.groupName, 'pt-BR')
      || a.color.localeCompare(b.color, 'pt-BR'));

  for (const item of nonSole) {
    const componentTypes = itemComponentTypes(item.rows);
    const sharedApplications = componentTypes.length > 1;
    const applications = sharedApplications
      ? componentTypes
      : Array.from(new Set(item.rows.map((row) => row.materialName).filter(Boolean)));
    const sectorApplications = item.rows
      .filter((row) => !!row.consumptionSector)
      .map((row) => `${row.consumptionSector}: ${formatQty(row.totalQuantity, row.productUnit)} ${formatUnit(row.productUnit)}`);
    const section = sharedApplications
      ? 'Aplicações compartilhadas'
      : componentTypes[0] || item.componentType;
    const short = totalMode ? 0 : itemShortfall(item);
    const previewQuantity = item.rows.reduce(
      (total, row) => total + Math.max(0, Number(row.previewQuantity) || 0),
      0,
    );
    const needHtml = previewQuantity > 0 && !(item.total > 0)
      ? `≈ ${formatQty(previewQuantity, item.productUnit)}<small class="qty-preview">prévia da ficha</small>`
      : formatQty(item.total, item.productUnit);
    const warnings = Array.from(new Set(item.rows.flatMap((row) => row.warning ? [row.warning] : [])));
    const unitPrice = firstFinitePrice(item.rows);
    const totalCost = unitPrice != null ? item.total * unitPrice : null;
    const coverage = totalMode ? '' : `
      <td class="num">${!item.known ? '—' : formatQty(item.available, item.productUnit)}</td>
      <td class="num${short > 0 ? ' shortage' : ''}">${item.known && short > 0
        ? formatQty(short, item.productUnit)
        : '—'}</td>`;
    append(section, {
      rowClass: `material-row${short > 0 ? ' is-short' : ''}${!item.known ? ' is-pending' : ''}`,
      group: `<strong>${escapeHtml(item.groupName)}</strong>${warnings.length ? `<div class="row-warning">▲ ${escapeHtml(warnings.join(' · '))}</div>` : ''}`,
      application: escapeHtml(consumptionApplicationText(applications, item.groupName)),
      applicationNote: sectorApplications.length ? escapeHtml(sectorApplications.join(' · ')) : '',
      color: escapeHtml(item.color || ''),
      need: needHtml,
      coverage,
      unit: escapeHtml(formatUnit(item.productUnit)),
      cost: costCellsHtml(unitPrice, totalCost, item.productUnit),
      gradeHtml: '',
    }, componentIndex(componentTypes[0] || item.componentType));
  }

  const soles = rows.filter((row) => row.componentType === 'Solado')
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
  for (const row of soles) {
    const short = totalMode ? 0 : rowShortfall(row);
    const known = rowKnown(row);
    const usefulStock = reportRowAvailable(row);
    const shortSizes = soleShortSizes(row);
    const unitPrice = row.unitPrice != null && Number.isFinite(row.unitPrice) ? row.unitPrice : null;
    const totalCost = rowTotalCost(row);
    const coverage = totalMode ? '' : `
      <td class="num">${known ? formatQty(usefulStock, row.productUnit) : '—'}</td>
      <td class="num${short > 0 ? ' shortage' : ''}">${known && short > 0 ? `${formatQty(short, row.productUnit)}${shortSizes.length ? `<small>${shortSizes.length} nº</small>` : ''}` : '—'}</td>`;
    append('Solado', {
      rowClass: `material-row${short > 0 ? ' is-short' : ''}${!known ? ' is-pending' : ''}`,
      group: `<strong>${escapeHtml(row.groupName)}</strong>${row.warning ? `<div class="row-warning">▲ ${escapeHtml(row.warning)}</div>` : ''}`,
      application: escapeHtml(consumptionApplicationText([row.materialName || 'Solado'], row.groupName)),
      applicationNote: '',
      color: escapeHtml(row.color || ''),
      need: formatQty(row.totalQuantity, row.productUnit),
      coverage,
      unit: escapeHtml(formatUnit(row.productUnit)),
      cost: costCellsHtml(unitPrice, totalCost, row.productUnit),
      gradeHtml: renderSoleGrade(row, totalMode),
    }, componentIndex('Solado'));
  }

  const blocks = Array.from(sectionMap.entries()).map(([componentType, cells]) => {
    // Coluna só existe se ALGUMA linha do bloco a preenche. Em "Embalagem",
    // "Item padrão (solado)" e "Componente Direto" a Cor é "—" em todas as
    // linhas, e nas colas a Aplicação só repetia o Grupo: eram duas colunas de
    // papel em branco por bloco (medido 12/10/2026).
    const showApplication = cells.some((cell) => cell.application || cell.applicationNote);
    const showColor = cells.some((cell) => cell.color);
    const keys: ColumnKey[] = [
      'group',
      ...(showApplication ? ['app' as const] : []),
      ...(showColor ? ['color' as const] : []),
      'need',
      ...(totalMode ? [] : ['stock' as const, 'short' as const]),
      'unit', 'price', 'spend',
    ];
    const colCount = keys.length;
    const w = columnWidths(keys);
    const head = `<tr><th class="c-group" style="${w.group}">Grupo</th>${showApplication ? `<th class="c-app" style="${w.app}">Aplicação</th>` : ''}${showColor ? `<th class="c-color" style="${w.color}">Cor</th>` : ''}<th class="num c-need" style="${w.need}">Necessidade</th>${totalMode ? '' : `<th class="num c-stock" style="${w.stock}">Estoque</th><th class="num c-short" style="${w.short}">Falta</th>`}<th class="c-unit" style="${w.unit}">Un.</th><th class="num col-unit c-price" style="${w.price}">Preço/un. consumo</th><th class="num col-spend c-spend" style="${w.spend}">A gastar</th></tr>`;
    const body = cells.map((cell) => `<tr class="${cell.rowClass}">
      <td>${cell.group}</td>
      ${showApplication ? `<td>${cell.application}${cell.applicationNote ? `<small>${cell.applicationNote}</small>` : ''}</td>` : ''}
      ${showColor ? `<td>${cell.color || '—'}</td>` : ''}
      <td class="num strong">${cell.need}</td>
      ${cell.coverage}
      <td class="unit">${cell.unit}</td>
      ${cell.cost}
    </tr>${cell.gradeHtml ? `
    <tr class="grade-row"><td colspan="${colCount}">${cell.gradeHtml}</td></tr>` : ''}`).join('');
    return {
      order: sectionOrder.get(componentType) ?? componentIndex(componentType),
      html: `
      <div class="component-block">
        <div class="component-heading"><span>${escapeHtml(componentType)}</span><span>${cells.length} linha(s)</span></div>
        <table class="report-table materials-table${totalMode ? ' total-mode' : ''} cols-${colCount}">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>`,
    };
  });
  for (const html of renderStrapBlocks(rows, cutRows, totalMode)) {
    blocks.push({ order: componentIndex('Tiras'), html });
  }

  return blocks
    .sort((a, b) => a.order - b.order)
    .map((block) => block.html)
    .join('');
};

const baseNameAlreadyInType = (typeName: string, baseName?: string): boolean => {
  const base = (baseName || '').trim();
  if (!base) return true;
  return typeName.toLocaleLowerCase('pt-BR').includes(base.toLocaleLowerCase('pt-BR'));
};

export function buildMaterialConsumptionReportHtml({
  rows,
  artisanalStrapRows,
  title,
  orderHeaders,
  generatedAt = new Date(),
  mode = 'coverage',
  partitionMode = 'none',
}: MaterialConsumptionReportInput): string {
  const totalMode = mode === 'total';
  // O bloco de prestador é impresso quando há row de corte OU linha de tira
  // Fazer no pedido — sem ele, nenhum texto pode apontar para o bloco (ver
  // STRAP_SECTOR_NOTE). Só `artisanalStrapRows` não basta: tira Fazer sem
  // identidade canônica ainda produz linha no bloco, com napa "—".
  const hasStrapSector = artisanalStrapRows.length > 0
    || rows.some((row) => row.componentType === 'Tiras' && isFazerStrapRow(row));
  const baseTotal = computeBaseMaterialTotal(rows);
  const shortCount = countShort(rows);
  const pendingCount = countPending(rows);
  const majorShortfalls = topShortfalls(rows, 5);
  const totalsByUnit = unitTotals(rows);
  const pendingTiraM = pendingStrapMeters(rows);
  const spendTotal = computeMaterialsSpendTotal(rows);
  const partitioned = partitionMode === 'order_reference'
    ? buildOrderReferencePartitions(rows)
    : [];

  const totalStrip = Array.from(totalsByUnit.entries()).filter(([, total]) => total > 0).map(([unit, total]) => `
    <span><strong>${formatQty(total, unit)}</strong> ${escapeHtml(formatUnit(unit))}</span>
  `).join('');
  const pendingStrip = pendingTiraM > 0
    ? `<div class="pending-strip"><span class="flag warning">Tira com cadastro pendente</span><strong>${formatQty(pendingTiraM, 'm')} m de tira</strong><small>napa “—” no Setor de Tiras até cadastrar o rendimento — corrija no Hub de Tiras / regrave o PV</small></div>`
    : '';
  const shortfallList = majorShortfalls.length ? `<ol class="shortfall-list">${majorShortfalls.map((shortfall) => `
    <li><span>${escapeHtml(shortfall.label)}${shortfall.color && shortfall.color !== '—' ? ` · ${escapeHtml(shortfall.color)}` : ''}</span><strong>${formatQty(shortfall.qty, shortfall.unit)} ${escapeHtml(formatUnit(shortfall.unit))}</strong></li>
  `).join('')}</ol>` : '<p class="all-covered">Estoque cobre todos os itens conhecidos.</p>';
  const generatedLabel = generatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const modeBanner = totalMode
    ? '<p class="mode-banner">Consumo total · estoque ignorado · necessidade bruta do pedido</p>'
    : '';
  const partitionBanner = partitionMode === 'order_reference'
    ? '<p class="mode-banner" style="margin-top:4px;background:transparent;color:var(--ink);border-color:var(--ink)">Visão estendida · por PV e modelo</p>'
    : '';
  // Decisão do dono (11/10/2026): napa das tiras fora de todo total. O LUGAR
  // onde ela é impressa mudou em 12/10/2026 (§03 absorvido pelo bloco de
  // prestador); ficar fora dos totais, não.
  const napaOrigin = `Necessidade de napa (§01) soma cabedal (+ fachete) e forração${hasStrapSector ? `; a napa das tiras está ${BLOCO_TIRAS}` : ''}.`;
  const strapsIn02 = 'Tiras em §02: total em metros por tipo e cor, separando Prestador de Comprar pronto.';
  /**
   * Só a COBERTURA imprime a caixa "Leitura correta", e ali ela divide a faixa
   * com "Maiores faltas" (não custa altura) e abre com a única frase que não
   * está em outro lugar: a diferença entre "Necessidade" e "Falta".
   *
   * No modo total a caixa era repetição pura, full-width: "ignora o estoque"
   * já está na tarja do cabeçalho (CONSUMO TOTAL · ESTOQUE IGNORADO ·
   * NECESSIDADE BRUTA DO PEDIDO), e as outras duas frases são as notas do §01
   * e do §02 ao lado dos próprios títulos. Eram ~60px de papel dizendo pela
   * terceira vez o que já estava escrito duas — ordem de ataque 1 das
   * Preferências de impressão (repetição antes de espaço vazio).
   */
  const reading = `“Necessidade” é consumo bruto. “Falta” já desconta o estoque líquido. ${napaOrigin} ${strapsIn02}`;
  const manifest = totalMode
    ? `<div class="manifest manifest-total" aria-label="Resumo do consumo total">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>cabedal + forração${hasStrapSector ? ' · napa das tiras no bloco de prestador' : ''}</small></div>
    <div><dl><dt>Total a gastar</dt><dd class="spend">${spendTotal != null ? escapeHtml(formatMoney(spendTotal)) : '—'}</dd></dl><small>necessidade × preço cadastrado</small></div>
    <div><dl><dt>Pendências</dt><dd>${pendingCount}</dd></dl><small>cadastro a revisar</small></div>
    <div><dl><dt>Escopo calculado</dt><dd>${rows.length} linha${rows.length === 1 ? '' : 's'}</dd></dl><small>ficha técnica + grade + variante do PV</small></div>
  </div>`
    : `<div class="manifest" aria-label="Resumo da decisão">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>cabedal + forração${hasStrapSector ? ' · napa das tiras no bloco de prestador' : ''}</small></div>
    <div><dl><dt>Itens em falta</dt><dd class="shortage">${shortCount}</dd></dl><small>estoque líquido</small></div>
    <div><dl><dt>Total a gastar</dt><dd class="spend">${spendTotal != null ? escapeHtml(formatMoney(spendTotal)) : '—'}</dd></dl><small>necessidade × preço</small></div>
    <div><dl><dt>Pendências</dt><dd>${pendingCount}</dd></dl><small>cadastro a revisar</small></div>
  </div>`;

  const materialsBody = partitioned.length > 0
    ? partitioned.map((order) => `
      <div class="partition-order" style="margin-top:12px;border:1px solid var(--ink);padding:8px;break-inside:avoid">
        <p class="section-kicker">Pedido</p>
        <h2 style="font-family:'Anton',Impact,sans-serif;font-size:16pt;line-height:1;margin:2px 0 8px;text-transform:uppercase">${escapeHtml(order.orderNumber)}</h2>
        ${order.models.map((model) => `
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--line)">
            <p class="section-kicker">Modelo</p>
            <h3 style="font-size:11pt;margin:2px 0 6px;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(model.referenceLabel)}</h3>
            ${renderMaterialSections(model.rows, artisanalStrapRows, totalMode)}
          </div>
        `).join('')}
      </div>`).join('')
    : renderMaterialSections(rows, artisanalStrapRows, totalMode);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_LINK}" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 10mm 8mm 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    :root { --ink:#11100f; --paper:#fbfaf7; --muted:#726d66; --line:#cbc6bd; --soft:#efede8; --spend:#f0ebe3; --accent:#d9264e; --warn:#a45b0b; --ok:#176c42; }
    html, body { margin:0; padding:0; color:var(--ink); background:white; }
    body { font: 9.2pt/1.32 'Fira Sans', Arial, sans-serif; }
    h1, h2, p { margin:0; }
    .mono, .num, .unit, .section-number, .manifest dd, .napa-family-qty { font-family:'Fira Code', ui-monospace, monospace; font-variant-numeric:tabular-nums; }
    .masthead { border-top:4px solid var(--ink); border-bottom:1px solid var(--ink); padding:7px 0 8px; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
    .brandline, .section-kicker, .manifest dt, .scope-label, .mode-banner { font-size:7.2pt; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); }
    h1 { margin-top:3px; font-family:'Anton','Arial Narrow',Impact,sans-serif; font-size:24pt; line-height:.94; font-weight:400; text-transform:uppercase; letter-spacing:.01em; }
    .doc-meta { text-align:right; color:var(--muted); font-size:7.8pt; white-space:nowrap; }
    .doc-meta strong { display:block; color:var(--ink); font-family:'Fira Code',monospace; font-size:8.5pt; }
    .mode-banner { margin:6px 0 0; padding:4px 8px; border:1px solid var(--ink); background:var(--ink); color:white; letter-spacing:.16em; }
    .manifest { display:grid; grid-template-columns:1.35fr .75fr 1.2fr .9fr; border-bottom:2px solid var(--ink); background:var(--paper); }
    .manifest-total { grid-template-columns:1.35fr 1.35fr .7fr 1fr; }
    .manifest > div { min-height:53px; padding:8px 9px; border-right:1px solid var(--line); }
    .manifest > div:last-child { border-right:0; }
    .manifest dl { margin:0; }
    .manifest dt { margin-bottom:3px; }
    .manifest dd { margin:0; font-size:15pt; font-weight:700; line-height:1; }
    .manifest dd.shortage { color:var(--accent); }
    .manifest dd.spend { color:var(--ink); font-size:13.5pt; letter-spacing:-.01em; }
    .manifest small { display:block; margin-top:4px; color:var(--muted); font-size:7.4pt; }
    .scope { display:flex; gap:12px; align-items:flex-start; margin-top:7px; padding:6px 8px; border:1px solid var(--line); background:var(--paper); }
    .scope-label { flex:0 0 auto; }
    .scope-list { display:flex; flex-wrap:wrap; gap:3px 14px; }
    .totals-strip { display:flex; flex-wrap:wrap; gap:4px 14px; margin:8px 0 3px; padding:5px 0; border-bottom:1px solid var(--line); color:var(--muted); font-size:8pt; }
    .totals-strip strong { color:var(--ink); font-family:'Fira Code',monospace; }
    .pending-strip { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 10px; margin:0 0 6px; padding:5px 7px; border:1px solid #e0b35a; background:#fff8e9; font-size:7.6pt; }
    .pending-strip strong { font-family:'Fira Code',monospace; color:var(--warn); }
    .pending-strip small { color:var(--muted); }
    .report-section { margin-top:11px; }
    .section-heading { display:grid; grid-template-columns:27px 1fr minmax(140px, 38%); align-items:end; gap:8px; margin-bottom:6px; padding-top:6px; border-top:2px solid var(--ink); }
    .section-number { color:var(--accent); font-size:12pt; font-weight:700; }
    .section-heading h2 { font-family:'Anton','Arial Narrow',Impact,sans-serif; font-size:15pt; line-height:1; font-weight:400; text-transform:uppercase; }
    .section-note { color:var(--muted); font-size:7.2pt; text-align:right; line-height:1.35; }
    .napa-family { margin-top:8px; border:1px solid var(--ink); break-inside:avoid; }
    .napa-family-head { display:flex; align-items:baseline; gap:10px; padding:6px 8px; background:var(--ink); color:white; }
    .napa-family-name { font-family:'Anton','Arial Narrow',Impact,sans-serif; font-size:13pt; line-height:1; letter-spacing:.02em; text-transform:uppercase; }
    .napa-family-meta { margin-left:auto; color:#ccc8c1; font-size:7.2pt; letter-spacing:.08em; text-transform:uppercase; }
    .napa-family-qty { font-size:13pt; font-weight:700; }
    .napa-table th:nth-child(1) { width:22%; }
    .napa-table .app-qty small { display:block; color:var(--muted); font-size:6.4pt; font-weight:500; }
    .report-table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .report-table thead { display:table-header-group; }
    .report-table th { padding:5px 4px; border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); background:var(--soft); color:var(--muted); font-size:6.5pt; font-weight:700; letter-spacing:.04em; text-align:left; text-transform:uppercase; }
    .report-table th.num { letter-spacing:.02em; }
    /* 4px, não 5: a entrelinha de 9.2pt/1.32 já separa as linhas, e 1px a
       menos em cada lado da célula devolve ~90px num documento de 45 linhas —
       três linhas e meia de papel, sem tocar em corpo de letra (Preferências
       de impressão: densidade vem de tirar espaço, nunca de reduzir fonte). */
    .report-table td { padding:4px 5px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
    .report-table .num { text-align:right; white-space:nowrap; overflow:visible; }
    .report-table .unit { width:34px; text-align:center; color:var(--muted); }
    .report-table .strong { font-weight:700; }
    .cost-unit { color:var(--muted); font-weight:500; font-size:8.4pt; }
    .cost-spend { font-weight:700; font-size:9.4pt; background:var(--spend); }
    .report-table th.col-spend { background:var(--spend); color:var(--ink); }
    .strap-subtotal td { background:var(--soft); border-top:1.5px solid var(--ink); border-bottom:2px solid var(--ink); font-weight:700; padding-top:6px; padding-bottom:6px; }
    .strap-subtotal .cost-unit { font-weight:500; }
    .strap-subtotal .muted { font-weight:500; }
    .flag { display:inline-block; max-width:100%; border:1px solid currentColor; padding:1px 5px; border-radius:99px; font-size:6.7pt; font-weight:700; line-height:1.25; }
    .flag.warning { color:var(--warn); background:#fff8e9; }
    .flag.ok { color:var(--ok); background:#edf8f1; }
    .muted { color:var(--muted); }
    .is-pending { background:#fffaf0; }
    .material-row.is-short td:first-child { border-left:3px solid var(--accent); }
    .shortage { color:var(--accent); font-weight:700; }
    .shortage small { display:block; color:var(--muted); font-size:6.5pt; font-weight:500; }
    /* <small> em célula é SEMPRE segunda linha. Sem isto ele herda o inline do
       HTML e cola no texto anterior — "Elástico 6MM" + "Aviamento: 62,40 m"
       saía "Elástico 6MMAviamento: 62,40 m" no papel (medido 12/10/2026). */
    .report-table td small { display:block; margin-top:1px; color:var(--muted); font-size:6.5pt; font-weight:500; line-height:1.25; }
    .row-warning { margin-top:2px; color:var(--warn); font-size:6.7pt; line-height:1.25; }
    .qty-preview { display:block; margin-top:1px; color:var(--muted); font-family:'Fira Sans',sans-serif; font-size:6.5pt; font-weight:500; }
    .component-block { margin-top:9px; border:1px solid var(--line); break-inside:auto; overflow:hidden; }
    /* break-after:avoid mantém o cabeçalho colado na tabela. Sem ele o
       browser quebra entre os dois quando o thead + a 1ª linha não cabem, e
       sobra uma caixa vazia no pé da folha (medido no bloco Tiras). */
    .component-heading { display:flex; justify-content:space-between; gap:10px; padding:4px 7px; border-left:4px solid var(--accent); background:var(--ink); color:white; font-size:7.6pt; font-weight:700; letter-spacing:.09em; text-transform:uppercase; break-after:avoid; }
    .component-heading span:last-child { color:#ccc8c1; font-family:'Fira Code',monospace; font-size:6.8pt; }
    /* O thead é uppercase; sem isto "Total (m)" sairia "TOTAL (M)" — M é mega. */
    .report-table th .unit-suffix { text-transform:none; }
    /* Materiais · larguras: saem INLINE no th (ver COLUMN_WEIGHT). Aplicação e
       Cor somem no bloco que as deixa vazias, então a posição nth-child de
       "A gastar" muda de bloco para bloco — a regra antiga, presa ao índice,
       passaria a largura de Preço para Un. no bloco sem Cor. Aqui ficam só o
       alinhamento e o realce, que não dependem da posição. */
    .materials-table th.c-unit { text-align:center; }
    .materials-table th.c-spend { text-align:right; }
    .materials-table td.cost-spend { padding-right:7px; }
    /* Tiras, partido por origem (12/10/2026): a linha do TIPO já é o subtotal
       (metros e valor), e as cores ficam abaixo como detalhe. As larguras saem
       INLINE no th: a mesma classe .straps-table serve a tabelas de 3 a 6
       colunas (comprar/prestador × total/cobertura), então nth-child apontaria
       para a coluna errada. Estoque, Falta e A fazer nunca descem de 11%: é o
       piso MEDIDO para caber número de 4–5 dígitos (a 8% o valor invadia a
       coluna vizinha — regra de print 4). */
    .straps-table td:first-child strong { text-transform:uppercase; }
    .strap-type td { background:var(--soft); border-top:1.5px solid var(--ink); font-weight:700; padding-top:5px; padding-bottom:5px; }
    .strap-type td:first-child { text-transform:uppercase; }
    .strap-color td:first-child { padding-left:18px; color:var(--muted); }
    .strap-color td { border-bottom:1px solid var(--line); }
    .strap-grand td { border-top:1.5px solid var(--ink); border-bottom:3px double var(--ink); background:#fff; font-weight:700; padding-top:6px; padding-bottom:6px; }
    .no-price { color:var(--muted); font-weight:500; font-size:7pt; }
    .straps-table td.cost-spend { padding-right:7px; }
    /* Setor de Tiras — 5 cols: Tipo · Cor · Tira necessária · Napa · Situação.
       Sem largura declarada o 'table-layout:fixed' de '.report-table' dividia em
       20% iguais: "MEIA CANA 10 mm · NAPA SOFT" não cabia em 146px e TODA linha
       quebrava em duas, enquanto sobrava um vão morto no meio da tabela. Eram
       12 linhas de altura dupla — uma página inteira de papel (medido
       12/10/2026: o documento fechava em 3 páginas, a 3ª com 7 linhas). */
    .strap-section .report-table th:nth-child(1) { width:36%; }
    .strap-section .report-table th:nth-child(2) { width:18%; }
    .strap-section .report-table th:nth-child(3) { width:14%; }
    .strap-section .report-table th:nth-child(4) { width:13%; }
    .strap-section .report-table th:nth-child(5) { width:19%; }
    .strap-section .report-table td:first-child strong { text-transform:uppercase; }
    .grade-row td { padding:0 5px 6px 5px; border-bottom:1px solid var(--ink); background:white; }
    .sole-grade { padding:4px 0 0 12px; overflow:visible; }
    /* table-layout:fixed = numerações com a MESMA largura. Com 'auto' o
       Chromium distribuía a sobra por conteúdo e a última coluna ficava com
       ~20px contra ~90px da primeira: a grade 34–40 saía com 39/40 espremidos
       no canto (medido 12/10/2026). Regra de print 4 — a grade manda.
       'overflow:visible' fica: se algum dia a coluna apertar, o número
       transborda em vez de ser CORTADO em silêncio. */
    .sole-grade table { width:100%; border-collapse:collapse; font-size:7.2pt; table-layout:fixed; }
    .sole-grade th, .sole-grade td { padding:2px 4px; border:1px solid var(--line); text-align:center; white-space:nowrap; overflow:visible; }
    .sole-grade th:first-child { width:72px; min-width:72px; text-align:left; background:var(--soft); white-space:nowrap; }
    .grade-num { font-family:'Fira Code',monospace; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .decision-grid { display:grid; grid-template-columns:1fr 1.35fr; gap:10px; margin-top:8px; }
    .decision-box { border:1px solid var(--ink); padding:7px 8px; break-inside:avoid; }
    .decision-box h3 { margin:0 0 4px; font-size:7.4pt; letter-spacing:.12em; text-transform:uppercase; }
    .shortfall-list { margin:0; padding:0; list-style:none; }
    .shortfall-list li { display:flex; justify-content:space-between; gap:8px; padding:2px 0; border-top:1px dotted var(--line); }
    .shortfall-list strong { color:var(--accent); font-family:'Fira Code',monospace; white-space:nowrap; }
    .all-covered { color:var(--ok); font-weight:700; }
    .footer-note { margin-top:10px; padding-top:5px; border-top:1px solid var(--ink); color:var(--muted); font-size:6.8pt; }
    tr, .decision-box, .napa-family { break-inside:avoid; }
    @media print { a { color:inherit; text-decoration:none; } }
  </style>
</head>
<body>
  <header class="masthead">
    <div><p class="brandline">Squad Shoes · suprimentos industriais</p><h1>${escapeHtml(title)}</h1>${modeBanner}${partitionBanner}</div>
    <p class="doc-meta">Documento operacional<strong>${escapeHtml(generatedLabel)}</strong></p>
  </header>

  ${manifest}
  ${renderScope(orderHeaders)}
  <div class="totals-strip"><strong>Necessidade total</strong>${totalStrip}</div>
  ${pendingStrip}
  ${totalMode ? '' : `<div class="decision-grid">
    <div class="decision-box"><h3>Leitura correta</h3><p>${reading}</p></div>
    <div class="decision-box"><h3>Maiores faltas</h3>${shortfallList}</div>
  </div>`}
  ${partitioned.length > 0 ? '' : renderBaseNeed(rows, totalMode, hasStrapSector)}
  <section class="report-section">
    <div class="section-heading">
      <span class="section-number">02</span>
      <div><p class="section-kicker">Conferência completa</p><h2>${partitioned.length > 0 ? 'Materiais por PV e modelo' : 'Materiais por aplicação'}</h2></div>
      <p class="section-note">${totalMode
        ? `Somente a necessidade do pedido. Tiras: separadas por origem, com subtotal por tipo${hasStrapSector ? '; a napa delas está no bloco de prestador' : ''}. Tira com cadastro pendente fica com ▲.`
        : `A falta de solado é calculada por numeração; os demais itens usam o balde grupo + cor + unidade. Tiras: separadas por origem, com subtotal por tipo${hasStrapSector ? '; napa delas no bloco de prestador' : ''}. Tira pendente fica com ▲.`}</p>
    </div>
    ${materialsBody}
  </section>
  <p class="footer-note">${totalMode
    ? 'Fonte: pedido de venda, ficha técnica vigente, variante de material e grade. Estoque líquido foi ignorado neste documento. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'
    : 'Fonte: pedido de venda, ficha técnica vigente, variante de material, grade e estoque líquido no momento da geração. Este relatório é uma simulação atual e pode diferir do snapshot histórico já congelado em uma OP. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'}</p>
</body>
</html>`;
}
