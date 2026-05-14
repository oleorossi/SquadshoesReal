-- ============================================================================
-- BUG FIX PRÉ-EXISTENTE descoberto durante auditoria E2E do fluxo de gargalos:
-- `tg_create_ap_for_service_order` tentava ler `contractors.supplier_id`,
-- mas essa coluna não existe na tabela. Toda inserção em service_orders
-- falhava com ERROR: 42703 — column "supplier_id" does not exist.
--
-- Impacto: nenhuma OS terceirizada podia ser criada (nem via /terceirizados,
-- nem via /gargalos). O comentário original do trigger já dizia "Caso
-- contrário, deixamos nulo", mas o SELECT direto na coluna inexistente
-- abortava a transação antes de chegar nesse fallback.
--
-- Fix: detecta runtime se a coluna existe via information_schema antes
-- de tentar lê-la com EXECUTE dinâmico. Quando a coluna não existe,
-- supplier_id fica NULL no AP (suportado pelo schema).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_supplier_id uuid;
  v_due_date    date;
  v_amount      numeric;
  v_has_supplier_col boolean;
BEGIN
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

  v_due_date := COALESCE(NEW.service_date, CURRENT_DATE) + INTERVAL '30 days';

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) ||
      ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending',
    NEW.id, 'service_order', 'Lançamento automático criado a partir da OS'
  );

  RETURN NEW;
END;
$$;
