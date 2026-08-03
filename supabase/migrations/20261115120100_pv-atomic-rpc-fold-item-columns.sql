-- Fase 1b de specs/pv-producao-performance-e-pendencias.md
-- Requisitos 26, 27, 28.
--
-- PROBLEMA: a RPC atômica grava o PV numa chamada, mas o cliente logo depois roda
-- DOIS laços seriais de UPDATE por item — origem das tiras (useSaleOrders.ts:51) e
-- intenção de terceirização (:696 na criação, :2110 na edição). PV de 12 itens =
-- ~26 idas e voltas para salvar, sendo 24 delas colunas que a própria RPC poderia
-- ter escrito junto. Além de lento, deixa o PV meio-salvo se a rede cair no meio.
--
-- ⚠ DIFERENÇA DE SEMÂNTICA ENTRE CRIAR E EDITAR (requisito 27) — não unificar:
--   CRIAR: mapa vazio de outsourced_sectors é o DEFAULT da coluna; omitir é igual.
--   EDITAR: mapa vazio significa "o usuário DESMARCOU todos os setores" e PRECISA
--           ser gravado. Pular o vazio faria a desmarcação não ter efeito.
-- Por isso o UPDATE usa `v_item ? 'chave'` (presença da chave no payload) em vez de
-- checar se o valor é vazio: payload que não menciona a coluna preserva o que está
-- gravado; payload que a menciona manda, inclusive com vazio.

-- ---------------------------------------------------------------------------
-- create_sale_order_atomic — grava as 4 colunas no INSERT do item
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale_order_atomic(p_header jsonb, p_items jsonb, p_client_request_id uuid DEFAULT NULL::uuid)
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
        'order_id', v_order_id, 'item_ids', to_jsonb(v_item_ids), 'idempotent_replay', true);
    END IF;
  END IF;

  v_header := jsonb_populate_record(NULL::public.sale_orders, p_header);

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
    COALESCE(v_header.order_number, ''), COALESCE(v_header.client_name, ''),
    COALESCE(v_header.client_cnpj, ''), COALESCE(v_header.client_contact, ''),
    v_header.client_id, COALESCE(v_header.representative, ''), v_header.representative_id,
    COALESCE(v_header.payment_condition, ''), v_header.delivery_deadline,
    COALESCE(v_header.notes, ''), COALESCE(v_header.status, 'Pendente'),
    COALESCE(v_header.total, 0), COALESCE(v_header.commission_value, 0),
    COALESCE(v_header.client_order_number, ''), COALESCE(v_header.nfe, ''),
    v_header.company_id, v_header.informacoes_complementares_nf,
    COALESCE(v_header.brand, 'Squad Shoes'), v_header.transporter_id,
    COALESCE(v_header.nfe_external, false), v_header.external_nfe_number,
    COALESCE(v_header.remessa, ''), v_header.packaging_product_id,
    COALESCE(v_header.packaging_quantity, 0), COALESCE(v_header.is_factoring, false),
    v_header.factoring_config_id, v_header.packaging_mode, v_header.delivery_week,
    v_header.delivery_month, v_header.billing_week,
    COALESCE(v_header.manual_billing_override, false), v_header.original_min_billing_date,
    v_header.manual_override_reason, v_header.scheduled_dispatch_at,
    v_header.modalidade_frete, v_header.transport_company_id, v_header.valor_frete,
    v_header.checked_by, COALESCE(v_header.order_type, 'carteira'), v_header.parent_order_id,
    v_header.export_currency, v_header.export_exchange_rate, v_header.export_incoterm,
    COALESCE(v_header.shipping_rate_per_pair, 0), COALESCE(v_header.nfe_required, true),
    COALESCE(v_header.own_delivery, false), v_header.outsource_to_contractor_id,
    v_header.outsource_to_sector, p_client_request_id
  )
  ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id FROM public.sale_orders WHERE client_request_id = p_client_request_id;
    SELECT COALESCE(array_agg(id ORDER BY created_at, id), '{}')
      INTO v_item_ids FROM public.sale_order_items WHERE sale_order_id = v_order_id;
    RETURN jsonb_build_object('order_id', v_order_id, 'item_ids', to_jsonb(v_item_ids), 'idempotent_replay', true);
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.sale_order_items (
      sale_order_id, reference_id, color, quantity, unit_price,
      grade, fichas, observation, material_variant_id, strap_colors,
      -- Fase 1b: eram 2 laços de UPDATE no cliente.
      strap_sourcing, selected_terceirizacao_ids, terceirizacao_quantities, outsourced_sectors
    ) VALUES (
      v_order_id, (v_item->>'reference_id')::uuid, COALESCE(v_item->>'color', ''),
      COALESCE((v_item->>'quantity')::integer, 0), COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE(v_item->'grade', '{}'::jsonb), COALESCE((v_item->>'fichas')::integer, 1),
      NULLIF(v_item->>'observation', ''), NULLIF(v_item->>'material_variant_id', '')::uuid,
      CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array' THEN v_item->'strap_colors' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(v_item->'strap_sourcing') = 'object' THEN v_item->'strap_sourcing' ELSE NULL END,
      CASE WHEN jsonb_typeof(v_item->'selected_terceirizacao_ids') = 'array'
           THEN ARRAY(SELECT NULLIF(t, '')::uuid
                        FROM jsonb_array_elements_text(v_item->'selected_terceirizacao_ids') t
                       WHERE NULLIF(t, '') IS NOT NULL)
           ELSE '{}'::uuid[] END,
      CASE WHEN jsonb_typeof(v_item->'terceirizacao_quantities') = 'object'
           THEN v_item->'terceirizacao_quantities' ELSE '{}'::jsonb END,
      CASE WHEN jsonb_typeof(v_item->'outsourced_sectors') = 'object'
           THEN v_item->'outsourced_sectors' ELSE '{}'::jsonb END
    )
    RETURNING id INTO v_item_id;
    v_item_ids := v_item_ids || v_item_id;
  END LOOP;

  RETURN jsonb_build_object('order_id', v_order_id, 'item_ids', to_jsonb(v_item_ids), 'idempotent_replay', false);
