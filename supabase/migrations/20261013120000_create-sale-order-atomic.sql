-- Criação atômica e idempotente de pedido de venda.
-- Cabeçalho e itens pertencem à mesma chamada RPC: qualquer erro em um item
-- aborta a transação inteira, sem deixar um PV parcial persistido.

CREATE OR REPLACE FUNCTION public.create_sale_order_atomic(
  p_header jsonb,
  p_items jsonb,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_header sale_orders%ROWTYPE;
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items deve ser um array JSON';
  END IF;

  -- Caminho barato para retries depois que o primeiro request já comitou.
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO v_order_id
      FROM public.sale_orders
     WHERE client_request_id = p_client_request_id;

    IF FOUND THEN
      SELECT COALESCE(array_agg(id ORDER BY created_at, id), '{}')
        INTO v_item_ids
        FROM public.sale_order_items
       WHERE sale_order_id = v_order_id;

      RETURN jsonb_build_object(
        'order_id', v_order_id,
        'item_ids', to_jsonb(v_item_ids),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  v_header := jsonb_populate_record(NULL::public.sale_orders, p_header);

  -- ON CONFLICT também cobre duas tentativas concorrentes com a mesma chave.
  -- Quando a outra transação vence, o SELECT abaixo devolve o PV dela e não
  -- há uma segunda inserção de itens.
  INSERT INTO public.sale_orders (
    order_number, client_name, client_cnpj, client_contact, client_id,
    representative, representative_id, payment_condition, delivery_deadline,
    notes, status, total, commission_value, client_order_number, nfe,
    company_id, informacoes_complementares_nf, brand, transporter_id,
    nfe_external, external_nfe_number, remessa, packaging_product_id,
    packaging_quantity, is_factoring, factoring_config_id, packaging_mode,
    delivery_week, delivery_month, billing_week, manual_billing_override,
    original_min_billing_date, manual_override_reason, scheduled_dispatch_at,
    modalidade_frete, transport_company_id, valor_frete, checked_by,
    order_type, parent_order_id, export_currency, export_exchange_rate,
    export_incoterm, shipping_rate_per_pair, nfe_required, own_delivery,
    outsource_to_contractor_id, outsource_to_sector, client_request_id
  ) VALUES (
    COALESCE(v_header.order_number, ''),
    COALESCE(v_header.client_name, ''),
    COALESCE(v_header.client_cnpj, ''),
    COALESCE(v_header.client_contact, ''),
    v_header.client_id,
    COALESCE(v_header.representative, ''),
    v_header.representative_id,
    COALESCE(v_header.payment_condition, ''),
    v_header.delivery_deadline,
    COALESCE(v_header.notes, ''),
    COALESCE(v_header.status, 'Pendente'),
    COALESCE(v_header.total, 0),
    COALESCE(v_header.commission_value, 0),
    COALESCE(v_header.client_order_number, ''),
    COALESCE(v_header.nfe, ''),
    v_header.company_id,
    v_header.informacoes_complementares_nf,
    COALESCE(v_header.brand, 'Squad Shoes'),
    v_header.transporter_id,
    COALESCE(v_header.nfe_external, false),
    v_header.external_nfe_number,
    COALESCE(v_header.remessa, ''),
    v_header.packaging_product_id,
    COALESCE(v_header.packaging_quantity, 0),
    COALESCE(v_header.is_factoring, false),
    v_header.factoring_config_id,
    v_header.packaging_mode,
    v_header.delivery_week,
    v_header.delivery_month,
    v_header.billing_week,
    COALESCE(v_header.manual_billing_override, false),
    v_header.original_min_billing_date,
    v_header.manual_override_reason,
    v_header.scheduled_dispatch_at,
    v_header.modalidade_frete,
    v_header.transport_company_id,
    v_header.valor_frete,
    v_header.checked_by,
    COALESCE(v_header.order_type, 'carteira'),
    v_header.parent_order_id,
    v_header.export_currency,
    v_header.export_exchange_rate,
    v_header.export_incoterm,
    COALESCE(v_header.shipping_rate_per_pair, 0),
    COALESCE(v_header.nfe_required, true),
    COALESCE(v_header.own_delivery, false),
    v_header.outsource_to_contractor_id,
    v_header.outsource_to_sector,
    p_client_request_id
  )
  ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id
      FROM public.sale_orders
     WHERE client_request_id = p_client_request_id;

    SELECT COALESCE(array_agg(id ORDER BY created_at, id), '{}')
      INTO v_item_ids
      FROM public.sale_order_items
     WHERE sale_order_id = v_order_id;

    RETURN jsonb_build_object(
      'order_id', v_order_id,
      'item_ids', to_jsonb(v_item_ids),
      'idempotent_replay', true
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.sale_order_items (
      sale_order_id, reference_id, color, quantity, unit_price,
      grade, fichas, observation, material_variant_id, strap_colors
    ) VALUES (
      v_order_id,
      (v_item->>'reference_id')::uuid,
      COALESCE(v_item->>'color', ''),
      COALESCE((v_item->>'quantity')::integer, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE(v_item->'grade', '{}'::jsonb),
      COALESCE((v_item->>'fichas')::integer, 1),
      NULLIF(v_item->>'observation', ''),
      NULLIF(v_item->>'material_variant_id', '')::uuid,
      CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
           THEN v_item->'strap_colors'
           ELSE '[]'::jsonb END
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || v_item_id;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'item_ids', to_jsonb(v_item_ids),
    'idempotent_replay', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.create_sale_order_atomic(jsonb, jsonb, uuid) IS
  'Cria cabeçalho e itens de PV em uma única transação. client_request_id repetido devolve o mesmo PV sem duplicar itens.';
