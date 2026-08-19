-- A cor definida no item do PV e a intencao de fabricar as tiras artesanais
-- reference_base naquela mesma cor, usando a napa-base estrutural do cabedal.
--
-- Este writer cria somente a identidade exata pedida (medida + base + cor),
-- nunca uma matriz inteira. A operacao e atomica/idempotente e conserva as
-- tiras de grupo acabado (STRASS etc.) como buy_ready independentes.

-- Texto continua sendo apenas entrada de UX. Ele so vira identidade quando
-- casa de forma inequivoca com nome canonico ou alias previamente aprovado.
CREATE OR REPLACE FUNCTION public.resolve_strap_canonical_color_id(
  p_label text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matches AS (
    SELECT c.id
      FROM public.canonical_colors c
     WHERE c.active
       AND c.name_norm = public.normalize_strap_catalog_text(p_label)
    UNION
    SELECT a.canonical_color_id
      FROM public.color_aliases a
      JOIN public.canonical_colors c ON c.id = a.canonical_color_id AND c.active
     WHERE a.status = 'approved'
       AND a.alias_norm = public.normalize_strap_catalog_text(p_label)
  ), distinct_matches AS (
    SELECT DISTINCT id FROM matches
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(id ORDER BY id))[1] END
    FROM distinct_matches;
$$;

REVOKE ALL ON FUNCTION public.resolve_strap_canonical_color_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_strap_canonical_color_id(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_strap_canonical_color_id(text) IS
  'Resolve rotulo para uma unica cor canonica ativa por nome exato/alias aprovado; zero ou ambiguidade retornam NULL.';

-- A migration 05400 tornou o grupo do cabedal uma FK da ficha. O resolvedor
-- de tiras passa a honra-la e alinha a precedencia com o consumo: produto
-- fisico pinado vence grupo generico; texto nunca decide identidade de estoque.
CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.upper_material_group_id,
           ts.strap_base_group_id,
           ts.upper_material_product_id,
           ts.lining_material_product_id
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  )
  SELECT coalesce(
    (SELECT p.group_id
       FROM v JOIN public.products p ON p.id = v.upper_material_product_id),
    (SELECT upper_material_group_id FROM v),
    (SELECT p.group_id
       FROM v JOIN public.products p ON p.id = v.lining_material_product_id),
    (SELECT lining_material_group_id FROM v),
    (SELECT main_material_group_id FROM v),
    (SELECT p.group_id
       FROM s JOIN public.products p ON p.id = s.upper_material_product_id),
    (SELECT upper_material_group_id FROM s),
    (SELECT strap_base_group_id FROM s),
    (SELECT p.group_id
       FROM s JOIN public.products p ON p.id = s.lining_material_product_id)
  );
$$;

COMMENT ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid) IS
  'Resolve napa-base por UUID: pins da variante > grupos da variante > pin/grupo tipado do cabedal > grupo proprio de tiras > pin de forro; texto nunca identifica estoque.';

CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(
  p_reference_id uuid,
  p_variant_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public, extensions'
AS $$
  SELECT coalesce(
    (SELECT nullif(btrim(g.name), '')
       FROM public.product_groups g
      WHERE g.id = public.resolve_strap_base_group_id(
        p_reference_id, p_variant_id)),
    (SELECT nullif(btrim(ts.upper_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id),
    (SELECT nullif(btrim(ts.lining_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id)
  );
$$;

COMMENT ON FUNCTION public.strap_base_family_for_sheet(uuid, uuid) IS
  'Familia da napa das tiras: mesmo UUID do resolvedor canonico; texto apenas como fallback legado para motores antigos.';

-- Produto fisico pinado segue a mesma precedencia do consumo do cabedal. Um
-- grupo de variante e uma escolha por cor, portanto interrompe o fallback para
-- pins da ficha sem fabricar um SKU arbitrario.
CREATE OR REPLACE FUNCTION public.resolve_strap_pinned_base_product_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_variant_upper_group_id uuid;
  v_variant_upper_product_id uuid;
  v_variant_lining_group_id uuid;
  v_variant_lining_product_id uuid;
  v_variant_main_group_id uuid;
BEGIN
  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT rmv.upper_material_group_id,
         rmv.upper_material_product_id,
         rmv.lining_material_group_id,
         rmv.lining_material_product_id,
         rmv.main_material_group_id
    INTO v_variant_upper_group_id,
         v_variant_upper_product_id,
         v_variant_lining_group_id,
         v_variant_lining_product_id,
         v_variant_main_group_id
    FROM public.reference_material_variants rmv
   WHERE rmv.id = p_material_variant_id
     AND rmv.reference_id = p_reference_id
     AND coalesce(rmv.active, true);

  RETURN CASE
    WHEN v_variant_upper_product_id IS NOT NULL THEN v_variant_upper_product_id
    WHEN v_variant_upper_group_id IS NOT NULL THEN NULL
    WHEN v_variant_lining_product_id IS NOT NULL THEN v_variant_lining_product_id
    WHEN v_variant_lining_group_id IS NOT NULL THEN NULL
    WHEN v_variant_main_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.upper_material_product_id IS NOT NULL
      THEN v_sheet.upper_material_product_id
    -- Um grupo tipado da ficha ja e a autoridade estrutural. Nessa situacao,
    -- o pin legado de forro nao pode voltar a se apresentar como a napa exata
    -- do cabedal de outro grupo.
    WHEN v_sheet.upper_material_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.strap_base_group_id IS NOT NULL THEN NULL
    WHEN v_sheet.lining_material_product_id IS NOT NULL
      THEN v_sheet.lining_material_product_id
    ELSE NULL
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_strap_pinned_base_product_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Materializa/reutiliza as variantes internas exigidas pelas linhas
-- reference_base de uma ficha. Base, linhas e medidas sao relidas no servidor;
-- o cliente informa somente o contexto do item, a cor canonica e o conjunto de
-- UUIDs que viu, usado como trava otimista contra ficha alterada.
CREATE OR REPLACE FUNCTION public.ensure_sale_order_internal_strap_intents(
  p_reference_id uuid,
  p_material_variant_id uuid,
  p_color_id uuid,
  p_expected_line_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sheet public.technical_sheets%ROWTYPE;
  v_base_group_id uuid;
  v_base_group public.product_groups%ROWTYPE;
  v_color public.canonical_colors%ROWTYPE;
  v_variant_upper_group_id uuid;
  v_variant_upper_product_id uuid;
  v_variant_lining_group_id uuid;
  v_variant_lining_product_id uuid;
  v_variant_main_group_id uuid;
  v_pinned_base_product_id uuid;
  v_official public.base_material_color_official_products%ROWTYPE;
  v_base_product public.products%ROWTYPE;
  v_candidate_count integer;
  v_candidate_product_id uuid;
  v_reference_line_ids uuid[] := ARRAY[]::uuid[];
  v_expected_sorted uuid[] := ARRAY[]::uuid[];
  v_reference_sorted uuid[] := ARRAY[]::uuid[];
  v_line_entry record;
  v_line jsonb;
  v_line_id uuid;
  v_measure_id uuid;
  v_product_group_id uuid;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_type public.artisanal_strap_types%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_finished_product public.products%ROWTYPE;
  v_finished_product_id uuid;
  v_catalog jsonb;
  v_results jsonb := '[]'::jsonb;
  v_correlation_id uuid := gen_random_uuid();
  v_reason text := 'PV: materializar a tira exata na cor e napa do cabedal';
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir as tiras do PV';
  END IF;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'A operacao exige usuario autenticado para a trilha de auditoria';
  END IF;
  IF p_reference_id IS NULL OR p_color_id IS NULL THEN
    RAISE EXCEPTION 'Referencia e cor canonica sao obrigatorias';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica inexistente'; END IF;

  IF p_material_variant_id IS NOT NULL THEN
    PERFORM 1
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa';
    END IF;
  END IF;

  SELECT * INTO v_color
    FROM public.canonical_colors c
   WHERE c.id = p_color_id AND c.active
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cor canonica inexistente ou inativa'; END IF;

  v_base_group_id := public.resolve_strap_base_group_id(
    p_reference_id, p_material_variant_id
  );
  SELECT * INTO v_base_group
    FROM public.product_groups g
   WHERE g.id = v_base_group_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A ficha/variante nao identifica a napa-base do cabedal por UUID';
  END IF;

  -- O resolvedor estrutural devolve o grupo. Quando esse grupo veio de um
  -- produto pinado, a identidade fisica desse SKU tambem e load-bearing: nao
  -- podemos troca-lo silenciosamente por outro produto da mesma familia/cor.
  SELECT rmv.upper_material_group_id,
         rmv.upper_material_product_id,
         rmv.lining_material_group_id,
         rmv.lining_material_product_id,
         rmv.main_material_group_id
    INTO v_variant_upper_group_id,
         v_variant_upper_product_id,
         v_variant_lining_group_id,
         v_variant_lining_product_id,
         v_variant_main_group_id
    FROM public.reference_material_variants rmv
   WHERE rmv.id = p_material_variant_id
     AND rmv.reference_id = p_reference_id
     AND coalesce(rmv.active, true);

  v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
    p_reference_id, p_material_variant_id);

  IF v_pinned_base_product_id IS NOT NULL THEN
    SELECT * INTO v_base_product
      FROM public.products p
     WHERE p.id = v_pinned_base_product_id
     FOR UPDATE;
    IF NOT FOUND
       OR NOT v_base_product.active
       OR v_base_product.group_id IS DISTINCT FROM v_base_group_id
       OR v_base_product.unit <> 'm'
       OR public.resolve_strap_canonical_color_id(v_base_product.color)
          IS DISTINCT FROM p_color_id THEN
      RAISE EXCEPTION 'O produto pinado do cabedal nao corresponde a napa/cor exatas do item';
    END IF;
  END IF;

  -- Valida todo o snapshot antes de qualquer INSERT. finished_product_group
  -- nao entra: sua cor e origem buy_ready continuam independentes.
  FOR v_line_entry IN
    SELECT entry.value AS line, entry.ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
          THEN v_sheet.strap_colors ELSE '[]'::jsonb END
      ) WITH ORDINALITY entry(value, ordinality)
     ORDER BY entry.ordinality
  LOOP
    v_line := v_line_entry.line;
    IF coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base')
       <> 'reference_base' THEN
      CONTINUE;
    END IF;
    BEGIN
      v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
      v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Linha artesanal da ficha possui UUID/medida invalido';
    END;
    IF v_line_id IS NULL OR v_measure_id IS NULL THEN
      RAISE EXCEPTION 'Linha artesanal sem UUID estavel ou medida canonica; corrija a ficha no Estoque';
    END IF;
    IF v_line_id = ANY(v_reference_line_ids) THEN
      RAISE EXCEPTION 'UUID de linha artesanal repetido na ficha';
    END IF;
    v_reference_line_ids := array_append(v_reference_line_ids, v_line_id);
  END LOOP;

  IF cardinality(v_reference_line_ids) = 0 THEN
    RETURN jsonb_build_object(
      'reference_id', p_reference_id,
      'base_group_id', v_base_group_id,
      'color_id', p_color_id,
      'lines', '[]'::jsonb
    );
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_reference_sorted FROM unnest(v_reference_line_ids) id;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_expected_sorted FROM unnest(coalesce(p_expected_line_ids, ARRAY[]::uuid[])) id;
  IF v_expected_sorted IS DISTINCT FROM v_reference_sorted THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do pedido; recarregue antes de cadastrar as tiras'
      USING ERRCODE = '40001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-official:' || v_base_group_id::text || ':' || p_color_id::text, 0
  ));
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.strap_change_correlation_id', v_correlation_id::text, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  -- Reutiliza a designacao oficial. Sem designacao, somente um SKU ativo,
  -- linear e inequivocamente mapeado para a cor pode ser promovido. Zero ou
  -- dois candidatos bloqueiam; nunca se usa LIMIT 1 para decidir identidade.
  SELECT op.* INTO v_official
    FROM public.base_material_color_official_products op
   WHERE op.base_group_id = v_base_group_id
     AND op.color_id = p_color_id
     AND op.status = 'active'
   FOR UPDATE;

  IF v_official.id IS NOT NULL
     AND v_pinned_base_product_id IS NOT NULL
     AND v_official.official_product_id IS DISTINCT FROM v_pinned_base_product_id THEN
    RAISE EXCEPTION 'O SKU oficial da napa diverge do produto pinado no cabedal; um Administrador deve corrigir o conflito';
  END IF;

  IF v_official.id IS NULL THEN
    IF v_pinned_base_product_id IS NOT NULL THEN
      v_candidate_count := 1;
      v_candidate_product_id := v_pinned_base_product_id;
    ELSE
      SELECT count(*)::integer, (array_agg(p.id ORDER BY p.id))[1]
        INTO v_candidate_count, v_candidate_product_id
        FROM public.products p
       WHERE p.group_id = v_base_group_id
         AND p.active
         AND p.unit = 'm'
         AND public.resolve_strap_canonical_color_id(p.color) = p_color_id
         AND NOT EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants av
            WHERE av.finished_product_id = p.id
         );
    END IF;
    IF v_candidate_count = 0 THEN
      RAISE EXCEPTION 'Nao existe % % ativo no estoque; cadastre a napa do cabedal nessa cor',
        v_base_group.name, v_color.name;
    ELSIF v_candidate_count > 1 THEN
      RAISE EXCEPTION 'Existem % produtos ativos para % %; um Administrador deve designar o SKU oficial',
        v_candidate_count, v_base_group.name, v_color.name;
    END IF;

    INSERT INTO public.base_material_color_official_products (
      base_group_id, color_id, official_product_id, status,
      approved_by, approved_at, review_reason
    ) VALUES (
      v_base_group_id, p_color_id, v_candidate_product_id, 'active',
      v_actor_id, now(), v_reason || ' (SKU unico e inequivoco)'
    )
    RETURNING * INTO v_official;
  END IF;

  SELECT * INTO v_base_product
    FROM public.products p
   WHERE p.id = v_official.official_product_id
   FOR UPDATE;
  IF NOT FOUND
     OR NOT v_base_product.active
     OR v_base_product.group_id IS DISTINCT FROM v_base_group_id
     OR v_base_product.unit <> 'm'
     OR public.resolve_strap_canonical_color_id(v_base_product.color)
        IS DISTINCT FROM p_color_id THEN
    RAISE EXCEPTION 'Produto-base oficial nao corresponde a napa/cor exatas do cabedal';
  END IF;

  -- Ordem por medida + ordinal garante os mesmos locks em chamadas
  -- concorrentes e permite que linhas repetidas compartilhem uma variante.
  FOR v_line_entry IN
    SELECT entry.value AS line, entry.ordinality
      FROM jsonb_array_elements(v_sheet.strap_colors)
        WITH ORDINALITY entry(value, ordinality)
     WHERE coalesce(nullif(entry.value ->> 'identity_basis', ''), 'reference_base')
       = 'reference_base'
     ORDER BY entry.value ->> 'measure_id', entry.ordinality
  LOOP
    v_line := v_line_entry.line;
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    v_measure_id := (v_line ->> 'measure_id')::uuid;
    BEGIN
      v_product_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_product_group_id := NULL;
    END;

    SELECT m.* INTO v_measure
      FROM public.artisanal_strap_measures m
     WHERE m.id = v_measure_id AND m.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida canonica da tira esta inativa ou nao existe'; END IF;
    SELECT t.* INTO v_type
      FROM public.artisanal_strap_types t
     WHERE t.id = v_measure.strap_type_id AND t.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Familia canonica da tira esta inativa ou nao existe'; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-recipe:' || v_measure_id::text || ':' || v_base_group_id::text, 0
    ));
    SELECT r.* INTO v_recipe
      FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_measure_id
       AND r.base_group_id = v_base_group_id
       AND r.status = 'approved'
       AND r.valid_from <= now()
       AND (r.valid_to IS NULL OR r.valid_to > now())
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nao existe conversao aprovada para % % em %; cadastre o rendimento antes do PV',
        v_type.name, v_measure.display_name, v_base_group.name;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:' || v_measure_id::text || ':' ||
      v_base_group_id::text || ':' || p_color_id::text, 0
    ));
    SELECT av.* INTO v_variant
      FROM public.artisanal_strap_variants av
     WHERE av.measure_id = v_measure_id
       AND av.base_group_id = v_base_group_id
       AND av.color_id = p_color_id
     FOR UPDATE;

    IF v_variant.id IS NOT NULL THEN
      IF v_variant.identity_basis <> 'reference_base'
         OR NOT v_variant.internal_production_enabled
         OR v_variant.status <> 'active' THEN
        RAISE EXCEPTION 'A variante exata existe, mas nao esta liberada para producao interna; revise o catalogo';
      END IF;
      v_finished_product_id := v_variant.finished_product_id;
    ELSE
      IF v_product_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.product_groups g WHERE g.id = v_product_group_id
      ) THEN
        RAISE EXCEPTION 'Grupo de apresentacao da tira nao existe';
      END IF;
      IF public.is_buy_ready_strass_identity(NULL, v_product_group_id) THEN
        RAISE EXCEPTION 'Tira de grupo acabado nao pode ser criada como producao interna';
      END IF;

      v_finished_product_id := gen_random_uuid();
      INSERT INTO public.products (
        id, name, sku, category, group_id, color,
        quantity, min_stock, unit, unit_price, location, active, is_artisanal,
        purchase_unit, conversion_rate, purchase_price,
        min_order_quantity, purchase_multiple, material_preparation_days
      ) VALUES (
        v_finished_product_id,
        concat_ws(' · ', v_type.name || ' ' || v_measure.display_name,
          v_base_group.name, v_color.name),
        'TA-' || upper(substr(replace(v_finished_product_id::text, '-', ''), 1, 24)),
        'Tiras Artesanais', v_product_group_id, v_color.name,
        0, 0, 'm', 0, '', true, true,
        'm', 1, NULL, 1, 1, 2
      )
      RETURNING * INTO v_finished_product;

      INSERT INTO public.audit_logs (
        user_id, action, resource, resource_id, new_data, success, created_at
      ) VALUES (
        v_actor_id, 'strap_pv_intent_product_insert', 'products',
        v_finished_product_id::text,
        jsonb_build_object(
          'row', to_jsonb(v_finished_product),
          'reason', v_reason,
          'correlation_id', v_correlation_id,
          'reference_id', p_reference_id,
          'technical_strap_line_id', v_line_id
        ),
        true, now()
      );

      INSERT INTO public.artisanal_strap_variants (
        measure_id, base_group_id, color_id, finished_product_id,
        min_stock_m, min_stock_replenishment_mode, purchase_enabled,
        identity_basis, internal_production_enabled,
        status, review_reason
      ) VALUES (
        v_measure_id, v_base_group_id, p_color_id, v_finished_product_id,
        0, 'internal', false,
        'reference_base', true,
        'active', NULL
      )
      RETURNING * INTO v_variant;
    END IF;

    SELECT * INTO v_finished_product
      FROM public.products p
     WHERE p.id = v_finished_product_id
     FOR UPDATE;
    IF NOT FOUND
       OR NOT v_finished_product.active
       OR v_finished_product.unit <> 'm'
       OR public.is_buy_ready_strass_identity(
            v_finished_product.id, v_finished_product.group_id)
       OR public.resolve_strap_canonical_color_id(v_finished_product.color)
          IS DISTINCT FROM p_color_id THEN
      RAISE EXCEPTION 'O produto acabado da variante nao corresponde a tira/cor internas exatas';
    END IF;

    v_catalog := public.resolve_artisanal_strap_catalog(
      v_measure_id, v_base_group_id, p_color_id, 'internal', 'reference_base'
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'technical_strap_line_id', v_line_id,
      'strap_variant_id', v_variant.id,
      'recipe_id', v_recipe.id,
      'base_group_id', v_base_group_id,
      'base_product_id', v_base_product.id,
      'finished_product_id', v_finished_product_id,
      'source_mode', 'internal',
      'catalog', v_catalog
    ));
  END LOOP;

  INSERT INTO public.artisanal_strap_operational_audit_log (
    entity_type, entity_id, action, before_data, after_data,
    reason, correlation_id, actor_id
  ) VALUES (
    'technical_sheet', p_reference_id, 'reconcile',
    NULL,
    jsonb_build_object(
      'material_variant_id', p_material_variant_id,
      'base_group_id', v_base_group_id,
      'color_id', p_color_id,
      'lines', v_results
    ),
    v_reason, v_correlation_id, v_actor_id
  );

  RETURN jsonb_build_object(
    'reference_id', p_reference_id,
    'material_variant_id', p_material_variant_id,
    'base_group_id', v_base_group_id,
    'base_product_id', v_base_product.id,
    'color_id', p_color_id,
    'color_name', v_color.name,
    'source_mode', 'internal',
    'lines', v_results,
    'correlation_id', v_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_sale_order_internal_strap_intents(uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.ensure_sale_order_internal_strap_intents(uuid, uuid, uuid, uuid[]) IS
  'Cria/reutiliza atomicamente somente as variantes reference_base pedidas pelo PV, sempre na cor e napa-base do cabedal.';

-- Adapter para formulários: alinha as linhas reference_base à cor principal e
-- congela a origem interna devolvida pelo writer. Campos quantitativos e datas
-- continuam sendo recalculados pelo preview/worker canônico.
CREATE OR REPLACE FUNCTION public.prepare_sale_order_item_internal_straps(
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_color_id uuid;
  v_color_name text;
  v_straps jsonb := coalesce(p_item -> 'strap_colors', '[]'::jsonb);
  v_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_basis_aligned_straps jsonb := '[]'::jsonb;
  v_expected_line_ids uuid[] := ARRAY[]::uuid[];
  v_line jsonb;
  v_line_id uuid;
  v_sheet_line jsonb;
  v_sheet_basis text;
  v_sheet_reference_count integer;
  v_current public.sale_order_items%ROWTYPE;
  v_ensure jsonb;
  v_ensured_line jsonb;
BEGIN
  IF jsonb_typeof(p_item) <> 'object' THEN RAISE EXCEPTION 'Item do PV deve ser objeto'; END IF;
  IF jsonb_typeof(v_straps) <> 'array' THEN RAISE EXCEPTION 'strap_colors deve ser array'; END IF;
  IF jsonb_typeof(v_sourcing) <> 'object' THEN RAISE EXCEPTION 'strap_sourcing deve ser objeto'; END IF;
  BEGIN
    v_item_id := nullif(p_item ->> 'id', '')::uuid;
    v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
    v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Referencia ou variante de material invalida no item';
  END;

  -- Item persistido e estruturalmente inalterado conserva integralmente a
  -- origem/receita congeladas, mesmo que o catalogo vigente tenha sido
  -- supersedido. Alterar apenas preco, grade ou uma origem administrativa nao
  -- e autorizacao para migrar fatos historicos.
  IF v_item_id IS NOT NULL THEN
    SELECT * INTO v_current
      FROM public.sale_order_items i
     WHERE i.id = v_item_id;
    IF FOUND
       AND v_reference_id IS NOT DISTINCT FROM v_current.reference_id
       AND v_material_variant_id IS NOT DISTINCT FROM v_current.material_variant_id
       AND (p_item ->> 'color') IS NOT DISTINCT FROM v_current.color
       AND v_straps IS NOT DISTINCT FROM coalesce(v_current.strap_colors, '[]'::jsonb) THEN
      RETURN jsonb_build_object('item', p_item, 'ensured', '[]'::jsonb);
    END IF;
  END IF;

  SELECT count(*)::integer INTO v_sheet_reference_count
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
        THEN ts.strap_colors ELSE '[]'::jsonb END
    ) entry(value)
   WHERE ts.id = v_reference_id
     AND coalesce(nullif(entry.value ->> 'identity_basis', ''), 'reference_base')
         = 'reference_base';

  IF v_sheet_reference_count = 0 THEN
    RETURN jsonb_build_object('item', p_item, 'ensured', '[]'::jsonb);
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_straps)
  LOOP
    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'Linha artesanal sem UUID estavel; corrija a ficha no Estoque';
    END IF;

    SELECT entry.value INTO v_sheet_line
      FROM public.technical_sheets ts
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
          THEN ts.strap_colors ELSE '[]'::jsonb END
      ) entry(value)
     WHERE ts.id = v_reference_id
       AND entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linha artesanal do item nao pertence mais a ficha tecnica';
    END IF;
    v_sheet_basis := coalesce(
      nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    v_basis_aligned_straps := v_basis_aligned_straps || jsonb_build_array(
      (v_line - 'identity_basis') || jsonb_build_object(
        'identity_basis', v_sheet_basis
      )
    );
    IF v_sheet_basis <> 'reference_base' THEN
      CONTINUE;
    END IF;
    v_expected_line_ids := array_append(v_expected_line_ids, v_line_id);
  END LOOP;
  v_straps := v_basis_aligned_straps;
  v_color_id := public.resolve_strap_canonical_color_id(p_item ->> 'color');
  IF v_color_id IS NULL THEN
    RAISE EXCEPTION 'A cor principal do item nao corresponde a uma unica cor canonica aprovada';
  END IF;
  SELECT c.name INTO v_color_name FROM public.canonical_colors c WHERE c.id = v_color_id;

  v_ensure := public.ensure_sale_order_internal_strap_intents(
    v_reference_id, v_material_variant_id, v_color_id, v_expected_line_ids
  );

  SELECT coalesce(jsonb_agg(
    CASE
      WHEN (line.value ->> 'technical_strap_line_id')::uuid = ANY(v_expected_line_ids)
      THEN (line.value - 'color_id') || jsonb_build_object(
        'color', v_color_name, 'color_id', v_color_id
      )
      ELSE line.value
    END ORDER BY line.ordinality
  ), '[]'::jsonb)
    INTO v_straps
    FROM jsonb_array_elements(v_straps) WITH ORDINALITY line(value, ordinality);

  FOR v_ensured_line IN
    SELECT value FROM jsonb_array_elements(v_ensure -> 'lines')
  LOOP
    v_line_id := (v_ensured_line ->> 'technical_strap_line_id')::uuid;
    -- Preserva uma origem historica ja congelada somente quando ela continua
    -- apontando a mesma cor e a mesma variante exata. Trocar a cor principal
    -- invalida o snapshot anterior e volta automaticamente para internal.
    IF v_sourcing ? v_line_id::text
       AND v_sourcing -> v_line_id::text ->> 'source_mode' IN ('internal', 'buy_ready') THEN
      IF v_sourcing -> v_line_id::text ->> 'color_id' = v_color_id::text
         AND v_sourcing -> v_line_id::text ->> 'strap_variant_id'
             = v_ensured_line ->> 'strap_variant_id'
         AND (
           v_sourcing -> v_line_id::text ->> 'source_mode' = 'buy_ready'
           OR v_sourcing -> v_line_id::text ->> 'recipe_id'
                = v_ensured_line ->> 'recipe_id'
         ) THEN
        CONTINUE;
      END IF;
    END IF;
    v_sourcing := jsonb_set(
      v_sourcing,
      ARRAY[v_line_id::text],
      jsonb_build_object(
        'source_mode', 'internal',
        'color_id', v_color_id,
        'strap_variant_id', v_ensured_line ->> 'strap_variant_id',
        'recipe_id', v_ensured_line ->> 'recipe_id'
      ),
      true
    );
  END LOOP;

  RETURN jsonb_build_object(
    'item', p_item || jsonb_build_object(
      'strap_colors', v_straps,
      'strap_sourcing', v_sourcing
    ),
    'ensured', v_ensure -> 'lines',
    'base_group_id', v_ensure -> 'base_group_id',
    'base_product_id', v_ensure -> 'base_product_id',
    'color_id', v_color_id,
    'color_name', v_color_name,
    'correlation_id', v_ensure -> 'correlation_id'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb)
  TO authenticated;

-- Autoridade final do adapter. A primeira definicao acima conserva a assinatura
-- historica durante o rollout; esta versao fecha o conjunto completo da ficha,
-- deriva as duas bases de identidade e permanece privada aos writers atomicos.
CREATE OR REPLACE FUNCTION public.prepare_sale_order_item_internal_straps(
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_color_id uuid;
  v_color_name text;
  v_straps jsonb := coalesce(p_item -> 'strap_colors', '[]'::jsonb);
  v_input_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_sourcing jsonb := '{}'::jsonb;
  v_basis_aligned_straps jsonb := '[]'::jsonb;
  v_final_straps jsonb := '[]'::jsonb;
  v_sheet public.technical_sheets%ROWTYPE;
  v_sheet_lines jsonb := '[]'::jsonb;
  v_sheet_all_ids uuid[] := ARRAY[]::uuid[];
  v_item_all_ids uuid[] := ARRAY[]::uuid[];
  v_expected_line_ids uuid[] := ARRAY[]::uuid[];
  v_line jsonb;
  v_line_id uuid;
  v_sheet_line jsonb;
  v_sheet_basis text;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_identity_group_id uuid;
  v_line_color_id uuid;
  v_line_color_name text;
  v_current public.sale_order_items%ROWTYPE;
  v_current_found boolean := false;
  v_current_snapshot_complete boolean := false;
  v_current_order_status text;
  v_ensure jsonb;
  v_ensured_line jsonb;
  v_catalog jsonb;
  v_existing_source jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN RAISE EXCEPTION 'Item do PV deve ser objeto'; END IF;
  IF jsonb_typeof(v_straps) <> 'array' THEN RAISE EXCEPTION 'strap_colors deve ser array'; END IF;
  IF jsonb_typeof(v_input_sourcing) <> 'object' THEN RAISE EXCEPTION 'strap_sourcing deve ser objeto'; END IF;
  BEGIN
    v_item_id := nullif(p_item ->> 'id', '')::uuid;
    v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
    v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Referencia ou variante de material invalida no item';
  END;

  -- Um item ja Aprovado/Em Producao e estruturalmente intocado continua
  -- congelado, inclusive quando o snapshot legado e incompleto. Nao fazemos
  -- backfill silencioso de PV historico; demanda corrente e a autoridade e
  -- qualquer reparo sem demanda exige fluxo administrativo deliberado.
  IF v_item_id IS NOT NULL THEN
    SELECT * INTO v_current
      FROM public.sale_order_items i
     WHERE i.id = v_item_id;
    v_current_found := FOUND;
    IF v_current_found THEN
      SELECT so.status INTO v_current_order_status
        FROM public.sale_orders so
       WHERE so.id = v_current.sale_order_id;
      SELECT coalesce(bool_and(
        coalesce(line.value ->> 'technical_strap_line_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND jsonb_typeof(coalesce(
          v_current.strap_sourcing -> (line.value ->> 'technical_strap_line_id'),
          'null'::jsonb
        )) = 'object'
        AND v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode'
            IN ('internal', 'buy_ready')
        AND coalesce(v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'color_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND coalesce(v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'strap_variant_id', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND CASE coalesce(
          nullif(line.value ->> 'identity_basis', ''), 'reference_base')
          WHEN 'reference_base' THEN
            v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'internal'
            AND coalesce(v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'recipe_id', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND coalesce(v_current.strap_sourcing
                  -> (line.value ->> 'technical_strap_line_id') ->> 'base_product_id', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          WHEN 'finished_product_group' THEN
            v_current.strap_sourcing
              -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'buy_ready'
          ELSE false
        END
      ), true)
        INTO v_current_snapshot_complete
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_current.strap_colors) = 'array'
            THEN v_current.strap_colors ELSE '[]'::jsonb END
        ) line(value);
    END IF;
    IF v_current_found
       AND v_current_order_status IN ('Aprovado', 'Em Produção')
       AND current_setting('app.strap_force_revalidate', true) IS DISTINCT FROM '1'
       AND v_reference_id IS NOT DISTINCT FROM v_current.reference_id
       AND v_material_variant_id IS NOT DISTINCT FROM v_current.material_variant_id
       AND (p_item ->> 'color') IS NOT DISTINCT FROM v_current.color
       AND v_straps IS NOT DISTINCT FROM coalesce(v_current.strap_colors, '[]'::jsonb) THEN
      RETURN jsonb_build_object(
        'item', p_item || jsonb_build_object(
          'strap_sourcing', coalesce(v_current.strap_sourcing, '{}'::jsonb),
          'strap_sourcing_revision', v_current.strap_sourcing_revision
        ),
        'ensured', '[]'::jsonb
      );
    END IF;
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = v_reference_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica inexistente'; END IF;
  IF v_material_variant_id IS NOT NULL THEN
    PERFORM 1
      FROM public.reference_material_variants rmv
     WHERE rmv.id = v_material_variant_id
       AND rmv.reference_id = v_reference_id
       AND coalesce(rmv.active, true)
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa';
    END IF;
  END IF;
  v_sheet_lines := CASE
    -- Mesmo MUTEX do PV: ficha com cabedal estrutural nao emite as tiras
    -- residuais do JSON legado como demanda adicional.
    WHEN nullif(btrim(coalesce(v_sheet.upper_material, '')), '') IS NOT NULL
      THEN '[]'::jsonb
    WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
      THEN v_sheet.strap_colors
    ELSE '[]'::jsonb
  END;

  -- Compara o conjunto completo, inclusive finished_product_group. Nao basta
  -- validar apenas as linhas internas: omissao/reclassificacao muda a baixa.
  FOR v_sheet_line IN SELECT value FROM jsonb_array_elements(v_sheet_lines)
  LOOP
    BEGIN
      v_line_id := nullif(v_sheet_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Ficha possui linha artesanal com UUID invalido';
    END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'Linha artesanal sem UUID estavel; corrija a ficha no Estoque';
    END IF;
    IF v_line_id = ANY(v_sheet_all_ids) THEN
      RAISE EXCEPTION 'UUID de linha artesanal repetido na ficha';
    END IF;
    v_sheet_all_ids := array_append(v_sheet_all_ids, v_line_id);
  END LOOP;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_straps)
  LOOP
    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'Linha artesanal sem UUID estavel; corrija a ficha no Estoque';
    END IF;
    IF v_line_id = ANY(v_item_all_ids) THEN
      RAISE EXCEPTION 'UUID de linha artesanal repetido no item do PV';
    END IF;
    v_item_all_ids := array_append(v_item_all_ids, v_line_id);

    SELECT entry.value INTO v_sheet_line
      FROM jsonb_array_elements(v_sheet_lines) entry(value)
     WHERE entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linha artesanal do item nao pertence mais a ficha tecnica';
    END IF;
    v_sheet_basis := coalesce(
      nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF v_sheet_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui base de identidade invalida';
    END IF;
    BEGIN
      v_measure_id := nullif(v_sheet_line ->> 'measure_id', '')::uuid;
      v_strap_type_id := nullif(v_sheet_line ->> 'strap_type_id', '')::uuid;
      v_identity_group_id := nullif(v_sheet_line ->> 'identity_group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Linha tecnica possui medida/familia/grupo invalido';
    END;
    IF v_measure_id IS NULL OR v_strap_type_id IS NULL THEN
      RAISE EXCEPTION 'Linha tecnica sem familia/medida canonica; corrija a ficha no Estoque';
    END IF;
    IF v_sheet_basis = 'finished_product_group' AND v_identity_group_id IS NULL THEN
      RAISE EXCEPTION 'Tira comprada pronta exige grupo proprio do componente acabado';
    END IF;

    v_basis_aligned_straps := v_basis_aligned_straps || jsonb_build_array(
      (v_line
        - 'id' - 'technical_strap_line_id'
        - 'strap_type_id' - 'measure_id'
        - 'identity_basis' - 'identity_group_id'
        - 'group_id' - 'group_name'
        - 'label' - 'consumption' - 'consumption_per_size')
      || jsonb_build_object(
        'id', v_line_id,
        'technical_strap_line_id', v_line_id,
        'strap_type_id', v_strap_type_id,
        'measure_id', v_measure_id,
        'identity_basis', v_sheet_basis,
        'identity_group_id', CASE WHEN v_sheet_basis = 'finished_product_group'
          THEN v_identity_group_id ELSE NULL END,
        'group_id', nullif(v_sheet_line ->> 'group_id', ''),
        'group_name', coalesce(v_sheet_line ->> 'group_name', ''),
        'label', coalesce(v_sheet_line ->> 'label', 'TIRA'),
        'consumption', coalesce(v_sheet_line -> 'consumption', '0'::jsonb),
        'consumption_per_size', coalesce(
          v_sheet_line -> 'consumption_per_size', '{}'::jsonb)
      )
    );
    IF v_sheet_basis = 'reference_base' THEN
      v_expected_line_ids := array_append(v_expected_line_ids, v_line_id);
    END IF;
  END LOOP;
  v_straps := v_basis_aligned_straps;

  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_sheet_all_ids FROM unnest(v_sheet_all_ids) id;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_item_all_ids FROM unnest(v_item_all_ids) id;
  IF v_item_all_ids IS DISTINCT FROM v_sheet_all_ids THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do pedido; recarregue antes de salvar'
      USING ERRCODE = '40001';
  END IF;

  IF cardinality(v_expected_line_ids) > 0 THEN
    v_color_id := public.resolve_strap_canonical_color_id(p_item ->> 'color');
    IF v_color_id IS NULL THEN
      RAISE EXCEPTION 'A cor principal do item nao corresponde a uma unica cor canonica aprovada';
    END IF;
    SELECT c.name INTO v_color_name
      FROM public.canonical_colors c
     WHERE c.id = v_color_id AND c.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cor principal canonica inativa'; END IF;
    v_ensure := public.ensure_sale_order_internal_strap_intents(
      v_reference_id, v_material_variant_id, v_color_id, v_expected_line_ids
    );
  ELSE
    v_ensure := jsonb_build_object('lines', '[]'::jsonb);
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_straps)
  LOOP
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    v_sheet_basis := v_line ->> 'identity_basis';
    v_measure_id := (v_line ->> 'measure_id')::uuid;
    v_existing_source := coalesce(v_input_sourcing -> v_line_id::text, '{}'::jsonb);

    IF v_sheet_basis = 'reference_base' THEN
      SELECT value INTO v_ensured_line
        FROM jsonb_array_elements(v_ensure -> 'lines') ensured(value)
       WHERE ensured.value ->> 'technical_strap_line_id' = v_line_id::text;
      IF NOT FOUND THEN RAISE EXCEPTION 'Writer nao devolveu a linha interna esperada'; END IF;
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_color_name, 'color_id', v_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id'
          - 'recipe_id' - 'base_product_id')
        || jsonb_build_object(
          'source_mode', 'internal',
          'color_id', v_color_id,
          'strap_variant_id', v_ensured_line ->> 'strap_variant_id',
          'recipe_id', v_ensured_line ->> 'recipe_id',
          'base_product_id', v_ensured_line ->> 'base_product_id'
        ),
        true
      );
    ELSE
      BEGIN
        v_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
        v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Cor/grupo invalido na tira comprada pronta';
      END;
      IF v_line_color_id IS NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta exige uma cor canonica propria';
      END IF;
      SELECT c.name INTO v_line_color_name
        FROM public.canonical_colors c
       WHERE c.id = v_line_color_id AND c.active
       FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cor da tira comprada pronta esta inativa'; END IF;

      -- O PV congela a variante comercial ativa exata; nunca inventa o
      -- produto/fornecedor/valor da tira comprada pronta.
      PERFORM 1
        FROM public.artisanal_strap_variants av
        JOIN public.products p ON p.id = av.finished_product_id
       WHERE av.measure_id = v_measure_id
         AND av.base_group_id = v_identity_group_id
         AND av.color_id = v_line_color_id
         AND av.identity_basis = 'finished_product_group'
         AND av.status = 'active'
         AND av.purchase_enabled
         AND NOT av.internal_production_enabled
         AND p.active
         AND p.group_id = v_identity_group_id
         AND p.unit = 'm'
         AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id
       FOR SHARE OF av, p;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Tira comprada pronta nao possui variante comercial ativa exata';
      END IF;
      v_catalog := public.resolve_artisanal_strap_catalog(
        v_measure_id, v_identity_group_id, v_line_color_id,
        'buy_ready', 'finished_product_group'
      );
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id'
          - 'recipe_id' - 'base_product_id')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'strap_variant_id', v_catalog ->> 'variant_id',
          'recipe_id', NULL,
          'base_product_id', NULL
        ),
        true
      );
    END IF;
    v_final_straps := v_final_straps || jsonb_build_array(v_line);
  END LOOP;

  RETURN jsonb_build_object(
    'item', p_item || jsonb_build_object(
      'strap_colors', v_final_straps,
      'strap_sourcing', v_sourcing
    ),
    'ensured', v_ensure -> 'lines',
    'base_group_id', v_ensure -> 'base_group_id',
    'base_product_id', v_ensure -> 'base_product_id',
    'color_id', v_color_id,
    'color_name', v_color_name,
    'correlation_id', v_ensure -> 'correlation_id'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Defesa no banco: quando uma linha reference_base ja carrega cor/origem, os
-- UUIDs precisam ser a mesma cor principal do item. Rascunho sem cor continua
-- permitido, mas nao e possivel confirmar/salvar uma baixa divergente por API.
CREATE OR REPLACE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_color_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_sheet_line jsonb;
  v_line_color_id uuid;
  v_source_color_id uuid;
  v_source_variant_id uuid;
BEGIN
  -- Escritores legados podem mencionar estas colunas mesmo sem altera-las.
  -- Isso nao deve revalidar nem reescrever um snapshot historico congelado.
  IF TG_OP = 'UPDATE'
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.color IS NOT DISTINCT FROM OLD.color
     AND NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors
     AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(NEW.strap_colors, '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;
  v_expected_color_id := public.resolve_strap_canonical_color_id(NEW.color);

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN CONTINUE; END IF;

    SELECT entry.value INTO v_sheet_line
      FROM public.technical_sheets ts
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
          THEN ts.strap_colors ELSE '[]'::jsonb END
      ) entry(value)
     WHERE ts.id = NEW.reference_id
       AND entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linha artesanal do item nao pertence a ficha tecnica';
    END IF;
    IF coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base')
       <> 'reference_base' THEN
      CONTINUE;
    END IF;

    BEGIN v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'color_id invalido na linha artesanal'; END;
    BEGIN
      v_source_color_id := nullif(
        NEW.strap_sourcing -> v_line_id::text ->> 'color_id', '')::uuid;
      v_source_variant_id := nullif(
        NEW.strap_sourcing -> v_line_id::text ->> 'strap_variant_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Cor/variante invalida na origem da linha artesanal';
    END;

    IF (v_line_color_id IS NOT NULL OR v_source_color_id IS NOT NULL
        OR v_source_variant_id IS NOT NULL)
       AND v_expected_color_id IS NULL THEN
      RAISE EXCEPTION 'Cor principal do item nao possui identidade canonica unica';
    END IF;
    IF v_line_color_id IS NOT NULL
       AND v_line_color_id IS DISTINCT FROM v_expected_color_id THEN
      RAISE EXCEPTION 'A cor da tira artesanal deve ser a mesma cor principal do cabedal';
    END IF;
    IF v_source_color_id IS NOT NULL
       AND v_source_color_id IS DISTINCT FROM v_expected_color_id THEN
      RAISE EXCEPTION 'A origem da tira aponta uma cor diferente do cabedal';
    END IF;
    IF v_source_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_variants av
       WHERE av.id = v_source_variant_id
         AND av.identity_basis = 'reference_base'
         AND av.base_group_id = public.resolve_strap_base_group_id(
           NEW.reference_id, NEW.material_variant_id
         )
         AND av.color_id = v_expected_color_id
    ) THEN
      RAISE EXCEPTION 'A variante da tira nao corresponde a napa/cor do cabedal';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
  FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_sale_order_item_strap_color_alignment
  ON public.sale_order_items;
CREATE TRIGGER trg_validate_sale_order_item_strap_color_alignment
BEFORE INSERT OR UPDATE OF
  sale_order_id, reference_id, material_variant_id, color, strap_colors,
  strap_sourcing
ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment();

-- Defesa final do row writer: estrutura vem da ficha; origem vem da base de
-- identidade; variante, medida, cor, produto-base pinado e receita precisam
-- formar o mesmo snapshot. O override administrativo continua sendo a unica
-- saida deliberada para fatos historicos comprometidos.
CREATE OR REPLACE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_sheet_lines jsonb;
  v_sheet_ids uuid[] := ARRAY[]::uuid[];
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_expected_color_id uuid;
  v_base_group_id uuid;
  v_pinned_base_product_id uuid;
  v_variant_upper_group_id uuid;
  v_variant_upper_product_id uuid;
  v_variant_lining_group_id uuid;
  v_variant_lining_product_id uuid;
  v_variant_main_group_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_sheet_line jsonb;
  v_basis text;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_identity_group_id uuid;
  v_item_measure_id uuid;
  v_item_strap_type_id uuid;
  v_item_identity_group_id uuid;
  v_line_color_id uuid;
  v_source jsonb;
  v_source_mode text;
  v_source_color_id uuid;
  v_source_variant_id uuid;
  v_source_recipe_id uuid;
  v_source_base_product_id uuid;
  v_is_private_override boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id THEN
    RAISE EXCEPTION
      'Item do PV nao pode ser movido para outro pedido; remova e recrie pelo writer atomico'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS NOT DISTINCT FROM OLD.sale_order_id
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.color IS NOT DISTINCT FROM OLD.color
     AND NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors
     AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.operation = 'override'
       AND context.sale_order_id = NEW.sale_order_id
  ) INTO v_is_private_override;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id = OLD.id
       AND d.is_current
       AND coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'source_mode'
           IS NOT DISTINCT FROM d.source_mode
       AND nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'strap_variant_id', '')
           IS NOT DISTINCT FROM d.strap_variant_id::text
       AND (
         nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'recipe_id', '')
           IS DISTINCT FROM d.recipe_id::text
         OR nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'base_product_id', '')
           IS DISTINCT FROM d.base_product_id::text
         OR NOT EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants av
            WHERE av.id = d.strap_variant_id
              AND av.finished_product_id = d.finished_product_id
         )
       )
  ) THEN
    RAISE EXCEPTION
      'Receita/produtos congelados nao podem mudar mantendo a mesma variante; use fluxo administrativo'
      USING ERRCODE = '40001';
  END IF;
  -- O guard legado aceitava um custom GUC que qualquer sessao autenticada
  -- consegue forjar. Compromisso externo so pode mudar pelo contexto privado
  -- criado pela RPC administrativa; o alvo ainda passa por toda a validacao.
  IF TG_OP = 'UPDATE' AND NOT v_is_private_override AND EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id = OLD.id
       AND (
         OLD.strap_sourcing -> d.technical_strap_line_id::text
             ->> 'source_mode'
           IS DISTINCT FROM
         NEW.strap_sourcing -> d.technical_strap_line_id::text
             ->> 'source_mode'
         OR nullif(OLD.strap_sourcing -> d.technical_strap_line_id::text
             ->> 'strap_variant_id', '')::uuid
           IS DISTINCT FROM
         nullif(NEW.strap_sourcing -> d.technical_strap_line_id::text
             ->> 'strap_variant_id', '')::uuid
       )
       AND (
         EXISTS (
           SELECT 1
             FROM public.purchase_demand_contributions c
             JOIN public.purchase_orders po ON po.id = c.purchase_order_id
            WHERE c.sale_order_strap_demand_id = d.id
              AND (po.snapshot_locked_at IS NOT NULL
                OR c.status IN ('approved', 'sent', 'partial', 'received'))
         )
         OR EXISTS (
           SELECT 1
             FROM public.strap_production_batch_contributions c
             JOIN public.strap_production_batch_items bi
               ON bi.id = c.batch_item_id
             JOIN public.strap_production_batches b ON b.id = bi.batch_id
             LEFT JOIN public.service_order_items soi
               ON soi.id = c.service_order_item_id
            WHERE c.sale_order_strap_demand_id = d.id
              AND (b.started_at IS NOT NULL
                OR bi.started_at IS NOT NULL
                OR soi.sent_at IS NOT NULL
                OR c.status IN ('in_progress', 'partial', 'fulfilled'))
         )
         OR public.strap_demand_has_external_commitment(d.id)
       )
  ) THEN
    RAISE EXCEPTION
      'Origem comprometida: use o override administrativo com motivo'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT v_is_private_override AND EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id = OLD.id
       AND d.is_current
       AND coalesce(d.fulfilled_m, 0) > 0
       AND (
         coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'source_mode'
           IS DISTINCT FROM d.source_mode
         OR nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'strap_variant_id', '')
           IS DISTINCT FROM d.strap_variant_id::text
         OR nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'recipe_id', '')
           IS DISTINCT FROM d.recipe_id::text
         OR nullif(coalesce(NEW.strap_sourcing, '{}'::jsonb)
             -> d.technical_strap_line_id::text ->> 'base_product_id', '')
           IS DISTINCT FROM d.base_product_id::text
         OR NOT EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants av
            WHERE av.id::text = nullif(
              coalesce(NEW.strap_sourcing, '{}'::jsonb)
                -> d.technical_strap_line_id::text ->> 'strap_variant_id', '')
              AND av.finished_product_id = d.finished_product_id
         )
       )
  ) THEN
    RAISE EXCEPTION
      'A tira ja possui realizacao fisica; use o override administrativo com motivo'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(coalesce(NEW.strap_colors, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(NEW.strap_sourcing, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Snapshot de tiras do PV possui formato invalido';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = NEW.reference_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica inexistente'; END IF;
  v_sheet_lines := CASE
    WHEN nullif(btrim(coalesce(v_sheet.upper_material, '')), '') IS NOT NULL
      THEN '[]'::jsonb
    WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
      THEN v_sheet.strap_colors
    ELSE '[]'::jsonb
  END;

  FOR v_sheet_line IN SELECT value FROM jsonb_array_elements(v_sheet_lines)
  LOOP
    BEGIN v_line_id := nullif(v_sheet_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL OR v_line_id = ANY(v_sheet_ids) THEN
      RAISE EXCEPTION 'Ficha tecnica possui identidade de tira ausente/repetida';
    END IF;
    v_sheet_ids := array_append(v_sheet_ids, v_line_id);
  END LOOP;

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL OR v_line_id = ANY(v_item_ids) THEN
      RAISE EXCEPTION 'Item do PV possui identidade de tira ausente/repetida';
    END IF;
    v_item_ids := array_append(v_item_ids, v_line_id);
  END LOOP;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_sheet_ids FROM unnest(v_sheet_ids) id;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_item_ids FROM unnest(v_item_ids) id;
  IF v_item_ids IS DISTINCT FROM v_sheet_ids THEN
    RAISE EXCEPTION 'Snapshot do item nao contem exatamente as linhas da ficha vigente'
      USING ERRCODE = '40001';
  END IF;
  IF cardinality(v_sheet_ids) = 0 THEN RETURN NEW; END IF;

  v_expected_color_id := public.resolve_strap_canonical_color_id(NEW.color);
  v_base_group_id := public.resolve_strap_base_group_id(
    NEW.reference_id, NEW.material_variant_id);

  SELECT rmv.upper_material_group_id,
         rmv.upper_material_product_id,
         rmv.lining_material_group_id,
         rmv.lining_material_product_id,
         rmv.main_material_group_id
    INTO v_variant_upper_group_id,
         v_variant_upper_product_id,
         v_variant_lining_group_id,
         v_variant_lining_product_id,
         v_variant_main_group_id
    FROM public.reference_material_variants rmv
   WHERE rmv.id = NEW.material_variant_id
     AND rmv.reference_id = NEW.reference_id
     AND coalesce(rmv.active, true)
   FOR SHARE;
  IF NEW.material_variant_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa';
  END IF;
  v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
    NEW.reference_id, NEW.material_variant_id);

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    SELECT entry.value INTO v_sheet_line
      FROM jsonb_array_elements(v_sheet_lines) entry(value)
     WHERE entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    BEGIN
      v_measure_id := nullif(v_sheet_line ->> 'measure_id', '')::uuid;
      v_strap_type_id := nullif(v_sheet_line ->> 'strap_type_id', '')::uuid;
      v_identity_group_id := nullif(v_sheet_line ->> 'identity_group_id', '')::uuid;
      v_item_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
      v_item_strap_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
      v_item_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      v_line_color_id := nullif(v_line ->> 'color_id', '')::uuid;
      v_source := NEW.strap_sourcing -> v_line_id::text;
      v_source_mode := nullif(v_source ->> 'source_mode', '');
      v_source_color_id := nullif(v_source ->> 'color_id', '')::uuid;
      v_source_variant_id := nullif(v_source ->> 'strap_variant_id', '')::uuid;
      v_source_recipe_id := nullif(v_source ->> 'recipe_id', '')::uuid;
      v_source_base_product_id := nullif(v_source ->> 'base_product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Snapshot de identidade/origem da tira possui UUID invalido';
    END;
    IF v_basis NOT IN ('reference_base', 'finished_product_group')
       OR v_measure_id IS NULL OR v_strap_type_id IS NULL
       OR v_item_measure_id IS DISTINCT FROM v_measure_id
       OR v_item_strap_type_id IS DISTINCT FROM v_strap_type_id
       OR nullif(v_line ->> 'identity_basis', '') IS DISTINCT FROM v_basis
       OR nullif(v_line ->> 'group_id', '')
            IS DISTINCT FROM nullif(v_sheet_line ->> 'group_id', '')
       OR coalesce(v_line -> 'consumption', '0'::jsonb)
            IS DISTINCT FROM coalesce(v_sheet_line -> 'consumption', '0'::jsonb)
       OR coalesce(v_line -> 'consumption_per_size', '{}'::jsonb)
            IS DISTINCT FROM coalesce(v_sheet_line -> 'consumption_per_size', '{}'::jsonb) THEN
      RAISE EXCEPTION 'Estrutura da tira no item diverge da ficha tecnica vigente';
    END IF;
    IF v_basis = 'finished_product_group'
       AND v_item_identity_group_id IS DISTINCT FROM v_identity_group_id THEN
      RAISE EXCEPTION 'Grupo de identidade da tira diverge da ficha tecnica vigente';
    ELSIF v_basis = 'reference_base' AND v_item_identity_group_id IS NOT NULL THEN
      RAISE EXCEPTION 'Tira da napa do cabedal nao aceita grupo acabado proprio';
    END IF;
    IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id
       OR v_source_variant_id IS NULL THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;

    IF v_basis = 'reference_base' THEN
      IF v_expected_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_expected_color_id
         OR v_source_mode IS DISTINCT FROM 'internal'
         OR v_source_recipe_id IS NULL
         OR v_source_base_product_id IS NULL
         OR v_base_group_id IS NULL THEN
        RAISE EXCEPTION 'Tira interna deve usar cor, origem e napa exatas do cabedal';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants av
          JOIN public.products finished ON finished.id = av.finished_product_id
         WHERE av.id = v_source_variant_id
           AND av.measure_id = v_measure_id
           AND av.base_group_id = v_base_group_id
           AND av.color_id = v_expected_color_id
           AND av.identity_basis = 'reference_base'
           AND av.status = 'active'
           AND av.internal_production_enabled
           AND finished.active
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_expected_color_id
      ) THEN
        RAISE EXCEPTION 'Variante interna nao corresponde a medida/napa/cor do cabedal';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.base_material_color_official_products op
          JOIN public.products base ON base.id = op.official_product_id
         WHERE op.base_group_id = v_base_group_id
           AND op.color_id = v_expected_color_id
           AND op.status = 'active'
           AND op.official_product_id = v_source_base_product_id
           AND (v_pinned_base_product_id IS NULL
             OR op.official_product_id = v_pinned_base_product_id)
           AND base.active
           AND base.group_id = v_base_group_id
           AND base.unit = 'm'
           AND public.resolve_strap_canonical_color_id(base.color)
               = v_expected_color_id
      ) THEN
        RAISE EXCEPTION 'Produto-base oficial diverge da napa fisica pinada no cabedal';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_recipes r
         WHERE r.id = v_source_recipe_id
           AND r.measure_id = v_measure_id
           AND r.base_group_id = v_base_group_id
           AND r.status = 'approved'
           AND r.valid_from <= now()
           AND (r.valid_to IS NULL OR r.valid_to > now())
      ) THEN
        RAISE EXCEPTION 'Receita congelada nao e a conversao aprovada vigente da tira';
      END IF;
    ELSE
      IF v_identity_group_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL THEN
        RAISE EXCEPTION 'Tira de grupo acabado exige origem fixa buy_ready';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants av
          JOIN public.products finished ON finished.id = av.finished_product_id
         WHERE av.id = v_source_variant_id
           AND av.measure_id = v_measure_id
           AND av.base_group_id = v_identity_group_id
           AND av.color_id = v_line_color_id
           AND av.identity_basis = 'finished_product_group'
           AND av.status = 'active'
           AND av.purchase_enabled
           AND NOT av.internal_production_enabled
           AND finished.active
           AND finished.group_id = v_identity_group_id
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'Variante comprada pronta nao corresponde a medida/grupo/cor da ficha';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
  FROM PUBLIC, anon, authenticated, service_role;

-- A escolha comum por linha foi substituida pela derivacao por identity_basis.
-- O override administrativo com motivo permanece separado para fatos antigos.
REVOKE ALL ON FUNCTION public.set_sale_order_item_strap_sourcing(uuid, integer, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Prova interna nao forjavel de que cabecalho e itens estao sendo persistidos
-- pelo writer atomico. Custom GUCs nao servem como fronteira de seguranca,
-- pois qualquer sessao autenticada pode chama-los via set_config.
CREATE TABLE IF NOT EXISTS public.sale_order_atomic_writer_contexts (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'override')),
  sale_order_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (backend_pid, transaction_id, operation)
);

