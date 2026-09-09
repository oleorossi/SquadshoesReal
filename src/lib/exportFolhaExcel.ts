import type { EmployeeTimesheetData } from './printTimesheet';
import type { SalaryPayrollResult } from './salaryPayroll';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fmtBR = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d);
const h2 = (min: number) => Math.round((min / 60) * 100) / 100;   // minutos → horas (2 casas)
const r2 = (v: number) => Math.round(v * 100) / 100;

const KIND_LABEL: Record<string, string> = {
  normal: 'Normal', credit: 'Crédito de jornada', debit: 'Débito de jornada',
  absence: 'FALTA', excused: 'Ausência justificada',
  pending: 'Batida ímpar (pendente)', neutral: 'Neutro / sem cobertura',
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
 *   - "Resumo": 1 linha por funcionário (salário, faltas, compensação, atraso líquido, HE e líquido).
 *   - "Detalhe dia a dia": 1 linha por (funcionário × dia) com batidas, esperado, trabalhado,
 *     situação, saldos brutos, compensação e parcelas efetivamente pagas/descontadas.
 *   - "Como ler": contrato da regra vigente.
 * Tudo vem do ledger de computePeriodFolha; não há recálculo financeiro no exportador.
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
    'Créditos brutos (min)': r.mes.raw_credit_minutes || 0,
    'Atrasos brutos (min)': r.mes.raw_delay_minutes || 0,
    'Compensado (min)': r.mes.compensated_minutes || 0,
    'Atraso líquido (min)': r.mes.atraso_minutes,
    'Atraso líquido (R$)': r2(r.mes.atraso_desconto),
    'HE normal paga (min)': r.mes.he_normal_minutes || 0,
    'HE dom./feriado paga (min)': r.mes.he_holiday_minutes || 0,
    'Hora extra paga (R$)': r2(r.mes.he_value),
    'Adiantamentos (R$)': r2(r.advMes),
    'Líquido do período': r2(r.mes.net_value),
    'Versão da regra': r.mes.rule_version,
    'Situação': r.sit,
  }));
  const wsResumo = XLSX.utils.json_to_sheet(resumo);
  wsResumo['!cols'] = [
    { wch: 9 }, { wch: 22 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 15 },
    { wch: 18 }, { wch: 20 }, { wch: 26 }, { wch: 34 },
  ];
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  // ── Detalhe dia a dia (1 linha/funcionário/dia) ──
  const detalhe: Record<string, string | number>[] = [];
  for (const r of rows) {
    for (const d of (r.mes.day_ledger || [])) {
      detalhe.push({
        'Matrícula': r.ext || '',
        'Funcionário': r.name,
        'Data': fmtBR(d.date),
        'Dia': DAYS_PT[d.day_of_week] || '',
        'Batidas (horários)': d.punches.join(' · ') || (d.status === 'absence' ? '— (falta)' : '—'),
        'Esperado (h)': h2(d.expected_minutes),
        'Trabalhado (h)': d.status === 'pending' ? 'ímpar' : h2(d.worked_minutes),
        'Ausência remunerada (h)': h2(d.excused_minutes || 0),
        'Situação do dia': KIND_LABEL[d.status] || d.status,
        'Saldo bruto (h)': d.status === 'absence' || d.status === 'pending' ? '' : h2(d.raw_balance_minutes),
        'Crédito bruto (min)': d.raw_credit_minutes,
        'Débito bruto (min)': d.raw_delay_minutes,
        'Compensado (min)': Math.max(d.compensated_credit_minutes, d.compensated_delay_minutes),
        'HE paga (min)': d.payable_overtime_minutes,
        'Atraso líquido (min)': d.payable_delay_minutes,
        'Tolerância descartada (min)': d.discarded_tolerance_minutes,
        'Tipo de HE': d.overtime_bucket === 'holiday' ? 'Domingo/feriado' : d.overtime_bucket === 'normal' ? 'Normal' : '',
      });
    }
  }
  const wsDet = XLSX.utils.json_to_sheet(detalhe);
  wsDet['!cols'] = [
    { wch: 9 }, { wch: 22 }, { wch: 11 }, { wch: 5 }, { wch: 26 }, { wch: 11 },
    { wch: 13 }, { wch: 25 }, { wch: 24 }, { wch: 13 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalhe dia a dia');

  // ── Como ler ──
  const notas = [
    [`Folha — ${periodLabel}`],
    [],
    ['Os valores e o detalhe vêm do MESMO ledger usado no fechamento da Folha.'],
    ['• Excesso de um dia compensa atraso parcial de outro dentro do período selecionado.'],
    ['• Falta integral fica separada e não entra na compensação de minutos.'],
    ['• Ausência remunerada parcial cobre somente a defasagem do dia e nunca gera HE.'],
    ['• Primeiro calcula-se crédito bruto − atraso bruto. Saldo positivo acima de 10min vira HE;'],
    ['  saldo de 1 a 10min é descartado; saldo negativo vira atraso líquido descontável.'],
    ['• A compensação consome primeiro créditos de taxa normal e preserva domingo/feriado.'],
    ['• HE normal e domingo/feriado usam as taxas individuais cadastradas no funcionário.'],
    ['• Batida ímpar = dia pendente (fica fora do cálculo até resolver em Pendências).'],
    ['• Líquido = salário (proporcional) − faltas − atrasos + HE − adiantamentos.'],
    ['• A coluna Situação no Resumo avisa ponto faltando / faltas demais / sem escala —'],
    ['  corrija o ponto antes de pagar.'],
  ];
  const wsNotas = XLSX.utils.aoa_to_sheet(notas);
  wsNotas['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsNotas, 'Como ler');

  XLSX.writeFile(wb, filename);
}
