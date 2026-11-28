import { type GradeCalculation } from '@/lib/gradeCalculator';
import { escapeHtml } from '@/lib/htmlUtils';

export const GRADE_PRINT_WINDOW_FEATURES = 'width=1400,height=900';

export type GradePrintLayout = 'sheet' | 'phone';

export function isGradePrintPhoneLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

export function gradePrintDeliveryOptions(
  model = '',
  layout: GradePrintLayout = 'sheet',
): {
  filename: string;
  title: string;
  landscape: boolean;
} {
  const slug = model
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return {
    filename: slug ? `calculadora-grade-${slug}` : 'calculadora-grade',
    title: 'Calculadora Grade',
    landscape: layout === 'sheet',
  };
}

export function formatGradeQuantity(value: number): string {
  return value.toLocaleString('pt-BR');
}

export interface GradeCalculatorDraft {
  model: string;
  color: string;
  from: number;
  to: number;
  sheetCount: number;
}

function identificationLines(draft: GradeCalculatorDraft): string[] {
  return [
    draft.model.trim() ? `Modelo: ${draft.model.trim()}` : null,
    draft.color.trim() ? `Cor: ${draft.color.trim()}` : null,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Resumo tabular na horizontal (numerações nas colunas) para colar
 * no WhatsApp ou em planilha, com a linha "A produzir" fácil de achar.
 */
export function buildGradeSummaryText(
  draft: GradeCalculatorDraft,
  calculation: GradeCalculation,
): string {
  const sizeHeaders = calculation.rows.map((row) => String(row.size));
  const header = ['', ...sizeHeaders, 'TOTAL'].join('\t');
  const line = (label: string, pick: (row: GradeCalculation['rows'][number]) => number, total: number) =>
    [label, ...calculation.rows.map((row) => formatGradeQuantity(pick(row))), formatGradeQuantity(total)].join('\t');

  return [
    'CALCULADORA GRADE · SQUAD SHOES',
    ...identificationLines(draft),
    `Faixa: ${draft.from}–${draft.to}`,
    `Fichas: ${calculation.sheetCount}`,
    '',
    header,
    line('Por ficha', (row) => row.needPerSheet, calculation.totals.needPerSheet),
    line('Necessidade', (row) => row.need, calculation.totals.need),
    line('Já pronta', (row) => row.ready, calculation.totals.ready),
    line('A produzir', (row) => row.final, calculation.totals.final),
    line('Sobra', (row) => row.surplus, calculation.totals.surplus),
    '',
    `Necessidade total: ${formatGradeQuantity(calculation.totals.need)}`,
    `Palmilhas aproveitadas: ${formatGradeQuantity(calculation.totals.used)}`,
    `A produzir: ${formatGradeQuantity(calculation.totals.final)}`,
    `Sobra por numeração: ${formatGradeQuantity(calculation.totals.surplus)}`,
  ].join('\n');
}

export function sumGradeRows(rows: GradeCalculation['rows']): GradeCalculation['totals'] {
  return rows.reduce<GradeCalculation['totals']>((sum, row) => ({
    needPerSheet: sum.needPerSheet + row.needPerSheet,
    need: sum.need + row.need,
    ready: sum.ready + row.ready,
    used: sum.used + row.used,
    final: sum.final + row.final,
    surplus: sum.surplus + row.surplus,
  }), {
    needPerSheet: 0,
    need: 0,
    ready: 0,
    used: 0,
    final: 0,
    surplus: 0,
  });
}

/** Numerações que o operador ainda precisa produzir (a produzir > 0). */
export function gradePrintVisibleRows(calculation: GradeCalculation): GradeCalculation['rows'] {
  return calculation.rows.filter((row) => row.final > 0);
}

/** Numerações ocultas porque a palmilha já pronta cobre toda a necessidade. */
export function gradePrintCoveredRows(calculation: GradeCalculation): GradeCalculation['rows'] {
  return calculation.rows.filter((row) => row.final === 0 && row.need > 0);
}

export function buildGradePrintHtml(
  draft: GradeCalculatorDraft,
  calculation: GradeCalculation,
  layout: GradePrintLayout = 'sheet',
): string {
  const model = draft.model.trim() || 'Não informado';
  const color = draft.color.trim() || 'Não informada';
  const visibleRows = gradePrintVisibleRows(calculation);
  const visibleTotals = sumGradeRows(visibleRows);
  const produceTotal = formatGradeQuantity(visibleTotals.final);
  const emptyMessage = 'A palmilha já pronta cobre todas as numerações. Nada a produzir.';

  const identification = `
      <header>
        <p class="eyebrow">PRODUÇÃO · SOLADOS</p>
        <h1>Calculadora Grade</h1>
      </header>
      <section class="meta">
        <div><span>Modelo</span><strong>${escapeHtml(model)}</strong></div>
        <div><span>Cor</span><strong>${escapeHtml(color)}</strong></div>
        <div><span>Faixa</span><strong>${draft.from}–${draft.to}</strong></div>
        <div><span>Fichas</span><strong>${calculation.sheetCount}</strong></div>
      </section>
      <section class="produce-banner">
        <span>A produzir</span>
        <strong>${produceTotal}</strong>
      </section>`;

  if (layout === 'phone') {
    const list = visibleRows.length === 0
      ? `<p class="empty">${emptyMessage}</p>`
      : `<table class="cut-list">
        <thead>
          <tr>
            <th scope="col">Nº</th>
            <th scope="col">A cortar</th>
          </tr>
        </thead>
        <tbody>
          ${visibleRows.map((row) => `
          <tr>
            <th scope="row" class="size">${row.size}</th>
            <td class="qty">${formatGradeQuantity(row.final)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td class="qty total">${produceTotal}</td>
          </tr>
        </tfoot>
      </table>`;

    return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Calculadora Grade · ${escapeHtml(model)}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #000; background: #fff; font: 16px Arial, Helvetica, sans-serif; }
        header { border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
        h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: .02em; }
        .eyebrow { margin: 0 0 4px; font: bold 10px monospace; letter-spacing: .12em; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; border: 2px solid #000; }
        .meta div { padding: 10px 12px; border-right: 1px solid #000; border-bottom: 1px solid #000; }
        .meta div:nth-child(2n) { border-right: 0; }
        .meta div:nth-last-child(-n+2) { border-bottom: 0; }
        .meta span { display: block; color: #444; font-size: 10px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
        .meta strong { display: block; font-size: 20px; margin-top: 3px; word-break: break-word; }
        .produce-banner { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 12px 0 16px; padding: 14px 16px; border: 2px solid #000; background: #c8c8c8; }
        .produce-banner span { font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .produce-banner strong { font-size: 48px; line-height: 1; font-variant-numeric: tabular-nums; }
        .cut-list { border-collapse: collapse; width: 100%; }
        .cut-list th, .cut-list td { border: 2px solid #000; padding: 14px 16px; vertical-align: middle; }
        .cut-list thead th { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; background: #f2f2f2; }
        .cut-list thead th:last-child, .cut-list td { text-align: right; }
        .cut-list th.size { text-align: left; font-size: 36px; font-weight: 800; }
        .cut-list td.qty { font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .cut-list tfoot th, .cut-list tfoot td { background: #c8c8c8; }
        .cut-list tfoot th { text-align: left; font-size: 16px; letter-spacing: .08em; text-transform: uppercase; }
        .empty { border: 2px solid #000; padding: 18px 14px; font-size: 18px; font-weight: 700; text-align: center; }
        footer { color: #555; font-size: 9px; margin-top: 16px; text-align: right; }
      </style>
    </head>
    <body>
      ${identification}
      ${list}
      <footer>Gerado no Squad Shoes</footer>
    </body>
  </html>`;
  }

  const sizeHeaders = visibleRows
    .map((row) => `<th scope="col" class="size">${row.size}</th>`)
    .join('');
  const qtyCells = visibleRows
    .map((row) => `<td>${formatGradeQuantity(row.final)}</td>`)
    .join('');
  const table = visibleRows.length === 0
    ? `<p class="empty">${emptyMessage}</p>`
    : `<table>
        <thead>
          <tr>
            <th scope="col"></th>
            ${sizeHeaders}
            <th scope="col" class="total">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr class="produce">
            <th scope="row">A produzir</th>
            ${qtyCells}
            <td class="total">${produceTotal}</td>
          </tr>
        </tbody>
      </table>`;

  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Calculadora Grade · ${escapeHtml(model)}</title>
      <style>
        @page { size: landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #000; background: #fff; font: 13px Arial, Helvetica, sans-serif; }
        header { border-bottom: 3px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
        h1 { margin: 0; font-size: 26px; text-transform: uppercase; letter-spacing: .02em; }
        .eyebrow { margin: 0 0 4px; font: bold 10px monospace; letter-spacing: .12em; }
        .meta { display: grid; grid-template-columns: repeat(4, 1fr); border: 2px solid #000; margin: 10px 0; }
        .meta div { padding: 8px 10px; border-right: 1px solid #000; }
        .meta div:last-child { border-right: 0; }
        .meta span { display: block; color: #444; font-size: 9px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
        .meta strong { display: block; font-size: 18px; margin-top: 3px; }
        .produce-banner { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 0 0 14px; padding: 10px 14px; border: 2px solid #000; background: #c8c8c8; }
        .produce-banner span { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .produce-banner strong { font-size: 36px; line-height: 1; font-variant-numeric: tabular-nums; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1.5px solid #000; padding: 8px 6px; text-align: center; vertical-align: middle; }
        thead th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
        thead th.size { font-size: 22px; font-weight: 800; letter-spacing: 0; }
        thead th.total, td.total { background: #d9d9d9; font-weight: 800; }
        thead th.total { font-size: 12px; }
        tbody th { text-align: left; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; width: 132px; background: #c8c8c8; padding-left: 10px; }
        tbody td { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; }
        tr.produce th, tr.produce td { background: #c8c8c8 !important; font-weight: 800; }
        tr.produce td { padding: 16px 6px; }
        .empty { border: 2px solid #000; padding: 18px 14px; font-size: 16px; font-weight: 700; text-align: center; }
        footer { color: #555; font-size: 9px; margin-top: 10px; text-align: right; }
      </style>
    </head>
    <body>
      ${identification}
      ${table}
      <footer>Gerado no Squad Shoes</footer>
    </body>
  </html>`;
}
