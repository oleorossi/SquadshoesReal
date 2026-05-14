-- ============================================================================
-- Refinamentos do fluxo de OS terceirizada (sessão 2026-05-13).
-- ============================================================================
-- Pedidos do usuário:
-- 1. Prazo cadastrado JÁ NA CRIAÇÃO da OS (não em etapa separada).
-- 2. OP só destrava pra Montagem quando peças forem RECEBIDAS (não no prazo).
-- 3. AP gerado APENAS quando OS é finalizada (status received/Concluído).
-- 4. Tempo de pagamento (due_date) baseado em contractors.payment_days.
-- 5. Quando aparece gargalo novo, oferecer encaminhar TODAS as OPs do gargalo
--    a um único terceirizado de uma vez (bulk assign — frontend).
-- ============================================================================

-- (1) Trigger de bloqueio Montagem — agora bloqueia até status finalizado
--    (received/Concluído/etc), não apenas até quoted_deadline preenchido.
CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pending_os_count int;
BEGIN
  IF NEW.stage_name <> 'Montagem' THEN RETURN NEW; END IF;
  IF NEW.status <> 'em_andamento' AND NEW.status <> 'em_progresso' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND (OLD.status = 'em_andamento' OR OLD.status = 'em_progresso') THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status NOT IN ('received', 'Concluído', 'concluido', 'Cancelado', 'cancelled', 'cancelado');

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) em andamento. Marque as peças como recebidas em /terceirizados antes de avançar pra Montagem.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_block_montagem_with_pending_service_order IS
  'Bloqueia avanço pra Montagem enquanto houver OS terceirizada vinculada com status NÃO finalizado (received, Concluído, etc).';

-- (2) Trigger AP — agora só dispara quando status entra em finalizado,
--    base do due_date = hoje (data de recebimento) + payment_days.
CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_supplier_id uuid;
  v_due_date    date;
  v_amount      numeric;
  v_has_supplier_col boolean;
  v_payment_days int;
  v_base_date date;
  v_finalized_statuses constant text[] := ARRAY['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado'];
BEGIN
  IF NEW.status IS NULL OR NOT (NEW.status = ANY (v_finalized_statuses)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT NULL AND OLD.status = ANY (v_finalized_statuses) THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.total_value, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts_payable
    WHERE reference_type = 'service_order' AND reference_id = NEW.id
  ) THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contractors' AND column_name='supplier_id'
  ) INTO v_has_supplier_col;

  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING NEW.contractor_id;
  ELSE
    v_supplier_id := NULL;
  END IF;

  SELECT COALESCE(c.payment_days, 30) INTO v_payment_days
  FROM public.contractors c WHERE c.id = NEW.contractor_id;
  v_payment_days := COALESCE(v_payment_days, 30);

  v_base_date := CURRENT_DATE;
  v_due_date  := v_base_date + (v_payment_days || ' days')::interval;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) ||
      ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending',
    NEW.id, 'service_order',
    'AP gerado automaticamente após finalização da OS em ' || v_base_date::text ||
      '. Vencimento: ' || v_payment_days || ' dias (payment_days da contratada).'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_create_ap_for_service_order ON public.service_orders;
CREATE TRIGGER tg_create_ap_for_service_order
  AFTER INSERT OR UPDATE OF status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_ap_for_service_order();

COMMENT ON FUNCTION public.tg_create_ap_for_service_order IS
  'Cria accounts_payable APENAS quando OS é finalizada (received/Concluído/finalizado). Idempotente. due_date = hoje + payment_days da contratada.';
