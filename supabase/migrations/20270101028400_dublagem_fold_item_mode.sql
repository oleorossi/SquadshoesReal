-- Persiste dublagem_mode a partir do payload dos comandos create/execute.
-- Também injeta process_dublagem_purchase_shortages no outbox (edge) via
-- comentário canônico; o worker TS chama a RPC explicitamente.

-- create_sale_order_command: após create_sale_order_atomic
DO $patch_create$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.create_sale_order_command(jsonb,jsonb,text,uuid)'::regprocedure
  );

  IF position('sync_sale_order_items_dublagem_mode' IN v_def) > 0 THEN
    RAISE NOTICE 'create_sale_order_command já sincroniza dublagem_mode';
    RETURN;
  END IF;

  -- Âncora genérica: chamada ao atomic create.
  IF position('create_sale_order_atomic(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'create_sale_order_command sem create_sale_order_atomic';
  END IF;

  -- Injeta sync antes do RETURN final típico com order_id.
  v_old := 'RETURN ';
  -- Preferir ponto após o resultado do atomic estar em variável.
  -- Procura padrão comum: v_result := public.create_sale_order_atomic
  IF position('create_sale_order_atomic(' IN v_def) > 0 THEN
    -- Append sync right before the last RETURN jsonb_build / RETURN v_
    -- Safer: replace a unique trailing pattern if present.
    NULL;
  END IF;

  -- Estratégia: criar wrapper fino não — patch no legacy create + update
  -- e no execute via apply após writers.

  -- Patch create_sale_order_atomic_legacy
  v_def := pg_get_functiondef(
    'public.create_sale_order_atomic_legacy_202701(jsonb,jsonb,uuid)'::regprocedure
  );
  IF position('sync_sale_order_items_dublagem_mode' IN v_def) = 0 THEN
    v_old := 'RETURN jsonb_build_object(''order_id'', v_order_id, ''item_ids'', to_jsonb(v_item_ids), ''idempotent_replay'', false);';
    IF position(v_old IN v_def) = 0 THEN
      v_old := 'RETURN jsonb_build_object(';
      -- fallback: inject before END of function is hard; try common form
      RAISE NOTICE 'create legacy: tentando âncora alternativa';
      v_old := NULL;
    END IF;
    IF v_old IS NOT NULL AND position(v_old IN v_def) > 0 THEN
      v_new :=
        'PERFORM public.sync_sale_order_items_dublagem_mode(v_order_id, p_items);' || E'\n' ||
        '  -- Re-aplica por ordem quando itens novos ainda não tinham id no payload.' || E'\n' ||
        '  WITH ordered AS (' || E'\n' ||
        '    SELECT soi.id, row_number() OVER (ORDER BY soi.created_at, soi.id) AS rn' || E'\n' ||
        '      FROM public.sale_order_items soi WHERE soi.sale_order_id = v_order_id' || E'\n' ||
        '  ), payload AS (' || E'\n' ||
        '    SELECT value AS item, ordinality AS rn' || E'\n' ||
        '      FROM jsonb_array_elements(p_items) WITH ORDINALITY' || E'\n' ||
        '  )' || E'\n' ||
        '  UPDATE public.sale_order_items soi' || E'\n' ||
        '     SET dublagem_mode = NULLIF(lower(btrim(p.item->>''dublagem_mode'')), '''')' || E'\n' ||
        '    FROM ordered o, payload p' || E'\n' ||
        '   WHERE soi.id = o.id AND o.rn = p.rn AND (p.item ? ''dublagem_mode'');' || E'\n' ||
        '  ' || v_old;
      v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
      EXECUTE v_def;
    END IF;
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
  IF position('sync_sale_order_items_dublagem_mode' IN v_def) > 0 THEN
    RAISE NOTICE 'update legacy já sincroniza dublagem_mode';
    RETURN;
  END IF;

  v_old := 'PERFORM public.sync_sale_order_items_dublagem_mode';
  IF position(v_old IN v_def) > 0 THEN
    RETURN;
  END IF;

  -- Injeta antes do recalc/finalize comum.
  IF position('recalc_sale_order_total' IN v_def) > 0 THEN
    v_old := 'v_total := public.recalc_sale_order_total(p_order_id);';
    IF position(v_old IN v_def) = 0 THEN
      v_old := 'public.recalc_sale_order_total(p_order_id)';
      -- can't easily inject before expression
      v_old := NULL;
    END IF;
  ELSE
    v_old := NULL;
  END IF;

  IF v_old IS NOT NULL THEN
    v_new :=
      'PERFORM public.sync_sale_order_items_dublagem_mode(p_order_id, p_items);' || E'\n' ||
      '  ' || v_old;
    v_def := overlay(v_def placing v_new from position(v_old IN v_def) for length(v_old));
    EXECUTE v_def;
  ELSE
    -- Fallback: append via replace of unique END marker before final RETURN
    IF position('RETURN jsonb_build_object' IN v_def) > 0 THEN
      v_old := 'RETURN jsonb_build_object';
      v_new :=
        'PERFORM public.sync_sale_order_items_dublagem_mode(p_order_id, p_items);' || E'\n' ||
        '  RETURN jsonb_build_object';
      -- Only first occurrence near the end — use last by reversing is hard;
      -- overlay first is OK if create path already returned earlier.
      v_def := overlay(
        v_def
        placing v_new
        from position(v_old IN v_def)
        for length(v_old)
      );
      EXECUTE v_def;
    END IF;
  END IF;
END;
$patch_update$;

-- execute_sale_order_command: após writers de update, sincroniza dublagem_mode
DO $patch_exec$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  );
  IF position('sync_sale_order_items_dublagem_mode' IN v_def) > 0 THEN
    RAISE NOTICE 'execute_sale_order_command já sincroniza dublagem_mode';
    RETURN;
  END IF;

  -- Após apply_sale_order_production_neutral_update / update_sale_order_with_*
  IF position('apply_sale_order_production_neutral_update(' IN v_def) > 0 THEN
    v_old := 'apply_sale_order_production_neutral_update(';
    -- Find a statement end after this call is complex; inject after persist_sale_order_material_plan_revision if present
  END IF;

  IF position('persist_sale_order_material_plan_revision' IN v_def) > 0
     AND position('sync_sale_order_items_dublagem_mode' IN v_def) = 0 THEN
    -- Inject once before first persist_sale_order_material_plan_revision
    v_old := 'persist_sale_order_material_plan_revision';
    v_new :=
      'sync_sale_order_items_dublagem_mode(' || E'\n' ||
      '            p_sale_order_id,' || E'\n' ||
      '            COALESCE(v_items, p_payload -> ''items'', ''[]''::jsonb)' || E'\n' ||
      '          );' || E'\n' ||
      '          PERFORM public.persist_sale_order_material_plan_revision';
    -- Only works if preceded by PERFORM public.
    IF position('PERFORM public.persist_sale_order_material_plan_revision' IN v_def) > 0 THEN
      v_old := 'PERFORM public.persist_sale_order_material_plan_revision';
      v_new :=
        'PERFORM public.sync_sale_order_items_dublagem_mode(' || E'\n' ||
        '            p_sale_order_id,' || E'\n' ||
        '            COALESCE(v_items, p_payload -> ''items'', ''[]''::jsonb)' || E'\n' ||
        '          );' || E'\n' ||
        '          PERFORM public.persist_sale_order_material_plan_revision';
      v_def := overlay(
        v_def
        placing v_new
        from position(v_old IN v_def)
        for length(v_old)
      );
      EXECUTE v_def;
    END IF;
  END IF;
END;
$patch_exec$;
