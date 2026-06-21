-- Terceirização PARCIAL por serviço (split fábrica × rua).
-- O item do PV passa a guardar QUANTOS pares de cada serviço terceirizado vão pra
-- rua: { terceirizacao_id (uuid texto): pares }. Ausente/NULL = manda o total do
-- item (compatível com o comportamento anterior). As 3 RPCs do envio/atualização de
-- OS passam a somar essa quantidade parcial em vez do total fixo.
-- Aplicada via MCP em 2026-06-21.

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS terceirizacao_quantities jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.get_pv_terceirizacao_lines(p_sale_order_id uuid)
 RETURNS TABLE(reference_id uuid, color text, ref_code text, terceirizacao_id uuid, contractor_id uuid, contractor_name text, description text, value_per_pair numeric, terceirizacao_active boolean, qty numeric, os_id uuid, os_number text, os_status text, os_quantity numeric, os_total numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    agg.reference_id, agg.color, agg.ref_code, agg.terceirizacao_id,
    t.contractor_id, COALESCE(c.trade_name, c.name) AS contractor_name,
    t.description, t.value_per_pair, t.active AS terceirizacao_active, agg.qty,
    so.id AS os_id, so.order_number AS os_number, so.status AS os_status,
    so.quantity AS os_quantity, so.total_value AS os_total
  FROM (
    SELECT
      i.reference_id, COALESCE(i.color, '') AS color, ts.code AS ref_code, sel.tid AS terceirizacao_id,
      (i.reference_id::text || '::' || COALESCE(i.color, '')) AS item_key,
      SUM(COALESCE(NULLIF(i.terceirizacao_quantities->>sel.tid::text, '')::numeric, i.quantity, 0))::numeric AS qty
    FROM public.sale_order_items i
    JOIN LATERAL unnest(COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[])) AS sel(tid) ON true
    LEFT JOIN public.technical_sheets ts ON ts.id = i.reference_id
    WHERE i.sale_order_id = p_sale_order_id
    GROUP BY 1, 2, 3, 4, 5
  ) agg
  JOIN public.reference_terceirizacoes t ON t.id = agg.terceirizacao_id
  LEFT JOIN public.contractors c ON c.id = t.contractor_id
  LEFT JOIN public.service_orders so
    ON so.source_sale_order_id = p_sale_order_id
   AND so.source_item_key = agg.item_key
   AND so.source_terceirizacao_id = agg.terceirizacao_id
  ORDER BY agg.ref_code NULLS LAST, agg.color, t.description;
$function$;

CREATE OR REPLACE FUNCTION public.send_terceirizacao_os(p_sale_order_id uuid, p_reference_id uuid, p_color text, p_terceirizacao_id uuid, p_reactivate boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD; v_t RECORD; v_notes text; v_due date; v_color text := COALESCE(p_color, '');
  v_item_key text; v_qty numeric; v_any_item_id uuid; v_ref_code text; v_desc text;
  v_existing RECORD; v_os_id uuid;
  v_finalized constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado'];
BEGIN
  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sale_order_not_found'); END IF;
  IF lower(btrim(COALESCE(v_so.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'sale_order_cancelled');
  END IF;
  SELECT id, contractor_id, description, value_per_pair INTO v_t
    FROM public.reference_terceirizacoes WHERE id = p_terceirizacao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'terceirizacao_not_found'); END IF;
  v_item_key := p_reference_id::text || '::' || v_color;
  SELECT SUM(COALESCE(NULLIF(i.terceirizacao_quantities->>p_terceirizacao_id::text, '')::numeric, i.quantity, 0))::numeric,
         (array_agg(i.id ORDER BY i.id))[1]
    INTO v_qty, v_any_item_id
  FROM public.sale_order_items i
  WHERE i.sale_order_id = p_sale_order_id AND i.reference_id = p_reference_id
    AND COALESCE(i.color, '') = v_color
    AND p_terceirizacao_id = ANY (COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[]));
  IF v_qty IS NULL OR v_qty <= 0 THEN RETURN jsonb_build_object('error', 'line_not_marked'); END IF;
  SELECT code INTO v_ref_code FROM public.technical_sheets WHERE id = p_reference_id;
  IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
    v_notes := 'PV cliente: ' || btrim(v_so.client_order_number) || ' | PV interno: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  ELSE
    v_notes := 'PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  END IF;
  v_due := COALESCE(v_so.delivery_deadline, (CURRENT_DATE + INTERVAL '30 days')::date);
  v_desc := v_t.description || ' — Ref ' || COALESCE(v_ref_code, '?') || COALESCE(' ' || NULLIF(btrim(v_color), ''), '');
  SELECT * INTO v_existing FROM public.service_orders so
   WHERE so.source_sale_order_id = p_sale_order_id AND so.source_item_key = v_item_key
     AND so.source_terceirizacao_id = p_terceirizacao_id LIMIT 1;
  IF FOUND THEN
    IF v_existing.status = ANY (v_finalized) THEN
      RETURN jsonb_build_object('action', 'finalized_untouched', 'os_id', v_existing.id);
    END IF;
    IF v_existing.status = 'Cancelado' THEN
      IF NOT p_reactivate THEN RETURN jsonb_build_object('action', 'skipped_cancelled', 'os_id', v_existing.id); END IF;
      UPDATE public.service_orders so SET
        contractor_id = v_t.contractor_id, description = v_desc, service_date = CURRENT_DATE,
        quantity = v_qty, unit_price = v_t.value_per_pair, total_value = v_qty * v_t.value_per_pair,
        payment_due_date = v_due, notes = v_notes, source_sale_order_item_id = v_any_item_id,
        status = 'Pendente', updated_at = now()
      WHERE so.id = v_existing.id;
      RETURN jsonb_build_object('action', 'reactivated', 'os_id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id);
  END IF;
  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value, status, notes,
    payment_due_date, is_avulsa, source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key
  ) VALUES (
    v_t.contractor_id, v_desc, CURRENT_DATE, v_qty, v_t.value_per_pair, v_qty * v_t.value_per_pair,
    'Pendente', v_notes, v_due, false, p_sale_order_id, v_any_item_id, p_terceirizacao_id, v_item_key
  ) RETURNING id INTO v_os_id;
  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_terceirizacao_os_qty(p_service_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_os RECORD; v_qty numeric;
BEGIN
  SELECT id, source_sale_order_id, source_item_key, source_terceirizacao_id, unit_price, status
    INTO v_os FROM public.service_orders WHERE id = p_service_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'os_not_found'); END IF;
  IF v_os.source_sale_order_id IS NULL THEN RETURN jsonb_build_object('error', 'not_pv_linked'); END IF;
  SELECT SUM(COALESCE(NULLIF(i.terceirizacao_quantities->>v_os.source_terceirizacao_id::text, '')::numeric, i.quantity, 0))::numeric INTO v_qty
  FROM public.sale_order_items i
  WHERE i.sale_order_id = v_os.source_sale_order_id
    AND (i.reference_id::text || '::' || COALESCE(i.color, '')) = v_os.source_item_key
    AND v_os.source_terceirizacao_id = ANY (COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[]));
  IF v_qty IS NULL OR v_qty <= 0 THEN RETURN jsonb_build_object('error', 'line_not_marked'); END IF;
  UPDATE public.service_orders SET quantity = v_qty, total_value = v_qty * COALESCE(unit_price, 0), updated_at = now()
  WHERE id = p_service_order_id;
  RETURN jsonb_build_object('quantity', v_qty, 'total', v_qty * COALESCE(v_os.unit_price, 0));
END;
$function$;
