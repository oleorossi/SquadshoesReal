-- Faturar PV (execute_sale_order_command → finalize_orders_on_sale_order_billed →
-- convert_reservation_to_out) estava morrendo em statement timeout ao fazer
-- FOR UPDATE em products, enquanto process_sale_order_purchase_shortages da
-- outbox segurava a época global, o PV e os produtos durante 4 passes de
-- compute_per_pv_purchase_needs* (medido 12/09/2026: PV-00193/00195 outbox
-- failed; PV-00148 Em Produção→Faturado timeout em products (3,20)).
--
-- O cálculo pesado passa a rodar só com advisory lock do PV. Row locks
-- (época → PV → produtos) ficam restritos à fase curta de escrita, na mesma
-- ordem da 11100 para não reabrir o ciclo época↔PV.

DO $patch$
DECLARE
  v_def text;
  v_old_prologue text;
  v_new_prologue text;
  v_old_mid text;
  v_new_mid text;
  v_unallocated_pos integer;
  v_alloc_pos integer;
  v_product_pos integer;
BEGIN
  v_def := pg_get_functiondef(
    'public.process_sale_order_purchase_shortages(uuid)'::regprocedure
  );

  IF position($$set_config('statement_timeout', '90s', true)$$ IN v_def) > 0 THEN
    RAISE NOTICE 'process_sale_order_purchase_shortages já calcula fora dos row locks';
    RETURN;
  END IF;

  IF position('v_compute_version bigint;' IN v_def) = 0 THEN
    IF position('v_purchase_product_ids_after uuid[];' IN v_def) = 0 THEN
      RAISE EXCEPTION 'DECLARE do worker de compras divergiu';
    END IF;
    v_def := replace(
      v_def,
      'v_purchase_product_ids_after uuid[];',
      'v_purchase_product_ids_after uuid[];' || E'\n' ||
      '  v_compute_version bigint;'
    );
  END IF;

  v_old_prologue :=
    'IF p_sale_order_id IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION ''sale_order_id obrigatório'' USING ERRCODE = ''22023'';' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  PERFORM public.lock_sale_order_purchase_allocation();' || E'\n\n' ||
    '  PERFORM pg_advisory_xact_lock(hashtextextended(' || E'\n' ||
    '    ''sale-order-purchase-shortages:'' || p_sale_order_id::text,' || E'\n' ||
    '    0' || E'\n' ||
    '  ));' || E'\n\n' ||
    '  SELECT so.status, so.order_version' || E'\n' ||
    '    INTO v_status, v_order_version' || E'\n' ||
    '    FROM public.sale_orders so' || E'\n' ||
    '   WHERE so.id = p_sale_order_id' || E'\n' ||
    '     AND so.deleted_at IS NULL' || E'\n' ||
    '   FOR UPDATE;' || E'\n' ||
    '  IF NOT FOUND THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''skipped'', true, ''reason'', ''sale_order_not_found'');' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])' || E'\n' ||
    '    INTO v_purchase_product_ids' || E'\n' ||
    '    FROM (' || E'\n' ||
    '      SELECT DISTINCT need.material_id AS product_id' || E'\n' ||
    '        FROM public.compute_per_pv_purchase_needs_unallocated(' || E'\n' ||
    '          ARRAY[p_sale_order_id]' || E'\n' ||
    '        ) need' || E'\n' ||
    '       WHERE need.material_id IS NOT NULL' || E'\n' ||
    '      UNION' || E'\n' ||
    '      SELECT DISTINCT poi.product_id' || E'\n' ||
    '        FROM public.sale_order_purchase_shortage_effects e' || E'\n' ||
    '        JOIN public.purchase_order_items poi' || E'\n' ||
    '          ON poi.purchase_order_id = e.purchase_order_id' || E'\n' ||
    '       WHERE e.sale_order_id = p_sale_order_id' || E'\n' ||
    '         AND poi.product_id IS NOT NULL' || E'\n' ||
    '    ) x;' || E'\n' ||
    '  PERFORM public.lock_sale_order_purchase_products(v_purchase_product_ids);' || E'\n' ||
    '  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])' || E'\n' ||
    '    INTO v_purchase_product_ids_after' || E'\n' ||
    '    FROM (' || E'\n' ||
    '      SELECT DISTINCT need.material_id AS product_id' || E'\n' ||
    '        FROM public.compute_per_pv_purchase_needs_unallocated(' || E'\n' ||
    '          ARRAY[p_sale_order_id]' || E'\n' ||
    '        ) need' || E'\n' ||
    '       WHERE need.material_id IS NOT NULL' || E'\n' ||
    '      UNION' || E'\n' ||
    '      SELECT DISTINCT poi.product_id' || E'\n' ||
    '        FROM public.sale_order_purchase_shortage_effects e' || E'\n' ||
    '        JOIN public.purchase_order_items poi' || E'\n' ||
    '          ON poi.purchase_order_id = e.purchase_order_id' || E'\n' ||
    '       WHERE e.sale_order_id = p_sale_order_id' || E'\n' ||
    '         AND poi.product_id IS NOT NULL' || E'\n' ||
    '    ) x;' || E'\n' ||
    '  IF v_purchase_product_ids_after IS DISTINCT FROM v_purchase_product_ids THEN' || E'\n' ||
    '    RAISE EXCEPTION ''Os produtos demandados mudaram durante a compra; repita''' || E'\n' ||
    '      USING ERRCODE = ''40001'';' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  IF v_status IN (''Aprovado'', ''Em Produção'') THEN';

  IF position(v_old_prologue IN v_def) = 0 THEN
    RAISE EXCEPTION 'Prólogo lock-then-compute do worker de compras divergiu';
  END IF;

  v_new_prologue :=
    'IF p_sale_order_id IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION ''sale_order_id obrigatório'' USING ERRCODE = ''22023'';' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  PERFORM set_config(''statement_timeout'', ''90s'', true);' || E'\n\n' ||
    '  PERFORM pg_advisory_xact_lock(hashtextextended(' || E'\n' ||
    '    ''sale-order-purchase-shortages:'' || p_sale_order_id::text,' || E'\n' ||
    '    0' || E'\n' ||
    '  ));' || E'\n\n' ||
    '  SELECT so.status, so.order_version' || E'\n' ||
    '    INTO v_status, v_order_version' || E'\n' ||
    '    FROM public.sale_orders so' || E'\n' ||
    '   WHERE so.id = p_sale_order_id' || E'\n' ||
    '     AND so.deleted_at IS NULL;' || E'\n' ||
    '  IF NOT FOUND THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''skipped'', true, ''reason'', ''sale_order_not_found'');' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  v_compute_version := v_order_version;' || E'\n\n' ||
    '  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])' || E'\n' ||
    '    INTO v_purchase_product_ids' || E'\n' ||
    '    FROM (' || E'\n' ||
    '      SELECT DISTINCT need.material_id AS product_id' || E'\n' ||
    '        FROM public.compute_per_pv_purchase_needs_unallocated(' || E'\n' ||
    '          ARRAY[p_sale_order_id]' || E'\n' ||
    '        ) need' || E'\n' ||
    '       WHERE need.material_id IS NOT NULL' || E'\n' ||
    '      UNION' || E'\n' ||
    '      SELECT DISTINCT poi.product_id' || E'\n' ||
    '        FROM public.sale_order_purchase_shortage_effects e' || E'\n' ||
    '        JOIN public.purchase_order_items poi' || E'\n' ||
    '          ON poi.purchase_order_id = e.purchase_order_id' || E'\n' ||
    '       WHERE e.sale_order_id = p_sale_order_id' || E'\n' ||
    '         AND poi.product_id IS NOT NULL' || E'\n' ||
    '    ) x;' || E'\n\n' ||
    '  IF v_status IN (''Aprovado'', ''Em Produção'') THEN';

  v_def := replace(v_def, v_old_prologue, v_new_prologue);

  v_old_mid :=
    '  END IF;' || E'\n\n' ||
    '  IF jsonb_array_length(v_blocked) > 0 THEN';

  IF position(v_old_mid IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador pós-compute do worker de compras divergiu';
  END IF;

  v_new_mid :=
    '  END IF;' || E'\n\n' ||
    '  PERFORM public.lock_sale_order_purchase_allocation();' || E'\n' ||
    '  SELECT so.status, so.order_version' || E'\n' ||
    '    INTO v_status, v_order_version' || E'\n' ||
    '    FROM public.sale_orders so' || E'\n' ||
    '   WHERE so.id = p_sale_order_id' || E'\n' ||
    '     AND so.deleted_at IS NULL' || E'\n' ||
    '   FOR UPDATE;' || E'\n' ||
    '  IF NOT FOUND THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''skipped'', true, ''reason'', ''sale_order_not_found'');' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  IF v_order_version IS DISTINCT FROM v_compute_version THEN' || E'\n' ||
    '    RAISE EXCEPTION ''Os produtos demandados mudaram durante a compra; repita''' || E'\n' ||
    '      USING ERRCODE = ''40001'';' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  IF v_status NOT IN (''Aprovado'', ''Em Produção'') THEN' || E'\n' ||
    '    v_desired_groups := ''[]''::jsonb;' || E'\n' ||
    '    v_blocked := ''[]''::jsonb;' || E'\n' ||
    '  END IF;' || E'\n' ||
    '  PERFORM public.lock_sale_order_purchase_products(v_purchase_product_ids);' || E'\n\n' ||
    '  IF jsonb_array_length(v_blocked) > 0 THEN';

  v_def := replace(v_def, v_old_mid, v_new_mid);

  EXECUTE v_def;

  v_def := pg_get_functiondef(
    'public.process_sale_order_purchase_shortages(uuid)'::regprocedure
  );
  v_unallocated_pos := position(
    'compute_per_pv_purchase_needs_unallocated' IN v_def
  );
  v_alloc_pos := position('lock_sale_order_purchase_allocation' IN v_def);
  v_product_pos := position('lock_sale_order_purchase_products' IN v_def);
  IF v_unallocated_pos = 0 OR v_alloc_pos = 0 OR v_product_pos = 0 THEN
    RAISE EXCEPTION 'Worker de compras perdeu compute/lock após o patch';
  END IF;
  IF NOT (
    v_unallocated_pos < v_alloc_pos
    AND v_alloc_pos < v_product_pos
    AND position($$set_config('statement_timeout', '90s', true)$$ IN v_def) > 0
    AND position('v_compute_version := v_order_version;' IN v_def) > 0
  ) THEN
    RAISE EXCEPTION
      'Ordem compute→época→produtos não ficou gravada no worker de compras';
  END IF;
END;
$patch$;

DO $convert$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(
    'public.convert_reservation_to_out_legacy_202701(uuid,uuid)'::regprocedure
  );
  IF position($$set_config('lock_timeout', '8s', true)$$ IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old :=
    'PERFORM pg_advisory_xact_lock(hashtext(''stock_debit:'' || p_order_id::text));';
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador stock_debit de convert_reservation divergiu';
  END IF;
  v_new :=
    'PERFORM set_config(''lock_timeout'', ''8s'', true);' || E'\n' ||
    '  ' || v_old;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$convert$;
