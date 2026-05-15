-- =============================================================================
-- Fix das views de provisões CLT que faltaram aplicar
-- =============================================================================
-- A migration original 20260627160000_clt-provisions-13o-ferias-fgts.sql
-- referenciava a tabela `payroll_runs` que NÃO existe no schema — a tabela
-- real chama `employee_payroll` e a coluna do período é `period_date` (text),
-- não `period`. Por isso só `v_employee_13o_provision` foi criada e as outras
-- 3 views silenciosamente quebraram, deixando o painel RH com erro
-- "Could not find the table 'public.v_clt_provisions_summary'".
--
-- Esta migration aplica as 3 views faltantes adaptadas pro schema real:
--   - v_employee_vacation_balance   (não dependia de payroll_runs)
--   - v_employee_fgts_provision     (employee_payroll + period_date)
--   - v_clt_provisions_summary      (agrega tudo)
--
-- Aplicada via MCP em 2026-05-15.
-- =============================================================================

-- ─── 2. View v_employee_vacation_balance (férias + 1/3) ───
CREATE OR REPLACE VIEW public.v_employee_vacation_balance AS
WITH params AS (SELECT CURRENT_DATE AS today)
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.salary,
  e.admission_date,
  EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int AS periodos_completos,
  EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int * 30 AS dias_adquiridos,
  ROUND(
    (EXTRACT(MONTH FROM AGE(params.today, e.admission_date))::int / 12.0) * 30, 2
  ) AS dias_em_curso,
  ROUND(
    e.salary * EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int * (4.0/3.0), 2
  ) AS valor_ferias_adquiridas,
  ROUND(
    e.salary * (
      EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int
      + EXTRACT(MONTH FROM AGE(params.today, e.admission_date))::int / 12.0
    ) * (4.0/3.0), 2
  ) AS provisao_total
FROM public.employees e, params
WHERE e.active = true;

GRANT SELECT ON public.v_employee_vacation_balance TO authenticated;

COMMENT ON VIEW public.v_employee_vacation_balance IS
  'Saldo de férias por funcionário. periodos_completos = anos cheios desde '
  'admissão. valor_ferias = salário × períodos × 4/3 (1/3 constitucional).';

-- ─── 3. View v_employee_fgts_provision (8% mensal) ───
-- ADAPTADA: usa employee_payroll (não payroll_runs) e period_date (não period).
CREATE OR REPLACE VIEW public.v_employee_fgts_provision AS
SELECT
  ep.employee_id,
  e.name AS employee_name,
  ep.period_date AS period,
  ep.base_salary,
  ep.overtime_amount,
  ROUND((ep.base_salary + COALESCE(ep.overtime_amount, 0)), 2) AS fgts_base,
  ROUND((ep.base_salary + COALESCE(ep.overtime_amount, 0)) * 0.08, 2) AS fgts_valor,
  ep.status AS payroll_status
FROM public.employee_payroll ep
JOIN public.employees e ON e.id = ep.employee_id
WHERE ep.status IN ('aprovado', 'pago');

GRANT SELECT ON public.v_employee_fgts_provision TO authenticated;

COMMENT ON VIEW public.v_employee_fgts_provision IS
  'Provisão FGTS 8% sobre proventos do mês. Base = base_salary + overtime_amount '
  'do employee_payroll (status aprovado/pago).';

-- ─── 4. View v_clt_provisions_summary (agregado por mês) ───
CREATE OR REPLACE VIEW public.v_clt_provisions_summary AS
SELECT
  to_char(CURRENT_DATE, 'YYYY-MM') AS period,
  (SELECT COUNT(*) FROM public.employees WHERE active = true) AS active_employees,
  COALESCE((SELECT SUM(provisao_mes_atual) FROM public.v_employee_13o_provision), 0) AS provisao_13o_mes_atual,
  COALESCE((SELECT SUM(provisao_acumulada) FROM public.v_employee_13o_provision), 0) AS provisao_13o_acumulada,
  COALESCE((SELECT SUM(provisao_total) FROM public.v_employee_vacation_balance), 0) AS provisao_ferias_total,
  COALESCE((SELECT SUM(fgts_valor) FROM public.v_employee_fgts_provision
            WHERE period = to_char(CURRENT_DATE, 'YYYY-MM')), 0) AS fgts_mes_atual,
  COALESCE((SELECT SUM(fgts_valor) FROM public.v_employee_fgts_provision
            WHERE period LIKE to_char(CURRENT_DATE, 'YYYY') || '%'), 0) AS fgts_ano_atual;

GRANT SELECT ON public.v_clt_provisions_summary TO authenticated;

COMMENT ON VIEW public.v_clt_provisions_summary IS
  'Dashboard de provisões CLT no período corrente. Soma 13º, férias e FGTS '
  'de todos os funcionários ativos.';
