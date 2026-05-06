-- =====================================================================
-- Strap consumption normalization + backend/frontend alignment
-- =====================================================================
-- 1. Convert legacy meters (<1) → cm in strap_colors across all tables
-- 2. Drop legacy debit_strap_stock overloads (2-arg, 3-arg) — leave only
--    the canonical 4-arg version (per-size + cm + fichas) as single source
--    of truth for strap stock debits.
-- 3. Add validation trigger on technical_sheets to reject consumption < 1
--    going forward (cm is the only accepted unit).
-- =====================================================================

-- ---------- 1) Data normalization (meters → cm) ----------
-- technical_sheets
UPDATE technical_sheets
SET strap_colors = (
  SELECT jsonb_agg(
    CASE
      WHEN (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (sc->>'consumption')::numeric > 0
       AND (sc->>'consumption')::numeric < 1
      THEN sc || jsonb_build_object('consumption', round((sc->>'consumption')::numeric * 100, 2))
      ELSE sc
    END
  )
  FROM jsonb_array_elements(strap_colors) sc
)
WHERE strap_colors IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(strap_colors) sc
    WHERE (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
  );

-- product_references
UPDATE product_references
SET strap_colors = (
  SELECT jsonb_agg(
    CASE
      WHEN (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (sc->>'consumption')::numeric > 0
       AND (sc->>'consumption')::numeric < 1
      THEN sc || jsonb_build_object('consumption', round((sc->>'consumption')::numeric * 100, 2))
      ELSE sc
    END
  )
  FROM jsonb_array_elements(strap_colors) sc
)
WHERE strap_colors IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(strap_colors) sc
    WHERE (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
  );

-- sale_order_items
UPDATE sale_order_items
SET strap_colors = (
  SELECT jsonb_agg(
    CASE
      WHEN (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (sc->>'consumption')::numeric > 0
       AND (sc->>'consumption')::numeric < 1
      THEN sc || jsonb_build_object('consumption', round((sc->>'consumption')::numeric * 100, 2))
      ELSE sc
    END
  )
  FROM jsonb_array_elements(strap_colors) sc
)
WHERE strap_colors IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(strap_colors) sc
    WHERE (sc->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$'
      AND (sc->>'consumption')::numeric > 0
      AND (sc->>'consumption')::numeric < 1
  );

-- ---------- 2) Drop legacy debit_strap_stock overloads ----------
-- Keep only the canonical 4-arg version (with p_order_grade) which already
-- does per-size cm calculation + fichas + cm→meters conversion.
DROP FUNCTION IF EXISTS public.debit_strap_stock(jsonb, integer);
DROP FUNCTION IF EXISTS public.debit_strap_stock(jsonb, integer, uuid);

-- ---------- 3) Validation trigger: reject consumption < 1 going forward ----------
DROP FUNCTION IF EXISTS public.validate_strap_consumption_unit() CASCADE;
CREATE OR REPLACE FUNCTION public.validate_strap_consumption_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_strap jsonb;
  v_consumption numeric;
  v_label text;
BEGIN
  IF NEW.strap_colors IS NULL OR jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    IF (v_strap ? 'consumption') AND (v_strap->>'consumption') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_consumption := (v_strap->>'consumption')::numeric;
      v_label := COALESCE(v_strap->>'label', 'Tira');
      IF v_consumption > 0 AND v_consumption < 1 THEN
        RAISE EXCEPTION
          'Consumo da tira "%" inválido (%): use centímetros por par (>= 1cm). Valores menores que 1 indicam metros, formato legado.',
          v_label, v_consumption;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_strap_consumption ON technical_sheets;
CREATE TRIGGER trg_validate_strap_consumption
BEFORE INSERT OR UPDATE OF strap_colors ON technical_sheets
FOR EACH ROW EXECUTE FUNCTION public.validate_strap_consumption_unit();

DROP TRIGGER IF EXISTS trg_validate_strap_consumption ON product_references;
CREATE TRIGGER trg_validate_strap_consumption
BEFORE INSERT OR UPDATE OF strap_colors ON product_references
FOR EACH ROW EXECUTE FUNCTION public.validate_strap_consumption_unit();

DROP TRIGGER IF EXISTS trg_validate_strap_consumption ON sale_order_items;
CREATE TRIGGER trg_validate_strap_consumption
BEFORE INSERT OR UPDATE OF strap_colors ON sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.validate_strap_consumption_unit();

COMMENT ON FUNCTION public.validate_strap_consumption_unit IS
  'Valida que strap_colors[].consumption está em centímetros (>= 1). Bloqueia valores legados em metros (< 1).';