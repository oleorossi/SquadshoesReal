/**
 * Punch Clock — core do plano de migração do sistema de ponto eletrônico
 * (Planejamento_Migracao_Sistema_Ponto.docx, 2026-05).
 *
 * Stack camadeada:
 *   1. timeClockParser.ts (legado, em src/lib/) — lê AGL_xxx.TXT UTF-16 LE
 *   2. dayCalculator (aqui)                     — aplica regras CLT por dia
 *   3. weeklyAggregator (aqui)                  — agrupa em semanas + saldo
 *   4. UI Espelho/Exceções (src/components/timesheet/, src/pages/RH/) — consome
 *
 * Próximos passos (não nesta camada):
 *   - Gerador AFD (Portaria MTP 671/2021) — registro tipo 3, 200 bytes/linha
 *   - UI dedicada de exceções com ajuste manual e trilha de auditoria
 */

export {
  calculateDay,
  timeToMinutes,
  minutesToHhMm,
  type DayCalculatorParams,
  type DayCalculatorResult,
  type DayStatus,
} from './dayCalculator';

export {
  aggregateByWeek,
  type WeeklyAggregatorParams,
  type WeeklySummary,
  type DayWithDate,
} from './weeklyAggregator';
