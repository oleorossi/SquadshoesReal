-- Add empty-items guard to update_sale_order_atomic.
-- Without this, passing p_items = '[]' silently DELETEs all sale_order_items
-- and persists total = 0, which syncFinancialRecords then writes to the
-- linked accounts_receivable — zeroing the receivable for an active order.
-- The TypeScript caller already validates items.length > 0, but the RPC
-- provides a defense-in-depth guarantee against direct API calls or bugs.
--
-- Note: this patches only the guard; the rest of the function body is
-- unchanged from migration 20260510180000.

CREATE OR REPLACE FUNCTION public.update_sale_order_atomic(
  p_order_id uuid,
  p_header   jsonb,
  p_items    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item          jsonb;
  v_total         numeric := 0;
  v_inserted_ids  uuid[]  := ARRAY[]::uuid[];
  v_new_id        uuid;
BEGIN
  -- Defense-in-depth: refuse to wipe all items.
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Não é possível salvar um pedido sem itens.';
  END IF;

  -- Lock the sale_order row to serialise concurrent edits.
  PERFORM 1 FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;

  -- Compute total from items (single pass, matches client-side calculation).
  SELECT COALESCE(SUM(
    (it->>'unit_price')::numeric * (it->>'quantity')::numeric
  ), 0)
  INTO v_total
  FROM jsonb_array_elements(p_items) it;

  -- Update header (total is derived from items, not from p_header).
  UPDATE public.sale_orders
  SET
    status              = COALESCE(p_header->>'status',              status),
    client_name         = COALESCE(p_header->>'client_name',         client_name),
    client_cnpj         = COALESCE(p_header->>'client_cnpj',         client_cnpj),
    client_id           = COALESCE((p_header->>'client_id')::uuid,   client_id),
    order_number        = COALESCE(p_header->>'order_number',        order_number),
    delivery_deadline   = CASE WHEN p_header ? 'delivery_deadline'
                                AND p_header->>'delivery_deadline' IS NOT NULL
                               THEN (p_header->>'delivery_deadline')::date
                               ELSE delivery_deadline END,
    payment_condition   = COALESCE(p_header->>'payment_condition',   payment_condition),
    representative_id   = (p_header->>'representative_id')::uuid,
    commission_value    = COALESCE((p_header->>'commission_value')::numeric, commission_value),
    factoring_config_id = (p_header->>'factoring_config_id')::uuid,
    is_factoring        = COALESCE((p_header->>'is_factoring')::boolean, is_factoring),
    economic_group_id   = (p_header->>'economic_group_id')::uuid,
    packaging_product_id= (p_header->>'packaging_product_id')::uuid,
    packaging_quantity  = COALESCE((p_header->>'packaging_quantity')::int, packaging_quantity),
    packaging_mode      = COALESCE(p_header->>'packaging_mode',      packaging_mode),
    delivery_month      = COALESCE(p_header->>'delivery_month',      delivery_month),
    delivery_week       = COALESCE((p_header->>'delivery_week')::int, delivery_week),
    client_order_number = COALESCE(p_header->>'client_order_number', client_order_number),
    total               = v_total,
    updated_at          = now()
  WHERE id = p_order_id;

  -- Replace items atomically.
  DELETE FROM public.sale_order_items WHERE sale_order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.sale_order_items (
      sale_order_id, reference_id, color, quantity, unit_price,
      grade, fichas, observation, material_variant_id
    ) VALUES (
      p_order_id,
      (v_item->>'reference_id')::uuid,
      v_item->>'color',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      COALESCE(v_item->'grade', '{}'::jsonb),
      COALESCE((v_item->>'fichas')::int, 1),
      v_item->>'observation',
      (v_item->>'material_variant_id')::uuid
    )
    RETURNING id INTO v_new_id;
    v_inserted_ids := array_append(v_inserted_ids, v_new_id);
  END LOOP;

  RETURN jsonb_build_object('inserted_item_ids', to_jsonb(v_inserted_ids));
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_sale_order_atomic(uuid, jsonb, jsonb) TO authenticated;
