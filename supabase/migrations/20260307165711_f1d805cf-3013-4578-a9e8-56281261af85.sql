
-- Clients table
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social text NOT NULL,
  nome_fantasia text DEFAULT '',
  cnpj text DEFAULT '',
  inscricao_estadual text DEFAULT '',
  endereco text DEFAULT '',
  cidade text DEFAULT '',
  estado text DEFAULT '',
  cep text DEFAULT '',
  email text DEFAULT '',
  telefone text DEFAULT '',
  contato text DEFAULT '',
  notes text DEFAULT '',
  economic_group_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Economic groups table
CREATE TABLE public.economic_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add FK
ALTER TABLE public.clients ADD CONSTRAINT clients_economic_group_id_fkey FOREIGN KEY (economic_group_id) REFERENCES public.economic_groups(id) ON DELETE SET NULL;

-- Add client_id to sale_orders
ALTER TABLE public.sale_orders ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.economic_groups ENABLE ROW LEVEL SECURITY;

-- RLS policies for clients
DROP POLICY IF EXISTS "Auth users can view clients" ON public.clients;
CREATE POLICY "Auth users can view clients" ON public.clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert clients" ON public.clients;
CREATE POLICY "Auth users can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update clients" ON public.clients;
CREATE POLICY "Auth users can update clients" ON public.clients FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete clients" ON public.clients;
CREATE POLICY "Auth users can delete clients" ON public.clients FOR DELETE TO authenticated USING (true);

-- RLS policies for economic_groups
DROP POLICY IF EXISTS "Auth users can view economic_groups" ON public.economic_groups;
CREATE POLICY "Auth users can view economic_groups" ON public.economic_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert economic_groups" ON public.economic_groups;
CREATE POLICY "Auth users can insert economic_groups" ON public.economic_groups FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update economic_groups" ON public.economic_groups;
CREATE POLICY "Auth users can update economic_groups" ON public.economic_groups FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete economic_groups" ON public.economic_groups;
CREATE POLICY "Auth users can delete economic_groups" ON public.economic_groups FOR DELETE TO authenticated USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_economic_groups_updated_at BEFORE UPDATE ON public.economic_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
