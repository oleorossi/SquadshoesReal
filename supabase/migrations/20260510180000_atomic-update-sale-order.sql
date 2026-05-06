-- =============================================================================
-- update_sale_order_atomic — header + items em transação única
-- =============================================================================
--
-- Antes desta RPC, `useUpdateSaleOrder` fazia:
--   1) UPDATE sale_orders SET ... (header)
--   2) SELECT items existentes (snapshot p/ rollback compensatório)
--   3) DELETE sale_order_items
--   4) INSERT novos items
--
-- Os passos 1-4 não estavam em uma transação SQL. Se o INSERT falhasse, a UI
-- tentava restaurar os items antigos via supabase-js (compensating action),
-- mas se a restauração também falhasse o pedido ficava sem items. O Batch J
-- adicionou snapshot+restore para mitigar, mas não é uma transação real.
--
-- Esta migration cria `update_sale_order_atomic(p_order_id, p_header, p_items)`
-- que executa header + items em um único bloco PL/pgSQL (transação implícita).
-- Se qualquer linha falhar, o ROLLBACK do Postgres restaura tudo automaticamente.
--
-- Observação: o teardown/rebuild de OPs (orders, order_stages, production_consumptions)
-- continua sendo feito sequencialmente em TS porque depende de várias outras
-- RPCs (restore_product_stocks, restore_sole_grade, try_reserve_materials).
-- Cada uma dessas RPCs já é atômica. O ponto frágil — header + items —
-- agora é atômico também.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_sale_order_atomic(
  p_order_id uuid,
  p_header   jsonb,
  p_items    jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inserted_ids uuid[] := ARRAY[]::uuid[];
  v_item         jsonb;
  v_new_id       uuid;
  v_total        numeric := 0;
  v_existing     RECORD;
BEGIN
  -- Lock the row for the duration of this transaction
  SELECT id INTO v_existing FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_order_id;
  END IF;

  -- Compute total from items (matches what TS does: sum(qty * unit_price))
  SELECT COALESCE(SUM(
    COALESCE((it->>'quantity')::numeric, 0) * COALESCE((it->>'unit_price')::numeric, 0)
  ), 0)
    INTO v_total
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) it;

  -- Update header (only fields present in p_header are touched; total is always set)
  UPDATE public.sale_orders SET
    client_name         = CASE WHEN p_header ? 'client_name'         THEN p_header->>'client_name'                            ELSE client_name END,
    client_cnpj         = CASE WHEN p_header ? 'client_cnpj'         THEN p_header->>'client_cnpj'                            ELSE client_cnpj END,
    client_contact      = CASE WHEN p_header ? 'client_contact'      THEN p_header->>'client_contact'                         ELSE client_contact END,
    client_order_number = CASE WHEN p_header ? 'client_order_number' THEN COALESCE(p_header->>'client_order_number', '')      ELSE client_order_number END,
    representative      = CASE WHEN p_header ? 'representative'      THEN p_header->>'representative'                         ELSE representative END,
    payment_condition   = CASE WHEN p_header ? 'payment_condition'   THEN p_header->>'payment_condition'                      ELSE payment_condition END,
    delivery_deadline   = CASE WHEN p_header ? 'delivery_deadline'   THEN NULLIF(p_header->>'delivery_deadline', '')::date    ELSE delivery_deadline END,
    delivery_week       = CASE WHEN p_header ? 'delivery_week'       THEN p_header->>'delivery_week'                          ELSE delivery_week END,
    delivery_month      = CASE WHEN p_header ? 'delivery_month'      THEN p_header->>'delivery_month'                         ELSE delivery_month END,
    notes               = CASE WHEN p_header ? 'notes'               THEN p_header->>'notes'                                  ELSE notes END,
    status              = CASE WHEN p_header ? 'status'              THEN COALESCE(p_header->>'status', status)               ELSE status END,
    nfe                 = CASE WHEN p_header ? 'nfe'                 THEN p_header->>'nfe'                                    ELSE nfe END,
    remessa             = CASE WHEN p_header ? 'remessa'             THEN p_header->>'remessa'                                ELSE remessa END,
    is_factoring        = CASE WHEN p_header ? 'is_factoring'        THEN COALESCE((p_header->>'is_factoring')::boolean, false) ELSE is_factoring END,
    factoring_config_id = CASE WHEN p_header ? 'factoring_config_id' THEN NULLIF(p_header->>'factoring_config_id', '')::uuid  ELSE factoring_config_id END,
    packaging_mode      = CASE WHEN p_header ? 'packaging_mode'      THEN p_header->>'packaging_mode'                         ELSE packaging_mode END,
    packaging_product_id= CASE WHEN p_header ? 'packaging_product_id'THEN NULLIF(p_header->>'packaging_product_id', '')::uuid ELSE packaging_product_id END,
    packaging_quantity  = CASE WHEN p_header ? 'packaging_quantity'  THEN COALESCE((p_header->>'packaging_quantity')::numeric, 0) ELSE packaging_quantity END,
    client_id           = CASE WHEN p_header ? 'client_id'           THEN NULLIF(p_header->>'client_id', '')::uuid            ELSE client_id END,
    representative_id   = CASE WHEN p_header ? 'representative_id'   THEN NULLIF(p_header->>'representative_id', '')::uuid    ELSE representative_id END,
    commission_value    = CASE WHEN p_header ? 'commission_value'    THEN COALESCE((p_header->>'commission_value')::numeric, 0) ELSE commission_value END,
    billing_week        = CASE WHEN p_header ? 'billing_week'        THEN p_header->>'billing_week'                           ELSE billing_week END,
    total               = v_total,
    updated_at          = now()
  WHERE id = p_order_id;

  -- Replace items
  DELETE FROM public.sale_order_items WHERE sale_order_id = p_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    INSERT INTO public.sale_order_items (
      sale_order_id,
      reference_id,
      color,
      quantity,
      unit_price,
      grade,
      fichas,
      observation,
      material_variant_id
    ) VALUES (
      p_order_id,
      NULLIF(v_item->>'reference_id', '')::uuid,
      v_item->>'color',
      COALESCE((v_item->>'quantity')::numeric, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE(v_item->'grade', '{}'::jsonb),
      COALESCE((v_item->>'fichas')::integer, 1),
      v_item->>'observation',
      NULLIF(v_item->>'material_variant_id', '')::uuid
    ) RETURNING id INTO v_new_id;
    v_inserted_ids := array_append(v_inserted_ids, v_new_id);
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_inserted_ids),
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_sale_order_atomic(uuid, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_sale_order_atomic(uuid, jsonb, jsonb) IS
  'Atualiza header + items de um sale_order em transação única, com SELECT FOR UPDATE. '
  'Substitui o padrão UPDATE/SELECT/DELETE/INSERT do useUpdateSaleOrder, eliminando '
  'a necessidade de snapshot+restore como compensating action.';
