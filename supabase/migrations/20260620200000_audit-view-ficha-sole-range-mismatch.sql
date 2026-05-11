-- View que aponta fichas onde o range declarado (ficha.sizes) não coincide
-- com o range cadastrado no solado vinculado (products.stock_grade._size_from/to).
-- Útil pra alertas no PV ("a ficha vende 34-40 mas o solado só tem 35-38")
-- e pra auditoria periódica no Centro de Controle.
--
-- Decisão de produto (2026-05): a UI do PV prioriza ficha.sizes sobre o
-- range do solado. Esta view só denuncia inconsistências pra alguém
-- corrigir manualmente (geralmente cadastrar o range do solado direito).

CREATE OR REPLACE VIEW public.v_ficha_sole_range_mismatch AS
WITH parsed AS (
  SELECT
    ts.id AS sheet_id,
    ts.name AS sheet_name,
    ts.code AS sheet_code,
    ts.sizes AS ficha_sizes,
    ts.sole_group_id,
    pg.name AS sole_group_name,
    sol.id AS sole_product_id,
    sol.name AS sole_product_name,
    (sol.stock_grade->>'_size_from')::int AS sole_from,
    (sol.stock_grade->>'_size_to')::int AS sole_to,
    CASE WHEN ts.sizes ~ '^\d+-\d+$' THEN
      SPLIT_PART(ts.sizes,'-',1)::int END AS ficha_from,
    CASE WHEN ts.sizes ~ '^\d+-\d+$' THEN
      SPLIT_PART(ts.sizes,'-',2)::int END AS ficha_to
  FROM public.technical_sheets ts
  LEFT JOIN public.product_groups pg ON pg.id = ts.sole_group_id
  LEFT JOIN LATERAL (
    SELECT id, name, stock_grade
      FROM public.products
     WHERE group_id = ts.sole_group_id
       AND category = 'Solado'
     LIMIT 1
  ) sol ON true
  WHERE ts.sole_group_id IS NOT NULL
)
SELECT
  sheet_id,
  sheet_code,
  sheet_name,
  ficha_sizes,
  sole_product_name,
  sole_from,
  sole_to,
  ficha_from,
  ficha_to,
  CASE
    WHEN sole_from IS NULL OR sole_to IS NULL THEN 'solado_sem_range'
    WHEN ficha_from IS NULL OR ficha_to IS NULL THEN 'ficha_sem_range'
    WHEN ficha_from < sole_from OR ficha_to > sole_to THEN 'solado_incompleto'
    WHEN ficha_from > sole_from OR ficha_to < sole_to THEN 'ficha_subutilizada'
    ELSE 'aligned'
  END AS status,
  CASE
    WHEN sole_from IS NOT NULL AND ficha_from < sole_from THEN sole_from - ficha_from
    ELSE 0
  END
  + CASE
      WHEN sole_to IS NOT NULL AND ficha_to > sole_to THEN ficha_to - sole_to
      ELSE 0
    END AS sizes_sem_solado
  FROM parsed
 WHERE sole_from IS NULL OR sole_to IS NULL
    OR ficha_from < sole_from OR ficha_to > sole_to
    OR ficha_from > sole_from OR ficha_to < sole_to;

ALTER VIEW public.v_ficha_sole_range_mismatch SET (security_invoker = true);

COMMENT ON VIEW public.v_ficha_sole_range_mismatch IS
  'Aponta fichas técnicas onde ficha.sizes não bate com o range do solado vinculado. '
  'Frontend (PV) prioriza ficha.sizes — esta view é só pra auditoria/alertas.';

GRANT SELECT ON public.v_ficha_sole_range_mismatch TO authenticated;
