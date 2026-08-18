-- Expõe, em modo somente leitura, as conversões cadastradas antes do catálogo
-- canônico de tiras. Esses registros NÃO ganham identidade canônica por nome:
-- família, medida e napa-base continuam exigindo resolução explícita.

CREATE OR REPLACE FUNCTION public.list_legacy_artisanal_strap_recipe_history()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_financial boolean;
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  v_can_financial := public.can_see_strap_financial_values();

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', recipe.id,
      'name', recipe.name,
      'artisanal_product_name', recipe.artisanal_product_name,
      'base_product_name', recipe.base_product_name,
      'yield_per_meter', recipe.yield_per_meter,
      'labor_cost_per_meter', CASE
        WHEN v_can_financial THEN recipe.labor_cost_per_meter
        ELSE NULL
      END,
      'base_time_minutes', recipe.base_time_minutes,
      'cut_width_mm', recipe.cut_width_mm,
      'default_contractor_id', recipe.default_contractor_id,
      'notes', recipe.notes,
      'active', recipe.active,
      'created_at', recipe.created_at,
      'updated_at', recipe.updated_at,
      'migration_status', coalesce(mapping.status, 'review_required'),
      'canonical_recipe_id', mapping.canonical_recipe_id,
      'migration_reason', mapping.resolution_reason
    )
    ORDER BY recipe.updated_at DESC, recipe.name, recipe.id
  ), '[]'::jsonb)
    INTO v_result
    FROM public.artisanal_recipes recipe
    LEFT JOIN public.legacy_artisanal_recipe_map mapping
      ON mapping.legacy_recipe_id = recipe.id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.list_legacy_artisanal_strap_recipe_history()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_legacy_artisanal_strap_recipe_history()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_legacy_artisanal_strap_recipe_history() IS
  'Lista o histórico somente leitura de artisanal_recipes, sem inferir identidade canônica por nome e mascarando valores financeiros por RBAC.';
