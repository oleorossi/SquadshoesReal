-- =============================================================================
-- Cadastro simples de rendimento: tipo de tira + material-base, sem cor
-- =============================================================================
-- A geometria da napa vem do cadastro fisico do estoque. O operador confirma
-- somente a banda e o rendimento; a combinacao fica imediatamente aprovada
-- para todas as cores, sem criar produto acabado ou variante de estoque.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_artisanal_strap_material_conversion(
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_recipe_payload jsonb := coalesce(v_payload -> 'recipe', '{}'::jsonb);
  v_base_group_id uuid;
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_stock_width_mm numeric;
  v_result jsonb;
  v_recipe_id uuid;
  v_recipe_status text;
  v_reason text := public.require_strap_change_reason(
    p_reason,
    'Rendimento confirmado no cadastro de tiras'
  );
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');

  IF jsonb_typeof(v_payload) <> 'object'
     OR jsonb_typeof(v_recipe_payload) <> 'object' THEN
    RAISE EXCEPTION 'Cadastro de rendimento invalido';
  END IF;

  -- Este writer confirma somente a conversao compartilhada. Cor, produto e
  -- variante continuam pertencendo ao primeiro pedido que realmente os usar.
  IF v_payload ? 'variant'
     OR v_payload ? 'product'
     OR v_payload ? 'color_id'
     OR v_recipe_payload ? 'color_id'
     OR v_recipe_payload ? 'color' THEN
    RAISE EXCEPTION 'Rendimento de tira nao aceita cor, produto ou variante de estoque';
  END IF;

  BEGIN
    v_base_group_id := nullif(v_payload ->> 'base_group_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Material-base invalido';
  END;
  IF v_base_group_id IS NULL THEN
    RAISE EXCEPTION 'Selecione o material-base da tira';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-material-confirm:' || v_base_group_id::text, 0
  ));

  -- A largura nao e digitada neste fluxo: ela precisa existir e ser unica nos
  -- SKUs lineares ativos da familia. Se o perfil antigo divergir do estoque,
  -- a confirmacao para, em vez de congelar uma geometria obsoleta.
  v_stock_width_mm := public.resolve_base_group_usable_width_mm(v_base_group_id);
  IF v_stock_width_mm IS NULL OR v_stock_width_mm <= 0 THEN
    RAISE EXCEPTION
      'O material nao possui uma largura fisica unica no estoque; corrija as Dimensoes da Ficha de Componente antes de confirmar o rendimento';
  END IF;

  SELECT * INTO v_profile
    FROM public.base_material_width_profiles profile
   WHERE profile.base_group_id = v_base_group_id
     AND profile.status = 'approved'
     AND profile.valid_to IS NULL
   FOR UPDATE;

  IF v_profile.id IS NOT NULL
     AND abs(v_profile.usable_width_mm - v_stock_width_mm) > 0.000001 THEN
    RAISE EXCEPTION
      'A largura aprovada da tira (%) difere da largura fisica atual do estoque (%); revise o cadastro antes de confirmar',
      v_profile.usable_width_mm, v_stock_width_mm;
  END IF;

  IF v_profile.id IS NULL THEN
    v_profile := public.ensure_base_material_width_profile(
      v_base_group_id,
      auth.uid(),
      v_reason
    );
  END IF;

  v_payload := jsonb_set(
    v_payload,
    '{recipe}',
    v_recipe_payload || jsonb_build_object('base_width_profile_id', v_profile.id),
    true
  );

  v_result := public.save_artisanal_strap_conversion(v_payload, v_reason);
  v_recipe_id := nullif(v_result ->> 'recipe_id', '')::uuid;
  IF v_recipe_id IS NULL THEN
    RAISE EXCEPTION 'A conversao foi salva sem identificar a receita';
  END IF;

  SELECT recipe.status INTO v_recipe_status
    FROM public.artisanal_strap_recipes recipe
   WHERE recipe.id = v_recipe_id
   FOR UPDATE;

  IF v_recipe_status = 'draft' THEN
    PERFORM public.submit_artisanal_strap_recipe(v_recipe_id, v_reason);
    v_recipe_status := 'pending_approval';
  END IF;
  IF v_recipe_status = 'pending_approval' THEN
    PERFORM public.approve_artisanal_strap_recipe(v_recipe_id, v_reason, now());
    v_recipe_status := 'approved';
  END IF;
  IF v_recipe_status <> 'approved' THEN
    RAISE EXCEPTION 'A receita nao ficou aprovada apos a confirmacao';
  END IF;

  RETURN v_result || jsonb_build_object(
    'status', 'approved',
    'usable_width_mm', v_profile.usable_width_mm,
    'color_scope', 'all'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_artisanal_strap_material_conversion(jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_artisanal_strap_material_conversion(jsonb, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.confirm_artisanal_strap_material_conversion(jsonb, text) IS
  'Confirma e aprova atomicamente o rendimento de um tipo de tira por material-base, usando a largura fisica unica do estoque. Nao recebe cor e nao cria produto/variante.';

COMMIT;
