import { computeBaseMaterialTotal } from '@/lib/baseMaterialTotal';
import { buildBuyList } from '@/lib/buyList';
import {
  aggregateItems,
  countPending,
  countShort,
  isConvertedInternalStrap,
  itemShortfall,
  rowAvailable,
  rowKnown,
  rowShortfall,
  soleShortSizes,
  topShortfalls,
  unitTotals,
} from '@/lib/consumptionAvailability';
import { formatQty, formatUnit } from '@/lib/consumptionFormat';
import { COMPONENT_ORDER, type ConsumptionRow } from '@/lib/consumptionRows';
import { escapeHtml } from '@/lib/htmlUtils';
import { buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

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

const renderBaseNeed = (rows: ConsumptionRow[], totalMode: boolean): string => {
  const { families, pendingStraps } = buildBuyList(rows);
  if (!families.length && !pendingStraps.length) return '';

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
          <th class="num">Tira</th>
          <th class="num">Total</th>
          ${totalMode ? '' : '<th>Situação</th>'}
        </tr></thead>
        <tbody>${family.colors.map((color) => `
          <tr>
            <td>${escapeHtml(color.color || '—')}</td>
            <td class="num app-qty">${mCell(color.cabedal)}</td>
            <td class="num app-qty">${mCell(color.forracao)}</td>
            <td class="num app-qty">${color.tira > 0 ? `${formatQty(color.tira, 'm')} m<small>prod. interna</small>` : '<span class="muted">—</span>'}</td>
            <td class="num strong">${formatQty(color.qty, 'm')} m</td>
            ${totalMode ? '' : `<td class="status-cell">${color.pending > 0 ? `<span class="flag warning">${color.pending} cadastro${color.pending === 1 ? '' : 's'}</span>` : '<span class="muted">—</span>'}</td>`}
          </tr>`).join('')}
        </tbody>
      </table>
    </article>`).join('');

  const pendingBlock = pendingStraps.length ? `
    <table class="report-table" style="margin-top:8px">
      <thead><tr><th>Família</th><th>Cor / tira</th><th class="num">Tira pendente</th><th>Situação</th></tr></thead>
      <tbody>${pendingStraps.map((pending) => `
        <tr class="pending-row">
          <td><strong>${escapeHtml(pending.napa)}</strong></td>
          <td>${escapeHtml(pending.color || '—')} · ${escapeHtml(pending.tira)}</td>
          <td class="num">${formatQty(pending.tiraM, 'm')} m de tira</td>
          <td class="status-cell"><span class="flag warning">rendimento pendente</span></td>
        </tr>`).join('')}
      </tbody>
    </table>` : '';

  return `
    <section class="report-section priority-section">
      <div class="section-heading">
        <span class="section-number">01</span>
        <div><p class="section-kicker">Material base</p><h2>Necessidade de napa</h2></div>
        <p class="section-note">${totalMode
          ? 'Estoque ignorado. Cabedal, forração e tira da mesma cor somam o metro de napa do pedido.'
          : 'Cabedal, forração e tira da mesma cor somam o metro de napa — tira artesanal já convertida.'}</p>
      </div>
      ${familyBlocks}
      ${pendingBlock}
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

const renderMaterialSections = (rows: ConsumptionRow[], totalMode: boolean): string => {
  const sectionMap = new Map<string, string[]>();
  const sectionOrder = new Map<string, number>();
  const append = (componentType: string, html: string, order: number) => {
    const current = sectionMap.get(componentType) || [];
    current.push(html);
    sectionMap.set(componentType, current);
    sectionOrder.set(componentType, Math.min(sectionOrder.get(componentType) ?? order, order));
  };
  const colCount = totalMode ? 5 : 7;

  const nonSole = aggregateItems(rows.filter((row) => row.componentType !== 'Solado'))
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
    const converted = item.rows.length > 0 && item.rows.every(isConvertedInternalStrap);
    const short = totalMode || converted ? 0 : itemShortfall(item);
    const previewQuantity = item.rows.reduce(
      (total, row) => total + Math.max(0, Number(row.previewQuantity) || 0),
      0,
    );
    const needHtml = previewQuantity > 0 && !(item.total > 0)
      ? `≈ ${formatQty(previewQuantity, item.productUnit)}<small class="qty-preview">prévia da ficha</small>`
      : formatQty(item.total, item.productUnit);
    const warnings = Array.from(new Set(item.rows.flatMap((row) => row.warning ? [row.warning] : [])));
    const napaNote = converted
      ? item.rows
        .map((row) => row.artisanal
          ? `${formatQty(row.artisanal.baseQty, 'm')} m ${row.artisanal.baseName}`
          : '')
        .filter(Boolean)
        .join(' + ')
      : '';
    const coverageCells = totalMode ? '' : `
      <td class="num">${converted || !item.known ? '—' : formatQty(item.available, item.productUnit)}</td>
      <td class="num${short > 0 ? ' shortage' : ''}">${converted
        ? `<span class="muted">prod. interna${napaNote ? `<small>${escapeHtml(napaNote)}</small>` : ''}</span>`
        : item.known && short > 0
          ? formatQty(short, item.productUnit)
          : '—'}</td>`;
    const convertedNote = converted
      ? `<div class="qty-preview">prod. interna${napaNote ? ` · ${escapeHtml(napaNote)}` : ''}</div>`
      : '';
    append(section, `<tr class="material-row${short > 0 ? ' is-short' : ''}${!item.known ? ' is-pending' : ''}">
      <td><strong>${escapeHtml(item.groupName)}</strong>${warnings.length ? `<div class="row-warning">▲ ${escapeHtml(warnings.join(' · '))}</div>` : ''}${totalMode ? convertedNote : ''}</td>
      <td>${escapeHtml(applications.join(' + ') || item.groupName)}${sectorApplications.length ? `<small>${escapeHtml(sectorApplications.join(' · '))}</small>` : ''}</td>
      <td>${escapeHtml(item.color || '—')}</td>
      <td class="num strong">${needHtml}</td>
      ${coverageCells}
      <td class="unit">${escapeHtml(formatUnit(item.productUnit))}</td>
    </tr>`, componentIndex(componentTypes[0] || item.componentType));
  }

  const soles = rows.filter((row) => row.componentType === 'Solado')
    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));
  for (const row of soles) {
    const short = totalMode ? 0 : rowShortfall(row);
    const known = rowKnown(row);
    const usefulStock = reportRowAvailable(row);
    const shortSizes = soleShortSizes(row);
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
    </tr>
    <tr class="grade-row"><td colspan="${colCount}">${renderSoleGrade(row, totalMode)}</td></tr>`, componentIndex('Solado'));
  }

  const head = totalMode
    ? '<tr><th>Grupo</th><th>Aplicação</th><th>Cor</th><th class="num">Necessidade</th><th>Un.</th></tr>'
    : '<tr><th>Grupo</th><th>Aplicação</th><th>Cor</th><th class="num">Necessidade</th><th class="num">Estoque</th><th class="num">Falta</th><th>Un.</th></tr>';

  return Array.from(sectionMap.entries())
    .sort(([a], [b]) => (sectionOrder.get(a) ?? componentIndex(a)) - (sectionOrder.get(b) ?? componentIndex(b)))
    .map(([componentType, materialRows]) => `
      <div class="component-block">
        <div class="component-heading"><span>${escapeHtml(componentType)}</span><span>${materialRows.filter((row) => row.includes('class="material-row')).length} linha(s)</span></div>
        <table class="report-table materials-table${totalMode ? ' total-mode' : ''}">
          <thead>${head}</thead>
          <tbody>${materialRows.join('')}</tbody>
        </table>
      </div>`)
    .join('');
};

const renderArtisanalStraps = (rows: ArtisanalStrapCutRow[]): string => {
  if (!rows.length) return '';
  return `<section class="report-section strap-section">
    <div class="section-heading">
      <span class="section-number">03</span>
      <div><p class="section-kicker">Transformação interna</p><h2>Tiras artesanais</h2></div>
      <p class="section-note">Separação da napa-base conforme o snapshot aprovado da receita.</p>
    </div>
    <table class="report-table">
      <thead><tr><th>Tira</th><th>Cor / base</th><th class="num">Tira necessária</th><th class="num">Napa a separar</th><th>Situação</th></tr></thead>
      <tbody>${rows.map((row) => {
        const snapshot = row.canonical;
        const blocked = !snapshot || snapshot.baseRequiredM <= 0 || snapshot.confirmedYieldMPerM <= 0 || snapshot.blockingReasons.length > 0 || !!snapshot.snapshotWarning;
        return `<tr class="${blocked ? 'is-pending' : ''}">
          <td><strong>${escapeHtml(row.groupName)}</strong></td>
          <td>${escapeHtml(row.color || '—')}${row.baseName ? ` · ${escapeHtml(row.baseName)}` : ''}</td>
          <td class="num strong">${formatQty(row.metros_necessarios, 'm')} m</td>
          <td class="num strong">${!blocked && snapshot ? `${formatQty(snapshot.baseRequiredM, 'm')} m` : '—'}</td>
          <td>${blocked ? `<span class="flag warning">${escapeHtml(snapshot?.snapshotWarning || snapshot?.blockingReasons.join(' · ') || 'snapshot incompleto')}</span>` : `<span class="flag ok">receita conferida</span>`}</td>
        </tr>`;
      }).join('')}</tbody>
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
}: MaterialConsumptionReportInput): string {
  const totalMode = mode === 'total';
  const baseTotal = computeBaseMaterialTotal(rows);
  const shortCount = countShort(rows);
  const pendingCount = countPending(rows);
  const majorShortfalls = topShortfalls(rows, 5);
  const totalsByUnit = unitTotals(rows);

  const totalStrip = Array.from(totalsByUnit.entries()).filter(([, total]) => total > 0).map(([unit, total]) => `
    <span><strong>${formatQty(total, unit)}</strong> ${escapeHtml(formatUnit(unit))}</span>
  `).join('');
  const shortfallList = majorShortfalls.length ? `<ol class="shortfall-list">${majorShortfalls.map((shortfall) => `
    <li><span>${escapeHtml(shortfall.label)}${shortfall.color && shortfall.color !== '—' ? ` · ${escapeHtml(shortfall.color)}` : ''}</span><strong>${formatQty(shortfall.qty, shortfall.unit)} ${escapeHtml(formatUnit(shortfall.unit))}</strong></li>
  `).join('')}</ol>` : '<p class="all-covered">Estoque cobre todos os itens conhecidos.</p>';
  const generatedLabel = generatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const modeBanner = totalMode
    ? '<p class="mode-banner">Consumo total · estoque ignorado · necessidade bruta do pedido</p>'
    : '';
  const reading = totalMode
    ? 'Este documento ignora o estoque. Os números são o consumo bruto da ficha para realizar o pedido. Tira artesanal com receita conferida entra como metro de napa — o motor não compra metro de tira.'
    : '“Necessidade” é consumo bruto. “Falta” já desconta o estoque líquido e é o número usado para decidir reposição. Tira artesanal com receita conferida entra como metro de napa — o motor não compra metro de tira.';
  const manifest = totalMode
    ? `<div class="manifest manifest-total" aria-label="Resumo do consumo total">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>napa direta + conversões confirmadas</small></div>
    <div><dl><dt>Pendências</dt><dd>${pendingCount}</dd></dl><small>cadastro a revisar</small></div>
    <div><dl><dt>Escopo calculado</dt><dd>${rows.length} linha${rows.length === 1 ? '' : 's'}</dd></dl><small>ficha técnica + grade + variante do PV</small></div>
  </div>`
    : `<div class="manifest" aria-label="Resumo da decisão">
    <div><dl><dt>Necessidade de material base</dt><dd>${baseTotal ? `${formatQty(baseTotal.total, 'm')} m` : '—'}</dd></dl><small>napa direta + conversões confirmadas</small></div>
    <div><dl><dt>Itens em falta</dt><dd class="shortage">${shortCount}</dd></dl><small>estoque líquido</small></div>
    <div><dl><dt>Pendências</dt><dd>${pendingCount}</dd></dl><small>cadastro a revisar</small></div>
    <div><dl><dt>Escopo calculado</dt><dd>${rows.length} linha${rows.length === 1 ? '' : 's'}</dd></dl><small>ficha técnica + grade + variante do PV</small></div>
  </div>`;

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
    @page { size: A4 portrait; margin: 10mm 9mm 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    :root { --ink:#11100f; --paper:#fbfaf7; --muted:#726d66; --line:#cbc6bd; --soft:#efede8; --accent:#d9264e; --warn:#a45b0b; --ok:#176c42; }
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
    .manifest { display:grid; grid-template-columns:1.4fr .8fr .8fr 1.6fr; border-bottom:2px solid var(--ink); background:var(--paper); }
    .manifest-total { grid-template-columns:1.6fr .8fr 1.4fr; }
    .manifest > div { min-height:53px; padding:8px 9px; border-right:1px solid var(--line); }
    .manifest > div:last-child { border-right:0; }
    .manifest dl { margin:0; }
    .manifest dt { margin-bottom:3px; }
    .manifest dd { margin:0; font-size:15pt; font-weight:700; line-height:1; }
    .manifest dd.shortage { color:var(--accent); }
    .manifest small { display:block; margin-top:4px; color:var(--muted); font-size:7.4pt; }
    .scope { display:flex; gap:12px; align-items:flex-start; margin-top:7px; padding:6px 8px; border:1px solid var(--line); background:var(--paper); }
    .scope-label { flex:0 0 auto; }
    .scope-list { display:flex; flex-wrap:wrap; gap:3px 14px; }
    .totals-strip { display:flex; flex-wrap:wrap; gap:4px 14px; margin:8px 0 3px; padding:5px 0; border-bottom:1px solid var(--line); color:var(--muted); font-size:8pt; }
    .totals-strip strong { color:var(--ink); font-family:'Fira Code',monospace; }
    .report-section { margin-top:11px; }
    .section-heading { display:grid; grid-template-columns:27px 1fr minmax(160px, 42%); align-items:end; gap:8px; margin-bottom:5px; padding-top:5px; border-top:2px solid var(--ink); }
    .section-number { color:var(--accent); font-size:12pt; font-weight:700; }
    .section-heading h2 { font-family:'Anton','Arial Narrow',Impact,sans-serif; font-size:15pt; line-height:1; font-weight:400; text-transform:uppercase; }
    .section-note { color:var(--muted); font-size:7.6pt; text-align:right; }
    .napa-family { margin-top:8px; border:1px solid var(--ink); break-inside:avoid; }
    .napa-family-head { display:flex; align-items:baseline; gap:10px; padding:6px 8px; background:var(--ink); color:white; }
    .napa-family-name { font-family:'Anton','Arial Narrow',Impact,sans-serif; font-size:13pt; line-height:1; letter-spacing:.02em; text-transform:uppercase; }
    .napa-family-meta { margin-left:auto; color:#ccc8c1; font-size:7.2pt; letter-spacing:.08em; text-transform:uppercase; }
    .napa-family-qty { font-size:13pt; font-weight:700; }
    .napa-table th:nth-child(1) { width:22%; }
    .napa-table .app-qty small { display:block; color:var(--muted); font-size:6.4pt; font-weight:500; }
    .report-table { width:100%; border-collapse:collapse; table-layout:fixed; }
    .report-table thead { display:table-header-group; }
    .report-table th { padding:4px 5px; border-top:1px solid var(--ink); border-bottom:1px solid var(--ink); background:var(--soft); color:var(--muted); font-size:7pt; font-weight:700; letter-spacing:.08em; text-align:left; text-transform:uppercase; }
    .report-table td { padding:5px 6px; border-bottom:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }
    .report-table .num { text-align:right; white-space:nowrap; }
    .report-table .unit { width:34px; text-align:center; color:var(--muted); }
    .report-table .strong { font-weight:700; }
    .status-cell { width:112px; }
    .flag { display:inline-block; max-width:100%; border:1px solid currentColor; padding:1px 5px; border-radius:99px; font-size:6.7pt; font-weight:700; line-height:1.25; }
    .flag.warning { color:var(--warn); background:#fff8e9; }
    .flag.ok { color:var(--ok); background:#edf8f1; }
    .muted { color:var(--muted); }
    .pending-row, .is-pending { background:#fffaf0; }
    .material-row.is-short td:first-child { border-left:3px solid var(--accent); }
    .shortage { color:var(--accent); font-weight:700; }
    .shortage small { display:block; color:var(--muted); font-size:6.5pt; font-weight:500; }
    .row-warning { margin-top:2px; color:var(--warn); font-size:6.7pt; line-height:1.25; }
    .qty-preview { display:block; margin-top:1px; color:var(--muted); font-family:'Fira Sans',sans-serif; font-size:6.5pt; font-weight:500; }
    .component-block { margin-top:8px; break-inside:auto; }
    .component-heading { display:flex; justify-content:space-between; gap:10px; padding:3px 5px; border-left:4px solid var(--accent); background:var(--ink); color:white; font-size:7.6pt; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
    .component-heading span:last-child { color:#ccc8c1; font-family:'Fira Code',monospace; font-size:6.8pt; }
    .materials-table th:nth-child(1) { width:22%; } .materials-table th:nth-child(2) { width:24%; }
    .materials-table th:nth-child(3) { width:13%; } .materials-table th:nth-child(4), .materials-table th:nth-child(5), .materials-table th:nth-child(6) { width:11%; }
    .materials-table th:nth-child(7) { width:8%; text-align:center; }
    .materials-table.total-mode th:nth-child(4) { width:22%; } .materials-table.total-mode th:nth-child(5) { width:10%; text-align:center; }
    .grade-row td { padding:0 5px 6px 5px; border-bottom:1px solid var(--ink); }
    .sole-grade { padding:4px 0 0 22%; }
    .sole-grade table { width:100%; border-collapse:collapse; font-size:7.2pt; table-layout:fixed; }
    .sole-grade th, .sole-grade td { padding:2px 3px; border:1px solid var(--line); text-align:center; }
    .sole-grade th:first-child { width:72px; text-align:left; background:var(--soft); }
    .grade-num { font-family:'Fira Code',monospace; font-variant-numeric:tabular-nums; }
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
    <div><p class="brandline">Squad Shoes · suprimentos industriais</p><h1>${escapeHtml(title)}</h1>${modeBanner}</div>
    <p class="doc-meta">Documento operacional<strong>${escapeHtml(generatedLabel)}</strong></p>
  </header>

  ${manifest}
  ${renderScope(orderHeaders)}
  <div class="totals-strip"><strong>Necessidade total</strong>${totalStrip}</div>
  ${totalMode ? `<div class="decision-box" style="margin-top:8px"><h3>Leitura correta</h3><p>${reading}</p></div>` : `<div class="decision-grid">
    <div class="decision-box"><h3>Leitura correta</h3><p>${reading}</p></div>
    <div class="decision-box"><h3>Maiores faltas</h3>${shortfallList}</div>
  </div>`}
  ${renderBaseNeed(rows, totalMode)}
  <section class="report-section">
    <div class="section-heading">
      <span class="section-number">02</span>
      <div><p class="section-kicker">Conferência completa</p><h2>Materiais por aplicação</h2></div>
      <p class="section-note">${totalMode
        ? 'Somente a necessidade do pedido. Tira interna aparece com o equivalente em napa.'
        : 'A falta de solado é calculada por numeração; os demais itens usam o balde grupo + cor + unidade.'}</p>
    </div>
    ${renderMaterialSections(rows, totalMode)}
  </section>
  ${renderArtisanalStraps(artisanalStrapRows)}
  <p class="footer-note">${totalMode
    ? 'Fonte: pedido de venda, ficha técnica vigente, variante de material e grade. Estoque líquido foi ignorado neste documento. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'
    : 'Fonte: pedido de venda, ficha técnica vigente, variante de material, grade e estoque líquido no momento da geração. Este relatório é uma simulação atual e pode diferir do snapshot histórico já congelado em uma OP. Linhas com ▲ exigem correção cadastral antes de reserva, débito ou compra.'}</p>
</body>
</html>`;
}
