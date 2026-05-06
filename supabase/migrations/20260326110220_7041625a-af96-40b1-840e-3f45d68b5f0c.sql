
-- =====================================================
-- 1) GOODS ISSUES - Documento formal de saída de materiais
-- =====================================================
CREATE TABLE public.goods_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  issue_number text NOT NULL DEFAULT '',
  issue_type text NOT NULL DEFAULT 'production',
  status text NOT NULL DEFAULT 'pending',
  issued_by text DEFAULT '',
  issued_at timestamptz,
  confirmed_by text DEFAULT '',
  confirmed_at timestamptz,
  reversed_at timestamptz,
  reversed_by text DEFAULT '',
  notes text DEFAULT '',
  total_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.goods_issue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_issue_id uuid REFERENCES public.goods_issues(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  product_sku text DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'un',
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  lot_number text DEFAULT '',
  bin_location text DEFAULT '',
  reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS gi_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_gi_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.issue_number = '' OR NEW.issue_number IS NULL THEN
    NEW.issue_number := 'GI-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('gi_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_gi_number
  BEFORE INSERT ON public.goods_issues
  FOR EACH ROW EXECUTE FUNCTION public.generate_gi_number();

-- =====================================================
-- 2) WIP LEDGER - Controle contábil Work In Progress
-- =====================================================
CREATE TABLE public.wip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  entry_type text NOT NULL DEFAULT 'material_in',
  goods_issue_id uuid REFERENCES public.goods_issues(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.order_stages(id) ON DELETE SET NULL,
  description text DEFAULT '',
  debit_account text DEFAULT '',
  credit_account text DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric DEFAULT 0,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 3) FINISHED GOODS RECEIPTS - Recebimento PA
-- =====================================================
CREATE TABLE public.finished_goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  receipt_number text NOT NULL DEFAULT '',
  quantity_good numeric NOT NULL DEFAULT 0,
  quantity_scrap numeric NOT NULL DEFAULT 0,
  quantity_rework numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  inspection_status text NOT NULL DEFAULT 'pending',
  inspected_by text DEFAULT '',
  inspected_at timestamptz,
  lot_number text DEFAULT '',
  production_date date DEFAULT CURRENT_DATE,
  received_by text DEFAULT '',
  received_at timestamptz,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS fgr_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_fgr_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.receipt_number = '' OR NEW.receipt_number IS NULL THEN
    NEW.receipt_number := 'FGR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('fgr_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_fgr_number
  BEFORE INSERT ON public.finished_goods_receipts
  FOR EACH ROW EXECUTE FUNCTION public.generate_fgr_number();

-- =====================================================
-- 4) COGS ENTRIES - Custo do Produto Vendido
-- =====================================================
CREATE TABLE public.cogs_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  nfe_id uuid REFERENCES public.nfe_emitidas(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  entry_type text NOT NULL DEFAULT 'cogs',
  material_cost numeric NOT NULL DEFAULT 0,
  labor_cost numeric NOT NULL DEFAULT 0,
  overhead_cost numeric NOT NULL DEFAULT 0,
  total_cogs numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  gross_margin numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  invoice_number text DEFAULT '',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 5) RLS
-- =====================================================
ALTER TABLE public.goods_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_issue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finished_goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cogs_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view goods_issues" ON public.goods_issues FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert goods_issues" ON public.goods_issues FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update goods_issues" ON public.goods_issues FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete goods_issues" ON public.goods_issues FOR DELETE TO authenticated USING (is_approved_user());

CREATE POLICY "Auth users can view goods_issue_items" ON public.goods_issue_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert goods_issue_items" ON public.goods_issue_items FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update goods_issue_items" ON public.goods_issue_items FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete goods_issue_items" ON public.goods_issue_items FOR DELETE TO authenticated USING (is_approved_user());

CREATE POLICY "Auth users can view wip_ledger" ON public.wip_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert wip_ledger" ON public.wip_ledger FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update wip_ledger" ON public.wip_ledger FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete wip_ledger" ON public.wip_ledger FOR DELETE TO authenticated USING (is_approved_user());

CREATE POLICY "Auth users can view finished_goods_receipts" ON public.finished_goods_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert finished_goods_receipts" ON public.finished_goods_receipts FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update finished_goods_receipts" ON public.finished_goods_receipts FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete finished_goods_receipts" ON public.finished_goods_receipts FOR DELETE TO authenticated USING (is_approved_user());

CREATE POLICY "Auth users can view cogs_entries" ON public.cogs_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert cogs_entries" ON public.cogs_entries FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can delete cogs_entries" ON public.cogs_entries FOR DELETE TO authenticated USING (is_approved_user());

CREATE TRIGGER trg_updated_at_goods_issues BEFORE UPDATE ON public.goods_issues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_fgr BEFORE UPDATE ON public.finished_goods_receipts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
