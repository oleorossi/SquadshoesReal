-- Inventario de higiene do setor de tiras + redes de seguranca.
--
-- Fase 0: o diagnostico passa a listar cadastros que o dono precisa confirmar
-- (grupo de tira acabada sem flag, ficha de componente copiada de napa,
-- largura invertida no produto linear, linha comprada pronta sem variante,
-- receita interna ausente, SKU da napa-base sem a cor da ficha).
--
-- Fase 1: checkbox `is_artisanal_strap` (UI) + triggers que
--   (a) recusam ficha de componente com largura de napa (>= 200 mm) em grupo
--       ja marcado como tira acabada;
--   (b) recusam marcar o grupo enquanto essas fichas existirem;
--   (c) desligam auto_component_sheet no grupo marcado.
--
-- Esta migration NAO marca grupo, NAO apaga ficha, NAO espelha 1370 mm, NAO
-- inventa rendimento/SKU/preco e NAO reescreve PV. A sugestao de grupo
-- inelegivel por prefixo de tipo e SOMENTE diagnostico: nunca entra em
-- strap_base_group_is_eligible. Identidade operacional continua por UUID.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers de higiene (diagnostico + triggers). Nunca usados na elegibilidade.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.try_parse_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.strap_hygiene_dimension_mm(p_value numeric, p_unit text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(nullif(btrim(p_unit), ''), 'mm'))
    WHEN 'mm' THEN nullif(p_value, 0)
    WHEN 'cm' THEN nullif(p_value, 0) * 10
    WHEN 'm'  THEN nullif(p_value, 0) * 1000
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.strap_hygiene_dimension_mm(numeric, text) IS
  'Converte dimensao cadastrada para mm. Nao usa GREATEST: largura e largura.';

-- Grupo-folha, ainda sem a flag, que o inventario sugere como tira ACABADA.
-- Evidencia por UUID (identity_group_id / variante comprada pronta) OU prefixo
-- de tipo canonico ativo (so sugestao). NUNCA chamar de
-- strap_base_group_is_eligible.
CREATE OR REPLACE FUNCTION public.strap_finished_group_is_hygiene_candidate(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.product_groups g
     WHERE g.id = p_group_id
       AND coalesce(g.is_family, false) = false
       AND coalesce(g.is_artisanal_strap, false) = false
       AND (
         EXISTS (
           SELECT 1
             FROM public.artisanal_strap_types t
            WHERE t.active
              AND public.normalize_strap_catalog_text(g.name) LIKE t.name_norm || '%'
         )
         OR EXISTS (
           SELECT 1
             FROM public.technical_sheets ts
             CROSS JOIN LATERAL jsonb_array_elements(ts.strap_colors) AS line(value)
            WHERE jsonb_typeof(ts.strap_colors) = 'array'
              AND coalesce(line.value->>'identity_basis', '') = 'finished_product_group'
              AND public.try_parse_uuid(line.value->>'identity_group_id') = g.id
         )
         OR EXISTS (
           SELECT 1
             FROM public.artisanal_strap_variants v
             LEFT JOIN public.products fp ON fp.id = v.finished_product_id
            WHERE v.identity_basis = 'finished_product_group'
              AND (v.base_group_id = g.id OR fp.group_id = g.id)
         )
       )
  );
$$;

COMMENT ON FUNCTION public.strap_finished_group_is_hygiene_candidate(uuid) IS
  'Sugestao de higiene para grupo de tira acabada ainda sem flag. Nunca participa da elegibilidade de napa-base.';

