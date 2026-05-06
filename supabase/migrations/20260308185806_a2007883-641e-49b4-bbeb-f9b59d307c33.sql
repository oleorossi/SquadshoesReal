
-- Create order_stages table for production sector tracking
CREATE TABLE public.order_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage_name text NOT NULL,
  stage_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  completed_by uuid REFERENCES auth.users(id),
  quantity_processed integer NOT NULL DEFAULT 0,
  quantity_total integer NOT NULL DEFAULT 0,
  observations text DEFAULT '',
  defects text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(order_id, stage_name)
);

-- Enable RLS
ALTER TABLE public.order_stages ENABLE ROW LEVEL SECURITY;

-- RLS policies - authenticated users can CRUD
DROP POLICY IF EXISTS "Auth users can view order_stages" ON public.order_stages;
CREATE POLICY "Auth users can view order_stages" ON public.order_stages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert order_stages" ON public.order_stages;
CREATE POLICY "Auth users can insert order_stages" ON public.order_stages FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update order_stages" ON public.order_stages;
CREATE POLICY "Auth users can update order_stages" ON public.order_stages FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete order_stages" ON public.order_stages;
CREATE POLICY "Auth users can delete order_stages" ON public.order_stages FOR DELETE TO authenticated USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_stages;
