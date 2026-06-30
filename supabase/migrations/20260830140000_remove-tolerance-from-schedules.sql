-- Remove a tolerância de ponto das escalas (pedido do dono 2026-06-30).
-- Antes: work_schedules.tolerance_minutes = 10 (zerava o dia quando |trabalhado −
-- esperado| <= 10min). Agora atraso/hora extra contam a partir do 1º minuto.
-- O motor da FOLHA (computePeriodFolha) e os chips do PONTO (useTimesheet) já
-- foram fixados em 0 no frontend; aqui zeramos a coluna pros caminhos SQL
-- (calculate_employee_bank_balance / calculate_weekly_he_breakdown, que passam
-- p_tolerance_min da escala pra calculate_day_summary). O p_minimum_overtime é
-- regra SEPARADA (mínimo de HE) e NÃO é alterado aqui.
-- Aplicada via Supabase MCP em 2026-06-30 (idempotente).
ALTER TABLE public.work_schedules ALTER COLUMN tolerance_minutes SET DEFAULT 0;
UPDATE public.work_schedules SET tolerance_minutes = 0 WHERE COALESCE(tolerance_minutes, 0) <> 0;