ALTER TABLE public.sale_order_atomic_writer_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_order_atomic_writer_contexts
  FROM PUBLIC, anon, authenticated, service_role;

-- O override administrativo e o unico writer alternativo que primeiro trava
-- um item. Envolve-o no mesmo lock global antes do SELECT FOR UPDATE legado.
DO $$
BEGIN
  IF to_regprocedure(
       'public.override_sale_order_item_strap_sourcing(uuid,integer,jsonb,text,uuid)'
     ) IS NOT NULL
     AND to_regprocedure(
       'public.override_sale_order_item_strap_sourcing_pre_05500(uuid,integer,jsonb,text,uuid)'
     ) IS NULL THEN
    ALTER FUNCTION public.override_sale_order_item_strap_sourcing(
      uuid, integer, jsonb, text, uuid
    ) RENAME TO override_sale_order_item_strap_sourcing_pre_05500;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.override_sale_order_item_strap_sourcing_pre_05500(
    uuid, integer, jsonb, text, uuid
  )
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.override_sale_order_item_strap_sourcing(
  p_sale_order_item_id uuid,
  p_expected_revision integer,
  p_lines jsonb,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid;
  v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-pv-auto-intent', 0));
  SELECT i.sale_order_id INTO v_sale_order_id
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do PV nao encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-demand-source:sale_order:' || v_sale_order_id::text, 0));
  INSERT INTO public.sale_order_atomic_writer_contexts (
    backend_pid, transaction_id, operation, sale_order_id
  ) VALUES (
    pg_backend_pid(), txid_current(), 'override', v_sale_order_id
  ) ON CONFLICT (backend_pid, transaction_id, operation) DO UPDATE
      SET sale_order_id = EXCLUDED.sale_order_id,
          created_at = now();
  v_result := public.override_sale_order_item_strap_sourcing_pre_05500(
    p_sale_order_item_id,
    p_expected_revision,
    p_lines,
    p_reason,
    p_correlation_id
  );
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    IMMEDIATE;
  DELETE FROM public.sale_order_atomic_writer_contexts context
   WHERE context.backend_pid = pg_backend_pid()
     AND context.transaction_id = txid_current()
     AND context.operation = 'override';
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    DEFERRED;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.override_sale_order_item_strap_sourcing(
  uuid, integer, jsonb, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.override_sale_order_item_strap_sourcing(
  uuid, integer, jsonb, text, uuid
) TO authenticated;

-- O mobile/offline chega direto ao escritor atomico. Prepara os itens no
-- servidor antes do INSERT para que fechar a aba ou reenviar a fila nao perca
-- a identidade/origem das tiras.
DO $$
BEGIN
  IF to_regprocedure('public.create_sale_order_atomic(jsonb,jsonb,uuid)') IS NOT NULL
     AND to_regprocedure('public.create_sale_order_atomic_pre_05500(jsonb,jsonb,uuid)') IS NULL THEN
    ALTER FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
      RENAME TO create_sale_order_atomic_pre_05500;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.create_sale_order_atomic_pre_05500(jsonb, jsonb, uuid)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_sale_order_atomic(
  p_header jsonb,
  p_items jsonb,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prepared_items jsonb;
  v_raw_hash text;
  v_existing public.sale_orders%ROWTYPE;
  v_item_ids uuid[];
  v_count integer;
  v_result jsonb;
  v_order_id uuid;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode criar PV';
  END IF;
  IF jsonb_typeof(p_header) <> 'object'
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cabecalho e array nao vazio de itens sao obrigatorios';
  END IF;

  -- A chave idempotente cobre o payload recebido, antes de qualquer mutacao de
  -- catalogo. Assim um retry nao depende de receita/oficial ainda vigentes e
  -- nao produz uma segunda auditoria reconcile.
  v_raw_hash := public.strap_payload_hash(
    jsonb_build_object('header', p_header, 'items', p_items)
  );
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'create-sale-order:' || p_client_request_id::text, 0
    ));
    SELECT * INTO v_existing
      FROM public.sale_orders so
     WHERE so.client_request_id = p_client_request_id
     FOR UPDATE;
    IF FOUND THEN
      IF v_existing.client_request_payload_hash IS NULL
         OR v_existing.client_request_payload_hash <> v_raw_hash
         OR v_existing.client_request_item_count <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'Replay idempotente divergente para client_request_id %',
          p_client_request_id USING ERRCODE = '22000';
      END IF;
      SELECT coalesce(array_agg(i.id ORDER BY i.created_at, i.id), '{}'::uuid[]),
             count(*)::integer
        INTO v_item_ids, v_count
        FROM public.sale_order_items i
       WHERE i.sale_order_id = v_existing.id;
      IF v_count <> v_existing.client_request_item_count THEN
        RAISE EXCEPTION 'Replay atomico incompleto: esperado %, persistido %',
          v_existing.client_request_item_count, v_count USING ERRCODE = '55000';
      END IF;
      -- Replay do mesmo payload e estritamente read-only. Reenfileirar aqui
      -- incluiria captured_at=now() no hash operacional e criaria outra revisao
      -- apesar de o client_request_id representar a mesma requisicao.
      RETURN jsonb_build_object(
        'order_id', v_existing.id,
        'item_ids', to_jsonb(v_item_ids),
        'idempotent_replay', true,
        'payload_hash', v_raw_hash
      );
    END IF;
  END IF;

  -- Serializa os auto-writers do PV. Os locks finos do catalogo continuam
  -- protegendo concorrencia administrativa; este lock evita ordem A/B versus
  -- B/A entre pedidos multi-item na mesma transacao.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-pv-auto-intent', 0
  ));
  SELECT coalesce(jsonb_agg(
    (public.prepare_sale_order_item_internal_straps(item.value - 'id') -> 'item')
    ORDER BY item.ordinality
  ), '[]'::jsonb)
    INTO v_prepared_items
    FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality);

  INSERT INTO public.sale_order_atomic_writer_contexts (
    backend_pid, transaction_id, operation, sale_order_id
  ) VALUES (
    pg_backend_pid(), txid_current(), 'create', NULL
  ) ON CONFLICT (backend_pid, transaction_id, operation) DO UPDATE
      SET sale_order_id = NULL,
          created_at = now();
  v_result := public.create_sale_order_atomic_pre_05500(
    p_header, v_prepared_items, p_client_request_id
  );
  v_order_id := nullif(v_result ->> 'order_id', '')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Criacao atomica nao retornou o identificador do PV';
  END IF;
  UPDATE public.sale_order_atomic_writer_contexts context
     SET sale_order_id = v_order_id
   WHERE context.backend_pid = pg_backend_pid()
     AND context.transaction_id = txid_current()
     AND context.operation = 'create';
  IF p_client_request_id IS NOT NULL THEN
    UPDATE public.sale_orders
       SET client_request_payload_hash = v_raw_hash,
           client_request_item_count = jsonb_array_length(p_items)
     WHERE id = v_order_id
       AND client_request_id = p_client_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Criacao atomica nao preservou a chave idempotente do PV';
    END IF;
  END IF;

  -- INSERTs de item geram constraint triggers diferidos. Drena-os enquanto o
  -- contexto privado ainda prova o lote e publica apenas um evento completo.
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    IMMEDIATE;
  DELETE FROM public.sale_order_atomic_writer_contexts context
   WHERE context.backend_pid = pg_backend_pid()
     AND context.transaction_id = txid_current()
     AND context.operation = 'create';
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    DEFERRED;

  RETURN v_result || jsonb_build_object(
    'idempotent_replay', false,
    'payload_hash', v_raw_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid) IS
  'Escritor atomico do PV mobile/offline; materializa tiras internas reference_base antes de persistir e confirmar.';

