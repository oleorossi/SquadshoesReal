
-- Tabela de fornecedores independente
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  trade_name TEXT DEFAULT '',
  cnpj TEXT DEFAULT '',
  ie TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip_code TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  lead_time_days INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Notas fiscais importadas
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_series TEXT DEFAULT '',
  invoice_key TEXT DEFAULT '',
  issue_date DATE,
  total_value NUMERIC NOT NULL DEFAULT 0,
  freight_value NUMERIC DEFAULT 0,
  discount_value NUMERIC DEFAULT 0,
  notes TEXT DEFAULT '',
  xml_data TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'imported',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Itens da nota fiscal
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_code TEXT DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  ncm TEXT DEFAULT '',
  cfop TEXT DEFAULT '',
  unit TEXT DEFAULT 'un',
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total_price NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  -- Vínculo opcional com produto do estoque
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  added_to_stock BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth users can view invoices" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update invoices" ON public.invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete invoices" ON public.invoices FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth users can view invoice_items" ON public.invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert invoice_items" ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update invoice_items" ON public.invoice_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete invoice_items" ON public.invoice_items FOR DELETE TO authenticated USING (true);

-- Triggers
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
