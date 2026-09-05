-- Materiais-base por posicao: politica da ficha, escolha comercial e snapshot.
-- Criada com Supabase CLI; versao reposicionada apos 158 e as reservas 159/160.
-- Nao converte pecas de area em tiras nem altera dados/historico de producao.

BEGIN;

-- Politica tecnica independente da politica de cor e da origem internal/buy_ready.
CREATE OR REPLACE FUNCTION private.validate_strap_material_policy(p_line jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_mode text := coalesce(p_line ->> 'material_mode', 'follow_reference');
  v_basis text := coalesce(nullif(p_line ->> 'identity_basis', ''), 'reference_base');
  v_fixed uuid;
  v_allowed jsonb := coalesce(nullif(p_line -> 'allowed_material_group_ids', 'null'::jsonb), '[]'::jsonb);
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_entry jsonb;
BEGIN
  IF jsonb_typeof(p_line) IS DISTINCT FROM 'object'
     OR v_mode NOT IN ('follow_reference', 'fixed_group', 'select_on_order')
     OR v_basis NOT IN ('reference_base', 'finished_product_group') THEN
    RAISE EXCEPTION 'Politica de material da posicao invalida' USING ERRCODE = '23514';
  END IF;
  BEGIN
    v_fixed := nullif(p_line ->> 'material_group_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Material fixo da posicao possui UUID invalido' USING ERRCODE = '23514';
  END;
  IF jsonb_typeof(v_allowed) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Materiais permitidos da posicao devem ser uma lista' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(v_allowed) > 25 THEN
    RAISE EXCEPTION 'Uma posicao admite no maximo 25 materiais permitidos' USING ERRCODE = '23514';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_allowed) LOOP
    BEGIN
      IF jsonb_typeof(v_entry) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'UUID invalido';
      END IF;
      v_id := (v_entry #>> '{}')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Material permitido da posicao possui UUID invalido' USING ERRCODE = '23514';
    END;
    IF v_id IS NULL OR v_id = ANY(v_ids) THEN
      RAISE EXCEPTION 'Materiais permitidos da posicao possuem UUID ausente ou repetido' USING ERRCODE = '23514';
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  v_allowed := to_jsonb(v_ids);
  IF v_mode = 'fixed_group' THEN
    IF v_fixed IS NULL OR cardinality(v_ids) <> 0 THEN
      RAISE EXCEPTION 'Material fixo exige um grupo e nao admite lista de escolhas' USING ERRCODE = '23514';
    END IF;
    v_ids := ARRAY[v_fixed];
  ELSIF v_mode = 'select_on_order' THEN
    IF v_fixed IS NOT NULL OR cardinality(v_ids) = 0 THEN
      RAISE EXCEPTION 'Selecao no pedido exige lista de materiais e nao admite grupo fixo' USING ERRCODE = '23514';
    END IF;
  ELSIF v_fixed IS NOT NULL OR cardinality(v_ids) <> 0 THEN
    RAISE EXCEPTION 'Seguir referencia nao admite material proprio da posicao' USING ERRCODE = '23514';
  END IF;
  IF v_basis = 'finished_product_group' AND v_mode <> 'follow_reference' THEN
    RAISE EXCEPTION 'Tira comprada pronta nao admite politica de materia-prima' USING ERRCODE = '23514';
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT public.strap_base_group_is_eligible(v_id)
       OR public.is_buy_ready_strass_identity(NULL, v_id) THEN
      RAISE EXCEPTION 'Material-base da posicao nao e materia-prima linear elegivel' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'material_mode', v_mode,
    'material_group_id', v_fixed,
    'allowed_material_group_ids', v_allowed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.resolve_technical_strap_material(
  p_reference_id uuid, p_material_variant_id uuid,
  p_line_id uuid, p_selected_group_id uuid, p_require_selection boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_line jsonb;
  v_count integer;
  v_policy jsonb;
  v_mode text;
  v_basis text;
  v_base uuid;
  v_name text;
  v_pin uuid;
BEGIN
  SELECT count(*)::integer, jsonb_agg(line.value) -> 0 INTO v_count, v_line
    FROM public.technical_sheets sheet
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(sheet.strap_colors) = 'array'
        THEN sheet.strap_colors ELSE '[]'::jsonb END
    ) line(value)
   WHERE sheet.id = p_reference_id
     AND line.value ->> 'technical_strap_line_id' = p_line_id::text;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'UUID da posicao deve pertencer uma unica vez a ficha vigente' USING ERRCODE = '23514';
  END IF;
  IF p_material_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reference_material_variants variant
     WHERE variant.id = p_material_variant_id
       AND variant.reference_id = p_reference_id
       AND coalesce(variant.active, true)
  ) THEN
    RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa' USING ERRCODE = '23514';
  END IF;
  v_policy := private.validate_strap_material_policy(v_line);
  v_mode := v_policy ->> 'material_mode';
  v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');
  IF v_basis = 'finished_product_group' THEN
    v_base := nullif(v_line ->> 'identity_group_id', '')::uuid;
  ELSIF v_mode = 'follow_reference' THEN
    v_base := public.resolve_strap_base_group_id(p_reference_id, p_material_variant_id);
    -- Um pin de outra origem/cor nunca acompanha uma posicao de material proprio.
    IF coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'follow_main' THEN
      v_pin := public.resolve_strap_pinned_base_product_id(p_reference_id, p_material_variant_id);
    END IF;
  ELSIF v_mode = 'fixed_group' THEN
    v_base := (v_policy ->> 'material_group_id')::uuid;
  ELSE
    IF p_selected_group_id IS NULL THEN
      IF p_require_selection THEN
        RAISE EXCEPTION 'Selecione o material da posicao no Pedido de Venda' USING ERRCODE = '23514';
      END IF;
    ELSIF NOT ((v_policy -> 'allowed_material_group_ids') ? p_selected_group_id::text) THEN
      RAISE EXCEPTION 'Material escolhido nao e permitido para esta posicao da ficha' USING ERRCODE = '23514';
    END IF;
    v_base := p_selected_group_id;
  END IF;
  IF v_base IS NOT NULL THEN
    SELECT g.name INTO v_name FROM public.product_groups g WHERE g.id = v_base;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo-base da posicao nao existe' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN v_policy || jsonb_build_object(
    'base_group_id', v_base, 'base_group_name', v_name,
    'pinned_base_product_id', v_pin
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.validate_strap_material_policy(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.resolve_technical_strap_material(uuid,uuid,uuid,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_basis text;
  -- independent_strap_colors_20270101015400
  v_color_mode text;
  v_group_id uuid;
  v_legacy_group_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
BEGIN
  IF NEW.strap_colors IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array JSON';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    PERFORM private.validate_strap_material_policy(v_line);
    v_group_id := NULL;
    v_legacy_group_id := NULL;
    v_measure_id := NULL;
    v_strap_type_id := NULL;
    v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');

    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
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

    BEGIN
      v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
      v_strap_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida canonica invalida';
    END;

    IF (v_measure_id IS NULL) <> (v_strap_type_id IS NULL) THEN
      RAISE EXCEPTION 'Linha tecnica exige familia e medida canonicas juntas';
    END IF;

    IF v_measure_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures measure
        JOIN public.artisanal_strap_types strap_type
          ON strap_type.id = measure.strap_type_id
       WHERE measure.id = v_measure_id
         AND measure.strap_type_id = v_strap_type_id
         AND measure.active
         AND strap_type.active
    ) THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida inativa ou divergente';
    END IF;

    IF v_basis = 'finished_product_group' THEN
      BEGIN
        v_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta possui identity_group_id invalido';
      END;
      IF v_group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_groups product_group WHERE product_group.id = v_group_id
      ) THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta exige identity_group_id existente';
      END IF;
    END IF;

    BEGIN
      v_legacy_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_group_id := NULL;
    END;
    IF public.is_buy_ready_strass_identity(NULL, v_legacy_group_id)
       AND (
         v_basis <> 'finished_product_group'
         OR v_group_id IS DISTINCT FROM v_legacy_group_id
       ) THEN
      RAISE EXCEPTION 'Linha STRASS por UUID explicito exige finished_product_group e identity_group_id exato';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION private.ensure_sale_order_internal_strap_materials(p_reference_id uuid, p_material_variant_id uuid, p_color_id uuid, p_expected_line_ids uuid[], p_selected_groups jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_material_context jsonb;
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
  -- independent_strap_colors_20270101015400: o pin fisico vale somente
  -- quando a linha segue a cor principal. Uma linha independente preserva o
  -- mesmo grupo-base, mas resolve o SKU oficial da propria cor.
  v_enforce_pinned_product boolean := true;
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

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  IF jsonb_typeof(coalesce(p_selected_groups, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(coalesce(p_selected_groups, '{}'::jsonb)) k(key)
        WHERE NOT k.key = ANY(ARRAY(SELECT id::text FROM unnest(p_expected_line_ids) id))
     ) THEN
    RAISE EXCEPTION 'Selecao de materiais possui posicao inesperada' USING ERRCODE = '23514';
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
  -- O chamador pode materializar uma cor por vez, mas nunca pode pedir uma
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
  END IF;

  -- Ordem por medida + ordinal garante os mesmos locks em chamadas
  -- concorrentes e permite que linhas repetidas compartilhem uma variante.
  FOR v_line_entry IN
    SELECT entry.value AS line, entry.ordinality
      FROM jsonb_array_elements(v_sheet.strap_colors)
        WITH ORDINALITY entry(value, ordinality)
     WHERE coalesce(nullif(entry.value ->> 'identity_basis', ''), 'reference_base')
       = 'reference_base'
       AND (entry.value ->> 'technical_strap_line_id')::uuid
           = ANY(coalesce(p_expected_line_ids, ARRAY[]::uuid[]))
     ORDER BY entry.value ->> 'measure_id', entry.ordinality
  LOOP
    v_line := v_line_entry.line;
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    v_measure_id := (v_line ->> 'measure_id')::uuid;
    v_material_context := private.resolve_technical_strap_material(
      p_reference_id, p_material_variant_id, v_line_id,
      nullif(p_selected_groups ->> v_line_id::text, '')::uuid, true
    );
    v_base_group_id := (v_material_context ->> 'base_group_id')::uuid;
    v_pinned_base_product_id := (v_material_context ->> 'pinned_base_product_id')::uuid;
    v_enforce_pinned_product := v_pinned_base_product_id IS NOT NULL;
    v_official := NULL;
    v_base_product := NULL;
    v_recipe := NULL;
    v_variant := NULL;
    v_finished_product := NULL;
    v_candidate_product_id := NULL;
    SELECT * INTO v_base_group FROM public.product_groups g
     WHERE g.id = v_base_group_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A posicao nao identifica material-base por UUID';
    END IF;
  IF v_pinned_base_product_id IS NOT NULL
     AND v_enforce_pinned_product THEN
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
     AND v_enforce_pinned_product
     AND v_pinned_base_product_id IS NOT NULL
     AND v_official.official_product_id IS DISTINCT FROM v_pinned_base_product_id THEN
    RAISE EXCEPTION 'O SKU oficial da napa diverge do produto pinado no cabedal; um Administrador deve corrigir o conflito';
  END IF;

  IF v_official.id IS NULL THEN
    IF v_enforce_pinned_product AND v_pinned_base_product_id IS NOT NULL THEN
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
      'base_group_name', v_base_group.name,
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
$function$;


CREATE OR REPLACE FUNCTION public.ensure_sale_order_internal_strap_intents(
  p_reference_id uuid, p_material_variant_id uuid, p_color_id uuid, p_expected_line_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  -- Assinatura legada preservada. Uma linha select_on_order sem escolha nao
  -- pode voltar silenciosamente ao material principal da referencia.
  RETURN private.ensure_sale_order_internal_strap_materials(
    p_reference_id, p_material_variant_id, p_color_id, p_expected_line_ids, '{}'::jsonb
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.ensure_sale_order_internal_strap_materials(uuid,uuid,uuid,uuid[],jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ensure_sale_order_internal_strap_intents(uuid,uuid,uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.prepare_sale_order_item_internal_straps(p_item jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_material_context jsonb;
  v_ensure jsonb;
  -- independent_strap_colors_20270101015400
  v_ensure_lines jsonb := '[]'::jsonb;
  v_color_mode text;
  v_ensured_line jsonb;
  v_catalog jsonb;
  v_existing_source jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
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
       AND (
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
       ) THEN
      RETURN jsonb_build_object(
        'item', p_item || jsonb_build_object(
          -- O snapshot comprometido e um fato historico completo: alem da
          -- origem, preserve tambem a sequencia tecnica persistida. A
          -- comparacao acima aceita o mesmo multiconjunto em qualquer ordem
          -- apenas para reconhecer um update estruturalmente inalterado.
          'strap_colors', coalesce(v_current.strap_colors, '[]'::jsonb),
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
    -- upper_and_straps_coexist_20270101014675
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
    IF nullif(v_sheet_line ->> 'color_mode', '') IS NOT NULL
       AND v_sheet_line ->> 'color_mode' NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui politica de cor invalida';
    END IF;
    v_color_mode := CASE
      WHEN v_sheet_basis = 'finished_product_group' THEN 'select_on_order'
      ELSE coalesce(nullif(v_sheet_line ->> 'color_mode', ''), 'follow_main')
    END;
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

    v_material_context := private.resolve_technical_strap_material(
      v_reference_id, v_material_variant_id, v_line_id,
      nullif(v_line ->> 'base_group_id', '')::uuid, true
    );
    v_basis_aligned_straps := v_basis_aligned_straps || jsonb_build_array(
      (v_line
        - 'id' - 'technical_strap_line_id'
        - 'strap_type_id' - 'measure_id'
        - 'identity_basis' - 'identity_group_id' - 'color_mode'
        - 'material_mode' - 'material_group_id' - 'allowed_material_group_ids'
        - 'base_group_id' - 'base_group_name'
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
        'color_mode', v_color_mode,
        'material_mode', v_material_context -> 'material_mode',
        'material_group_id', v_material_context -> 'material_group_id',
        'allowed_material_group_ids', v_material_context -> 'allowed_material_group_ids',
        'base_group_id', v_material_context -> 'base_group_id',
        'base_group_name', v_material_context -> 'base_group_name',
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
  -- A sequencia da ficha e autoritativa para itens novos/editaveis.
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
         = sheet_line.value ->> 'technical_strap_line_id';

  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_sheet_all_ids FROM unnest(v_sheet_all_ids) id;
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_item_all_ids FROM unnest(v_item_all_ids) id;
  IF v_item_all_ids IS DISTINCT FROM v_sheet_all_ids THEN
    RAISE EXCEPTION 'A ficha mudou desde a abertura do pedido; recarregue antes de salvar'
      USING ERRCODE = '40001';
  END IF;

  -- select_on_order_only_main_color_optional_20270101015400
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
  ) THEN
    v_color_id := public.resolve_strap_canonical_color_id(p_item ->> 'color');
    IF v_color_id IS NULL THEN
      RAISE EXCEPTION 'A cor principal do item nao corresponde a uma unica cor canonica aprovada';
    END IF;
    SELECT c.name INTO v_color_name
      FROM public.canonical_colors c
     WHERE c.id = v_color_id AND c.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cor principal canonica inativa'; END IF;
    -- Cada UUID sera materializado abaixo com sua propria cor.
    v_ensure := jsonb_build_object('lines', '[]'::jsonb);
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
        v_ensure := private.ensure_sale_order_internal_strap_materials(
          v_reference_id, v_material_variant_id, v_line_color_id, ARRAY[v_line_id],
          jsonb_build_object(v_line_id::text, v_line -> 'base_group_id')
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

      SELECT value INTO v_ensured_line
        FROM jsonb_array_elements(v_ensure -> 'lines') ensured(value)
       WHERE ensured.value ->> 'technical_strap_line_id' = v_line_id::text;
      IF NOT FOUND THEN RAISE EXCEPTION 'Writer nao devolveu a linha interna esperada'; END IF;
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id'
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name')
        || jsonb_build_object(
          'source_mode', 'internal',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
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
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
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
    'ensured', v_ensure_lines,
    'base_group_id', v_ensure -> 'base_group_id',
    'base_product_id', v_ensure -> 'base_product_id',
    'color_id', v_color_id,
    'color_name', v_color_name,
    'correlation_id', v_ensure -> 'correlation_id'
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.tg_validate_sale_order_item_strap_color_alignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_sheet_lines jsonb;
  v_sheet_ids uuid[] := ARRAY[]::uuid[];
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_expected_color_id uuid;
  v_material_context jsonb;
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
  -- independent_strap_colors_20270101015400
  v_color_mode text;
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
    -- upper_and_straps_coexist_20270101014675
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


  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    SELECT entry.value INTO v_sheet_line
      FROM jsonb_array_elements(v_sheet_lines) entry(value)
     WHERE entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF nullif(v_sheet_line ->> 'color_mode', '') IS NOT NULL
       AND v_sheet_line ->> 'color_mode' NOT IN ('follow_main', 'select_on_order') THEN
      RAISE EXCEPTION 'Linha tecnica possui politica de cor invalida';
    END IF;
    v_color_mode := CASE
      WHEN v_basis = 'finished_product_group' THEN 'select_on_order'
      ELSE coalesce(nullif(v_sheet_line ->> 'color_mode', ''), 'follow_main')
    END;
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
    v_material_context := private.resolve_technical_strap_material(
      NEW.reference_id, NEW.material_variant_id, v_line_id,
      nullif(v_line ->> 'base_group_id', '')::uuid, true
    );
    v_base_group_id := (v_material_context ->> 'base_group_id')::uuid;
    v_pinned_base_product_id := (v_material_context ->> 'pinned_base_product_id')::uuid;
    IF coalesce(v_line ->> 'material_mode', 'follow_reference')
           IS DISTINCT FROM v_material_context ->> 'material_mode'
       OR coalesce(v_line -> 'material_group_id', 'null'::jsonb)
           IS DISTINCT FROM v_material_context -> 'material_group_id'
       OR coalesce(v_line -> 'allowed_material_group_ids', '[]'::jsonb)
           IS DISTINCT FROM v_material_context -> 'allowed_material_group_ids'
       OR (v_line ? 'base_group_id' AND nullif(v_line ->> 'base_group_id', '')::uuid
           IS DISTINCT FROM v_base_group_id)
       OR (v_source ? 'base_group_id' AND nullif(v_source ->> 'base_group_id', '')::uuid
           IS DISTINCT FROM v_base_group_id) THEN
      RAISE EXCEPTION 'Material da posicao no item diverge da ficha tecnica vigente' USING ERRCODE = '23514';
    END IF;
    IF v_basis NOT IN ('reference_base', 'finished_product_group')
       OR v_measure_id IS NULL OR v_strap_type_id IS NULL
       OR v_item_measure_id IS DISTINCT FROM v_measure_id
       OR v_item_strap_type_id IS DISTINCT FROM v_strap_type_id
       OR nullif(v_line ->> 'identity_basis', '') IS DISTINCT FROM v_basis
       OR coalesce(
            nullif(v_line ->> 'color_mode', ''),
            CASE WHEN v_basis = 'finished_product_group'
              THEN 'select_on_order' ELSE 'follow_main' END
          ) IS DISTINCT FROM v_color_mode
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
      IF (v_color_mode = 'follow_main' AND (
            v_expected_color_id IS NULL
            OR v_line_color_id IS DISTINCT FROM v_expected_color_id
          ))
         OR (v_color_mode = 'select_on_order' AND v_line_color_id IS NULL)
         OR v_source_mode IS DISTINCT FROM 'internal'
         OR v_source_recipe_id IS NULL
         OR v_source_base_product_id IS NULL
         OR v_base_group_id IS NULL THEN
        RAISE EXCEPTION 'Tira interna deve usar a cor exigida pela ficha, origem internal e napa exata';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants av
          JOIN public.products finished ON finished.id = av.finished_product_id
         WHERE av.id = v_source_variant_id
           AND av.measure_id = v_measure_id
           AND av.base_group_id = v_base_group_id
           AND av.color_id = v_line_color_id
           AND av.identity_basis = 'reference_base'
           AND av.status = 'active'
           AND av.internal_production_enabled
           AND finished.active
           AND finished.unit = 'm'
           AND public.resolve_strap_canonical_color_id(finished.color)
               = v_line_color_id
      ) THEN
        RAISE EXCEPTION 'Variante interna nao corresponde a medida/napa/cor da linha';
      END IF;
      IF NOT EXISTS (
        SELECT 1
          FROM public.base_material_color_official_products op
          JOIN public.products base ON base.id = op.official_product_id
         WHERE op.base_group_id = v_base_group_id
           AND op.color_id = v_line_color_id
           AND op.status = 'active'
           AND op.official_product_id = v_source_base_product_id
           AND (v_color_mode <> 'follow_main'
             OR v_pinned_base_product_id IS NULL
             OR op.official_product_id = v_pinned_base_product_id)
           AND base.active
           AND base.group_id = v_base_group_id
           AND base.unit = 'm'
           AND public.resolve_strap_canonical_color_id(base.color)
               = v_line_color_id
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
$function$;


CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft_pre_05500(p_item jsonb)
 RETURNS TABLE(line_ordinal integer, technical_strap_line_id uuid, strap_variant_id uuid, source_mode text, gross_required_m numeric, recipe_id uuid, base_product_id uuid, finished_product_id uuid, blocking_reasons jsonb, resolved jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line jsonb;
  v_sheet_line jsonb;
  v_sheet_line_count integer;
  v_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_selection jsonb;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_measure_id uuid;
  v_material_context jsonb;
  v_base_group_id uuid;
  v_identity_group_id uuid;
  v_identity_basis text;
  v_item_identity_basis text;
  v_item_identity_group_id uuid;
  v_color_id uuid;
  v_selected_variant_id uuid;
  v_catalog jsonb;
  v_reasons jsonb;
  v_line_id uuid;
  v_source text;
  v_gross numeric;
  v_main_start date;
  v_schedule_revision integer := 0;
  v_schedule_source text;
  v_billing_week text;
  v_year integer;
  v_month integer;
  v_week integer;
  v_first date;
  v_can_financial boolean := public.can_see_strap_financial_values();
  v_idx integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'p_item deve ser objeto JSON';
  END IF;
  IF jsonb_typeof(coalesce(p_item -> 'strap_colors', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array';
  END IF;

  BEGIN v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_reference_id := NULL; END;
  BEGIN v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_material_variant_id := NULL; END;
  BEGIN v_sale_order_id := nullif(p_item ->> 'sale_order_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_id := NULL; END;
  BEGIN v_sale_order_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_item_id := NULL; END;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(coalesce(p_item -> 'strap_colors', '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_reasons := '[]'::jsonb;
    v_catalog := '{}'::jsonb;
    v_sheet_line := NULL;
    v_sheet_line_count := 0;
    v_line_id := NULL;
    v_measure_id := NULL;
    v_base_group_id := NULL;
    v_material_context := '{}'::jsonb;
    v_identity_group_id := NULL;
    v_identity_basis := 'reference_base';
    v_item_identity_basis := NULL;
    v_item_identity_group_id := NULL;
    v_color_id := NULL;
    v_selected_variant_id := NULL;
    strap_variant_id := NULL;
    recipe_id := NULL;
    base_product_id := NULL;
    finished_product_id := NULL;

    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_line_missing', 'field', 'technical_strap_line_id',
        'message', 'Linha de tira sem UUID tecnico estavel; corrija a ficha tecnica.'));
    END IF;

    IF v_reference_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_reference_id
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'reference_unresolved', 'field', 'reference_id',
        'message', 'Referencia sem UUID persistido ou inexistente.'));
    ELSIF v_line_id IS NOT NULL THEN
      SELECT count(*), (jsonb_agg(e.value ORDER BY e.ordinality) -> 0)
        INTO v_sheet_line_count, v_sheet_line
        FROM public.technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
            THEN ts.strap_colors ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS e(value, ordinality)
       WHERE ts.id = v_reference_id
         AND e.value ->> 'technical_strap_line_id' = v_line_id::text;
      IF v_sheet_line_count <> 1 THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_line_identity_invalid', 'field', 'technical_strap_line_id',
          'message', 'UUID da linha deve existir uma unica vez na ficha tecnica vigente.'));
      END IF;
    END IF;

    v_identity_basis := coalesce(
      nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF v_identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'identity_basis_invalid', 'field', 'identity_basis',
        'message', 'Linha tecnica possui base de identidade invalida.'));
    END IF;
    IF v_identity_basis = 'finished_product_group' THEN
      BEGIN
        v_identity_group_id := nullif(v_sheet_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_identity_group_id := NULL; END;
      IF v_identity_group_id IS NULL THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'identity_group_missing', 'field', 'identity_group_id',
          'message', 'Tira comprada pronta exige grupo proprio do componente acabado.'));
      END IF;
    END IF;

    -- Campos presentes no item sao snapshot, nunca autoridade. Ausencia legada
    -- e aceita; divergencia explicita e bloqueada para nao trocar a identidade.
    v_item_identity_basis := nullif(v_line ->> 'identity_basis', '');
    IF v_item_identity_basis IS NOT NULL
       AND v_item_identity_basis IS DISTINCT FROM v_identity_basis THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_identity_snapshot_stale', 'field', 'identity_basis',
        'message', 'Identidade congelada no item diverge da linha tecnica vigente.'));
    END IF;
    IF v_line ? 'identity_group_id' THEN
      BEGIN v_item_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_item_identity_group_id := NULL; END;
      IF v_item_identity_group_id IS DISTINCT FROM v_identity_group_id THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_identity_snapshot_stale', 'field', 'identity_group_id',
          'message', 'Grupo congelado no item diverge da linha tecnica vigente.'));
      END IF;
    END IF;

    BEGIN
      v_measure_id := nullif(coalesce(
        v_sheet_line ->> 'measure_id', v_line ->> 'measure_id'
      ), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_measure_id := NULL; END;
    IF v_measure_id IS NULL AND v_line_id IS NOT NULL THEN
      SELECT m.measure_id INTO v_measure_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id AND m.status = 'resolved';
    END IF;
    IF v_measure_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'measure_missing', 'field', 'measure_id',
        'message', 'Linha tecnica sem medida canonica resolvida.'));
    END IF;

    IF v_line_id IS NOT NULL THEN
      v_selection := v_sourcing -> v_line_id::text;
    ELSE
      v_selection := NULL;
    END IF;
    BEGIN v_selected_variant_id := nullif(v_selection ->> 'strap_variant_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_selected_variant_id := NULL; END;
    v_source := v_selection ->> 'source_mode';
    IF v_identity_basis = 'finished_product_group' THEN
      IF v_source = 'internal' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'internal_production_disabled', 'field', 'source_mode',
          'message', 'Esta tira e comprada pronta e nao pode ser produzida internamente.'));
      ELSIF v_source IS NOT NULL AND v_source <> 'buy_ready' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'source_mode_invalid', 'field', 'source_mode',
          'message', 'Tira comprada pronta aceita somente Comprar pronta.'));
      END IF;
      -- A origem e propriedade do catalogo, nao uma escolha livre do item.
      v_source := 'buy_ready';
    ELSIF v_source NOT IN ('internal', 'buy_ready') THEN
      v_source := NULL;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'source_mode_required', 'field', 'source_mode',
        'message', 'Escolha Produzir com napa propria ou Comprar tira pronta.'));
    END IF;

    v_main_start := NULL;
    v_schedule_source := NULL;
    BEGIN
      v_main_start := nullif(coalesce(
        v_selection ->> 'main_production_start', p_item ->> 'main_production_start'
      ), '')::date;
    EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    BEGIN
      v_schedule_revision := coalesce(
        nullif(v_selection ->> 'schedule_revision', '')::integer,
        nullif(p_item ->> 'schedule_revision', '')::integer,
        0
      );
    EXCEPTION WHEN OTHERS THEN v_schedule_revision := 0; END;
    IF v_main_start IS NULL AND v_sale_order_id IS NOT NULL THEN
      SELECT s.main_production_start, s.schedule_revision, s.resolution_source
        INTO v_main_start, v_schedule_revision, v_schedule_source
        FROM public.resolve_sale_order_main_production_start(
          v_sale_order_id, v_sale_order_item_id
        ) s;
    END IF;
    IF v_main_start IS NULL THEN
      BEGIN
        v_main_start := nullif(coalesce(
          p_item ->> 'billing_anchor', p_item ->> 'required_at'
        ), '')::date;
        v_schedule_source := 'draft_billing_anchor';
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_billing_week := nullif(p_item ->> 'billing_week', '');
      BEGIN
        IF v_billing_week ~ '^\d{4}-W\d{1,2}$' THEN
          v_main_start := date_trunc(
            'week', public.parse_iso_billing_week(v_billing_week))::date;
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
          v_year := split_part(v_billing_week, '-', 1)::integer;
          v_month := split_part(v_billing_week, '-', 2)::integer;
          v_week := substring(split_part(v_billing_week, '-', 3) FROM 2)::integer;
          v_first := make_date(v_year, v_month, 1);
          v_main_start := greatest(
            v_first,
            v_first - (extract(isodow FROM v_first)::integer - 1) + ((v_week - 1) * 7)
          );
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-\d{2}$' THEN
          v_main_start := date_trunc('week', v_billing_week::date)::date;
        END IF;
        IF v_main_start IS NOT NULL THEN
          v_schedule_source := 'draft_billing_week_first_day';
        END IF;
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'main_production_start_missing', 'field', 'main_production_start',
        'message', 'Cronograma global ainda nao definiu o inicio produtivo deste item.'));
    END IF;

    IF v_material_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reference_material_variants rmv
       WHERE rmv.id = v_material_variant_id
         AND rmv.reference_id = v_reference_id
         AND coalesce(rmv.active, true)
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'material_variant_mismatch', 'field', 'material_variant_id',
        'message', 'Variante de material nao pertence a referencia ou esta inativa.'));
    END IF;
    BEGIN
      v_material_context := private.resolve_technical_strap_material(
        v_reference_id, v_material_variant_id, v_line_id,
        nullif(v_line ->> 'base_group_id', '')::uuid, false
      );
      v_base_group_id := (v_material_context ->> 'base_group_id')::uuid;
      IF v_material_context ->> 'material_mode' = 'select_on_order'
         AND v_base_group_id IS NULL THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'material_selection_required', 'field', 'base_group_id',
          'message', 'Selecione o material desta posicao no Pedido de Venda.'));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_base_group_id := NULL;
      v_material_context := '{}'::jsonb;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'material_selection_invalid', 'field', 'base_group_id',
        'message', SQLERRM));
    END;
    IF v_base_group_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'base_group_unresolved', 'field', CASE
          WHEN v_identity_basis = 'finished_product_group'
            THEN 'identity_group_id' ELSE 'material_variant_id' END,
        'message', 'A identidade da tira nao possui grupo canonico resolvido por UUID.'));
    END IF;

    BEGIN v_color_id := nullif(v_line ->> 'color_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    IF v_color_id IS NULL THEN
      BEGIN v_color_id := nullif(v_selection ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    END IF;
    IF v_color_id IS NULL AND v_selected_variant_id IS NOT NULL THEN
      SELECT v.color_id INTO v_color_id
        FROM public.artisanal_strap_variants v
       WHERE v.id = v_selected_variant_id;
    END IF;
    IF v_color_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id
    ) THEN
      v_color_id := NULL;
    END IF;
    IF v_color_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'color_id_missing', 'field', 'color_id',
        'message', 'Cor sem UUID canonico persistido; texto/alias nao identifica estoque.'));
    END IF;

    v_gross := public.calculate_strap_line_required_m(
      v_line,
      coalesce(nullif(p_item ->> 'quantity', '')::numeric, 0),
      coalesce(p_item -> 'grade', '{}'::jsonb)
    );
    IF (
      jsonb_typeof(coalesce(p_item -> 'grade', '{}'::jsonb)) = 'object'
      AND EXISTS (
        SELECT 1
          FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
           AND public.pick_consumption_for_size(
             v_line -> 'consumption_per_size',
             g.key
           ) IS NULL
           AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
      )
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
      )
      AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'consumption_missing', 'field', 'consumption_per_size',
        'message', 'Consumo da tira ausente ou zero para uma numeracao demandada.'));
    END IF;
    IF v_gross <= 0 THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'gross_required_invalid', 'field', 'quantity',
        'message', 'Consumo bruto calculado deve ser maior que zero.'));
    END IF;

    IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
      BEGIN
        v_catalog := public.resolve_artisanal_strap_catalog(
          v_measure_id, v_base_group_id, v_color_id, v_source, v_identity_basis
        );
        strap_variant_id := (v_catalog ->> 'variant_id')::uuid;
        recipe_id := nullif(v_catalog ->> 'recipe_id', '')::uuid;
        base_product_id := nullif(v_catalog ->> 'base_product_id', '')::uuid;
        finished_product_id := (v_catalog ->> 'finished_product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'catalog_resolution_blocked', 'field', 'strap_variant_id',
          'message', SQLERRM));
      END;
    END IF;

    IF v_identity_basis = 'reference_base'
       AND v_source IS NOT NULL AND v_selected_variant_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_identity_not_persisted', 'field', 'strap_variant_id',
        'message', 'A escolha de origem deve persistir o UUID exato da variante resolvida.'));
    ELSIF v_selected_variant_id IS NOT NULL
       AND v_selected_variant_id IS DISTINCT FROM strap_variant_id THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_snapshot_stale', 'field', 'strap_variant_id',
        'message', 'Variante escolhida nao corresponde mais a identidade tecnica atual.'));
    END IF;

    line_ordinal := v_idx;
    technical_strap_line_id := v_line_id;
    source_mode := v_source;
    gross_required_m := v_gross;
    blocking_reasons := v_reasons;
    resolved := jsonb_build_object(
      'base_group_id', v_base_group_id,
      'base_group_name', v_material_context -> 'base_group_name',
      'material_mode', v_material_context -> 'material_mode',
      'material_group_id', v_material_context -> 'material_group_id',
      'allowed_material_group_ids', v_material_context -> 'allowed_material_group_ids',
      'identity_basis', v_identity_basis,
      'identity_group_id', CASE WHEN v_identity_basis = 'finished_product_group'
        THEN v_identity_group_id ELSE NULL END,
      'internal_production_enabled', CASE
        WHEN v_identity_basis = 'finished_product_group' THEN false
        ELSE coalesce((v_catalog ->> 'internal_production_enabled')::boolean, true)
      END,
      'color_id', v_color_id,
      'strap_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = finished_product_id),
      'strap_color_name', (
        SELECT c.name FROM public.canonical_colors c WHERE c.id = v_color_id),
      'base_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = base_product_id),
      'measure_name', (
        SELECT m.display_name FROM public.artisanal_strap_measures m WHERE m.id = v_measure_id),
      'cut_band_width_mm', (
        SELECT r.cut_band_width_mm FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'usable_base_width_mm_snapshot', (
        SELECT r.usable_base_width_mm_snapshot
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'theoretical_yield_m_per_m', (
        SELECT r.theoretical_yield_m_per_m
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'confirmed_yield_m_per_m', v_catalog -> 'confirmed_yield_m_per_m',
      'base_required_m', CASE WHEN v_source = 'internal'
        THEN v_gross / nullif((v_catalog ->> 'confirmed_yield_m_per_m')::numeric, 0)
        ELSE 0 END,
      'purchase_price', CASE WHEN v_can_financial
        THEN v_catalog -> 'purchase_price' ELSE 'null'::jsonb END,
      'purchase_conversion_rate', CASE WHEN v_can_financial THEN
        to_jsonb((SELECT p.conversion_rate FROM public.products p WHERE p.id = finished_product_id))
        ELSE 'null'::jsonb END,
      'purchase_unit_cost_stock', CASE WHEN v_can_financial THEN to_jsonb((
        SELECT p.purchase_price / nullif(p.conversion_rate, 0)
          FROM public.products p WHERE p.id = finished_product_id
      )) ELSE 'null'::jsonb END,
      'internal_unit_cost', CASE WHEN v_can_financial
        THEN v_catalog -> 'internal_unit_cost' ELSE 'null'::jsonb END,
      'can_internal', coalesce((v_catalog ->> 'internal_available')::boolean, false),
      'can_buy_ready', coalesce((v_catalog ->> 'buy_ready_available')::boolean, false),
      'source_mode', v_source,
      'required_at', coalesce(v_selection ->> 'required_at', p_item ->> 'required_at'),
      'main_production_start', v_main_start,
      'schedule_revision', v_schedule_revision,
      'schedule_source', coalesce(v_schedule_source, 'draft_supplied'),
      'catalog', v_catalog
    );
    RETURN NEXT;
  END LOOP;
END;
$function$;


CREATE OR REPLACE FUNCTION private.preview_sale_order_strap_demand_draft_pre_20270101015500(p_item jsonb)
 RETURNS TABLE(line_ordinal integer, technical_strap_line_id uuid, strap_variant_id uuid, source_mode text, gross_required_m numeric, recipe_id uuid, base_product_id uuid, finished_product_id uuid, blocking_reasons jsonb, resolved jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- independent_strap_colors_20270101015400
  v_line_color_mode text;
  v_sheet_line jsonb;
  v_line_color_id uuid;
  v_main_color_id uuid;
  v_material_context jsonb;
  v_pinned_base_product_id uuid;
  v_is_persisted boolean := false;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_frozen_resolved jsonb;
  v_frozen_catalog jsonb;
BEGIN
  -- O wrapper tambem fecha explicitamente a fronteira SECURITY DEFINER. O
  -- preview-base possui a mesma defesa, mas ela nao deve ser a unica barreira
  -- caso a implementacao delegada seja substituida no futuro.
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

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

    -- Rascunhos com UUID tambem passam pela politica autoritativa abaixo.
    -- Somente uma linha estruturalmente sem UUID conserva o resultado diagnostico
    -- do motor-base, que ja a marca como bloqueada.
    IF v_line_id IS NULL THEN
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
         'material_selection_required',
         'material_selection_invalid',
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
      v_pinned_base_product_id := NULL;
      BEGIN
        v_material_context := private.resolve_technical_strap_material(
          v_reference_id, v_material_variant_id, v_line_id,
          public.try_parse_uuid(v_preview.resolved ->> 'base_group_id'), false
        );
        v_pinned_base_product_id := public.try_parse_uuid(v_material_context ->> 'pinned_base_product_id');
      EXCEPTION WHEN OTHERS THEN
        -- O motor-base ja devolve material_selection_invalid. Nunca complete
        -- o pin de uma posicao invalida com o material principal.
        v_pinned_base_product_id := NULL;
      END;
      IF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL
         OR (v_line_color_mode = 'follow_main' AND (
           v_main_color_id IS NULL
           OR v_line_color_id IS DISTINCT FROM v_main_color_id
         ))
         OR (v_line_color_mode = 'select_on_order'
           AND v_line_color_id IS NULL) THEN
        blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'reference_base_intent_mismatch',
            'field', 'strap_sourcing',
            'message', 'A tira interna deve usar a cor exigida pela ficha e producao interna.'
          ));
      END IF;
      IF v_line_color_mode = 'follow_main'
         AND v_pinned_base_product_id IS NOT NULL
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
$function$;


CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(p_item jsonb)
 RETURNS TABLE(line_ordinal integer, technical_strap_line_id uuid, strap_variant_id uuid, source_mode text, gross_required_m numeric, recipe_id uuid, base_product_id uuid, finished_product_id uuid, blocking_reasons jsonb, resolved jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- committed_strap_preview_rehydration_20270101015500
  v_item_payload jsonb := p_item;
  v_item_id uuid;
  v_supplied_sale_order_id uuid;
  v_scope_key uuid;
  v_scope_type text;
  v_item public.sale_order_items%ROWTYPE;
  v_sale_order public.sale_orders%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_effective_grade jsonb;
  v_main_production_start date;
  v_schedule_revision integer;
  v_preview record;
  v_identity jsonb;
  v_reasons jsonb;
  v_resolved jsonb;
  v_snapshot_resolved jsonb;
  v_stored_line jsonb;
  v_stored_line_count integer;
  v_catalog jsonb;
  v_snapshot_source text;
  v_snapshot_complete boolean;
  v_frozen_source text;
  v_frozen_variant_id uuid;
  v_frozen_recipe_id uuid;
  v_frozen_base_product_id uuid;
  v_frozen_finished_product_id uuid;
  v_frozen_yield numeric;
  v_key text;
  v_raw text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_item deve ser objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  -- Nao deixe um UUID malformado virar NULL e trocar silenciosamente o ramo
  -- historico pelo prospectivo.
  FOREACH v_key IN ARRAY ARRAY[
    'sale_order_item_id', 'sale_order_id', 'reference_id',
    'material_variant_id', 'scope_key'
  ]
  LOOP
    v_raw := NULLIF(pg_catalog.btrim(p_item ->> v_key), '');
    IF v_raw IS NOT NULL AND public.try_parse_uuid(v_raw) IS NULL THEN
      RAISE EXCEPTION '% deve ser UUID valido', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_item_id := public.try_parse_uuid(p_item ->> 'sale_order_item_id');
  IF v_item_id IS NULL THEN
    RETURN QUERY
      SELECT previous.*
        FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
               p_item
             ) previous
       ORDER BY previous.line_ordinal;
    RETURN;
  END IF;

  SELECT item.*
    INTO v_item
    FROM public.sale_order_items item
   WHERE item.id = v_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de PV % inexistente', v_item_id
      USING ERRCODE = 'P0002';
  END IF;

  v_supplied_sale_order_id := public.try_parse_uuid(
    p_item ->> 'sale_order_id'
  );
  IF v_supplied_sale_order_id IS NOT NULL
     AND v_supplied_sale_order_id IS DISTINCT FROM v_item.sale_order_id THEN
    RAISE EXCEPTION 'Item % nao pertence ao PV informado', v_item_id
      USING ERRCODE = '23514';
  END IF;

  SELECT sale_order.*
    INTO v_sale_order
    FROM public.sale_orders sale_order
   WHERE sale_order.id = v_item.sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV do item % inexistente', v_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Rascunho/Pendente continua prospectivo: o usuario pode estar visualizando
  -- mudancas ainda nao salvas. A partir da aprovacao, apenas o banco decide.
  IF NOT private.is_committed_sale_order_status(v_sale_order.status) THEN
    RETURN QUERY
      SELECT previous.*
        FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
               p_item
             ) previous
       ORDER BY previous.line_ordinal;
    RETURN;
  END IF;

  -- Agenda tambem e fato server-side. O helper legado aceita datas de draft
  -- no JSON; num PV comprometido elas jamais podem vencer o cronograma vivo ou
  -- o valor congelado dentro de strap_sourcing.
  SELECT schedule.main_production_start, schedule.schedule_revision
    INTO v_main_production_start, v_schedule_revision
    FROM public.resolve_sale_order_main_production_start(
      v_item.sale_order_id, v_item.id
    ) schedule
   LIMIT 1;

  v_scope_type := COALESCE(
    NULLIF(pg_catalog.btrim(p_item ->> 'scope_type'), ''),
    'sale_order_item'
  );
  IF v_scope_type NOT IN ('sale_order_item', 'production_order') THEN
    RAISE EXCEPTION 'scope_type invalido: %', v_scope_type
      USING ERRCODE = '22023';
  END IF;

  IF v_scope_type = 'production_order' THEN
    v_scope_key := public.try_parse_uuid(p_item ->> 'scope_key');
    IF v_scope_key IS NULL THEN
      RAISE EXCEPTION 'scope_key da OP e obrigatorio'
        USING ERRCODE = '22023';
    END IF;
    SELECT production_order.*
      INTO v_order
      FROM public.orders production_order
     WHERE production_order.id = v_scope_key
       AND production_order.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OP % inexistente ou excluida', v_scope_key
        USING ERRCODE = 'P0002';
    END IF;
    IF v_order.sale_order_item_id IS DISTINCT FROM v_item.id
       OR v_order.sale_order_id IS DISTINCT FROM v_item.sale_order_id
       OR v_order.reference_id IS DISTINCT FROM v_item.reference_id THEN
      RAISE EXCEPTION 'Vinculo OP/PV/item divergente no preview %', v_scope_key
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_order.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'OP % possui quantidade invalida', v_scope_key
        USING ERRCODE = '22023';
    END IF;
    v_effective_grade := public.resolve_effective_op_grade(
      v_order.grade, v_order.quantity
    );
    v_item_payload := p_item || pg_catalog.jsonb_build_object(
      'sale_order_id', v_item.sale_order_id,
      'sale_order_item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'material_variant_id', v_item.material_variant_id,
      -- A cor fisica das tiras pertence ao snapshot do item; a OP nao pode
      -- transformar esse fato ao ser dividida em lote parcial.
      'color', v_item.color,
      'quantity', v_order.quantity,
      'grade', COALESCE(v_effective_grade, '{}'::jsonb),
      'strap_colors', COALESCE(v_item.strap_colors, '[]'::jsonb),
      'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb),
      'strap_sourcing_revision', v_item.strap_sourcing_revision,
      'main_production_start', v_main_production_start,
      'schedule_revision', COALESCE(v_schedule_revision, 0),
      'required_at', NULL,
      'billing_anchor', NULL,
      'billing_week', NULL,
      'scope_type', 'production_order',
      'scope_key', v_order.id
    );
  ELSE
    v_scope_key := public.try_parse_uuid(p_item ->> 'scope_key');
    IF v_scope_key IS NOT NULL AND v_scope_key IS DISTINCT FROM v_item.id THEN
      RAISE EXCEPTION 'scope_key nao corresponde ao item %', v_item.id
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_item.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'Item % possui quantidade invalida', v_item.id
        USING ERRCODE = '22023';
    END IF;
    v_item_payload := p_item || pg_catalog.jsonb_build_object(
      'sale_order_id', v_item.sale_order_id,
      'sale_order_item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'material_variant_id', v_item.material_variant_id,
      'color', v_item.color,
      'quantity', v_item.quantity,
      'grade', COALESCE(v_item.grade, '{}'::jsonb),
      'strap_colors', COALESCE(v_item.strap_colors, '[]'::jsonb),
      'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb),
      'strap_sourcing_revision', v_item.strap_sourcing_revision,
      'main_production_start', v_main_production_start,
      'schedule_revision', COALESCE(v_schedule_revision, 0),
      'required_at', NULL,
      'billing_anchor', NULL,
      'billing_week', NULL,
      'scope_type', 'sale_order_item',
      'scope_key', v_item.id
    );
  END IF;

  FOR v_preview IN
    SELECT previous.*
      FROM private.preview_sale_order_strap_demand_draft_pre_20270101015500(
             v_item_payload
           ) previous
     ORDER BY previous.line_ordinal
  LOOP
    SELECT pg_catalog.count(*)::integer,
           (pg_catalog.jsonb_agg(line.value ORDER BY line.ordinality) -> 0)
      INTO v_stored_line_count, v_stored_line
      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(v_item.strap_colors) = 'array'
            THEN v_item.strap_colors
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY line(value, ordinality)
     WHERE public.try_parse_uuid(
             line.value ->> 'technical_strap_line_id'
           ) IS NOT DISTINCT FROM v_preview.technical_strap_line_id;

    v_identity := private.resolve_committed_strap_identity(
      v_item.id,
      v_preview.technical_strap_line_id,
      COALESCE(v_item.strap_sourcing, '{}'::jsonb)
    );

    IF COALESCE((v_identity ->> 'valid')::boolean, false) THEN
      v_frozen_source := v_identity ->> 'source_mode';
      v_frozen_variant_id := public.try_parse_uuid(
        v_identity ->> 'strap_variant_id'
      );
      v_frozen_recipe_id := public.try_parse_uuid(v_identity ->> 'recipe_id');
      v_frozen_base_product_id := public.try_parse_uuid(
        v_identity ->> 'base_product_id'
      );
      v_frozen_finished_product_id := public.try_parse_uuid(
        v_identity ->> 'finished_product_id'
      );
      v_snapshot_source := v_identity ->> 'snapshot_source';
      v_snapshot_complete := COALESCE(
        (v_identity ->> 'physical_snapshot_complete')::boolean, false
      );
      BEGIN
        v_frozen_yield := NULLIF(
          v_identity ->> 'confirmed_yield_m_per_m', ''
        )::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_frozen_yield := NULL;
      END;

      -- O helper anterior precisa executar para calcular o consumo congelado,
      -- mas bloqueios produzidos apenas pela ficha/catalogo vigentes nao podem
      -- reinterpretar uma identidade persistida valida.
      SELECT COALESCE(pg_catalog.jsonb_agg(
               reason.value ORDER BY reason.ordinality
             ), '[]'::jsonb)
        INTO v_reasons
        FROM pg_catalog.jsonb_array_elements(
          COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        ) WITH ORDINALITY reason(value, ordinality)
       WHERE COALESCE(reason.value ->> 'code', '') NOT IN (
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
         'variant_snapshot_stale',
         'reference_base_intent_mismatch',
         'pinned_base_product_mismatch',
         'finished_group_intent_mismatch',
         'frozen_source_snapshot_stale',
         'material_selection_required',
         'material_selection_invalid'
       );

      v_snapshot_resolved := CASE
        WHEN pg_catalog.jsonb_typeof(
          v_identity -> 'resolved_snapshot'
        ) = 'object' THEN v_identity -> 'resolved_snapshot'
        ELSE '{}'::jsonb
      END;
      v_catalog := CASE
        WHEN v_snapshot_complete
         AND pg_catalog.jsonb_typeof(
               v_snapshot_resolved -> 'catalog'
             ) = 'object'
          THEN v_snapshot_resolved -> 'catalog'
        ELSE '{}'::jsonb
      END || pg_catalog.jsonb_build_object(
        'variant_id', v_frozen_variant_id,
        'recipe_id', v_frozen_recipe_id,
        'recipe_version', CASE
          WHEN v_snapshot_complete THEN v_identity -> 'recipe_version'
          ELSE 'null'::jsonb
        END,
        'base_product_id', v_frozen_base_product_id,
        'finished_product_id', v_frozen_finished_product_id,
        'confirmed_yield_m_per_m', CASE
          WHEN v_snapshot_complete THEN pg_catalog.to_jsonb(v_frozen_yield)
          ELSE 'null'::jsonb
        END,
        'source_mode', v_frozen_source
      );

      IF v_snapshot_complete THEN
        -- Nunca complete um snapshot de demanda com metadado da ficha atual.
        v_resolved := v_snapshot_resolved;
      ELSE
        -- Antes da primeira demanda, reconstrua apenas da linha efetivamente
        -- salva no item + IDs de sourcing. O resolved do helper-base aponta
        -- para a ficha/catalogo atual e por isso e deliberadamente descartado.
        IF v_stored_line_count <> 1
           OR pg_catalog.jsonb_typeof(v_stored_line) IS DISTINCT FROM 'object' THEN
          v_reasons := v_reasons
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'code', 'committed_technical_snapshot_invalid',
              'field', 'strap_colors',
              'message', 'UUID da tira nao ocorre exatamente uma vez no item comprometido.'
            ));
          v_stored_line := '{}'::jsonb;
        END IF;
        v_resolved := pg_catalog.jsonb_build_object(
          'base_group_id', public.try_parse_uuid(
            COALESCE(
              v_identity ->> 'base_group_id',
              COALESCE(v_item.strap_sourcing, '{}'::jsonb)
                -> v_preview.technical_strap_line_id::text
                ->> 'base_group_id'
            )
          ),
          'base_group_name', v_stored_line -> 'base_group_name',
          'material_mode', v_stored_line -> 'material_mode',
          'material_group_id', v_stored_line -> 'material_group_id',
          'allowed_material_group_ids', v_stored_line -> 'allowed_material_group_ids',
          'identity_basis', COALESCE(NULLIF(
            v_stored_line ->> 'identity_basis', ''
          ), 'reference_base'),
          'identity_group_id', public.try_parse_uuid(
            v_stored_line ->> 'identity_group_id'
          ),
          'measure_id', public.try_parse_uuid(
            v_stored_line ->> 'measure_id'
          ),
          'strap_type_id', public.try_parse_uuid(
            v_stored_line ->> 'strap_type_id'
          ),
          'group_id', public.try_parse_uuid(v_stored_line ->> 'group_id'),
          'group_name', NULLIF(pg_catalog.btrim(
            v_stored_line ->> 'group_name'
          ), ''),
          'label', NULLIF(pg_catalog.btrim(v_stored_line ->> 'label'), ''),
          'color_id', public.try_parse_uuid(COALESCE(
            COALESCE(v_item.strap_sourcing, '{}'::jsonb)
              -> v_preview.technical_strap_line_id::text ->> 'color_id',
            v_stored_line ->> 'color_id'
          )),
          'color', NULLIF(pg_catalog.btrim(v_stored_line ->> 'color'), ''),
          'internal_production_enabled', CASE
            WHEN COALESCE(NULLIF(
                   v_stored_line ->> 'identity_basis', ''
                 ), 'reference_base') = 'finished_product_group' THEN false
            WHEN pg_catalog.jsonb_typeof(
                   v_stored_line -> 'internal_production_enabled'
                 ) = 'boolean' THEN
              (v_stored_line ->> 'internal_production_enabled')::boolean
            ELSE NULL
          END,
          'main_production_start', v_main_production_start,
          'schedule_revision', COALESCE(v_schedule_revision, 0)
        );
      END IF;

      v_resolved := COALESCE(v_resolved, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'catalog', v_catalog,
          'source_mode', v_frozen_source,
          'confirmed_yield_m_per_m', CASE
            WHEN v_snapshot_complete THEN pg_catalog.to_jsonb(v_frozen_yield)
            ELSE 'null'::jsonb
          END,
          'base_required_m', CASE
            WHEN v_snapshot_complete AND v_frozen_source = 'internal' THEN
              v_preview.gross_required_m / NULLIF(v_frozen_yield, 0)
            WHEN v_snapshot_complete THEN 0
            ELSE NULL
          END,
          'identity_snapshot_source', v_snapshot_source,
          'physical_snapshot_complete', v_snapshot_complete
        )
        || CASE
          WHEN v_snapshot_complete THEN '{}'::jsonb
          ELSE pg_catalog.jsonb_build_object(
            'snapshot_warning', v_identity ->> 'snapshot_warning'
          )
        END;

      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_frozen_variant_id,
        v_frozen_source,
        v_preview.gross_required_m::numeric,
        v_frozen_recipe_id,
        v_frozen_base_product_id,
        v_frozen_finished_product_id,
        v_reasons,
        v_resolved;
    ELSE
      v_reasons := COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'committed_identity_snapshot_missing',
          'field', 'strap_sourcing',
          'message', COALESCE(
            v_identity ->> 'reason',
            'Identidade comprometida da tira nao pode ser reidratada.'
          )
        ));
      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_preview.strap_variant_id::uuid,
        v_preview.source_mode::text,
        v_preview.gross_required_m::numeric,
        v_preview.recipe_id::uuid,
        v_preview.base_product_id::uuid,
        v_preview.finished_product_id::uuid,
        v_reasons,
        v_preview.resolved::jsonb;
    END IF;
  END LOOP;
