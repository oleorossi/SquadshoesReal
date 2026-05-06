-- 1. Fix debit_strap_stock
DROP FUNCTION IF EXISTS public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid, p_order_grade jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL::uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_product_id uuid;
  v_product_name text;
  v_product_color text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;
  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;
    IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN
      CONTINUE;
    END IF;
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 1);
    IF v_consumption <= 0 THEN v_consumption := 1; END IF;
    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;
      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN
        v_fichas := GREATEST(1, round(p_order_quantity::numeric / v_grade_total));
      ELSE
        v_fichas := 1;
      END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := v_consumption * p_order_quantity;
    END IF;
    IF v_required <= 0 THEN CONTINUE; END IF;
    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(p.color)) = lower(trim(v_color))
    LIMIT 1;
    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1;
    END IF;
    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
        FROM public.products p
        WHERE p.active = true AND p.group_id = v_group_id
        LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION
            'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION
            'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;
    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %.4f, necessário %.4f metros.',
        v_product_name, v_color, v_current_qty, v_required;
    END IF;
    UPDATE public.products
    SET quantity = quantity - v_required, updated_at = now()
    WHERE id = v_product_id;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (
      v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;
END;
$function$;

-- 2. Minimum overtime threshold
ALTER TABLE public.work_schedules
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0;

-- 3. Artisanal Recipes
CREATE TABLE IF NOT EXISTS public.artisanal_recipes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  artisanal_product_name TEXT NOT NULL,
  base_product_name      TEXT NOT NULL,
  yield_per_meter        NUMERIC NOT NULL DEFAULT 1 CHECK (yield_per_meter > 0),
  labor_cost_per_meter   NUMERIC NOT NULL DEFAULT 0,
  default_contractor_id  UUID REFERENCES public.contractors(id) ON DELETE SET NULL,
  notes                  TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.artisanal_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can view artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can view artisanal_recipes"
  ON public.artisanal_recipes FOR SELECT TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can insert artisanal_recipes"
  ON public.artisanal_recipes FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can update artisanal_recipes"
  ON public.artisanal_recipes FOR UPDATE TO authenticated
  USING (public.is_approved_user());

DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can delete artisanal_recipes"
  ON public.artisanal_recipes FOR DELETE TO authenticated
  USING (public.is_approved_user());

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_artisanal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS artisanal_recipe_id        UUID REFERENCES public.artisanal_recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisanal_output_name      TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_color     TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_meters    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_stock_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_base_color       TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_stock_entry_done BOOLEAN DEFAULT false;

DROP FUNCTION IF EXISTS public.artisanal_recipes_set_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.artisanal_recipes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS artisanal_recipes_updated_at ON public.artisanal_recipes;
CREATE TRIGGER artisanal_recipes_updated_at
  BEFORE UPDATE ON public.artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION public.artisanal_recipes_set_updated_at();