-- =============================================================================
-- Atomic RPCs for product creation with initial stock movement
-- =============================================================================
-- Two UI paths (AddToStockDialog new-product branch, Contractors artisanal
-- output) did product INSERT + stock_movements INSERT as two separate writes.
-- If the movement insert failed, a phantom product existed with no audit row.
-- These RPCs do both in a single transaction.
-- =============================================================================

-- 1. Generic "create product with initial stock" (used by AddToStockDialog)
CREATE OR REPLACE FUNCTION public.create_product_with_initial_stock(
  p_name         text,
  p_sku          text DEFAULT NULL,
  p_category     text DEFAULT 'material',
  p_unit         text DEFAULT 'un',
  p_location     text DEFAULT 'Almoxarifado A',
  p_quantity     numeric DEFAULT 0,
  p_unit_price   numeric DEFAULT 0,
  p_min_stock    numeric DEFAULT 0,
  p_max_stock    numeric DEFAULT 0,
  p_group_id     uuid DEFAULT NULL,
  p_description  text DEFAULT NULL,
  p_supplier_id  uuid DEFAULT NULL,
  p_reason       text DEFAULT 'Entrada inicial de estoque'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid;
BEGIN
  INSERT INTO public.products (
    name, sku, category, unit, location,
    quantity, unit_price, min_stock, max_stock,
    group_id, description, supplier_id, active
  ) VALUES (
    p_name, p_sku, p_category, p_unit, p_location,
    p_quantity, p_unit_price, p_min_stock, p_max_stock,
    p_group_id, p_description, p_supplier_id, true
  ) RETURNING id INTO v_product_id;

  IF p_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description
    ) VALUES (
      v_product_id, 'in', p_quantity,
      0, p_quantity, p_reason
    );
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_initial_stock(
  text, text, text, text, text, numeric, numeric, numeric, numeric, uuid, text, uuid, text
) TO authenticated;


-- 2. Artisanal product creation (used by Contractors.tsx)
CREATE OR REPLACE FUNCTION public.create_artisanal_product_with_stock(
  p_name         text,
  p_color        text DEFAULT '',
  p_quantity     numeric DEFAULT 0,
  p_unit         text DEFAULT 'par',
  p_order_id     uuid DEFAULT NULL,
  p_reason       text DEFAULT 'Saída artesanal'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid;
BEGIN
  INSERT INTO public.products (
    name, category, unit, location,
    quantity, unit_price, min_stock, max_stock, active
  ) VALUES (
    p_name || CASE WHEN p_color <> '' THEN ' - ' || p_color ELSE '' END,
    'artesanal', p_unit, 'Produção',
    p_quantity, 0, 0, 0, true
  ) RETURNING id INTO v_product_id;

  IF p_quantity > 0 THEN
    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity,
      previous_stock, new_stock, description, order_id
    ) VALUES (
      v_product_id, 'in', p_quantity,
      0, p_quantity, p_reason, p_order_id
    );
  END IF;

  RETURN v_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_artisanal_product_with_stock(
  text, text, numeric, text, uuid, text
) TO authenticated;


-- 3. Atomic ready_stock upsert (used by useReadyStock.ts)
-- Adds a unique constraint on (reference_id, color, size) if not present,
-- then provides a MERGE-style RPC safe under concurrent callers.

ALTER TABLE public.ready_stock
  ADD COLUMN IF NOT EXISTS size text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ready_stock_ref_color_size
  ON public.ready_stock (reference_id, color, size);

CREATE OR REPLACE FUNCTION public.upsert_ready_stock_atomic(
  p_reference_id uuid,
  p_color        text,
  p_size         text,
  p_qty_delta    numeric,
  p_location     text DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ready_stock (reference_id, color, size, quantity, location, notes)
  VALUES (p_reference_id, p_color, p_size, GREATEST(p_qty_delta, 0), p_location, p_notes)
  ON CONFLICT (reference_id, color, size) DO UPDATE
    SET quantity   = GREATEST(ready_stock.quantity + p_qty_delta, 0),
        location   = COALESCE(p_location, ready_stock.location),
        notes      = COALESCE(p_notes, ready_stock.notes),
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_ready_stock_atomic(uuid, text, text, numeric, text, text) TO authenticated;
