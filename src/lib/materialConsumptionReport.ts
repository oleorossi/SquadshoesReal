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
import { formatQty, formatUnit, formatPricePerUnit } from '@/lib/consumptionFormat';
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

/**
 * O §03 "Setor de Tiras" só existe quando há tira de Prestador no escopo. Num
 * PV só de strass (ou sem tira) o documento não pode mandar o leitor para uma
 * seção que não foi impressa.
 */
const STRAP_SECTOR_NOTE = (hasStrapSector: boolean): string =>
  (hasStrapSector ? ' A napa das tiras está só no §03 Setor de Tiras.' : '');

/**
 * §01 — napa cortada DIRETO do rolo, por família → cor. Total da cor =
 * Cabedal + Forração (as duas colunas fecham com ele). Decisão do dono
 * (11/10/2026): a napa das tiras — convertida ou com rendimento pendente — não
 * entra aqui; mora só no §03 "Setor de Tiras", que também mostra o "cadastro
 * incompleto". A coluna "Situação" (contagem de tira pendente por cor) saiu
 * junto: sem tira no §01 ela seria só espaço morto.
 */
const renderBaseNeed = (rows: ConsumptionRow[], totalMode: boolean, hasStrapSector: boolean): string => {
  const { families } = buildBuyList(rows);
  if (!families.length) return '';

  const familyBlocks = families.map((family) => `
    <article class="napa-family">
      <header class="napa-family-head">
        <span class="napa-family-name">${escapeHtml(family.napa)}</span>
        <span class="napa-family-meta">${family.colors.length} cor${family.colors.length === 1 ? '' : 'es'}</span>
        <span class="napa-family-qty">${formatQty(family.total, 'm')} m</span>
      </header>
      <table class="report-table napa-table">
        <thead><tr>
          <th>Cor</th>
          <th class="num">Cabedal</th>
          <th class="num">Forração</th>
          <th class="num">Total</th>
        </tr></thead>
        <tbody>${family.colors.map((color) => `
          <tr>
            <td>${escapeHtml(color.color || '—')}</td>
            <td class="num app-qty">${mCell(color.cabedal)}</td>
            <td class="num app-qty">${mCell(color.forracao)}</td>
            <td class="num strong">${formatQty(color.qty, 'm')} m</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </article>`).join('');

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
// das tiras mora só no §03 Setor de Tiras). Todas as linhas da ficha
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

const renderStrapBlock = (rows: ConsumptionRow[], totalMode: boolean): string => {
  const lines = aggregateStrapTypeColorLines(rows);
  if (!lines.length) return '';
  const body = lines.map((line) => {
    const unitSuffix = isMeterUnit(line.unit) ? '' : ` ${escapeHtml(formatUnit(line.unit))}`;
    const totalHtml = line.preview > 0 && !(line.total > 0)
      ? `≈ ${formatQty(line.preview, line.unit)}${unitSuffix}<small class="qty-preview">prévia da ficha</small>`
      : `${formatQty(line.total, line.unit)}${unitSuffix}`;
    const short = totalMode ? 0 : line.shortfall;
    const coverageCells = totalMode ? '' : `
      <td class="num">${line.known ? formatQty(line.available, line.unit) : '—'}</td>
      ${line.origin === 'fazer'
        ? `<td class="num muted">${line.toMake > 0
          ? `${formatQty(line.toMake, line.unit)}<small class="qty-preview">prestador</small>`
          : 'coberta'}</td>`
        : `<td class="num${short > 0 ? ' shortage' : ''}">${line.known && short > 0 ? formatQty(short, line.unit) : '—'}</td>`}`;
    return `<tr class="material-row strap-row${short > 0 ? ' is-short' : ''}${line.pending ? ' is-pending' : ''}">
      <td><strong>${escapeHtml(line.typeName)}</strong>${line.warnings.length ? `<div class="row-warning">▲ ${escapeHtml(line.warnings.join(' · '))}</div>` : ''}</td>
      <td>${escapeHtml(line.color)}</td>
      <td>${escapeHtml(STRAP_LINE_ORIGIN_TEXT(line.origin))}</td>
      <td class="num strong">${totalHtml}</td>
      ${coverageCells}
      <td class="num cost-spend">${line.spend != null ? escapeHtml(formatMoney(line.spend)) : '—'}</td>
    </tr>`;
  }).join('');
  const head = totalMode
    ? '<tr><th>Tipo de tira</th><th>Cor</th><th>Origem</th><th class="num">Total<span class="unit-suffix"> (m)</span></th><th class="num col-spend">A gastar</th></tr>'
    : '<tr><th>Tipo de tira</th><th>Cor</th><th>Origem</th><th class="num">Total<span class="unit-suffix"> (m)</span></th><th class="num">Estoque</th><th class="num">Falta</th><th class="num col-spend">A gastar</th></tr>';
  return `
      <div class="component-block">
        <div class="component-heading"><span>Tiras</span><span>${lines.length} linha(s)</span></div>
        <table class="report-table straps-table${totalMode ? ' total-mode' : ''}">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
};

const renderMaterialSections = (rows: ConsumptionRow[], totalMode: boolean): string => {
  const sectionMap = new Map<string, string[]>();
  const sectionOrder = new Map<string, number>();
  const append = (componentType: string, html: string, order: number) => {
    const current = sectionMap.get(componentType) || [];
    current.push(html);
    sectionMap.set(componentType, current);
    sectionOrder.set(componentType, Math.min(sectionOrder.get(componentType) ?? order, order));
  };
  const colCount = totalMode ? 7 : 9;

  // Tira (Prestador, Comprar pronto, strass, prévia) vai inteira para o bloco
  // Tiras — tabela própria, total por tipo × cor (`renderStrapBlock`).
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
    const coverageCells = totalMode ? '' : `
      <td class="num">${!item.known ? '—' : formatQty(item.available, item.productUnit)}</td>
      <td class="num${short > 0 ? ' shortage' : ''}">${item.known && short > 0
        ? formatQty(short, item.productUnit)
        : '—'}</td>`;
    append(section, `<tr class="material-row${short > 0 ? ' is-short' : ''}${!item.known ? ' is-pending' : ''}">
      <td><strong>${escapeHtml(item.groupName)}</strong>${warnings.length ? `<div class="row-warning">▲ ${escapeHtml(warnings.join(' · '))}</div>` : ''}</td>
      <td>${escapeHtml(applications.join(' + ') || item.groupName)}${sectorApplications.length ? `<small>${escapeHtml(sectorApplications.join(' · '))}</small>` : ''}</td>
      <td>${escapeHtml(item.color || '—')}</td>
      <td class="num strong">${needHtml}</td>
      ${coverageCells}
      <td class="unit">${escapeHtml(formatUnit(item.productUnit))}</td>
      ${costCellsHtml(unitPrice, totalCost, item.productUnit)}
    </tr>`, componentIndex(componentTypes[0] || item.componentType));
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
    const coverageCells = totalMode ? '' : `
      <td class="num">${known ? formatQty(usefulStock, row.productUnit) : '—'}</td>
      <td class="num${short > 0 ? ' shortage' : ''}">${known && short > 0 ? `${formatQty(short, row.productUnit)}${shortSizes.length ? `<small>${shortSizes.length} nº</small>` : ''}` : '—'}</td>`;
    append('Solado', `<tr class="material-row${short > 0 ? ' is-short' : ''}${!known ? ' is-pending' : ''}">
      <td><strong>${escapeHtml(row.groupName)}</strong>${row.warning ? `<div class="row-warning">▲ ${escapeHtml(row.warning)}</div>` : ''}</td>
      <td>${escapeHtml(row.materialName || 'Solado')}</td>
      <td>${escapeHtml(row.color || '—')}</td>
      <td class="num strong">${formatQty(row.totalQuantity, row.productUnit)}</td>
      ${coverageCells}
      <td class="unit">${escapeHtml(formatUnit(row.productUnit))}</td>
      ${costCellsHtml(unitPrice, totalCost, row.productUnit)}
    </tr>
    <tr class="grade-row"><td colspan="${colCount}">${renderSoleGrade(row, totalMode)}</td></tr>`, componentIndex('Solado'));
  }

  const head = totalMode
    ? '<tr><th>Grupo</th><th>Aplicação</th><th>Cor</th><th class="num">Necessidade</th><th>Un.</th><th class="num col-unit">Preço/un. consumo</th><th class="num col-spend">A gastar</th></tr>'
    : '<tr><th>Grupo</th><th>Aplicação</th><th>Cor</th><th class="num">Necessidade</th><th class="num">Estoque</th><th class="num">Falta</th><th>Un.</th><th class="num col-unit">Preço/un. consumo</th><th class="num col-spend">A gastar</th></tr>';

  const blocks = Array.from(sectionMap.entries()).map(([componentType, materialRows]) => ({
    order: sectionOrder.get(componentType) ?? componentIndex(componentType),
    html: `
      <div class="component-block">
        <div class="component-heading"><span>${escapeHtml(componentType)}</span><span>${materialRows.filter((row) => row.includes('class="material-row')).length} linha(s)</span></div>
        <table class="report-table materials-table${totalMode ? ' total-mode' : ''}">
          <thead>${head}</thead>
          <tbody>${materialRows.join('')}</tbody>
        </table>
      </div>`,
  }));
  const strapBlock = renderStrapBlock(rows, totalMode);
  if (strapBlock) blocks.push({ order: componentIndex('Tiras'), html: strapBlock });

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

const renderArtisanalStraps = (rows: ArtisanalStrapCutRow[]): string => {
  if (!rows.length) return '';
  const sector = aggregateStrapNapaSector(rows);
  const body = sector.types.map((type) => {
    const showBase = !baseNameAlreadyInType(type.typeName, type.baseName);
    return `
        <tr class="${type.blocked ? 'is-pending' : ''}">
          <td><strong>${escapeHtml(type.typeName)}</strong>${showBase && type.baseName ? `<small>${escapeHtml(type.baseName)}</small>` : ''}</td>
          <td>${escapeHtml(type.color)}</td>
          <td class="num strong">${formatQty(type.strapM, 'm')} m</td>
          <td class="num strong">${!type.blocked && type.napaM > 0 ? `${formatNapaMeters(type.napaM)} m` : '—'}</td>
          <td>${type.blocked
            ? `<span class="flag warning">cadastro incompleto</span>${type.blockedReason ? `<small class="row-warning">${escapeHtml(type.blockedReason)}</small>` : ''}`
            : '<span class="flag ok">ok</span>'}</td>
        </tr>`;
  }).join('');
  const footer = `
        <tr class="strap-subtotal">
          <td colspan="2"><strong>Total de napa a enviar ao prestador</strong></td>
          <td class="num muted">${formatQty(sector.totalStrapM, 'm')} m tira</td>
          <td class="num strong">${sector.totalNapaM > 0 ? `${formatNapaMeters(sector.totalNapaM)} m` : '—'}</td>
          <td></td>
        </tr>`;
  return `<section class="report-section strap-section">
    <div class="section-heading">
      <span class="section-number">03</span>
      <div><p class="section-kicker">Setor próprio</p><h2>Setor de Tiras</h2></div>
      <p class="section-note">Só tiras de Prestador (a fábrica não corta tira), por tipo e cor: metros de tira pelo prestador (depois do estoque de tira pronta) e napa a enviar ao prestador (÷ rendimento). Sem rendimento: napa “—” e fora da compra.</p>
    </div>
    <table class="report-table">
      <thead><tr><th>Tipo de tira</th><th>Cor</th><th class="num">Tira necessária</th><th class="num">Napa</th><th>Situação</th></tr></thead>
      <tbody>${body}${footer}</tbody>
    </table>
  </section>`;
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
  // O §03 só é impresso quando há tira de Prestador — sem ele, nenhum texto
  // pode apontar para a seção (ver STRAP_SECTOR_NOTE).
  const hasStrapSector = artisanalStrapRows.length > 0;
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
  // Decisão do dono (11/10/2026): napa das tiras fora de todo total — só §03.
  const napaOrigin = `Necessidade de napa (§01) soma cabedal (+ fachete) e forração${hasStrapSector ? '; a napa das tiras está no §03 Setor de Tiras' : ''}.`;
  const strapsIn02 = 'Tiras em §02: total em metros por tipo e cor, separando Prestador de Comprar pronto.';
  const reading = totalMode
    ? `Este documento ignora o estoque. Os números são o consumo bruto da ficha. ${napaOrigin} ${strapsIn02}`
    : `“Necessidade” é consumo bruto. “Falta” já desconta o estoque líquido. ${napaOrigin} ${strapsIn02}`;
  const manifest = totalMode
    ? `<div class="manifest manifest-total" aria-label="Resumo do consumo total">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>cabedal + forração${hasStrapSector ? ' · napa das tiras no §03' : ''}</small></div>
    <div><dl><dt>Total a gastar</dt><dd class="spend">${spendTotal != null ? escapeHtml(formatMoney(spendTotal)) : '—'}</dd></dl><small>necessidade × preço cadastrado</small></div>
    <div><dl><dt>Pendências</dt><dd>${pendingCount}</dd></dl><small>cadastro a revisar</small></div>
    <div><dl><dt>Escopo calculado</dt><dd>${rows.length} linha${rows.length === 1 ? '' : 's'}</dd></dl><small>ficha técnica + grade + variante do PV</small></div>
  </div>`
    : `<div class="manifest" aria-label="Resumo da decisão">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>cabedal + forração${hasStrapSector ? ' · napa das tiras no §03' : ''}</small></div>
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
            ${renderMaterialSections(model.rows, totalMode)}
          </div>
        `).join('')}
      </div>`).join('')
    : renderMaterialSections(rows, totalMode);

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
    .report-table td { padding:5px 5px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
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
    /* Cobertura: 9 cols — Grupo · Aplicação · Cor · Necessidade · Estoque · Falta · Un. · Preço · A gastar */
    .materials-table th:nth-child(1) { width:14%; }
    .materials-table th:nth-child(2) { width:14%; }
    .materials-table th:nth-child(3) { width:10%; }
    .materials-table th:nth-child(4),
    .materials-table th:nth-child(5),
    .materials-table th:nth-child(6) { width:9%; }
    .materials-table th:nth-child(7) { width:5%; text-align:center; }
    .materials-table th:nth-child(8) { width:12%; }
    .materials-table th:nth-child(9) { width:18%; }
    /* Total: 7 cols — Grupo · Aplicação · Cor · Necessidade · Un. · Preço · A gastar */
    .materials-table.total-mode th:nth-child(1) { width:18%; }
    .materials-table.total-mode th:nth-child(2) { width:18%; }
    .materials-table.total-mode th:nth-child(3) { width:12%; }
    .materials-table.total-mode th:nth-child(4) { width:12%; }
    .materials-table.total-mode th:nth-child(5) { width:6%; text-align:center; }
    .materials-table.total-mode th:nth-child(6) { width:14%; }
    .materials-table.total-mode th:nth-child(7) { width:20%; text-align:right; }
    .materials-table td.cost-spend { padding-right:7px; }
    /* Tiras (§02, 11/10/2026): tabela própria, total por tipo × cor — sem as
       colunas Aplicação/Un./Preço, que seriam espaço morto para tira.
       Como cada linha soma TODAS as fichas do tipo × cor, total de 4–5 dígitos
       é o caso normal (PV-00193 já tinha 1.402,80 m numa linha só). Medido no
       Chromium com Fira Sans/Fira Code reais, tabela de 731 px (A4) e 713 px
       (modo por modelo): "12.852,00" cabe em Total, Estoque e Falta a 10–11%;
       um gasto de 81.585,00 reais cabe em A gastar a 14%; "TIRA OVERLOCK 5 mm ·
       GLOW METALIC" fica numa linha a 31%. Com Falta a 8% todo valor de 4
       dígitos invadia a coluna do gasto (regra de print 4: número de tabela
       fixa tem de caber na coluna). Só gasto de 6 dígitos (100 mil reais ou
       mais) numa linha de tira passaria 1 px — irreal.
       Cobertura: 7 cols — Tipo · Cor · Origem · Total · Estoque · Falta · A gastar */
    /* O nome do tipo vem do SKU: tira de Prestador chega em caixa alta
       ("TIRA OVERLOCK 5 mm · GLOW METALIC") e strass em caixa mista ("Tira
       Strass 6mm"). Na mesma tabela viravam duas convenções. */
    .straps-table td:first-child strong { text-transform:uppercase; }
    .straps-table th:nth-child(1) { width:31%; }
    .straps-table th:nth-child(2) { width:13%; }
    .straps-table th:nth-child(3) { width:11%; }
    .straps-table th:nth-child(4) { width:11%; }
    .straps-table th:nth-child(5) { width:10%; }
    .straps-table th:nth-child(6) { width:10%; }
    .straps-table th:nth-child(7) { width:14%; }
    /* Total: 5 cols — Tipo · Cor · Origem · Total · A gastar */
    .straps-table.total-mode th:nth-child(1) { width:36%; }
    .straps-table.total-mode th:nth-child(2) { width:22%; }
    .straps-table.total-mode th:nth-child(3) { width:14%; }
    .straps-table.total-mode th:nth-child(4) { width:12%; }
    .straps-table.total-mode th:nth-child(5) { width:16%; }
    .straps-table td.cost-spend { padding-right:7px; }
    .grade-row td { padding:0 5px 6px 5px; border-bottom:1px solid var(--ink); background:white; }
    .sole-grade { padding:4px 0 0 12px; overflow:visible; }
    .sole-grade table { width:100%; border-collapse:collapse; font-size:7.2pt; table-layout:auto; }
    .sole-grade th, .sole-grade td { padding:2px 4px; border:1px solid var(--line); text-align:center; white-space:nowrap; }
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
  ${totalMode ? `<div class="decision-box" style="margin-top:8px"><h3>Leitura correta</h3><p>${reading}</p></div>` : `<div class="decision-grid">
    <div class="decision-box"><h3>Leitura correta</h3><p>${reading}</p></div>
    <div class="decision-box"><h3>Maiores faltas</h3>${shortfallList}</div>
  </div>`}
  ${partitioned.length > 0 ? '' : renderBaseNeed(rows, totalMode, hasStrapSector)}
  <section class="report-section">
    <div class="section-heading">
      <span class="section-number">02</span>
      <div><p class="section-kicker">Conferência completa</p><h2>${partitioned.length > 0 ? 'Materiais por PV e modelo' : 'Materiais por aplicação'}</h2></div>
      <p class="section-note">${totalMode
        ? `Somente a necessidade do pedido. Tiras: total em metros por tipo e cor${hasStrapSector ? '; a napa delas está no §03' : ''}. Tira com cadastro pendente fica com ▲.`
        : `A falta de solado é calculada por numeração; os demais itens usam o balde grupo + cor + unidade. Tiras: total por tipo e cor (prestador × compra)${hasStrapSector ? '; napa delas no §03' : ''}. Tira pendente fica com ▲.`}</p>
    </div>
    ${materialsBody}
  </section>
  ${renderArtisanalStraps(artisanalStrapRows)}
  <p class="footer-note">${totalMode
    ? 'Fonte: pedido de venda, ficha técnica vigente, variante de material e grade. Estoque líquido foi ignorado neste documento. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'
    : 'Fonte: pedido de venda, ficha técnica vigente, variante de material, grade e estoque líquido no momento da geração. Este relatório é uma simulação atual e pode diferir do snapshot histórico já congelado em uma OP. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'}</p>
</body>
</html>`;
}
