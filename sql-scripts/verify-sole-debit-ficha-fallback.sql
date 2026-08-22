-- Confirma o fallback de ficha/cor em debit_sole_stock_by_grade
-- após 20270101008000.
SELECT
  CASE
    WHEN position(
      E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
      IN def
    ) > 0 THEN 'FALHOU: gate antigo ainda presente'
    WHEN position(
      E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
      IN def
    ) > 0 THEN 'OK: fallback ficha/cor restaurado'
    ELSE 'FALHOU: contrato inesperado'
  END AS status,
  length(def) AS fn_bytes
FROM (
  SELECT pg_get_functiondef(
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure
  ) AS def
) s;
