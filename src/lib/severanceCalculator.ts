/**
 * Calculadora de indenização (rescisão sem justa causa CLT).
 *
 * Cálculo on-demand pra simular custo da demissão. Não é usado em nenhum
 * relatório/dashboard — só aparece quando operador preenche o campo
 * termination_date no cadastro do funcionário (pedido user 18/05/2026:
 * "deixe como está mas eu quero visualizar o valor caso eu mande um
 * funcionário embora qual seria o valor da indenização").
 *
 * Fórmulas seguem CLT padrão (rescisão sem justa causa). Estimativas:
 * - Saldo do FGTS é estimado em 8% × salário × meses trabalhados
 *   (não consulta o saldo real na Caixa — operador deve confirmar)
 * - Férias vencidas assume que NÃO foram gozadas (rigor exigiria histórico)
 *
 * Operador deve usar esses valores como REFERÊNCIA, não como cálculo
 * oficial — contabilidade ainda precisa fazer o cálculo formal.
 */

export interface SeveranceBreakdown {
  saldoSalario: number;
  decimoTerceiroProporcional: number;
  feriasVencidas: number;
  feriasProporcionais: number;
  avisoPrevioIndenizado: number;
  multaFgts: number;
  total: number;
  // Metadados pra UI
  diasMesDemissao: number;
  mesesAnoAtual: number;
  mesesAquisitivoAtual: number;
  diasAviso: number;
  anosCompletos: number;
  mesesTrabalhadosTotal: number;
  fgtsDepositadoEstimado: number;
}

function monthsBetween(start: Date, end: Date): number {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  // Regra CLT: se passar do dia da admissão no mês de saída, conta como mês completo
  if (end.getDate() >= start.getDate()) months += 1;
  return Math.max(0, months);
}

export function calculateSeverance(params: {
  salary: number;
  admissionDate: string; // YYYY-MM-DD
  terminationDate: string; // YYYY-MM-DD
}): SeveranceBreakdown | null {
  const { salary, admissionDate, terminationDate } = params;
  if (!salary || salary <= 0 || !admissionDate || !terminationDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(admissionDate) || !/^\d{4}-\d{2}-\d{2}$/.test(terminationDate)) return null;

  const admission = new Date(admissionDate + 'T12:00:00');
  const termination = new Date(terminationDate + 'T12:00:00');
  if (termination < admission) return null;

  // 1. SALDO DE SALÁRIO
  // Dias trabalhados no mês da demissão / 30 × salário
  const diasMesDemissao = termination.getDate();
  const saldoSalario = (salary / 30) * diasMesDemissao;

  // 2. 13º PROPORCIONAL
  // Meses trabalhados no ANO da demissão / 12 × salário
  // Regra CLT: dia >= 15 do mês conta como mês completo
  const mesAdmAno = (admission.getFullYear() === termination.getFullYear())
    ? admission.getMonth() + 1
    : 1;
  let mesesAnoAtual = termination.getMonth() + 1 - mesAdmAno + 1;
  if (termination.getDate() < 15) mesesAnoAtual = Math.max(0, mesesAnoAtual - 1);
  mesesAnoAtual = Math.max(0, Math.min(12, mesesAnoAtual));
  const decimoTerceiroProporcional = (salary / 12) * mesesAnoAtual;

  // 3. FÉRIAS VENCIDAS
  // Período aquisitivo = 12 meses desde a admissão. Cada aniversário sem
  // gozar gera férias vencidas. Simplificação: assume que NUNCA foram gozadas
  // (cálculo conservador — alguém pode ter tirado, operador desconta manual).
  const mesesTotal = monthsBetween(admission, termination);
  const anosCompletos = Math.floor(mesesTotal / 12);
  const feriasVencidasBase = anosCompletos >= 1 ? salary : 0;
  const feriasVencidas = feriasVencidasBase + feriasVencidasBase / 3; // 1/3 constitucional

  // 4. FÉRIAS PROPORCIONAIS
  // Meses do período aquisitivo CURRENT (após último aniversário) / 12 × salário + 1/3
  const mesesAquisitivoAtual = mesesTotal % 12;
  const feriasProporcionaisBase = (salary / 12) * mesesAquisitivoAtual;
  const feriasProporcionais = feriasProporcionaisBase + feriasProporcionaisBase / 3;

  // 5. AVISO PRÉVIO INDENIZADO
  // CLT: 30 dias base + 3 dias por ANO completo trabalhado (cap 90 dias)
  const diasAviso = Math.min(30 + 3 * anosCompletos, 90);
  const avisoPrevioIndenizado = (salary / 30) * diasAviso;

  // 6. MULTA 40% FGTS
  // FGTS depositado ≈ 8% × salário × meses trabalhados. Multa = 40% disso.
  // ESTIMATIVA — saldo real precisa ser consultado na Caixa.
  const fgtsDepositadoEstimado = salary * 0.08 * mesesTotal;
  const multaFgts = fgtsDepositadoEstimado * 0.4;

  const total = saldoSalario + decimoTerceiroProporcional + feriasVencidas
              + feriasProporcionais + avisoPrevioIndenizado + multaFgts;

  return {
    saldoSalario,
    decimoTerceiroProporcional,
    feriasVencidas,
    feriasProporcionais,
    avisoPrevioIndenizado,
    multaFgts,
    total,
    diasMesDemissao,
    mesesAnoAtual,
    mesesAquisitivoAtual,
    diasAviso,
    anosCompletos,
    mesesTrabalhadosTotal: mesesTotal,
    fgtsDepositadoEstimado,
  };
}
