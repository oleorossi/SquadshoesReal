import { evaluationDetail, type EmployeeTimesheetData } from './printTimesheet';
import type { SalaryPayrollResult } from './salaryPayroll';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fmtBR = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d);
const h2 = (min: number) => Math.round((min / 60) * 100) / 100;   // minutos → horas (2 casas)
const r2 = (v: number) => Math.round(v * 100) / 100;

const KIND_LABEL: Record<string, string> = {
  ok: 'Normal', curto: 'Abaixo do esperado', falta: 'FALTA',
  fds: 'Fim de semana / feriado', pendente: 'Batida ímpar (pendente)',
};

export interface FolhaExportRow {
  ext?: string;
  name: string;
  data: EmployeeTimesheetData;     // pra montar o dia a dia (evaluationDetail)
  mes: SalaryPayrollResult;
  q1: SalaryPayrollResult;
  q2: SalaryPayrollResult;
  advMes: number;
  sit: string;
}

/**
 * Gera e baixa um .xlsx com a folha do período:
 *   - "Resumo": 1 linha por funcionário (salário, faltas, atrasos, HE, líquidos mês/quinzenas).
 *   - "Detalhe dia a dia": 1 linha por (funcionário × dia) com batidas, esperado, trabalhado,
 *     situação, saldo e o desconto/excedente DO DIA.
 *   - "Como ler": notas (HE/atraso pago é líquido do período; falta = salário ÷ 30).
 * Tudo com o MESMO motor da folha (evaluationDetail reconcilia com computePeriodFolha).
 */
export async function exportFolhaExcel(rows: FolhaExportRow[], periodLabel: string, filename: string): Promise<void> {
  const XLSX = await import('xlsx'); // lazy: 424KB só ao exportar a Folha
  const wb = XLSX.utils.book_new();

  // ── Resumo (1 linha/funcionário) ──
  const resumo = rows.map(r => ({
    'Matrícula': r.ext || '',
    'Funcionário': r.name,
    'Salário': r2(r.mes.base_salary),
    'Faltas (dias)': r.mes.falta_days,
    'Faltas (R$)': r2(r.mes.falta_desconto),
    'Atrasos (R$)': r2(r.mes.atraso_desconto),
    'Hora extra (R$)': r2(r.mes.he_value),
    'Adiantamentos (R$)': r2(r.advMes),
    'Líquido Mês': r2(r.mes.net_value),
    'Líquido 1ª quinz': r2(r.q1.net_value),
    'Líquido 2ª quinz': r2(r.q2.net_value),
    'Situação': r.sit,
  }));
  const wsResumo = XLSX.utils.json_to_sheet(resumo);
  wsResumo['!cols'] = [
    { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
    { wch: 13 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 34 },
  ];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  // ── Detalhe dia a dia (1 linha/funcionário/dia) ──
  const detalhe: Record<string, string | number>[] = [];
  for (const r of rows) {
    const e = evaluationDetail(r.data);
    for (const d of e.dayRows) {
      const deficitMin = d.kind === 'falta' ? d.expected : (d.kind === 'curto' ? Math.max(0, d.expected - d.worked) : 0);
      const descontoDia = d.kind === 'falta' ? e.valorDia : (d.kind === 'curto' ? (deficitMin / 60) * e.vh : 0);
      const excedenteDia = d.saldo > 0 ? (d.saldo / 60) * e.vh * e.premiumMultiplier : 0;
      detalhe.push({
        'Matrícula': r.ext || '',
        'Funcionário': r.name,
        'Data': fmtBR(d.date),
        'Dia': DAYS_PT[d.dayOfWeek] || '',
        'Batidas (horários)': d.punches.join(' · ') || (d.kind === 'falta' ? '— (falta)' : '—'),
        'Esperado (h)': h2(d.expected),
        'Trabalhado (h)': d.kind === 'pendente' ? 'ímpar' : h2(d.worked),
        'Situação do dia': KIND_LABEL[d.kind] || d.kind,
        'Saldo do dia (h)': d.kind === 'falta' || d.kind === 'pendente' ? '' : h2(d.saldo),
        'Desconto do dia (R$)': r2(descontoDia),
        'Excedente do dia (R$)': r2(excedenteDia),
      });
    }
  }
  const wsDet = XLSX.utils.json_to_sheet(detalhe);
  wsDet['!cols'] = [
    { wch: 9 }, { wch: 22 }, { wch: 11 }, { wch: 5 }, { wch: 26 }, { wch: 11 },
    { wch: 13 }, { wch: 22 }, { wch: 13 }, { wch: 17 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalhe dia a dia');

  // ── Como ler ──
  const notas = [
    [`Folha — ${periodLabel}`],
    [],
    ['Os valores seguem o MESMO motor da Folha (hora extra LÍQUIDA do período).'],
    ['• Falta = desconta 1 dia (salário ÷ 30). O "Desconto do dia (R$)" da falta é exato.'],
    ['• Atraso: o "Desconto do dia (R$)" de um dia "abaixo do esperado" é só referência —'],
    ['  o atraso PAGO é LÍQUIDO do período (dias longos / fim de semana abatem antes).'],
    ['  O valor oficial está em "Atrasos (R$)" no Resumo.'],
    ['• Hora extra: o "Excedente do dia (R$)" é bruto por dia (×1,5). A HE PAGA é o'],
    ['  excedente LÍQUIDO do período — quem não bate a meta de horas NÃO tem HE.'],
    ['  O valor oficial está em "Hora extra (R$)" no Resumo.'],
    ['• Batida ímpar = dia pendente (fica fora do cálculo até resolver em Pendências).'],
    ['• Base da quinzena é proporcional aos dias do mês: 1ª + 2ª = salário exato.'],
    ['• Líquido = salário (proporcional) − faltas − atrasos + HE − adiantamentos.'],
    ['• A coluna Situação no Resumo avisa ponto faltando / faltas demais / sem escala —'],
    ['  corrija o ponto antes de pagar.'],
  ];
  const wsNotas = XLSX.utils.aoa_to_sheet(notas);
  wsNotas['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, 'Como ler');

  XLSX.writeFile(wb, filename);
}
