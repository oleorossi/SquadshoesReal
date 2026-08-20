-- =============================================================================
-- Napa-base sem perfil de largura travava o "Criar Pedido" com erro cru
-- =============================================================================
-- Sintoma em producao (20/08/2026): montar um PV com um item cuja ficha tem
-- linha de tira `reference_base` e cuja variante de material aponta uma napa
-- nova (GLOW METALIC, criada pela migration 20270101005800) devolvia o toast
--
--     Erro: Base sem perfil de largura util vigente e aprovado
--
-- e o pedido inteiro nao salvava. A mensagem e o RAISE de
-- `tg_validate_base_material_official_product`, que roda quando
-- `ensure_sale_order_internal_strap_intents` designa o SKU oficial da napa na
-- cor do item. O gatilho exige uma linha vigente aprovada em
-- `base_material_width_profiles` para o grupo-base, e so NAPA SUDANI e NAPA
-- SOFT tinham uma. Nenhuma napa cadastrada depois delas conseguia vender uma
-- tira interna, e o Comercial recebia o texto cru do Postgres.
--
-- O perfil nao carrega decisao de engenharia nova: o proprio gatilho recusa
-- qualquer perfil cuja largura nao seja EXATAMENTE a de
-- `strap_material_product_width_mm(produto_oficial)` — ou seja, a largura ja
-- cadastrada na ficha de componente, no produto ou no grupo. O unico valor
-- possivel e o que ja esta no cadastro; faltava apenas materializa-lo. Esta
-- migration passa a materializa-lo pelo mesmo criterio de "unico e inequivoco"
-- que `ensure_sale_order_internal_strap_intents` ja aplica ao SKU oficial, e
-- deixa a largura AMBIGUA (divergente entre SKUs da familia) ou AUSENTE
-- bloqueando — agora com uma mensagem que diz onde cadastrar.
--
-- ⚠ O rendimento da conversao (`artisanal_strap_recipes`) continua sendo dado
-- de engenharia do dono e NAO e inventado aqui. Depois deste fix a napa nova
-- para no erro seguinte, que ja nomeia tipo, medida e napa:
--   'Nao existe conversao aprovada para % % em %; cadastre o rendimento antes do PV'
-- Isso e o comportamento correto — o que estava errado era travar antes disso,
-- por um numero que o banco ja conhecia.

BEGIN;

-- Largura util da napa-base derivada SOMENTE do cadastro existente. Devolve
-- NULL — nunca um palpite — quando os SKUs lineares ativos da familia divergem
-- entre si ou quando algum deles nao tem largura. NULL e o sinal de "decida no
-- cadastro", nao de "assuma um valor".
CREATE OR REPLACE FUNCTION public.resolve_base_group_usable_width_mm(
  p_base_group_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT public.strap_material_product_width_mm(p.id) AS width_mm
      FROM public.products p
     WHERE p.group_id = p_base_group_id
       AND p.active
       AND p.unit = 'm'
       -- Produto acabado de tira nunca e napa-base (mesma regra do gatilho de
       -- validacao do SKU oficial); incluí-lo poluiria a largura da familia.
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.finished_product_id = p.id
       )
  )
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN count(*) FILTER (WHERE width_mm IS NULL) > 0 THEN NULL
    WHEN count(DISTINCT width_mm) <> 1 THEN NULL
    ELSE max(width_mm)
  END
    FROM candidates;
$$;

