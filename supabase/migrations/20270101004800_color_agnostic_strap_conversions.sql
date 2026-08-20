-- Conversao tecnica de tiras e independente de cor.
--
-- A receita ja e modelada por medida + napa-base + versao. Esta RPC apenas
-- oferece um writer atomico para o fluxo de engenharia, sem criar produto ou
-- variante de estoque e sem aceitar qualquer identificador de cor.

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
  v_base_group_id uuid;
  v_recipe_id uuid;
  v_requested_recipe_id uuid;
  v_width_profile_id uuid;
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
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'UUID invalido no payload da conversao de tira';
  END;

  IF v_base_group_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.product_groups g WHERE g.id = v_base_group_id
     ) THEN
    RAISE EXCEPTION 'Napa-base da conversao inexistente';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-conversion:'
      || coalesce(v_measure_payload ->> 'id', v_measure_payload ->> 'display_name', '')
      || ':' || v_base_group_id::text,
    0
  ));
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF nullif(v_type_payload ->> 'id', '') IS NOT NULL THEN
    BEGIN
      v_type_id := (v_type_payload ->> 'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Familia da conversao invalida';
    END;
    SELECT * INTO v_type
      FROM public.artisanal_strap_types
     WHERE id = v_type_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Familia da conversao inexistente';
    END IF;
    IF v_type_payload ? 'name' OR v_type_payload ? 'active' THEN
      v_type_id := public.save_artisanal_strap_type(
        coalesce(nullif(v_type_payload ->> 'name', ''), v_type.name),
        v_type.id,
        CASE WHEN v_type_payload ? 'active'
          THEN (v_type_payload ->> 'active')::boolean ELSE v_type.active END,
        v_reason
      );
    END IF;
  ELSE
    v_type_id := public.save_artisanal_strap_type(
      nullif(btrim(v_type_payload ->> 'name'), ''),
      NULL,
      coalesce((v_type_payload ->> 'active')::boolean, true),
      v_reason
    );
  END IF;

  IF nullif(v_measure_payload ->> 'id', '') IS NOT NULL THEN
    BEGIN
      v_measure_id := (v_measure_payload ->> 'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Medida da conversao invalida';
    END;
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
    END IF;
  ELSE
    v_measure_id := public.save_artisanal_strap_measure(
      v_type_id,
      nullif(btrim(v_measure_payload ->> 'display_name'), ''),
      (v_measure_payload ->> 'finished_width_mm')::numeric,
      NULL,
      coalesce((v_measure_payload ->> 'active')::boolean, true),
      v_reason
    );
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

COMMENT ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text) IS
  'Salva familia, medida e receita de conversao em uma transacao. A identidade e medida+napa-base; cor pertence apenas as variantes/produtos de estoque.';

REVOKE ALL ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_conversion(jsonb, text)
  TO authenticated, service_role;
