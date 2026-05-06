-- Create a table for inventory products
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  min_stock NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'un',
  unit_price NUMERIC NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Public access policies (no auth required for this inventory app)
CREATE POLICY "Anyone can view products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Anyone can insert products" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update products" ON public.products FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete products" ON public.products FOR DELETE USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert seed data
INSERT INTO public.products (name, sku, category, quantity, min_stock, unit, unit_price, location) VALUES
  ('Aço Carbono SAE 1020', 'MP-001', 'Matéria-Prima', 450, 100, 'kg', 8.50, 'Galpão A'),
  ('Parafuso M8x30', 'CP-012', 'Componentes', 12000, 5000, 'un', 0.35, 'Almoxarifado'),
  ('Óleo Hidráulico ISO 68', 'QM-003', 'Químicos', 30, 50, 'L', 22.00, 'Galpão C'),
  ('Caixa Papelão 40x30x20', 'EM-007', 'Embalagens', 800, 200, 'un', 3.20, 'Galpão B'),
  ('Luva Nitrílica G', 'EP-002', 'EPI', 15, 50, 'par', 12.90, 'Almoxarifado'),
  ('Rolamento 6205-2RS', 'MN-009', 'Manutenção', 24, 10, 'un', 45.00, 'Almoxarifado'),
  ('Chapa Alumínio 2mm', 'MP-015', 'Matéria-Prima', 60, 30, 'm', 95.00, 'Galpão A'),
  ('Broca HSS 10mm', 'FR-004', 'Ferramentas', 8, 15, 'un', 28.50, 'Almoxarifado'),
  ('Motor Elétrico 3CV', 'PA-021', 'Produtos Acabados', 5, 3, 'un', 1850.00, 'Galpão B'),
  ('Fita Isolante 19mm', 'MN-033', 'Manutenção', 45, 20, 'rolo', 7.80, 'Almoxarifado');