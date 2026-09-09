/**
 * Export CSV da produção por par (Ficha de Montadores).
 * Uma linha por lançamento do período — pessoa × dia × pares × valor.
 */
import { isChamadaRow, paresDiffOfRow, ratesOfRow, type FichaMontadorRow } from '@/lib/montadorProduction';

export interface ExportRow {
  dia: string;
  montadorId: string;
  montadorNome: string;
  setor: string;
  paresMedio: number;
  paresDificil: number;
  pares: number;
  valorMedio: number;
  valorDificil: number;
  bruto: number;
  situacao: 'pago' | 'folha' | 'aberto';
}

function csvEscape(value: string | number): string {
  const s = String(value ?? '');
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildProducaoExportRows(
  fichas: Array<FichaMontadorRow & {
    dia?: string | null;
    montador?: string | null;
    setor?: string | null;
    payroll_run_id?: string | null;
    pago_em?: string | null;
  }>,
  nomePorId: Map<string, string> = new Map(),
): ExportRow[] {
  const out: ExportRow[] = [];
  for (const f of fichas) {
    if (!isChamadaRow(f) || !f.montador_id || !f.dia) continue;
    const { medio, dificil } = paresDiffOfRow(f);
    const { vm, vd } = ratesOfRow(f);
    const bruto = medio * vm + dificil * vd;
    const situacao: ExportRow['situacao'] = f.pago_em
      ? 'pago'
      : f.payroll_run_id
        ? 'folha'
        : 'aberto';
    out.push({
      dia: f.dia,
      montadorId: f.montador_id,
      montadorNome: nomePorId.get(f.montador_id) || f.montador || f.montador_id,
      setor: f.setor || '',
      paresMedio: medio,
      paresDificil: dificil,
      pares: medio + dificil,
      valorMedio: vm,
      valorDificil: vd,
      bruto,
      situacao,
    });
  }
  out.sort((a, b) => a.dia.localeCompare(b.dia) || a.montadorNome.localeCompare(b.montadorNome));
  return out;
}

/** CSV com `;` (Excel pt-BR) e BOM UTF-8. */
export function producaoExportToCsv(rows: ExportRow[]): string {
  const header = [
    'dia', 'montador', 'setor', 'pares_medio', 'pares_dificil', 'pares',
    'r_par_medio', 'r_par_dificil', 'bruto', 'situacao',
  ];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.dia),
      csvEscape(r.montadorNome),
      csvEscape(r.setor),
      csvEscape(r.paresMedio),
      csvEscape(r.paresDificil),
      csvEscape(r.pares),
      csvEscape(r.valorMedio.toFixed(4)),
      csvEscape(r.valorDificil.toFixed(4)),
      csvEscape(r.bruto.toFixed(2)),
      csvEscape(r.situacao),
    ].join(';'));
  }
  return `\uFEFF${lines.join('\n')}`;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Semana imediatamente anterior à âncora (Seg–Dom). */
export function semanaAnteriorDe(fromIso: string): { from: string; to: string } {
  const d = new Date(`${fromIso}T00:00:00`);
  d.setDate(d.getDate() - 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const prevFrom = `${y}-${m}-${day}`;
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const ey = end.getFullYear();
  const em = String(end.getMonth() + 1).padStart(2, '0');
  const ed = String(end.getDate()).padStart(2, '0');
  return { from: prevFrom, to: `${ey}-${em}-${ed}` };
}
