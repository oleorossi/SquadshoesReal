-- Fix ON CONFLICT error in sync_sale_order_wave_items()
-- The function upserts on (wave_item_id, sale_order_id, sale_order_item_id) but no matching unique constraint exists.
-- Use NULLS NOT DISTINCT so rows where sale_order_item_id IS NULL are also deduplicated correctly (PG15+).

CREATE UNIQUE INDEX IF NOT EXISTS uq_wave_sources_item_so_soitem
  ON public.production_wave_item_sources (wave_item_id, sale_order_id, sale_order_item_id)
  NULLS NOT DISTINCT;