-- Regra de produto (2026-05-11): o SOLADO é a fonte da verdade do range
-- de tamanhos. Quando uma ficha técnica é vinculada a um sole_group_id,
-- sua coluna `sizes` deve refletir o range agregado das variantes do solado
-- (MIN _size_from / MAX _size_to entre todas as cores do mesmo group).
--
-- Trigger BEFORE INSERT/UPDATE em technical_sheets sincroniza
-- automaticamente quando sole_group_id muda. Frontend (PV e ficha) também
-- usa MIN/MAX da mesma forma — assim a UI nunca diverge do banco.

CREATE OR REPLACE FUNCTION public.tg_sync_ficha_sizes_from_sole()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from int;
  v_to int;
BEGIN
  IF NEW.sole_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.sole_group_id IS NOT DISTINCT FROM OLD.sole_group_id THEN
    RETURN NEW;
  END IF;

  SELECT
    MIN((stock_grade->>'_size_from')::int),
    MAX((stock_grade->>'_size_to')::int)
   INTO v_from, v_to
   FROM public.products
  WHERE group_id = NEW.sole_group_id
    AND category = 'Solado'
    AND stock_grade ? '_size_from'
    AND stock_grade ? '_size_to';

  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from <= v_to THEN
    NEW.sizes := v_from || '-' || v_to;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ficha_sizes_from_sole ON public.technical_sheets;
CREATE TRIGGER trg_sync_ficha_sizes_from_sole
  BEFORE INSERT OR UPDATE OF sole_group_id ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_ficha_sizes_from_sole();

GRANT EXECUTE ON FUNCTION public.tg_sync_ficha_sizes_from_sole() TO authenticated;

-- Backfill: sincroniza fichas existentes (UNION dos ranges das variantes)
UPDATE public.technical_sheets ts
   SET sizes = sub.range,
       updated_at = now()
  FROM (
    SELECT
      sol.group_id,
      MIN((sol.stock_grade->>'_size_from')::int) || '-' || MAX((sol.stock_grade->>'_size_to')::int) AS range
     FROM public.products sol
    WHERE sol.category = 'Solado'
      AND sol.stock_grade ? '_size_from'
      AND sol.stock_grade ? '_size_to'
      AND sol.group_id IS NOT NULL
    GROUP BY sol.group_id
  ) sub
 WHERE ts.sole_group_id = sub.group_id
   AND ts.sizes IS DISTINCT FROM sub.range;

-- View de auditoria: agora lista fichas com solado vinculado mas SEM
-- range cadastrado em variantes (impede o trigger de sincronizar).
DROP VIEW IF EXISTS public.v_ficha_sole_range_mismatch;
CREATE VIEW public.v_ficha_sole_range_mismatch AS
SELECT
  ts.id AS sheet_id,
  ts.code AS sheet_code,
  ts.name AS sheet_name,
  ts.sizes AS ficha_sizes,
  ts.sole_group_id,
  pg.name AS sole_group_name,
  agg.variants_count,
  agg.sole_from,
  agg.sole_to,
  CASE
    WHEN agg.variants_count IS NULL OR agg.variants_count = 0 THEN 'sem_variantes_de_solado'
    WHEN agg.sole_from IS NULL OR agg.sole_to IS NULL THEN 'solado_sem_range_cadastrado'
    ELSE 'aligned'
  END AS status
FROM public.technical_sheets ts
LEFT JOIN public.product_groups pg ON pg.id = ts.sole_group_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS variants_count,
    MIN((stock_grade->>'_size_from')::int) AS sole_from,
    MAX((stock_grade->>'_size_to')::int) AS sole_to
   FROM public.products
  WHERE group_id = ts.sole_group_id
    AND category = 'Solado'
    AND stock_grade ? '_size_from'
    AND stock_grade ? '_size_to'
) agg ON true
WHERE ts.sole_group_id IS NOT NULL
  AND (agg.variants_count IS NULL OR agg.variants_count = 0 OR agg.sole_from IS NULL);

ALTER VIEW public.v_ficha_sole_range_mismatch SET (security_invoker = true);

COMMENT ON VIEW public.v_ficha_sole_range_mismatch IS
  'Fichas vinculadas a um sole_group_id mas que não conseguem sincronizar sizes '
  'automaticamente porque o solado não tem range cadastrado em nenhuma variante. '
  'Operador precisa cadastrar _size_from/_size_to em pelo menos uma variante do group.';

GRANT SELECT ON public.v_ficha_sole_range_mismatch TO authenticated;