-- A edicao tambem recebe itens inteiros. O wrapper prepara apenas item novo ou
-- cujo contexto/cor/tiras realmente mudou; mencionar as mesmas colunas em um
-- save de preco/grade nao reescreve snapshots historicos congelados.
DO $$
BEGIN
  IF to_regprocedure('public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])') IS NOT NULL
     AND to_regprocedure('public.update_sale_order_with_teardown_pre_05500(uuid,jsonb,jsonb,uuid[])') IS NULL THEN
    ALTER FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
      RENAME TO update_sale_order_with_teardown_pre_05500;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.update_sale_order_with_teardown_pre_05500(uuid, jsonb, jsonb, uuid[])
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_sale_order_with_teardown(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_entry record;
  v_item jsonb;
  v_item_id uuid;
  v_current public.sale_order_items%ROWTYPE;
  v_should_prepare boolean;
  v_snapshot_complete boolean;
  v_order_status text;
  v_expected_revision integer;
  v_prepared_items jsonb := '[]'::jsonb;
  v_order_before public.sale_orders%ROWTYPE;
  v_order_after public.sale_orders%ROWTYPE;
  v_result jsonb;
  v_event_type text;
  v_demand_relevant_change boolean := false;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode editar PV';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items deve ser array nao vazio';
  END IF;

  -- O BEFORE STATEMENT das transicoes de status adquire este mesmo lock antes
  -- de qualquer row lock. Todos os escritores seguem coarse -> sale_order.
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  SELECT so.* INTO v_order_before
    FROM public.sale_orders so
   WHERE so.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;
  v_order_status := v_order_before.status;
  -- Mesma ordem do worker: fonte antes de catalogo/clock. Assim o save nunca
  -- segura variante/produto enquanto espera um worker que ja segura o relogio.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-demand-source:sale_order:' || p_order_id::text, 0));
  -- Mesmo lock do writer interno, adquirido antes da leitura comparativa.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'update_sale_order_with_teardown:' || p_order_id::text, 0
  ));

  FOR v_item_entry IN
    SELECT item.value, item.ordinality
      FROM jsonb_array_elements(p_items) WITH ORDINALITY item(value, ordinality)
     ORDER BY item.ordinality
  LOOP
    v_item := v_item_entry.value;
    BEGIN
      v_item_id := nullif(v_item ->> 'id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Item do PV possui id invalido';
    END;
    v_should_prepare := v_item_id IS NULL;
    IF v_item_id IS NULL THEN
      v_demand_relevant_change := true;
    END IF;

    IF v_item_id IS NOT NULL THEN
      SELECT * INTO v_current
        FROM public.sale_order_items i
       WHERE i.id = v_item_id
         AND i.sale_order_id = p_order_id
       FOR UPDATE;
      IF FOUND THEN
        IF v_item ? 'strap_sourcing_revision' THEN
          BEGIN
            v_expected_revision := coalesce(
              nullif(v_item ->> 'strap_sourcing_revision', '')::integer, 0);
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Revisao da origem das tiras invalida';
          END;
          IF v_expected_revision IS DISTINCT FROM
             coalesce(v_current.strap_sourcing_revision, 0) THEN
            RAISE EXCEPTION
              'As tiras deste item foram alteradas por outra sessao; recarregue o pedido'
              USING ERRCODE = '40001';
          END IF;
        ELSE
          RAISE EXCEPTION
            'Revisao da origem das tiras ausente; recarregue o pedido antes de salvar'
            USING ERRCODE = '40001';
        END IF;
        SELECT coalesce(bool_and(
          jsonb_typeof(coalesce(
            v_current.strap_sourcing -> (line.value ->> 'technical_strap_line_id'),
            'null'::jsonb
          )) = 'object'
          AND v_current.strap_sourcing
                -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode'
              IN ('internal', 'buy_ready')
          AND coalesce(v_current.strap_sourcing
                -> (line.value ->> 'technical_strap_line_id') ->> 'color_id', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND coalesce(v_current.strap_sourcing
                -> (line.value ->> 'technical_strap_line_id') ->> 'strap_variant_id', '')
            ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND CASE coalesce(
            nullif(line.value ->> 'identity_basis', ''), 'reference_base')
            WHEN 'reference_base' THEN
              v_current.strap_sourcing
                -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'internal'
              AND coalesce(v_current.strap_sourcing
                    -> (line.value ->> 'technical_strap_line_id') ->> 'recipe_id', '')
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND coalesce(v_current.strap_sourcing
                    -> (line.value ->> 'technical_strap_line_id') ->> 'base_product_id', '')
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            WHEN 'finished_product_group' THEN
              v_current.strap_sourcing
                -> (line.value ->> 'technical_strap_line_id') ->> 'source_mode' = 'buy_ready'
            ELSE false
          END
        ), true)
          INTO v_snapshot_complete
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_current.strap_colors) = 'array'
              THEN v_current.strap_colors ELSE '[]'::jsonb END
          ) line(value);
        -- Rascunho e intencao prospectiva: cada save rele e materializa o
        -- catalogo vigente. Em Aprovado/Em Producao, inclusive legado
        -- incompleto, a ausencia de edicao estrutural preserva a historia.
        v_snapshot_complete := v_order_status IN ('Aprovado', 'Em Produção');
        v_should_prepare :=
          nullif(v_item ->> 'reference_id', '')::uuid
            IS DISTINCT FROM v_current.reference_id
          OR nullif(v_item ->> 'material_variant_id', '')::uuid
            IS DISTINCT FROM v_current.material_variant_id
          OR (v_item ->> 'color') IS DISTINCT FROM v_current.color
          OR (
            v_item ? 'strap_colors'
            AND coalesce(v_item -> 'strap_colors', '[]'::jsonb)
                IS DISTINCT FROM coalesce(v_current.strap_colors, '[]'::jsonb)
          )
          OR (
            v_item ? 'strap_sourcing'
            AND coalesce(v_item -> 'strap_sourcing', '{}'::jsonb)
                IS DISTINCT FROM coalesce(v_current.strap_sourcing, '{}'::jsonb)
          )
          OR NOT v_snapshot_complete
          ;
        v_demand_relevant_change := v_demand_relevant_change
          OR v_should_prepare
          OR coalesce(v_item -> 'quantity', 'null'::jsonb)
               IS DISTINCT FROM to_jsonb(v_current.quantity)
          OR coalesce(v_item -> 'grade', '{}'::jsonb)
               IS DISTINCT FROM coalesce(v_current.grade, '{}'::jsonb);
        IF v_should_prepare THEN
          v_item := v_item || jsonb_build_object(
            'reference_id', coalesce(
              nullif(v_item ->> 'reference_id', '')::uuid, v_current.reference_id),
            'material_variant_id', CASE WHEN v_item ? 'material_variant_id'
              THEN v_item -> 'material_variant_id'
              ELSE to_jsonb(v_current.material_variant_id) END,
            'color', coalesce(v_item ->> 'color', v_current.color),
            'strap_colors', CASE WHEN v_item ? 'strap_colors'
              THEN coalesce(v_item -> 'strap_colors', '[]'::jsonb)
              ELSE coalesce(v_current.strap_colors, '[]'::jsonb) END,
            'strap_sourcing', CASE WHEN v_item ? 'strap_sourcing'
              THEN coalesce(v_item -> 'strap_sourcing', '{}'::jsonb)
              ELSE coalesce(v_current.strap_sourcing, '{}'::jsonb) END,
            'strap_sourcing_revision', v_expected_revision
          );
        END IF;
      ELSE
        RAISE EXCEPTION 'Item % nao pertence ao PV informado', v_item_id;
      END IF;
    END IF;

    IF v_should_prepare THEN
      v_item := public.prepare_sale_order_item_internal_straps(v_item) -> 'item';
    END IF;
    v_prepared_items := v_prepared_items || jsonb_build_array(v_item);
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items existing
     WHERE existing.sale_order_id = p_order_id
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(p_items) sent(value)
          WHERE nullif(sent.value ->> 'id', '') = existing.id::text
       )
  ) THEN
    v_demand_relevant_change := true;
  END IF;

  -- O helper legado atualiza o cabecalho antes dos itens. O contexto privado
  -- suprime eventos intermediarios sem confiar em GUC forjavel pelo cliente.
  INSERT INTO public.sale_order_atomic_writer_contexts (
    backend_pid, transaction_id, operation, sale_order_id
  ) VALUES (
    pg_backend_pid(), txid_current(), 'update', p_order_id
  ) ON CONFLICT (backend_pid, transaction_id, operation) DO UPDATE
      SET sale_order_id = EXCLUDED.sale_order_id,
          created_at = now();
  v_result := public.update_sale_order_with_teardown_pre_05500(
    p_order_id, p_header, v_prepared_items, p_teardown_op_ids
  );

  -- O helper legado grava cabecalho antes dos itens. Drena os eventos de item
  -- ainda com a supressao ativa e publica um unico payload ja consistente.
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    IMMEDIATE;
  DELETE FROM public.sale_order_atomic_writer_contexts context
   WHERE context.backend_pid = pg_backend_pid()
     AND context.transaction_id = txid_current()
     AND context.operation = 'update';
  SET CONSTRAINTS
    trg_enqueue_strap_demands_on_item_change,
    trg_enqueue_strap_demands_on_item_change_on_update
    DEFERRED;

  SELECT so.* INTO v_order_after
    FROM public.sale_orders so
   WHERE so.id = p_order_id;
  IF v_order_after.status IS DISTINCT FROM v_order_before.status
     AND v_order_after.status IN ('Aprovado', 'Em Produção') THEN
    v_event_type := CASE WHEN v_order_after.status = 'Em Produção'
      THEN 'direct_production' ELSE 'approved' END;
  ELSIF v_order_after.status IS DISTINCT FROM v_order_before.status
     AND v_order_after.status IN ('Cancelado', 'Cancelada') THEN
    v_event_type := 'cancelled';
  ELSIF v_order_after.status IN ('Aprovado', 'Em Produção')
     AND (
       v_demand_relevant_change
       OR v_order_after.billing_week IS DISTINCT FROM v_order_before.billing_week
       OR v_order_after.delivery_month IS DISTINCT FROM v_order_before.delivery_month
       OR v_order_after.delivery_week IS DISTINCT FROM v_order_before.delivery_week
       OR v_order_after.delivery_deadline IS DISTINCT FROM v_order_before.delivery_deadline
     ) THEN
    v_event_type := CASE WHEN
      v_order_after.billing_week IS DISTINCT FROM v_order_before.billing_week
      OR v_order_after.delivery_month IS DISTINCT FROM v_order_before.delivery_month
      OR v_order_after.delivery_week IS DISTINCT FROM v_order_before.delivery_week
      OR v_order_after.delivery_deadline IS DISTINCT FROM v_order_before.delivery_deadline
      THEN 'schedule_changed' ELSE 'item_updated' END;
  END IF;
  IF v_event_type IS NOT NULL THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      p_order_id, v_event_type, gen_random_uuid());
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])
  TO authenticated;

