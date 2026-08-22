-- Restaura o fallback ficha/cor em debit_sole_stock_by_grade.
--
-- 20270101002000 passou a exigir `v_variant_id IS NULL` para cair em
-- resolve_sole_color. Variante sem solado pinado (68/68 ativas em 20/08/2026)
-- saía da função sem movimento nem reserva — furo de estoque silencioso.
-- O pin de variante continua tendo prioridade; só o gate "tem variante ⇒
-- nunca olha a ficha" é revertido.
--
-- Timestamp DEPOIS de 20270101007200. Não usar 20260822*.

DO $patch_debit$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure
  ) INTO v_definition;

  IF position(
    E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
    IN v_definition
  ) = 0 THEN
    IF position(
      E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
      IN v_definition
    ) > 0 THEN
      RAISE NOTICE 'debit_sole_stock_by_grade já usa fallback de ficha/cor; nada a fazer.';
      RETURN;
    END IF;
    RAISE EXCEPTION
      'Contrato inesperado em debit_sole_stock_by_grade: gate de variante não encontrado';
  END IF;

  v_definition := replace(
    v_definition,
    E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id',
    E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id'
  );
  EXECUTE v_definition;
END;
$patch_debit$;
