-- Geometria de área (L×A) + conversão placa no motor canônico.
-- Decisões do grill 18/10/2026:
--   * unidades m²/dm²/cm²/placa exigem largura×comprimento+dimensions_unit no grupo
--   * porta = product_groups → update_material_group_dimensions → component_sheets
--   * get_material_conversion_info: placa usa área W×L; dm²=1; m²=100; cm²=0.01
--   * backfill inequívoco: PL01 (PLACA 1.0 EVA 3.0) sem grupo

-- ── 1) Backfill: PL01 órfão → grupo com dims da ficha ─────────────────────────
DO $$
DECLARE
  v_pid uuid := 'caa8afb2-edd9-49b3-ae08-cc43c74f20a3';
  v_gid uuid;
  v_w numeric;
  v_l numeric;
  v_u text;
  v_t numeric;
BEGIN
  SELECT p.group_id,
         COALESCE(NULLIF(cs.dimensions_width, 0), NULLIF(p.dimensions_width, 0)),
         COALESCE(NULLIF(cs.dimensions_length, 0), NULLIF(p.dimensions_length, 0)),
         COALESCE(NULLIF(cs.dimensions_unit, ''), NULLIF(p.dimensions_unit, ''), 'mm'),
         COALESCE(cs.dimensions_thickness, p.dimensions_thickness, 0)
    INTO v_gid, v_w, v_l, v_u, v_t
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT dimensions_width, dimensions_length, dimensions_unit, dimensions_thickness
      FROM public.component_sheets c
      WHERE c.product_id = p.id
      ORDER BY c.updated_at DESC NULLS LAST
      LIMIT 1
    ) cs ON true
   WHERE p.id = v_pid;

  IF NOT FOUND THEN
    RAISE NOTICE 'PL01 não encontrado — backfill ignorado';
    RETURN;
  END IF;

  IF v_gid IS NOT NULL THEN
    RAISE NOTICE 'PL01 já tem grupo % — backfill ignorado', v_gid;
    RETURN;
  END IF;

  IF COALESCE(v_w, 0) <= 0 OR COALESCE(v_l, 0) <= 0 THEN
    RAISE EXCEPTION 'PL01 sem L×A na ficha/produto — backfill abortado (não inventar geometria)';
  END IF;

  SELECT id INTO v_gid FROM public.product_groups
   WHERE lower(trim(name)) = lower(trim('PLACA 1.0 EVA'))
   LIMIT 1;

  IF v_gid IS NULL THEN
    INSERT INTO public.product_groups (
      name, sector, shared_specs, consumption_unit, is_family, is_color_agnostic,
      dimensions_width, dimensions_length, dimensions_thickness, dimensions_unit
    ) VALUES (
      'PLACA 1.0 EVA',
      'Palmilha',
      true,
      'dm²',
      false,
      true,
      v_w, v_l, v_t, v_u
    )
    RETURNING id INTO v_gid;
  END IF;

  IF v_gid IS NULL THEN
    RAISE EXCEPTION 'Não foi possível criar/localizar grupo PLACA 1.0 EVA';
  END IF;

  UPDATE public.products
     SET group_id = v_gid,
         dimensions_width = v_w,
         dimensions_length = v_l,
         dimensions_thickness = v_t,
         dimensions_unit = v_u
   WHERE id = v_pid;

  -- Sincroniza sheets do grupo (mesma RPC da UI).
  PERFORM public.update_material_group_dimensions(v_gid, v_l, v_w, v_t, v_u);
END $$;

-- ── 2) Relatório de gaps (painel Diagnósticos) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_area_geometry_gaps()
RETURNS TABLE (
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  group_id uuid,
  group_name text,
  gap_kind text,
  sheet_width numeric,
  sheet_length numeric,
  sheet_unit text,
  group_width numeric,
  group_length numeric,
  group_unit text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH area AS (
    SELECT p.id, p.sku, p.name, p.unit, p.group_id, p.active,
           g.name AS group_name,
           g.dimensions_width AS g_w, g.dimensions_length AS g_l, g.dimensions_unit AS g_u,
           cs.dimensions_width AS cs_w, cs.dimensions_length AS cs_l, cs.dimensions_unit AS cs_u
    FROM public.products p
    LEFT JOIN public.product_groups g ON g.id = p.group_id
    LEFT JOIN LATERAL (
      SELECT dimensions_width, dimensions_length, dimensions_unit
      FROM public.component_sheets c
      WHERE c.product_id = p.id
         OR (p.group_id IS NOT NULL AND c.group_id = p.group_id)
      ORDER BY (c.product_id = p.id) DESC, c.updated_at DESC NULLS LAST
      LIMIT 1
    ) cs ON true
    WHERE p.active
      AND lower(trim(p.unit)) IN ('m²','m2','dm²','dm2','cm²','cm2','placa','placas')
  )
  SELECT
    a.id,
    a.sku,
    a.name,
    a.unit,
    a.group_id,
    a.group_name,
    CASE
      WHEN a.group_id IS NULL THEN 'sem_grupo'
      WHEN COALESCE(a.cs_w, 0) <= 0 OR COALESCE(a.cs_l, 0) <= 0 THEN 'ficha_sem_lxA'
      WHEN COALESCE(a.g_w, 0) <= 0 OR COALESCE(a.g_l, 0) <= 0 THEN 'grupo_sem_lxA'
      WHEN COALESCE(nullif(trim(a.cs_u), ''), nullif(trim(a.g_u), '')) IS NULL THEN 'sem_unidade_dim'
      ELSE 'ok'
    END AS gap_kind,
    a.cs_w, a.cs_l, a.cs_u,
    a.g_w, a.g_l, a.g_u
  FROM area a
  WHERE a.group_id IS NULL
     OR COALESCE(a.cs_w, 0) <= 0 OR COALESCE(a.cs_l, 0) <= 0
     OR COALESCE(a.g_w, 0) <= 0 OR COALESCE(a.g_l, 0) <= 0
     OR COALESCE(nullif(trim(a.cs_u), ''), nullif(trim(a.g_u), '')) IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_area_geometry_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_area_geometry_gaps() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_area_geometry_gaps() IS
  'SKUs ativos com unit de área sem grupo ou sem largura×comprimento×unidade na ficha/grupo.';

-- ── 3) Motor: conversão de placa por W×L ──────────────────────────────────────
