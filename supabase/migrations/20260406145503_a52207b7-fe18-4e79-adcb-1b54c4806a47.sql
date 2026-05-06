ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS sale_order_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_sale_order_item_id_fkey'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
    ADD CONSTRAINT orders_sale_order_item_id_fkey
    FOREIGN KEY (sale_order_item_id)
    REFERENCES public.sale_order_items(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_sale_order_item_id
ON public.orders (sale_order_item_id);

WITH ranked_matches AS (
  SELECT
    o.id AS order_id,
    soi.id AS sale_order_item_id,
    ROW_NUMBER() OVER (
      PARTITION BY o.id
      ORDER BY
        CASE WHEN COALESCE(o.quantity, 0) = COALESCE(soi.quantity, 0) THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(o.grade::text, '') = COALESCE(soi.grade::text, '') THEN 0 ELSE 1 END,
        CASE WHEN UPPER(COALESCE(o.item_observation, '')) = UPPER(COALESCE(soi.observation, '')) THEN 0 ELSE 1 END,
        ABS(COALESCE(o.quantity, 0) - COALESCE(soi.quantity, 0)),
        soi.created_at,
        soi.id
    ) AS order_rank,
    ROW_NUMBER() OVER (
      PARTITION BY soi.id
      ORDER BY
        CASE WHEN COALESCE(o.quantity, 0) = COALESCE(soi.quantity, 0) THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(o.grade::text, '') = COALESCE(soi.grade::text, '') THEN 0 ELSE 1 END,
        CASE WHEN UPPER(COALESCE(o.item_observation, '')) = UPPER(COALESCE(soi.observation, '')) THEN 0 ELSE 1 END,
        ABS(COALESCE(o.quantity, 0) - COALESCE(soi.quantity, 0)),
        o.created_at,
        o.id
    ) AS item_rank
  FROM public.orders o
  JOIN public.sale_order_items soi
    ON soi.sale_order_id = o.sale_order_id
   AND soi.reference_id = o.reference_id
   AND UPPER(COALESCE(soi.color, '')) = UPPER(COALESCE(o.color, ''))
  WHERE o.sale_order_id IS NOT NULL
    AND o.sale_order_item_id IS NULL
),
best_matches AS (
  SELECT order_id, sale_order_item_id
  FROM ranked_matches
  WHERE order_rank = 1
    AND item_rank = 1
)
UPDATE public.orders o
SET sale_order_item_id = b.sale_order_item_id
FROM best_matches b
WHERE o.id = b.order_id;