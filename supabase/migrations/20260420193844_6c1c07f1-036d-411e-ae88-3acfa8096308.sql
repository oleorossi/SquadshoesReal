-- Admin-only RPC: Force a sale order into production status, regardless of current state.
-- - Updates sale_orders.status to 'Em Produção'
-- - Creates OPs for any sale_order_items missing one
-- - Updates existing 'Reservado'/'Rascunho' OPs to 'Em Produção'
-- - Ensures order_stages exist for every OP
-- - Restricted to admins via has_role()
CREATE OR REPLACE FUNCTION public.force_sale_order_production(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_so RECORD;
  v_item RECORD;
  v_op RECORD;
  v_op_id uuid;
  v_created_ops int := 0;
  v_updated_ops int := 0;
  v_created_stages int := 0;
  v_default_sectors text[] := ARRAY['Corte','Forração','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento'];
  v_sectors text[];
  v_stage_name text;
  v_stage_idx int;
BEGIN
  -- Admin-only guard
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem forçar produção';
  END IF;

  -- Verify sale order
  SELECT id, status, delivery_deadline INTO v_so
  FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado';
  END IF;

  -- Force status to Em Produção
  UPDATE public.sale_orders
     SET status = 'Em Produção', updated_at = now()
   WHERE id = p_sale_order_id;

  -- For each sale_order_item, ensure an OP exists
  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, fichas, observation
      FROM public.sale_order_items
     WHERE sale_order_id = p_sale_order_id
  LOOP
    IF v_item.reference_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_op_id
      FROM public.orders
     WHERE sale_order_item_id = v_item.id
     LIMIT 1;

    IF v_op_id IS NULL THEN
      -- Create OP
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        p_sale_order_id, v_item.id,
        'Forçada por admin - Em Produção', 'Em Produção',
        v_item.observation, v_so.delivery_deadline
      ) RETURNING id INTO v_op_id;
      v_created_ops := v_created_ops + 1;
    ELSE
      -- Update OP to Em Produção if not already terminal
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
      IF FOUND THEN v_updated_ops := v_updated_ops + 1; END IF;
    END IF;

    -- Ensure stages exist
    IF NOT EXISTS (SELECT 1 FROM public.order_stages WHERE order_id = v_op_id) THEN
      -- Pick sectors from technical sheet if defined
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      v_stage_idx := 1;
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name, v_stage_idx, 'pendente',
          v_item.quantity, 0
        );
        v_stage_idx := v_stage_idx + 1;
        v_created_stages := v_created_stages + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sale_order_id', p_sale_order_id,
    'created_ops', v_created_ops,
    'updated_ops', v_updated_ops,
    'created_stages', v_created_stages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.force_sale_order_production(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_sale_order_production(uuid) TO authenticated;