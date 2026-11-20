-- strap_sku_group_yield_consumo_20270101045400
--
-- PV-00239 (CONSUMO TOTAL): TIRA OVERLOCK 5 mm saía com napa a enviar
-- 11,52 m (= 806,40 ÷ 70) em vez de 13,44 m (= 806,40 ÷ 60).
--
-- Causa: SKUs acabados (NEW WHISKY / OFF WHITE e outros) estavam com
-- products.group_id NULL. O enrich do consumo só lê strap_group_napa_yields
-- quando resolve o grupo da tira; sem group_id caía no fallback da receita
-- do Hub (confirmed_yield = 70). O rendimento canônico no grupo já era 60
-- (dono, 06/11/2026).
--
-- Esta migration:
-- 1) religa SKUs de tira órfãos ao product_groups is_artisanal_strap;
-- 2) endurece o enrich: resolve o grupo também pelo nome do SKU;
-- 3) alinha receita Hub OVERLOCK 5 mm 70 → 60 (fallback);
-- 4) alinha NAPA SANTORINE no grupo (ainda 70) para 60;
-- 5) recalcula confirmed_yield_snapshot / base_required_m das demandas
--    abertas quando o rendimento do grupo diverge do snapshot.

-- ─── 1. Normalizador + resolvedor de grupo por nome do SKU ───────────────────

CREATE OR REPLACE FUNCTION private.normalize_strap_name_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT regexp_replace(
    upper(translate(
      coalesce(p_text, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN'
    )),
    '[^A-Z0-9]',
    '',
    'g'
  );
$function$;

COMMENT ON FUNCTION private.normalize_strap_name_key(text) IS
  'Chave de casamento grupo↔SKU de tira (sem acento/espaço/MM solto).';

CREATE OR REPLACE FUNCTION private.resolve_artisanal_strap_group_id_from_product(
  p_product_id uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  -- strap_sku_group_yield_consumo_454
  v_group_id uuid;
  v_name text;
  v_prefix text;
  v_prefix_key text;
  v_hits int;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.group_id, p.name
    INTO v_group_id, v_name
    FROM public.products p
   WHERE p.id = p_product_id;

  IF v_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_group_id AND coalesce(g.is_artisanal_strap, false)
  ) THEN
    RETURN v_group_id;
  END IF;

  v_prefix := NULLIF(pg_catalog.btrim(split_part(coalesce(v_name, ''), ' · ', 1)), '');
  IF v_prefix IS NULL THEN
    RETURN NULL;
  END IF;
  v_prefix_key := private.normalize_strap_name_key(v_prefix);
  IF v_prefix_key = '' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), (array_agg(g.id ORDER BY g.name))[1]
    INTO v_hits, v_group_id
    FROM public.product_groups g
   WHERE coalesce(g.is_artisanal_strap, false)
     AND (
       private.normalize_strap_name_key(g.name) = v_prefix_key
       OR private.normalize_strap_name_key(g.name) = v_prefix_key || 'MM'
       OR (
         length(private.normalize_strap_name_key(g.name)) >= 4
         AND v_prefix_key LIKE private.normalize_strap_name_key(g.name) || '%'
       )
     );

  IF v_hits = 1 THEN
    RETURN v_group_id;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION private.resolve_artisanal_strap_group_id_from_product(uuid) IS
  'Grupo is_artisanal_strap do SKU: group_id se válido; senão casamento único por nome.';

REVOKE ALL ON FUNCTION private.normalize_strap_name_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.resolve_artisanal_strap_group_id_from_product(uuid)
  FROM PUBLIC, anon, authenticated;

-- ─── 2. Backfill products.group_id ───────────────────────────────────────────
-- Porta canônica: token app.artisanal_strap_catalog_write (tg_guard_legacy…).
-- Só religa quando a cor ainda está livre no grupo (fn_guard_unique_active_group_color).

