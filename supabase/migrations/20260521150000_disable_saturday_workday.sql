-- Decisão da gestão (2026-05-21): nenhum funcionário trabalha sábado.
-- 44h semanais = 5 dias úteis × 8h48 (08:00-12:00 + 13:00-17:48).
-- Qualquer batida de ponto no sábado vira HE 50% automaticamente:
--   - get_employee_expected_minutes retorna 0 (works_saturday=false)
--   - calculate_employee_bank_balance acumula minutos trabalhados no
--     v_week_worked sem aumentar v_week_expected
--   - Excedente semanal vira HE 50% (v_timesheet_50)
-- Domingo/feriado continua HE 100% (regra inalterada).
--
-- Aplicada em ssvxfoybzmjlypnipqzn via MCP em 2026-05-21.
-- Afeta os 16 schedules existentes (default + 15 individuais já backfilled).

UPDATE public.work_schedules
SET
  works_saturday = false,
  saturday_entry = NULL,
  saturday_exit  = NULL,
  updated_at     = now()
WHERE works_saturday = true
   OR saturday_entry IS NOT NULL
   OR saturday_exit  IS NOT NULL;
