
-- Tabela de fornecedores vinculados a grupos de produtos
CREATE TABLE public.group_suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL DEFAULT '',
  supplier_cnpj TEXT DEFAULT '',
  supplier_contact TEXT DEFAULT '',
  supplier_phone TEXT DEFAULT '',
  supplier_email TEXT DEFAULT '',
  supplier_address TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  lead_time_days INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de materiais/itens de cada fornecedor no grupo
CREATE TABLE public.group_supplier_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.group_suppliers(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL DEFAULT '',
  material_code TEXT DEFAULT '',
  color TEXT DEFAULT '',
  width TEXT DEFAULT '',
  weight TEXT DEFAULT '',
  thickness TEXT DEFAULT '',
  composition TEXT DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'metro',
  unit_price NUMERIC NOT NULL DEFAULT 0,
  minimum_order NUMERIC DEFAULT 0,
  stock_available NUMERIC DEFAULT 0,
  -- Nota fiscal
  invoice_number TEXT DEFAULT '',
  invoice_date DATE,
  invoice_value NUMERIC DEFAULT 0,
  invoice_key TEXT DEFAULT '',
  -- Extras
  notes TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.group_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_supplier_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view group_suppliers" ON public.group_suppliers;
CREATE POLICY "Auth users can view group_suppliers" ON public.group_suppliers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert group_suppliers" ON public.group_suppliers;
CREATE POLICY "Auth users can insert group_suppliers" ON public.group_suppliers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update group_suppliers" ON public.group_suppliers;
CREATE POLICY "Auth users can update group_suppliers" ON public.group_suppliers FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete group_suppliers" ON public.group_suppliers;
CREATE POLICY "Auth users can delete group_suppliers" ON public.group_suppliers FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users can view group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Auth users can view group_supplier_materials" ON public.group_supplier_materials FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Auth users can insert group_supplier_materials" ON public.group_supplier_materials FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Auth users can update group_supplier_materials" ON public.group_supplier_materials FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete group_supplier_materials" ON public.group_supplier_materials;
CREATE POLICY "Auth users can delete group_supplier_materials" ON public.group_supplier_materials FOR DELETE TO authenticated USING (true);

-- Trigger updated_at
CREATE TRIGGER update_group_suppliers_updated_at BEFORE UPDATE ON public.group_suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_group_supplier_materials_updated_at BEFORE UPDATE ON public.group_supplier_materials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