END;
$function$;



-- Opcoes sao somente identidades e cores gravaveis; nunca saldo, preco ou origem
-- financeira. A mesma regra abastece manifesto offline e diagnostico.
CREATE OR REPLACE FUNCTION private.technical_strap_material_options(
  p_reference_id uuid, p_material_variant_id uuid, p_line_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_line jsonb;
  v_policy jsonb;
  v_context jsonb;
  v_ids jsonb;
  v_id uuid;
  v_name text;
  v_colors jsonb;
  v_pin uuid;
  v_result jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  SELECT count(*)::integer, jsonb_agg(line.value) -> 0 INTO v_count, v_line
    FROM public.technical_sheets sheet
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(sheet.strap_colors) = 'array'
        THEN sheet.strap_colors ELSE '[]'::jsonb END
    ) line(value)
   WHERE sheet.id = p_reference_id
     AND line.value ->> 'technical_strap_line_id' = p_line_id::text;
  IF v_count <> 1 THEN RETURN '[]'::jsonb; END IF;
  BEGIN
    v_context := private.resolve_technical_strap_material(
      p_reference_id, p_material_variant_id, p_line_id, NULL, false
    );
  EXCEPTION WHEN OTHERS THEN RETURN '[]'::jsonb;
  END;
  v_policy := private.validate_strap_material_policy(v_line);
  v_pin := (v_context ->> 'pinned_base_product_id')::uuid;
  v_ids := CASE WHEN v_policy ->> 'material_mode' = 'select_on_order'
    THEN v_policy -> 'allowed_material_group_ids'
    WHEN v_context ->> 'base_group_id' IS NOT NULL
      THEN jsonb_build_array(v_context -> 'base_group_id')
    ELSE '[]'::jsonb END;
  FOR v_id IN SELECT value::uuid FROM jsonb_array_elements_text(v_ids)
  LOOP
    SELECT g.name INTO v_name FROM public.product_groups g WHERE g.id = v_id;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_colors := private.mobile_strap_allowed_colors(
      coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base'),
      v_id, public.try_parse_uuid(v_line ->> 'measure_id'),
      public.try_parse_uuid(v_line ->> 'group_id')
    );
    IF v_pin IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(color.value ORDER BY color.ordinality), '[]'::jsonb)
        INTO v_colors
        FROM jsonb_array_elements(v_colors) WITH ORDINALITY color(value, ordinality)
       WHERE EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.id = v_pin AND p.active AND p.unit = 'm' AND p.group_id = v_id
            AND public.resolve_strap_canonical_color_id(p.color)
                  = public.try_parse_uuid(color.value ->> 'id')
            AND NOT EXISTS (
              SELECT 1 FROM public.base_material_color_official_products official
               WHERE official.base_group_id = v_id AND official.status = 'active'
                 AND official.color_id = public.try_parse_uuid(color.value ->> 'id')
                 AND official.official_product_id <> v_pin
            )
       );
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'base_group_id', v_id, 'base_group_name', v_name, 'allowed_colors', v_colors
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.technical_strap_material_options(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_mobile_strap_offline_manifest(p_reference_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- mobile_strap_offline_manifest_v2_20270101016100
  v_requested uuid[];
  v_missing text;
  v_context record;
  v_line record;
  v_references jsonb := '[]'::jsonb;
  v_lines jsonb;
  v_allowed_colors jsonb;
  v_identity_basis text;
  v_identity_group_id uuid;
  v_technical_line_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
  v_group_id uuid;
  v_group_name text;
  v_material_context jsonb;
  v_material_options jsonb;
  v_base_group_id uuid;
  v_consumption numeric;
  v_consumption_per_size jsonb;
  v_internal_enabled boolean;
  v_generated_at timestamptz := pg_catalog.statement_timestamp();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(DISTINCT requested.id ORDER BY requested.id),
           ARRAY[]::uuid[]
         )
    INTO v_requested
    FROM pg_catalog.unnest(COALESCE(
      p_reference_ids, ARRAY[]::uuid[]
    )) requested(id)
   WHERE requested.id IS NOT NULL;
  IF pg_catalog.cardinality(v_requested) > 200 THEN
    RAISE EXCEPTION 'Manifesto aceita no maximo 200 referencias'
      USING ERRCODE = '54000';
  END IF;

  IF pg_catalog.cardinality(v_requested) > 0 THEN
    SELECT pg_catalog.string_agg(requested.id::text, ', ' ORDER BY requested.id)
      INTO v_missing
      FROM pg_catalog.unnest(v_requested) requested(id)
      LEFT JOIN public.technical_sheets sheet
        ON sheet.id = requested.id
       AND public.normalize_strap_catalog_text(sheet.status_ficha)
             IN ('publicada', 'validada')
       AND sheet.retired_at IS NULL
     WHERE sheet.id IS NULL;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'Referencia(s) inexistente(s) ou nao publicada(s): %',
        v_missing USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_context IN
    WITH eligible_sheets AS (
      SELECT sheet.*
        FROM public.technical_sheets sheet
       WHERE public.normalize_strap_catalog_text(sheet.status_ficha)
               IN ('publicada', 'validada')
         AND sheet.retired_at IS NULL
         AND (
           pg_catalog.cardinality(v_requested) = 0
           OR sheet.id = ANY(v_requested)
         )
    ), contexts AS (
      SELECT sheet.id AS reference_id,
             NULL::uuid AS material_variant_id,
             -1::numeric AS display_order,
             sheet.strap_colors
        FROM eligible_sheets sheet
      UNION ALL
      SELECT sheet.id,
             variant.id,
             COALESCE(variant.display_order, 0),
             sheet.strap_colors
        FROM eligible_sheets sheet
        JOIN public.reference_material_variants variant
          ON variant.reference_id = sheet.id
         AND COALESCE(variant.active, true)
    )
    SELECT *
      FROM contexts
     ORDER BY reference_id, display_order, material_variant_id NULLS FIRST
  LOOP
    v_lines := '[]'::jsonb;
    FOR v_line IN
      SELECT entry.value, entry.ordinality
        FROM pg_catalog.jsonb_array_elements(
          CASE
            WHEN pg_catalog.jsonb_typeof(v_context.strap_colors) = 'array'
              THEN v_context.strap_colors
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY entry(value, ordinality)
       ORDER BY entry.ordinality
    LOOP
      -- O manifesto nao pode "curar" uma linha que o writer vivo rejeitaria.
      -- Os tres UUIDs canonicos precisam existir na propria ficha; aliases e
      -- identity_map servem para diagnostico/migracao, nao para autorizar um PV
      -- offline que depois falharia ao sincronizar.
      v_technical_line_id := public.try_parse_uuid(
        v_line.value ->> 'technical_strap_line_id'
      );
      v_measure_id := public.try_parse_uuid(v_line.value ->> 'measure_id');
      v_strap_type_id := public.try_parse_uuid(
        v_line.value ->> 'strap_type_id'
      );

      v_identity_basis := CASE
        WHEN v_line.value ->> 'identity_basis' = 'finished_product_group'
          THEN 'finished_product_group'
        ELSE 'reference_base'
      END;
      v_identity_group_id := CASE
        WHEN v_identity_basis = 'finished_product_group' THEN
          public.try_parse_uuid(v_line.value ->> 'identity_group_id')
        ELSE NULL
      END;
      v_group_id := public.try_parse_uuid(v_line.value ->> 'group_id');
      SELECT product_group.name
        INTO v_group_name
        FROM public.product_groups product_group
       WHERE product_group.id = v_group_id;
      v_group_name := COALESCE(
        NULLIF(pg_catalog.btrim(v_line.value ->> 'group_name'), ''),
        v_group_name
      );
      BEGIN
        v_material_context := private.resolve_technical_strap_material(
          v_context.reference_id, v_context.material_variant_id,
          v_technical_line_id, NULL, false
        );
      EXCEPTION WHEN OTHERS THEN
        -- Nao normalizar uma politica desconhecida para um default gravavel.
        v_material_context := jsonb_build_object('material_mode', 'invalid');
      END;
      v_base_group_id := public.try_parse_uuid(v_material_context ->> 'base_group_id');
      v_material_options := private.technical_strap_material_options(
        v_context.reference_id, v_context.material_variant_id, v_technical_line_id
      );

      v_consumption := NULL;
      BEGIN
        v_consumption := NULLIF(
          v_line.value ->> 'consumption', ''
        )::numeric;
      EXCEPTION WHEN OTHERS THEN
        v_consumption := NULL;
      END;
      v_consumption_per_size := CASE
        WHEN pg_catalog.jsonb_typeof(
          v_line.value -> 'consumption_per_size'
        ) = 'object' THEN v_line.value -> 'consumption_per_size'
        ELSE NULL
      END;
      v_internal_enabled := CASE
        WHEN v_identity_basis = 'finished_product_group' THEN false
        WHEN pg_catalog.jsonb_typeof(
          v_line.value -> 'internal_production_enabled'
        ) = 'boolean' THEN (
          v_line.value ->> 'internal_production_enabled'
        )::boolean
        ELSE true
      END;
      v_allowed_colors := CASE
        WHEN v_technical_line_id IS NULL
          OR v_measure_id IS NULL
          OR v_strap_type_id IS NULL
          OR (
            v_identity_basis = 'finished_product_group'
            AND v_identity_group_id IS NULL
          ) THEN '[]'::jsonb
        ELSE coalesce((
          SELECT option.value -> 'allowed_colors'
            FROM jsonb_array_elements(v_material_options) option(value)
           WHERE option.value ->> 'base_group_id' = v_base_group_id::text
        ), '[]'::jsonb)
      END;

      v_lines := v_lines || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'technical_strap_line_id', v_technical_line_id,
          'position', v_line.ordinality,
          'label', NULLIF(pg_catalog.btrim(
            v_line.value ->> 'label'), ''),
          'identity_basis', v_identity_basis,
          'identity_group_id', v_identity_group_id,
          'strap_type_id', v_strap_type_id,
          'measure_id', v_measure_id,
          'color_mode', CASE
            WHEN v_identity_basis = 'finished_product_group'
              OR v_line.value ->> 'color_mode' = 'select_on_order'
              THEN 'select_on_order'
            ELSE 'follow_main'
          END,
          'internal_production_enabled', v_internal_enabled,
          'group_id', v_group_id,
          'group_name', v_group_name,
          'consumption', v_consumption,
          'consumption_per_size', v_consumption_per_size,
          'material_mode', v_material_context -> 'material_mode',
          'material_group_id', v_material_context -> 'material_group_id',
          'allowed_material_group_ids', coalesce(v_material_context -> 'allowed_material_group_ids', '[]'::jsonb),
          'base_group_id', v_base_group_id,
          'base_group_name', v_material_context -> 'base_group_name',
          'material_options', v_material_options,
          'allowed_colors', v_allowed_colors
        )
      );
    END LOOP;

    v_references := v_references || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'reference_id', v_context.reference_id,
        'material_variant_id', v_context.material_variant_id,
        'lines', v_lines
      )
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'version', 2,
    'generated_at', v_generated_at,
    'manifest_hash', public.strap_payload_hash(v_references),
    'references', v_references
  );
