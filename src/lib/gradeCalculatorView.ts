import { type GradeCalculation } from '@/lib/gradeCalculator';
import { escapeHtml } from '@/lib/htmlUtils';

export const GRADE_PRINT_WINDOW_FEATURES = 'width=1400,height=900';

export function gradePrintDeliveryOptions(model = ''): {
  filename: string;
  title: string;
  landscape: true;
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
    landscape: true,
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

export function buildGradePrintHtml(
  draft: GradeCalculatorDraft,
  calculation: GradeCalculation,
): string {
  const model = draft.model.trim() || 'Não informado';
  const color = draft.color.trim() || 'Não informada';
  const sizeHeaders = calculation.rows
    .map((row) => `<th scope="col" class="size">${row.size}</th>`)
    .join('');

  const metricRow = (
    label: string,
    className: string,
    pick: (row: GradeCalculation['rows'][number]) => number,
    total: number,
    emphasizeSurplus = false,
  ) => {
    const cells = calculation.rows
      .map((row) => {
        const value = pick(row);
        const extra = emphasizeSurplus && value > 0 ? ' class="has-surplus"' : '';
        return `<td${extra}>${formatGradeQuantity(value)}</td>`;
      })
      .join('');
    return `
      <tr class="${className}">
        <th scope="row">${label}</th>
        ${cells}
        <td class="total">${formatGradeQuantity(total)}</td>
      </tr>`;
  };

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
        .meta, .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 10px 0; border: 2px solid #000; }
        .meta div, .summary div { padding: 8px 10px; border-right: 1px solid #000; }
        .meta div:last-child, .summary div:last-child { border-right: 0; }
        .meta span, .summary span { display: block; color: #444; font-size: 9px; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; }
        .meta strong, .summary strong { display: block; font-size: 18px; margin-top: 3px; }
        .summary { margin-top: 0; margin-bottom: 12px; }
        .summary .produce { background: #d0d0d0; }
        .summary .produce strong { font-size: 22px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1.5px solid #000; padding: 8px 6px; text-align: center; vertical-align: middle; }
        thead th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
        thead th.size { font-size: 22px; font-weight: 800; letter-spacing: 0; }
        thead th.total, td.total { background: #d9d9d9; font-weight: 800; }
        thead th.total { font-size: 12px; }
        tbody th { text-align: left; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; width: 132px; background: #f7f7f7; padding-left: 10px; }
        tbody td { font-size: 16px; font-variant-numeric: tabular-nums; font-family: Arial, Helvetica, sans-serif; }
        tbody tr:nth-child(odd) td { background: #fafafa; }
        tbody td:nth-child(even) { background: #f0f0f0; }
        tr.produce th, tr.produce td { background: #c8c8c8 !important; font-weight: 800; }
        tr.produce td { font-size: 24px; padding: 12px 6px; }
        tr.produce th { font-size: 13px; }
        tr.surplus td.has-surplus { background: #e8e8e8 !important; font-weight: 700; }
        footer { color: #555; font-size: 9px; margin-top: 10px; text-align: right; }
      </style>
    </head>
    <body>
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
      <section class="summary">
        <div><span>Necessidade</span><strong>${formatGradeQuantity(calculation.totals.need)}</strong></div>
        <div><span>Aproveitado</span><strong>${formatGradeQuantity(calculation.totals.used)}</strong></div>
        <div><span>Sobra</span><strong>${formatGradeQuantity(calculation.totals.surplus)}</strong></div>
        <div class="produce"><span>A produzir</span><strong>${formatGradeQuantity(calculation.totals.final)}</strong></div>
      </section>
      <table>
        <thead>
          <tr>
            <th scope="col"></th>
            ${sizeHeaders}
            <th scope="col" class="total">Total</th>
          </tr>
        </thead>
        <tbody>
          ${metricRow('Por ficha', 'per-sheet', (row) => row.needPerSheet, calculation.totals.needPerSheet)}
          ${metricRow('Necessidade', 'need', (row) => row.need, calculation.totals.need)}
          ${metricRow('Já pronta', 'ready', (row) => row.ready, calculation.totals.ready)}
          ${metricRow('A produzir', 'produce', (row) => row.final, calculation.totals.final)}
          ${metricRow('Sobra', 'surplus', (row) => row.surplus, calculation.totals.surplus, true)}
        </tbody>
      </table>
      <footer>Gerado no Squad Shoes</footer>
    </body>
  </html>`;
}