-- ---------------------------------------------------------------------------
-- Triggers: recusar ficha de napa em grupo de tira; desligar auto-BOM.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_reject_napa_like_sheet_on_strap_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_width_mm numeric;
BEGIN
  SELECT coalesce(g.is_artisanal_strap, false)
    INTO v_flag
    FROM public.products p
    LEFT JOIN public.product_groups g ON g.id = p.group_id
   WHERE p.id = NEW.product_id;

  IF NOT coalesce(v_flag, false) THEN
    RETURN NEW;
  END IF;

  v_width_mm := public.strap_hygiene_dimension_mm(NEW.dimensions_width, NEW.dimensions_unit);
  IF v_width_mm IS NOT NULL AND v_width_mm >= 200 THEN
    RAISE EXCEPTION
      'Ficha de componente com largura de napa (% mm) nao pode ficar em grupo de tira acabada. Apague a ficha ou cadastre a largura final da tira (< 200 mm).',
      v_width_mm;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_napa_like_sheet_on_strap_group ON public.component_sheets;
CREATE TRIGGER trg_reject_napa_like_sheet_on_strap_group
  BEFORE INSERT OR UPDATE OF product_id, dimensions_width, dimensions_unit
  ON public.component_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_napa_like_sheet_on_strap_group();

CREATE OR REPLACE FUNCTION public.tg_guard_artisanal_strap_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bad uuid;
BEGIN
  IF coalesce(NEW.is_artisanal_strap, false) THEN
    NEW.auto_component_sheet := false;

    IF TG_OP = 'INSERT'
       OR NEW.is_artisanal_strap IS DISTINCT FROM coalesce(OLD.is_artisanal_strap, false)
    THEN
      SELECT cs.id
        INTO v_bad
        FROM public.products p
        JOIN public.component_sheets cs ON cs.product_id = p.id
       WHERE p.group_id = NEW.id
         AND public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) >= 200
       LIMIT 1;
      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION
          'Grupo de tira acabada nao pode herdar ficha de componente com largura de napa (>= 200 mm). Apague ou corrija as fichas primeiro.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_artisanal_strap_group ON public.product_groups;
CREATE TRIGGER trg_guard_artisanal_strap_group
  BEFORE INSERT OR UPDATE OF is_artisanal_strap, auto_component_sheet
  ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_artisanal_strap_group();

