-- Atualizar get_inventory_summary para incluir box_types
DROP FUNCTION IF EXISTS get_inventory_summary() CASCADE;
CREATE OR REPLACE FUNCTION get_inventory_summary()
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'totalValue', (
            SELECT COALESCE(SUM(quantity * unit_price), 0) FROM products WHERE active = true
        ) + (
            SELECT COALESCE(SUM(quantity * unit_price), 0) FROM box_types WHERE active = true
        ),
        'activeItems', (
            SELECT COUNT(*) FROM products WHERE active = true
        ) + (
            SELECT COUNT(*) FROM box_types WHERE active = true
        ),
        'lowStockCount', (
            SELECT COUNT(*) FROM products WHERE active = true AND quantity <= min_stock
        ) + (
            SELECT COUNT(*) FROM box_types WHERE active = true AND quantity <= min_stock
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atualizar debit_packaging_for_order para incluir fitilho e melhorar colmeia
DROP FUNCTION IF EXISTS public.debit_packaging_for_order(p_sale_order_id uuid, p_order_id uuid, p_reference_id uuid, p_order_quantity integer, p_packaging_mode text) CASCADE;
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg RECORD;
  boxes_needed integer;
  v_result jsonb := '[]'::jsonb;
  v_types_to_debit text[];
BEGIN
  -- Definir quais tipos de embalagem devem ser debitados baseado no modo
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    -- amarrado simples ou outros
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
    -- Cálculo de unidades necessárias (arredondando para cima)
    -- Se pairs_per_box for 12, e o pedido tiver 20 pares, precisará de 2 caixas.
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Débito da tabela centralizada box_types (preferencial)
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

    -- Legado: débito da tabela products se vinculado diretamente
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
        'reason', 'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;