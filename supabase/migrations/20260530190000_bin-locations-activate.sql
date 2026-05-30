-- Quick win 4 do roadmap (auditoria 30/05). Bin locations ativos.
-- Tabela bin_locations já existia (0 registros) com estrutura completa.
-- Faltava: vínculo a products (FK opcional), RLS e view pra UI.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_bin_location_id uuid
    REFERENCES public.bin_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_bin_location_idx
  ON public.products(default_bin_location_id) WHERE default_bin_location_id IS NOT NULL;

ALTER TABLE public.bin_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bin_locations_select ON public.bin_locations;
CREATE POLICY bin_locations_select ON public.bin_locations
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS bin_locations_write ON public.bin_locations;
CREATE POLICY bin_locations_write ON public.bin_locations
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','almoxarifado']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','almoxarifado']));

CREATE OR REPLACE VIEW public.v_products_with_location AS
SELECT
  p.id, p.name, p.sku, p.category, p.quantity, p.unit, p.min_stock,
  p.default_bin_location_id,
  bl.code AS bin_code, bl.name AS bin_name,
  bl.warehouse AS bin_warehouse, bl.zone AS bin_zone, bl.aisle AS bin_aisle,
  bl.rack AS bin_rack, bl.shelf AS bin_shelf, bl.bin AS bin_position
FROM public.products p
LEFT JOIN public.bin_locations bl ON bl.id = p.default_bin_location_id;

ALTER VIEW public.v_products_with_location SET (security_invoker = on);
GRANT SELECT ON public.v_products_with_location TO authenticated;