END;
$function$;



CREATE OR REPLACE FUNCTION public.diagnose_sale_order_internal_strap_readiness(
  p_reference_id uuid, p_material_variant_id uuid, p_color text
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_entry record;
  v_line jsonb;
  v_line_id uuid;
  v_context jsonb;
  v_options jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_color_id uuid := public.resolve_strap_canonical_color_id(p_color);
  v_color_name text;
  v_reference_lines integer := 0;
  v_requires_selection boolean := false;
  v_line_eligible boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Somente usuario aprovado pode consultar o cadastro de tiras' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sheet FROM public.technical_sheets s WHERE s.id = p_reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('requires_reference_base', false, 'ready', true, 'issues', '[]'::jsonb);
  END IF;
  SELECT c.name INTO v_color_name FROM public.canonical_colors c
   WHERE c.id = v_color_id AND c.active;
  IF NOT FOUND THEN v_color_id := NULL; END IF;
  FOR v_entry IN SELECT value, ordinality
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
        THEN v_sheet.strap_colors ELSE '[]'::jsonb END
    ) WITH ORDINALITY line(value, ordinality) ORDER BY ordinality
  LOOP
    v_line := v_entry.value;
    CONTINUE WHEN coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base') <> 'reference_base';
    v_reference_lines := v_reference_lines + 1;
    v_line_id := public.try_parse_uuid(v_line ->> 'technical_strap_line_id');
    v_options := '[]'::jsonb;
    v_context := '{}'::jsonb;
    BEGIN
      v_context := private.resolve_technical_strap_material(
        p_reference_id, p_material_variant_id, v_line_id, NULL, false
      );
      v_options := private.technical_strap_material_options(
        p_reference_id, p_material_variant_id, v_line_id
      );
      v_requires_selection := v_requires_selection
        OR v_context ->> 'material_mode' = 'select_on_order';
      IF coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'follow_main' THEN
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_options) material(value)
          CROSS JOIN LATERAL jsonb_array_elements(material.value -> 'allowed_colors') color(value)
           WHERE color.value ->> 'id' = v_color_id::text
        ) INTO v_line_eligible;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_options) material(value)
           WHERE jsonb_array_length(material.value -> 'allowed_colors') > 0
        ) INTO v_line_eligible;
      END IF;
      IF NOT v_line_eligible THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', CASE WHEN v_color_id IS NULL
                        AND coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'follow_main'
                      THEN 'cor_nao_canonica' ELSE 'material_posicao_sem_catalogo' END,
          'technical_strap_line_id', v_line_id,
          'message', format('%s: nenhum material/cor elegivel. Confira o SKU oficial, largura e rendimento aprovado da medida.',
            coalesce(nullif(v_line ->> 'label', ''), 'Posicao ' || v_entry.ordinality::text))
        ));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'material_posicao_invalido', 'technical_strap_line_id', v_line_id,
        'message', format('%s: %s', coalesce(nullif(v_line ->> 'label', ''), 'Posicao'), SQLERRM)
      ));
    END;
    v_lines := v_lines || jsonb_build_array(v_context || jsonb_build_object(
      'technical_strap_line_id', v_line_id, 'position', v_entry.ordinality,
      'label', v_line -> 'label', 'material_options', v_options
    ));
  END LOOP;
  RETURN jsonb_build_object(
    'reference_id', p_reference_id, 'material_variant_id', p_material_variant_id,
    'requires_reference_base', v_reference_lines > 0,
    'requires_material_selection', v_requires_selection,
    -- Compatibilidade de apresentacao somente quando existe uma base unica.
    'base_group_id', CASE WHEN (
      SELECT count(DISTINCT value ->> 'base_group_id') FROM jsonb_array_elements(v_lines)
    ) = 1 AND NOT v_requires_selection THEN v_lines -> 0 -> 'base_group_id' ELSE NULL END,
    'base_group_name', CASE WHEN (
      SELECT count(DISTINCT value ->> 'base_group_id') FROM jsonb_array_elements(v_lines)
    ) = 1 AND NOT v_requires_selection THEN v_lines -> 0 -> 'base_group_name' ELSE NULL END,
    'color_id', v_color_id, 'color_name', v_color_name,
    'ready', jsonb_array_length(v_issues) = 0, 'issues', v_issues, 'lines', v_lines
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.diagnose_sale_order_internal_strap_readiness(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnose_sale_order_internal_strap_readiness(uuid,uuid,text)
  TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.run_strap_snapshot_sector_contract_tests()
 RETURNS TABLE(case_name text, passed boolean, details text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_preview text := pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  );
  v_identity text := pg_catalog.pg_get_functiondef(
    'private.resolve_committed_strap_identity(uuid,uuid,jsonb)'::regprocedure
  );
  v_enqueue text := pg_catalog.pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  );
  v_engine text := pg_catalog.pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  );
  v_report text := pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  );
  v_sector_report_resolver text := pg_catalog.pg_get_functiondef(
    'private.resolve_report_consumption_sector_context(text,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure
  );
  v_manifest text := pg_catalog.pg_get_functiondef(
    'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
  );
  v_freeze text := pg_catalog.pg_get_functiondef(
    'public.freeze_technical_sheet(uuid,uuid,uuid,text,numeric,integer,jsonb)'::regprocedure
  );
