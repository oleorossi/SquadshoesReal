
-- Table to link clients to representatives
CREATE TABLE public.client_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  representative_id uuid REFERENCES public.representatives(id) ON DELETE CASCADE NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(client_id, representative_id)
);

ALTER TABLE public.client_representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view client_representatives" ON public.client_representatives;
CREATE POLICY "Auth users can view client_representatives" ON public.client_representatives FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert client_representatives" ON public.client_representatives;
CREATE POLICY "Auth users can insert client_representatives" ON public.client_representatives FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can delete client_representatives" ON public.client_representatives;
CREATE POLICY "Auth users can delete client_representatives" ON public.client_representatives FOR DELETE TO authenticated USING (true);

-- Table to link economic groups to representatives
CREATE TABLE public.economic_group_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  economic_group_id uuid REFERENCES public.economic_groups(id) ON DELETE CASCADE NOT NULL,
  representative_id uuid REFERENCES public.representatives(id) ON DELETE CASCADE NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(economic_group_id, representative_id)
);

ALTER TABLE public.economic_group_representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view eg_representatives" ON public.economic_group_representatives;
CREATE POLICY "Auth users can view eg_representatives" ON public.economic_group_representatives FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert eg_representatives" ON public.economic_group_representatives;
CREATE POLICY "Auth users can insert eg_representatives" ON public.economic_group_representatives FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can delete eg_representatives" ON public.economic_group_representatives;
CREATE POLICY "Auth users can delete eg_representatives" ON public.economic_group_representatives FOR DELETE TO authenticated USING (true);
