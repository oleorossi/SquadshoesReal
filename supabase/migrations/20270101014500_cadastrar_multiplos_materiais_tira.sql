-- Cadastro atomico de varios materiais possiveis para uma mesma tira.
--
-- Familia e medida sao compartilhadas pelo lote. Cada material continua usando
-- o writer canonico singular, preservando versionamento, largura fisica,
-- aprovacao e auditoria sem criar cor, produto ou variante de estoque.

BEGIN;

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
  v_measure_lock_identity text;
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
    IF v_base_group_id = ANY (v_seen_base_group_ids) THEN
      RAISE EXCEPTION 'Material-base repetido no lote: %', v_base_group_id;
    END IF;
    v_seen_base_group_ids := array_append(v_seen_base_group_ids, v_base_group_id);
  END LOOP;

  -- Adquire todos os advisory locks antes de qualquer writer tocar familia,
  -- medida ou receita. A ordem e a mesma usada abaixo e impede o ciclo
  -- "lote segura a medida / chamada singular segura a proxima base".
  v_measure_lock_identity := coalesce(
    nullif(v_measure_payload ->> 'id', ''),
    nullif(v_measure_payload ->> 'display_name', ''),
    ''
  );
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
  END IF;
  FOR v_base_group_id IN
    SELECT seen_base_group_id
      FROM unnest(v_seen_base_group_ids) AS seen(seen_base_group_id)
     ORDER BY seen_base_group_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-conversion:' || v_measure_lock_identity || ':' || v_base_group_id::text,
      0
    ));
  END LOOP;

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
      'recipe', v_row.material -> 'recipe'
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

COMMIT;