-- ---------------------------------------------------------------------------
-- Diagnostico: corpo da 04400 + codigos de higiene. Sem UPDATE de PV/grupo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.artisanal_strap_catalog_diagnostics()
RETURNS TABLE(issue_code text,entity_id uuid,details jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role()<>'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
  SELECT 'variant_product_status_divergence'::text,v.id,
    jsonb_build_object('variant_status',v.status,'product_id',p.id,'product_active',p.active)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE p.active IS DISTINCT FROM (v.status='active')
  UNION ALL
  SELECT 'purchase_enabled_invalid_commercial_data',v.id,
    jsonb_build_object('finished_product_id',p.id,'has_purchase_price',p.purchase_price>0,
      'has_purchase_unit',nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NOT NULL,
      'conversion_valid',p.conversion_rate>0 AND (p.purchase_unit<>p.unit OR p.conversion_rate=1),
      'moq_valid',p.min_order_quantity>0,'multiple_valid',p.purchase_multiple>0,
      'preparation_days_valid',p.material_preparation_days>=0,
      'supplier_missing_allowed_only_as_provisional_po',p.supplier_id IS NULL)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE v.purchase_enabled AND (p.purchase_price IS NULL OR p.purchase_price<=0
    OR nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NULL OR p.conversion_rate IS NULL
    OR p.conversion_rate<=0 OR (p.purchase_unit=p.unit AND p.conversion_rate<>1)
    OR p.min_order_quantity IS NULL OR p.min_order_quantity<=0
    OR p.purchase_multiple IS NULL OR p.purchase_multiple<=0 OR p.material_preparation_days<0)
  UNION ALL
  SELECT 'active_internal_variant_without_current_recipe',v.id,
    jsonb_build_object('measure_id',v.measure_id,'base_group_id',v.base_group_id)
  FROM public.artisanal_strap_variants v
  WHERE v.status='active' AND v.min_stock_replenishment_mode='internal'
    AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_recipes r
      WHERE r.measure_id=v.measure_id AND r.base_group_id=v.base_group_id
        AND r.status='approved' AND r.valid_from<=now()
        AND (r.valid_to IS NULL OR r.valid_to>now()))
  UNION ALL
  SELECT 'official_base_width_divergence',op.id,
    jsonb_build_object('base_group_id',op.base_group_id,'color_id',op.color_id,
      'official_product_id',op.official_product_id,
      'product_width_mm',public.strap_material_product_width_mm(op.official_product_id),
      'profile_width_mm',wp.usable_width_mm)
  FROM public.base_material_color_official_products op
  JOIN public.base_material_width_profiles wp ON wp.base_group_id=op.base_group_id
    AND wp.status='approved' AND wp.valid_to IS NULL
  WHERE op.status='active' AND (public.strap_material_product_width_mm(op.official_product_id) IS NULL
    OR abs(public.strap_material_product_width_mm(op.official_product_id)-wp.usable_width_mm)>0.000001)
  UNION ALL
  SELECT 'legacy_technical_line_review_required',m.id,
    jsonb_build_object('technical_sheet_id',m.technical_sheet_id,
      'technical_strap_line_id',m.technical_strap_line_id,'legacy_path',m.legacy_path,
      'legacy_ordinal',m.legacy_ordinal)
  FROM public.technical_strap_line_identity_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'legacy_recipe_map_review_required',m.legacy_recipe_id,
    jsonb_build_object('legacy_recipe_id',m.legacy_recipe_id,
      'resolution_reason',m.resolution_reason,
      'candidates',coalesce((SELECT ri.candidates
        FROM public.artisanal_strap_migration_review_items ri
        WHERE ri.status='review_required' AND ri.legacy_id=m.legacy_recipe_id::text
        ORDER BY ri.created_at DESC LIMIT 1),'[]'::jsonb))
  FROM public.legacy_artisanal_recipe_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'migration_review_item_required',
    CASE
      WHEN ri.entity_type='buy_ready_strap_product' AND projection.data IS NOT NULL
        THEN v.id
      ELSE ri.id
    END,
    jsonb_build_object(
      'review_id',ri.id,
      'entity_type',ri.entity_type,
      'legacy_id',ri.legacy_id,
      'candidates',ri.candidates,
      'reason',ri.reason
    ) || CASE WHEN ri.entity_type='buy_ready_strap_product' THEN jsonb_build_object(
      'variant_id',v.id,
      'action_required',CASE
        WHEN projection.data IS NOT NULL THEN 'review_existing_variant'
        WHEN v.id IS NULL THEN 'create_variant_with_bundle'
        ELSE 'clear_operational_blockers_before_review'
      END,
      'resolution_operation','save_artisanal_strap_catalog_bundle',
      'manual_creation_requires_explicit_type_and_measure',v.id IS NULL,
      'required_finished_product_id',ri.candidates->'product_id',
      'required_identity_group_id',ri.candidates->'product_group_id',
      'administrative_projection',projection.data
    ) ELSE '{}'::jsonb END
  FROM public.artisanal_strap_migration_review_items ri
  LEFT JOIN public.artisanal_strap_variants v
    ON ri.entity_type='buy_ready_strap_product'
   AND (
     ri.candidates->>'variant_id'=v.id::text
     OR (
       nullif(ri.candidates->>'variant_id','') IS NULL
       AND ri.legacy_id=v.finished_product_id::text
     )
   )
  LEFT JOIN LATERAL (
    SELECT public.buy_ready_strap_review_projection(v.id) AS data
  ) projection ON v.id IS NOT NULL
  WHERE ri.status='review_required'
  UNION ALL
  SELECT 'finished_strap_group_unflagged', g.id,
    jsonb_build_object(
      'group_id', g.id,
      'group_name', g.name,
      'linear_sku_count', (
        SELECT count(*)::int
          FROM public.products p
         WHERE p.group_id = g.id AND p.active AND p.unit = 'm'
      ),
      'suggested_by_type_name_prefix', EXISTS (
        SELECT 1 FROM public.artisanal_strap_types t
         WHERE t.active
           AND public.normalize_strap_catalog_text(g.name) LIKE t.name_norm || '%'
      ),
      'suggested_by_identity_group', EXISTS (
        SELECT 1
          FROM public.technical_sheets ts
          CROSS JOIN LATERAL jsonb_array_elements(ts.strap_colors) AS line(value)
         WHERE jsonb_typeof(ts.strap_colors) = 'array'
           AND coalesce(line.value->>'identity_basis', '') = 'finished_product_group'
           AND public.try_parse_uuid(line.value->>'identity_group_id') = g.id
      ),
      'suggested_by_variant', EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants v
          LEFT JOIN public.products fp ON fp.id = v.finished_product_id
         WHERE v.identity_basis = 'finished_product_group'
           AND (v.base_group_id = g.id OR fp.group_id = g.id)
      ),
      'eligible_as_napa_base', public.strap_base_group_is_eligible(g.id)
    )
  FROM public.product_groups g
  WHERE public.strap_finished_group_is_hygiene_candidate(g.id)
  UNION ALL
  SELECT 'strap_component_sheet_looks_like_napa', g.id,
    jsonb_build_object(
      'group_id', g.id,
      'group_name', g.name,
      'is_flagged', coalesce(g.is_artisanal_strap, false),
      'sheet_count', count(*)::int,
      'widths_mm', jsonb_agg(DISTINCT public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit))
    )
  FROM public.product_groups g
  JOIN public.products p ON p.group_id = g.id
  JOIN public.component_sheets cs ON cs.product_id = p.id
  WHERE (
      coalesce(g.is_artisanal_strap, false)
      OR public.strap_finished_group_is_hygiene_candidate(g.id)
    )
    AND public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) >= 200
  GROUP BY g.id, g.name, g.is_artisanal_strap
  UNION ALL
  SELECT 'napa_width_inverted', g.id,
    jsonb_build_object(
      'group_id', g.id,
      'group_name', g.name,
      'product_count', count(*)::int,
      'product_widths_mm', jsonb_agg(DISTINCT public.strap_hygiene_dimension_mm(p.dimensions_width, p.dimensions_unit)),
      'sheet_widths_mm', jsonb_agg(DISTINCT public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit))
    )
  FROM public.products p
  JOIN public.product_groups g ON g.id = p.group_id
  JOIN public.component_sheets cs ON cs.product_id = p.id
  WHERE p.active
    AND p.unit = 'm'
    AND coalesce(g.is_family, false) = false
    AND coalesce(g.is_artisanal_strap, false) = false
    AND NOT public.strap_finished_group_is_hygiene_candidate(g.id)
    AND coalesce(g.sector, '') NOT IN ('Palmilha', 'Forração da Palmilha')
    AND public.strap_hygiene_dimension_mm(p.dimensions_width, p.dimensions_unit) IS NOT NULL
    AND public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) IS NOT NULL
    AND abs(
      public.strap_hygiene_dimension_mm(p.dimensions_width, p.dimensions_unit)
      - public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit)
    ) > 1
  GROUP BY g.id, g.name
  UNION ALL
  SELECT 'buy_ready_line_without_variant',
    public.try_parse_uuid(line.value->>'technical_strap_line_id'),
    jsonb_build_object(
      'technical_sheet_id', ts.id,
      'identity_group_id', public.try_parse_uuid(line.value->>'identity_group_id'),
      'identity_group_name', ig.name,
      'measure_id', public.try_parse_uuid(line.value->>'measure_id'),
      'color_id', public.try_parse_uuid(line.value->>'color_id')
    )
  FROM public.technical_sheets ts
  CROSS JOIN LATERAL jsonb_array_elements(ts.strap_colors) AS line(value)
  LEFT JOIN public.product_groups ig
    ON ig.id = public.try_parse_uuid(line.value->>'identity_group_id')
  WHERE jsonb_typeof(ts.strap_colors) = 'array'
    AND coalesce(line.value->>'identity_basis', '') = 'finished_product_group'
    AND public.try_parse_uuid(line.value->>'technical_strap_line_id') IS NOT NULL
    AND public.try_parse_uuid(line.value->>'identity_group_id') IS NOT NULL
    AND public.try_parse_uuid(line.value->>'measure_id') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.artisanal_strap_variants v
       WHERE v.identity_basis = 'finished_product_group'
         AND v.base_group_id = public.try_parse_uuid(line.value->>'identity_group_id')
         AND v.measure_id = public.try_parse_uuid(line.value->>'measure_id')
         AND (
           public.try_parse_uuid(line.value->>'color_id') IS NULL
           OR v.color_id = public.try_parse_uuid(line.value->>'color_id')
         )
    )
  UNION ALL
  SELECT 'internal_recipe_missing',
    (md5(concat_ws('|', needed.measure_id::text, needed.base_group_id::text)))::uuid,
    jsonb_build_object(
      'measure_id', needed.measure_id,
      'measure_name', needed.measure_name,
      'base_group_id', needed.base_group_id,
      'base_group_name', needed.base_group_name,
      'technical_sheet_ids', needed.sheet_ids
    )
  FROM (
    SELECT public.try_parse_uuid(line.value->>'measure_id') AS measure_id,
           m.display_name AS measure_name,
           ts.strap_base_group_id AS base_group_id,
           g.name AS base_group_name,
           jsonb_agg(DISTINCT ts.id) AS sheet_ids
      FROM public.technical_sheets ts
      JOIN public.product_groups g ON g.id = ts.strap_base_group_id
      CROSS JOIN LATERAL jsonb_array_elements(ts.strap_colors) AS line(value)
      LEFT JOIN public.artisanal_strap_measures m
        ON m.id = public.try_parse_uuid(line.value->>'measure_id')
     WHERE jsonb_typeof(ts.strap_colors) = 'array'
       AND ts.strap_base_group_id IS NOT NULL
       AND coalesce(line.value->>'identity_basis', 'reference_base') = 'reference_base'
       AND public.try_parse_uuid(line.value->>'measure_id') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_recipes r
          WHERE r.measure_id = public.try_parse_uuid(line.value->>'measure_id')
            AND r.base_group_id = ts.strap_base_group_id
            AND r.status = 'approved'
            AND r.valid_from <= now()
            AND (r.valid_to IS NULL OR r.valid_to > now())
       )
     GROUP BY public.try_parse_uuid(line.value->>'measure_id'), m.display_name,
              ts.strap_base_group_id, g.name
  ) needed
  UNION ALL
  SELECT 'missing_base_color_sku',
    (md5(concat_ws('|', needed.base_group_id::text, needed.color_id::text)))::uuid,
    jsonb_build_object(
      'base_group_id', needed.base_group_id,
      'base_group_name', needed.base_group_name,
      'color_id', needed.color_id,
      'color_name', needed.color_name,
      'technical_sheet_ids', needed.sheet_ids
    )
  FROM (
    SELECT g.id AS base_group_id,
           g.name AS base_group_name,
           c.id AS color_id,
           c.name AS color_name,
           jsonb_agg(DISTINCT ts.id) AS sheet_ids
      FROM public.technical_sheets ts
      JOIN public.product_groups g ON g.id = ts.strap_base_group_id
      JOIN public.products up
        ON up.group_id = ts.upper_material_group_id
       AND up.active
      JOIN public.canonical_colors c
        ON c.active
       AND c.name_norm = public.normalize_strap_catalog_text(up.color)
     WHERE ts.strap_base_group_id IS NOT NULL
       AND ts.upper_material_group_id IS NOT NULL
       AND jsonb_typeof(ts.strap_colors) = 'array'
       AND coalesce(g.is_artisanal_strap, false) = false
       AND NOT public.strap_finished_group_is_hygiene_candidate(g.id)
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(ts.strap_colors) AS line(value)
          WHERE coalesce(line.value->>'identity_basis', 'reference_base') = 'reference_base'
            AND public.try_parse_uuid(line.value->>'measure_id') IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.products bp
          WHERE bp.group_id = g.id
            AND bp.active
            AND bp.unit = 'm'
            AND public.normalize_strap_catalog_text(bp.color) IN (
              SELECT cc.name_norm FROM public.canonical_colors cc WHERE cc.id = c.id
              UNION
              SELECT a.alias_norm FROM public.color_aliases a
               WHERE a.canonical_color_id = c.id AND a.status = 'approved'
            )
       )
     GROUP BY g.id, g.name, c.id, c.name
  ) needed;
