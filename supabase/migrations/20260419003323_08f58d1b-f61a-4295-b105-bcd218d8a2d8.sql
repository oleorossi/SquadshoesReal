CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg RECORD;
  boxes_needed integer;
  v_result jsonb := '[]'::jsonb;
  v_types_to_debit text[];
BEGIN
  -- Canonical packaging modes (3 only):
  --   individual_amarrado → debits individual boxes only (pairs amarrados manualmente)
  --   individual_master   → debits individual boxes + master boxes
  --   colmeia             → debits colméia boxes only
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSE
    -- default + individual_amarrado
    v_types_to_debit := ARRAY['individual'];
  END IF;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box, pc.product_id, pc.box_type_id,
           p.name AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock, bt.nome AS box_name
    FROM packaging_configs pc
    LEFT JOIN products p ON p.id = pc.product_id AND p.active = true
    LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
    WHERE pc.sheet_id = p_reference_id
      AND pc.active = true
      AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.box_type_id;

      v_result := v_result || jsonb_build_object(
        'box_type_id', cfg.box_type_id,
        'box_name', COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed', boxes_needed,
        'status', 'debited_box_types'
      );

    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products SET quantity = quantity - boxes_needed, updated_at = now()
      WHERE id = cfg.product_id;

      INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (cfg.product_id, 'out', boxes_needed, cfg.current_stock, cfg.current_stock - boxes_needed,
              'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);

      v_result := v_result || jsonb_build_object(
        'product_id', cfg.product_id,
        'product_name', COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed', boxes_needed,
        'status', 'debited_products'
      );
    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome', cfg.nome,
        'status', 'skipped',
        'reason', 'no_stock_link'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;