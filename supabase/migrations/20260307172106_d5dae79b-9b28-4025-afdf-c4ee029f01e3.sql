
CREATE TABLE public.representatives (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  commission_pct NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view representatives" ON public.representatives;
CREATE POLICY "Auth users can view representatives" ON public.representatives FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert representatives" ON public.representatives;
CREATE POLICY "Auth users can insert representatives" ON public.representatives FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update representatives" ON public.representatives;
CREATE POLICY "Auth users can update representatives" ON public.representatives FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete representatives" ON public.representatives;
CREATE POLICY "Auth users can delete representatives" ON public.representatives FOR DELETE TO authenticated USING (true);

ALTER TABLE public.sale_orders ADD COLUMN representative_id UUID REFERENCES public.representatives(id) ON DELETE SET NULL;
ALTER TABLE public.sale_orders ADD COLUMN commission_value NUMERIC NOT NULL DEFAULT 0;
