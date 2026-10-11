-- strap_comprar_pronto_so_registra_20270101036100
--
-- Tira de NAPA em "Comprar pronto" só registra napa · cor + metros
-- (specs/tira-comprar-pronto-so-registra.md, grill do dono 11/10/2026).
-- AJUSTE antes do redesenho specs/tira-material-de-estoque.md, cuja virada
-- (carimbo >= 037000, outra sessão) substitui estas funções por inteiro.
--
-- Escopo decidido pelo dono: SÓ a tira de napa (identity_basis =
-- 'reference_base' + pv_origem = 'sku_acabado'). O STRASS
-- (finished_product_group) fica EXATAMENTE como estava: variante do Hub,
-- demanda/OC, reserva e débito na OP.
--
-- Por que era preciso: nenhum PV jamais salvou tira de napa em Comprar pronto.
-- O gatilho de alinhamento exigia variante em TODA linha ("Tira sem
-- cor/variante canonica congelada no PV") e, no ramo sku_acabado, recusava
-- variante — contradição. Antes disso a tela já recusava linha sem group_id e
-- o writer convertia em silêncio para Prestador (mig 28600).
--
-- O que muda (cada patch é sobre o CORPO VIVO e falha se a âncora sumir):
--   1. writer prepare_sale_order_item_internal_straps — ramo sku_acabado de
--      napa: valida a cor da tira, NÃO exige group_id, NÃO acha/cria SKU, grava
--      buy_ready + color_id + napa + gross_required_m (recalculado a cada save).
--      Sai a conversão silenciosa sku_acabado -> Prestador (28600).
--   2. tg_validate_sale_order_item_strap_color_alignment — variante deixa de
--      ser exigida na tira de napa comprada pronta; o ramo dela exige
--      buy_ready, cor, e NENHUM SKU/variante/receita/napa oficial.
--   3. tg_version_and_guard_sale_order_item_strap_sourcing — aceita buy_ready
--      sem variante e sem SKU (registro de napa).
--   4. preview base (pre_05500) — não resolve catálogo/variante para a tira de
--      napa comprada pronta (devolve só cor, napa e metros).
--   5. preview autoritativo (pre_20270101015500) — ramo próprio para ela, sem
--      reference_base_intent_mismatch nem frozen_source_snapshot_stale.
--   6. resolve_committed_strap_identity — snapshot comprometido dela é válido.
--   7. enqueue_sale_order_strap_demands — ela nunca gera demanda/OC.
--   8. calculate_order_cost_item — ela sai do custeio, com aviso e linha zerada.

-- ── 1. Writer do PV ─────────────────────────────────────────────────────────
DO $patch_writer$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_start_marker text := '-- strap_pv_sku_acabado_fornecedor_20270101024000';
  v_end_marker text := 'ELSIF v_sheet_basis = ''reference_base'' THEN';
  v_start integer;
  v_end integer;
  v_new text := $new$-- strap_comprar_pronto_so_registra_20270101036100
    -- Comprar pronto de tira de napa só registra napa · cor + metros
    -- (substitui 24000/28600/31900/33000): não exige grupo acabado na ficha,
    -- não acha nem cria SKU, não gera demanda. A cor é a da própria tira; só a
    -- tira que segue a Cor Principal usa a cor do item.
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
      IF v_color_mode = 'select_on_order' THEN
        v_line_color_id := public.try_parse_uuid(v_line ->> 'color_id');
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: selecione a cor da tira comprada pronta no Pedido de Venda',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
        SELECT c.name INTO v_line_color_name
          FROM public.canonical_colors c
         WHERE c.id = v_line_color_id
           AND c.active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modelo % / %, %: a cor escolhida para a tira comprada pronta nao existe ou esta inativa',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSE
        v_line_color_id := v_color_id;
        v_line_color_name := v_color_name;
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: tira comprada pronta exige a Cor Principal canonica do item',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      END IF;
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id' - 'finished_product_id'
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name'
          - 'gross_required_m')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
          'strap_variant_id', NULL,
          'finished_product_id', NULL,
          'recipe_id', NULL,
          'base_product_id', NULL,
          -- D5: metros pela grade atual, a cada save (mesma conta da prévia).
          'gross_required_m', round(public.calculate_strap_line_required_m(
            v_line,
            coalesce(
              nullif(p_item ->> 'quantity', '')::numeric,
              coalesce(nullif(p_item ->> 'fichas', '')::numeric, 1) * coalesce((
                SELECT sum(g.value::numeric)
                  FROM jsonb_each_text(CASE WHEN jsonb_typeof(p_item -> 'grade') = 'object'
                    THEN p_item -> 'grade' ELSE '{}'::jsonb END) g
                 WHERE g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              ), 0)
            ),
            coalesce(p_item -> 'grade', '{}'::jsonb)
          ), 4)
        ),
        true
      );
    $new$;
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_start := position(v_start_marker IN v_def);
  v_end := position(v_end_marker IN v_def);
  IF v_start = 0 OR v_end = 0 OR v_end < v_start
     OR position(v_start_marker IN substr(v_def, v_start + 1)) > 0
     OR position(v_end_marker IN substr(v_def, v_end + 1)) > 0 THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps: ancora do ramo sku_acabado nao encontrada/unica';
  END IF;
  v_def := left(v_def, v_start - 1) || v_new || substr(v_def, v_end);
  EXECUTE v_def;
