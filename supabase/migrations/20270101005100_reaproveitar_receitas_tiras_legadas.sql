-- Reaproveita uma receita do sistema anterior sem reescrever seu historico.
--
-- O fluxo inteiro e atomico: completa/aprova a largura da napa, cria e aprova
-- a conversao canonica e, somente ao final, congela o vinculo legado ->
-- canonico pelo resolver imutavel ja existente.

CREATE OR REPLACE FUNCTION public.reuse_legacy_artisanal_strap_recipe(
  p_legacy_recipe_id uuid,
  p_payload jsonb,
  p_usable_width_mm numeric,
  p_editable_width_profile_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := public.require_strap_change_reason(
    p_reason,
    'Reaproveitamento de receita anterior de tira'
  );
  v_payload jsonb := p_payload;
  v_base_group_id uuid;
  v_width_profile_id uuid;
  v_conversion jsonb;
  v_resolution jsonb;
  v_recipe_id uuid;
  v_existing_canonical_recipe_id uuid;
BEGIN
  -- A acao publica termina com uma receita vigente e com o mapa imutavel.
  -- Portanto exige, antes da primeira escrita, os tres gates envolvidos.
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  IF p_legacy_recipe_id IS NULL THEN
    RAISE EXCEPTION 'Selecione a receita anterior que sera reaproveitada';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Dados da conversao reaproveitada invalidos';
  END IF;
  IF nullif(v_payload #>> '{recipe,id}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Reaproveitar receita anterior sempre cria uma nova versao canonica';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-reuse-legacy-recipe:' || p_legacy_recipe_id::text,
    0
  ));

  PERFORM 1
    FROM public.artisanal_recipes recipe
   WHERE recipe.id = p_legacy_recipe_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receita anterior inexistente';
  END IF;

  SELECT mapping.canonical_recipe_id
    INTO v_existing_canonical_recipe_id
    FROM public.legacy_artisanal_recipe_map mapping
   WHERE mapping.legacy_recipe_id = p_legacy_recipe_id
   FOR UPDATE;
  IF v_existing_canonical_recipe_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta receita anterior ja foi reaproveitada na conversao %',
      v_existing_canonical_recipe_id
      USING ERRCODE = '55000',
        DETAIL = jsonb_build_object(
          'code', 'legacy_recipe_already_reused',
          'legacy_recipe_id', p_legacy_recipe_id,
          'canonical_recipe_id', v_existing_canonical_recipe_id
        )::text;
  END IF;

  BEGIN
    v_base_group_id := nullif(v_payload ->> 'base_group_id', '')::uuid;
    v_width_profile_id := nullif(
      v_payload #>> '{recipe,base_width_profile_id}',
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Napa-base ou perfil de largura invalido';
  END;

  IF v_base_group_id IS NULL THEN
    RAISE EXCEPTION 'Selecione a napa-base da conversao';
  END IF;

  IF v_width_profile_id IS NULL THEN
    IF p_usable_width_mm IS NULL OR p_usable_width_mm <= 0 THEN
      RAISE EXCEPTION 'Informe a largura util da napa-base para reaproveitar a receita';
    END IF;

    v_width_profile_id := public.save_base_material_width_profile(
      v_base_group_id,
      p_usable_width_mm,
      p_editable_width_profile_id,
      NULL,
      v_reason
    );
    PERFORM public.approve_base_material_width_profile(v_width_profile_id, v_reason);

    v_payload := jsonb_set(
      v_payload,
      '{recipe,base_width_profile_id}',
      to_jsonb(v_width_profile_id::text),
      true
    );
  ELSIF NOT EXISTS (
    SELECT 1
      FROM public.base_material_width_profiles profile
     WHERE profile.id = v_width_profile_id
       AND profile.base_group_id = v_base_group_id
       AND profile.status = 'approved'
       AND profile.valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'O perfil de largura informado nao esta aprovado e vigente para a napa-base';
  END IF;

  v_conversion := public.save_artisanal_strap_conversion(v_payload, v_reason);
  v_recipe_id := nullif(v_conversion ->> 'recipe_id', '')::uuid;
  IF v_recipe_id IS NULL THEN
    RAISE EXCEPTION 'A conversao canonica nao retornou uma receita';
  END IF;

  PERFORM public.submit_artisanal_strap_recipe(v_recipe_id, v_reason);
  PERFORM public.approve_artisanal_strap_recipe(v_recipe_id, v_reason, now());

  v_resolution := public.resolve_legacy_artisanal_recipe_migration(
    p_legacy_recipe_id,
    v_recipe_id,
    v_reason
  );

  RETURN jsonb_build_object(
    'legacy_recipe_id', p_legacy_recipe_id,
    'recipe_id', v_recipe_id,
    'width_profile_id', v_width_profile_id,
    'conversion', v_conversion,
    'resolution', v_resolution,
    'activated', true
  );
END;
$$;

COMMENT ON FUNCTION public.reuse_legacy_artisanal_strap_recipe(uuid,jsonb,numeric,uuid,text) IS
  'Completa dados tecnicos, cria/aprova uma conversao canonica e congela o vinculo de uma receita anterior, tudo na mesma transacao.';

REVOKE ALL ON FUNCTION public.reuse_legacy_artisanal_strap_recipe(uuid,jsonb,numeric,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reuse_legacy_artisanal_strap_recipe(uuid,jsonb,numeric,uuid,text)
  TO authenticated, service_role;
