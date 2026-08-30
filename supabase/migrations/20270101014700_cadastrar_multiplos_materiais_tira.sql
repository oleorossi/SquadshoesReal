-- Cadastro atomico e concorrente-seguro de varios materiais possiveis para
-- uma mesma tira.
--
-- Familia e medida sao compartilhadas pelo lote. Cada material continua usando
-- o writer canonico singular, preservando versionamento, largura fisica,
-- aprovacao e auditoria sem criar cor, produto ou variante de estoque.

BEGIN;

-- O batch usa o writer singular para cada material. Este override preserva a
-- API existente e acrescenta duas garantias que precisam morar no writer
-- canonico, pois uma checagem feita apenas na UI fica sujeita a catalogo
-- obsoleto e duas chamadas concorrentes:
--   1. familia/medida novas convergem pela identidade natural;
--   2. `new_material_only=true` rejeita qualquer receita nao historica sob o
--      mesmo advisory lock usado por `save_artisanal_strap_recipe`.
CREATE OR REPLACE FUNCTION public.save_artisanal_strap_conversion(
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_payload jsonb := coalesce(p_payload -> 'type', '{}'::jsonb);
  v_measure_payload jsonb := coalesce(p_payload -> 'measure', '{}'::jsonb);
  v_recipe_payload jsonb := coalesce(p_payload -> 'recipe', '{}'::jsonb);
  v_type public.artisanal_strap_types%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_type_id uuid;
  v_measure_id uuid;
  v_requested_type_id uuid;
  v_requested_measure_id uuid;
  v_base_group_id uuid;
  v_recipe_id uuid;
  v_requested_recipe_id uuid;
  v_width_profile_id uuid;
  v_type_name_norm text;
  v_measure_width_mm numeric;
  v_measure_width_identity text;
  v_require_new_material boolean := false;
  v_reason text := public.require_strap_change_reason(
    p_reason,
    'Cadastro de conversao de tira'
  );
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');

  IF jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(v_type_payload) <> 'object'
     OR jsonb_typeof(v_measure_payload) <> 'object'
     OR jsonb_typeof(v_recipe_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload da conversao de tira invalido';
  END IF;

  IF p_payload ? 'new_material_only' THEN
    IF jsonb_typeof(p_payload -> 'new_material_only') <> 'boolean' THEN
      RAISE EXCEPTION 'new_material_only deve ser booleano';
    END IF;
    v_require_new_material := (p_payload ->> 'new_material_only')::boolean;
  END IF;

  IF p_payload ? 'variant'
     OR p_payload ? 'product'
     OR p_payload ? 'color_id'
     OR v_recipe_payload ? 'color_id'
     OR v_recipe_payload ? 'color' THEN
    RAISE EXCEPTION 'Conversao de tira nao aceita cor, produto ou variante de estoque';
  END IF;

  BEGIN
    v_base_group_id := nullif(p_payload ->> 'base_group_id', '')::uuid;
    v_requested_recipe_id := nullif(v_recipe_payload ->> 'id', '')::uuid;
    v_width_profile_id := nullif(v_recipe_payload ->> 'base_width_profile_id', '')::uuid;
    v_requested_type_id := nullif(v_type_payload ->> 'id', '')::uuid;
    v_requested_measure_id := nullif(v_measure_payload ->> 'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'UUID invalido no payload da conversao de tira';
  END;

  IF v_base_group_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.product_groups g WHERE g.id = v_base_group_id
     ) THEN
    RAISE EXCEPTION 'Napa-base da conversao inexistente';
  END IF;
  IF v_require_new_material
     AND NOT public.strap_base_group_is_eligible(v_base_group_id) THEN
    RAISE EXCEPTION 'Material-base nao e elegivel para conversao de tira: %', v_base_group_id;
  END IF;
  IF v_require_new_material AND v_requested_recipe_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cadastro de material novo nao aceita recipe.id';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF v_requested_type_id IS NOT NULL THEN
    v_type_id := v_requested_type_id;
    SELECT * INTO v_type
      FROM public.artisanal_strap_types
     WHERE id = v_type_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Familia da conversao inexistente';
    END IF;
    IF v_require_new_material AND NOT v_type.active THEN
      RAISE EXCEPTION 'Familia da conversao esta inativa';
    END IF;
    IF v_type_payload ? 'name' OR v_type_payload ? 'active' THEN
      v_type_id := public.save_artisanal_strap_type(
        coalesce(nullif(v_type_payload ->> 'name', ''), v_type.name),
        v_type.id,
        CASE WHEN v_type_payload ? 'active'
          THEN (v_type_payload ->> 'active')::boolean ELSE v_type.active END,
        v_reason
      );
      SELECT * INTO v_type
        FROM public.artisanal_strap_types
       WHERE id = v_type_id
       FOR UPDATE;
    END IF;
  ELSE
    v_type_name_norm := public.normalize_strap_catalog_text(v_type_payload ->> 'name');
    IF coalesce(v_type_name_norm, '') = '' THEN
      RAISE EXCEPTION 'Nome da familia da conversao e obrigatorio';
    END IF;
    IF v_require_new_material
       AND v_type_payload ? 'active'
       AND NOT (v_type_payload ->> 'active')::boolean THEN
      RAISE EXCEPTION 'Familia nova da conversao deve nascer ativa';
    END IF;

    -- Toda criacao pelo fluxo de conversao participa deste lock. Duas RPCs
    -- com a mesma familia deixam de disputar o UNIQUE(name_norm): a segunda
    -- reutiliza a identidade criada pela primeira depois que ela confirmar.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-type-identity:' || v_type_name_norm,
      0
    ));
    IF v_require_new_material THEN
      SELECT * INTO v_type
        FROM public.artisanal_strap_types
       WHERE name_norm = v_type_name_norm
       FOR UPDATE;
      IF FOUND THEN
        IF NOT v_type.active THEN
          RAISE EXCEPTION 'Familia da conversao ja existe, mas esta inativa';
        END IF;
        v_type_id := v_type.id;
      ELSE
        v_type_id := public.save_artisanal_strap_type(
          nullif(btrim(v_type_payload ->> 'name'), ''),
          NULL,
          true,
          v_reason
        );
        SELECT * INTO v_type
          FROM public.artisanal_strap_types
         WHERE id = v_type_id
         FOR UPDATE;
      END IF;
    ELSE
      -- Compatibilidade do writer singular: fora do batch, criar identidade
      -- repetida continua falhando no UNIQUE em vez de reutilizar cadastro.
      v_type_id := public.save_artisanal_strap_type(
        nullif(btrim(v_type_payload ->> 'name'), ''),
        NULL,
        coalesce((v_type_payload ->> 'active')::boolean, true),
        v_reason
      );
      SELECT * INTO v_type
        FROM public.artisanal_strap_types
       WHERE id = v_type_id
       FOR UPDATE;
    END IF;
  END IF;

  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'Writer nao retornou a familia da conversao';
  END IF;
  IF v_require_new_material AND NOT v_type.active THEN
    RAISE EXCEPTION 'Familia da conversao deve estar ativa';
  END IF;

  IF v_requested_measure_id IS NOT NULL THEN
    v_measure_id := v_requested_measure_id;
    SELECT * INTO v_measure
      FROM public.artisanal_strap_measures
     WHERE id = v_measure_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Medida da conversao inexistente';
    END IF;
    IF v_measure.strap_type_id <> v_type_id THEN
      RAISE EXCEPTION 'Medida nao pertence a familia informada';
    END IF;
    IF v_require_new_material AND NOT v_measure.active THEN
      RAISE EXCEPTION 'Medida da conversao esta inativa';
    END IF;
    IF v_measure_payload ? 'display_name'
       OR v_measure_payload ? 'finished_width_mm'
       OR v_measure_payload ? 'active' THEN
      v_measure_id := public.save_artisanal_strap_measure(
        v_type_id,
        coalesce(nullif(v_measure_payload ->> 'display_name', ''), v_measure.display_name),
        CASE WHEN v_measure_payload ? 'finished_width_mm'
          THEN (v_measure_payload ->> 'finished_width_mm')::numeric
          ELSE v_measure.finished_width_mm END,
        v_measure.id,
        CASE WHEN v_measure_payload ? 'active'
          THEN (v_measure_payload ->> 'active')::boolean ELSE v_measure.active END,
        v_reason
      );
      SELECT * INTO v_measure
        FROM public.artisanal_strap_measures
       WHERE id = v_measure_id
       FOR UPDATE;
    END IF;
  ELSE
    BEGIN
      v_measure_width_mm := nullif(v_measure_payload ->> 'finished_width_mm', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Largura final da medida e invalida';
    END;
    IF v_measure_width_mm IS NULL OR v_measure_width_mm <= 0 THEN
      RAISE EXCEPTION 'Largura final da medida deve ser positiva';
    END IF;
    -- Numeric preserva a escala textual do JSON (15::text <> 15.0::text), mas
    -- o indice UNIQUE considera os dois valores iguais. A chave do advisory
    -- lock precisa usar a mesma equivalencia para nao deixar a corrida passar.
    v_measure_width_identity := pg_catalog.trim_scale(v_measure_width_mm)::text;
    IF nullif(btrim(v_measure_payload ->> 'display_name'), '') IS NULL THEN
      RAISE EXCEPTION 'Nome da medida da conversao e obrigatorio';
    END IF;
    IF v_require_new_material
       AND v_measure_payload ? 'active'
       AND NOT (v_measure_payload ->> 'active')::boolean THEN
      RAISE EXCEPTION 'Medida nova da conversao deve nascer ativa';
    END IF;

    -- A identidade vigente da medida e (familia, largura final), exatamente a
    -- chave do indice parcial artisanal_strap_measures_active_identity_uq.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-measure-identity:' || v_type_id::text || ':' || v_measure_width_identity,
      0
    ));
    IF v_require_new_material THEN
      SELECT * INTO v_measure
        FROM public.artisanal_strap_measures
       WHERE strap_type_id = v_type_id
         AND finished_width_mm = v_measure_width_mm
         AND active
       FOR UPDATE;
      IF FOUND THEN
        v_measure_id := v_measure.id;
      ELSE
        v_measure_id := public.save_artisanal_strap_measure(
          v_type_id,
          nullif(btrim(v_measure_payload ->> 'display_name'), ''),
          v_measure_width_mm,
          NULL,
          true,
          v_reason
        );
        SELECT * INTO v_measure
          FROM public.artisanal_strap_measures
         WHERE id = v_measure_id
         FOR UPDATE;
      END IF;
    ELSE
      v_measure_id := public.save_artisanal_strap_measure(
        v_type_id,
        nullif(btrim(v_measure_payload ->> 'display_name'), ''),
        v_measure_width_mm,
        NULL,
        coalesce((v_measure_payload ->> 'active')::boolean, true),
        v_reason
      );
      SELECT * INTO v_measure
        FROM public.artisanal_strap_measures
       WHERE id = v_measure_id
       FOR UPDATE;
    END IF;
  END IF;

  IF v_measure.id IS NULL THEN
    RAISE EXCEPTION 'Writer nao retornou a medida da conversao';
  END IF;
  IF v_require_new_material AND NOT v_measure.active THEN
    RAISE EXCEPTION 'Medida da conversao deve estar ativa';
  END IF;
  IF v_measure.strap_type_id <> v_type_id THEN
    RAISE EXCEPTION 'Medida nao pertence a familia informada';
  END IF;

  -- O lock de conversao agora usa sempre o UUID resolvido. Ele vem depois de
  -- largura/perfil no fluxo de confirmacao, removendo a inversao
  -- conversion -> width que o antigo pre-lock do batch introduzia.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-conversion:' || v_measure_id::text || ':' || v_base_group_id::text,
    0
  ));

  IF v_require_new_material THEN
    -- Mesmo lock canônico de save/approve recipe. Como e xact-level, a chamada
    -- seguinte o readquire na mesma transacao e nenhum writer concorrente pode
    -- inserir ou promover uma receita entre a verificacao e o INSERT.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-recipe:' || v_measure_id::text || ':' || v_base_group_id::text,
      0
    ));
    IF EXISTS (
      SELECT 1
        FROM public.artisanal_strap_recipes recipe
       WHERE recipe.measure_id = v_measure_id
         AND recipe.base_group_id = v_base_group_id
         AND recipe.status NOT IN ('superseded', 'archived')
    ) THEN
      RAISE EXCEPTION
        'Material-base ja possui receita vigente ou em elaboracao para esta medida: %',
        v_base_group_id;
    END IF;
  END IF;

  v_recipe_id := public.save_artisanal_strap_recipe(
    v_measure_id,
    v_base_group_id,
    (v_recipe_payload ->> 'cut_band_width_mm')::numeric,
    (v_recipe_payload ->> 'confirmed_yield_m_per_m')::numeric,
    v_recipe_payload ->> 'executor_type',
    CASE WHEN v_recipe_payload ? 'transformation_cost_per_m'
      THEN (v_recipe_payload ->> 'transformation_cost_per_m')::numeric
      ELSE NULL END,
    nullif(v_recipe_payload ->> 'default_contractor_id', '')::uuid,
    v_width_profile_id,
    v_requested_recipe_id,
    v_reason
  );

  RETURN jsonb_build_object(
    'type_id', v_type_id,
    'measure_id', v_measure_id,
    'base_group_id', v_base_group_id,
    'recipe_id', v_recipe_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text) IS
  'Salva familia, medida e receita atomicamente. Identidades novas convergem sob lock natural; new_material_only rejeita receita nao historica sob o lock canonico medida+base.';

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_material_conversions(
  p_payload jsonb,
  p_reason text,
  p_confirm boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_payload jsonb;
  v_measure_payload jsonb;
  v_materials jsonb;
  v_material_count integer;
  v_seen_base_group_ids uuid[] := ARRAY[]::uuid[];
  v_validation record;
  v_row record;
  v_base_group_id uuid;
  v_line_payload jsonb;
  v_conversion jsonb;
  v_conversions_by_ordinal jsonb := '{}'::jsonb;
  v_conversions jsonb;
  v_type_id uuid;
  v_measure_id uuid;
  v_reason text := public.require_strap_change_reason(
    p_reason,
    'Cadastro de materiais possiveis para tira'
  );
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF coalesce(p_confirm, false) THEN
    PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Payload do cadastro de materiais de tira deve ser um objeto';
  END IF;

  -- Conversao tecnica nao possui dimensao de cor nem cria identidade de
  -- estoque. O descendente recursivo impede que esses campos sejam escondidos
  -- dentro de type, measure, materials, recipe ou qualquer extensao futura.
  IF jsonb_path_exists(p_payload, '$.**.variant')
     OR jsonb_path_exists(p_payload, '$.**.variant_id')
     OR jsonb_path_exists(p_payload, '$.**.material_variant_id')
     OR jsonb_path_exists(p_payload, '$.**.product')
     OR jsonb_path_exists(p_payload, '$.**.product_id')
     OR jsonb_path_exists(p_payload, '$.**.base_product_id')
     OR jsonb_path_exists(p_payload, '$.**.finished_product_id')
     OR jsonb_path_exists(p_payload, '$.**.official_product_id')
     OR jsonb_path_exists(p_payload, '$.**.color')
     OR jsonb_path_exists(p_payload, '$.**.color_id')
     OR jsonb_path_exists(p_payload, '$.**.canonical_color_id') THEN
    RAISE EXCEPTION 'Conversao de tira nao aceita cor, produto ou variante de estoque';
  END IF;

  v_type_payload := p_payload -> 'type';
  v_measure_payload := p_payload -> 'measure';
  v_materials := p_payload -> 'materials';

  IF jsonb_typeof(v_type_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_measure_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Familia e medida compartilhadas devem ser objetos';
  END IF;
  IF jsonb_typeof(v_materials) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Materiais da tira devem ser informados em um array';
  END IF;

  v_material_count := jsonb_array_length(v_materials);
  IF v_material_count < 1 OR v_material_count > 25 THEN
    RAISE EXCEPTION 'Informe entre 1 e 25 materiais para a tira';
  END IF;

  -- Valida o lote inteiro antes da primeira escrita. Assim, erros estruturais
  -- nunca dependem da ordem escolhida para processar os materiais.
  FOR v_validation IN
    SELECT entry.value AS material, entry.ordinality::integer AS ordinality
      FROM jsonb_array_elements(v_materials) WITH ORDINALITY AS entry(value, ordinality)
     ORDER BY entry.ordinality
  LOOP
    IF jsonb_typeof(v_validation.material) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Material % deve ser um objeto', v_validation.ordinality;
    END IF;
    IF jsonb_typeof(v_validation.material -> 'recipe') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Receita do material % deve ser um objeto', v_validation.ordinality;
    END IF;
    IF (v_validation.material -> 'recipe') ? 'id' THEN
      RAISE EXCEPTION
        'Cadastro em lote nao aceita recipe.id; abra a conversao existente para criar ou editar uma versao';
    END IF;

    BEGIN
      v_base_group_id := nullif(v_validation.material ->> 'base_group_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Material % possui base_group_id invalido', v_validation.ordinality;
    END;

    IF v_base_group_id IS NULL THEN
      RAISE EXCEPTION 'Material % deve informar base_group_id', v_validation.ordinality;
    END IF;
    IF NOT public.strap_base_group_is_eligible(v_base_group_id) THEN
      RAISE EXCEPTION
        'Material % nao e uma base elegivel para conversao de tira: %',
        v_validation.ordinality,
        v_base_group_id;
    END IF;
    IF v_base_group_id = ANY (v_seen_base_group_ids) THEN
      RAISE EXCEPTION 'Material-base repetido no lote: %', v_base_group_id;
    END IF;
    v_seen_base_group_ids := array_append(v_seen_base_group_ids, v_base_group_id);
  END LOOP;

  -- Confirmacoes concorrentes sao adquiridas por UUID em ordem deterministica.
  -- Antes de o primeiro writer tocar a familia/medida compartilhada, o lote
  -- tambem adquire TODOS os locks e perfis de largura. Isso preserva a ordem
  -- global confirm -> width/profile -> type/measure -> conversion -> recipe e
  -- impede que a primeira linha segure type/measure enquanto uma chamada
  -- singular segura o perfil da segunda linha.
  --
  -- Nao se pre-adquire strap-conversion/strap-recipe aqui: faze-lo antes da
  -- largura recriaria o ciclo conversion -> width / width -> conversion.
  IF coalesce(p_confirm, false) THEN
    FOR v_base_group_id IN
      SELECT seen_base_group_id
        FROM unnest(v_seen_base_group_ids) AS seen(seen_base_group_id)
       ORDER BY seen_base_group_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'strap-material-confirm:' || v_base_group_id::text,
        0
      ));
    END LOOP;

    FOR v_base_group_id IN
      SELECT seen_base_group_id
        FROM unnest(v_seen_base_group_ids) AS seen(seen_base_group_id)
       ORDER BY seen_base_group_id
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'strap-width:' || v_base_group_id::text,
        0
      ));
      PERFORM 1
        FROM public.base_material_width_profiles profile
       WHERE profile.base_group_id = v_base_group_id
         AND profile.status = 'approved'
         AND profile.valid_to IS NULL
       FOR UPDATE;
    END LOOP;
  END IF;

  -- A ordenacao por UUID torna locks, versoes e auditoria deterministicos. O
  -- resultado e guardado pela posicao original e remontado nessa ordem ao final.
  FOR v_row IN
    SELECT entry.value AS material,
           entry.ordinality::integer AS ordinality,
           (entry.value ->> 'base_group_id')::uuid AS base_group_id
      FROM jsonb_array_elements(v_materials) WITH ORDINALITY AS entry(value, ordinality)
     ORDER BY (entry.value ->> 'base_group_id')::uuid, entry.ordinality
  LOOP
    v_line_payload := jsonb_build_object(
      'type', CASE WHEN v_type_id IS NULL
        THEN v_type_payload
        ELSE jsonb_build_object('id', v_type_id)
      END,
      'measure', CASE WHEN v_measure_id IS NULL
        THEN v_measure_payload
        ELSE jsonb_build_object('id', v_measure_id)
      END,
      'base_group_id', v_row.base_group_id,
      'recipe', v_row.material -> 'recipe',
      -- Restricao aditiva consumida pelo writer canonico. Nao e confiada a UI
      -- e e revalidada sob strap-recipe:(measure,base).
      'new_material_only', true
    );

    IF coalesce(p_confirm, false) THEN
      v_conversion := public.confirm_artisanal_strap_material_conversion(
        v_line_payload,
        v_reason
      );
    ELSE
      v_conversion := public.save_artisanal_strap_conversion(
        v_line_payload,
        v_reason
      );
    END IF;

    IF v_type_id IS NULL THEN
      BEGIN
        v_type_id := nullif(v_conversion ->> 'type_id', '')::uuid;
        v_measure_id := nullif(v_conversion ->> 'measure_id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Writer da conversao retornou familia ou medida invalida';
      END;
      IF v_type_id IS NULL OR v_measure_id IS NULL THEN
        RAISE EXCEPTION 'Writer da conversao nao retornou familia e medida';
      END IF;
    END IF;

    v_conversions_by_ordinal := v_conversions_by_ordinal || jsonb_build_object(
      v_row.ordinality::text,
      v_conversion
    );
  END LOOP;

  SELECT jsonb_agg(
           v_conversions_by_ordinal -> result_order.ordinality::text
           ORDER BY result_order.ordinality
         )
    INTO v_conversions
    FROM generate_series(1, v_material_count) AS result_order(ordinality);

  RETURN jsonb_build_object(
    'type_id', v_type_id,
    'measure_id', v_measure_id,
    'conversions', coalesce(v_conversions, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_artisanal_strap_material_conversions(jsonb, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_material_conversions(jsonb, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_artisanal_strap_material_conversions(jsonb, text, boolean) IS
  'Salva atomicamente de 1 a 25 conversoes de materiais-base para a mesma familia e medida de tira. Processa por base_group_id, devolve na ordem recebida e confirma/aprova apenas quando p_confirm=true; nunca aceita cor, produto ou variante de estoque.';

-- Autoteste executavel depois do deploy. As escritas positivas vivem dentro de
-- uma subtransacao encerrada pelo SQLSTATE marcador ZX001; o caso de falha usa
-- outra subtransacao e prova que nem familia, nem medida, nem a primeira
-- receita sobrevivem. A funcao nao testa concorrencia (isso exige 2 sessoes).
CREATE OR REPLACE FUNCTION public.run_artisanal_strap_material_conversions_self_test()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_base_group_1 uuid;
  v_base_group_2 uuid;
  v_base_width_1 numeric;
  v_base_width_2 numeric;
  v_actor_id uuid;
  v_positive_tag text := 'AUTOTESTE MULTI TIRA ' || gen_random_uuid()::text;
  v_rollback_tag text := 'AUTOTESTE ROLLBACK TIRA ' || gen_random_uuid()::text;
  v_result jsonb;
  v_rejected_existing boolean := false;
  v_rollback_failed boolean := false;
  v_failure_constraint text;
  v_failure_message text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Autoteste de materiais de tira exige service_role';
  END IF;

  -- Permite que o owner execute o autoteste pelo SQL Editor/MCP sem afrouxar
  -- os grants das RPCs de producao. Para chamadas REST, a claim ja e service.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT profile.id
    INTO v_actor_id
    FROM public.profiles profile
   WHERE profile.approved
   ORDER BY profile.id
   LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autoteste requer um perfil aprovado para a trilha de auditoria';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);

  SELECT profile.base_group_id, profile.usable_width_mm
    INTO v_base_group_1, v_base_width_1
    FROM public.base_material_width_profiles profile
   WHERE profile.status = 'approved'
     AND profile.valid_to IS NULL
     AND profile.usable_width_mm > 0
     AND public.strap_base_group_is_eligible(profile.base_group_id)
     AND public.resolve_base_group_usable_width_mm(profile.base_group_id) > 0
     AND abs(
       profile.usable_width_mm
       - public.resolve_base_group_usable_width_mm(profile.base_group_id)
     ) <= 0.000001
   ORDER BY profile.base_group_id
   LIMIT 1;

  SELECT profile.base_group_id, profile.usable_width_mm
    INTO v_base_group_2, v_base_width_2
    FROM public.base_material_width_profiles profile
   WHERE profile.status = 'approved'
     AND profile.valid_to IS NULL
     AND profile.usable_width_mm > 0
     AND profile.base_group_id <> v_base_group_1
     AND public.strap_base_group_is_eligible(profile.base_group_id)
     AND public.resolve_base_group_usable_width_mm(profile.base_group_id) > 0
     AND abs(
       profile.usable_width_mm
       - public.resolve_base_group_usable_width_mm(profile.base_group_id)
     ) <= 0.000001
   ORDER BY profile.base_group_id
   LIMIT 1;

  IF v_base_group_1 IS NULL OR v_base_group_2 IS NULL THEN
    RAISE EXCEPTION
      'Autoteste requer duas bases elegiveis com perfil de largura aprovado';
  END IF;

  -- Caso positivo + ordem de retorno + rejeicao de recadastro. O erro ZX001
  -- deliberado desfaz todas as fixtures deste bloco.
  BEGIN
    v_result := public.save_artisanal_strap_material_conversions(
      jsonb_build_object(
        'type', jsonb_build_object('name', v_positive_tag, 'active', true),
        'measure', jsonb_build_object(
          'display_name', v_positive_tag || ' 15 mm',
          'finished_width_mm', 15,
          'active', true
        ),
        -- Entrada inversa ao UUID: o writer processa em ordem de lock e deve
        -- reconstruir a resposta na ordem original.
        'materials', jsonb_build_array(
          jsonb_build_object(
            'base_group_id', v_base_group_2,
            'recipe', jsonb_build_object(
              'cut_band_width_mm', v_base_width_2,
              'confirmed_yield_m_per_m', 1,
              'executor_type', 'factory',
              'transformation_cost_per_m', 0
            )
          ),
          jsonb_build_object(
            'base_group_id', v_base_group_1,
            'recipe', jsonb_build_object(
              'cut_band_width_mm', v_base_width_1,
              'confirmed_yield_m_per_m', 1,
              'executor_type', 'factory',
              'transformation_cost_per_m', 0
            )
          )
        )
      ),
      'Autoteste transacional do cadastro de varios materiais',
      true
    );

    IF jsonb_array_length(v_result -> 'conversions') <> 2
       OR (v_result #>> '{conversions,0,base_group_id}')::uuid <> v_base_group_2
       OR (v_result #>> '{conversions,1,base_group_id}')::uuid <> v_base_group_1 THEN
      RAISE EXCEPTION 'Autoteste: lote positivo nao preservou a ordem de entrada';
    END IF;

    BEGIN
      PERFORM public.save_artisanal_strap_material_conversions(
        jsonb_build_object(
          -- Repete as identidades naturais, mudando 15 para 15.0. Antes de
          -- testar new_material_only, o writer precisa convergir para os UUIDs
          -- criados acima sem disputar os UNIQUEs.
          'type', jsonb_build_object('name', v_positive_tag, 'active', true),
          'measure', jsonb_build_object(
            'display_name', v_positive_tag || ' 15,0 mm',
            'finished_width_mm', 15.0,
            'active', true
          ),
          'materials', jsonb_build_array(
            jsonb_build_object(
              'base_group_id', v_base_group_1,
              'recipe', jsonb_build_object(
                'cut_band_width_mm', v_base_width_1,
                'confirmed_yield_m_per_m', 1,
                'executor_type', 'factory',
                'transformation_cost_per_m', 0
              )
            )
          )
        ),
        'Autoteste deve rejeitar material ja configurado',
        true
      );
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'Material-base ja possui receita vigente ou em elaboracao%' THEN
        v_rejected_existing := true;
      ELSE
        RAISE;
      END IF;
    END;

    IF NOT v_rejected_existing THEN
      RAISE EXCEPTION 'Autoteste: recadastro de material vigente foi aceito';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE = 'ZX001',
      MESSAGE = 'rollback deliberado do lote positivo';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF SQLERRM <> 'rollback deliberado do lote positivo' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_types strap_type
     WHERE strap_type.name_norm = public.normalize_strap_catalog_text(v_positive_tag)
  ) THEN
    RAISE EXCEPTION 'Autoteste: fixtures do lote positivo nao foram desfeitas';
  END IF;

  -- A primeira base (UUID menor) e valida. A segunda viola deliberadamente o
  -- yield, portanto o check abaixo so passa se a primeira escrita tambem tiver
  -- sido revertida pela atomicidade da RPC.
  BEGIN
    PERFORM public.save_artisanal_strap_material_conversions(
      jsonb_build_object(
        'type', jsonb_build_object('name', v_rollback_tag, 'active', true),
        'measure', jsonb_build_object(
          'display_name', v_rollback_tag || ' 15 mm',
          'finished_width_mm', 15,
          'active', true
        ),
        'materials', jsonb_build_array(
          jsonb_build_object(
            'base_group_id', v_base_group_1,
            'recipe', jsonb_build_object(
              'cut_band_width_mm', v_base_width_1,
              'confirmed_yield_m_per_m', 1,
              'executor_type', 'factory',
              'transformation_cost_per_m', 0
            )
          ),
          jsonb_build_object(
            'base_group_id', v_base_group_2,
            'recipe', jsonb_build_object(
              'cut_band_width_mm', v_base_width_2,
              'confirmed_yield_m_per_m', 999999999,
              'executor_type', 'factory',
              'transformation_cost_per_m', 0
            )
          )
        )
      ),
      'Autoteste de rollback integral do cadastro de materiais',
      true
    );
  EXCEPTION WHEN OTHERS THEN
    v_rollback_failed := true;
    GET STACKED DIAGNOSTICS
      v_failure_constraint = CONSTRAINT_NAME,
      v_failure_message = MESSAGE_TEXT;
  END;

  IF NOT v_rollback_failed
     OR v_failure_constraint IS DISTINCT FROM 'artisanal_strap_recipes_yield_ck' THEN
    RAISE EXCEPTION
      'Autoteste: segunda linha nao falhou no check de rendimento (constraint=%, erro=%)',
      v_failure_constraint,
      v_failure_message;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_types strap_type
     WHERE strap_type.name_norm = public.normalize_strap_catalog_text(v_rollback_tag)
  ) THEN
    RAISE EXCEPTION 'Autoteste: rollback integral deixou familia residual';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.save_artisanal_strap_material_conversions(jsonb,text,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.save_artisanal_strap_material_conversions(jsonb,text,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.save_artisanal_strap_material_conversions(jsonb,text,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Autoteste: ACL do writer plural diverge do contrato';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'positive_confirmed_batch', true,
    'input_order_preserved', true,
    'existing_material_rejected', true,
    'second_line_failure_rolled_back_all', true,
    'acl', 'anon=deny; authenticated=allow; service_role=allow',
    'residual_rows', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_artisanal_strap_material_conversions_self_test()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_artisanal_strap_material_conversions_self_test()
  TO service_role;

COMMENT ON FUNCTION public.run_artisanal_strap_material_conversions_self_test() IS
  'Autoteste service_role-only, sem residuos, do lote multi-material: sucesso, ordem, new_material_only, rollback integral e ACL. Concorrencia exige duas sessoes externas.';

-- O deploy nao deve apenas compilar o helper: o contrato transacional roda na
-- propria migration e qualquer regressao aborta antes do reload do PostgREST.
DO $$
DECLARE
  v_self_test jsonb;
BEGIN
  v_self_test := public.run_artisanal_strap_material_conversions_self_test();
  IF coalesce((v_self_test ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Autoteste do cadastro multi-material falhou: %', v_self_test;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
