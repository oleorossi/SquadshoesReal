
-- Employees table
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text DEFAULT '',
  whatsapp text DEFAULT '',
  pix_key text DEFAULT '',
  pix_type text DEFAULT 'cpf',
  salary numeric NOT NULL DEFAULT 0,
  role text DEFAULT '',
  department text DEFAULT '',
  admission_date date DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view employees" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert employees" ON public.employees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update employees" ON public.employees FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete employees" ON public.employees FOR DELETE TO authenticated USING (true);

-- Employee advances (vales) table
CREATE TABLE public.employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  advance_date date NOT NULL DEFAULT CURRENT_DATE,
  time text DEFAULT '',
  description text DEFAULT '',
  receipt_url text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view advances" ON public.employee_advances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert advances" ON public.employee_advances FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update advances" ON public.employee_advances FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete advances" ON public.employee_advances FOR DELETE TO authenticated USING (true);

-- Storage bucket for advance receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('employee-receipts', 'employee-receipts', true);

CREATE POLICY "Auth users can upload receipts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'employee-receipts');
CREATE POLICY "Anyone can view receipts" ON storage.objects FOR SELECT USING (bucket_id = 'employee-receipts');
CREATE POLICY "Auth users can delete receipts" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'employee-receipts');
