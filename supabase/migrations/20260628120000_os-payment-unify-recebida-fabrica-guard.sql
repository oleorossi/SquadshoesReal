-- Bloco D — pagamento unificado da OS (aplicado via MCP em 2026-06-28).
-- (1) tg_create_ap_for_service_order: aceita 'Recebida' como status finalizado +
--     NÃO gera contas a pagar para o marcador interno FÁBRICA (payment_days >= 999).
-- (2) tg_block_montagem_with_pending_service_order: reconhece 'Recebida'/finalizado
--     como não-bloqueante (uma OS recebida não trava mais a Montagem).
-- (3) Backfill dispatch_tracked=false: regime unificado, toda OS paga por recebimento
--     (sem despacho parcial). dispatch_tracked será aposentado em fase futura.
-- ADITIVO: mantém 'received'/'Concluído'/'concluido'/'finalizado' funcionando — nada quebra.

CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_supplier_id uuid; v_due_date date; v_amount numeric; v_has_supplier_col boolean;
  v_payment_days int; v_base_date date;
  v_finalized_statuses constant text[] := ARRAY['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Recebida', 'recebida'];
BEGIN
  IF COALESCE(NEW.dispatch_tracked, false) THEN RETURN NEW; END IF;  -- OS dividida paga por recebimento
  IF NEW.status IS NULL OR NOT (NEW.status = ANY (v_finalized_statuses)) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT NULL AND OLD.status = ANY (v_finalized_statuses) THEN RETURN NEW; END IF;
  v_amount := public.service_order_payable_amount(NEW);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts_payable WHERE reference_type = 'service_order' AND reference_id = NEW.id) THEN RETURN NEW; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contractors' AND column_name='supplier_id') INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1' INTO v_supplier_id USING NEW.contractor_id;
  ELSE
    v_supplier_id := NULL;
  END IF;
  SELECT COALESCE(c.payment_days, 30) INTO v_payment_days FROM public.contractors c WHERE c.id = NEW.contractor_id;
  v_payment_days := COALESCE(v_payment_days, 30);
  -- FÁBRICA / marcador interno (payment_days >= 999): trabalho interno NÃO vira contas a pagar.
  IF v_payment_days >= 999 THEN RETURN NEW; END IF;
  v_base_date := CURRENT_DATE;
  v_due_date  := v_base_date + (v_payment_days || ' days')::interval;
  INSERT INTO public.accounts_payable (description, supplier_id, category, due_date, amount, status, reference_id, reference_type, notes)
  VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) || ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending', NEW.id, 'service_order',
    'AP gerado na entrega da OS em ' || v_base_date::text || ' (pares bons devolvidos × preço). Vencimento: ' || v_payment_days || ' dias.'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_os_count int;
  v_status_norm text;
BEGIN
  IF lower(trim(COALESCE(NEW.stage_name, ''))) <> 'montagem' THEN RETURN NEW; END IF;
  v_status_norm := lower(trim(COALESCE(NEW.status, '')));
  IF v_status_norm NOT IN ('em_andamento', 'em_progresso') THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND lower(trim(COALESCE(OLD.status, ''))) IN ('em_andamento', 'em_progresso') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status NOT IN ('received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Recebida', 'recebida', 'Cancelado', 'cancelled', 'cancelado')
    AND so.montagem_override_at IS NULL
    AND (
      (so.quoted_deadline IS NULL AND so.service_date IS NULL)
      OR
      COALESCE(so.quoted_deadline, so.service_date + interval '10 days')
        >= public.add_business_days(CURRENT_DATE, -7)
    );

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) em andamento dentro do prazo. Marque como recebida em /terceirizados, libere com override (caso perdida), OU aguarde o vencimento + 7 dias úteis.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

UPDATE public.service_orders SET dispatch_tracked = false WHERE dispatch_tracked IS DISTINCT FROM false;
