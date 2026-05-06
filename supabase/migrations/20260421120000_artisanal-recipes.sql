-- ── Artisanal Recipes ─────────────────────────────────────────────────────────
-- Links an artisanal output material (e.g. "Tira Overlock 5mm") to a base raw
-- material (e.g. "Napa Soft") with a yield ratio (output meters per 1 m of base)
-- and a labor cost per meter of output. Default contractor is pre-selected when
-- creating a service order from this recipe.

CREATE TABLE IF NOT EXISTS artisanal_recipes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  artisanal_product_name TEXT NOT NULL,   -- output material type (matches product group or base name)
  base_product_name      TEXT NOT NULL,   -- raw material type sent to contractor
  yield_per_meter        NUMERIC NOT NULL DEFAULT 1 CHECK (yield_per_meter > 0),
  labor_cost_per_meter   NUMERIC NOT NULL DEFAULT 0,
  default_contractor_id  UUID REFERENCES contractors(id) ON DELETE SET NULL,
  notes                  TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Flag products that are produced artisanally (used for stock/alert display)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_artisanal BOOLEAN NOT NULL DEFAULT false;

-- Extend service_orders with artisanal production tracking columns
ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS artisanal_recipe_id        UUID REFERENCES artisanal_recipes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artisanal_output_name      TEXT,          -- product type being produced
  ADD COLUMN IF NOT EXISTS artisanal_output_color     TEXT,          -- color of output material
  ADD COLUMN IF NOT EXISTS artisanal_output_meters    NUMERIC DEFAULT 0, -- total meters to be produced
  ADD COLUMN IF NOT EXISTS artisanal_for_order_meters NUMERIC DEFAULT 0, -- portion for linked order
  ADD COLUMN IF NOT EXISTS artisanal_for_stock_meters NUMERIC DEFAULT 0, -- portion to restore min stock
  ADD COLUMN IF NOT EXISTS artisanal_base_color       TEXT,          -- color of base material sent
  ADD COLUMN IF NOT EXISTS artisanal_stock_entry_done BOOLEAN DEFAULT false; -- prevents double entry

-- Auto-update updated_at on artisanal_recipes
CREATE OR REPLACE FUNCTION artisanal_recipes_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS artisanal_recipes_updated_at ON artisanal_recipes;
CREATE TRIGGER artisanal_recipes_updated_at
  BEFORE UPDATE ON artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION artisanal_recipes_set_updated_at();
