
CREATE TABLE public.component_sheets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  dimensions_length numeric DEFAULT 0,
  dimensions_width numeric DEFAULT 0,
  dimensions_thickness numeric DEFAULT 0,
  dimensions_unit text DEFAULT 'mm',
  yield_per_size jsonb DEFAULT '{}',
  waste_pct numeric DEFAULT 8,
  notes text DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(product_id)
);

ALTER TABLE public.component_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view component_sheets" ON public.component_sheets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert component_sheets" ON public.component_sheets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update component_sheets" ON public.component_sheets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete component_sheets" ON public.component_sheets FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_component_sheets_updated_at BEFORE UPDATE ON public.component_sheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