DO $$
BEGIN
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  UPDATE public.products p
     SET group_id = t.gid,
         updated_at = pg_catalog.now()
    FROM (
      SELECT p2.id,
             private.resolve_artisanal_strap_group_id_from_product(p2.id) AS gid,
             p2.color
        FROM public.products p2
       WHERE p2.group_id IS NULL
         AND p2.active
         AND private.resolve_artisanal_strap_group_id_from_product(p2.id) IS NOT NULL
    ) t
   WHERE p.id = t.id
     AND NOT EXISTS (
       SELECT 1 FROM public.products x
        WHERE x.group_id = t.gid
          AND x.active
          AND lower(pg_catalog.btrim(coalesce(x.color, '')))
              = lower(pg_catalog.btrim(coalesce(t.color, '')))
          AND x.id <> t.id
     );
END $$;

-- ─── 3. Enrich: resolve grupo mesmo com SKU órfão ────────────────────────────

CREATE OR REPLACE FUNCTION private.enrich_consumo_strap_preview_recipe_yield(
  p_preview jsonb,
  p_line_measure_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  -- consumo_recipe_yield_fallback_presentation_233
  -- consumo_overlay_stale_recipe_yield_294
  -- consumo_strap_preview_recipe_id_null_not_omit_297
  -- strap_yield_prefers_group_439
  -- strap_sku_group_yield_consumo_454
  v_preview jsonb := COALESCE(p_preview, '{}'::jsonb);
  v_resolved jsonb;
  v_source text;
  v_yield numeric;
  v_gross numeric;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_strap_group_id uuid;
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
  v_group_yield numeric;
  v_finished_product_id uuid;
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
    SELECT m.id INTO v_measure_id
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '') = v_measure_name
        OR NULLIF(pg_catalog.btrim(m.display_name), '') = v_measure_name
     ORDER BY CASE
                WHEN NULLIF(pg_catalog.btrim(CONCAT_WS(' ', t.name, m.display_name)), '') = v_measure_name
                  THEN 0 ELSE 1
              END
     LIMIT 1;
  END IF;

  v_pinned_recipe_id := COALESCE(
    public.try_parse_uuid(v_preview ->> 'recipe_id'),
    public.try_parse_uuid(v_resolved -> 'catalog' ->> 'recipe_id')
  );
  IF v_measure_id IS NOT NULL AND v_pinned_recipe_id IS NOT NULL THEN
    SELECT r.measure_id INTO v_pinned_measure_id
      FROM public.artisanal_strap_recipes r WHERE r.id = v_pinned_recipe_id;
    IF v_pinned_measure_id IS DISTINCT FROM v_measure_id THEN
      v_stale_pin := true;
      v_yield := NULL;
      v_preview := v_preview || pg_catalog.jsonb_build_object('recipe_id', NULL);
      v_resolved := (v_resolved - 'confirmed_yield_m_per_m' - 'base_required_m')
        || pg_catalog.jsonb_build_object('recipe_yield_stale_overlay', true);
    END IF;
  END IF;

  v_finished_product_id := COALESCE(
    public.try_parse_uuid(v_preview ->> 'finished_product_id'),
    public.try_parse_uuid(v_resolved ->> 'finished_product_id'),
    public.try_parse_uuid(v_resolved -> 'catalog' ->> 'finished_product_id')
  );

  -- Preferência: group_id do SKU → identity_group_id → casamento por nome (454).
  IF v_finished_product_id IS NOT NULL THEN
    v_strap_group_id := private.resolve_artisanal_strap_group_id_from_product(
      v_finished_product_id
    );
  END IF;
  IF v_strap_group_id IS NULL THEN
    v_strap_group_id := COALESCE(
      public.try_parse_uuid(v_resolved ->> 'identity_group_id'),
      public.try_parse_uuid(v_resolved -> 'catalog' ->> 'identity_group_id')
    );
    IF v_strap_group_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_groups g
       WHERE g.id = v_strap_group_id AND coalesce(g.is_artisanal_strap, false)
    ) THEN
      v_strap_group_id := NULL;
    END IF;
  END IF;

  IF v_strap_group_id IS NOT NULL AND v_base_group_id IS NOT NULL THEN
    SELECT y.yield_m_per_m INTO v_group_yield
      FROM public.strap_group_napa_yields y
     WHERE y.strap_group_id = v_strap_group_id AND y.napa_group_id = v_base_group_id;
    IF coalesce(v_group_yield, 0) > 0 THEN
      v_yield := v_group_yield;
      v_resolved := v_resolved || pg_catalog.jsonb_build_object(
        'confirmed_yield_m_per_m', v_yield,
        'base_required_m', CASE
          WHEN COALESCE(v_gross, 0) > 0 THEN v_gross / v_yield
          ELSE NULLIF(v_resolved ->> 'base_required_m', '')::numeric
        END,
        'strap_group_id', v_strap_group_id,
        'group_yield_preferred', true
      );
    END IF;
  END IF;

  IF v_yield IS NULL OR v_yield <= 0 THEN
    IF v_measure_id IS NULL OR v_base_group_id IS NULL THEN
      IF v_stale_pin THEN
        v_preview := v_preview || pg_catalog.jsonb_build_object(
          'resolved', v_resolved,
          'blocking_reasons', COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'code', 'overlay_recipe_measure_mismatch', 'field', 'recipe_id',
              'message',
                'Tipo/medida da ficha difere da receita pinada; '
                || 'informe o rendimento no grupo da tira ou salve o item.'
            )));
        RETURN v_preview;
      END IF;
      RETURN v_preview || pg_catalog.jsonb_build_object('resolved', v_resolved);
    END IF;

    SELECT r.* INTO v_recipe FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_measure_id AND r.base_group_id = v_base_group_id
       AND r.status = 'approved' AND r.valid_from <= pg_catalog.now()
       AND (r.valid_to IS NULL OR r.valid_to > pg_catalog.now())
     ORDER BY r.version DESC, r.approved_at DESC NULLS LAST LIMIT 1;

    IF v_recipe.id IS NULL OR COALESCE(v_recipe.confirmed_yield_m_per_m, 0) <= 0 THEN
      IF v_stale_pin THEN
        v_preview := v_preview || pg_catalog.jsonb_build_object(
          'resolved', v_resolved,
          'blocking_reasons', COALESCE(v_preview -> 'blocking_reasons', '[]'::jsonb)
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'code', 'overlay_recipe_missing', 'field', 'recipe_id',
              'message',
                'Sem rendimento no grupo da tira × napa; '
                || 'cadastre em Estoque → grupo da tira (Rendimento).'
            )));
        RETURN v_preview;
      END IF;
      RETURN v_preview || pg_catalog.jsonb_build_object('resolved', v_resolved);
    END IF;

    v_yield := v_recipe.confirmed_yield_m_per_m;
    v_preview := v_preview || pg_catalog.jsonb_build_object('recipe_id', v_recipe.id);
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'confirmed_yield_m_per_m', v_yield,
      'base_required_m', CASE
        WHEN COALESCE(v_gross, 0) > 0 THEN v_gross / v_yield ELSE NULL
      END,
      'cut_band_width_mm', v_recipe.cut_band_width_mm,
      'usable_base_width_mm_snapshot', v_recipe.usable_base_width_mm_snapshot,
      'theoretical_yield_m_per_m', v_recipe.theoretical_yield_m_per_m,
      'measure_id', v_measure_id,
      'recipe_yield_fallback', true
    );
  ELSIF COALESCE(v_gross, 0) > 0 AND NULLIF(v_resolved ->> 'base_required_m', '') IS NULL THEN
    v_resolved := v_resolved || pg_catalog.jsonb_build_object(
      'base_required_m', v_gross / v_yield
    );
  END IF;

  IF public.try_parse_uuid(v_preview ->> 'base_product_id') IS NULL
     AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
    SELECT o.official_product_id, p.name
      INTO v_base_product_id, v_base_product_name
      FROM public.base_material_color_official_products o
      JOIN public.products p ON p.id = o.official_product_id
     WHERE o.base_group_id = v_base_group_id AND o.color_id = v_color_id
       AND o.status = 'active' AND p.active
     LIMIT 1;
    IF v_base_product_id IS NULL THEN
      SELECT p.id, p.name INTO v_base_product_id, v_base_product_name
        FROM public.products p
        JOIN public.canonical_colors c ON c.id = v_color_id
       WHERE p.group_id = v_base_group_id AND p.active
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

  RETURN v_preview || pg_catalog.jsonb_build_object(
    'resolved', v_resolved,
    'blocking_reasons', v_reasons
  );
