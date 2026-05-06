
-- ========== 1) MATERIAL RESERVATIONS ==========
CREATE TABLE public.material_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity_reserved numeric NOT NULL DEFAULT 0,
  quantity_consumed numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved', -- reserved, partially_consumed, consumed, cancelled
  reservation_type text NOT NULL DEFAULT 'soft', -- soft (reserva) or hard (baixa imediata)
  lot_number text DEFAULT '',
  location text DEFAULT '',
  notes text DEFAULT '',
  reserved_by text DEFAULT '',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.material_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view material_reservations" ON public.material_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert material_reservations" ON public.material_reservations FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update material_reservations" ON public.material_reservations FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete material_reservations" ON public.material_reservations FOR DELETE TO authenticated USING (is_approved_user());

CREATE INDEX idx_material_reservations_order ON public.material_reservations(order_id);
CREATE INDEX idx_material_reservations_product ON public.material_reservations(product_id);
CREATE INDEX idx_material_reservations_status ON public.material_reservations(status);

-- ========== 2) QUALITY RECORDS ==========
CREATE TABLE public.quality_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.order_stages(id) ON DELETE SET NULL,
  stage_name text NOT NULL DEFAULT '',
  record_type text NOT NULL DEFAULT 'defect', -- defect, rework, scrap, inspection
  quantity integer NOT NULL DEFAULT 0,
  description text DEFAULT '',
  cause text DEFAULT '',
  corrective_action text DEFAULT '',
  severity text DEFAULT 'minor', -- minor, major, critical
  reported_by text DEFAULT '',
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view quality_records" ON public.quality_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert quality_records" ON public.quality_records FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update quality_records" ON public.quality_records FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete quality_records" ON public.quality_records FOR DELETE TO authenticated USING (is_approved_user());

CREATE INDEX idx_quality_records_order ON public.quality_records(order_id);
CREATE INDEX idx_quality_records_stage ON public.quality_records(stage_id);

-- ========== 3) PICKING LISTS ==========
CREATE TABLE public.picking_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending, in_progress, completed
  assigned_to text DEFAULT '',
  started_at timestamptz,
  completed_at timestamptz,
  completed_by text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.picking_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view picking_lists" ON public.picking_lists FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert picking_lists" ON public.picking_lists FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update picking_lists" ON public.picking_lists FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete picking_lists" ON public.picking_lists FOR DELETE TO authenticated USING (is_approved_user());

CREATE INDEX idx_picking_lists_order ON public.picking_lists(order_id);

-- ========== 4) PICKING LIST ITEMS ==========
CREATE TABLE public.picking_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_list_id uuid NOT NULL REFERENCES public.picking_lists(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.material_reservations(id) ON DELETE SET NULL,
  quantity_required numeric NOT NULL DEFAULT 0,
  quantity_picked numeric NOT NULL DEFAULT 0,
  location text DEFAULT '',
  lot_number text DEFAULT '',
  picked boolean DEFAULT false,
  picked_at timestamptz,
  picked_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.picking_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view picking_list_items" ON public.picking_list_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert picking_list_items" ON public.picking_list_items FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update picking_list_items" ON public.picking_list_items FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete picking_list_items" ON public.picking_list_items FOR DELETE TO authenticated USING (is_approved_user());

CREATE INDEX idx_picking_list_items_list ON public.picking_list_items(picking_list_id);

-- ========== 5) Enable realtime for key tables ==========
ALTER PUBLICATION supabase_realtime ADD TABLE public.material_reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.picking_lists;
