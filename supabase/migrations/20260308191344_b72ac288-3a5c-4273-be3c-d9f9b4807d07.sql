
-- Purchase Orders
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL DEFAULT '',
  total_value numeric NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Purchase Order Items
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  current_stock numeric NOT NULL DEFAULT 0,
  min_stock numeric NOT NULL DEFAULT 0,
  max_stock numeric NOT NULL DEFAULT 0,
  suggested_quantity numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'un',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sequence for OC numbers
CREATE SEQUENCE IF NOT EXISTS oc_number_seq START 1;

-- Auto-generate OC number
DROP FUNCTION IF EXISTS public.generate_oc_number() CASCADE;
CREATE OR REPLACE FUNCTION public.generate_oc_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('oc_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_oc_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_oc_number();

-- Updated_at trigger
CREATE TRIGGER trg_purchase_orders_updated
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view purchase_orders" ON public.purchase_orders;
CREATE POLICY "Auth users can view purchase_orders" ON public.purchase_orders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert purchase_orders" ON public.purchase_orders;
CREATE POLICY "Auth users can insert purchase_orders" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update purchase_orders" ON public.purchase_orders;
CREATE POLICY "Auth users can update purchase_orders" ON public.purchase_orders FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete purchase_orders" ON public.purchase_orders;
CREATE POLICY "Auth users can delete purchase_orders" ON public.purchase_orders FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users can view purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Auth users can view purchase_order_items" ON public.purchase_order_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Auth users can insert purchase_order_items" ON public.purchase_order_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Auth users can update purchase_order_items" ON public.purchase_order_items FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete purchase_order_items" ON public.purchase_order_items;
CREATE POLICY "Auth users can delete purchase_order_items" ON public.purchase_order_items FOR DELETE TO authenticated USING (true);

-- Function to auto-create purchase order when stock hits min
DROP FUNCTION IF EXISTS public.auto_create_purchase_order() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_create_purchase_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_po_id uuid;
  v_supplier_id uuid;
  v_supplier_name text;
  v_suggested_qty numeric;
BEGIN
  -- Only trigger when quantity changes and goes at or below min_stock
  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN
    -- Check if there's already a pending PO for this product
    IF EXISTS (
      SELECT 1 FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.product_id = NEW.id AND po.status = 'pending'
    ) THEN
      RETURN NEW;
    END IF;

    -- Try to find last supplier from invoice_items
    SELECT s.id, s.name INTO v_supplier_id, v_supplier_name
    FROM invoice_items ii
    JOIN invoices inv ON inv.id = ii.invoice_id
    JOIN suppliers s ON s.id = inv.supplier_id
    WHERE ii.product_id = NEW.id
    ORDER BY ii.created_at DESC
    LIMIT 1;

    -- Calculate suggested quantity (fill to max_stock, or double min_stock if no max)
    v_suggested_qty := GREATEST(
      COALESCE(NULLIF(NEW.max_stock, 0), NEW.min_stock * 2) - NEW.quantity,
      1
    );

    -- Create purchase order
    INSERT INTO purchase_orders (supplier_id, supplier_name, auto_generated, notes)
    VALUES (v_supplier_id, COALESCE(v_supplier_name, 'A definir'), true, 'Gerada automaticamente - Estoque mínimo atingido')
    RETURNING id INTO v_po_id;

    -- Create purchase order item
    INSERT INTO purchase_order_items (purchase_order_id, product_id, current_stock, min_stock, max_stock, suggested_quantity, quantity, unit_price, unit)
    VALUES (v_po_id, NEW.id, NEW.quantity, NEW.min_stock, NEW.max_stock, v_suggested_qty, v_suggested_qty, NEW.unit_price, NEW.unit);

    -- Update total
    UPDATE purchase_orders SET total_value = v_suggested_qty * NEW.unit_price WHERE id = v_po_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_purchase_order
  AFTER UPDATE OF quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_purchase_order();
