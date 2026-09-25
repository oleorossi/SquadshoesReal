-- Demanda de dublagem (faces + cola): schema.
-- Canal paralelo (espelha cabedal_prep) — NÃO explode camadas em
-- orderConsumption / hybrid_debit. Cola só entra no custeio (sem estoque/OC).

-- ─── source_type novo nas OCs ───────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type CHECK (source_type = ANY (ARRAY[
    'manual'::text, 'mrp'::text, 'per_pv'::text, 'manual_avulsa'::text,
    'auto_pv'::text, 'auto_op'::text, 'rop'::text, 'strap_demand'::text,
    'cabedal_prep'::text, 'dublagem'::text
  ]));

-- ─── Tipos de cola no grupo composto ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_group_dublagem_glues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composite_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_per_m numeric NOT NULL DEFAULT 0 CHECK (price_per_m >= 0),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_group_dublagem_glues_name_nonempty
    CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_group_dublagem_glues_name
  ON public.product_group_dublagem_glues (composite_group_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_product_group_dublagem_glues_group
  ON public.product_group_dublagem_glues (composite_group_id)
  WHERE is_active;

ALTER TABLE public.product_group_dublagem_glues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_group_dublagem_glues_all ON public.product_group_dublagem_glues;
CREATE POLICY product_group_dublagem_glues_all ON public.product_group_dublagem_glues
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ─── Cola padrão na ficha ───────────────────────────────────────────────────
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS dublagem_glue_id uuid
    REFERENCES public.product_group_dublagem_glues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_technical_sheets_dublagem_glue
  ON public.technical_sheets (dublagem_glue_id)
  WHERE dublagem_glue_id IS NOT NULL;

-- ─── Modo no item do PV (null = legado: compra/debita acabado) ──────────────
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS dublagem_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sale_order_items_dublagem_mode_chk'
       AND conrelid = 'public.sale_order_items'::regclass
  ) THEN
    ALTER TABLE public.sale_order_items
      ADD CONSTRAINT sale_order_items_dublagem_mode_chk
      CHECK (
        dublagem_mode IS NULL
        OR dublagem_mode = ANY (ARRAY['internal'::text, 'external'::text])
      );
  END IF;
END $$;

-- ─── Demandas por face ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dublagem_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  sale_order_item_id uuid NOT NULL REFERENCES public.sale_order_items(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode = ANY (ARRAY['internal'::text, 'external'::text])),
  face text NOT NULL CHECK (face = ANY (ARRAY['external'::text, 'internal'::text])),
  component_group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  color text,
  dm2 numeric NOT NULL DEFAULT 0 CHECK (dm2 >= 0),
  linear_m numeric NOT NULL DEFAULT 0 CHECK (linear_m >= 0),
  glue_id uuid REFERENCES public.product_group_dublagem_glues(id) ON DELETE SET NULL,
  glue_price_per_m numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY[
    'open'::text, 'reserved'::text, 'ordered'::text, 'done'::text, 'cancelled'::text
  ])),
  material_reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_order_item_id, face)
);

CREATE INDEX IF NOT EXISTS idx_dublagem_demands_so
  ON public.dublagem_demands (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_dublagem_demands_item
  ON public.dublagem_demands (sale_order_item_id);
CREATE INDEX IF NOT EXISTS idx_dublagem_demands_product
  ON public.dublagem_demands (product_id)
  WHERE status IN ('open', 'reserved', 'ordered');

ALTER TABLE public.dublagem_demands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dublagem_demands_all ON public.dublagem_demands;
CREATE POLICY dublagem_demands_all ON public.dublagem_demands
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- Soft-reserva sem OP: origem por dublagem_demand_id (espelha strap_demand).
ALTER TABLE public.material_reservations
  ADD COLUMN IF NOT EXISTS dublagem_demand_id uuid
    REFERENCES public.dublagem_demands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_reservations_dublagem_demand
  ON public.material_reservations (dublagem_demand_id)
  WHERE dublagem_demand_id IS NOT NULL;

ALTER TABLE public.material_reservations
  DROP CONSTRAINT IF EXISTS material_reservations_origin_ck;
ALTER TABLE public.material_reservations
  ADD CONSTRAINT material_reservations_origin_ck CHECK (
    (order_id IS NOT NULL)
    OR (num_nonnulls(
      sale_order_strap_demand_id,
      strap_stock_floor_contribution_id,
      dublagem_demand_id
    ) = 1)
  );

COMMENT ON TABLE public.product_group_dublagem_glues IS
  'Tipos de cola de dublagem no grupo composto: nome + R$/m (só custeio).';
COMMENT ON TABLE public.dublagem_demands IS
  'Demanda por face (externa/interna) quando o item do PV tem dublagem_mode.';
COMMENT ON COLUMN public.sale_order_items.dublagem_mode IS
  'internal|external|null — null = legado (acabado no per_pv/débito).';
COMMENT ON COLUMN public.technical_sheets.dublagem_glue_id IS
  'Cola padrão da ficha; item do PV só herda (read-only).';
