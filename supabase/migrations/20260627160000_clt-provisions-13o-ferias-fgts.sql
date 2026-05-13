-- =============================================================================
-- Provisões CLT: 13º salário, Férias + 1/3, FGTS 8%
-- =============================================================================
-- Gap industrial P0 (conformidade legal): a folha mensal calcula só salário +
-- HE + descontos. Provisões legais obrigatórias (13º, férias com adicional
-- de 1/3, FGTS 8%) não eram calculadas, gerando passivo trabalhista oculto.
--
-- Este módulo introduz:
--   1. Views v_employee_13o_provision: provisão mensal de 13º por funcionário
--      (1/12 do salário/mês desde admissão ou janeiro, o que for mais recente).
--   2. v_employee_vacation_balance: saldo de férias (dias adquiridos − usados)
--      + provisão financeira (salário/30 × dias × 4/3 — 1/3 constitucional).
--   3. v_employee_fgts_provision: 8% sobre proventos brutos do mês (salário +
--      HE + adic.noturno + DSR). Patrão deposita em conta vinculada CEF.
--   4. v_clt_provisions_summary: agrega tudo por empresa pra dashboard mensal.
--
-- IMPORTANTE: estas são VIEWS (calculadas em tempo real). NÃO grava transação
-- contábil — a empresa decide quando fazer o lançamento de provisão. Painel
-- RH exibe e operador pode lançar manualmente em financial_entries.
-- =============================================================================

-- ─── 1. View v_employee_13o_provision (provisão de 13º) ─────────────────────
CREATE OR REPLACE VIEW public.v_employee_13o_provision AS
WITH params AS (
  SELECT
    EXTRACT(YEAR FROM CURRENT_DATE)::int AS current_year,
    EXTRACT(MONTH FROM CURRENT_DATE)::int AS current_month,
    DATE(EXTRACT(YEAR FROM CURRENT_DATE) || '-01-01') AS year_start,
    CURRENT_DATE AS today
)
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.salary,
  e.admission_date,
  GREATEST(e.admission_date, params.year_start) AS counting_since,
  -- Meses trabalhados no ano corrente (≥ 15 dias no mês conta como mês cheio
  -- conforme CLT art. 1° lei 4.090/62). Aproximação: count(meses).
  GREATEST(
    0,
    EXTRACT(YEAR FROM AGE(params.today, GREATEST(e.admission_date, params.year_start)))::int * 12
    + EXTRACT(MONTH FROM AGE(params.today, GREATEST(e.admission_date, params.year_start)))::int
    + 1  -- +1 pra contar o mês atual (parcial)
  ) AS months_counted,
  -- Provisão acumulada (avos): salário × meses/12
  ROUND(
    e.salary * LEAST(12, GREATEST(0,
      EXTRACT(YEAR FROM AGE(params.today, GREATEST(e.admission_date, params.year_start)))::int * 12
      + EXTRACT(MONTH FROM AGE(params.today, GREATEST(e.admission_date, params.year_start)))::int
      + 1
    )) / 12.0, 2
  ) AS provisao_acumulada,
  -- Provisão deste mês (1/12 do salário, ou proporcional ao mês de admissão)
  CASE
    WHEN e.admission_date > DATE(params.current_year || '-' || LPAD(params.current_month::text, 2, '0') || '-01')
      THEN ROUND(e.salary * (
        ((DATE(params.current_year || '-' || LPAD(params.current_month::text, 2, '0') || '-01') + INTERVAL '1 month' - INTERVAL '1 day')::date - e.admission_date)
        / 30.0
      ) / 12.0, 2)
    ELSE ROUND(e.salary / 12.0, 2)
  END AS provisao_mes_atual,
  params.current_year,
  params.current_month
FROM public.employees e, params
WHERE e.active = true;

GRANT SELECT ON public.v_employee_13o_provision TO authenticated;

COMMENT ON VIEW public.v_employee_13o_provision IS
  'Provisão de 13º salário por funcionário. provisao_acumulada = salário × '
  'meses_trabalhados_no_ano / 12. Pagamento legal: 1ª parcela até 30/nov, '
  '2ª até 20/dez. Operador deve lançar provisão mensal em financial_entries '
  '(reference_type=payroll_13o_provision).';


-- ─── 2. View v_employee_vacation_balance (férias + 1/3) ─────────────────────
-- Pressuposto: 30 dias de férias por ano completo. Período aquisitivo de 12
-- meses começando na admissão. Para simplificar, usamos anos completos.
CREATE OR REPLACE VIEW public.v_employee_vacation_balance AS
WITH params AS (SELECT CURRENT_DATE AS today)
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.salary,
  e.admission_date,
  -- Períodos aquisitivos completos (anos completos desde admissão)
  EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int AS periodos_completos,
  -- Dias adquiridos = períodos completos × 30
  EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int * 30 AS dias_adquiridos,
  -- Provisão por período em curso: meses_corridos / 12 × 30 dias
  ROUND(
    (EXTRACT(MONTH FROM AGE(params.today, e.admission_date))::int / 12.0) * 30, 2
  ) AS dias_em_curso,
  -- Valor monetário das férias adquiridas: (salário/30 × 30 dias) × 4/3 (1/3 constitucional)
  ROUND(
    e.salary * EXTRACT(YEAR FROM AGE(params.today, e.admission_date))::int * (4.0/3.0), 2
  ) AS valor_ferias_adquiridas,
  -- Total de provisão (adquiridas + em curso)
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
  'admissão. Cada período aquisitivo dá 30 dias de férias (sem absences > 32 '
  '— simplificado). valor_ferias = salário × períodos × 4/3 (1/3 constitucional). '
  'Não considera ainda histórico de férias gozadas — operador deve abater '
  'manualmente no painel RH.';


-- ─── 3. View v_employee_fgts_provision (8% mensal) ──────────────────────────
-- FGTS = 8% sobre proventos brutos do mês. Schema atual de payroll_runs tem
-- base_salary + overtime_amount apenas (não há colunas separadas pra adic.
-- noturno/DSR). Quando essas colunas forem adicionadas, recriar a view.
CREATE OR REPLACE VIEW public.v_employee_fgts_provision AS
SELECT
  pr.employee_id,
  e.name AS employee_name,
  pr.period,
  pr.base_salary,
  pr.overtime_amount,
  ROUND((pr.base_salary + COALESCE(pr.overtime_amount, 0)), 2) AS fgts_base,
  ROUND((pr.base_salary + COALESCE(pr.overtime_amount, 0)) * 0.08, 2) AS fgts_valor,
  pr.status AS payroll_status
FROM public.payroll_runs pr
JOIN public.employees e ON e.id = pr.employee_id
WHERE pr.status IN ('aprovado', 'pago');

GRANT SELECT ON public.v_employee_fgts_provision TO authenticated;

COMMENT ON VIEW public.v_employee_fgts_provision IS
  'Provisão FGTS 8% sobre proventos do mês. Base = base_salary + overtime_amount '
  'do payroll_runs. Patrão deposita em conta vinculada CEF até dia 7 do mês '
  'seguinte. Operador deve lançar em financial_entries (reference_type=payroll_fgts).';


-- ─── 4. View v_clt_provisions_summary (agregado por mês) ────────────────────
CREATE OR REPLACE VIEW public.v_clt_provisions_summary AS
SELECT
  (SELECT to_char(CURRENT_DATE, 'YYYY-MM')) AS period,
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
  'de todos os funcionários ativos. Use para fechamento mensal contábil — '
  'estes valores devem virar lançamentos em financial_entries categorizados '
  'como "provisão" (não confundir com pagamentos efetivos).';
