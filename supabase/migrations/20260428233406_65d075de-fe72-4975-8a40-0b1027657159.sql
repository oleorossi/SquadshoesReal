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

DROP POLICY IF EXISTS "Approved users can view artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can view artisanal recipes"
  ON public.artisanal_recipes FOR SELECT TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can insert artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can insert artisanal recipes"
  ON public.artisanal_recipes FOR INSERT TO authenticated
  WITH CHECK (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can update artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can update artisanal recipes"
  ON public.artisanal_recipes FOR UPDATE TO authenticated
  USING (public.is_approved(auth.uid()));

DROP POLICY IF EXISTS "Approved users can delete artisanal recipes" ON public.artisanal_recipes;
CREATE POLICY "Approved users can delete artisanal recipes"
  ON public.artisanal_recipes FOR DELETE TO authenticated
  USING (public.is_approved(auth.uid()));

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