END;
$function$;

-- ---------------------------------------------------------------------------
-- update_sale_order_atomic — mesmas 4 colunas, semântica de EDIÇÃO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_sale_order_atomic(p_order_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so       sale_orders%ROWTYPE;
  v_merged   sale_orders%ROWTYPE;
  v_item     jsonb;
  v_item_id  uuid;
  v_new_id   uuid;
  v_kept_ids uuid[] := '{}';
  v_removed  int := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_order_id;
  END IF;

  v_merged := jsonb_populate_record(v_so, p_header);
  v_merged.id         := v_so.id;
  v_merged.status     := v_so.status;
  v_merged.created_at := v_so.created_at;
  v_merged.updated_at := now();

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
    company_id         = v_merged.company_id,
    informacoes_complementares_nf = v_merged.informacoes_complementares_nf,
    brand              = v_merged.brand,
    transporter_id     = v_merged.transporter_id,
    nfe_external       = v_merged.nfe_external,
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

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id := NULLIF(v_item->>'id', '')::uuid;

      -- Só atualiza se o id existe E pertence a ESTE pedido (id de outro PV
      -- vindo por engano vira insert, nunca sequestra a linha alheia).
      IF v_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.sale_order_items
         WHERE id = v_item_id AND sale_order_id = p_order_id
      ) THEN
        UPDATE public.sale_order_items SET
          reference_id        = (v_item->>'reference_id')::uuid,
          color               = COALESCE(v_item->>'color', ''),
          quantity            = COALESCE((v_item->>'quantity')::integer, 0),
          unit_price          = COALESCE((v_item->>'unit_price')::numeric, 0),
          grade               = COALESCE(v_item->'grade', '{}'::jsonb),
          fichas              = COALESCE((v_item->>'fichas')::integer, 1),
          observation         = NULLIF(v_item->>'observation', ''),
          material_variant_id = NULLIF(v_item->>'material_variant_id', '')::uuid,
          strap_colors        = CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
                                     THEN v_item->'strap_colors'
                                     ELSE '[]'::jsonb END,
          -- Fase 1b. Chave AUSENTE no payload preserva o gravado; chave PRESENTE
          -- manda, inclusive vazia (é assim que a desmarcação de setores funciona).
          strap_sourcing      = CASE WHEN v_item ? 'strap_sourcing'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'strap_sourcing') = 'object'
                                                THEN v_item->'strap_sourcing' ELSE NULL END)
                                     ELSE strap_sourcing END,
          selected_terceirizacao_ids = CASE WHEN v_item ? 'selected_terceirizacao_ids'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'selected_terceirizacao_ids') = 'array'
                                                THEN ARRAY(SELECT NULLIF(t, '')::uuid
                                                             FROM jsonb_array_elements_text(v_item->'selected_terceirizacao_ids') t
                                                            WHERE NULLIF(t, '') IS NOT NULL)
                                                ELSE '{}'::uuid[] END)
                                     ELSE selected_terceirizacao_ids END,
          terceirizacao_quantities = CASE WHEN v_item ? 'terceirizacao_quantities'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'terceirizacao_quantities') = 'object'
                                                THEN v_item->'terceirizacao_quantities' ELSE '{}'::jsonb END)
                                     ELSE terceirizacao_quantities END,
          outsourced_sectors  = CASE WHEN v_item ? 'outsourced_sectors'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'outsourced_sectors') = 'object'
                                                THEN v_item->'outsourced_sectors' ELSE '{}'::jsonb END)
                                     ELSE outsourced_sectors END
        WHERE id = v_item_id;
        v_kept_ids := v_kept_ids || v_item_id;
      ELSE
        INSERT INTO public.sale_order_items (
          sale_order_id, reference_id, color, quantity, unit_price,
          grade, fichas, observation, material_variant_id, strap_colors,
          strap_sourcing, selected_terceirizacao_ids, terceirizacao_quantities, outsourced_sectors
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
          CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
               THEN v_item->'strap_colors'
               ELSE '[]'::jsonb END,
          CASE WHEN jsonb_typeof(v_item->'strap_sourcing') = 'object' THEN v_item->'strap_sourcing' ELSE NULL END,
          CASE WHEN jsonb_typeof(v_item->'selected_terceirizacao_ids') = 'array'
               THEN ARRAY(SELECT NULLIF(t, '')::uuid
                            FROM jsonb_array_elements_text(v_item->'selected_terceirizacao_ids') t
                           WHERE NULLIF(t, '') IS NOT NULL)
               ELSE '{}'::uuid[] END,
          CASE WHEN jsonb_typeof(v_item->'terceirizacao_quantities') = 'object'
               THEN v_item->'terceirizacao_quantities' ELSE '{}'::jsonb END,
          CASE WHEN jsonb_typeof(v_item->'outsourced_sectors') = 'object'
               THEN v_item->'outsourced_sectors' ELSE '{}'::jsonb END
        )
        RETURNING id INTO v_new_id;
        v_kept_ids := v_kept_ids || v_new_id;
      END IF;
    END LOOP;
  END IF;

  -- Apaga APENAS o que sumiu do payload.
  DELETE FROM public.sale_order_items
   WHERE sale_order_id = p_order_id
     AND NOT (id = ANY(v_kept_ids));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_kept_ids),
    'item_ids',          to_jsonb(v_kept_ids),
    'removed_items',     v_removed,
    'order_id',          p_order_id
  );
END;
$function$;