COMMENT ON FUNCTION public.update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[]) IS
  'Edita PV atomicamente; materializa tiras reference_base somente para item novo ou cuja cor/contexto mudou, preservando snapshots historicos intocados.';

-- O preview publicado em 04400 resolve o catalogo vigente. Isso e correto
-- para uma intencao ainda nao salva, mas nao para um PV cuja demanda ja
-- congelou receita/produto-base. Mantemos o calculo de quantidade e agenda do
-- motor original e substituimos somente a identidade por seu fato corrente.
DO $$
BEGIN
  IF to_regprocedure('public.preview_sale_order_strap_demand_draft(jsonb)') IS NOT NULL
     AND to_regprocedure('public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)') IS NULL THEN
    ALTER FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
      RENAME TO preview_sale_order_strap_demand_draft_pre_05500;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  public.preview_sale_order_strap_demand_draft_pre_05500(jsonb)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(
  p_item jsonb
)
RETURNS TABLE(
  line_ordinal integer,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preview record;
  v_item_id uuid;
  v_order_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_selection jsonb;
  v_selected_variant_id uuid;
  v_selected_recipe_id uuid;
  v_selected_base_product_id uuid;
  v_selected_source text;
  v_line_id uuid;
  v_line_basis text;
  v_line_color_id uuid;
  v_main_color_id uuid;
  v_pinned_base_product_id uuid;
  v_is_persisted boolean := false;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_frozen_resolved jsonb;
  v_frozen_catalog jsonb;
BEGIN
  BEGIN
    v_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;
    v_order_id := nullif(p_item ->> 'sale_order_id', '')::uuid;
    v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
    v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_item_id := NULL;
    v_order_id := NULL;
    v_reference_id := NULL;
    v_material_variant_id := NULL;
  END;
  IF v_item_id IS NOT NULL AND v_order_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.sale_order_items i
       WHERE i.id = v_item_id
         AND i.sale_order_id = v_order_id
         AND i.reference_id::text IS NOT DISTINCT FROM
             nullif(p_item ->> 'reference_id', '')
         AND i.material_variant_id::text IS NOT DISTINCT FROM
             nullif(p_item ->> 'material_variant_id', '')
         AND i.color IS NOT DISTINCT FROM p_item ->> 'color'
         AND coalesce(i.strap_colors, '[]'::jsonb)
             IS NOT DISTINCT FROM coalesce(p_item -> 'strap_colors', '[]'::jsonb)
         AND coalesce(i.strap_sourcing, '{}'::jsonb)
             IS NOT DISTINCT FROM coalesce(p_item -> 'strap_sourcing', '{}'::jsonb)
    ) INTO v_is_persisted;
  END IF;

  FOR v_preview IN
    SELECT old_preview.*
      FROM public.preview_sale_order_strap_demand_draft_pre_05500(p_item)
        AS old_preview
     ORDER BY old_preview.line_ordinal
  LOOP
    line_ordinal := v_preview.line_ordinal;
    technical_strap_line_id := v_preview.technical_strap_line_id;
    v_line_id := v_preview.technical_strap_line_id;
    strap_variant_id := v_preview.strap_variant_id;
    source_mode := v_preview.source_mode;
    gross_required_m := v_preview.gross_required_m;
    recipe_id := v_preview.recipe_id;
    base_product_id := v_preview.base_product_id;
    finished_product_id := v_preview.finished_product_id;
    blocking_reasons := v_preview.blocking_reasons;
    resolved := v_preview.resolved;

    IF NOT v_is_persisted OR v_line_id IS NULL THEN
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_selection := coalesce(
      p_item -> 'strap_sourcing' -> v_line_id::text,
      '{}'::jsonb
    );
    SELECT coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base'),
           nullif(line.value ->> 'color_id', '')::uuid
      INTO v_line_basis, v_line_color_id
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_item -> 'strap_colors') = 'array'
          THEN p_item -> 'strap_colors' ELSE '[]'::jsonb END
      ) line(value)
     WHERE line.value ->> 'technical_strap_line_id' = v_line_id::text;
    v_selected_source := v_selection ->> 'source_mode';
    BEGIN
      v_selected_variant_id := nullif(
        v_selection ->> 'strap_variant_id', '')::uuid;
      v_selected_recipe_id := nullif(
        v_selection ->> 'recipe_id', '')::uuid;
      v_selected_base_product_id := nullif(
        v_selection ->> 'base_product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_selected_variant_id := NULL;
      v_selected_recipe_id := NULL;
      v_selected_base_product_id := NULL;
    END;

    -- Uma demanda corrente e a autoridade depois da confirmacao. Mudancas no
    -- cadastro nao trocam sua napa/receita durante replay ou reagendamento.
    SELECT d.* INTO v_demand
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id = v_item_id
       AND d.technical_strap_line_id = v_line_id
       AND d.is_current
       AND (v_selected_source IS NULL
         OR d.source_mode IS NOT DISTINCT FROM v_selected_source)
       AND (v_selected_variant_id IS NULL
         OR d.strap_variant_id IS NOT DISTINCT FROM v_selected_variant_id)
       AND (v_selected_recipe_id IS NULL
         OR d.recipe_id IS NOT DISTINCT FROM v_selected_recipe_id)
       AND (v_selected_base_product_id IS NULL
         OR d.base_product_id IS NOT DISTINCT FROM v_selected_base_product_id)
     ;
    IF FOUND THEN
      strap_variant_id := v_demand.strap_variant_id;
      source_mode := v_demand.source_mode;
      recipe_id := v_demand.recipe_id;
      base_product_id := v_demand.base_product_id;
      finished_product_id := v_demand.finished_product_id;

      SELECT coalesce(jsonb_agg(reason.value ORDER BY reason.ordinality), '[]'::jsonb)
        INTO blocking_reasons
        FROM jsonb_array_elements(
          coalesce(v_preview.blocking_reasons, '[]'::jsonb)
        ) WITH ORDINALITY reason(value, ordinality)
       WHERE reason.value ->> 'code' NOT IN (
         'reference_unresolved',
         'technical_line_identity_invalid',
         'technical_identity_snapshot_stale',
         'identity_basis_invalid',
         'identity_group_missing',
         'measure_missing',
         'material_variant_mismatch',
         'base_group_unresolved',
         'color_id_missing',
         'source_mode_required',
         'internal_production_disabled',
         'source_mode_invalid',
         'catalog_resolution_blocked',
         'variant_identity_not_persisted',
         'variant_snapshot_stale'
       );

      v_frozen_resolved := coalesce(
        v_demand.identity_snapshot -> 'resolved', '{}'::jsonb);
      IF v_frozen_resolved = '{}'::jsonb THEN
        v_frozen_resolved := coalesce(v_preview.resolved, '{}'::jsonb);
      END IF;
      v_frozen_catalog := coalesce(
        v_frozen_resolved -> 'catalog', '{}'::jsonb)
        || jsonb_build_object(
          'variant_id', v_demand.strap_variant_id,
          'recipe_id', v_demand.recipe_id,
          'recipe_version', v_demand.recipe_version_snapshot,
          'base_product_id', v_demand.base_product_id,
          'finished_product_id', v_demand.finished_product_id,
          'confirmed_yield_m_per_m', v_demand.confirmed_yield_snapshot,
          'source_mode', v_demand.source_mode
        );
      resolved := v_frozen_resolved || jsonb_build_object(
        'catalog', v_frozen_catalog,
        'source_mode', v_demand.source_mode,
        'confirmed_yield_m_per_m', v_demand.confirmed_yield_snapshot,
        'base_required_m', CASE WHEN v_demand.source_mode = 'internal'
          THEN gross_required_m
            / nullif(v_demand.confirmed_yield_snapshot, 0)
          ELSE 0 END,
        'required_at', v_preview.resolved -> 'required_at',
        'main_production_start', v_preview.resolved -> 'main_production_start',
        'schedule_revision', v_preview.resolved -> 'schedule_revision',
        'schedule_source', v_preview.resolved -> 'schedule_source'
      );
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Antes do primeiro fato, a origem prospectiva e derivada exclusivamente
    -- da identidade da ficha. Isso fecha payload legado/malicioso sem mexer em
    -- demandas historicas que ja passaram pelo ramo acima.
    IF v_line_basis = 'reference_base' THEN
      v_main_color_id := public.resolve_strap_canonical_color_id(p_item ->> 'color');
      v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
        v_reference_id, v_material_variant_id);
      IF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL
         OR v_main_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_main_color_id THEN
        blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'reference_base_intent_mismatch',
            'field', 'strap_sourcing',
            'message', 'A tira da napa deve usar a cor principal e producao interna.'
          ));
      END IF;
      IF v_pinned_base_product_id IS NOT NULL
         AND v_selected_base_product_id IS DISTINCT FROM
             v_pinned_base_product_id THEN
        blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'pinned_base_product_mismatch',
            'field', 'base_product_id',
            'message', 'A napa congelada diverge do SKU fisico pinado no cabedal.'
          ));
      END IF;
    ELSIF v_line_basis = 'finished_product_group' THEN
      IF v_selected_source IS DISTINCT FROM 'buy_ready'
         OR v_selected_recipe_id IS NOT NULL
         OR v_selected_base_product_id IS NOT NULL THEN
        blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'finished_group_intent_mismatch',
            'field', 'strap_sourcing',
            'message', 'A tira de grupo acabado deve permanecer buy_ready.'
          ));
      END IF;
    ELSE
      blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'code', 'identity_basis_invalid',
          'field', 'identity_basis',
          'message', 'A base de identidade da tira e invalida.'
        ));
    END IF;

    -- Antes da primeira demanda, o item congelado e o catalogo atual devem
    -- coincidir exatamente. O BEFORE de confirmacao rederiva rascunhos; se
    -- ainda houver divergencia, a baixa fica bloqueada em vez de trocar SKU.
    IF v_selected_variant_id IS NULL
       OR strap_variant_id IS DISTINCT FROM v_selected_variant_id
       OR recipe_id IS DISTINCT FROM v_selected_recipe_id
       OR base_product_id IS DISTINCT FROM v_selected_base_product_id THEN
      blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'code', 'frozen_source_snapshot_stale',
          'field', 'strap_sourcing',
          'message', 'A origem congelada da tira diverge do catalogo; salve novamente o pedido antes de confirmar.'
        ));
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb)
  TO authenticated, service_role;

