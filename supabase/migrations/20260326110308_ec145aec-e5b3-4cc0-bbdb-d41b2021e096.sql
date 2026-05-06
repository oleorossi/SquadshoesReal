
-- =====================================================
-- 1) MRP SUGGESTIONS - Sugestões de produção/compra
-- =====================================================
CREATE TABLE public.mrp_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_type text NOT NULL DEFAULT 'production', -- production, purchase
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text DEFAULT '',
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  required_quantity numeric NOT NULL DEFAULT 0,
  available_quantity numeric NOT NULL DEFAULT 0,
  shortage_quantity numeric NOT NULL DEFAULT 0,
  priority text NOT NULL DEFAULT 'normal', -- rush, normal, low
  status text NOT NULL DEFAULT 'open', -- open, accepted, rejected, resolved
  due_date date,
  resolved_at timestamptz,
  resolved_by text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 2) BIN LOCATIONS - Localização física por bin
-- =====================================================
CREATE TABLE public.bin_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  warehouse text NOT NULL DEFAULT 'Principal',
  zone text DEFAULT '', -- recebimento, armazenagem, producao, expedicao, quarentena
  aisle text DEFAULT '',
  rack text DEFAULT '',
  shelf text DEFAULT '',
  bin text DEFAULT '',
  capacity numeric DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 3) LOT TRACKING - Rastreabilidade de lote
-- =====================================================
CREATE TABLE public.lot_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  lot_number text NOT NULL DEFAULT '',
  supplier_lot text DEFAULT '',
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  quantity_received numeric NOT NULL DEFAULT 0,
  quantity_available numeric NOT NULL DEFAULT 0,
  quantity_consumed numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  received_date date DEFAULT CURRENT_DATE,
  expiry_date date,
  bin_location_id uuid REFERENCES public.bin_locations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available', -- available, consumed, expired, quarantine, blocked
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS lot_number_seq START 1;

-- =====================================================
-- 4) QUARANTINE STOCK - Estoque em quarentena
-- =====================================================
CREATE TABLE public.quarantine_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  lot_id uuid REFERENCES public.lot_tracking(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '', -- quality_rejection, supplier_defect, damaged, expired
  quality_record_id uuid REFERENCES public.quality_records(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'quarantine', -- quarantine, returned_supplier, scrapped, released
  resolved_at timestamptz,
  resolved_by text DEFAULT '',
  resolution_notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 5) CYCLE COUNTS - Contagem cíclica
-- =====================================================
CREATE TABLE public.cycle_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL DEFAULT '',
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'planned', -- planned, in_progress, completed, cancelled
  counted_by text DEFAULT '',
  approved_by text DEFAULT '',
  notes text DEFAULT '',
  total_items integer DEFAULT 0,
  accurate_items integer DEFAULT 0,
  accuracy_pct numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cycle_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_count_id uuid REFERENCES public.cycle_counts(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  system_quantity numeric NOT NULL DEFAULT 0,
  counted_quantity numeric,
  variance numeric DEFAULT 0,
  bin_location text DEFAULT '',
  lot_number text DEFAULT '',
  adjusted boolean NOT NULL DEFAULT false,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS cc_number_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_cc_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.count_number = '' OR NEW.count_number IS NULL THEN
    NEW.count_number := 'CC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('cc_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_cc_number
  BEFORE INSERT ON public.cycle_counts
  FOR EACH ROW EXECUTE FUNCTION public.generate_cc_number();

-- =====================================================
-- 6) COST VARIANCE - Variação de custo (padrão vs real)
-- =====================================================
CREATE TABLE public.cost_variance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  period text DEFAULT '',
  standard_material_cost numeric NOT NULL DEFAULT 0,
  actual_material_cost numeric NOT NULL DEFAULT 0,
  material_variance numeric NOT NULL DEFAULT 0,
  standard_labor_cost numeric NOT NULL DEFAULT 0,
  actual_labor_cost numeric NOT NULL DEFAULT 0,
  labor_variance numeric NOT NULL DEFAULT 0,
  standard_overhead numeric NOT NULL DEFAULT 0,
  actual_overhead numeric NOT NULL DEFAULT 0,
  overhead_variance numeric NOT NULL DEFAULT 0,
  total_standard_cost numeric NOT NULL DEFAULT 0,
  total_actual_cost numeric NOT NULL DEFAULT 0,
  total_variance numeric NOT NULL DEFAULT 0,
  variance_pct numeric NOT NULL DEFAULT 0,
  quantity_produced numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- 7) RLS for all new tables
-- =====================================================
ALTER TABLE public.mrp_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bin_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lot_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarantine_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_variance_reports ENABLE ROW LEVEL SECURITY;

-- MRP Suggestions
CREATE POLICY "Auth users can view mrp_suggestions" ON public.mrp_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert mrp_suggestions" ON public.mrp_suggestions FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update mrp_suggestions" ON public.mrp_suggestions FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete mrp_suggestions" ON public.mrp_suggestions FOR DELETE TO authenticated USING (is_approved_user());

-- Bin Locations
CREATE POLICY "Auth users can view bin_locations" ON public.bin_locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert bin_locations" ON public.bin_locations FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update bin_locations" ON public.bin_locations FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete bin_locations" ON public.bin_locations FOR DELETE TO authenticated USING (is_approved_user());

-- Lot Tracking
CREATE POLICY "Auth users can view lot_tracking" ON public.lot_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert lot_tracking" ON public.lot_tracking FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update lot_tracking" ON public.lot_tracking FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete lot_tracking" ON public.lot_tracking FOR DELETE TO authenticated USING (is_approved_user());

-- Quarantine Stock
CREATE POLICY "Auth users can view quarantine_stock" ON public.quarantine_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert quarantine_stock" ON public.quarantine_stock FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update quarantine_stock" ON public.quarantine_stock FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete quarantine_stock" ON public.quarantine_stock FOR DELETE TO authenticated USING (is_approved_user());

-- Cycle Counts
CREATE POLICY "Auth users can view cycle_counts" ON public.cycle_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert cycle_counts" ON public.cycle_counts FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update cycle_counts" ON public.cycle_counts FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete cycle_counts" ON public.cycle_counts FOR DELETE TO authenticated USING (is_approved_user());

CREATE POLICY "Auth users can view cycle_count_items" ON public.cycle_count_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert cycle_count_items" ON public.cycle_count_items FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update cycle_count_items" ON public.cycle_count_items FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete cycle_count_items" ON public.cycle_count_items FOR DELETE TO authenticated USING (is_approved_user());

-- Cost Variance Reports
CREATE POLICY "Auth users can view cost_variance_reports" ON public.cost_variance_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert cost_variance_reports" ON public.cost_variance_reports FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can delete cost_variance_reports" ON public.cost_variance_reports FOR DELETE TO authenticated USING (is_approved_user());

-- Updated_at triggers
CREATE TRIGGER trg_updated_at_mrp BEFORE UPDATE ON public.mrp_suggestions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_bin BEFORE UPDATE ON public.bin_locations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_lot BEFORE UPDATE ON public.lot_tracking FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_quarantine BEFORE UPDATE ON public.quarantine_stock FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_updated_at_cycle BEFORE UPDATE ON public.cycle_counts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
