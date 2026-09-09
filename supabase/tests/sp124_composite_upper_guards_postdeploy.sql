-- Verificação read-only pós-deploy da separação Cabedal × Forração da SP124.
-- Pode ser executada repetidamente pelo workflow supabase-db-exec.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Contrato geral: roda mesmo em ambientes sem o catálogo operacional SP124.
DO $general$
DECLARE
  v_wave_guards integer;
  v_old_direct_role text := current_setting('request.jwt.claim.role', true);
  v_old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF has_function_privilege(
       'anon',
       'public.resolve_upper_material_for_variant(uuid,text,text,numeric,uuid)',
       'EXECUTE'
     ) OR EXISTS (
       SELECT 1
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(
           coalesce(p.proacl, acldefault('f', p.proowner))
         ) acl
        WHERE n.nspname = 'public'
          AND p.proname = 'resolve_upper_material_for_variant'
          AND pg_get_function_identity_arguments(p.oid)
            = 'p_variant_id uuid, p_group_name text, p_color text, p_required numeric, p_sheet_pin_product_id uuid'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Resolver de Cabedal ainda executável por anon/PUBLIC.';
  END IF;

  -- Comprove o guard do SECURITY DEFINER usando somente o JSON de claims.
  -- O UUID deliberadamente inexistente não pode ser tratado como aprovado.
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', '00000000-0000-0000-0000-000000000001'
    )::text,
    true
  );
  BEGIN
    PERFORM *
      FROM public.resolve_upper_material_for_variant(
        NULL, 'NAPA SOFT + MASSABOX', 'OFF WHITE', 0, NULL
      );
    RAISE EXCEPTION 'Resolver aceitou authenticated sem profile aprovado.';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  PERFORM set_config('request.jwt.claim.role', coalesce(v_old_direct_role, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(v_old_claims, ''), true);

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'technical_sheets'
       AND t.tgname = 'trg_zz_guard_technical_sheet_composite_upper'
       AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'reference_material_variants'
       AND t.tgname = 'trg_zz_guard_reference_variant_composite_upper'
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Guardas de composição não estão habilitadas.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.technical_sheets'::regclass
       AND t.tgname = 'trg_mark_so_costs_dirty_from_upper_variant_drivers'
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.technical_sheets'::regclass
       AND t.tgname = 'trg_mark_so_costs_dirty_from_sheet'
       AND t.tgenabled <> 'D'
       AND position('variant_drives_upper' IN pg_get_triggerdef(t.oid)) > 0
       AND position('variant_drives_fachete' IN pg_get_triggerdef(t.oid)) > 0
  ) THEN
    RAISE EXCEPTION 'Malha canônica de custo não cobre as flags de Cabedal/Fachete.';
  END IF;

  IF position(
       '''resolution_warning'', ''color_mismatch'''
       IN pg_get_functiondef('public.calculate_order_cost_item(uuid,boolean)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'Custeio ainda aceita color_mismatch como material real.';
  END IF;
  IF position(
       '''material_color_not_registered:'''
       IN pg_get_functiondef('public.get_wave_material_needs_core(uuid[],date,boolean)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'MRP ainda aceita color_mismatch como demanda real.';
  END IF;
  IF position(
       '''resolution_warning'', ''color_mismatch'''
       IN pg_get_functiondef('public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'Relatório/PDF ainda aceita color_mismatch como material real.';
  END IF;
  IF position(
       '''resolution_warning'', ''color_mismatch'''
       IN pg_get_functiondef('public.calculate_outsource_material_requirements(uuid,numeric,text[])'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'Terceirização ainda aceita color_mismatch como material real.';
  END IF;
  IF position(
       'Cabedal sem SKU para'
       IN pg_get_functiondef('public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure)
     ) = 0 OR position(
       'Forração sem SKU para'
       IN pg_get_functiondef('public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure)
     ) = 0 OR position(
       'Palmilha sem SKU para'
       IN pg_get_functiondef('public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure)
     ) = 0 OR position(
       'fallback_pids'
       IN pg_get_functiondef('public.check_stock_availability(uuid,integer,text,jsonb,jsonb,text,uuid)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'Badge de disponibilidade ainda aceita color_mismatch como estoque real.';
  END IF;

  SELECT count(*)
    INTO v_wave_guards
    FROM (
      SELECT
        p.oid,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (
          (p.proname = 'create_production_wave'
           AND pg_get_function_identity_arguments(p.oid) IN (
             'p_sale_order_ids uuid[], p_week_start date, p_start_mode text',
             'p_week_start date, p_sale_order_ids uuid[]'
           ))
          OR (p.proname IN (
               'create_solo_wave',
               'create_wave_from_sale_order',
               'auto_create_wave_from_sale_order'
             )
           AND pg_get_function_identity_arguments(p.oid) = 'p_sale_order_id uuid')
        )
    ) guarded
   WHERE position('get_wave_material_needs_core' IN guarded.definition) > 0
     AND position('material_color_not_registered:%' IN guarded.definition) > 0
     AND position('Onda bloqueada: existe cor de material sem SKU cadastrado.' IN guarded.definition) > 0
     AND position('get_wave_material_needs_core' IN guarded.definition)
       < position('INSERT INTO' IN guarded.definition)
     AND position('material_color_not_registered:%' IN guarded.definition)
       < position('INSERT INTO' IN guarded.definition)
     AND position('Onda bloqueada: existe cor de material sem SKU cadastrado.' IN guarded.definition)
       < position('INSERT INTO' IN guarded.definition);
  IF v_wave_guards <> 5 THEN
    RAISE EXCEPTION 'Somente % de 5 entradas de onda possuem o bloqueio de cor.', v_wave_guards;
  END IF;

  PERFORM public.assert_all_composite_upper_variants_compatible();
END
$general$;

-- Contrato dos dados vivos: opcional em banco limpo, sem pular o bloco geral.
DO $data$
DECLARE
  v_sheet_id constant uuid := '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;
  v_target_group_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158'::uuid;
  v_pure_napa_group_id constant uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.technical_sheets WHERE id = v_sheet_id) THEN
    RAISE NOTICE 'SP124 ausente neste ambiente; teste de dados ignorado.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
     WHERE ts.id = v_sheet_id
       AND ts.upper_material = 'NAPA SOFT + MASSABOX'
       AND ts.upper_material_group_id = v_target_group_id
       AND ts.upper_material_product_id IS NULL
       AND ts.cor_predominante_id = v_target_group_id
       AND coalesce(ts.variant_drives_upper, false) = false
  ) THEN
    RAISE EXCEPTION 'SP124 não está ratificada no grupo composto correto.';
  END IF;

  IF (
    SELECT count(*) FROM public.product_group_layers
     WHERE composite_group_id = v_target_group_id
  ) <> 2 THEN
    RAISE EXCEPTION 'NAPA SOFT + MASSABOX não possui exatamente duas camadas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = v_target_group_id
       AND l.component_group_id = v_pure_napa_group_id
       AND l.component_label = 'NAPA SOFT'
       AND l.role = 'Material externo'
       AND l.display_order = 0
       AND l.is_color_source = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = v_target_group_id
       AND l.component_group_id IS NULL
       AND upper(btrim(l.component_label)) = 'MASSABOX'
       AND l.role = 'Base da dublagem'
       AND l.display_order = 1
       AND l.is_color_source = false
  ) THEN
    RAISE EXCEPTION 'Conteúdo das camadas NAPA SOFT + MASSABOX divergiu.';
  END IF;

  IF public.product_group_upper_structure_is_compatible(
    v_target_group_id,
    v_pure_napa_group_id
  ) THEN
    RAISE EXCEPTION 'NAPA SOFT puro foi aceito como estruturalmente compatível.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.resolve_upper_material_for_variant(
        NULL, 'NAPA SOFT + MASSABOX', 'OFF WHITE', 0, NULL
      ) resolved
     WHERE resolved.product_id = '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid
       AND resolved.matched_by = 'exact_color'
  ) THEN
    RAISE EXCEPTION 'Cabedal composto OFF WHITE não resolveu o SKU exato.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.resolve_upper_material_for_variant(
        NULL, 'NAPA SOFT + MASSABOX', 'LIMONCELLO', 0, NULL
      ) resolved
     WHERE resolved.matched_by = 'color_mismatch'
  ) THEN
    RAISE EXCEPTION 'Cabedal composto LIMONCELLO não virou pendência color_mismatch.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.resolve_upper_material_for_variant(
        NULL, 'NAPA SOFT', 'LIMONCELLO', 0, NULL
      ) resolved
     WHERE resolved.product_id = '9f7e86d9-d1f5-4e6e-9f89-83905e91980f'::uuid
       AND resolved.matched_by = 'exact_color'
  ) THEN
    RAISE EXCEPTION 'Forração NAPA SOFT LIMONCELLO deixou de resolver o SKU puro.';
  END IF;

END
$data$;

-- Exercita os motores sem persistir: PV-00168 deve usar o SKU composto; a cor
-- LIMONCELLO do legado PV-00162 deve virar pendência e nunca custo/demanda do
-- ROSE fallback. Nenhum snapshot, reserva ou order_cost do PV-00162 é escrito.
DO $behavior$
DECLARE
  v_sheet_id constant uuid := '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;
  v_target_group_id constant uuid := 'd2e718c8-aeb9-4706-be19-fd34b7fcc158'::uuid;
  v_pure_napa_group_id constant uuid := 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid;
  v_pv168_id uuid;
  v_pv162_id uuid;
  v_status text;
  v_limoncello_item_id uuid;
  v_item record;
  v_expected_upper_id uuid;
  v_expected_lining_id uuid;
  v_cost jsonb;
  v_correct_costs integer;
  v_cabedal_lines integer;
  v_correct_upper_lines integer;
  v_forracao_lines integer;
  v_pure_forracao_lines integer;
  v_composite_forracao_lines integer;
  v_warning_lines integer;
  v_zero_warning_lines integer;
  v_fallback_lines integer;
  v_report jsonb;
  v_outsource jsonb;
  v_limoncello_order_id uuid;
  v_limoncello_order_quantity numeric;
  v_limoncello_order_grade jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_sheet_id
  ) THEN
    RETURN;
  END IF;

  SELECT so.id, so.status INTO v_pv168_id, v_status
    FROM public.sale_orders so
   WHERE so.order_number = 'PV-00168';
  IF v_pv168_id IS NULL OR v_status IS DISTINCT FROM 'Rascunho' THEN
    RAISE EXCEPTION 'PV-00168 obrigatório não está em Rascunho.';
  END IF;
  IF (SELECT count(*) FROM public.sale_order_items soi
       WHERE soi.sale_order_id = v_pv168_id
         AND soi.reference_id = v_sheet_id) <> 2
     OR (SELECT count(*) FROM public.sale_order_items soi
          WHERE soi.sale_order_id = v_pv168_id
            AND soi.reference_id = v_sheet_id
            AND soi.material_variant_id IS NULL
            AND (
              (soi.color = 'OFF WHITE' AND soi.quantity = 420)
              OR (soi.color = 'PRETO' AND soi.quantity = 300)
            )) <> 2
     OR EXISTS (SELECT 1 FROM public.orders o WHERE o.sale_order_id = v_pv168_id)
     OR EXISTS (
       SELECT 1 FROM public.technical_sheet_snapshots s
        WHERE s.sale_order_id = v_pv168_id AND s.sheet_id = v_sheet_id
     ) THEN
    RAISE EXCEPTION 'PV-00168 deixou de ser o diagnóstico limpo autorizado.';
  END IF;

  WITH item_state AS (
    SELECT
      soi.id,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
      ) AS cabedal_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid
            WHEN 'PRETO' THEN '32875560-24a4-4341-bb45-39a002a9b092'::uuid
          END
          AND p.group_id = v_target_group_id
          AND p.active = true
          AND coalesce((line.value ->> 'subtotal')::numeric, 0) > 0
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS correct_upper_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
      ) AS forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.id = CASE soi.color
            WHEN 'OFF WHITE' THEN 'f1b80c1e-4f99-466c-81a2-377548998b44'::uuid
            WHEN 'PRETO' THEN '3b063cbb-61f4-4702-8122-0d50a916f1a8'::uuid
          END
          AND p.group_id = v_pure_napa_group_id
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      ) AS pure_forracao_lines,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_target_group_id
      ) AS composite_forracao_lines
    FROM public.sale_order_items soi
    JOIN public.order_costs oc ON oc.sale_order_item_id = soi.id
    LEFT JOIN LATERAL jsonb_array_elements(
      coalesce(oc.breakdown -> 'materials', '[]'::jsonb)
    ) line(value) ON true
    LEFT JOIN public.products p ON p.id = (line.value ->> 'product_id')::uuid
    WHERE soi.sale_order_id = v_pv168_id
      AND soi.reference_id = v_sheet_id
    GROUP BY soi.id, soi.color
  )
  SELECT count(*) FILTER (
    WHERE cabedal_lines = 1
      AND correct_upper_lines = 1
      AND forracao_lines = 1
      AND pure_forracao_lines = 1
      AND composite_forracao_lines = 0
  )::integer
    INTO v_correct_costs
    FROM item_state;
  IF v_correct_costs <> 2 THEN
    RAISE EXCEPTION 'PV-00168 não persistiu Cabedal composto e Forração NAPA SOFT pura nos dois itens.';
  END IF;

  FOR v_item IN
    SELECT soi.id, soi.color
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = v_pv168_id
       AND soi.reference_id = v_sheet_id
     ORDER BY soi.color
  LOOP
    v_expected_upper_id := CASE v_item.color
      WHEN 'OFF WHITE' THEN '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid
      WHEN 'PRETO' THEN '32875560-24a4-4341-bb45-39a002a9b092'::uuid
    END;
    v_expected_lining_id := CASE v_item.color
      WHEN 'OFF WHITE' THEN 'f1b80c1e-4f99-466c-81a2-377548998b44'::uuid
      WHEN 'PRETO' THEN '3b063cbb-61f4-4702-8122-0d50a916f1a8'::uuid
    END;
    v_cost := public.calculate_order_cost_item(v_item.id, false);

    SELECT
      count(*) FILTER (WHERE line.value ->> 'component' = 'Cabedal')::integer,
      count(*) FILTER (
        WHERE line.value ->> 'component' = 'Cabedal'
          AND (line.value ->> 'product_id')::uuid = v_expected_upper_id
          AND coalesce((line.value ->> 'subtotal')::numeric, 0) > 0
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      )::integer,
      count(*) FILTER (WHERE line.value ->> 'component' LIKE 'Forração%')::integer,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND (line.value ->> 'product_id')::uuid = v_expected_lining_id
          AND coalesce(line.value ->> 'resolution_warning', '') = ''
      )::integer,
      count(*) FILTER (
        WHERE line.value ->> 'component' LIKE 'Forração%'
          AND p.group_id = v_target_group_id
      )::integer
      INTO v_cabedal_lines, v_correct_upper_lines, v_forracao_lines,
           v_pure_forracao_lines, v_composite_forracao_lines
      FROM jsonb_array_elements(
        coalesce(v_cost #> '{breakdown,materials}', '[]'::jsonb)
      ) line(value)
      LEFT JOIN public.products p ON p.id = (line.value ->> 'product_id')::uuid;
    IF v_cabedal_lines <> 1 OR v_correct_upper_lines <> 1
       OR v_forracao_lines <> 1 OR v_pure_forracao_lines <> 1
       OR v_composite_forracao_lines <> 0 THEN
      RAISE EXCEPTION 'Custeio read-only do PV-00168/% misturou Cabedal e Forração.', v_item.color;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM public.get_wave_material_needs_core(ARRAY[v_pv168_id], NULL::date) n
     WHERE n.conversion_warning LIKE 'material_color_not_registered:Cabedal:%'
  ) OR (
    SELECT count(DISTINCT n.product_id)
      FROM public.get_wave_material_needs_core(ARRAY[v_pv168_id], NULL::date) n
     WHERE n.product_id IN (
       '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid,
       '32875560-24a4-4341-bb45-39a002a9b092'::uuid
     )
       AND n.needed_qty > 0
  ) <> 2 THEN
    RAISE EXCEPTION 'MRP do PV-00168 não emitiu os dois SKUs compostos exatos.';
  END IF;

  SELECT so.id, so.status INTO v_pv162_id, v_status
    FROM public.sale_orders so
   WHERE so.order_number = 'PV-00162';
  IF v_pv162_id IS NULL OR v_status IS DISTINCT FROM 'Em Produção' THEN
    RAISE EXCEPTION 'PV-00162 legado obrigatório não está Em Produção.';
  END IF;
  IF (SELECT count(*) FROM public.sale_order_items soi
       WHERE soi.sale_order_id = v_pv162_id
         AND soi.reference_id = v_sheet_id) <> 2
     OR (SELECT count(*) FROM public.sale_order_items soi
          WHERE soi.sale_order_id = v_pv162_id
            AND soi.reference_id = v_sheet_id
            AND soi.material_variant_id IS NULL
            AND (
              (soi.color = 'OFF WHITE' AND soi.quantity = 108)
              OR (soi.color = 'LIMONCELLO' AND soi.quantity = 72)
            )) <> 2
     OR EXISTS (
       SELECT 1 FROM public.sale_orders so
        WHERE so.id = v_pv162_id AND so.reservations_outdated_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Forma/estado do legado PV-00162 divergiu.';
  END IF;

  -- Estado histórico observado antes do deploy. Qualquer ressincronização,
  -- invalidação ou recálculo feito pela migration altera uma destas provas.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = v_pv162_id
       AND soi.reference_id = v_sheet_id
       AND (
         (SELECT count(*) FROM public.orders o
           WHERE o.sale_order_item_id = soi.id) <> 4
         OR (SELECT count(*) FROM public.technical_sheet_snapshots s
              WHERE s.sale_order_item_id = soi.id) <> 1
         OR EXISTS (
           SELECT 1 FROM public.technical_sheet_snapshots s
            WHERE s.sale_order_item_id = soi.id
              AND s.outdated_at IS DISTINCT FROM
                timestamptz '2026-08-28 11:47:57.913733-03'
         )
         OR (SELECT count(*)
               FROM public.technical_sheet_snapshots s
               CROSS JOIN LATERAL jsonb_array_elements(s.consumption_snapshot) line
               JOIN public.products p ON p.id = (line ->> 'product_id')::uuid
              WHERE s.sale_order_item_id = soi.id
                AND line ->> 'component' = 'Cabedal'
                AND p.group_id = v_pure_napa_group_id) <> 1
         OR (SELECT count(*)
               FROM public.material_reservations mr
               JOIN public.orders o ON o.id = mr.order_id
              WHERE o.sale_order_item_id = soi.id
                AND mr.status IN ('reserved', 'partially_consumed')) <> 7
         OR (SELECT count(*)
               FROM public.material_reservations mr
               JOIN public.orders o ON o.id = mr.order_id
               JOIN public.products p ON p.id = mr.product_id
              WHERE o.sale_order_item_id = soi.id
                AND mr.status IN ('reserved', 'partially_consumed')
                AND p.group_id = v_pure_napa_group_id) <> 2
         OR (SELECT count(*) FROM public.order_costs oc
              WHERE oc.sale_order_item_id = soi.id) <> 1
         OR (SELECT max(oc.calculated_at) FROM public.order_costs oc
              WHERE oc.sale_order_item_id = soi.id) IS DISTINCT FROM
                timestamptz '2026-08-30 16:47:00.520468-03'
         OR (SELECT count(*)
               FROM public.order_costs oc
               CROSS JOIN LATERAL jsonb_array_elements(
                 coalesce(oc.breakdown -> 'materials', '[]'::jsonb)
               ) line
              WHERE oc.sale_order_item_id = soi.id
                AND line ->> 'component' = 'Cabedal'
                AND (line ->> 'product_id')::uuid = CASE soi.color
                  WHEN 'OFF WHITE' THEN '8e5a76e5-cf48-4994-931a-ccc6bef36afe'::uuid
                  WHEN 'LIMONCELLO' THEN '53fc4f9b-a686-42e4-80c6-838ac51a5c08'::uuid
                END
                AND coalesce((line ->> 'subtotal')::numeric, 0) > 0
                AND coalesce(line ->> 'resolution_warning', '') = '') <> 1
       )
  ) THEN
    RAISE EXCEPTION 'Histórico operacional/custeado do PV-00162 foi alterado.';
  END IF;

  SELECT soi.id INTO v_limoncello_item_id
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = v_pv162_id
     AND soi.reference_id = v_sheet_id
     AND soi.color = 'LIMONCELLO'
     AND soi.quantity = 72
     AND soi.material_variant_id IS NULL;

  v_cost := public.calculate_order_cost_item(v_limoncello_item_id, false);
  SELECT
    count(*) FILTER (
      WHERE warning.value = 'material_color_not_registered:Cabedal:LIMONCELLO'
    )::integer
    INTO v_warning_lines
    FROM jsonb_array_elements_text(
      coalesce(v_cost -> 'warnings', '[]'::jsonb)
    ) warning(value);
  SELECT
    count(*) FILTER (WHERE line.value ->> 'component' = 'Cabedal')::integer,
    count(*) FILTER (
      WHERE line.value ->> 'component' = 'Cabedal'
        AND line.value ->> 'resolution_warning' = 'color_mismatch'
        AND line.value ->> 'requested_color' = 'LIMONCELLO'
        AND coalesce((line.value ->> 'subtotal')::numeric, 0) = 0
    )::integer
    INTO v_cabedal_lines, v_correct_upper_lines
    FROM jsonb_array_elements(
      coalesce(v_cost #> '{breakdown,materials}', '[]'::jsonb)
    ) line(value);
  IF v_warning_lines <> 1 OR v_cabedal_lines <> 1 OR v_correct_upper_lines <> 1 THEN
    RAISE EXCEPTION 'Custeio read-only do PV-00162/LIMONCELLO ainda precifica o SKU fallback.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE n.conversion_warning = 'material_color_not_registered:Cabedal:LIMONCELLO'
    )::integer,
    count(*) FILTER (
      WHERE n.conversion_warning = 'material_color_not_registered:Cabedal:LIMONCELLO'
        AND n.needed_qty = 0
        AND n.shortage = 0
    )::integer
    INTO v_warning_lines, v_zero_warning_lines
    FROM public.get_wave_material_needs_core(ARRAY[v_pv162_id], NULL::date) n;
  IF v_warning_lines <> 1 OR v_zero_warning_lines <> 1 THEN
    RAISE EXCEPTION 'MRP do PV-00162/LIMONCELLO não preservou uma única pendência com demanda zero.';
  END IF;

  v_report := public.calculate_consumption_report_batch(
    ARRAY[v_pv162_id],
    NULL::uuid[]
  );
  SELECT
    count(*) FILTER (
      WHERE line.value ->> 'scope_key' = v_limoncello_item_id::text
        AND line.value ->> 'component' = 'Cabedal'
        AND line.value ->> 'conversion_warning'
          = 'material_color_not_registered:Cabedal:LIMONCELLO'
        AND line.value ->> 'resolution_warning' = 'color_mismatch'
        AND line.value ->> 'requested_color' = 'LIMONCELLO'
        AND line.value ->> 'product_id' IS NULL
        AND coalesce((line.value ->> 'required')::numeric, 0) = 0
        AND coalesce((line.value ->> 'available')::numeric, 0) = 0
        AND coalesce((line.value ->> 'stock_ok')::boolean, false) = false
        AND line.value ->> 'source' = 'unresolved'
    )::integer,
    count(*) FILTER (
      WHERE line.value ->> 'scope_key' = v_limoncello_item_id::text
        AND line.value ->> 'component' = 'Cabedal'
        AND (
          line.value ->> 'product_id' IS NOT NULL
          OR coalesce((line.value ->> 'required')::numeric, 0) > 0
          OR coalesce((line.value ->> 'available')::numeric, 0) > 0
          OR coalesce((line.value ->> 'stock_ok')::boolean, false)
        )
    )::integer
    INTO v_zero_warning_lines, v_fallback_lines
    FROM jsonb_array_elements(coalesce(v_report -> 'lines', '[]'::jsonb)) line(value);
  IF v_zero_warning_lines <> 1 OR v_fallback_lines <> 0 THEN
    RAISE EXCEPTION 'Relatório/PDF do PV-00162/LIMONCELLO ainda expõe ROSE ou demanda positiva.';
  END IF;

  SELECT o.id, o.quantity, o.grade
    INTO v_limoncello_order_id, v_limoncello_order_quantity, v_limoncello_order_grade
    FROM public.orders o
   WHERE o.sale_order_item_id = v_limoncello_item_id
     AND o.deleted_at IS NULL
   ORDER BY o.id
   LIMIT 1;
  IF v_limoncello_order_id IS NULL THEN
    RAISE EXCEPTION 'PV-00162/LIMONCELLO não possui OP para validar consumidores operacionais.';
  END IF;

  v_outsource := public.calculate_outsource_material_requirements(
    v_limoncello_order_id,
    v_limoncello_order_quantity,
    ARRAY['Cabedal']::text[]
  );
  SELECT
    count(*) FILTER (
      WHERE item.value ->> 'component' = 'Cabedal'
        AND item.value ->> 'product_id' IS NULL
        AND coalesce((item.value ->> 'quantity')::numeric, 0) = 0
        AND coalesce((item.value ->> 'required')::numeric, 0) = 0
        AND item.value ->> 'source' = 'unresolved'
        AND item.value ->> 'resolution_warning' = 'color_mismatch'
        AND item.value ->> 'requested_color' = 'LIMONCELLO'
        AND (item.value -> 'warnings') ? 'material_color_not_registered:Cabedal:LIMONCELLO'
    )::integer,
    count(*) FILTER (
      WHERE item.value ->> 'component' = 'Cabedal'
        AND (
          item.value ->> 'product_id' IS NOT NULL
          OR coalesce((item.value ->> 'quantity')::numeric, 0) > 0
          OR coalesce((item.value ->> 'required')::numeric, 0) > 0
        )
    )::integer
    INTO v_zero_warning_lines, v_fallback_lines
    FROM jsonb_array_elements(coalesce(v_outsource -> 'items', '[]'::jsonb)) item(value);
  IF v_zero_warning_lines <> 1 OR v_fallback_lines <> 0 THEN
    RAISE EXCEPTION 'Terceirização do PV-00162/LIMONCELLO ainda expõe ROSE ou demanda positiva.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE availability.product_id IS NULL
        AND availability.product_name = 'Cabedal sem SKU para LIMONCELLO'
        AND availability.required = 0
        AND availability.available = 0
        AND availability.sufficient = false
    )::integer,
    count(*) FILTER (
      WHERE availability.product_id = '53fc4f9b-a686-42e4-80c6-838ac51a5c08'::uuid
        OR (
          availability.product_name ILIKE '%ROSE%'
          AND availability.required > 0
        )
    )::integer
    INTO v_zero_warning_lines, v_fallback_lines
    FROM public.check_stock_availability(
      v_sheet_id,
      v_limoncello_order_quantity::integer,
      'LIMONCELLO',
      v_limoncello_order_grade,
      NULL::jsonb,
      NULL::text,
      NULL::uuid
    ) availability;
  IF v_zero_warning_lines <> 1 OR v_fallback_lines <> 0 THEN
    RAISE EXCEPTION 'Disponibilidade do PV-00162/LIMONCELLO ainda mostra ROSE ou estoque OK.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE availability.product_id IS NULL
        AND availability.product_name = 'Cabedal sem SKU para LIMONCELLO'
        AND availability.required = 0
        AND availability.available = 0
        AND availability.sufficient = false
    )::integer,
    count(*) FILTER (
      WHERE availability.product_id = '53fc4f9b-a686-42e4-80c6-838ac51a5c08'::uuid
        OR (
          availability.product_name ILIKE '%ROSE%'
          AND availability.required > 0
        )
    )::integer
    INTO v_zero_warning_lines, v_fallback_lines
    FROM public.check_stock_availability(
      v_sheet_id,
      v_limoncello_order_quantity::integer,
      'LIMONCELLO',
      NULL::jsonb,
      NULL::jsonb,
      NULL::text,
      NULL::uuid
    ) availability;
  IF v_zero_warning_lines <> 1 OR v_fallback_lines <> 0 THEN
    RAISE EXCEPTION 'Disponibilidade escalar do PV-00162/LIMONCELLO ainda mostra ROSE ou estoque OK.';
  END IF;
