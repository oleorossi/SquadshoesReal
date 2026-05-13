-- =============================================================================
-- Identificação de operador em order_stages
-- =============================================================================
-- Gap industrial P0: operador finaliza setor sem se identificar. order_stages.
-- completed_by aponta para auth.users (usuário logado no terminal — geralmente
-- gerente). Sem rastreabilidade de QUEM FISICAMENTE fez o trabalho.
--
-- Fix: nova coluna operator_employee_id em order_stages, FK para employees.
-- Frontend SectorStageDialog pede dropdown do operário antes de marcar
-- concluído. localStorage por terminal persiste o último operário escolhido.
--
-- Não substitui completed_by (auth trail de sistema continua válido); apenas
-- adiciona a identificação operacional. Relatórios de produtividade individual
-- e auditoria de qualidade ficam viáveis.
-- =============================================================================

ALTER TABLE public.order_stages
  ADD COLUMN IF NOT EXISTS operator_employee_id uuid
    REFERENCES public.employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.order_stages.operator_employee_id IS
  'Operário (funcionário em employees) que efetivamente executou o setor. '
  'Diferente de completed_by, que aponta para auth.users (usuário do sistema). '
  'Pode ser NULL em OPs antigas; obrigatório a partir de 2026-06 via UI. '
  'Usado em v_operator_productivity e auditoria de qualidade.';

CREATE INDEX IF NOT EXISTS idx_order_stages_operator
  ON public.order_stages (operator_employee_id, stage_name)
  WHERE operator_employee_id IS NOT NULL;

-- ─── View de produtividade individual ───────────────────────────────────────
-- Para relatórios "Quantos pares X processou no setor Y este mês?"
CREATE OR REPLACE VIEW public.v_operator_productivity AS
SELECT
  os.operator_employee_id,
  e.name AS operator_name,
  e.role,
  os.stage_name,
  date_trunc('month', os.completed_at) AS month,
  COUNT(*) AS stages_completed,
  SUM(os.quantity_processed) AS pairs_processed,
  SUM(CASE WHEN os.defects IS NOT NULL AND os.defects <> '' THEN 1 ELSE 0 END) AS stages_with_defects,
  AVG(os.actual_time_minutes) AS avg_actual_time_minutes,
  AVG(os.standard_time_minutes) AS avg_standard_time_minutes,
  -- Eficiência: standard / actual (>1 = mais rápido que esperado)
  CASE
    WHEN AVG(os.actual_time_minutes) > 0
      THEN ROUND(AVG(os.standard_time_minutes) / AVG(os.actual_time_minutes), 2)
    ELSE NULL
  END AS efficiency_ratio
FROM public.order_stages os
JOIN public.employees e ON e.id = os.operator_employee_id
WHERE os.completed_at IS NOT NULL
  AND os.operator_employee_id IS NOT NULL
GROUP BY os.operator_employee_id, e.name, e.role, os.stage_name, date_trunc('month', os.completed_at);

GRANT SELECT ON public.v_operator_productivity TO authenticated;

COMMENT ON VIEW public.v_operator_productivity IS
  'Produtividade por operário/setor/mês. efficiency_ratio = standard/actual; '
  '>1 = mais rápido que padrão, <1 = abaixo. stages_with_defects sinaliza '
  'qualidade. Use pra planejamento de equipe e bonificação.';