-- A funcao SQL publicada em 03200 guardava dependencia no OID que acabou de
-- ser renomeado. Recriá-la faz o caminho por PV apontar para o wrapper novo.
CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand(
  p_sale_order_id uuid
)
RETURNS TABLE(
  sale_order_item_id uuid,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, p.technical_strap_line_id, p.strap_variant_id, p.source_mode,
         p.gross_required_m, p.recipe_id, p.base_product_id,
         p.finished_product_id, p.blocking_reasons, p.resolved
    FROM public.sale_order_items i
    CROSS JOIN LATERAL public.resolve_sale_order_main_production_start(
      p_sale_order_id, i.id
    ) s
    CROSS JOIN LATERAL public.preview_sale_order_strap_demand_draft(
      jsonb_build_object(
        'sale_order_id', p_sale_order_id,
        'sale_order_item_id', i.id,
        'reference_id', i.reference_id,
        'material_variant_id', i.material_variant_id,
        'color', i.color,
        'quantity', i.quantity,
        'grade', i.grade,
        'strap_colors', i.strap_colors,
        'strap_sourcing', i.strap_sourcing,
        'main_production_start', s.main_production_start,
        'schedule_revision', s.schedule_revision
      )
    ) p
   WHERE i.sale_order_id = p_sale_order_id
   ORDER BY i.id, p.line_ordinal;
$$;

-- Espelha o MUTEX do adapter/preview: ficha com cabedal estrutural nao exige
-- que JSON residual de tiras antigas seja congelado no item. O restante do
-- enqueue permanece identico ao motor operacional vigente.
CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands(
  p_sale_order_id uuid,
  p_event_type text DEFAULT 'confirmed',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_lines jsonb;
  v_block_count integer;
  v_source_revision integer;
  v_schedule_revision integer;
  v_anchor date;
  v_payload jsonb;
  v_key text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'correlation_id obrigatorio para evento de tiras do PV';
  END IF;
  SELECT * INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'sale_order_item_id', p.sale_order_item_id,
      'technical_strap_line_id', p.technical_strap_line_id,
      'strap_variant_id', p.strap_variant_id,
      'source_mode', p.source_mode,
      'gross_required_m', p.gross_required_m,
      'recipe_id', p.recipe_id,
      'base_product_id', p.base_product_id,
      'finished_product_id', p.finished_product_id,
      'blocking_reasons', p.blocking_reasons,
      'resolved', p.resolved
    ) ORDER BY p.sale_order_item_id, p.technical_strap_line_id), '[]'::jsonb),
    count(*) FILTER (
      WHERE jsonb_array_length(coalesce(p.blocking_reasons, '[]'::jsonb)) > 0
    )
    INTO v_lines, v_block_count
    FROM public.preview_sale_order_strap_demand(p_sale_order_id) p;

  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items i
         JOIN public.technical_sheets ts ON ts.id = i.reference_id
        WHERE i.sale_order_id = p_sale_order_id
          AND NOT EXISTS (
            SELECT 1
              FROM public.sale_order_strap_demands current_demand
             WHERE current_demand.sale_order_item_id = i.id
               AND current_demand.is_current
          )
          AND (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'technical_strap_line_id', line.value ->> 'technical_strap_line_id',
              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'group_id', nullif(line.value ->> 'group_id', ''),
              'identity_group_id', nullif(
                line.value ->> 'identity_group_id', ''),
              'strap_type_id', nullif(line.value ->> 'strap_type_id', ''),
              'measure_id', nullif(line.value ->> 'measure_id', ''),
              'consumption', coalesce(
                line.value -> 'consumption', '0'::jsonb),
              'consumption_per_size', coalesce(
                line.value -> 'consumption_per_size', '{}'::jsonb)
            ) ORDER BY line.value ->> 'technical_strap_line_id'), '[]'::jsonb)
              FROM jsonb_array_elements(
                CASE
                  WHEN nullif(btrim(coalesce(ts.upper_material, '')), '')
                         IS NOT NULL THEN '[]'::jsonb
                  WHEN jsonb_typeof(ts.strap_colors) = 'array'
                    THEN ts.strap_colors
                  ELSE '[]'::jsonb
                END
              ) line(value)
          ) IS DISTINCT FROM (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'technical_strap_line_id', line.value ->> 'technical_strap_line_id',
              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'group_id', nullif(line.value ->> 'group_id', ''),
              'identity_group_id', nullif(
                line.value ->> 'identity_group_id', ''),
              'strap_type_id', nullif(line.value ->> 'strap_type_id', ''),
              'measure_id', nullif(line.value ->> 'measure_id', ''),
              'consumption', coalesce(
                line.value -> 'consumption', '0'::jsonb),
              'consumption_per_size', coalesce(
                line.value -> 'consumption_per_size', '{}'::jsonb)
            ) ORDER BY line.value ->> 'technical_strap_line_id'), '[]'::jsonb)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(i.strap_colors) = 'array'
                  THEN i.strap_colors ELSE '[]'::jsonb END
              ) line(value)
          )
     ) THEN
    RAISE EXCEPTION
      'PV nao congelou exatamente as linhas de tira da ficha vigente; revise a ficha e o item antes de confirmar'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(v_lines) = 0
     AND p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND NOT EXISTS (
       SELECT 1
         FROM public.sale_order_strap_demands d
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
     ) THEN
    RETURN NULL;
  END IF;
  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND v_block_count > 0 THEN
    RAISE EXCEPTION
      'PV possui % linha(s) de tira bloqueada(s); consulte preview_sale_order_strap_demand',
      v_block_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(jsonb_agg(
    CASE
      WHEN jsonb_array_length(coalesce(
        x.value -> 'blocking_reasons', '[]'::jsonb)) > 0
        THEN x.value
      ELSE x.value || jsonb_build_object(
        'financial_snapshot',
        CASE
          -- Reagendamento/replay de uma demanda corrente conserva o custo que
          -- foi aceito na primeira confirmacao. Nao reler preco/conversao do
          -- cadastro atual evita reprecificar historia ou bloquear um PV cuja
          -- tira pronta teve o preco cadastral limpo depois da aprovacao.
          WHEN frozen_financial.sale_order_strap_demand_id IS NOT NULL THEN
            jsonb_strip_nulls(jsonb_build_object(
              'source_mode', x.value ->> 'source_mode',
              'planned_unit_cost', frozen_financial.planned_unit_cost,
              'base_unit_cost_snapshot',
                frozen_financial.base_unit_cost_snapshot,
              'transformation_cost_per_m_snapshot',
                frozen_financial.transformation_cost_per_m_snapshot,
              'purchase_price_snapshot',
                frozen_financial.purchase_price_snapshot,
              'conversion_rate_snapshot',
                frozen_financial.composition -> 'conversion_rate',
              'recipe_id', nullif(x.value ->> 'recipe_id', '')::uuid,
              'base_product_id',
                nullif(x.value ->> 'base_product_id', '')::uuid,
              'finished_product_id',
                nullif(x.value ->> 'finished_product_id', '')::uuid,
              'confirmed_yield_snapshot', nullif(
                x.value -> 'resolved' ->> 'confirmed_yield_m_per_m',
                '')::numeric,
              'captured_at', frozen_financial.created_at
            ))
          ELSE public.capture_strap_financial_snapshot(
            x.value ->> 'source_mode',
            nullif(x.value ->> 'recipe_id', '')::uuid,
            nullif(x.value ->> 'base_product_id', '')::uuid,
            (x.value ->> 'finished_product_id')::uuid,
            nullif(
              x.value -> 'resolved' ->> 'confirmed_yield_m_per_m', '')::numeric
          )
        END
      )
    END ORDER BY x.ord
  ), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY x(value, ord)
    LEFT JOIN LATERAL (
      SELECT fs.*
        FROM public.sale_order_strap_demands d
        JOIN public.strap_financial_snapshots fs
          ON fs.sale_order_strap_demand_id = d.id
       WHERE d.sale_order_id = p_sale_order_id
         AND d.sale_order_item_id =
             nullif(x.value ->> 'sale_order_item_id', '')::uuid
         AND d.technical_strap_line_id =
             nullif(x.value ->> 'technical_strap_line_id', '')::uuid
         AND d.is_current
         AND d.source_mode IS NOT DISTINCT FROM x.value ->> 'source_mode'
         AND d.strap_variant_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'strap_variant_id', '')::uuid
         AND d.recipe_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'recipe_id', '')::uuid
         AND d.base_product_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'base_product_id', '')::uuid
         AND d.finished_product_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'finished_product_id', '')::uuid
       LIMIT 1
    ) frozen_financial ON true;

  SELECT coalesce(max(strap_sourcing_revision), 0)
    INTO v_source_revision
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;
  SELECT coalesce(max(nullif(
    x.value -> 'resolved' ->> 'schedule_revision', '')::integer), 0)
    INTO v_schedule_revision
    FROM jsonb_array_elements(v_lines) x(value);

  v_anchor := public.resolve_strap_sale_order_billing_anchor(p_sale_order_id);
  IF v_anchor IS NULL THEN
    IF p_event_type IN ('confirmed', 'approved', 'direct_production') THEN
      RAISE EXCEPTION 'Semana de faturamento do PV nao resolve uma data ancora';
    END IF;
    v_anchor := coalesce(v_so.delivery_deadline, current_date);
  END IF;

  v_payload := jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'sale_order_status', v_so.status,
    'event_type', p_event_type,
    'billing_anchor', v_anchor,
    'billing_year', extract(year FROM v_anchor)::integer,
    'billing_month', extract(month FROM v_anchor)::integer,
    'billing_fortnight', CASE WHEN extract(day FROM v_anchor) <= 15 THEN 1 ELSE 2 END,
    'source_revision', v_source_revision,
    'schedule_revision', v_schedule_revision,
    'requested_by', auth.uid(),
    'lines', v_lines
  );
  -- Idempotencia pertence ao evento, nao ao estado. Um PV pode voltar de
  -- quantidade 20 para 10 antes do worker; reutilizar a chave historica de 10
  -- deixaria o job de 20 como o mais novo e produziria baixa obsoleta (ABA).
  -- A mesma correlation_id continua sendo replay estrito: o helper abaixo
  -- compara o payload_hash e rejeita seu reuso com conteudo divergente.
  v_key := format(
    'sale_order:%s:event:%s',
    p_sale_order_id, p_correlation_id
  );
  RETURN public.enqueue_strap_demand_job(
    'sale_order', p_sale_order_id, v_source_revision, v_schedule_revision,
    p_event_type, v_payload, v_key, p_correlation_id
  );
