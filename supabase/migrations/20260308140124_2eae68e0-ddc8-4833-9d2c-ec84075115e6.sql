
CREATE TABLE public.ready_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_id UUID NOT NULL REFERENCES public.product_references(id) ON DELETE CASCADE,
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ready_stock_ref_color_size_idx ON public.ready_stock (reference_id, color, size);

ALTER TABLE public.ready_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view ready_stock" ON public.ready_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert ready_stock" ON public.ready_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update ready_stock" ON public.ready_stock FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete ready_stock" ON public.ready_stock FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_ready_stock_updated_at BEFORE UPDATE ON public.ready_stock
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
