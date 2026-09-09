-- Linhas com variantes compartilham uma unidade técnica explícita.
--
-- O cadastro rápido já exigia a unidade dos produtos, mas não a copiava para
-- product_groups. Isso deixou dois grupos vivos com shared_specs=true e
-- consumption_unit=NULL. Ao salvar esses grupos, o fluxo legado tentava
-- propagar NULL aos produtos e o gatilho unit↔consumption_unit acabava criando
-- products.unit=NULL, bloqueado corretamente pelo NOT NULL.

BEGIN;

WITH homogeneous_product_units AS (
  SELECT
    p.group_id,
    min(p.unit) AS unit
  FROM public.products p
  WHERE p.group_id IS NOT NULL
    AND NULLIF(btrim(p.unit), '') IS NOT NULL
  GROUP BY p.group_id
  HAVING count(DISTINCT p.unit) = 1
)
UPDATE public.product_groups g
   SET consumption_unit = h.unit
  FROM homogeneous_product_units h
 WHERE h.group_id = g.id
   AND COALESCE(g.shared_specs, false)
   AND NULLIF(btrim(COALESCE(g.consumption_unit, '')), '') IS NULL;

ALTER TABLE public.product_groups
  DROP CONSTRAINT IF EXISTS chk_shared_group_has_consumption_unit;

ALTER TABLE public.product_groups
  ADD CONSTRAINT chk_shared_group_has_consumption_unit
  CHECK (
    NOT COALESCE(shared_specs, false)
    OR NULLIF(btrim(COALESCE(consumption_unit, '')), '') IS NOT NULL
  );

COMMENT ON CONSTRAINT chk_shared_group_has_consumption_unit ON public.product_groups IS
  'Linha com variantes (shared_specs=true) exige unidade técnica explícita no grupo. Coleções com unidades individuais usam shared_specs=false.';

COMMIT;
