-- Add structured grade breakdown to purchase_order_items (for sole items)
-- and a color snapshot column for efficient PDF rendering

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS grade   jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS color   text    DEFAULT NULL;

COMMENT ON COLUMN public.purchase_order_items.grade IS
  'For sole items: {size_key: quantity} breakdown, e.g. {"36": 10, "37": 20, "23/24": 5}';

COMMENT ON COLUMN public.purchase_order_items.color IS
  'Product color snapshot at time of order creation (used for sole PDF grouping)';
