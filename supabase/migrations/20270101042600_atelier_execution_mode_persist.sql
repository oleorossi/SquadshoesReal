-- Persiste sale_order_items.atelier_execution_mode a partir do payload create/update.
-- Espelha sync_sale_order_items_dublagem_mode (coluna fora do INSERT allow-list).

CREATE OR REPLACE FUNCTION public.sync_sale_order_items_atelier_execution_mode(
  p_sale_order_id uuid,
  p_items jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_id uuid;
  v_mode text;
  v_ord int := 0;
BEGIN
  IF p_sale_order_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_ord := v_ord + 1;
    IF NOT (v_item ? 'atelier_execution_mode') THEN
      CONTINUE;
    END IF;
    v_mode := NULLIF(lower(btrim(COALESCE(v_item->>'atelier_execution_mode', ''))), '');
    IF v_mode IS NOT NULL AND v_mode NOT IN ('internal', 'contractor') THEN
      RAISE EXCEPTION 'atelier_execution_mode inválido: %', v_mode
        USING ERRCODE = '22023';
    END IF;

    v_id := NULLIF(v_item->>'id', '')::uuid;
    IF v_id IS NOT NULL THEN
      UPDATE public.sale_order_items
         SET atelier_execution_mode = v_mode
       WHERE id = v_id
         AND sale_order_id = p_sale_order_id;
    ELSE
      -- Create: casa por ordinalidade (itens novos ainda sem id no payload).
      UPDATE public.sale_order_items soi
         SET atelier_execution_mode = v_mode
        FROM (
          SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
            FROM public.sale_order_items
           WHERE sale_order_id = p_sale_order_id
        ) o
       WHERE soi.id = o.id
         AND o.rn = v_ord;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_sale_order_items_atelier_execution_mode(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_sale_order_items_atelier_execution_mode(uuid, jsonb)
  TO authenticated, service_role;

-- Injeta no writer de create (logo após dublagem sync, se existir).
DO $patch_create$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.create_sale_order_atomic_legacy_202701(jsonb,jsonb,uuid)'::regprocedure
  );
  IF position('sync_sale_order_items_atelier_execution_mode' IN v_def) > 0 THEN
    RAISE NOTICE 'create legacy já sincroniza atelier_execution_mode';
    RETURN;
  END IF;

  IF position('sync_sale_order_items_dublagem_mode' IN v_def) > 0 THEN
    v_old := 'PERFORM public.sync_sale_order_items_dublagem_mode(v_order_id, p_items);';
    IF position(v_old IN v_def) = 0 THEN
      v_old := 'PERFORM public.sync_sale_order_items_dublagem_mode(v_order_id, p_items)';
    END IF;
    IF position(v_old IN v_def) > 0 THEN
      v_new :=
        v_old || E'\n' ||
        '  PERFORM public.sync_sale_order_items_atelier_execution_mode(v_order_id, p_items);';
      v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
      EXECUTE v_def;
      RETURN;
    END IF;
  END IF;

  -- Fallback: antes do RETURN final
  v_old := 'RETURN jsonb_build_object(''order_id'', v_order_id';
  IF position(v_old IN v_def) > 0 THEN
    v_new :=
      'PERFORM public.sync_sale_order_items_atelier_execution_mode(v_order_id, p_items);' || E'\n' ||
      '  ' || v_old;
    v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
    EXECUTE v_def;
  ELSE
    RAISE EXCEPTION 'Não achou âncora pra injetar atelier_execution_mode no create legacy';
  END IF;
END;
$patch_create$;

DO $patch_update$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)'::regprocedure
  );
  IF position('sync_sale_order_items_atelier_execution_mode' IN v_def) > 0 THEN
    RAISE NOTICE 'update legacy já sincroniza atelier_execution_mode';
    RETURN;
  END IF;

  IF position('sync_sale_order_items_dublagem_mode' IN v_def) > 0 THEN
    v_old := 'PERFORM public.sync_sale_order_items_dublagem_mode(p_order_id, p_items);';
    IF position(v_old IN v_def) = 0 THEN
      v_old := 'PERFORM public.sync_sale_order_items_dublagem_mode(p_order_id, p_items)';
    END IF;
    IF position(v_old IN v_def) > 0 THEN
      v_new :=
        v_old || E'\n' ||
        '  PERFORM public.sync_sale_order_items_atelier_execution_mode(p_order_id, p_items);';
      v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
      EXECUTE v_def;
      RETURN;
    END IF;
  END IF;

  IF position('recalc_sale_order_total' IN v_def) > 0 THEN
    v_old := 'v_total := public.recalc_sale_order_total(p_order_id);';
    IF position(v_old IN v_def) > 0 THEN
      v_new :=
        'PERFORM public.sync_sale_order_items_atelier_execution_mode(p_order_id, p_items);' || E'\n' ||
        '  ' || v_old;
      v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
      EXECUTE v_def;
      RETURN;
    END IF;
  END IF;

  RAISE NOTICE 'update legacy: âncora não encontrada — confira manualmente';
END;
$patch_update$;