END
$patch_writer$;

-- ── 2. Gatilho de alinhamento do item ───────────────────────────────────────
DO $patch_alignment$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_variant_pattern text :=
    'OR v_source_variant_id IS NULL THEN(\s+RAISE EXCEPTION ''Tira sem cor/variante canonica congelada no PV'')';
  v_start_marker text := '-- strap_pv_sku_acabado_fornecedor_20270101024000';
  v_end_marker text := 'ELSIF v_basis = ''reference_base'' THEN';
  v_start integer;
  v_end integer;
  v_new text := $new$-- strap_comprar_pronto_so_registra_20270101036100
    -- Tira de napa comprada pronta só registra napa · cor + metros: origem
    -- buy_ready, cor da tira, e NENHUM SKU/variante/receita/napa oficial.
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      IF (
           v_color_mode = 'follow_main'
           AND (v_expected_color_id IS NULL
                OR v_line_color_id IS DISTINCT FROM v_expected_color_id)
         )
         OR v_line_color_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL
         OR v_source_variant_id IS NOT NULL
         OR nullif(v_source ->> 'finished_product_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta so registra cor e metros: origem buy_ready, cor da tira e nenhum SKU/variante';
      END IF;
    $new$;
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_variant_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'alinhamento: ancora da exigencia de variante nao encontrada/unica';
  END IF;
  v_def := regexp_replace(
    v_def,
    v_variant_pattern,
    'OR (v_source_variant_id IS NULL AND NOT (v_basis = ''reference_base'' AND nullif(v_line ->> ''pv_origem'', '''') = ''sku_acabado'')) THEN\1'
  );
  v_start := position(v_start_marker IN v_def);
  v_end := position(v_end_marker IN v_def);
  IF v_start = 0 OR v_end = 0 OR v_end < v_start
     OR position(v_start_marker IN substr(v_def, v_start + 1)) > 0
     OR position(v_end_marker IN substr(v_def, v_end + 1)) > 0 THEN
    RAISE EXCEPTION 'alinhamento: ancora do ramo sku_acabado nao encontrada/unica';
  END IF;
  v_def := left(v_def, v_start - 1) || v_new || substr(v_def, v_end);
  EXECUTE v_def;
END
$patch_alignment$;

-- ── 3. Guarda de versão do strap_sourcing ──────────────────────────────────
DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_version_and_guard_sale_order_item_strap_sourcing()'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_pattern text := 'OR nullif\(v_value->>''strap_variant_id'',''''\) IS NULL THEN';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'guarda strap_sourcing: ancora da variante obrigatoria nao encontrada/unica';
  END IF;
  v_def := regexp_replace(
    v_def,
    v_pattern,
    E'OR (nullif(v_value->>''strap_variant_id'','''') IS NULL\n'
    || E'           -- strap_comprar_pronto_so_registra_20270101036100: registro de napa\n'
    || E'           AND NOT (v_value->>''source_mode'' = ''buy_ready''\n'
    || E'             AND nullif(v_value->>''finished_product_id'','''') IS NULL\n'
    || E'             AND nullif(v_value->>''recipe_id'','''') IS NULL\n'
    || E'             AND nullif(v_value->>''base_product_id'','''') IS NULL)) THEN'
  );
  EXECUTE v_def;
END
$patch_guard$;

-- ── 4. Prévia base: não resolve catálogo/variante da napa comprada pronta ──
DO $patch_preview_base$
DECLARE
  v_fn regprocedure := 'public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_catalog_anchor text :=
    'IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN';
  v_variant_pattern text :=
    'AND v_source IS NOT NULL AND v_selected_variant_id IS NULL THEN';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_catalog_anchor IN v_def) = 0
     OR position(v_catalog_anchor IN substr(v_def, position(v_catalog_anchor IN v_def) + 1)) > 0
     OR (SELECT count(*) FROM regexp_matches(v_def, v_variant_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'preview base: ancoras nao encontradas/unicas';
  END IF;
  v_def := replace(
    v_def,
    v_catalog_anchor,
    E'IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL\n'
    || E'       -- strap_comprar_pronto_so_registra_20270101036100: tira de napa\n'
    || E'       -- comprada pronta só registra cor + metros (sem catálogo/variante).\n'
    || E'       AND NOT (v_identity_basis = ''reference_base'' AND v_source = ''buy_ready'') THEN'
  );
  v_def := regexp_replace(
    v_def,
    v_variant_pattern,
    'AND v_source = ''internal'' AND v_selected_variant_id IS NULL THEN'
  );
  EXECUTE v_def;
END
$patch_preview_base$;

-- ── 5. Prévia autoritativa: ramo próprio da napa comprada pronta ───────────
DO $patch_preview_auth$
DECLARE
  v_fn regprocedure := 'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_branch_pattern text :=
    'IF v_line_basis = ''reference_base'' THEN(\s+v_main_color_id := )';
  v_frozen_pattern text :=
    'IF v_selected_variant_id IS NULL(\s+OR strap_variant_id IS DISTINCT FROM v_selected_variant_id\s+OR recipe_id IS DISTINCT FROM v_selected_recipe_id\s+OR base_product_id IS DISTINCT FROM v_selected_base_product_id) THEN';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_branch_pattern, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, v_frozen_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'preview autoritativo: ancoras nao encontradas/unicas';
  END IF;
  v_def := regexp_replace(
    v_def,
    v_branch_pattern,
    E'-- strap_comprar_pronto_so_registra_20270101036100: tira de napa comprada\n'
    || E'    -- pronta só registra cor da tira + metros — sem receita/napa/variante.\n'
    || E'    IF v_line_basis = ''reference_base'' AND v_selected_source = ''buy_ready'' THEN\n'
    || E'      v_main_color_id := public.resolve_strap_canonical_color_id(p_item ->> ''color'');\n'
    || E'      IF (v_line_color_mode = ''follow_main'' AND (\n'
    || E'           v_main_color_id IS NULL\n'
    || E'           OR v_line_color_id IS DISTINCT FROM v_main_color_id\n'
    || E'         ))\n'
    || E'         OR (v_line_color_mode = ''select_on_order'' AND v_line_color_id IS NULL)\n'
    || E'         OR v_selected_variant_id IS NOT NULL\n'
    || E'         OR v_selected_recipe_id IS NOT NULL\n'
    || E'         OR v_selected_base_product_id IS NOT NULL THEN\n'
    || E'        blocking_reasons := coalesce(blocking_reasons, ''[]''::jsonb)\n'
    || E'          || jsonb_build_array(jsonb_build_object(\n'
    || E'            ''code'', ''buy_ready_registro_invalido'',\n'
    || E'            ''field'', ''strap_sourcing'',\n'
    || E'            ''message'', ''A tira comprada pronta registra so a cor da tira e os metros.''\n'
    || E'          ));\n'
    || E'      END IF;\n'
    || E'    ELSIF v_line_basis = ''reference_base'' THEN\\1'
  );
  v_def := regexp_replace(
    v_def,
    v_frozen_pattern,
    E'IF NOT (v_line_basis = ''reference_base'' AND v_selected_source = ''buy_ready'')\n'
    || E'       AND (v_selected_variant_id IS NULL\\1) THEN'
  );
  EXECUTE v_def;
END
$patch_preview_auth$;

-- ── 6. Identidade comprometida: registro de napa é válido ───────────────────
DO $patch_committed$
DECLARE
  v_fn regprocedure := 'private.resolve_committed_strap_identity(uuid,uuid,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_anchor text := '  ELSIF v_variant_id IS NULL THEN';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_anchor IN v_def) = 0
     OR position(v_anchor IN substr(v_def, position(v_anchor IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION 'identidade comprometida: ancora nao encontrada/unica';
  END IF;
  v_def := replace(
    v_def,
    v_anchor,
    E'  -- strap_comprar_pronto_so_registra_20270101036100: tira de napa comprada\n'
    || E'  -- pronta só registra cor + metros (sem variante e sem SKU).\n'
    || E'  ELSIF v_source_mode = ''buy_ready''\n'
    || E'     AND v_variant_id IS NULL\n'
    || E'     AND public.try_parse_uuid(v_selection ->> ''finished_product_id'') IS NULL\n'
    || E'     AND public.try_parse_uuid(v_selection ->> ''color_id'') IS NOT NULL THEN\n'
    || E'    v_finished_product_id := NULL;\n'
    || E'    v_variant_measure_id := NULL;\n'
    || E'    v_variant_color_id := public.try_parse_uuid(v_selection ->> ''color_id'');\n'
    || E'    v_variant_base_group_id := public.try_parse_uuid(v_selection ->> ''base_group_id'');\n'
    || E'    v_variant_identity_basis := ''reference_base'';\n'
    || v_anchor
  );
  EXECUTE v_def;
END
$patch_committed$;

-- ── 7. Fila de demanda: tira de napa comprada pronta nunca vira demanda/OC ──
DO $patch_enqueue$
DECLARE
  v_fn regprocedure := 'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_pattern text :=
    'WHERE NOT \((\s+)p\.source_mode = ''buy_ready''(\s+)AND p\.strap_variant_id IS NULL';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, v_pattern, 'g')) <> 1 THEN
    RAISE EXCEPTION 'enqueue: ancora do filtro buy_ready nao encontrada/unica';
  END IF;
  v_def := regexp_replace(
    v_def,
    v_pattern,
    E'WHERE NOT (\\1p.source_mode = ''buy_ready''\\2'
    || E'-- strap_comprar_pronto_so_registra_20270101036100: tira de napa\\2'
    || E'-- comprada pronta só registra cor + metros; não vira demanda/OC.\\2'
    || E'AND (coalesce(p.resolved ->> ''identity_basis'', ''reference_base'') = ''reference_base''\\2'
    || E'     OR p.strap_variant_id IS NULL)'
  );
  EXECUTE v_def;
END
$patch_enqueue$;

-- ── 8. Custeio: tira de napa comprada pronta fica fora, com aviso ───────────
DO $patch_cost$
DECLARE
  v_fn regprocedure := 'public.calculate_order_cost_item(uuid,boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_assign_anchor text := '  v_strap_colors := v_item.strap_colors;';
  v_loop_anchor text := E'  FOR v_strap IN\n    SELECT sn.product_id, sn.required_m';
BEGIN
  IF position('strap_comprar_pronto_so_registra_20270101036100' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_assign_anchor IN v_def) = 0
     OR position(v_assign_anchor IN substr(v_def, position(v_assign_anchor IN v_def) + 1)) > 0
     OR position(v_loop_anchor IN v_def) = 0
     OR position(v_loop_anchor IN substr(v_def, position(v_loop_anchor IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION 'custeio: ancoras nao encontradas/unicas';
  END IF;
  -- order_strap_needs ignora pv_origem: sem este filtro a tira de napa
  -- comprada pronta seria custeada pelo SKU legado do grupo (ex.: OVERLOCK
  -- COBRE a R$ 20,49/m). Decisão do dono (D14): sem custo, com aviso.
  v_def := replace(
    v_def,
    v_assign_anchor,
    E'  -- strap_comprar_pronto_so_registra_20270101036100\n'
    || E'  SELECT coalesce(jsonb_agg(l.value) FILTER (WHERE NOT (\n'
    || E'           coalesce(nullif(l.value ->> ''identity_basis'', ''''), ''reference_base'') = ''reference_base''\n'
    || E'           AND l.value ->> ''pv_origem'' = ''sku_acabado'')), ''[]''::jsonb)\n'
    || E'    INTO v_strap_colors\n'
    || E'    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_item.strap_colors) = ''array''\n'
    || E'      THEN v_item.strap_colors ELSE ''[]''::jsonb END) l(value);'
  );
  v_def := replace(
    v_def,
    v_loop_anchor,
    E'  -- strap_comprar_pronto_so_registra_20270101036100: linha zerada + aviso.\n'
    || E'  SELECT coalesce(v_breakdown_materials, ''[]''::jsonb) || coalesce(jsonb_agg(jsonb_build_object(\n'
    || E'           ''product_id'', NULL,\n'
    || E'           ''product_name'', concat_ws('' · '', coalesce(nullif(l.value ->> ''label'', ''''), ''TIRA''),\n'
    || E'             nullif(l.value ->> ''base_group_name'', ''''), nullif(l.value ->> ''color'', '''')),\n'
    || E'           ''component'', ''Tira'',\n'
    || E'           ''required'', public.calculate_strap_line_required_m(l.value, v_qty, v_grade),\n'
    || E'           ''consumption_unit'', ''m'',\n'
    || E'           ''unit_price'', 0,\n'
    || E'           ''subtotal'', 0,\n'
    || E'           ''strap_price_source'', ''buy_ready_no_cost'',\n'
    || E'           ''conversion_warning'', ''sem_custo_comprada_pronta'')), ''[]''::jsonb),\n'
    || E'         count(*)\n'
    || E'    INTO v_breakdown_materials, v_buy_ready_strap_count\n'
    || E'    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_item.strap_colors) = ''array''\n'
    || E'      THEN v_item.strap_colors ELSE ''[]''::jsonb END) l(value)\n'
    || E'   WHERE coalesce(nullif(l.value ->> ''identity_basis'', ''''), ''reference_base'') = ''reference_base''\n'
    || E'     AND l.value ->> ''pv_origem'' = ''sku_acabado'';\n'
    || E'  IF v_buy_ready_strap_count > 0 THEN\n'
    || E'    v_warnings := array_append(v_warnings,\n'
    || E'      ''tira_comprada_pronta_sem_custo:'' || v_buy_ready_strap_count);\n'
    || E'  END IF;\n'
    || v_loop_anchor
  );
  v_def := replace(
    v_def,
    E'  v_strap_colors jsonb;\n',
    E'  v_strap_colors jsonb;\n  v_buy_ready_strap_count integer := 0;\n'
  );
  IF position('v_buy_ready_strap_count integer' IN v_def) = 0 THEN
    RAISE EXCEPTION 'custeio: declaracao de v_strap_colors nao encontrada';
  END IF;
  EXECUTE v_def;
END
$patch_cost$;