REVOKE ALL ON FUNCTION public.resolve_base_group_usable_width_mm(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_base_group_usable_width_mm(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_base_group_usable_width_mm(uuid) IS
  'Largura util em mm ja cadastrada para a napa-base, apenas quando os SKUs lineares ativos da familia concordam; NULL quando ausente ou divergente.';

-- Idempotente por construcao: devolve o perfil vigente quando ja existe e so
-- cria quando NAO existe nenhum. Nunca supersede nem suspende receita — isso e
-- prerrogativa de `approve_base_material_width_profile`, que trata troca de
-- largura. Aqui a largura nasce igual a cadastrada, entao nao ha o que invalidar.
CREATE OR REPLACE FUNCTION public.ensure_base_material_width_profile(
  p_base_group_id uuid,
  p_actor_id uuid,
  p_reason text
)
RETURNS public.base_material_width_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_width_mm numeric;
BEGIN
  IF p_base_group_id IS NULL THEN
    RAISE EXCEPTION 'Napa-base e obrigatoria para o perfil de largura';
  END IF;

  SELECT * INTO v_group
    FROM public.product_groups g
   WHERE g.id = p_base_group_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Napa-base inexistente';
  END IF;

  -- Mesmo lock de `approve_base_material_width_profile`: duas transacoes
  -- materializando a mesma familia se serializam em vez de colidir no indice
  -- unico parcial `base_material_width_profiles_current_approved_uq`.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-width:' || p_base_group_id::text, 0
  ));

  SELECT * INTO v_profile
    FROM public.base_material_width_profiles wp
   WHERE wp.base_group_id = p_base_group_id
     AND wp.status = 'approved'
     AND wp.valid_to IS NULL
   FOR UPDATE;
  IF FOUND THEN
    RETURN v_profile;
  END IF;

  v_width_mm := public.resolve_base_group_usable_width_mm(p_base_group_id);
  IF v_width_mm IS NULL OR v_width_mm <= 0 THEN
    RAISE EXCEPTION
      'A napa-base % nao tem largura util unica cadastrada; informe a largura da bobina em Materiais > Ficha de Componente > Dimensoes (a mesma para todos os SKUs da familia) antes de vender uma tira interna nesta napa',
      v_group.name;
  END IF;
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'A criacao do perfil de largura exige usuario autenticado para a trilha de auditoria';
  END IF;

  INSERT INTO public.base_material_width_profiles (
    base_group_id, version, usable_width_mm, status, valid_from,
    approved_by, approved_at, review_reason
  )
  SELECT p_base_group_id,
         coalesce(max(wp.version), 0) + 1,
         v_width_mm,
         'approved',
         now(),
         p_actor_id,
         now(),
         coalesce(nullif(btrim(p_reason), ''), 'Perfil de largura materializado da ficha de componente')
    FROM public.base_material_width_profiles wp
   WHERE wp.base_group_id = p_base_group_id
  RETURNING * INTO v_profile;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_base_material_width_profile(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.ensure_base_material_width_profile(uuid, uuid, text) IS
  'Garante o perfil de largura vigente da napa-base a partir da largura ja cadastrada; bloqueia com mensagem acionavel quando ela e ausente ou divergente.';

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

  -- O perfil de largura util e pre-requisito do SKU oficial (o gatilho
  -- tg_validate_base_material_official_product exige um vigente aprovado). Ele
  -- nao acrescenta informacao nenhuma: o mesmo gatilho so aceita o perfil cuja
  -- largura seja EXATAMENTE a ja cadastrada na ficha/produto/grupo do SKU. Por
  -- isso ele e materializado aqui, na mesma transacao e pelo mesmo criterio de
  -- "unico e inequivoco" que ja governa a designacao oficial logo abaixo.
  PERFORM public.ensure_base_material_width_profile(
    v_base_group_id, v_actor_id, v_reason
  );

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

-- Diagnostico somente-leitura do MESMO caminho que o writer percorre no save.
-- Existe para a tela do PV parar de descobrir cadastro faltando por uma string
-- crua de RAISE depois de o Comercial ja ter montado o pedido inteiro.
CREATE OR REPLACE FUNCTION public.diagnose_sale_order_internal_strap_readiness(
  p_reference_id uuid,
  p_material_variant_id uuid,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_base_group_id uuid;
  v_base_group public.product_groups%ROWTYPE;
  v_color public.canonical_colors%ROWTYPE;
  v_color_id uuid;
  v_line_entry record;
  v_line jsonb;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_type public.artisanal_strap_types%ROWTYPE;
  v_measure_id uuid;
  v_measure_ids uuid[] := ARRAY[]::uuid[];
  v_reference_lines integer := 0;
  v_issues jsonb := '[]'::jsonb;
  v_width_mm numeric;
  v_linear_skus integer;
  v_candidates integer;
  v_pinned_base_product_id uuid;
  v_group_label text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Somente usuario aprovado pode consultar o cadastro de tiras';
  END IF;

  SELECT * INTO v_sheet FROM public.technical_sheets ts WHERE ts.id = p_reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'requires_reference_base', false, 'ready', true, 'issues', '[]'::jsonb
    );
  END IF;

  FOR v_line_entry IN
    SELECT entry.value AS line, entry.ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
          THEN v_sheet.strap_colors ELSE '[]'::jsonb END
      ) WITH ORDINALITY entry(value, ordinality)
     ORDER BY entry.ordinality
  LOOP
    v_line := v_line_entry.line;
    CONTINUE WHEN coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base')
      <> 'reference_base';
    v_reference_lines := v_reference_lines + 1;
    BEGIN
      v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_measure_id := NULL;
    END;
    IF nullif(v_line ->> 'technical_strap_line_id', '') IS NULL
       OR v_measure_id IS NULL THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'linha_sem_medida_canonica',
        'message', format(
          'A linha de tira "%s" da ficha nao tem medida canonica; resolva o cadastro da tira no Estoque.',
          coalesce(nullif(v_line ->> 'label', ''), 'sem rotulo')
        )
      ));
    ELSIF NOT v_measure_id = ANY(v_measure_ids) THEN
      v_measure_ids := array_append(v_measure_ids, v_measure_id);
    END IF;
  END LOOP;

  IF v_reference_lines = 0 THEN
    RETURN jsonb_build_object(
      'requires_reference_base', false, 'ready', true, 'issues', '[]'::jsonb
    );
  END IF;

  v_base_group_id := public.resolve_strap_base_group_id(
    p_reference_id, p_material_variant_id
  );
  SELECT * INTO v_base_group FROM public.product_groups g WHERE g.id = v_base_group_id;
  v_group_label := coalesce(v_base_group.name, 'napa-base');
  IF v_base_group.id IS NULL THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'napa_base_indefinida',
      'message', 'A ficha/variante deste item nao identifica a napa-base do cabedal; escolha a variante de material ou defina a napa-base na ficha.'
    ));
  END IF;

  v_color_id := public.resolve_strap_canonical_color_id(p_color);
  SELECT * INTO v_color FROM public.canonical_colors c WHERE c.id = v_color_id AND c.active;
  IF v_color.id IS NULL THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'cor_nao_canonica',
      'message', format(
        'A cor "%s" do item nao corresponde a uma cor canonica ativa; cadastre a cor ou o apelido aprovado no Hub de Tiras.',
        coalesce(nullif(btrim(coalesce(p_color, '')), ''), 'sem cor')
      )
    ));
  END IF;

  IF v_base_group.id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.base_material_width_profiles wp
       WHERE wp.base_group_id = v_base_group_id
         AND wp.status = 'approved'
         AND wp.valid_to IS NULL
    ) THEN
      v_width_mm := public.resolve_base_group_usable_width_mm(v_base_group_id);
      IF v_width_mm IS NULL THEN
        SELECT count(*)::integer INTO v_linear_skus
          FROM public.products p
         WHERE p.group_id = v_base_group_id AND p.active AND p.unit = 'm'
           AND NOT EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.finished_product_id = p.id
           );
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'largura_util_indisponivel',
          'message', CASE WHEN v_linear_skus = 0
            THEN format(
              'A napa-base %s nao tem nenhum SKU linear (m) ativo; cadastre a napa no Estoque antes de vender a tira interna.',
              v_group_label)
            ELSE format(
              'A napa-base %s nao tem largura util unica cadastrada; informe a mesma largura de bobina para todos os SKUs em Materiais > Ficha de Componente > Dimensoes.',
              v_group_label)
          END
        ));
      END IF;
    END IF;

    v_pinned_base_product_id := public.resolve_strap_pinned_base_product_id(
      p_reference_id, p_material_variant_id);
    IF v_pinned_base_product_id IS NOT NULL AND v_color.id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.id = v_pinned_base_product_id
            AND p.active
            AND p.group_id = v_base_group_id
            AND p.unit = 'm'
            AND public.resolve_strap_canonical_color_id(p.color) = v_color_id
       ) THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'napa_pinada_divergente',
        'message', format(
          'O SKU de napa pinado na ficha/variante nao e %s na cor %s; corrija o pin do cabedal antes de vender a tira interna.',
          v_group_label, v_color.name)
      ));
    END IF;

    IF v_color.id IS NOT NULL AND v_pinned_base_product_id IS NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.base_material_color_official_products op
         WHERE op.base_group_id = v_base_group_id
           AND op.color_id = v_color_id
           AND op.status = 'active'
      ) THEN
        SELECT count(*)::integer INTO v_candidates
          FROM public.products p
         WHERE p.group_id = v_base_group_id
           AND p.active
           AND p.unit = 'm'
           AND public.resolve_strap_canonical_color_id(p.color) = v_color_id
           AND NOT EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants av
              WHERE av.finished_product_id = p.id
           );
        IF v_candidates = 0 THEN
          v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'napa_cor_inexistente',
            'message', format(
              'Nao existe %s %s ativo no estoque; cadastre a napa do cabedal nessa cor.',
              v_group_label, v_color.name)
          ));
        ELSIF v_candidates > 1 THEN
          v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'napa_cor_ambigua',
            'message', format(
              'Existem %s produtos ativos para %s %s; um Administrador deve designar o SKU oficial no Hub de Tiras.',
              v_candidates, v_group_label, v_color.name)
          ));
        END IF;
      END IF;
    END IF;

    FOREACH v_measure_id IN ARRAY v_measure_ids LOOP
      SELECT * INTO v_measure
        FROM public.artisanal_strap_measures m WHERE m.id = v_measure_id;
      SELECT * INTO v_type
        FROM public.artisanal_strap_types t WHERE t.id = v_measure.strap_type_id;
      IF v_measure.id IS NULL OR NOT coalesce(v_measure.active, false)
         OR v_type.id IS NULL OR NOT coalesce(v_type.active, false) THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'medida_inativa',
          'message', 'Uma medida/familia canonica usada pela ficha esta inativa; reative no Hub de Tiras.'
        ));
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.artisanal_strap_recipes r
         WHERE r.measure_id = v_measure_id
           AND r.base_group_id = v_base_group_id
           AND r.status = 'approved'
           AND r.valid_from <= now()
           AND (r.valid_to IS NULL OR r.valid_to > now())
      ) THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'rendimento_nao_cadastrado',
          'message', format(
            'Nao existe conversao aprovada para %s %s em %s; cadastre o rendimento (m de tira por m de napa) no Hub de Tiras antes do PV.',
            v_type.name, v_measure.display_name, v_group_label)
        ));
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'reference_id', p_reference_id,
    'material_variant_id', p_material_variant_id,
    'requires_reference_base', true,
    'base_group_id', v_base_group_id,
    'base_group_name', v_base_group.name,
    'color_id', v_color_id,
    'color_name', v_color.name,
    'ready', jsonb_array_length(v_issues) = 0,
    'issues', v_issues
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.diagnose_sale_order_internal_strap_readiness(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.diagnose_sale_order_internal_strap_readiness(uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.diagnose_sale_order_internal_strap_readiness(uuid, uuid, text) IS
  'Espelha, somente-leitura, o cadastro que ensure_sale_order_internal_strap_intents exige no save do PV, para a tela avisar antes de o pedido ser montado.';

-- Backfill restrito: SOMENTE as napas-base que alguma ficha/variante viva usa
-- como origem de tira interna e cuja largura ja esta cadastrada e concordante.
-- Nenhuma outra familia de produto ganha perfil, e nenhuma largura e arbitrada.
DO $$
DECLARE
  v_actor_id uuid;
  v_reason constant text :=
    'Backfill 20270101006300: perfil de largura materializado da ficha de componente';
  v_group record;
  v_created integer := 0;
BEGIN
  SELECT p.id INTO v_actor_id
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.id AND r.role::text = 'admin'
   WHERE p.approved
   ORDER BY (p.id = '49371f4d-641f-466d-be26-686ef57743ec'::uuid) DESC, p.created_at
   LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum administrador aprovado para assinar o perfil de largura';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  FOR v_group IN
    WITH sheets AS (
      SELECT ts.id
        FROM public.technical_sheets ts
       WHERE jsonb_typeof(ts.strap_colors) = 'array'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(ts.strap_colors) entry
            WHERE coalesce(nullif(entry ->> 'identity_basis', ''), 'reference_base')
              = 'reference_base'
         )
    ), resolved AS (
      SELECT public.resolve_strap_base_group_id(s.id, NULL) AS base_group_id
        FROM sheets s
      UNION
      SELECT public.resolve_strap_base_group_id(s.id, rmv.id)
        FROM sheets s
        JOIN public.reference_material_variants rmv
          ON rmv.reference_id = s.id AND coalesce(rmv.active, true)
    )
    SELECT DISTINCT g.id, g.name
      FROM resolved r
      JOIN public.product_groups g ON g.id = r.base_group_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.base_material_width_profiles wp
        WHERE wp.base_group_id = g.id
          AND wp.status = 'approved'
          AND wp.valid_to IS NULL
     )
       AND public.resolve_base_group_usable_width_mm(g.id) IS NOT NULL
     ORDER BY g.name
  LOOP
    PERFORM public.ensure_base_material_width_profile(
      v_group.id, v_actor_id, v_reason
    );
    v_created := v_created + 1;
    RAISE NOTICE 'Perfil de largura criado para a napa-base % (%)',
      v_group.name, v_group.id;
  END LOOP;

  RAISE NOTICE 'Backfill de perfil de largura: % napa(s) atualizada(s)', v_created;
END;
$$;

COMMIT;
