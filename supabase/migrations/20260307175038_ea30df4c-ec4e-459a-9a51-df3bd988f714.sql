
-- Tabela de terceirizados (prestadores de serviço)
CREATE TABLE public.contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trade_name text DEFAULT '',
  cnpj_cpf text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  city text DEFAULT '',
  state text DEFAULT '',
  service_type text DEFAULT '',
  notes text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view contractors" ON public.contractors;
CREATE POLICY "Auth users can view contractors" ON public.contractors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert contractors" ON public.contractors;
CREATE POLICY "Auth users can insert contractors" ON public.contractors FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update contractors" ON public.contractors;
CREATE POLICY "Auth users can update contractors" ON public.contractors FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete contractors" ON public.contractors;
CREATE POLICY "Auth users can delete contractors" ON public.contractors FOR DELETE TO authenticated USING (true);

-- Tabela de pedidos de serviço
CREATE TABLE public.service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  order_number text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  service_time text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pendente',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view service_orders" ON public.service_orders;
CREATE POLICY "Auth users can view service_orders" ON public.service_orders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert service_orders" ON public.service_orders;
CREATE POLICY "Auth users can insert service_orders" ON public.service_orders FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update service_orders" ON public.service_orders;
CREATE POLICY "Auth users can update service_orders" ON public.service_orders FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete service_orders" ON public.service_orders;
CREATE POLICY "Auth users can delete service_orders" ON public.service_orders FOR DELETE TO authenticated USING (true);

-- Sequence para numeração automática dos pedidos de serviço
CREATE SEQUENCE IF NOT EXISTS so_number_seq START 1;

DROP FUNCTION IF EXISTS public.generate_so_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_so_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('so_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_so_number
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_so_number();

-- Trigger updated_at
CREATE TRIGGER set_contractors_updated_at
  BEFORE UPDATE ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_service_orders_updated_at
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
