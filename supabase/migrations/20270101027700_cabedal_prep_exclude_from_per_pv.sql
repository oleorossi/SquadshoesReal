-- Exclui SKUs de cabedal do canal per_pv quando já há demanda de preparação.
-- Patch incremental via pg_get_functiondef (não reescreve o corpo inteiro —
-- preserva patches 11100/24700/26000 já aplicados no banco).

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.process_sale_order_purchase_shortages(uuid)'::regprocedure
  );

  IF position('cabedal_prep_material_product_ids' IN v_def) > 0 THEN
    RAISE NOTICE 'process_sale_order_purchase_shortages já exclui SKUs de cabedal_prep';
    RETURN;
  END IF;

  -- Forma atual (pós-compute_materials ou compute_per_pv): injeta NOT IN
  -- logo após o filtro de shortage > 0 no CTE de necessidades.
  v_old := 'WHERE COALESCE(need.shortage, 0) > 0';
  v_new :=
    'WHERE COALESCE(need.shortage, 0) > 0' || E'\n' ||
    '         AND (' || E'\n' ||
    '           NOT EXISTS (' || E'\n' ||
    '             SELECT 1 FROM public.cabedal_prep_demands d' || E'\n' ||
    '              WHERE d.sale_order_id = p_sale_order_id' || E'\n' ||
    '                AND d.status <> ''cancelled''' || E'\n' ||
    '           )' || E'\n' ||
    '           OR need.material_id NOT IN (' || E'\n' ||
    '             SELECT c.product_id' || E'\n' ||
    '               FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c' || E'\n' ||
    '           )' || E'\n' ||
    '         )';

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Não achei o filtro shortage>0 em process_sale_order_purchase_shortages — revisar patch cabedal_prep';
  END IF;

  -- Só a primeira ocorrência do filtro no CTE principal de material_rows /
  -- valid needs (evita mexer em subconsultas auxiliares se houverem iguais).
  v_def := overlay(
    v_def
    placing v_new
    from position(v_old IN v_def)
    for length(v_old)
  );

  EXECUTE v_def;
END;
$patch$;