END;
$$;

-- source_revision antigo era apenas max(strap_sourcing_revision): quantidade,
-- grade e agenda podiam gerar jobs distintos com o mesmo numero. Um relogio
-- privado por PV evita tocar updated_at/RLS do pedido e e incrementado sob row
-- lock em todo INSERT real da fila.
CREATE TABLE IF NOT EXISTS public.sale_order_strap_demand_clocks (
  sale_order_id uuid PRIMARY KEY
    REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sale_order_strap_demand_clocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_order_strap_demand_clocks
  FROM PUBLIC, anon, authenticated, service_role;

-- Fecha a janela entre o max historico e a instalacao do trigger que passa a
-- numerar todo job novo. O lock e liberado junto com a migration.
-- EXCLUSIVE tambem barra o ROW SHARE do claim (SELECT ... FOR UPDATE),
-- evitando que um worker prenda uma linha legada no meio do cutover.
LOCK TABLE public.strap_demand_jobs IN EXCLUSIVE MODE;

-- O numero legado nao era monotono para quantidade/grade/agenda e pode ate
-- diminuir quando um item e removido. Nao existe eleicao segura de backlog:
-- os schedule_changed rev=0 que nunca produziram demanda sao housekeeping
-- legado sem fato fisico e viram no-op auditavel. Qualquer outro backlog aborta.
UPDATE public.strap_demand_jobs j
   SET status = 'cancelled',
       result = jsonb_build_object(
         'no_op', true,
         'reason', 'legacy_schedule_without_materialized_demand_cutover'
       ),
       completed_at = now(),
       updated_at = now()
 WHERE j.source_type = 'sale_order'
   AND j.status IN ('queued', 'retry')
   AND j.event_type = 'schedule_changed'
   AND j.source_revision = 0
   AND NOT EXISTS (
     SELECT 1
       FROM public.sale_order_strap_demands d
      WHERE d.sale_order_id = j.source_id
   );

DO $$
DECLARE
  v_pending_source uuid;
BEGIN
  SELECT j.source_id INTO v_pending_source
    FROM public.strap_demand_jobs j
   WHERE j.source_type = 'sale_order'
     AND j.status IN ('queued', 'retry', 'processing')
   ORDER BY j.created_at, j.id
   LIMIT 1;
  IF v_pending_source IS NOT NULL THEN
    RAISE EXCEPTION
      'Cutover de tiras encontrou backlog ativo no PV %',
      v_pending_source
      USING ERRCODE = '55000',
        HINT = 'Drene ou cancele explicitamente toda a fila sale_order antes de reaplicar a migration.';
  END IF;
END;
$$;

INSERT INTO public.sale_order_strap_demand_clocks (
  sale_order_id, revision, updated_at
)
-- O piso fica estritamente acima de TODO job legado, inclusive dead_letter.
-- O retry legado apenas reabre a mesma row; sem este +1, uma revisao antiga
-- empatada com o max poderia voltar e materializar payload pre-cutover.
SELECT j.source_id, (max(j.source_revision) + 1)::integer, now()
  FROM public.strap_demand_jobs j
  JOIN public.sale_orders so ON so.id = j.source_id
 WHERE j.source_type = 'sale_order'
 GROUP BY j.source_id
ON CONFLICT (sale_order_id) DO UPDATE
  SET revision = greatest(
        public.sale_order_strap_demand_clocks.revision, EXCLUDED.revision),
      updated_at = now();

CREATE OR REPLACE FUNCTION public.tg_assign_sale_order_strap_job_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revision integer;
BEGIN
  IF NEW.source_type <> 'sale_order' THEN
    RETURN NEW;
  END IF;
  -- Um evento posterior nao pode invalidar o ultimo job valido antes de a
  -- primeira demanda existir. Sem fato corrente, qualquer blocker precisa ser
  -- resolvido no PV; nao ganha uma revisao nova na fila.
  IF NEW.event_type <> 'cancelled'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(NEW.payload -> 'lines') = 'array'
             THEN NEW.payload -> 'lines' ELSE '[]'::jsonb END
         ) line(value)
        WHERE jsonb_array_length(coalesce(
          line.value -> 'blocking_reasons', '[]'::jsonb)) > 0
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.sale_order_strap_demands d
        WHERE d.sale_order_id = NEW.source_id
          AND d.is_current
     ) THEN
    RAISE EXCEPTION
      'Evento de tiras bloqueado antes da primeira demanda; corrija e salve o PV'
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.sale_order_strap_demand_clocks (
    sale_order_id, revision, updated_at
  ) VALUES (NEW.source_id, 1, now())
  ON CONFLICT (sale_order_id) DO UPDATE
    SET revision = public.sale_order_strap_demand_clocks.revision + 1,
        updated_at = now()
  RETURNING revision INTO v_revision;
  NEW.source_revision := v_revision;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_assign_sale_order_strap_job_revision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_assign_sale_order_strap_job_revision
  ON public.strap_demand_jobs;
