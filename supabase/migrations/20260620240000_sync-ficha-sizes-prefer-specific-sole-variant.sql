-- Bug: tg_sync_ficha_sizes_from_sole agregava MIN(_size_from)/MAX(_size_to)
-- entre TODAS as variantes do mesmo sole_group_id, ignorando a variante
-- específica configurada na ficha (sole_material).
--
-- Exemplo do bug: ficha DS05 com sole_material="01" (variante "01 - CARAMELO",
-- range 34-40) recebia sizes="25-40" porque o group também tinha "SOLADO
-- INFANTIL" (25-36), "204" (25-32) etc. Resultado: PV abria a matriz de
-- grade com numeração 25-40 em vez de 34-40.
--
-- Fix: a função tenta primeiro casar a variante específica por nome
-- (sole_material exato OU prefixo + separador), e só cai pra MIN/MAX
-- agregado quando nenhuma variante específica casa.

CREATE OR REPLACE FUNCTION public.tg_sync_ficha_sizes_from_sole()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from int;
  v_to int;
  v_sole_mat text;
BEGIN
  IF NEW.sole_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.sole_group_id IS NOT DISTINCT FROM OLD.sole_group_id
     AND NEW.sole_material IS NOT DISTINCT FROM OLD.sole_material THEN
    RETURN NEW;
  END IF;

  v_sole_mat := lower(trim(COALESCE(NEW.sole_material, '')));

  -- 1) Tenta casar a variante específica pelo nome (sole_material).
  -- Match: exato OU nome começa com "sole_material{sep}" OU "sole_material"
  -- começa com "nome{sep}" — separadores: espaço, hífen, slash, underscore.
  IF v_sole_mat <> '' THEN
    SELECT MIN((stock_grade->>'_size_from')::int),
           MAX((stock_grade->>'_size_to')::int)
      INTO v_from, v_to
      FROM public.products
     WHERE group_id = NEW.sole_group_id
       AND category = 'Solado'
       AND active = true
       AND stock_grade ? '_size_from'
       AND stock_grade ? '_size_to'
       AND (
         lower(trim(name)) = v_sole_mat
         OR lower(trim(name)) LIKE v_sole_mat || ' %'
         OR lower(trim(name)) LIKE v_sole_mat || '-%'
         OR lower(trim(name)) LIKE v_sole_mat || '/%'
         OR lower(trim(name)) LIKE v_sole_mat || '_%' ESCAPE '\'
         OR v_sole_mat LIKE lower(trim(name)) || ' %'
         OR v_sole_mat LIKE lower(trim(name)) || '-%'
       );
  END IF;

  -- 2) Fallback: agrega todas as variantes do group (comportamento legado)
  IF v_from IS NULL OR v_to IS NULL THEN
    SELECT MIN((stock_grade->>'_size_from')::int),
           MAX((stock_grade->>'_size_to')::int)
      INTO v_from, v_to
      FROM public.products
     WHERE group_id = NEW.sole_group_id
       AND category = 'Solado'
       AND active = true
       AND stock_grade ? '_size_from'
       AND stock_grade ? '_size_to';
  END IF;

  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from <= v_to THEN
    NEW.sizes := v_from || '-' || v_to;
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger já existe (BEFORE INSERT OR UPDATE em technical_sheets). Não recriamos.

-- Backfill: re-aplica nas fichas existentes que tenham sole_group_id + sole_material
-- pra corrigir fichas cujo sizes ficou esticado pelo bug anterior.
UPDATE public.technical_sheets ts SET sizes = sub.new_sizes
FROM (
  SELECT ts.id,
         CASE
           WHEN specific.sf IS NOT NULL AND specific.st IS NOT NULL AND specific.sf <= specific.st
             THEN specific.sf || '-' || specific.st
           WHEN agg.sf IS NOT NULL AND agg.st IS NOT NULL AND agg.sf <= agg.st
             THEN agg.sf || '-' || agg.st
           ELSE ts.sizes
         END AS new_sizes
    FROM public.technical_sheets ts
    LEFT JOIN LATERAL (
      SELECT MIN((p.stock_grade->>'_size_from')::int) AS sf,
             MAX((p.stock_grade->>'_size_to')::int) AS st
        FROM public.products p
       WHERE p.group_id = ts.sole_group_id
         AND p.category = 'Solado'
         AND p.active = true
         AND p.stock_grade ? '_size_from'
         AND p.stock_grade ? '_size_to'
         AND (
           lower(trim(p.name)) = lower(trim(COALESCE(ts.sole_material,'')))
           OR lower(trim(p.name)) LIKE lower(trim(COALESCE(ts.sole_material,''))) || ' %'
           OR lower(trim(p.name)) LIKE lower(trim(COALESCE(ts.sole_material,''))) || '-%'
           OR lower(trim(p.name)) LIKE lower(trim(COALESCE(ts.sole_material,''))) || '/%'
           OR lower(trim(COALESCE(ts.sole_material,''))) LIKE lower(trim(p.name)) || ' %'
           OR lower(trim(COALESCE(ts.sole_material,''))) LIKE lower(trim(p.name)) || '-%'
         )
         AND trim(COALESCE(ts.sole_material,'')) <> ''
    ) specific ON true
    LEFT JOIN LATERAL (
      SELECT MIN((p.stock_grade->>'_size_from')::int) AS sf,
             MAX((p.stock_grade->>'_size_to')::int) AS st
        FROM public.products p
       WHERE p.group_id = ts.sole_group_id
         AND p.category = 'Solado'
         AND p.active = true
         AND p.stock_grade ? '_size_from'
         AND p.stock_grade ? '_size_to'
    ) agg ON true
   WHERE ts.sole_group_id IS NOT NULL
) sub
WHERE ts.id = sub.id
  AND ts.sizes IS DISTINCT FROM sub.new_sizes;
