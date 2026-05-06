
-- Add product_id to packaging_configs to link to stock products
ALTER TABLE public.packaging_configs ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

-- Create function to debit packaging stock based on packaging mode
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg RECORD;
  boxes_needed integer;
  target_qty numeric;
  v_result jsonb := '[]'::jsonb;
  v_types_to_debit text[];
BEGIN
  -- Determine which packaging types to debit based on mode
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSE -- individual_amarrado
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- Process each packaging config for this reference that matches the mode
  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id,
           p.name AS product_name, p.quantity AS current_stock
    FROM packaging_configs pc
    LEFT JOIN products p ON p.id = pc.product_id AND p.active = true
    WHERE pc.sheet_id = p_reference_id
      AND pc.active = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    -- Skip if no linked product
    IF cfg.product_id IS NULL THEN
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome', cfg.nome,
        'status', 'skipped',
        'reason', 'no_product_linked'
      );
      CONTINUE;
    END IF;

    -- Calculate boxes needed (ceiling division)
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Check stock
    IF cfg.current_stock < boxes_needed THEN
      RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
        COALESCE(cfg.product_name, cfg.nome), cfg.current_stock, boxes_needed;
    END IF;

    -- Debit stock
    UPDATE products SET quantity = quantity - boxes_needed, updated_at = now()
    WHERE id = cfg.product_id;

    -- Record movement
    INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (cfg.product_id, 'out', boxes_needed, cfg.current_stock, cfg.current_stock - boxes_needed,
            'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);

    -- Record reservation as consumed
    INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type)
    VALUES (p_order_id, cfg.product_id, boxes_needed, boxes_needed, 'consumed', 'hard');

    v_result := v_result || jsonb_build_object(
      'product_id', cfg.product_id,
      'product_name', COALESCE(cfg.product_name, cfg.nome),
      'packaging_type', cfg.packaging_type,
      'boxes_needed', boxes_needed,
      'status', 'debited'
    );
  END LOOP;

  RETURN v_result;
END;
$$;
