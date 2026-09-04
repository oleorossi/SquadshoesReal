-- =============================================================================
-- Cores independentes por linha de tira no PV
--
-- A identidade/origem continua sendo definida por identity_basis. Esta migration
-- separa a politica de cor:
--   follow_main     -> herda a cor principal do item (default legado);
--   select_on_order -> usa o color_id canonico escolhido naquela linha do PV.
--
-- technical_strap_line_id continua sendo a identidade logica. A napa-base e a
-- medida continuam vindo da ficha/variante; somente a cor pode variar por linha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. A ficha aceita somente as duas politicas canonicas. Ausencia continua
--    valida para linhas legadas e recebe o default no cliente/writer; um valor
--    explicito invalido (inclusive follow_main em produto pronto) e recusado.
-- -----------------------------------------------------------------------------

DO $patch_technical_sheet_policy$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.tg_validate_technical_strap_identity()'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    $old$  v_basis text;
  v_group_id uuid;$old$;
  v_new_declaration constant text :=
    $new$  v_basis text;
  -- independent_strap_colors_20270101015400
  v_color_mode text;
  v_group_id uuid;$new$;
  v_old_basis_guard constant text :=
    $old$    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
    END IF;

    BEGIN$old$;
  v_new_basis_guard constant text :=
    $new$    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
    END IF;
    v_color_mode := nullif(v_line ->> 'color_mode', '');
    IF v_color_mode IS NOT NULL
       AND v_color_mode NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui color_mode invalido';
    END IF;
    IF v_basis = 'finished_product_group'
       AND v_color_mode = 'follow_main' THEN
      RAISE EXCEPTION 'Tira comprada pronta exige color_mode select_on_order';
    END IF;

    BEGIN$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: guard de identidade da ficha ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_declaration, '')))
      / length(v_old_declaration);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch da declaracao do guard da ficha encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_declaration, v_new_declaration);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_basis_guard, '')))
      / length(v_old_basis_guard);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch da politica no guard da ficha encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_basis_guard, v_new_basis_guard);
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR position($needle$v_color_mode NOT IN ('follow_main', 'select_on_order')$needle$
          IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Regressao: ficha nao valida a politica de cor da tira';
  END IF;
END
$patch_technical_sheet_policy$;

-- -----------------------------------------------------------------------------
-- 1. O materializador existente passa a aceitar um subconjunto exato de linhas.
--    O writer o chama uma vez por linha/cor, mantendo locks e auditoria existentes
--    sem criar combinacoes de medida x cor que o pedido nao solicitou.
-- -----------------------------------------------------------------------------

DO $patch_internal_intent_subset$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.ensure_sale_order_internal_strap_intents(uuid,uuid,uuid,uuid[])'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    $old$  v_pinned_base_product_id uuid;
  v_official public.base_material_color_official_products%ROWTYPE;$old$;
  v_new_declaration constant text :=
    $new$  v_pinned_base_product_id uuid;
  -- independent_strap_colors_20270101015400: o pin fisico vale somente
  -- quando a linha segue a cor principal. Uma linha independente preserva o
  -- mesmo grupo-base, mas resolve o SKU oficial da propria cor.
  v_enforce_pinned_product boolean := true;
  v_official public.base_material_color_official_products%ROWTYPE;$new$;
  v_old_expected_set constant text :=
    $old$  IF v_expected_sorted IS DISTINCT FROM v_reference_sorted THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do pedido; recarregue antes de cadastrar as tiras'
      USING ERRCODE = '40001';
  END IF;$old$;
  v_new_expected_set constant text :=
    $new$  -- O chamador pode materializar uma cor por vez, mas nunca pode pedir uma
  -- linha inexistente, repetida ou vazia. O conjunto completo continua sendo
  -- validado antes pelo writer do item.
  IF cardinality(v_expected_sorted) = 0
     OR cardinality(v_expected_sorted) IS DISTINCT FROM (
       SELECT count(DISTINCT expected_id)::integer
         FROM unnest(v_expected_sorted) expected_id
     )
     OR EXISTS (
       SELECT 1
         FROM unnest(v_expected_sorted) expected_id
        WHERE NOT expected_id = ANY(v_reference_sorted)
     ) THEN
    RAISE EXCEPTION 'As linhas de tira pedidas nao pertencem exatamente a ficha vigente'
      USING ERRCODE = '40001';
  END IF;$new$;
  v_old_pin_resolution constant text :=
    $old$  v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
    p_reference_id, p_material_variant_id);

  IF v_pinned_base_product_id IS NOT NULL THEN$old$;
  v_new_pin_resolution constant text :=
    $new$  v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
    p_reference_id, p_material_variant_id);

  SELECT coalesce(bool_or(
           coalesce(nullif(line.value ->> 'color_mode', ''), 'follow_main')
             = 'follow_main'
         ), false)
    INTO v_enforce_pinned_product
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
        THEN v_sheet.strap_colors ELSE '[]'::jsonb END
    ) line(value)
   WHERE coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base')
           = 'reference_base'
     AND line.value ->> 'technical_strap_line_id' IN (
       SELECT expected_id::text
         FROM unnest(coalesce(p_expected_line_ids, ARRAY[]::uuid[])) expected_id
     );

  IF v_pinned_base_product_id IS NOT NULL
     AND v_enforce_pinned_product THEN$new$;
  v_old_official_pin constant text :=
    $old$  IF v_official.id IS NOT NULL
     AND v_pinned_base_product_id IS NOT NULL
     AND v_official.official_product_id IS DISTINCT FROM v_pinned_base_product_id THEN$old$;
  v_new_official_pin constant text :=
    $new$  IF v_official.id IS NOT NULL
     AND v_enforce_pinned_product
     AND v_pinned_base_product_id IS NOT NULL
     AND v_official.official_product_id IS DISTINCT FROM v_pinned_base_product_id THEN$new$;
  v_old_candidate_pin constant text :=
    $old$  IF v_official.id IS NULL THEN
    IF v_pinned_base_product_id IS NOT NULL THEN$old$;
  v_new_candidate_pin constant text :=
    $new$  IF v_official.id IS NULL THEN
    IF v_enforce_pinned_product AND v_pinned_base_product_id IS NOT NULL THEN$new$;
  v_old_line_filter constant text :=
    $old$     WHERE coalesce(nullif(entry.value ->> 'identity_basis', ''), 'reference_base')
       = 'reference_base'
     ORDER BY entry.value ->> 'measure_id', entry.ordinality$old$;
  v_new_line_filter constant text :=
    $new$     WHERE coalesce(nullif(entry.value ->> 'identity_basis', ''), 'reference_base')
       = 'reference_base'
       AND (entry.value ->> 'technical_strap_line_id')::uuid
           = ANY(coalesce(p_expected_line_ids, ARRAY[]::uuid[]))
     ORDER BY entry.value ->> 'measure_id', entry.ordinality$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: materializador de tiras internas ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_declaration, '')))
      / length(v_old_declaration);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch de declaracao do materializador encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_declaration, v_new_declaration);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_expected_set, '')))
      / length(v_old_expected_set);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch do subconjunto de linhas encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_expected_set, v_new_expected_set);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_pin_resolution, '')))
      / length(v_old_pin_resolution);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch da politica do pin encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_pin_resolution, v_new_pin_resolution);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_official_pin, '')))
      / length(v_old_official_pin);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch do SKU oficial pinado encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_official_pin, v_new_official_pin);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_candidate_pin, '')))
      / length(v_old_candidate_pin);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch do candidato pinado encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_candidate_pin, v_new_candidate_pin);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_line_filter, '')))
      / length(v_old_line_filter);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'Patch do filtro por UUID encontrou % ocorrencias', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_line_filter, v_new_line_filter);

    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR position('= ANY(coalesce(p_expected_line_ids' IN v_definition) = 0
     OR position('v_enforce_pinned_product' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Regressao: materializador nao aceita cor por linha';
  END IF;
END
$patch_internal_intent_subset$;

-- -----------------------------------------------------------------------------
-- 2. Writer atomico: reidrata color_mode da ficha e materializa cada linha
--    reference_base com o color_id que sua politica determina.
-- -----------------------------------------------------------------------------

DO $patch_prepare_item$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.prepare_sale_order_item_internal_straps(jsonb)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    $old$  v_ensure jsonb;
  v_ensured_line jsonb;$old$;
  v_new_declaration constant text :=
    $new$  v_ensure jsonb;
  -- independent_strap_colors_20270101015400
  v_ensure_lines jsonb := '[]'::jsonb;
  v_color_mode text;
  v_ensured_line jsonb;$new$;
  v_old_frozen_snapshot constant text :=
    $old$       AND v_straps IS NOT DISTINCT FROM coalesce(v_current.strap_colors, '[]'::jsonb) THEN$old$;
  v_new_frozen_snapshot constant text :=
    $new$       AND (
         SELECT coalesce(
                  jsonb_agg(line.value ORDER BY
                    coalesce(
                      nullif(line.value ->> 'technical_strap_line_id', ''),
                      nullif(line.value ->> 'id', ''),
                      line.value::text
                    ),
                    line.value::text
                  ),
                  '[]'::jsonb
                )
           FROM jsonb_array_elements(v_straps) line(value)
       ) IS NOT DISTINCT FROM (
         SELECT coalesce(
                  jsonb_agg(line.value ORDER BY
                    coalesce(
                      nullif(line.value ->> 'technical_strap_line_id', ''),
                      nullif(line.value ->> 'id', ''),
                      line.value::text
                    ),
                    line.value::text
                  ),
                  '[]'::jsonb
                )
           FROM jsonb_array_elements(
             coalesce(v_current.strap_colors, '[]'::jsonb)
           ) line(value)
       ) THEN$new$;
  v_old_frozen_return constant text :=
    $old$        'item', p_item || jsonb_build_object(
          'strap_sourcing', coalesce(v_current.strap_sourcing, '{}'::jsonb),
          'strap_sourcing_revision', v_current.strap_sourcing_revision
        ),$old$;
  v_new_frozen_return constant text :=
    $new$        'item', p_item || jsonb_build_object(
          -- O snapshot comprometido e um fato historico completo: alem da
          -- origem, preserve tambem a sequencia tecnica persistida. A
          -- comparacao acima aceita o mesmo multiconjunto em qualquer ordem
          -- apenas para reconhecer um update estruturalmente inalterado.
          'strap_colors', coalesce(v_current.strap_colors, '[]'::jsonb),
          'strap_sourcing', coalesce(v_current.strap_sourcing, '{}'::jsonb),
          'strap_sourcing_revision', v_current.strap_sourcing_revision
        ),$new$;
  v_old_policy_anchor constant text :=
    $old$    IF v_sheet_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui base de identidade invalida';
    END IF;
    BEGIN$old$;
  v_new_policy_anchor constant text :=
    $new$    IF v_sheet_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui base de identidade invalida';
    END IF;
    IF nullif(v_sheet_line ->> 'color_mode', '') IS NOT NULL
       AND v_sheet_line ->> 'color_mode' NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui politica de cor invalida';
    END IF;
    v_color_mode := CASE
      WHEN v_sheet_basis = 'finished_product_group' THEN 'select_on_order'
      ELSE coalesce(nullif(v_sheet_line ->> 'color_mode', ''), 'follow_main')
    END;
    BEGIN$new$;
  v_old_identity_fields constant text :=
    $old$        - 'identity_basis' - 'identity_group_id'
        - 'group_id' - 'group_name'$old$;
  v_new_identity_fields constant text :=
    $new$        - 'identity_basis' - 'identity_group_id' - 'color_mode'
        - 'group_id' - 'group_name'$new$;
  v_old_identity_object constant text :=
    $old$        'identity_group_id', CASE WHEN v_sheet_basis = 'finished_product_group'
          THEN v_identity_group_id ELSE NULL END,
        'group_id', nullif(v_sheet_line ->> 'group_id', ''),$old$;
  v_new_identity_object constant text :=
    $new$        'identity_group_id', CASE WHEN v_sheet_basis = 'finished_product_group'
          THEN v_identity_group_id ELSE NULL END,
        'color_mode', v_color_mode,
        'group_id', nullif(v_sheet_line ->> 'group_id', ''),$new$;
  v_old_snapshot_order constant text :=
    $old$  v_straps := v_basis_aligned_straps;$old$;
  v_new_snapshot_order constant text :=
    $new$  -- A sequencia da ficha e autoritativa para itens novos/editaveis.
  -- O UUID identifica a contribuicao, mas sua ordenacao lexical nao representa
  -- TIRA 1/2/3. Snapshots comprometidos ja retornaram no ramo congelado acima.
  SELECT coalesce(
           jsonb_agg(item_line.value ORDER BY sheet_line.ordinality),
           '[]'::jsonb
         )
    INTO v_straps
    FROM jsonb_array_elements(v_sheet_lines)
           WITH ORDINALITY sheet_line(value, ordinality)
    JOIN jsonb_array_elements(v_basis_aligned_straps) item_line(value)
      ON item_line.value ->> 'technical_strap_line_id'
         = sheet_line.value ->> 'technical_strap_line_id';$new$;
  v_old_main_color_gate constant text :=
    $old$  IF cardinality(v_expected_line_ids) > 0 THEN$old$;
  v_new_main_color_gate constant text :=
    $new$  -- select_on_order_only_main_color_optional_20270101015400
  -- A cor principal so participa das linhas follow_main. Uma ficha composta
  -- exclusivamente por select_on_order deve aceitar qualquer descricao de cor
  -- principal, pois cada UUID ja carrega uma cor canonica independente.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_straps) line(value)
     WHERE coalesce(
             nullif(line.value ->> 'identity_basis', ''),
             'reference_base'
           ) = 'reference_base'
       AND coalesce(
             nullif(line.value ->> 'color_mode', ''),
             'follow_main'
           ) = 'follow_main'
  ) THEN$new$;
  v_old_global_ensure constant text :=
    $old$    v_ensure := public.ensure_sale_order_internal_strap_intents(
      v_reference_id, v_material_variant_id, v_color_id, v_expected_line_ids
    );$old$;
  v_new_global_ensure constant text :=
    $new$    -- Cada UUID sera materializado abaixo com sua propria cor.
    v_ensure := jsonb_build_object('lines', '[]'::jsonb);$new$;
  v_old_reference_start constant text :=
    $old$    IF v_sheet_basis = 'reference_base' THEN
      SELECT value INTO v_ensured_line$old$;
  v_new_reference_start constant text :=
    $new$    IF v_sheet_basis = 'reference_base' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
      IF v_color_mode = 'follow_main' THEN
        v_line_color_id := v_color_id;
        v_line_color_name := v_color_name;
      ELSIF v_color_mode = 'select_on_order' THEN
        BEGIN
          v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Modelo % / %, %: cor invalida',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END;
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: selecione a cor no Pedido de Venda',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
        SELECT c.name INTO v_line_color_name
          FROM public.canonical_colors c
         WHERE c.id = v_line_color_id AND c.active
         FOR SHARE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modelo % / %, %: a cor selecionada nao existe ou esta inativa',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSE
        RAISE EXCEPTION 'Modelo % / %, %: politica de cor invalida',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;

      BEGIN
        v_ensure := public.ensure_sale_order_internal_strap_intents(
          v_reference_id, v_material_variant_id, v_line_color_id, ARRAY[v_line_id]
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Modelo % / %, %: %',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA'),
          SQLERRM
          USING ERRCODE = SQLSTATE;
      END;
      v_ensure_lines := v_ensure_lines
        || coalesce(v_ensure -> 'lines', '[]'::jsonb);

      SELECT value INTO v_ensured_line$new$;
  v_old_reference_color constant text :=
    $old$      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_color_name, 'color_id', v_color_id
      );$old$;
  v_new_reference_color constant text :=
    $new$      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );$new$;
  v_old_source_color constant text :=
    $old$          'source_mode', 'internal',
          'color_id', v_color_id,$old$;
  v_new_source_color constant text :=
    $new$          'source_mode', 'internal',
          'color_id', v_line_color_id,$new$;
  v_old_return_lines constant text :=
    $old$    'ensured', v_ensure -> 'lines',$old$;
  v_new_return_lines constant text :=
    $new$    'ensured', v_ensure_lines,$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: writer de tiras do item ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_declaration, '')))
      / length(v_old_declaration);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer declaracao: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_declaration, v_new_declaration);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_frozen_snapshot, '')))
      / length(v_old_frozen_snapshot);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer snapshot congelado: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_frozen_snapshot, v_new_frozen_snapshot);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_frozen_return, '')))
      / length(v_old_frozen_return);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer retorno congelado: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_frozen_return, v_new_frozen_return);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_policy_anchor, '')))
      / length(v_old_policy_anchor);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer politica: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_policy_anchor, v_new_policy_anchor);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_identity_fields, '')))
      / length(v_old_identity_fields);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer campos: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_identity_fields, v_new_identity_fields);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_identity_object, '')))
      / length(v_old_identity_object);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer snapshot: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_identity_object, v_new_identity_object);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_snapshot_order, '')))
      / length(v_old_snapshot_order);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer ordem tecnica: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_snapshot_order, v_new_snapshot_order);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_main_color_gate, '')))
      / length(v_old_main_color_gate);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer gate da cor principal: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_main_color_gate, v_new_main_color_gate);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_global_ensure, '')))
      / length(v_old_global_ensure);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer ensure global: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_global_ensure, v_new_global_ensure);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_reference_start, '')))
      / length(v_old_reference_start);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer por linha: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_reference_start, v_new_reference_start);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_reference_color, '')))
      / length(v_old_reference_color);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer cor: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_reference_color, v_new_reference_color);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_source_color, '')))
      / length(v_old_source_color);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer sourcing: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_source_color, v_new_source_color);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_return_lines, '')))
      / length(v_old_return_lines);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch writer retorno: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_return_lines, v_new_return_lines);

    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR position($needle$'color_mode', v_color_mode$needle$ IN v_definition) = 0
     OR position('ARRAY[v_line_id]' IN v_definition) = 0
     OR position('v_line_color_id' IN v_definition) = 0
     OR position('jsonb_agg(item_line.value ORDER BY sheet_line.ordinality)'
          IN v_definition) = 0
     OR position('jsonb_agg(line.value ORDER BY' IN v_definition) = 0
     OR position('select_on_order_only_main_color_optional_20270101015400'
          IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Regressao: writer nao preserva politica/cor por UUID';
  END IF;
END
$patch_prepare_item$;

-- -----------------------------------------------------------------------------
-- 3. Guard da linha persistida: politica vem da ficha; follow_main compara com
--    a cor principal, select_on_order valida a cor individual e o SKU oficial
--    do mesmo grupo-base sem exigir o produto pinado de outra cor.
-- -----------------------------------------------------------------------------

DO $patch_item_guard$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.tg_validate_sale_order_item_strap_color_alignment()'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    $old$  v_basis text;
  v_measure_id uuid;$old$;
  v_new_declaration constant text :=
    $new$  v_basis text;
  -- independent_strap_colors_20270101015400
  v_color_mode text;
  v_measure_id uuid;$new$;
  v_old_policy_anchor constant text :=
    $old$    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    BEGIN$old$;
  v_new_policy_anchor constant text :=
    $new$    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF nullif(v_sheet_line ->> 'color_mode', '') IS NOT NULL
       AND v_sheet_line ->> 'color_mode' NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui politica de cor invalida';
    END IF;
    v_color_mode := CASE
      WHEN v_basis = 'finished_product_group' THEN 'select_on_order'
      ELSE coalesce(nullif(v_sheet_line ->> 'color_mode', ''), 'follow_main')
    END;
    BEGIN$new$;
  v_old_structure constant text :=
    $old$       OR nullif(v_line ->> 'identity_basis', '') IS DISTINCT FROM v_basis
       OR nullif(v_line ->> 'group_id', '')$old$;
  v_new_structure constant text :=
    $new$       OR nullif(v_line ->> 'identity_basis', '') IS DISTINCT FROM v_basis
       OR coalesce(
            nullif(v_line ->> 'color_mode', ''),
            CASE WHEN v_basis = 'finished_product_group'
              THEN 'select_on_order' ELSE 'follow_main' END
          ) IS DISTINCT FROM v_color_mode
       OR nullif(v_line ->> 'group_id', '')$new$;
  v_old_internal_condition constant text :=
    $old$      IF v_expected_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_expected_color_id
         OR v_source_mode IS DISTINCT FROM 'internal'$old$;
  v_new_internal_condition constant text :=
    $new$      IF (v_color_mode = 'follow_main' AND (
            v_expected_color_id IS NULL
            OR v_line_color_id IS DISTINCT FROM v_expected_color_id
          ))
         OR (v_color_mode = 'select_on_order' AND v_line_color_id IS NULL)
         OR v_source_mode IS DISTINCT FROM 'internal'$new$;
  v_old_pin_clause constant text :=
    $old$           AND (v_pinned_base_product_id IS NULL
             OR op.official_product_id = v_pinned_base_product_id)$old$;
  v_new_pin_clause constant text :=
    $new$           AND (v_color_mode <> 'follow_main'
             OR v_pinned_base_product_id IS NULL
             OR op.official_product_id = v_pinned_base_product_id)$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: trigger guard das tiras ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_declaration, '')))
      / length(v_old_declaration);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch guard declaracao: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_declaration, v_new_declaration);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_policy_anchor, '')))
      / length(v_old_policy_anchor);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch guard politica: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_policy_anchor, v_new_policy_anchor);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_structure, '')))
      / length(v_old_structure);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch guard estrutura: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_structure, v_new_structure);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_internal_condition, '')))
      / length(v_old_internal_condition);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch guard condicao: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_internal_condition, v_new_internal_condition);

    -- Dentro do ramo reference_base, variante, produto acabado, designacao
    -- oficial e produto-base devem usar a cor da propria linha.
    v_occurrences := (length(v_patched) - length(replace(
      v_patched, '= v_expected_color_id', ''
    ))) / length('= v_expected_color_id');
    IF v_occurrences <> 4 THEN
      RAISE EXCEPTION 'Patch guard cor fisica esperava 4 usos, encontrou %', v_occurrences;
    END IF;
    v_patched := replace(v_patched, '= v_expected_color_id', '= v_line_color_id');

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_pin_clause, '')))
      / length(v_old_pin_clause);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch guard pin: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_pin_clause, v_new_pin_clause);

    v_patched := replace(
      v_patched,
      'Tira interna deve usar cor, origem e napa exatas do cabedal',
      'Tira interna deve usar a cor exigida pela ficha, origem internal e napa exata'
    );
    v_patched := replace(
      v_patched,
      'Variante interna nao corresponde a medida/napa/cor do cabedal',
      'Variante interna nao corresponde a medida/napa/cor da linha'
    );

    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR position('v_line_color_id' IN v_definition) = 0
     OR position($needle$v_color_mode <> 'follow_main'$needle$ IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Regressao: guard nao valida politica/cor por linha';
  END IF;
END
$patch_item_guard$;

-- -----------------------------------------------------------------------------
-- 4. Preview prospectivo: usa a politica autoritativa da ficha. Demandas ja
--    persistidas continuam congeladas e passam pelo ramo historico existente.
-- -----------------------------------------------------------------------------

DO $patch_demand_preview$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.preview_sale_order_strap_demand_draft(jsonb)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_declaration constant text :=
    $old$  v_line_basis text;
  v_line_color_id uuid;$old$;
  v_new_declaration constant text :=
    $new$  v_line_basis text;
  -- independent_strap_colors_20270101015400
  v_line_color_mode text;
  v_sheet_line jsonb;
  v_line_color_id uuid;$new$;
  v_old_authorization_anchor constant text :=
    $old$BEGIN
  BEGIN
    v_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;$old$;
  v_new_authorization_anchor constant text :=
    $new$BEGIN
  -- O wrapper tambem fecha explicitamente a fronteira SECURITY DEFINER. O
  -- preview-base possui a mesma defesa, mas ela nao deve ser a unica barreira
  -- caso a implementacao delegada seja substituida no futuro.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;$new$;
  v_old_selection_end constant text :=
    $old$     WHERE line.value ->> 'technical_strap_line_id' = v_line_id::text;
    v_selected_source := v_selection ->> 'source_mode';$old$;
  v_new_selection_end constant text :=
    $new$     WHERE line.value ->> 'technical_strap_line_id' = v_line_id::text;

    SELECT entry.value INTO v_sheet_line
      FROM public.technical_sheets ts
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
          THEN ts.strap_colors ELSE '[]'::jsonb END
      ) entry(value)
     WHERE ts.id = v_reference_id
       AND entry.value ->> 'technical_strap_line_id' = v_line_id::text
     LIMIT 1;
    IF FOUND THEN
      v_line_basis := coalesce(
        nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    END IF;
    v_line_color_mode := CASE
      WHEN v_line_basis = 'finished_product_group' THEN 'select_on_order'
      WHEN coalesce(nullif(v_sheet_line ->> 'color_mode', ''), 'follow_main')
           = 'select_on_order' THEN 'select_on_order'
      ELSE 'follow_main'
    END;

    v_selected_source := v_selection ->> 'source_mode';$new$;
  v_old_draft_early_return constant text :=
    $old$    IF NOT v_is_persisted OR v_line_id IS NULL THEN
      RETURN NEXT;
      CONTINUE;
    END IF;$old$;
  v_new_draft_early_return constant text :=
    $new$    -- Rascunhos com UUID tambem passam pela politica autoritativa abaixo.
    -- Somente uma linha estruturalmente sem UUID conserva o resultado diagnostico
    -- do motor-base, que ja a marca como bloqueada.
    IF v_line_id IS NULL THEN
      RETURN NEXT;
      CONTINUE;
    END IF;$new$;
  v_old_reference_condition constant text :=
    $old$      IF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL
         OR v_main_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_main_color_id THEN$old$;
  v_new_reference_condition constant text :=
    $new$      IF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL
         OR (v_line_color_mode = 'follow_main' AND (
           v_main_color_id IS NULL
           OR v_line_color_id IS DISTINCT FROM v_main_color_id
         ))
         OR (v_line_color_mode = 'select_on_order'
           AND v_line_color_id IS NULL) THEN$new$;
  v_old_pin_condition constant text :=
    $old$      IF v_pinned_base_product_id IS NOT NULL
         AND v_selected_base_product_id IS DISTINCT FROM
             v_pinned_base_product_id THEN$old$;
  v_new_pin_condition constant text :=
    $new$      IF v_line_color_mode = 'follow_main'
         AND v_pinned_base_product_id IS NOT NULL
         AND v_selected_base_product_id IS DISTINCT FROM
             v_pinned_base_product_id THEN$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: preview canonico de tiras ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_declaration, '')))
      / length(v_old_declaration);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview declaracao: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_declaration, v_new_declaration);

    v_occurrences := (length(v_patched) - length(replace(
      v_patched, v_old_authorization_anchor, ''
    ))) / length(v_old_authorization_anchor);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview autorizacao: %', v_occurrences; END IF;
    v_patched := replace(
      v_patched, v_old_authorization_anchor, v_new_authorization_anchor
    );

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_selection_end, '')))
      / length(v_old_selection_end);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview politica: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_selection_end, v_new_selection_end);

    v_occurrences := (length(v_patched) - length(replace(
      v_patched, v_old_draft_early_return, ''
    ))) / length(v_old_draft_early_return);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview de rascunho: %', v_occurrences; END IF;
    v_patched := replace(
      v_patched, v_old_draft_early_return, v_new_draft_early_return
    );

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_reference_condition, '')))
      / length(v_old_reference_condition);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview condicao: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_reference_condition, v_new_reference_condition);

    v_occurrences := (length(v_patched) - length(replace(v_patched, v_old_pin_condition, '')))
      / length(v_old_pin_condition);
    IF v_occurrences <> 1 THEN RAISE EXCEPTION 'Patch preview pin: %', v_occurrences; END IF;
    v_patched := replace(v_patched, v_old_pin_condition, v_new_pin_condition);

    v_patched := replace(
      v_patched,
      'A tira da napa deve usar a cor principal e producao interna.',
      'A tira interna deve usar a cor exigida pela ficha e producao interna.'
    );
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR position('IF NOT public.is_approved_user()' IN v_definition) = 0
     OR position($needle$v_line_color_mode = 'select_on_order'$needle$ IN v_definition) = 0
     OR position($needle$v_line_color_mode = 'follow_main'$needle$ IN v_definition) = 0
     OR position('IF NOT v_is_persisted OR v_line_id IS NULL' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Regressao: preview nao respeita politica por linha';
  END IF;
END
$patch_demand_preview$;

-- -----------------------------------------------------------------------------
-- 5. A promocao compara tambem color_mode ao detectar ficha alterada entre o
--    save do rascunho e a confirmacao. Sem isto, trocar follow_main por
--    select_on_order poderia reaproveitar silenciosamente a cor antiga.
-- -----------------------------------------------------------------------------

DO $patch_enqueue_structure$
DECLARE
  v_function regprocedure := to_regprocedure(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'
  );
  v_definition text;
  v_patched text;
  v_occurrences integer;
  v_old_identity_field constant text :=
    $old$              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'group_id',$old$;
  v_new_identity_field constant text :=
    $new$              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'color_mode', CASE
                WHEN coalesce(nullif(
                  line.value ->> 'identity_basis', ''), 'reference_base')
                    = 'finished_product_group' THEN 'select_on_order'
                ELSE coalesce(nullif(
                  line.value ->> 'color_mode', ''), 'follow_main')
              END,
              'group_id',$new$;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Preflight: enqueue das demandas de tiras ausente';
  END IF;
  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0 THEN
    v_patched := v_definition;
    v_occurrences := (length(v_patched) - length(replace(
      v_patched, v_old_identity_field, ''
    ))) / length(v_old_identity_field);
    IF v_occurrences <> 2 THEN
      RAISE EXCEPTION 'Patch estrutural do enqueue esperava 2 lados, encontrou %', v_occurrences;
    END IF;
    v_patched := replace(v_patched, v_old_identity_field, v_new_identity_field);

    -- Marcador no corpo, sem alterar a assinatura publica.
    v_patched := replace(
      v_patched,
      'AS $function$' || E'\nDECLARE',
      'AS $function$' || E'\n-- independent_strap_colors_20270101015400\nDECLARE'
    );
    EXECUTE v_patched;
  END IF;

  v_definition := pg_get_functiondef(v_function);
  IF position('independent_strap_colors_20270101015400' IN v_definition) = 0
     OR (
       length(v_definition) - length(replace(v_definition, $needle$'color_mode', CASE$needle$, ''))
     ) / length($needle$'color_mode', CASE$needle$) <> 2 THEN
    RAISE EXCEPTION 'Regressao: confirmacao nao compara color_mode nos dois snapshots';
  END IF;
END
$patch_enqueue_structure$;

-- Fronteiras de execucao preservadas explicitamente. Os tres primeiros helpers
-- sao internos/trigger; apenas o preview segue exposto ao usuario aprovado.
REVOKE ALL ON FUNCTION public.tg_validate_technical_strap_identity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.ensure_sale_order_internal_strap_intents(uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_sale_order_strap_demands(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_sale_order_internal_strap_intents(
  uuid, uuid, uuid, uuid[]
) IS 'Materializa atomicamente o subconjunto de linhas reference_base pedido, na cor canonica de cada chamada e no grupo-base da ficha/variante.';

COMMENT ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb) IS
  'Reidrata estrutura e color_mode da ficha e congela cor/origem por technical_strap_line_id antes do writer atomico do PV.';

-- Pos-condicoes que tambem protegem aplicacao do zero contra drift nos anchors.
DO $verify_independent_strap_colors$
DECLARE
  v_prepare text := pg_get_functiondef(
    'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure
  );
  v_guard text := pg_get_functiondef(
    'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure
  );
  v_preview text := pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  );
  v_ensure text := pg_get_functiondef(
    'public.ensure_sale_order_internal_strap_intents(uuid,uuid,uuid,uuid[])'::regprocedure
  );
  v_sheet_guard text := pg_get_functiondef(
    'public.tg_validate_technical_strap_identity()'::regprocedure
  );
  v_enqueue text := pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  );
