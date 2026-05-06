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

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_artisanal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS artisanal_recipe_id        UUID REFERENCES public.artisanal_recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisanal_output_name      TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_color     TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_meters    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_stock_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0, -- Repetido no script original, cuidando para não dar erro
  ADD COLUMN IF NOT EXISTS artisanal_base_color       TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_stock_entry_done BOOLEAN DEFAULT false;

-- Remover duplicatas de colunas se houver erro (IF NOT EXISTS já cuida disso)

DROP FUNCTION IF EXISTS public.artisanal_recipes_set_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.artisanal_recipes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS artisanal_recipes_updated_at ON public.artisanal_recipes;
CREATE TRIGGER artisanal_recipes_updated_at
  BEFORE UPDATE ON public.artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION public.artisanal_recipes_set_updated_at();

ALTER TABLE public.artisanal_recipes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.artisanal_recipes TO authenticated;

-- Políticas
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated select artisanal_recipes') THEN
    DROP POLICY IF EXISTS "Allow authenticated select artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated select artisanal_recipes" ON public.artisanal_recipes FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated insert artisanal_recipes') THEN
    DROP POLICY IF EXISTS "Allow authenticated insert artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated insert artisanal_recipes" ON public.artisanal_recipes FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated update artisanal_recipes') THEN
    DROP POLICY IF EXISTS "Allow authenticated update artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated update artisanal_recipes" ON public.artisanal_recipes FOR UPDATE TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated delete artisanal_recipes') THEN
    DROP POLICY IF EXISTS "Allow authenticated delete artisanal_recipes" ON public.artisanal_recipes;
CREATE POLICY "Allow authenticated delete artisanal_recipes" ON public.artisanal_recipes FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
