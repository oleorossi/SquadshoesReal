-- Verificação read-only pós-deploy da modelagem de Cabedal dublado.
-- Pode ser executada repetidamente pelo workflow supabase-db-exec.

DO $test$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT g.id INTO STRICT v_family_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = 'dublagem';

  IF EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_family_id
       AND g.sector IS DISTINCT FROM 'Cabedal'
  ) THEN
    RAISE EXCEPTION 'DUBLAGEM não está no setor Cabedal.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.products p WHERE p.group_id = v_family_id) THEN
    RAISE EXCEPTION 'A família DUBLAGEM possui produtos diretos.';
  END IF;

  IF (
    SELECT count(*)
      FROM public.product_groups g
     WHERE g.parent_group_id = v_family_id
       AND lower(btrim(g.name)) IN (
         'dublagem diversos',
         'napa soft com cacharrel/eva',
         'napa soft com pu 600',
         'pelo dublado'
       )
  ) <> 4 THEN
    RAISE EXCEPTION 'A família DUBLAGEM não possui todas as folhas obrigatórias.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
      JOIN public.product_groups g ON g.id = ts.upper_material_group_id
     WHERE EXISTS (
       SELECT 1 FROM public.product_groups child WHERE child.parent_group_id = g.id
     )
  ) THEN
    RAISE EXCEPTION 'Há ficha de Cabedal apontando para uma família em vez de folha.';
  END IF;

  IF EXISTS (
    SELECT l.composite_group_id
      FROM public.product_group_layers l
     GROUP BY l.composite_group_id
    HAVING count(*) = 1
  ) THEN
    RAISE EXCEPTION 'Há composição dublada incompleta com somente uma camada.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
      JOIN public.product_groups g ON g.id = p.group_id
      LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
     WHERE p.active IS TRUE
       AND lower(btrim(g.name)) IN (
         'napa soft com cacharrel/eva',
         'napa soft com pu 600',
         'sudani dublado pu 600',
         'suede eva + cacharrel',
         'pelo dublado'
       )
       AND (
         p.unit IS DISTINCT FROM 'm'
         OR cs.dimensions_width IS DISTINCT FROM 1370
         OR cs.dimensions_unit IS DISTINCT FROM 'mm'
       )
  ) THEN
    RAISE EXCEPTION 'Há SKU dublado confirmado sem unidade m ou largura 1.370 mm.';
  END IF;
END
$test$;

SELECT jsonb_build_object(
  'family', 'DUBLAGEM',
  'groups', (
    SELECT jsonb_agg(to_jsonb(summary) ORDER BY summary.grupo)
      FROM (
        SELECT
          child.name AS grupo,
          count(p.id) FILTER (WHERE p.active IS TRUE) AS itens_ativos,
          count(DISTINCT nullif(btrim(p.color), '')) FILTER (WHERE p.active IS TRUE) AS cores_ativas,
          coalesce(sum(p.quantity) FILTER (WHERE p.active IS TRUE), 0) AS saldo_total,
          (SELECT count(*) FROM public.product_group_layers l WHERE l.composite_group_id = child.id) AS camadas
        FROM public.product_groups family
        JOIN public.product_groups child ON child.parent_group_id = family.id
        LEFT JOIN public.products p ON p.group_id = child.id
        WHERE lower(btrim(family.name)) = 'dublagem'
        GROUP BY child.id, child.name
      ) AS summary
  )
) AS cabedal_dublagem_postdeploy;