BEGIN
  IF position($needle$'color_mode', v_color_mode$needle$ IN v_prepare) = 0
     OR position('ARRAY[v_line_id]' IN v_prepare) = 0
     OR position('v_ensure_lines' IN v_prepare) = 0
     OR position('jsonb_agg(item_line.value ORDER BY sheet_line.ordinality)'
          IN v_prepare) = 0
     OR position('jsonb_agg(line.value ORDER BY' IN v_prepare) = 0
     OR position('select_on_order_only_main_color_optional_20270101015400'
          IN v_prepare) = 0 THEN
    RAISE EXCEPTION 'Contrato final do writer de cores independentes ausente';
  END IF;
  IF position($needle$v_color_mode = 'select_on_order'$needle$ IN v_guard) = 0
     OR position('av.color_id = v_line_color_id' IN v_guard) = 0
     OR position('op.color_id = v_line_color_id' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Contrato final do guard de cores independentes ausente';
  END IF;
  IF position($needle$v_line_color_mode = 'select_on_order'$needle$ IN v_preview) = 0
     OR position('v_line_color_id IS NULL' IN v_preview) = 0
     OR position('IF NOT public.is_approved_user()' IN v_preview) = 0 THEN
    RAISE EXCEPTION 'Contrato final do preview de cores independentes ausente';
  END IF;
  IF position('= ANY(coalesce(p_expected_line_ids' IN v_ensure) = 0
     OR position('v_enforce_pinned_product' IN v_ensure) = 0 THEN
    RAISE EXCEPTION 'Contrato final do materializador por linha ausente';
  END IF;
  IF position($needle$v_color_mode NOT IN ('follow_main', 'select_on_order')$needle$
       IN v_sheet_guard) = 0
     OR position($needle$'color_mode', CASE$needle$ IN v_enqueue) = 0 THEN
    RAISE EXCEPTION 'Contrato final da politica estrutural de cor ausente';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.preview_sale_order_strap_demand_draft(jsonb)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.prepare_sale_order_item_internal_straps(jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACL das funcoes de tiras ficou permissiva';
  END IF;
END
$verify_independent_strap_colors$;
