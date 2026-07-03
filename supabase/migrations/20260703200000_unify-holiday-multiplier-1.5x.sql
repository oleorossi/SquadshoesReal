-- ============================================================================
-- AUDITORIA RH 2026-07-03 — unifica multiplicador de feriado em 1,5×
--
-- Decisão do usuário: feriado trabalhado = 1,5× (igual à hora extra comum).
-- A folha (salaryPayroll/splitDayMinutes) SEMPRE pagou feriado a 1,5× flat —
-- ela nem lê work_schedules.holiday_multiplier. Já o espelho/calendário e o
-- OverviewTab liam holiday_multiplier (2.0 em 16 das 17 escalas) e EXIBIAM o
-- custo de feriado a 2×, divergindo do que a folha realmente paga.
--
-- Este fix alinha o dado ao que é pago: zera a divergência display×pagamento.
-- NÃO altera nenhum valor de folha (a folha continua 1,5×). Ver
-- docs/AUDITORIA_RH_COMPATIBILIDADE.md (item B4).
-- ============================================================================

UPDATE public.work_schedules
   SET holiday_multiplier = 1.5, updated_at = now()
 WHERE holiday_multiplier IS DISTINCT FROM 1.5;

ALTER TABLE public.work_schedules
  ALTER COLUMN holiday_multiplier SET DEFAULT 1.5;