END;
$function$;

COMMENT ON FUNCTION private.enrich_consumo_strap_preview_recipe_yield(jsonb, uuid) IS
  'Preview de consumo/PV: rendimento preferido de strap_group_napa_yields '
  '(resolve grupo mesmo com SKU órfão); fallback receita Hub aprovada.';

-- ─── 4. Cadastro: OVERLOCK 5 mm → 60 m/m (grupo SANTORINE + receitas Hub) ────

UPDATE public.strap_group_napa_yields y
   SET yield_m_per_m = 60,
       updated_at = pg_catalog.now()
  FROM public.product_groups sg, public.product_groups ng
 WHERE y.strap_group_id = sg.id
   AND y.napa_group_id = ng.id
   AND sg.name = 'TIRA OVERLOCK 5MM'
   AND ng.name = 'NAPA SANTORINE'
   AND y.yield_m_per_m IS DISTINCT FROM 60;

-- Supersede receitas Hub OVERLOCK 5 mm ainda em 70 (fallback do enrich).
DO $$
DECLARE
  v_actor uuid;
  v_old public.artisanal_strap_recipes%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT y.updated_by INTO v_actor
    FROM public.strap_group_napa_yields y
    JOIN public.product_groups sg ON sg.id = y.strap_group_id
   WHERE sg.name = 'TIRA OVERLOCK 5MM' AND y.updated_by IS NOT NULL
   LIMIT 1;
  IF v_actor IS NULL THEN
    SELECT id INTO v_actor FROM public.profiles WHERE approved LIMIT 1;
  END IF;

  FOR v_old IN
    SELECT r.*
      FROM public.artisanal_strap_recipes r
      JOIN public.artisanal_strap_measures m ON m.id = r.measure_id
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE t.name = 'TIRA OVERLOCK'
       AND m.finished_width_mm = 5
       AND r.status = 'approved'
       AND r.confirmed_yield_m_per_m IS DISTINCT FROM 60
  LOOP
    UPDATE public.artisanal_strap_recipes
       SET status = 'superseded',
           valid_to = pg_catalog.now(),
           updated_at = pg_catalog.now(),
           review_reason = coalesce(review_reason, '')
             || ' Superseded 454: rendimento canônico do grupo = 60 m/m (PV-00239).'
     WHERE id = v_old.id;

    INSERT INTO public.artisanal_strap_recipes (
      measure_id, base_group_id, base_width_profile_id, version,
      usable_base_width_mm_snapshot, cut_band_width_mm,
      confirmed_yield_m_per_m, executor_type, default_contractor_id,
      transformation_cost_per_m, status, valid_from, approved_by, approved_at,
      supersedes_recipe_id, review_reason
    ) VALUES (
      v_old.measure_id, v_old.base_group_id, v_old.base_width_profile_id,
      v_old.version + 1,
      v_old.usable_base_width_mm_snapshot, v_old.cut_band_width_mm,
      60, v_old.executor_type, v_old.default_contractor_id,
      v_old.transformation_cost_per_m, 'approved', pg_catalog.now(),
      v_actor, pg_catalog.now(), v_old.id,
      'Dono: Overlock 5 mm = 60 m de tira por m de napa (06/11/2026). '
      || 'Corrige fallback Hub que ainda tinha 70 (PV-00239).'
    )
    RETURNING id INTO v_new_id;
  END LOOP;
