-- =============================================================================
-- Consumo: overlay de TIPO invalida yield/receita da identidade antiga
-- =============================================================================
-- Pedido de teste (PV-00222 / G02): merge mostra "Overlock Redonda 6 mm" e
-- "TIRA CHATA COSTURADA 11 mm", mas strap_previews mantinha recipe_id/yield
-- da TIRA OVERLOCK 5 mm / TIRA CHATA 8 mm (y=70). base_required_m = tira/70
-- em vez de tira/40 (Costurada×GLOW) — metragem da tira igual, napa errada.
--
-- enrich_233 só buscava receita quando yield era NULL. Com pin antigo o yield
-- vinha preenchido e o fallback virava no-op. Agora: se a medida da linha
-- (overlay) ≠ da medida da recipe_id pinada, zera yield e reconsulta.
-- Sem receita nova → limpa base_required_m (não inventa número) + blocker.
-- Marca: consumo_overlay_stale_recipe_yield_294
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.enrich_consumo_strap_preview_recipe_yield(
  p_preview jsonb,
  p_line_measure_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  -- consumo_recipe_yield_fallback_presentation_233
  -- consumo_overlay_stale_recipe_yield_294
  v_preview jsonb := COALESCE(p_preview, '{}'::jsonb);
  v_resolved jsonb;
  v_source text;
  v_yield numeric;
  v_gross numeric;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_color_id uuid;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_base_product_id uuid;
  v_base_product_name text;
  v_reasons jsonb;
  v_soft text[] := ARRAY[
    'variant_identity_not_persisted',
    'frozen_source_snapshot_stale',
    'reference_base_intent_mismatch',
    'catalog_resolution_blocked'
  ];
  v_measure_name text;
  v_pinned_recipe_id uuid;
  v_pinned_measure_id uuid;
  v_stale_pin boolean := false;
BEGIN
  v_source := NULLIF(pg_catalog.btrim(v_preview ->> 'source_mode'), '');
  IF v_source IS DISTINCT FROM 'internal' THEN
    RETURN v_preview;
  END IF;

  v_resolved := CASE
    WHEN pg_catalog.jsonb_typeof(v_preview -> 'resolved') = 'object'
      THEN v_preview -> 'resolved'
    ELSE '{}'::jsonb
  END;

  BEGIN
    v_yield := NULLIF(v_resolved ->> 'confirmed_yield_m_per_m', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_yield := NULL;
  END;

  BEGIN
    v_gross := NULLIF(v_preview ->> 'gross_required_m', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    v_gross := NULL;
  END;

  v_measure_id := COALESCE(
    p_line_measure_id,
    public.try_parse_uuid(v_resolved ->> 'measure_id')
  );
  v_base_group_id := public.try_parse_uuid(v_resolved ->> 'base_group_id');
  v_color_id := public.try_parse_uuid(v_resolved ->> 'color_id');
  v_measure_name := NULLIF(pg_catalog.btrim(v_resolved ->> 'measure_name'), '');

  IF v_measure_id IS NULL AND v_measure_name IS NOT NULL THEN
    SELECT m.id
      INTO v_measure_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '')
             = v_measure_name
        OR NULLIF(pg_catalog.btrim(m.display_name), '') = v_measure_name
     ORDER BY CASE
                WHEN NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '')
                       = v_measure_name THEN 0
                ELSE 1
              END
     LIMIT 1;
  END IF;

  -- Pin de receita da identidade ANTIGA (ex.: OVERLOCK 5 mm) com medida nova
  -- (Overlock Redonda 6 mm / Costurada 11 mm): yield preenchido mas errado.
  v_pinned_recipe_id := COALESCE(
    public.try_parse_uuid(v_preview ->> 'recipe_id'),
    public.try_parse_uuid(v_resolved -> 'catalog' ->> 'recipe_id')
  );
  IF v_measure_id IS NOT NULL AND v_pinned_recipe_id IS NOT NULL THEN
    SELECT r.measure_id
      INTO v_pinned_measure_id
      FROM public.artisanal_strap_recipes r
     WHERE r.id = v_pinned_recipe_id;
    IF v_pinned_measure_id IS DISTINCT FROM v_measure_id THEN
      v_stale_pin := true;
      v_yield := NULL;
      v_preview := v_preview - 'recipe_id';
      v_resolved := (v_resolved - 'confirmed_yield_m_per_m' - 'base_required_m')
        || pg_catalog.jsonb_build_object('recipe_yield_stale_overlay', true);
    END IF;
  END IF;

  IF v_yield IS NULL OR v_yield <= 0 THEN
    IF v_measure_id IS NULL OR v_base_group_id IS NULL THEN
      IF v_stale_pin THEN
        v_preview := v_preview
          || pg_catalog.jsonb_build_object(
               'resolved', v_resolved,
               'blocking_reasons',
                 COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
                 || pg_catalog.jsonb_build_array(
                      pg_catalog.jsonb_build_object(
                        'code', 'overlay_recipe_measure_mismatch',
                        'field', 'recipe_id',
                        'message',
                          'Tipo/medida da ficha difere da receita pinada; '
                          || 'cadastre a receita no Hub de Tiras ou salve o item.'
                      )
                    )
             );
        RETURN v_preview;
      END IF;
      RETURN v_preview;
    END IF;

    SELECT r.*
      INTO v_recipe
      FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_measure_id
       AND r.base_group_id = v_base_group_id
       AND r.status = 'approved'
       AND r.valid_from <= pg_catalog.now()
       AND (r.valid_to IS NULL OR r.valid_to > pg_catalog.now())
     ORDER BY r.version DESC, r.approved_at DESC NULLS LAST
     LIMIT 1;

    IF v_recipe.id IS NULL OR COALESCE(v_recipe.confirmed_yield_m_per_m, 0) <= 0 THEN
      -- Sem receita para o tipo novo: NÃO devolver yield/base da identidade antiga.
      IF v_stale_pin THEN
        v_preview := v_preview
          || pg_catalog.jsonb_build_object(
               'resolved', v_resolved,
               'blocking_reasons',
                 COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
                 || pg_catalog.jsonb_build_array(
                      pg_catalog.jsonb_build_object(
                        'code', 'overlay_recipe_missing',
                        'field', 'recipe_id',
                        'message',
                          'Não há receita aprovada para este tipo×napa; '
                          || 'o consumo de base não pode usar o rendimento antigo. '
                          || 'Cadastre no Hub de Tiras.'
                      )
                    )
             );
        RETURN v_preview;
      END IF;
      RETURN v_preview;
    END IF;

    v_yield := v_recipe.confirmed_yield_m_per_m;
    v_preview := v_preview || pg_catalog.jsonb_build_object(
      'recipe_id', v_recipe.id
    );
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'confirmed_yield_m_per_m', v_yield,
      'base_required_m', CASE
        WHEN COALESCE(v_gross, 0) > 0 THEN v_gross / v_yield
        ELSE NULL
      END,
      'cut_band_width_mm', v_recipe.cut_band_width_mm,
      'usable_base_width_mm_snapshot', v_recipe.usable_base_width_mm_snapshot,
      'theoretical_yield_m_per_m', v_recipe.theoretical_yield_m_per_m,
      'measure_id', v_measure_id,
      'recipe_yield_fallback', true
    );
  ELSIF COALESCE(v_gross, 0) > 0
     AND NULLIF(v_resolved ->> 'base_required_m', '') IS NULL THEN
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'base_required_m', v_gross / v_yield
    );
  END IF;

  IF public.try_parse_uuid(v_preview ->> 'base_product_id') IS NULL
     AND v_base_group_id IS NOT NULL
     AND v_color_id IS NOT NULL
  THEN
    SELECT o.official_product_id, p.name
      INTO v_base_product_id, v_base_product_name
      FROM public.base_material_color_official_products o
      JOIN public.products p ON p.id = o.official_product_id
     WHERE o.base_group_id = v_base_group_id
       AND o.color_id = v_color_id
       AND o.status = 'active'
       AND p.active
     LIMIT 1;

    IF v_base_product_id IS NULL THEN
      SELECT p.id, p.name
        INTO v_base_product_id, v_base_product_name
        FROM public.products p
        JOIN public.canonical_colors c ON c.id = v_color_id
       WHERE p.group_id = v_base_group_id
         AND p.active
         AND lower(COALESCE(p.unit, '')) IN ('m', 'metro', 'metros')
         AND lower(pg_catalog.btrim(COALESCE(p.color, '')))
               = lower(pg_catalog.btrim(COALESCE(c.name, '')))
       ORDER BY p.created_at
       LIMIT 1;
    END IF;

    IF v_base_product_id IS NOT NULL THEN
      v_preview := v_preview || pg_catalog.jsonb_build_object(
        'base_product_id', v_base_product_id
      );
      v_resolved := v_resolved || pg_catalog.jsonb_build_object(
        'base_product_name', v_base_product_name
      );
    END IF;
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(reason.value ORDER BY reason.ordinality), '[]'::jsonb)
    INTO v_reasons
    FROM pg_catalog.jsonb_array_elements(
      COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
    ) WITH ORDINALITY reason(value, ordinality)
   WHERE NOT (
     COALESCE(v_yield, 0) > 0
     AND COALESCE(reason.value ->> 'code', '') = ANY (v_soft)
   );

  v_preview := v_preview
    || pg_catalog.jsonb_build_object(
         'resolved', v_resolved,
         'blocking_reasons', v_reasons
       );

  RETURN v_preview;
END;
$function$;

COMMENT ON FUNCTION private.enrich_consumo_strap_preview_recipe_yield(jsonb, uuid) IS
  'Consumo: se yield falta OU recipe pinada é de outra medida (overlay de tipo), '
  'busca receita aprovada medida×napa; sem receita, limpa base antiga e bloqueia.';

DO $guards$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'private.enrich_consumo_strap_preview_recipe_yield(jsonb,uuid)'::regprocedure
  ) INTO v_def;
  IF v_def NOT ILIKE '%consumo_overlay_stale_recipe_yield_294%' THEN
    RAISE EXCEPTION 'Guard: enrich sem marca 294';
  END IF;
  IF v_def NOT ILIKE '%recipe_yield_stale_overlay%' THEN
    RAISE EXCEPTION 'Guard: enrich sem stale overlay';
  END IF;
  IF v_def NOT ILIKE '%overlay_recipe_missing%' THEN
    RAISE EXCEPTION 'Guard: enrich sem blocker de receita ausente';
  END IF;
END;
$guards$;

COMMIT;
