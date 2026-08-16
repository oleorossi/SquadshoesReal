-- Teste transacional da integridade comercial do PV. Nenhuma escrita persiste.
BEGIN;

DO $$
DECLARE
  v_order_id uuid;
  v_reference_id uuid;
  v_other_reference_id uuid;
  v_other_variant_id uuid;
  v_price_list_id uuid;
BEGIN
  SELECT id INTO v_order_id FROM public.sale_orders ORDER BY created_at LIMIT 1;
  SELECT reference_id INTO v_reference_id
  FROM public.reference_material_variants
  WHERE active
  GROUP BY reference_id
  ORDER BY reference_id
  LIMIT 1;

  IF v_order_id IS NOT NULL AND v_reference_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.sale_order_items (
        sale_order_id, reference_id, color, quantity, unit_price, grade, fichas, material_variant_id
      ) VALUES (
        v_order_id, v_reference_id, '__AUDIT__', 1, 1, '{"34":1}'::jsonb, 1, NULL
      );
      RAISE EXCEPTION 'FALHA: item novo sem variante foi aceito';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE 'Selecione a variação de material%' THEN RAISE; END IF;
    END;

    SELECT rmv.reference_id, rmv.id
      INTO v_other_reference_id, v_other_variant_id
    FROM public.reference_material_variants rmv
    WHERE rmv.active AND rmv.reference_id <> v_reference_id
    ORDER BY rmv.reference_id
    LIMIT 1;

    IF v_other_variant_id IS NOT NULL THEN
      BEGIN
        INSERT INTO public.sale_order_items (
          sale_order_id, reference_id, color, quantity, unit_price, grade, fichas, material_variant_id
        ) VALUES (
          v_order_id, v_reference_id, '__AUDIT__', 1, 1, '{"34":1}'::jsonb, 1, v_other_variant_id
        );
        RAISE EXCEPTION 'FALHA: variante de outra referência foi aceita';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE 'A variação de material pertence%' THEN RAISE; END IF;
      END;
    END IF;
  END IF;

  SELECT id INTO v_price_list_id FROM public.price_lists ORDER BY created_at LIMIT 1;
  IF v_price_list_id IS NOT NULL AND v_reference_id IS NOT NULL THEN
    INSERT INTO public.price_list_items (
      price_list_id, reference_id, color, unit_price, min_quantity
    ) VALUES (
      v_price_list_id, v_reference_id, '__AUDIT_UNIQUE__', 1, 987654
    );

    BEGIN
      INSERT INTO public.price_list_items (
        price_list_id, reference_id, color, unit_price, min_quantity
      ) VALUES (
        v_price_list_id, v_reference_id, ' __audit_unique__ ', 2, 987654
      );
      RAISE EXCEPTION 'FALHA: regra comercial duplicada foi aceita';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;

    BEGIN
      INSERT INTO public.price_list_items (
        price_list_id, reference_id, color, unit_price, min_quantity
      ) VALUES (
        v_price_list_id, v_reference_id, '__AUDIT_NEGATIVE__', -1, 987653
      );
      RAISE EXCEPTION 'FALHA: preço negativo foi aceito';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'material_variant_trigger', EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_enforce_sale_order_item_material_variant' AND NOT tgisinternal
  ),
  'price_normalization_trigger', EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_normalize_price_list_rule' AND NOT tgisinternal
  ),
  'price_rule_unique_index', to_regclass('public.uq_price_list_rule_identity') IS NOT NULL,
  'tests', 'passed'
) AS commercial_integrity_test;

ROLLBACK;
