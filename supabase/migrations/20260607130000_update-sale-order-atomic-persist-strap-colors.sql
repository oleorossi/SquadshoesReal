-- Fix: update_sale_order_atomic descartava strap_colors ao editar um PV.
--
-- O INSERT em sale_order_items não listava a coluna strap_colors (jsonb, default
-- '[]'), então toda EDIÇÃO de PV zerava as cores de tira no banco. Efeitos:
--   - StrapShortageDialog acusava "N items sem cor de tira preenchida" mesmo com
--     as cores preenchidas na tela (e bloqueava "Gerar documentos").
--   - re-reserva de tira / criação de OP por cor de tira perdia a referência.
--
-- O create (useCreateSaleOrder) nunca teve o bug porque insere via spread {...i}.
-- Esta migration alinha o update ao persistir strap_colors. Frontend passa a
-- enviar strap_colors no p_items (useUpdateSaleOrder). Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.update_sale_order_atomic(p_order_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so sale_orders%ROWTYPE;
  v_merged sale_orders%ROWTYPE;
  v_inserted_ids uuid[] := '{}';
  v_item jsonb;
  v_new_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- 1. Lock sale_order
  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_order_id;
  END IF;

  -- 2. Merge p_header com row atual (campos não passados ficam com valor atual)
  v_merged := jsonb_populate_record(v_so, p_header);
  -- Proteções: não permite alterar id, status (state machine), created_at
  v_merged.id := v_so.id;
  v_merged.status := v_so.status;
  v_merged.created_at := v_so.created_at;
  v_merged.updated_at := now();

  -- 3. UPDATE
  UPDATE public.sale_orders SET
    order_number       = v_merged.order_number,
    client_name        = v_merged.client_name,
    client_cnpj        = v_merged.client_cnpj,
    client_contact     = v_merged.client_contact,
    client_id          = v_merged.client_id,
    representative     = v_merged.representative,
    representative_id  = v_merged.representative_id,
    payment_condition  = v_merged.payment_condition,
    delivery_deadline  = v_merged.delivery_deadline,
    notes              = v_merged.notes,
    total              = v_merged.total,
    commission_value   = v_merged.commission_value,
    client_order_number = v_merged.client_order_number,
    nfe                = v_merged.nfe,
    remessa            = v_merged.remessa,
    packaging_product_id = v_merged.packaging_product_id,
    packaging_quantity = v_merged.packaging_quantity,
    is_factoring       = v_merged.is_factoring,
    factoring_config_id = v_merged.factoring_config_id,
    packaging_mode     = v_merged.packaging_mode,
    delivery_week      = v_merged.delivery_week,
    delivery_month     = v_merged.delivery_month,
    billing_week       = v_merged.billing_week,
    manual_billing_override = v_merged.manual_billing_override,
    original_min_billing_date = v_merged.original_min_billing_date,
    manual_override_reason = v_merged.manual_override_reason,
    scheduled_dispatch_at = v_merged.scheduled_dispatch_at,
    modalidade_frete   = v_merged.modalidade_frete,
    transport_company_id = v_merged.transport_company_id,
    valor_frete        = v_merged.valor_frete,
    checked_by         = v_merged.checked_by,
    order_type         = v_merged.order_type,
    parent_order_id    = v_merged.parent_order_id,
    export_currency    = v_merged.export_currency,
    export_exchange_rate = v_merged.export_exchange_rate,
    export_incoterm    = v_merged.export_incoterm,
    shipping_rate_per_pair = v_merged.shipping_rate_per_pair,
    nfe_required       = v_merged.nfe_required,
    own_delivery       = v_merged.own_delivery,
    updated_at         = v_merged.updated_at
  WHERE id = p_order_id;

  -- 4. Replace items: DELETE old + INSERT new
  DELETE FROM public.sale_order_items WHERE sale_order_id = p_order_id;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.sale_order_items (
        sale_order_id,
        reference_id,
        color,
        quantity,
        unit_price,
        grade,
        fichas,
        observation,
        material_variant_id,
        strap_colors
      ) VALUES (
        p_order_id,
        (v_item->>'reference_id')::uuid,
        COALESCE(v_item->>'color', ''),
        COALESCE((v_item->>'quantity')::integer, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE(v_item->'grade', '{}'::jsonb),
        COALESCE((v_item->>'fichas')::integer, 1),
        NULLIF(v_item->>'observation', ''),
        NULLIF(v_item->>'material_variant_id', '')::uuid,
        -- aceita array; quando ausente/null cai pro default '[]'
        CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
             THEN v_item->'strap_colors'
             ELSE '[]'::jsonb END
      )
      RETURNING id INTO v_new_id;
      v_inserted_ids := v_inserted_ids || v_new_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_inserted_ids),
    'order_id', p_order_id
  );
END;
$function$;
