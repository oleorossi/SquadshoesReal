-- Bloco B — caminho automático PV→OS (aplicado via MCP em 2026-06-28).
-- (1) dispatch_tracked = false (regime unificado: paga por recebimento → tg_create_ap dispara o AP).
-- (2) Deriva e grava order_id (OP correspondente) p/ a trava de Montagem casar
--     (so.order_id = order_stages.order_id). Best-effort: casa por sale_order_item_id + cor;
--     fallback por sale_order_id + reference + cor; fica null se a OP ainda não existe.
CREATE OR REPLACE FUNCTION public.send_terceirizacao_os(p_sale_order_id uuid, p_reference_id uuid, p_color text, p_terceirizacao_id uuid, p_reactivate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD; v_t RECORD; v_notes text; v_due date; v_color text := COALESCE(p_color, '');
  v_item_key text; v_qty numeric; v_any_item_id uuid; v_ref_code text; v_desc text;
  v_existing RECORD; v_os_id uuid; v_order_id uuid;
  v_finalized constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado','Recebida','recebida'];
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

  SELECT id INTO v_order_id FROM public.orders
   WHERE sale_order_item_id = v_any_item_id
     AND lower(trim(coalesce(color, ''))) = lower(trim(v_color))
   ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT id INTO v_order_id FROM public.orders
     WHERE sale_order_id = p_sale_order_id AND reference_id = p_reference_id
       AND lower(trim(coalesce(color, ''))) = lower(trim(v_color))
     ORDER BY created_at NULLS LAST LIMIT 1;
  END IF;

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
        order_id = COALESCE(so.order_id, v_order_id),
        status = 'Pendente', dispatch_tracked = false, updated_at = now()
      WHERE so.id = v_existing.id;
      RETURN jsonb_build_object('action', 'reactivated', 'os_id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id);
  END IF;
  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value, status, notes,
    payment_due_date, is_avulsa, source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key,
    order_id, dispatch_tracked
  ) VALUES (
    v_t.contractor_id, v_desc, CURRENT_DATE, v_qty, v_t.value_per_pair, v_qty * v_t.value_per_pair,
    'Pendente', v_notes, v_due, false, p_sale_order_id, v_any_item_id, p_terceirizacao_id, v_item_key,
    v_order_id, false
  ) RETURNING id INTO v_os_id;
  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
END;
$function$;
