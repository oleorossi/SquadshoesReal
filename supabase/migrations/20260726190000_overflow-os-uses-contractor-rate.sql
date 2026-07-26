-- =============================================================================
-- ONDA 02 — OS de transbordo deixa de nascer sem preço (2026-07-26)
--
-- PROBLEMA: `commit_capacity_overflow_outsourcing` inseria a OS com
-- `unit_price = 0, total_value = 0`. Como `tg_create_ap_for_service_order` faz
-- `IF v_amount <= 0 THEN RETURN NEW`, toda OS criada pelo fluxo de sobrecarga
-- de capacidade é trabalho terceirizado que o sistema **esquece de cobrar** —
-- sem aviso, sem alerta, e sem nem aparecer como anomalia no relatório
-- financeiro (não vira 'missing_ap', porque a conta nunca deveria existir).
--
-- SEGUNDO DEFEITO no mesmo INSERT: `target_sector` não era gravado. Essa é a
-- chave de lookup da tarifa (`contractor_service_rates.sector`) e do rótulo de
-- setor na UI — sem ela, mesmo precificando depois o setor ficava vazio.
--
-- CORREÇÃO: busca a tarifa vigente do prestador para o setor via
-- `get_contractor_rate` (a mesma função que o formulário manual e
-- `generate_op_service_orders` já usam) e grava `target_sector`. Quando não há
-- tarifa cadastrada, a OS continua sendo criada — travar o fluxo de sobrecarga
-- no meio de um PV seria pior — mas volta na resposta em `unpriced`, para a UI
-- poder cobrar a precificação em vez de deixar passar em silêncio.
-- =============================================================================

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
  v_rate numeric;
  v_created_ids uuid[] := '{}';
  v_skipped text[] := '{}';
  v_unpriced text[] := '{}';
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

    -- Idempotência: OP já terceirizada NESTE setor → pula (evita OS duplicada em re-submit).
    IF v_order.outsourced_to_contractor_id IS NOT NULL
       AND COALESCE(v_order.outsourced_sector, '') = COALESCE(v_sector, '') THEN
      v_skipped := v_skipped || ('OP ' || COALESCE(v_order.order_number, v_order_id::text) || ' já terceirizada em ' || COALESCE(v_sector, '?'));
      CONTINUE;
    END IF;

    -- Valida que a OP TEM o setor no fluxo (pronta-na-cor não tem Costura → OS espúria).
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

    -- Tarifa vigente do prestador para o setor. Mesma fonte do formulário
    -- manual e de generate_op_service_orders.
    v_rate := COALESCE(public.get_contractor_rate(v_contractor_id, v_sector, CURRENT_DATE), 0);
    IF v_rate <= 0 THEN
      v_unpriced := v_unpriced || ('OP ' || COALESCE(v_order.order_number, v_order_id::text)
                    || ' — sem tarifa de ' || COALESCE(v_sector, '?') || ' para ' || COALESCE(v_contractor.name, '?'));
    END IF;

    INSERT INTO public.service_orders (
      order_id, sale_order_id, contractor_id, description, service_date, quantity, unit_price,
      total_value, status, target_sector
    ) VALUES (
      v_order_id, v_order.sale_order_id, v_contractor_id,
      format('Transbordo de capacidade — %s — OP %s (%s pares) ref/cor: %s',
             v_sector, v_order.order_number, v_order.quantity::text, COALESCE(v_order.color, '—')),
      CURRENT_DATE, v_order.quantity, v_rate, v_rate * COALESCE(v_order.quantity, 0), 'Pendente',
      v_sector
    )
    RETURNING id INTO v_os_id;

    v_created_ids := v_created_ids || v_os_id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'processed_count', v_processed,
    'created_service_order_ids', v_created_ids,
    'skipped', v_skipped,
    'unpriced', v_unpriced
  );
END;
$function$;
