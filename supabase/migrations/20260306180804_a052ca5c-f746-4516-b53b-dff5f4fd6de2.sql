
-- Contas a Pagar
CREATE TABLE public.accounts_payable (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'material',
  due_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_date DATE,
  payment_method TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  boleto_number TEXT DEFAULT '',
  installment_number INTEGER DEFAULT 1,
  total_installments INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Contas a Receber
CREATE TABLE public.accounts_receivable (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  client_cnpj TEXT DEFAULT '',
  sale_order_id UUID REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'venda',
  due_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  amount_received NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_date DATE,
  payment_method TEXT DEFAULT '',
  installment_number INTEGER DEFAULT 1,
  total_installments INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.accounts_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_receivable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view accounts_payable" ON public.accounts_payable FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert accounts_payable" ON public.accounts_payable FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update accounts_payable" ON public.accounts_payable FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete accounts_payable" ON public.accounts_payable FOR DELETE TO authenticated USING (true);

CREATE POLICY "Auth users can view accounts_receivable" ON public.accounts_receivable FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can insert accounts_receivable" ON public.accounts_receivable FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth users can update accounts_receivable" ON public.accounts_receivable FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth users can delete accounts_receivable" ON public.accounts_receivable FOR DELETE TO authenticated USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_accounts_payable_updated_at BEFORE UPDATE ON public.accounts_payable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_accounts_receivable_updated_at BEFORE UPDATE ON public.accounts_receivable FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
