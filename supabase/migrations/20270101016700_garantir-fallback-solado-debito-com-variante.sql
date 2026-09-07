-- Garante o fallback ficha/cor em debit_sole_stock_by_grade mesmo com variante.
--
-- Contexto (P0.1):
--   20270101002000 passou a exigir `v_variant_id IS NULL` para cair em
--   resolve_sole_color. Variante sem solado pinado saía sem movimento/reserva.
--   20270101008000 reverteu o gate via patch no corpo vivo.
--
-- Por que outra migration:
--   08000 é idempotente só se o corpo vivo ainda tiver o texto EXATO do bug.
--   Se o patch nunca registrou / o corpo foi reescrito com outra formatação /
--   o gate ruim voltou por cópia, o furo reaparece sem alarme. Esta migration
--   reafirma o contrato e falha alto se o corpo não for reconhecível.
--
-- Contrato final (igual ao pré-02000 / pós-08000):
--   pin de variante VENCE; ausência de pin NÃO desliga a cascata da ficha.
--   Gate correto: IF v_resolved_product_id IS NULL THEN → resolve_sole_color
--
-- Timestamp DEPOIS de 20270101016600.

DO $patch_debit_fallback$
DECLARE
  v_definition text;
  v_bad  text := E'IF v_variant_id IS NULL AND v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id';
  v_good text := E'IF v_resolved_product_id IS NULL THEN\n    SELECT rsc.sole_product_id';
BEGIN
  SELECT pg_get_functiondef(
    'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure
  ) INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION
      'debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean) não encontrada';
  END IF;

  -- Já correto: nada a fazer.
  IF position(v_bad IN v_definition) = 0
     AND position(v_good IN v_definition) > 0 THEN
    RAISE NOTICE
      'debit_sole_stock_by_grade já usa fallback ficha/cor com variante; ok.';
    RETURN;
  END IF;

  -- Bug presente: reverte o gate.
  IF position(v_bad IN v_definition) > 0 THEN
    v_definition := replace(v_definition, v_bad, v_good);
    EXECUTE v_definition;

    -- Confirma pós-patch (não aceita no-op silencioso).
    SELECT pg_get_functiondef(
      'public.debit_sole_stock_by_grade(uuid,uuid,text,jsonb,boolean)'::regprocedure
    ) INTO v_definition;

    IF position(v_bad IN v_definition) > 0
       OR position(v_good IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Patch do fallback de solado não aderiu ao corpo vivo de debit_sole_stock_by_grade';
    END IF;

    RAISE NOTICE
      'debit_sole_stock_by_grade: fallback ficha/cor restaurado (variante não bloqueia cascata).';
    RETURN;
  END IF;

  RAISE EXCEPTION
    'Contrato inesperado em debit_sole_stock_by_grade: nem gate antigo nem fallback ficha/cor encontrados';
END;
$patch_debit_fallback$;
