-- =============================================================================
-- PR 1 + PR 2 + PR 3 — Fixes da auditoria forense do banco de horas
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-24.
-- Detalhes técnicos: pg_get_functiondef('calculate_employee_bank_balance').
--
-- PR 1 — Dias parciais somam expected
-- -----------------------------------
-- Antes: status IN ('partial','inconsistent','irregular') incrementava
-- days_partial mas NÃO somava nem worked nem expected na semana.
-- Resultado: 68.040 min (1.134h) invisíveis no cálculo.
--
-- Agora: parcial SOMA expected_min (não worked, que é não-confiável).
-- Cria débito visível até RH completar batidas via /rh/pendencias-ponto.
--
-- PR 2 — Tabela employee_absences (pré-existia, vazia)
-- ----------------------------------------------------
-- Schema legacy reutilizado: start_date/end_date como text, absence_type,
-- justified bool. Helper is_employee_absent_on(emp, date) checa cobertura.
-- Dias dentro de absence justified=true ficam ISENTOS do cálculo (não
-- viram débito automático, não entram em expected).
--
-- PR 3 — Dia útil sem time_record = falta automática
-- --------------------------------------------------
-- Antes: FOR só iterava time_records existentes — dias sem registro
-- ficavam invisíveis (Jaqueline tinha 26 dias úteis fantasma).
--
-- Agora: generate_series gera todos os dias do período + LEFT JOIN com
-- time_records. Dia útil sem registro vira days_missing e soma expected
-- (vira débito de ~9h por dia faltado).
--
-- Resultado real após fixes:
--   Daiane: -24h → -222h (20 dias parciais visíveis)
--   Catia:    ?  → -164h (15 dias sem registro visíveis)
--   Jaqueline: ?→ -234h (26 dias sem registro = férias não cadastradas)
--
-- Reversão: completar batidas em /rh/pendencias-ponto melhora parciais;
-- cadastrar ausência em /rh/ausencias isenta dias missing/absent
-- legítimos (férias, atestado, licença).
-- =============================================================================

-- (Schema da tabela employee_absences já existia. Função de lookup nova.)
CREATE OR REPLACE FUNCTION public.is_employee_absent_on(p_employee_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM public.employee_absences a
     WHERE a.employee_id = p_employee_id
       AND COALESCE(a.justified, true) = true
       AND a.start_date IS NOT NULL AND a.end_date IS NOT NULL
       AND a.start_date <> '' AND a.end_date <> ''
       AND p_date BETWEEN
             NULLIF(a.start_date, '')::date AND
             NULLIF(a.end_date, '')::date
  );
$fn$;

-- calculate_employee_bank_balance v4 — ver pg_get_functiondef no DB
-- Label da apuração: 'semanal_individual_schedule_v4_cutoff_pr1_pr3'
-- Novos campos no JSON: days_absent, days_missing, days_excused, effective_to
