
ALTER TABLE public.material_reservations 
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'onhand',
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS expedite boolean NOT NULL DEFAULT false;

ALTER TABLE public.purchase_orders 
  ADD COLUMN IF NOT EXISTS expedite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reference_order_id uuid,
  ADD COLUMN IF NOT EXISTS eta_days integer;

CREATE TABLE IF NOT EXISTS public.reservation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id)
);

ALTER TABLE public.reservation_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage reservation batches" ON public.reservation_batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