CREATE TRIGGER trg_00_assign_sale_order_strap_job_revision
BEFORE INSERT ON public.strap_demand_jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_assign_sale_order_strap_job_revision();

-- O job que materializa uma revisao nunca pode trocar receita/base mantendo a
-- mesma variante, nem carregar realizacao fisica de outra identidade.
CREATE OR REPLACE FUNCTION public.tg_guard_sale_order_strap_demand_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_revision integer;
  v_current_revision integer;
  v_previous public.sale_order_strap_demands%ROWTYPE;
BEGIN
  SELECT max(j.source_revision) INTO v_job_revision
    FROM public.strap_demand_jobs j
   WHERE j.source_type = 'sale_order'
     AND j.source_id = NEW.sale_order_id
     AND j.correlation_id = NEW.correlation_id
     AND j.status = 'processing';
  SELECT clock.revision INTO v_current_revision
    FROM public.sale_order_strap_demand_clocks clock
   WHERE clock.sale_order_id = NEW.sale_order_id;
  IF v_job_revision IS NOT NULL
     AND v_job_revision < coalesce(v_current_revision, 0) THEN
    RAISE EXCEPTION 'Evento de tiras obsoleto para o PV; a revisao mais nova prevalece'
      USING ERRCODE = '40001';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.supersedes_demand_id IS NOT NULL THEN
    SELECT * INTO v_previous
      FROM public.sale_order_strap_demands d
     WHERE d.id = NEW.supersedes_demand_id;
    IF FOUND THEN
      IF v_previous.source_mode IS NOT DISTINCT FROM NEW.source_mode
         AND v_previous.strap_variant_id IS NOT DISTINCT FROM NEW.strap_variant_id
         AND (
           v_previous.recipe_id IS DISTINCT FROM NEW.recipe_id
           OR v_previous.base_product_id IS DISTINCT FROM NEW.base_product_id
           OR v_previous.finished_product_id IS DISTINCT FROM NEW.finished_product_id
         ) THEN
        RAISE EXCEPTION 'Receita/produto congelado nao pode mudar mantendo a mesma variante'
          USING ERRCODE = '40001';
      END IF;
      IF (
        v_previous.source_mode IS DISTINCT FROM NEW.source_mode
        OR v_previous.strap_variant_id IS DISTINCT FROM NEW.strap_variant_id
      ) AND coalesce(v_previous.fulfilled_m, 0) > 0 THEN
        IF NOT EXISTS (
          SELECT 1
            FROM public.sale_order_atomic_writer_contexts context
           WHERE context.backend_pid = pg_backend_pid()
             AND context.transaction_id = txid_current()
             AND context.operation = 'override'
             AND context.sale_order_id = NEW.sale_order_id
        ) THEN
          RAISE EXCEPTION 'Identidade com tira ja realizada exige reversao administrativa explicita'
            USING ERRCODE = 'check_violation';
        ELSIF coalesce(NEW.fulfilled_m, 0) <> 0
           OR coalesce(NEW.cancelled_m, 0) <> 0 THEN
          RAISE EXCEPTION 'Override de identidade deve iniciar a nova revisao sem herdar realizacao'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_sale_order_strap_demand_revision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_guard_sale_order_strap_demand_revision
  ON public.sale_order_strap_demands;
CREATE TRIGGER trg_00_guard_sale_order_strap_demand_revision
BEFORE INSERT OR UPDATE OF correlation_id ON public.sale_order_strap_demands
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_sale_order_strap_demand_revision();

-- Um unico PV e processado em serie. O try-lock fecha a janela entre o
-- SKIP LOCKED da leitura e o commit que muda o job anterior para processing.
CREATE OR REPLACE FUNCTION public.claim_next_strap_demand_job(p_worker_id text)
RETURNS public.strap_demand_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate record;
  v_job public.strap_demand_jobs%ROWTYPE;
  v_current_revision integer;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'worker_id obrigatorio';
  END IF;

  UPDATE public.strap_demand_jobs j
     SET status = 'cancelled',
         result = jsonb_build_object(
           'no_op', true, 'reason', 'superseded_source_revision'),
         completed_at = now(),
         updated_at = now()
    FROM public.sale_order_strap_demand_clocks clock
   WHERE j.source_type = 'sale_order'
     AND j.source_id = clock.sale_order_id
     AND j.status IN ('queued', 'retry')
     AND j.source_revision < clock.revision;

  FOR v_candidate IN
    SELECT j.id, j.source_type, j.source_id, j.source_revision
      FROM public.strap_demand_jobs j
     WHERE j.status IN ('queued', 'retry')
       AND j.next_attempt_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM public.strap_demand_jobs active
          WHERE active.source_type = j.source_type
            AND active.source_id = j.source_id
            AND active.status = 'processing'
       )
     ORDER BY j.next_attempt_at, j.created_at, j.id
     FOR UPDATE OF j SKIP LOCKED
     LIMIT 64
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'strap-demand-source:' || v_candidate.source_type || ':' ||
      v_candidate.source_id::text, 0
    )) THEN
      CONTINUE;
    END IF;
    IF v_candidate.source_type = 'sale_order' THEN
      SELECT clock.revision INTO v_current_revision
        FROM public.sale_order_strap_demand_clocks clock
       WHERE clock.sale_order_id = v_candidate.source_id
       FOR SHARE;
      IF v_candidate.source_revision < coalesce(v_current_revision, 0) THEN
        UPDATE public.strap_demand_jobs
           SET status = 'cancelled',
               result = jsonb_build_object(
                 'no_op', true, 'reason', 'superseded_source_revision'),
               completed_at = now(),
               updated_at = now()
         WHERE id = v_candidate.id
           AND status IN ('queued', 'retry');
        CONTINUE;
      END IF;
    END IF;
    UPDATE public.strap_demand_jobs
       SET status = 'processing',
           attempts = attempts + 1,
           locked_at = now(),
           locked_by = p_worker_id,
           last_error = NULL
     WHERE id = v_candidate.id
       AND status IN ('queued', 'retry')
    RETURNING * INTO v_job;
    IF FOUND THEN RETURN v_job; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- UPDATEs em lote adquirem row locks antes de cada trigger de linha. O lock
-- global em BEFORE STATEMENT fecha a inversao PV1/PV2 entre aprovacao em lote
-- e edicao concorrente sem depender da ordem escolhida pelo executor.
CREATE OR REPLACE FUNCTION public.tg_lock_strap_auto_intent_before_status_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Alguns RPCs legados chegam a este statement depois de travar uma row. Se
  -- outro writer ja possui o coordenador e espera essa row, aguardar aqui
  -- formaria ciclo. Falhar como conflito otimista desfaz a transacao legada,
  -- libera a row e permite retry sem qualquer escrita parcial.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-pv-auto-intent', 0)
  ) THEN
    RAISE EXCEPTION
      'Outro processo esta alterando a intencao de tiras; recarregue e tente novamente'
      USING ERRCODE = '40001';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_lock_strap_auto_intent_before_status_statement()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_lock_strap_auto_intent_before_status_statement
  ON public.sale_orders;
CREATE TRIGGER trg_000_lock_strap_auto_intent_before_status_statement
BEFORE UPDATE OF status ON public.sale_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_lock_strap_auto_intent_before_status_statement();

DROP TRIGGER IF EXISTS trg_000_lock_strap_auto_intent_before_item_insert_delete
  ON public.sale_order_items;
CREATE TRIGGER trg_000_lock_strap_auto_intent_before_item_insert_delete
BEFORE INSERT OR DELETE ON public.sale_order_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_lock_strap_auto_intent_before_status_statement();

DROP TRIGGER IF EXISTS trg_000_lock_strap_auto_intent_before_item_update
  ON public.sale_order_items;
CREATE TRIGGER trg_000_lock_strap_auto_intent_before_item_update
BEFORE UPDATE OF
  sale_order_id, reference_id, material_variant_id, color, quantity, grade,
  strap_colors, strap_sourcing, strap_sourcing_revision
ON public.sale_order_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.tg_lock_strap_auto_intent_before_status_statement();

-- Um INSERT direto nao possui AFTER seguro: os itens ainda nao existem. Status
-- confirmado so pode nascer dentro do create atomico, que enfileira depois de
-- persistir e validar todos os snapshots.
CREATE OR REPLACE FUNCTION public.tg_guard_confirmed_sale_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('Aprovado', 'Em Produção')
     AND NOT EXISTS (
       SELECT 1
         FROM public.sale_order_atomic_writer_contexts context
        WHERE context.backend_pid = pg_backend_pid()
          AND context.transaction_id = txid_current()
          AND context.operation = 'create'
     ) THEN
    RAISE EXCEPTION
      'PV confirmado deve ser criado pelo writer atomico com todos os itens'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_confirmed_sale_order_insert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_guard_confirmed_sale_order_insert
  ON public.sale_orders;
CREATE TRIGGER trg_00_guard_confirmed_sale_order_insert
BEFORE INSERT ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_confirmed_sale_order_insert();

-- Aprovar nao e editar. O BEFORE apenas fecha a ordem dos locks. A validacao
-- completa ocorre no enqueue AFTER, quando o cabecalho NEW e todos os itens ja
-- estao visiveis; assim agenda+cambio de status na mesma instrucao nao usa OLD.
CREATE OR REPLACE FUNCTION public.tg_prepare_sale_order_straps_before_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('Aprovado', 'Em Produção')
     OR OLD.status IN ('Aprovado', 'Em Produção')
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- No writer atomico o cabecalho legado e gravado antes dos itens. Todos os
  -- itens ja foram preparados/validados em memoria e o wrapper executara um
  -- unico preview+enqueue depois de persistir o lote completo.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.operation = 'update'
       AND context.sale_order_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode confirmar PV com tiras';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  PERFORM 1
    FROM public.sale_order_items i
   WHERE i.sale_order_id = NEW.id
   ORDER BY i.id
   FOR SHARE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_prepare_sale_order_straps_before_confirmation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_00_prepare_sale_order_straps_before_confirmation
  ON public.sale_orders;
CREATE TRIGGER trg_00_prepare_sale_order_straps_before_confirmation
BEFORE UPDATE OF status ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_prepare_sale_order_straps_before_confirmation();

-- Durante o writer em lote, cabecalho e itens ainda nao representam o mesmo
-- instante. O wrapper publica um unico evento depois de persistir ambos.
CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.operation = 'update'
       AND context.sale_order_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('Aprovado', 'Em Produção')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := CASE WHEN NEW.status = 'Em Produção'
      THEN 'direct_production' ELSE 'approved' END;
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, v_event, gen_random_uuid());
  ELSIF NEW.status IN ('Cancelado', 'Cancelada')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, 'cancelled', gen_random_uuid());
  ELSIF NEW.status IN ('Aprovado', 'Em Produção')
     AND (
       NEW.billing_week IS DISTINCT FROM OLD.billing_week
       OR NEW.delivery_month IS DISTINCT FROM OLD.delivery_month
       OR NEW.delivery_week IS DISTINCT FROM OLD.delivery_week
       OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline
     ) THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      NEW.id, 'schedule_changed', gen_random_uuid());
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm()
  FROM PUBLIC, anon, authenticated, service_role;

-- A revalidacao acima atualiza o item antes de o status novo existir. O job
-- unico e criado pelo trigger de confirmacao da sale_order; nao enfileiramos um
-- segundo item_updated diferido para a mesma mudanca.
CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_sale_order_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS NOT DISTINCT FROM OLD.sale_order_id
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.color IS NOT DISTINCT FROM OLD.color
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.grade IS NOT DISTINCT FROM OLD.grade
     AND NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors
     AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing
     AND NEW.strap_sourcing_revision IS NOT DISTINCT FROM
         OLD.strap_sourcing_revision THEN
    RETURN NEW;
  END IF;
  v_sale_order_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.sale_order_id ELSE NEW.sale_order_id END;
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_atomic_writer_contexts context
     WHERE context.backend_pid = pg_backend_pid()
       AND context.transaction_id = txid_current()
       AND context.sale_order_id = v_sale_order_id
       AND context.operation IN ('create', 'update', 'override')
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO v_status
    FROM public.sale_orders
   WHERE id = v_sale_order_id;
  IF v_status IN ('Aprovado', 'Em Produção') THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      v_sale_order_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'approved' ELSE 'item_updated' END,
      gen_random_uuid()
    );
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_item_change()
  FROM PUBLIC, anon, authenticated, service_role;
