-- =============================================================================
-- Refina list_materials_missing_width() pra reduzir falsos positivos
-- =============================================================================
-- A versão anterior listava TODOS os produtos lineares (m/cm) sem
-- dimensions_width — incluindo tiras e elásticos, que usam o fluxo
-- `debit_strap_stock` (cm/par direto, NÃO passa por
-- get_material_conversion_info). Resultado: 50 entradas, 47 falsos positivos.
--
-- Esta versão filtra:
--   • Apenas materiais REFERENCIADOS em sheet_materials (BOM real de uma
--     ficha técnica) OU referenciados como upper/lining/insole_material
--     (string-matched pelo group_name) — ou seja, materiais que de fato
--     passam por get_material_conversion_info no cálculo de consumo.
--   • Exclui products cujo nome OU group_name contém "Tira", "Elástico",
--     "Strass", "TRANÇA", "Trança" — esses entram em strap_colors (cm/par).
--
-- O resultado: lista focada em tecidos/laminados/dublagens que de fato
-- causam erro 100× quando dimensions_width não está configurada.
-- =============================================================================

DROP FUNCTION IF EXISTS public.list_materials_missing_width();
CREATE OR REPLACE FUNCTION public.list_materials_missing_width()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_unit text,
  group_name text,
  used_in_sheets int,
  has_component_sheet boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH candidates AS (
    SELECT
      p.id,
      p.name,
      p.unit,
      pg.id   AS group_id,
      pg.name AS pg_name
    FROM products p
    LEFT JOIN product_groups pg ON pg.id = p.group_id
    WHERE p.active = true
      AND LOWER(p.unit) IN ('m','meters','metros','mt','cm')
      -- Sem dimensões cadastradas no produto NEM no grupo
      AND NOT EXISTS (
        SELECT 1 FROM component_sheets cs
        WHERE (cs.product_id = p.id OR cs.group_id = p.group_id)
          AND COALESCE(cs.dimensions_width, 0) > 0
      )
      -- Exclui tiras/elásticos/strass/tranças (fluxo strap_colors em cm/par)
      AND NOT (
        p.name ILIKE '%tira%' OR p.name ILIKE '%elastic%' OR p.name ILIKE '%strass%'
        OR p.name ILIKE '%tranç%' OR p.name ILIKE '%tranc%'
        OR COALESCE(pg.name, '') ILIKE '%tira%'
        OR COALESCE(pg.name, '') ILIKE '%elastic%'
        OR COALESCE(pg.name, '') ILIKE '%strass%'
        OR COALESCE(pg.name, '') ILIKE '%tranç%'
        OR COALESCE(pg.name, '') ILIKE '%tranc%'
      )
  ),
  -- Conta em quantas fichas o produto ou seu grupo aparecem como BOM
  -- (sheet_materials) OU como upper/lining/insole material (group_name match)
  sheet_usage AS (
    SELECT
      c.id AS product_id,
      (
        -- BOM direto (sheet_materials)
        (SELECT COUNT(DISTINCT sm.sheet_id) FROM sheet_materials sm WHERE sm.product_id = c.id)
        +
        -- Upper/lining/insole_material via group name match
        (SELECT COUNT(*) FROM technical_sheets ts
          WHERE LOWER(TRIM(COALESCE(ts.upper_material, ''))) = LOWER(TRIM(COALESCE(c.pg_name, '')))
             OR LOWER(TRIM(COALESCE(ts.lining_material, ''))) = LOWER(TRIM(COALESCE(c.pg_name, '')))
             OR LOWER(TRIM(COALESCE(ts.insole_material, ''))) = LOWER(TRIM(COALESCE(c.pg_name, '')))
        )
      )::int AS uses
    FROM candidates c
  )
  SELECT
    c.id           AS product_id,
    c.name         AS product_name,
    c.unit         AS product_unit,
    c.pg_name      AS group_name,
    su.uses        AS used_in_sheets,
    EXISTS (
      SELECT 1 FROM component_sheets cs
      WHERE cs.product_id = c.id OR cs.group_id = c.group_id
    )              AS has_component_sheet
  FROM candidates c
  JOIN sheet_usage su ON su.product_id = c.id
  WHERE su.uses > 0   -- só lista materiais que de fato são usados em alguma ficha
  ORDER BY su.uses DESC, c.pg_name NULLS LAST, c.name;
$$;

GRANT EXECUTE ON FUNCTION public.list_materials_missing_width() TO authenticated;

COMMENT ON FUNCTION public.list_materials_missing_width() IS
  'Diagnóstico refinado: lista materiais lineares (m/cm) sem dimensions_width '
  'em component_sheets QUE SÃO USADOS em alguma ficha técnica. Exclui tiras/'
  'elásticos/strass/tranças que usam fluxo strap_colors (cm/par direto, sem '
  'conversão via get_material_conversion_info).';