END
$behavior$;

SELECT jsonb_build_object(
  'sheet', ts.name,
  'upper_group', g.name,
  'layers', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'label', l.component_label,
        'role', l.role,
        'is_color_source', l.is_color_source
      ) ORDER BY l.display_order
    )
      FROM public.product_group_layers l
     WHERE l.composite_group_id = ts.upper_material_group_id
  ),
  'available_colors', (
    SELECT jsonb_agg(p.color ORDER BY p.color)
      FROM public.products p
     WHERE p.group_id = ts.upper_material_group_id
       AND p.active = true
  )
) AS sp124_composite_upper_postdeploy
FROM public.technical_sheets ts
JOIN public.product_groups g ON g.id = ts.upper_material_group_id
WHERE ts.id = '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid;

-- Exceção histórica explícita: não corrige nem ressincroniza o PV-00162; apenas
-- mostra quantos snapshots e reservas antigas ainda apontam para NAPA SOFT puro.
WITH legacy AS (
  SELECT
    so.order_number,
    soi.color,
    soi.quantity,
    count(DISTINCT s.id) FILTER (
      WHERE EXISTS (
        SELECT 1
          FROM jsonb_array_elements(s.consumption_snapshot) line
         WHERE line ->> 'component' = 'Cabedal'
           AND line ->> 'product_name' = 'NAPA SOFT'
      )
    ) AS legacy_snapshots,
    count(DISTINCT mr.id) FILTER (
      WHERE mr.status IN ('reserved', 'partially_consumed')
        AND p.group_id = 'a0c6dcee-c72f-4e66-8f69-47be847957d3'::uuid
    ) AS open_pure_napa_reservations,
    max(s.outdated_at) AS snapshot_outdated_at,
    max(so.reservations_outdated_at) AS reservations_outdated_at
  FROM public.sale_orders so
  JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  LEFT JOIN public.technical_sheet_snapshots s ON s.sale_order_item_id = soi.id
  LEFT JOIN public.orders o ON o.sale_order_item_id = soi.id
  LEFT JOIN public.material_reservations mr ON mr.order_id = o.id
  LEFT JOIN public.products p ON p.id = mr.product_id
  WHERE so.order_number = 'PV-00162'
    AND soi.reference_id = '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid
  GROUP BY so.order_number, soi.id, soi.color, soi.quantity
)
SELECT jsonb_agg(to_jsonb(legacy) ORDER BY color)
  AS sp124_pv00162_legacy_operational_state
FROM legacy;

COMMIT;