END;
$$;

-- ---------------------------------------------------------------------------
-- ACLs
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.try_parse_uuid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_parse_uuid(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.strap_hygiene_dimension_mm(numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strap_hygiene_dimension_mm(numeric, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.strap_finished_group_is_hygiene_candidate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.strap_finished_group_is_hygiene_candidate(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tg_reject_napa_like_sheet_on_strap_group()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_artisanal_strap_group()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.artisanal_strap_catalog_diagnostics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.artisanal_strap_catalog_diagnostics()
  TO authenticated, service_role;

DO $$
DECLARE
  v_diagnostics text;
  v_candidate text;
  v_eligible text;
BEGIN
  SELECT pg_get_functiondef('public.artisanal_strap_catalog_diagnostics()'::regprocedure)
    INTO v_diagnostics;
  IF v_diagnostics !~ 'finished_strap_group_unflagged'
     OR v_diagnostics !~ 'strap_component_sheet_looks_like_napa'
     OR v_diagnostics !~ 'napa_width_inverted'
     OR v_diagnostics !~ 'buy_ready_line_without_variant'
     OR v_diagnostics !~ 'internal_recipe_missing'
     OR v_diagnostics !~ 'missing_base_color_sku'
     OR v_diagnostics !~ 'review_existing_variant'
     OR v_diagnostics !~ 'create_variant_with_bundle' THEN
    RAISE EXCEPTION 'Diagnostico de higiene nao publica os codigos esperados';
  END IF;
  IF v_diagnostics ~ 'UPDATE public.product_groups'
     OR v_diagnostics ~ 'UPDATE public.component_sheets'
     OR v_diagnostics ~ 'UPDATE public.sale_order_items' THEN
    RAISE EXCEPTION 'Diagnostico de higiene nao pode escrever cadastro nem PV';
  END IF;

  SELECT pg_get_functiondef('public.strap_finished_group_is_hygiene_candidate(uuid)'::regprocedure)
    INTO v_candidate;
  IF v_candidate !~ 'artisanal_strap_types'
     OR v_candidate !~ 'identity_group_id'
     OR v_candidate !~ 'finished_product_group' THEN
    RAISE EXCEPTION 'Candidato de higiene nao combina UUID e prefixo de tipo';
  END IF;

  SELECT pg_get_functiondef('public.strap_base_group_is_eligible(uuid)'::regprocedure)
    INTO v_eligible;
  IF v_eligible ~ 'g\.name' OR v_eligible ~ 'name_norm' THEN
    RAISE EXCEPTION 'Elegibilidade de napa-base nao pode voltar a inferir por nome';
  END IF;
  IF v_eligible !~ 'NOT coalesce\(g.is_artisanal_strap, false\)' THEN
    RAISE EXCEPTION 'Elegibilidade de napa-base deixou de honrar is_artisanal_strap';
  END IF;
END;
$$;

COMMIT;
