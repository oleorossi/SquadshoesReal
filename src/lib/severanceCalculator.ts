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

const MS_DAY = 86_400_000;

/**
 * Meses COMPLETOS decorridos entre duas datas (sem arredondar pra cima). Um mês
 * só conta quando o dia-do-mês foi alcançado. Usado para tempo de serviço /
 * períodos aquisitivos de férias vencidas — antes monthsBetween arredondava o
 * mês parcial pra cima quando o dia passava, pagando férias vencida "faltando 1
 * dia" do período aquisitivo. Auditoria 2026-06-14, Área 7 (🟠).
 */
function completeMonthsBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) m -= 1; // ainda não chegou no dia → mês incompleto
  return Math.max(0, m);
}

/**
 * "Avos" (1/12) acumulados num período pela regra CLT dos 15 dias: conta os
 * meses completos e soma +1 quando a fração final tem ≥ 15 dias. Usado para 13º
 * proporcional e férias proporcionais — naturalmente aplica a regra dos 15 dias
 * ao mês de ADMISSÃO (antes o 13º contava o mês de admissão inteiro mesmo quando
 * admitido depois do dia 15 → superestimava 1 mês). Auditoria 2026-06-14 (🔴).
 */
function proportionalMonths(start: Date, end: Date): number {
  if (end <= start) return 0;
  const m = completeMonthsBetween(start, end);
  const boundary = new Date(start);
  boundary.setMonth(boundary.getMonth() + m);
  const partialDays = Math.floor((end.getTime() - boundary.getTime()) / MS_DAY);
  return m + (partialDays >= 15 ? 1 : 0);
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

  // 1. SALDO DE SALÁRIO — dias trabalhados no mês da demissão / 30 × salário
  //    (usa a data REAL de saída, não a projetada do aviso).
  const diasMesDemissao = termination.getDate();
  const saldoSalario = (salary / 30) * diasMesDemissao;

  // ── Aviso prévio: dias com base nos anos COMPLETOS reais no momento da saída ──
  // CLT: 30 dias + 3 por ano completo (cap 90).
  const mesesTotalReal = completeMonthsBetween(admission, termination);
  const anosCompletosReais = Math.floor(mesesTotalReal / 12);
  const diasAviso = Math.min(30 + 3 * anosCompletosReais, 90);
  const avisoPrevioIndenizado = (salary / 30) * diasAviso;

  // ── Projeção do aviso indenizado (OJ 82 / prática consolidada) ──
  // O aviso indenizado PROJETA a data de saída para frente, e essa data projetada
  // é a base das verbas proporcionais (13º e férias). Antes o cálculo usava a
  // data real → subestimava 13º/férias pelo período do aviso. Auditoria 2026-06-14 (🔴).
  const projectedEnd = new Date(termination.getTime() + diasAviso * MS_DAY);
  const mesesTotal = completeMonthsBetween(admission, projectedEnd);
  const anosCompletos = Math.floor(mesesTotal / 12);

  // 2. 13º PROPORCIONAL — avos no ANO da saída projetada (regra dos 15 dias nos
  //    dois extremos via proportionalMonths). Âncora = admissão (se mesmo ano) ou
  //    1º de janeiro do ano da saída projetada.
  const year13Start = (admission.getFullYear() === projectedEnd.getFullYear())
    ? admission
    : new Date(projectedEnd.getFullYear(), 0, 1, 12, 0, 0);
  const mesesAnoAtual = Math.max(0, Math.min(12, proportionalMonths(year13Start, projectedEnd)));
  const decimoTerceiroProporcional = (salary / 12) * mesesAnoAtual;

  // 3. FÉRIAS VENCIDAS — período aquisitivo COMPLETO (12 meses) não gozado.
  //    Simplificação (mantida): assume 1 período vencido não gozado.
  const feriasVencidasBase = anosCompletos >= 1 ? salary : 0;
  const feriasVencidas = feriasVencidasBase + feriasVencidasBase / 3; // 1/3 constitucional

  // 4. FÉRIAS PROPORCIONAIS — avos do período aquisitivo CORRENTE (após o último
  //    aniversário), regra dos 15 dias, sobre a data projetada.
  const lastAnniversary = new Date(admission);
  lastAnniversary.setFullYear(lastAnniversary.getFullYear() + anosCompletos);
  const mesesAquisitivoAtual = Math.max(0, Math.min(12, proportionalMonths(lastAnniversary, projectedEnd)));
  const feriasProporcionaisBase = (salary / 12) * mesesAquisitivoAtual;
  const feriasProporcionais = feriasProporcionaisBase + feriasProporcionaisBase / 3;

  // 6. MULTA 40% FGTS — FGTS depositado ≈ 8% × salário × meses (projetados).
  //    ESTIMATIVA — saldo real precisa ser consultado na Caixa.
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
