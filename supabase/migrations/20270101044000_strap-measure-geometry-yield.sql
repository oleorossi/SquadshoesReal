-- Hub rendimento por medida × geometria de bobina (grill 19/10/2026).
--
-- - Chave: (grupo de tira ↔ medida Hub) × geometria da ficha (1000×1370 ≡ 1370×1000).
-- - Persistência: só strap_group_napa_yields (receita Hub deixa de mandar no yield).
-- - Espalha no save e quando napa nova nasce com a mesma geometria.
-- - Backfill: receitas aprovadas → grupo (gaps) + espalha yields existentes às famílias casadas.

-- ── 1. Mapa medida Hub → grupo de estoque (mapa da 35800, agora persistente) ─
CREATE TABLE IF NOT EXISTS public.strap_hub_measure_group_map (
  measure_id uuid PRIMARY KEY
    REFERENCES public.artisanal_strap_measures(id) ON DELETE CASCADE,
  strap_group_id uuid NOT NULL
    REFERENCES public.product_groups(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.strap_hub_measure_group_map IS
  'Medida do Hub → grupo de tira em product_groups. Fonte do rendimento por geometria.';

CREATE UNIQUE INDEX IF NOT EXISTS strap_hub_measure_group_map_group_uq
  ON public.strap_hub_measure_group_map (strap_group_id);

ALTER TABLE public.strap_hub_measure_group_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strap_hub_measure_group_map_select ON public.strap_hub_measure_group_map;
CREATE POLICY strap_hub_measure_group_map_select ON public.strap_hub_measure_group_map
  FOR SELECT TO authenticated USING (public.is_approved_user());

DROP POLICY IF EXISTS strap_hub_measure_group_map_write ON public.strap_hub_measure_group_map;
CREATE POLICY strap_hub_measure_group_map_write ON public.strap_hub_measure_group_map
  FOR ALL TO authenticated
  USING (public.user_has_any_role(ARRAY['admin', 'gerente']))
  WITH CHECK (public.user_has_any_role(ARRAY['admin', 'gerente']));

REVOKE ALL ON TABLE public.strap_hub_measure_group_map FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.strap_hub_measure_group_map TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.strap_hub_measure_group_map TO authenticated;

INSERT INTO public.strap_hub_measure_group_map (measure_id, strap_group_id)
SELECT m.measure_id::uuid, g.id
  FROM (VALUES
    ('69c30596-c428-459b-ad93-128814c8b277', '4d3943d7-adbb-4523-a1ec-f8ae003bea8b'),
    ('2c84a703-851c-4c56-8a72-4615d3d1fa05', 'c759eb08-00f1-448a-aeba-4693a967be4f'),
    ('0166b326-2023-4427-a165-aada45ee5611', 'a657390e-1c4f-469b-ac48-8e45b2b8d3c0'),
    ('65628af5-8cb3-419a-8c54-3e2ac474ee5e', '87b706a8-40ba-4019-9aee-b2f80ef81212'),
    ('06500a23-801d-4627-a927-3ce7e5ee2619', 'e0301b34-7963-448d-a12a-33a897439282'),
    ('a487b85e-8e3d-4091-9932-41205836b5c0', '6e43bbda-0f1f-412c-8d4a-ec009114530d'),
    ('00f07325-347b-4e65-90e6-fed33f70eacc', 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'),
    ('ea0c68b9-2911-4477-bf1b-206661e6c745', '2fbed979-a191-46e2-908c-5e02a0df4f3c')
  ) AS m(measure_id, group_id)
  JOIN public.product_groups g ON g.id = m.group_id::uuid
ON CONFLICT (measure_id) DO UPDATE
  SET strap_group_id = EXCLUDED.strap_group_id, updated_at = now();

INSERT INTO public.strap_hub_measure_group_map (measure_id, strap_group_id)
SELECT '9292a467-992e-4097-8dd5-5fb2f94abb15'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'ELÁSTICO FORRADO 7MM'
ON CONFLICT (measure_id) DO NOTHING;

INSERT INTO public.strap_hub_measure_group_map (measure_id, strap_group_id)
SELECT '60242fca-662a-4c24-9ff6-407c9fc3bab0'::uuid, g.id
  FROM public.product_groups g WHERE g.name = 'OVERLOCK REDONDA 6MM'
ON CONFLICT (measure_id) DO NOTHING;

-- ── 2. Banda de corte no grupo (Configuração Q16) ───────────────────────────
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS strap_cut_band_width_mm numeric;

COMMENT ON COLUMN public.product_groups.strap_cut_band_width_mm IS
  'Tira: largura da banda de corte (mm) para o teórico floor(bobina ÷ banda). Uma por medida/grupo.';

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_groups_strap_cut_band_check'
  ) THEN
    ALTER TABLE public.product_groups
      ADD CONSTRAINT product_groups_strap_cut_band_check
      CHECK (strap_cut_band_width_mm IS NULL OR strap_cut_band_width_mm > 0);
  END IF;
END
$chk$;

-- Prefill banda a partir da receita aprovada mais recente da medida.
UPDATE public.product_groups g
   SET strap_cut_band_width_mm = coalesce(
     g.strap_cut_band_width_mm,
     (
       SELECT r.cut_band_width_mm
         FROM public.strap_hub_measure_group_map map
         JOIN public.artisanal_strap_recipes r ON r.measure_id = map.measure_id
        WHERE map.strap_group_id = g.id
          AND r.status = 'approved'
          AND r.cut_band_width_mm > 0
        ORDER BY r.valid_from DESC
        LIMIT 1
     )
   )
 WHERE coalesce(g.is_artisanal_strap, false);

-- ── 3. Geometria da ficha (component_sheets) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.napa_group_sheet_dims(p_napa_group_id uuid)
RETURNS TABLE (width_mm numeric, length_mm numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT cs.dimensions_width::numeric AS width_mm,
         coalesce(cs.dimensions_length, 0)::numeric AS length_mm
    FROM public.component_sheets cs
    JOIN public.products p ON p.id = cs.product_id
   WHERE p.group_id = p_napa_group_id
     AND p.active
     AND coalesce(cs.dimensions_width, 0) > 0
   ORDER BY p.updated_at DESC NULLS LAST
   LIMIT 1;
$fn$;

REVOKE ALL ON FUNCTION public.napa_group_sheet_dims(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.napa_group_sheet_dims(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.napa_geometry_normalized(
  p_width_mm numeric,
  p_length_mm numeric
) RETURNS TABLE (min_mm numeric, max_mm numeric)
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
           WHEN coalesce(p_width_mm, 0) <= 0 AND coalesce(p_length_mm, 0) <= 0 THEN NULL
           WHEN coalesce(p_width_mm, 0) <= 0 THEN 0
           WHEN coalesce(p_length_mm, 0) <= 0 THEN 0
           ELSE LEAST(p_width_mm, p_length_mm)
         END AS min_mm,
         CASE
           WHEN coalesce(p_width_mm, 0) <= 0 AND coalesce(p_length_mm, 0) <= 0 THEN NULL
           WHEN coalesce(p_width_mm, 0) <= 0 THEN p_length_mm
           WHEN coalesce(p_length_mm, 0) <= 0 THEN p_width_mm
           ELSE GREATEST(p_width_mm, p_length_mm)
         END AS max_mm
   WHERE coalesce(p_width_mm, 0) > 0 OR coalesce(p_length_mm, 0) > 0;
$fn$;

CREATE OR REPLACE FUNCTION public.napa_geometries_match(
  p_a_width numeric, p_a_length numeric,
  p_b_width numeric, p_b_length numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH a AS (
    SELECT * FROM public.napa_geometry_normalized(p_a_width, p_a_length)
  ),
  b AS (
    SELECT * FROM public.napa_geometry_normalized(p_b_width, p_b_length)
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM a) OR NOT EXISTS (SELECT 1 FROM b) THEN false
    WHEN (SELECT max_mm FROM a) IS DISTINCT FROM (SELECT max_mm FROM b) THEN false
    WHEN (SELECT min_mm FROM a) > 0 AND (SELECT min_mm FROM b) > 0
      THEN (SELECT min_mm FROM a) = (SELECT min_mm FROM b)
    ELSE true
  END;
$fn$;

-- ── 4. Famílias elegíveis com a mesma geometria ─────────────────────────────
CREATE OR REPLACE FUNCTION public.list_napa_groups_matching_geometry(
  p_width_mm numeric,
  p_length_mm numeric
) RETURNS TABLE (
  napa_group_id uuid,
  napa_group_name text,
  width_mm numeric,
  length_mm numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT g.id, g.name, d.width_mm, d.length_mm
    FROM public.product_groups g
    CROSS JOIN LATERAL public.napa_group_sheet_dims(g.id) d
   WHERE public.strap_base_group_is_eligible(g.id)
     AND public.napa_geometries_match(p_width_mm, p_length_mm, d.width_mm, d.length_mm)
   ORDER BY g.name;
$fn$;

REVOKE ALL ON FUNCTION public.list_napa_groups_matching_geometry(numeric, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_napa_groups_matching_geometry(numeric, numeric)
  TO authenticated, service_role;

-- ── 5. Save: rendimento da medida × geometria → todas as famílias casadas ───
CREATE OR REPLACE FUNCTION public.set_strap_measure_geometry_yield(
  p_measure_id uuid,
  p_yield_m_per_m numeric,
  p_cut_band_width_mm numeric DEFAULT NULL,
  p_geometry_width_mm numeric DEFAULT NULL,
  p_geometry_length_mm numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_strap_group_id uuid;
  v_uses_napa boolean;
  v_width numeric;
  v_length numeric;
  v_band numeric;
  v_applied int := 0;
  v_names text[] := ARRAY[]::text[];
  r record;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']) THEN
    RAISE EXCEPTION 'Somente Gerência/Produção pode informar o rendimento da tira'
      USING ERRCODE = '42501';
  END IF;

  SELECT map.strap_group_id, coalesce(g.strap_uses_napa, true)
    INTO v_strap_group_id, v_uses_napa
    FROM public.strap_hub_measure_group_map map
    JOIN public.product_groups g ON g.id = map.strap_group_id
   WHERE map.measure_id = p_measure_id;

  IF v_strap_group_id IS NULL THEN
    RAISE EXCEPTION 'Medida sem grupo de estoque mapeado. Cadastre o tipo de tira no estoque.';
  END IF;

  IF NOT v_uses_napa THEN
    RAISE EXCEPTION 'Esta tira não usa napa (ex.: strass). Rendimento por bobina não se aplica.';
  END IF;

  IF p_yield_m_per_m IS NULL OR p_yield_m_per_m <= 0 THEN
    RAISE EXCEPTION 'Rendimento deve ser maior que zero (metros de tira por metro de napa)';
  END IF;

  -- Geometria alvo: explícita ou a mais comum entre as elegíveis (moda do max).
  IF p_geometry_width_mm IS NOT NULL AND coalesce(p_geometry_width_mm, 0) > 0 THEN
    v_width := p_geometry_width_mm;
    v_length := coalesce(p_geometry_length_mm, 0);
  ELSE
    SELECT d.width_mm, d.length_mm
      INTO v_width, v_length
      FROM public.product_groups g
      CROSS JOIN LATERAL public.napa_group_sheet_dims(g.id) d
     WHERE public.strap_base_group_is_eligible(g.id)
     ORDER BY (
       SELECT count(*) FROM public.list_napa_groups_matching_geometry(d.width_mm, d.length_mm)
     ) DESC,
     d.width_mm DESC
     LIMIT 1;
  END IF;

  IF v_width IS NULL OR coalesce(v_width, 0) <= 0 THEN
    RAISE EXCEPTION 'Nenhuma napa elegível com ficha de componente (largura) cadastrada.';
  END IF;

  IF p_cut_band_width_mm IS NOT NULL THEN
    IF p_cut_band_width_mm <= 0 THEN
      RAISE EXCEPTION 'Banda de corte deve ser maior que zero';
    END IF;
    v_band := p_cut_band_width_mm;
    UPDATE public.product_groups
       SET strap_cut_band_width_mm = v_band, updated_at = now()
     WHERE id = v_strap_group_id;
  ELSE
    SELECT strap_cut_band_width_mm INTO v_band
      FROM public.product_groups WHERE id = v_strap_group_id;
  END IF;

  FOR r IN
    SELECT * FROM public.list_napa_groups_matching_geometry(v_width, v_length)
  LOOP
    INSERT INTO public.strap_group_napa_yields (
      strap_group_id, napa_group_id, yield_m_per_m, updated_at, updated_by
    ) VALUES (
      v_strap_group_id, r.napa_group_id, p_yield_m_per_m, now(), auth.uid()
    )
    ON CONFLICT (strap_group_id, napa_group_id)
    DO UPDATE SET
      yield_m_per_m = EXCLUDED.yield_m_per_m,
      updated_at = now(),
      updated_by = auth.uid();
    v_applied := v_applied + 1;
    v_names := array_append(v_names, r.napa_group_name);
  END LOOP;

  IF v_applied = 0 THEN
    RAISE EXCEPTION 'Nenhuma família de napa casa com a geometria %.×%. mm',
      GREATEST(v_width, v_length), LEAST(v_width, nullif(v_length, 0));
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'strap_group_id', v_strap_group_id,
    'yield_m_per_m', p_yield_m_per_m,
    'cut_band_width_mm', v_band,
    'geometry_width_mm', v_width,
    'geometry_length_mm', v_length,
    'applied_count', v_applied,
    'napa_group_names', to_jsonb(v_names)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_strap_measure_geometry_yield(uuid, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_strap_measure_geometry_yield(uuid, numeric, numeric, numeric, numeric)
  TO authenticated;

-- ── 6. Herança quando napa nova (ou ficha) casa com geometria já rendida ────
CREATE OR REPLACE FUNCTION public.inherit_strap_yields_for_napa_group(
  p_napa_group_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_dims record;
  v_count int := 0;
  r record;
BEGIN
  IF p_napa_group_id IS NULL THEN RETURN 0; END IF;
  IF NOT public.strap_base_group_is_eligible(p_napa_group_id) THEN RETURN 0; END IF;

  SELECT * INTO v_dims FROM public.napa_group_sheet_dims(p_napa_group_id);
  IF NOT FOUND OR coalesce(v_dims.width_mm, 0) <= 0 THEN RETURN 0; END IF;

  -- Para cada grupo de tira que já tem yield em alguma napa da mesma geometria,
  -- copia o rendimento (moda / max) para esta napa se ainda não tiver linha.
  FOR r IN
    SELECT y.strap_group_id,
           mode() WITHIN GROUP (ORDER BY y.yield_m_per_m) AS yield_m_per_m
      FROM public.strap_group_napa_yields y
      JOIN public.product_groups g ON g.id = y.strap_group_id
      CROSS JOIN LATERAL public.napa_group_sheet_dims(y.napa_group_id) d
     WHERE coalesce(g.is_artisanal_strap, false)
       AND coalesce(g.strap_uses_napa, true)
       AND public.napa_geometries_match(
             v_dims.width_mm, v_dims.length_mm, d.width_mm, d.length_mm
           )
     GROUP BY y.strap_group_id
  LOOP
    INSERT INTO public.strap_group_napa_yields (
      strap_group_id, napa_group_id, yield_m_per_m, updated_at, updated_by
    ) VALUES (
      r.strap_group_id, p_napa_group_id, r.yield_m_per_m, now(), auth.uid()
    )
    ON CONFLICT (strap_group_id, napa_group_id) DO NOTHING;
    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.inherit_strap_yields_for_napa_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inherit_strap_yields_for_napa_group(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_inherit_strap_yields_on_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT p.group_id INTO v_group_id
    FROM public.products p
   WHERE p.id = NEW.product_id;
  IF v_group_id IS NOT NULL THEN
    PERFORM public.inherit_strap_yields_for_napa_group(v_group_id);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inherit_strap_yields_on_sheet ON public.component_sheets;
CREATE TRIGGER trg_inherit_strap_yields_on_sheet
  AFTER INSERT OR UPDATE OF dimensions_width, dimensions_length, product_id
  ON public.component_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_inherit_strap_yields_on_sheet();

-- ── 7. Board da Configuração ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_strap_measure_yield_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_result jsonb := '[]'::jsonb;
  m record;
  v_strap_group_id uuid;
  v_uses_napa boolean;
  v_band numeric;
  v_families jsonb;
  v_geometries jsonb;
  v_has_yield boolean;
  v_sample_yield numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Não autorizado' USING ERRCODE = '42501';
  END IF;

  FOR m IN
    SELECT meas.id AS measure_id,
           meas.display_name,
           meas.finished_width_mm,
           meas.active AS measure_active,
           t.id AS type_id,
           t.name AS type_name,
           t.active AS type_active,
           map.strap_group_id,
           g.name AS strap_group_name,
           coalesce(g.strap_uses_napa, true) AS uses_napa,
           g.strap_cut_band_width_mm,
           g.strap_origin,
           g.strap_labor_cost_per_m
      FROM public.artisanal_strap_measures meas
      JOIN public.artisanal_strap_types t ON t.id = meas.strap_type_id
      LEFT JOIN public.strap_hub_measure_group_map map ON map.measure_id = meas.id
      LEFT JOIN public.product_groups g ON g.id = map.strap_group_id
     WHERE meas.active
     ORDER BY t.name, meas.finished_width_mm, meas.display_name
  LOOP
    v_strap_group_id := m.strap_group_id;
    v_uses_napa := coalesce(m.uses_napa, true);
    v_band := m.strap_cut_band_width_mm;
    v_families := '[]'::jsonb;
    v_geometries := '[]'::jsonb;
    v_has_yield := false;
    v_sample_yield := NULL;

    IF v_strap_group_id IS NOT NULL AND v_uses_napa THEN
      SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.napa_group_name), '[]'::jsonb)
        INTO v_families
        FROM (
          SELECT g.id AS napa_group_id,
                 g.name AS napa_group_name,
                 d.width_mm,
                 d.length_mm,
                 y.yield_m_per_m,
                 (SELECT n.min_mm FROM public.napa_geometry_normalized(d.width_mm, d.length_mm) n) AS geom_min_mm,
                 (SELECT n.max_mm FROM public.napa_geometry_normalized(d.width_mm, d.length_mm) n) AS geom_max_mm
            FROM public.product_groups g
            CROSS JOIN LATERAL public.napa_group_sheet_dims(g.id) d
            LEFT JOIN public.strap_group_napa_yields y
              ON y.strap_group_id = v_strap_group_id AND y.napa_group_id = g.id
           WHERE public.strap_base_group_is_eligible(g.id)
        ) x;

      SELECT coalesce(bool_or(y.yield_m_per_m > 0), false),
             max(y.yield_m_per_m)
        INTO v_has_yield, v_sample_yield
        FROM public.strap_group_napa_yields y
       WHERE y.strap_group_id = v_strap_group_id;

      -- Agrupa famílias por geometria para a UI (um campo por bobina).
      SELECT coalesce(jsonb_agg(row_to_json(g)::jsonb ORDER BY g.geom_max_mm DESC, g.geom_min_mm), '[]'::jsonb)
        INTO v_geometries
        FROM (
          SELECT
            (SELECT n.min_mm FROM public.napa_geometry_normalized(f.width_mm, f.length_mm) n) AS geom_min_mm,
            (SELECT n.max_mm FROM public.napa_geometry_normalized(f.width_mm, f.length_mm) n) AS geom_max_mm,
            max(f.yield_m_per_m) AS yield_m_per_m,
            count(*)::int AS family_count,
            jsonb_agg(f.napa_group_name ORDER BY f.napa_group_name) AS family_names,
            bool_or(coalesce(f.yield_m_per_m, 0) > 0) AS has_yield
          FROM jsonb_to_recordset(v_families) AS f(
            napa_group_id uuid,
            napa_group_name text,
            width_mm numeric,
            length_mm numeric,
            yield_m_per_m numeric,
            geom_min_mm numeric,
            geom_max_mm numeric
          )
          GROUP BY 1, 2
        ) g;
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'measure_id', m.measure_id,
      'type_id', m.type_id,
      'type_name', m.type_name,
      'display_name', m.display_name,
      'finished_width_mm', m.finished_width_mm,
      'measure_active', m.measure_active AND m.type_active,
      'strap_group_id', v_strap_group_id,
      'strap_group_name', m.strap_group_name,
      'uses_napa', v_uses_napa,
      'cut_band_width_mm', v_band,
      'strap_origin', m.strap_origin,
      'strap_labor_cost_per_m', m.strap_labor_cost_per_m,
      'has_yield', v_has_yield,
      'sample_yield_m_per_m', v_sample_yield,
      'missing_yield', v_uses_napa AND v_strap_group_id IS NOT NULL AND NOT v_has_yield,
      'families', v_families,
      'geometries', v_geometries
    ));
  END LOOP;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_strap_measure_yield_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_strap_measure_yield_board() TO authenticated;

-- ── 8. Backfill receitas → grupo (gaps) + espalha geometria ─────────────────
INSERT INTO public.strap_group_napa_yields (strap_group_id, napa_group_id, yield_m_per_m)
SELECT DISTINCT ON (map.strap_group_id, r.base_group_id)
       map.strap_group_id, r.base_group_id, r.confirmed_yield_m_per_m
  FROM public.artisanal_strap_recipes r
  JOIN public.strap_hub_measure_group_map map ON map.measure_id = r.measure_id
  JOIN public.product_groups g ON g.id = map.strap_group_id AND coalesce(g.strap_uses_napa, true)
 WHERE r.status = 'approved'
   AND r.valid_from <= now()
   AND (r.valid_to IS NULL OR r.valid_to > now())
   AND r.confirmed_yield_m_per_m > 0
   AND r.base_group_id IS NOT NULL
 ORDER BY map.strap_group_id, r.base_group_id, r.valid_from DESC
ON CONFLICT (strap_group_id, napa_group_id) DO NOTHING;

-- Espalha cada yield existente às famílias elegíveis da mesma geometria.
DO $spread$
DECLARE
  y record;
  n record;
BEGIN
  FOR y IN
    SELECT sy.strap_group_id, sy.napa_group_id, sy.yield_m_per_m, d.width_mm, d.length_mm
      FROM public.strap_group_napa_yields sy
      CROSS JOIN LATERAL public.napa_group_sheet_dims(sy.napa_group_id) d
  LOOP
    FOR n IN
      SELECT * FROM public.list_napa_groups_matching_geometry(y.width_mm, y.length_mm)
    LOOP
      INSERT INTO public.strap_group_napa_yields (
        strap_group_id, napa_group_id, yield_m_per_m
      ) VALUES (
        y.strap_group_id, n.napa_group_id, y.yield_m_per_m
      )
      ON CONFLICT (strap_group_id, napa_group_id) DO NOTHING;
    END LOOP;
  END LOOP;
END
$spread$;