END $$;

-- ─── 5. Demandas abertas: realinhar snapshot ao rendimento do grupo ──────────

UPDATE public.sale_order_strap_demands d
   SET confirmed_yield_snapshot = y.yield_m_per_m,
       base_required_m = round(d.gross_required_m / y.yield_m_per_m, 9),
       base_shortage_m = GREATEST(
         0,
         round(d.gross_required_m / y.yield_m_per_m, 9)
           - coalesce(d.base_reserved_m, 0)
           - coalesce(d.base_inbound_allocated_m, 0)
       ),
       identity_snapshot = CASE
         WHEN pg_catalog.jsonb_typeof(d.identity_snapshot) = 'object'
           THEN jsonb_set(
                  jsonb_set(
                    d.identity_snapshot,
                    '{resolved,confirmed_yield_m_per_m}',
                    to_jsonb(y.yield_m_per_m),
                    true
                  ),
                  '{resolved,base_required_m}',
                  to_jsonb(round(d.gross_required_m / y.yield_m_per_m, 9)),
                  true
                )
         ELSE d.identity_snapshot
       END,
       calculation_explanation = coalesce(d.calculation_explanation, '{}'::jsonb)
         || pg_catalog.jsonb_build_object(
              'reason', 'yield_realigned_group_454',
              'previous_yield', d.confirmed_yield_snapshot,
              'group_yield', y.yield_m_per_m,
              'base_required_m', round(d.gross_required_m / y.yield_m_per_m, 9)
            ),
       updated_at = pg_catalog.now()
  FROM public.products fp
  JOIN public.product_groups sg ON sg.id = fp.group_id
  JOIN public.products bp ON true
  JOIN public.strap_group_napa_yields y
    ON y.strap_group_id = sg.id
   AND y.napa_group_id = bp.group_id
 WHERE d.is_current
   AND d.finished_product_id = fp.id
   AND d.base_product_id = bp.id
   AND coalesce(sg.is_artisanal_strap, false)
   AND coalesce(y.yield_m_per_m, 0) > 0
   AND d.confirmed_yield_snapshot IS DISTINCT FROM y.yield_m_per_m
   AND coalesce(d.gross_required_m, 0) > 0;