BEGIN
  RETURN QUERY VALUES
    (
      'estado_comprometido_fail_closed'::text,
      NOT private.is_committed_sale_order_status('Rascunho')
      AND NOT private.is_committed_sale_order_status('Pendente')
      AND NOT private.is_committed_sale_order_status('draft')
      AND NOT private.is_committed_sale_order_status('pending')
      AND private.is_committed_sale_order_status('Aprovado')
      AND private.is_committed_sale_order_status('Entregue')
      AND private.is_committed_sale_order_status('estado futuro')
      AND private.is_committed_sale_order_status(NULL),
      'somente quatro aliases editaveis; desconhecido/NULL fecha como comprometido'::text
    ),
    (
      'preview_reidrata_comprometido'::text,
      position(
        'committed_strap_preview_rehydration_20270101015500' IN v_preview
      ) > 0
      AND position('v_item.strap_colors' IN v_preview) > 0
      AND position('v_order.quantity' IN v_preview) > 0
      AND position('resolve_effective_op_grade' IN v_preview) > 0,
      'item/OP persistidos vencem payload em estado comprometido'::text
    ),
    (
      'preview_acl_e_search_path'::text,
      NOT pg_catalog.has_function_privilege(
        'anon',
        'public.preview_sale_order_strap_demand_draft(jsonb)',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated',
        'public.preview_sale_order_strap_demand_draft(jsonb)',
        'EXECUTE'
      )
      AND position('is_approved_user' IN v_preview) > 0
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc procedure
         WHERE procedure.oid =
           'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
           AND procedure.prosecdef
           AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      ),
      'sem anon; approved/service; SECURITY DEFINER com search_path vazio'::text
    ),
    (
      'helper_preview_anterior_privado'::text,
      pg_catalog.to_regprocedure(
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'
      ) IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)',
        'EXECUTE'
      ),
      'implementacao anterior nao e RPC publica'::text
    ),
    (
      'enqueue_usa_preview_operacional_privado'::text,
      position(
        'private.preview_sale_order_strap_demand_operational' IN v_enqueue
      ) > 0
      AND position(
        'public.preview_sale_order_strap_demand(p_sale_order_id)' IN v_enqueue
      ) = 0
      AND pg_catalog.to_regprocedure(
        'private.preview_sale_order_strap_demand_operational(uuid)'
      ) IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        'authenticated',
        'private.preview_sale_order_strap_demand_operational(uuid)',
        'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'anon',
        'private.preview_sale_order_strap_demand_operational(uuid)',
        'EXECUTE'
      ),
      'primeira demanda usa payload do banco sem flag publica de bypass'::text
    ),
    (
      'preview_pre_demanda_nao_finge_yield_congelado'::text,
      position('sale_order_item_pre_demand' IN v_identity) > 0
      AND position('physical_snapshot_complete' IN v_preview) > 0
      AND position('snapshot_warning' IN v_preview) > 0
      AND position(
        'v_preview.resolved, ''{}''::jsonb) || v_snapshot_resolved'
          IN v_preview
      ) = 0,
      'sem demanda, resolved e reconstruido do item e yield/base ficam informativos'::text
    ),
    (
      'setor_source_null_nao_herda_por_sku'::text,
      private.resolve_consumption_sector_context(
        '00000000-0000-0000-0000-000000000001'::uuid,
        NULL,
        '00000000-0000-0000-0000-000000000002'::uuid,
        NULL
      ) ->> 'consumption_sector_source' = 'legacy_fallback',
      'source ausente nao entra no ramo de componentes diretos'::text
    ),
    (
      'motor_anexa_setor_sem_recalcular_required'::text,
      position(
        'consumption_sector_context_20270101015500' IN v_engine
      ) > 0
      AND position(
        'private.attach_consumption_sector_context' IN v_engine
      ) > 0,
      'anotacao ocorre somente no retorno v_result'::text
    ),
    (
      'snapshot_usa_motor_canonico'::text,
      position('calculate_order_consumption_by_grade' IN v_freeze) > 0
      AND position('consumption_snapshot' IN v_freeze) > 0,
      'freeze persiste o array ja anotado pelo motor'::text
    ),
    (
      'reserva_congela_metadata'::text,
      EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger trigger
         WHERE trigger.tgrelid = 'public.material_reservations'::regclass
           AND trigger.tgname = 'trg_freeze_reservation_consumption_sector'
           AND NOT trigger.tgisinternal
      )
      AND pg_catalog.to_regprocedure(
        'private.freeze_material_reservation_sector_context()'
      ) IS NOT NULL,
      'todas as insercoes canonicas passam pela mesma fronteira'::text
    ),
    (
      'relatorio_usa_snapshot_reserva_e_escopo'::text,
      position(
        'historical_preview_and_sector_report_20270101015500' IN v_report
      ) > 0
      AND position(
        'private.resolve_report_consumption_sector_context' IN v_report
      ) > 0
      AND position($needle$'scope_type', v_scope.scope_type$needle$
            IN v_report) > 0
      AND position($needle$'scope_key', v_scope.scope_key$needle$
            IN v_report) > 0,
      'report nao confunde item integral com OP parcial'::text
    ),
    (
      'relatorio_nao_mascara_reserva_ambigua'::text,
      position(
        'reservation_ambiguous_passthrough_20270101015500'
          IN v_sector_report_resolver
      ) > 0
      AND position($needle$v_origin = 'ambiguous'$needle$
            IN v_sector_report_resolver) > 0,
      'metadata ambigua permanece bloqueante em vez de virar reservation'::text
    ),
    (
      'manifesto_v2_minimo_autoritativo'::text,
      position(
        'mobile_strap_offline_manifest_v2_20270101016100' IN v_manifest
      ) > 0
      AND position($needle$'version', 2$needle$ IN v_manifest) > 0
      AND position($needle$'allowed_colors'$needle$ IN v_manifest) > 0
      AND position($needle$'material_options'$needle$ IN v_manifest) > 0
      AND position($needle$'consumption_per_size'$needle$ IN v_manifest) > 0
      AND position($needle$'manifest_hash'$needle$ IN v_manifest) > 0
      AND position('v_measure_id' IN v_manifest) > 0
      AND position('unit_price' IN v_manifest) = 0
      AND position('purchase_price' IN v_manifest) = 0
      AND position('finished_available_m' IN v_manifest) = 0,
      'shape tecnico sem preco/saldo/source financeiro'::text
    ),
    (
      'manifesto_acl_e_search_path'::text,
      NOT pg_catalog.has_function_privilege(
        'anon',
        'public.get_mobile_strap_offline_manifest(uuid[])',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_mobile_strap_offline_manifest(uuid[])',
        'EXECUTE'
      )
      AND position('is_approved_user' IN v_manifest) > 0
      AND EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc procedure
         WHERE procedure.oid =
           'public.get_mobile_strap_offline_manifest(uuid[])'::regprocedure
           AND procedure.prosecdef
           AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      ),
      'manifesto nao contorna aprovacao/RLS'::text
    ),
    (
      'baixa_por_entrada_no_setor_desativada'::text,
      NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger trigger
         WHERE trigger.tgname IN (
           'trg_ab_debit_materials_when_sector_starts',
           'trg_aa0_preserve_unstarted_sector_reservations',
           'trg_assign_reservation_consumption_sector'
         )
           AND NOT trigger.tgisinternal
      ),
      'picking/finalizacao continuam sendo os unicos pontos de baixa'::text
    );
