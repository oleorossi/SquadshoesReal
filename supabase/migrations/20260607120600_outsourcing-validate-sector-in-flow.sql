-- Fix MÉDIO (auditoria 2026-06-06): commit_capacity_overflow_outsourcing terceirizava
-- QUALQUER OP do PV sem checar se a OP tem o setor no fluxo. OPs pronta-na-cor
-- (insole_ready_made) têm Costura removida por trigger → OS de Costura espúria. Agora
-- valida production_sectors da ficha e pula OP sem o setor (registra em skipped).
-- (Mantém o vínculo OS→OP + idempotência da 20260607120300.)
CREATE OR REPLACE FUNCTION public.commit_capacity_overflow_outsourcing(p_assignments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_order_id uuid;
  v_sector text;
  v_contractor_id uuid;
  v_order RECORD;
  v_contractor RECORD;
  v_os_id uuid;
  v_created_ids uuid[] := '{}';
  v_skipped text[] := '{}';
  v_processed integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'p_assignments deve ser array de {order_id, sector, contractor_id}';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_assignments) LOOP
    v_order_id := (v_item ->> 'order_id')::uuid;
    v_sector := v_item ->> 'sector';
    v_contractor_id := (v_item ->> 'contractor_id')::uuid;

    IF v_contractor_id IS NULL THEN CONTINUE; END IF;

    SELECT id, order_number, reference_id, color, quantity, sale_order_id,
           outsourced_to_contractor_id, outsourced_sector
      INTO v_order
      FROM public.orders
     WHERE id = v_order_id
       FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped := v_skipped || ('OP ' || v_order_id::text || ' não encontrada');
      CONTINUE;
    END IF;

    IF v_order.outsourced_to_contractor_id IS NOT NULL
       AND COALESCE(v_order.outsourced_sector, '') = COALESCE(v_sector, '') THEN
      v_skipped := v_skipped || ('OP ' || COALESCE(v_order.order_number, v_order_id::text) || ' já terceirizada em ' || COALESCE(v_sector, '?'));
      CONTINUE;
    END IF;

    IF v_sector IS NOT NULL AND v_order.reference_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.technical_sheets ts
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
      WHERE ts.id = v_order.reference_id
        AND public.sector_display_to_enum(x.value) = public.sector_display_to_enum(v_sector)
    ) THEN
      v_skipped := v_skipped || ('OP ' || COALESCE(v_order.order_number, v_order_id::text) || ' não tem o setor ' || v_sector || ' no fluxo');
      CONTINUE;
    END IF;

    SELECT id, name INTO v_contractor
      FROM public.contractors WHERE id = v_contractor_id AND active = true;
    IF NOT FOUND THEN
      v_skipped := v_skipped || ('Contractor ' || v_contractor_id::text || ' inativo/inexistente');
      CONTINUE;
    END IF;

    UPDATE public.orders
       SET outsourced_to_contractor_id = v_contractor_id,
           outsourced_sector = v_sector,
           outsourced_at = now()
     WHERE id = v_order_id;

    INSERT INTO public.service_orders (
      order_id, sale_order_id, contractor_id, description, service_date, quantity, unit_price,
      total_value, status
    ) VALUES (
      v_order_id, v_order.sale_order_id, v_contractor_id,
      format('Transbordo de capacidade — %s — OP %s (%s pares) ref/cor: %s',
             v_sector, v_order.order_number, v_order.quantity::text, COALESCE(v_order.color, '—')),
      CURRENT_DATE, v_order.quantity, 0, 0, 'Pendente'
    )
    RETURNING id INTO v_os_id;

    v_created_ids := v_created_ids || v_os_id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'processed_count', v_processed,
    'created_service_order_ids', v_created_ids,
    'skipped', v_skipped
  );
END;
$function$;
