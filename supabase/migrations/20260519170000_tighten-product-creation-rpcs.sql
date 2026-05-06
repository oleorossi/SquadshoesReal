-- =============================================================================
-- Tighten SECURITY DEFINER product-creation RPCs with is_approved_user() guard
-- =============================================================================
-- create_product_with_initial_stock and create_artisanal_product_with_stock
-- (20260518130000) are SECURITY DEFINER and GRANT'd to authenticated without
-- an is_approved_user() check. Any authenticated user (even unapproved /
-- pending-approval) could insert arbitrary product rows with arbitrary opening
-- stock, bypassing RLS on products and emitting stock_movement audit rows
-- attributed to a privileged definer.
--
-- Fix: add is_approved_user() check at the top of both function bodies.
-- Mirrors the pattern used in 20260507180000 and 20260518140000.
-- =============================================================================

-- 1. create_product_with_initial_stock
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
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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


-- 2. create_artisanal_product_with_stock
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
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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
