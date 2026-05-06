CREATE TABLE IF NOT EXISTS public.sole_size_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  size_key text NOT NULL,
  sizes integer[] NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sole_group_id, size_key)
);

ALTER TABLE public.sole_size_conjugations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can view sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can view sole size conjugations"
  ON public.sole_size_conjugations FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can insert sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can insert sole size conjugations"
  ON public.sole_size_conjugations FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can update sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can update sole size conjugations"
  ON public.sole_size_conjugations FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can delete sole size conjugations" ON public.sole_size_conjugations;
CREATE POLICY "Approved users can delete sole size conjugations"
  ON public.sole_size_conjugations FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()));

CREATE OR REPLACE FUNCTION public.get_sole_size_key(p_sole_group_id uuid, p_shoe_size integer)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT size_key
  FROM public.sole_size_conjugations
  WHERE sole_group_id = p_sole_group_id
    AND p_shoe_size = ANY(sizes)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_sole_group_id_for_product(p_product_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT group_id FROM public.products WHERE id = p_product_id LIMIT 1;
$$;

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
  v_product_group_id uuid;
  v_conj_grade jsonb;
  v_conj_key text;
  v_existing_qty numeric;
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
    SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
    FROM public.products p
    WHERE p.active = true AND p.id = v_mapped_sole_product_id LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color)) LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color)) LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      WHERE p.active = true AND p.group_id = v_sole_group_id
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
        AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color)) LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
      JOIN public.product_groups pg ON pg.id = p.group_id
      WHERE p.active = true AND pg.name = v_sole_material
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;
  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id FROM public.products p WHERE p.id = target_product_id;

  v_conj_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
  LOOP
    v_conj_key := NULL;
    IF v_product_group_id IS NOT NULL THEN
      SELECT public.get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
    END IF;

    IF v_conj_key IS NOT NULL AND (v_stock_grade ->> v_conj_key) IS NOT NULL THEN
      v_existing_qty := COALESCE((v_conj_grade ->> v_conj_key)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty));
    ELSE
      v_existing_qty := COALESCE((v_conj_grade ->> v_size)::numeric, 0);
      v_conj_grade := jsonb_set(v_conj_grade, ARRAY[v_size], to_jsonb(v_existing_qty + v_size_qty));
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  v_prev_total := 0;
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_conj_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponivel %, necessario %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_conj_grade) WHERE value::numeric > 0
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
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id, 'out', v_total_debited, v_prev_total, v_prev_total - v_total_debited,
      'Debito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor do produto: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;