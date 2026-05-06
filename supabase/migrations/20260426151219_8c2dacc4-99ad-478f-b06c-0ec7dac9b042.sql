-- 20260421100000_add-minimum-overtime-to-work-schedules.sql
ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN work_schedules.minimum_overtime_minutes IS
  'Minimum weekly overtime minutes required before overtime is counted. Below this threshold the excess is ignored (not paid, not accumulated).';

-- 20260421120000_artisanal-recipes.sql
CREATE TABLE IF NOT EXISTS artisanal_recipes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  artisanal_product_name TEXT NOT NULL,
  base_product_name      TEXT NOT NULL,
  yield_per_meter        NUMERIC NOT NULL DEFAULT 1 CHECK (yield_per_meter > 0),
  labor_cost_per_meter   NUMERIC NOT NULL DEFAULT 0,
  default_contractor_id  UUID REFERENCES contractors(id) ON DELETE SET NULL,
  notes                  TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE artisanal_recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view artisanal recipes" ON artisanal_recipes;
CREATE POLICY "Authenticated users can view artisanal recipes"
  ON artisanal_recipes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage artisanal recipes" ON artisanal_recipes;
CREATE POLICY "Authenticated users can manage artisanal recipes"
  ON artisanal_recipes FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_artisanal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS artisanal_recipe_id        UUID REFERENCES artisanal_recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisanal_output_name      TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_color     TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_output_meters    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_for_stock_meters NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS artisanal_base_color       TEXT,
  ADD COLUMN IF NOT EXISTS artisanal_stock_entry_done BOOLEAN DEFAULT false;

CREATE OR REPLACE FUNCTION artisanal_recipes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS artisanal_recipes_updated_at ON artisanal_recipes;
CREATE TRIGGER artisanal_recipes_updated_at
  BEFORE UPDATE ON artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION artisanal_recipes_set_updated_at();