END;
$function$;


-- ACLs existentes preservadas por CREATE OR REPLACE; helpers privados nao sao RPCs.
CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands(p_sale_order_id uuid, p_event_type text DEFAULT 'confirmed'::text, p_correlation_id uuid DEFAULT gen_random_uuid())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- independent_strap_colors_20270101015400
-- material_position_policy_confirmation_20270101016100
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
    FROM private.preview_sale_order_strap_demand_operational(p_sale_order_id) p;

  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items i
         JOIN public.technical_sheets ts ON ts.id = i.reference_id
        WHERE i.sale_order_id = p_sale_order_id
          AND i.production_excluded_at IS NULL
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
              'color_mode', CASE
                WHEN coalesce(nullif(
                  line.value ->> 'identity_basis', ''), 'reference_base')
                    = 'finished_product_group' THEN 'select_on_order'
                ELSE coalesce(nullif(
                  line.value ->> 'color_mode', ''), 'follow_main')
              END,
              'material_mode', coalesce(line.value ->> 'material_mode', 'follow_reference'),
              'material_group_id', nullif(line.value ->> 'material_group_id', ''),
              'allowed_material_group_ids', coalesce(nullif(
                line.value -> 'allowed_material_group_ids', 'null'::jsonb), '[]'::jsonb),
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
                  -- upper_and_straps_coexist_20270101014675
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
              'color_mode', CASE
                WHEN coalesce(nullif(
                  line.value ->> 'identity_basis', ''), 'reference_base')
                    = 'finished_product_group' THEN 'select_on_order'
                ELSE coalesce(nullif(
                  line.value ->> 'color_mode', ''), 'follow_main')
              END,
              'material_mode', coalesce(line.value ->> 'material_mode', 'follow_reference'),
              'material_group_id', nullif(line.value ->> 'material_group_id', ''),
              'allowed_material_group_ids', coalesce(nullif(
                line.value -> 'allowed_material_group_ids', 'null'::jsonb), '[]'::jsonb),
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
         JOIN public.sale_order_items operational_item
           ON operational_item.id = d.sale_order_item_id
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
          AND operational_item.production_excluded_at IS NULL
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

  -- Edicao de PV em producao (item_updated/schedule_changed) nao pode abortar
  -- o save so porque ainda nao existe demanda corrente. schedule_changed so
  -- revisa fato ja materializado (05700). item_updated com blocker tambem
  -- vira no-op: a primeira demanda nasce so de evento autoritativo limpo.
  IF NOT EXISTS (
       SELECT 1
         FROM public.sale_order_strap_demands d
         JOIN public.sale_order_items operational_item
           ON operational_item.id = d.sale_order_item_id
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
          AND operational_item.production_excluded_at IS NULL
     ) THEN
    IF p_event_type = 'schedule_changed'
       OR (
         p_event_type NOT IN ('confirmed', 'approved', 'direct_production', 'cancelled')
         AND v_block_count > 0
       ) THEN
      RETURN NULL;
    END IF;
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
   WHERE sale_order_id = p_sale_order_id
     AND production_excluded_at IS NULL;
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
$function$;

REVOKE ALL ON FUNCTION public.enqueue_sale_order_strap_demands(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