-- ─── Guards ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_def text;
  v_orphan int;
  v_pv_yield numeric;
  v_pv_napa numeric;
BEGIN
  SELECT pg_get_functiondef(
    'private.enrich_consumo_strap_preview_recipe_yield(jsonb,uuid)'::regprocedure
  ) INTO v_def;
  IF position('strap_sku_group_yield_consumo_454' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guard 454: enrich sem marcador strap_sku_group_yield_consumo_454';
  END IF;
  IF position('resolve_artisanal_strap_group_id_from_product' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guard 454: enrich não usa resolve_artisanal_strap_group_id_from_product';
  END IF;

  SELECT count(*) INTO v_orphan
    FROM public.products p
   WHERE p.id IN (
     '712ebcbd-a581-4d42-9706-622788d002db',
     '168df73d-dc4a-4234-8130-faaf2fe62160'
   )
     AND (
       p.group_id IS DISTINCT FROM 'e0301b34-7963-448d-a12a-33a897439282'::uuid
     );
  IF v_orphan > 0 THEN
    RAISE EXCEPTION 'Guard 454: SKUs OVERLOCK NEW WHISKY/OFF WHITE ainda sem grupo';
  END IF;

  SELECT max(d.confirmed_yield_snapshot), sum(d.base_required_m)
    INTO v_pv_yield, v_pv_napa
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_id = '24a138cd-3d05-4999-be88-00b27f10290b'
     AND d.is_current;
  IF v_pv_yield IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'Guard 454: PV-00239 yield snapshot=% (esperado 60)', v_pv_yield;
  END IF;
  IF round(v_pv_napa, 2) IS DISTINCT FROM 13.44 THEN
    RAISE EXCEPTION 'Guard 454: PV-00239 napa=% (esperado 13.44)', round(v_pv_napa, 2);
  END IF;
END $$;
