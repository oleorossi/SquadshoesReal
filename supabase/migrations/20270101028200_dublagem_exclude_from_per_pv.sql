-- Exclui SKU acabado do canal per_pv quando o item tem dublagem_mode.
-- Patch incremental via pg_get_functiondef (mesmo padrão de cabedal_prep).

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.process_sale_order_purchase_shortages(uuid)'::regprocedure
  );

  IF position('dublagem_finished_product_ids' IN v_def) > 0 THEN
    RAISE NOTICE 'process_sale_order_purchase_shortages já exclui acabados de dublagem';
    RETURN;
  END IF;

  -- Preferir encaixar depois do filtro cabedal_prep se existir; senão no shortage>0.
  IF position('cabedal_prep_material_product_ids' IN v_def) > 0 THEN
    v_old :=
      'OR need.material_id NOT IN (' || E'\n' ||
      '             SELECT c.product_id' || E'\n' ||
      '               FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c' || E'\n' ||
      '           )' || E'\n' ||
      '         )';
    v_new :=
      'OR need.material_id NOT IN (' || E'\n' ||
      '             SELECT c.product_id' || E'\n' ||
      '               FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c' || E'\n' ||
      '           )' || E'\n' ||
      '         )' || E'\n' ||
      '         AND need.material_id NOT IN (' || E'\n' ||
      '           SELECT f.product_id' || E'\n' ||
      '             FROM public.dublagem_finished_product_ids(p_sale_order_id) f' || E'\n' ||
      '         )';
  ELSE
    v_old := 'WHERE COALESCE(need.shortage, 0) > 0';
    v_new :=
      'WHERE COALESCE(need.shortage, 0) > 0' || E'\n' ||
      '         AND need.material_id NOT IN (' || E'\n' ||
      '           SELECT f.product_id' || E'\n' ||
      '             FROM public.dublagem_finished_product_ids(p_sale_order_id) f' || E'\n' ||
      '         )';
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Não achei âncora pra excluir acabados de dublagem em process_sale_order_purchase_shortages';
  END IF;

  v_def := overlay(
    v_def
    placing v_new
    from position(v_old IN v_def)
    for length(v_old)
  );

  EXECUTE v_def;
END;
$patch$;
