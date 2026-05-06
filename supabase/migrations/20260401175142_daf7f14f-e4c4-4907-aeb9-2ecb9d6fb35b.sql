ALTER TABLE public.technical_sheet_sole_colors
ADD COLUMN IF NOT EXISTS sole_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_technical_sheet_sole_colors_sole_product_id
ON public.technical_sheet_sole_colors (sole_product_id);

WITH candidates AS (
  SELECT
    tsc.id AS mapping_id,
    p.id AS product_id,
    ROW_NUMBER() OVER (
      PARTITION BY tsc.id
      ORDER BY
        CASE
          WHEN UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(tsc.product_color)) THEN 0
          ELSE 1
        END,
        p.updated_at DESC NULLS LAST,
        p.created_at DESC NULLS LAST,
        p.id
    ) AS rn
  FROM public.technical_sheet_sole_colors tsc
  JOIN public.products p
    ON p.group_id = tsc.sole_group_id
   AND p.active = true
  WHERE tsc.sole_product_id IS NULL
    AND tsc.sole_group_id IS NOT NULL
)
UPDATE public.technical_sheet_sole_colors tsc
SET sole_product_id = candidates.product_id
FROM candidates
WHERE candidates.mapping_id = tsc.id
  AND candidates.rn = 1;

DROP FUNCTION IF EXISTS public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id uuid;
  v_sole_material text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id uuid;
  target_product_id uuid;
  target_name text;
  v_stock_grade jsonb;
  v_size text;
  v_size_qty numeric;
  v_available numeric;
  v_new_grade jsonb;
  v_total_debited numeric := 0;
  v_prev_total numeric;
BEGIN
  SELECT ts.sole_group_id, ts.sole_material
  INTO v_sole_group_id, v_sole_material
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  SELECT tsc.sole_product_id, tsc.sole_group_id
  INTO v_mapped_sole_product_id, v_mapped_sole_group_id
  FROM public.technical_sheet_sole_colors tsc
  WHERE tsc.sheet_id = p_reference_id
    AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
  LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
    INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true
      AND p.id = v_mapped_sole_product_id
    LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
      LIMIT 1;
    END IF;

    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true
        AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
      LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN
    RETURN;
  END IF;

  IF v_stock_grade IS NULL THEN
    v_stock_grade := '{}'::jsonb;
  END IF;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;

  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade)
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
    FROM jsonb_each_text(p_order_grade)
    WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
    SET stock_grade = v_new_grade,
        quantity = GREATEST(0, quantity - v_total_debited),
        updated_at = now()
    WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity,
      previous_stock,
      new_stock,
      description,
      order_id
    )
    VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' || CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;