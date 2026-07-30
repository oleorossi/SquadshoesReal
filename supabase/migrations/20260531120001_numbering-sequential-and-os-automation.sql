-- =============================================================================
-- NUMERAÇÃO SEQUENCIAL + AUTOMAÇÃO DE ORDEM DE SERVIÇO
-- =============================================================================
-- Solicitações do usuário:
--   #1 Numeração sequencial pura (PV/OP/OC/OS) — remover ano da numeração
--   #2 Verificar fluxo artesanal — descoberto: faltam colunas em accounts_payable
--   #3 OS é lançada no financeiro (accounts_payable) AUTOMATICAMENTE via trigger
--   #4 Ao concluir OS, baixa material base + entra produto artesanal em estoque
--      (DECISÃO: mantido no frontend Contractors.tsx, que já é idempotente —
--       trigger DB criaria duplicação pq frontend faz produceArtisanalOutput +
--       debitStockForMaterials no onSuccess do mutate)
--
-- Bugs encontrados durante investigação:
--   - accounts_payable não tinha reference_id/reference_type (frontend Contractors.tsx
--     usa essas colunas em INSERT/SELECT — falha silenciosa em produção).
--   - Sequences (pv_number_seq, oc_number_seq, so_number_seq) nunca foram chamadas
--     porque os PVs existentes vieram de seed direto. Reset pra continuar do MAX.
--   - materialAvailability.ts pulava produtos artesanais (line 104), tornando o
--     branch artesanal do MaterialPurchaseConfirmDialog dead code (corrigido em FE).
--
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- #A FIX: adiciona colunas reference_id/type em accounts_payable
-- ----------------------------------------------------------------------------
ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS reference_id uuid,
  ADD COLUMN IF NOT EXISTS reference_type text;

CREATE INDEX IF NOT EXISTS idx_accounts_payable_reference
  ON public.accounts_payable (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_ap_per_service_order;
CREATE UNIQUE INDEX uq_ap_per_service_order
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'service_order';

-- ----------------------------------------------------------------------------
-- #B FIX: reseta sequences pra continuar do MAX atual e remove ano da numeração
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_pv_max int;
  v_op_max int;
  v_oc_max int;
  v_so_max int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '^.*-', ''), '')::int), 0)
    INTO v_pv_max FROM public.sale_orders WHERE order_number ~ '^PV';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '^.*-', ''), '')::int), 0)
    INTO v_op_max FROM public.orders WHERE order_number ~ '^OP';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '^.*-', ''), '')::int), 0)
    INTO v_oc_max FROM public.purchase_orders WHERE order_number ~ '^OC';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(order_number, '^.*-', ''), '')::int), 0)
    INTO v_so_max FROM public.service_orders WHERE order_number ~ '^OS';

  PERFORM setval('public.pv_number_seq', GREATEST(v_pv_max, 1), v_pv_max > 0);
  PERFORM setval('public.op_number_seq', GREATEST(v_op_max, 1), v_op_max > 0);
  PERFORM setval('public.oc_number_seq', GREATEST(v_oc_max, 1), v_oc_max > 0);
  PERFORM setval('public.so_number_seq', GREATEST(v_so_max, 1), v_so_max > 0);

  RAISE NOTICE 'Sequences resetadas: pv=% op=% oc=% so=%', v_pv_max, v_op_max, v_oc_max, v_so_max;
END $$;

CREATE OR REPLACE FUNCTION public.generate_pv_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'PV-' || lpad(nextval('pv_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_op_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OP-' || lpad(nextval('op_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_oc_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OC-' || lpad(nextval('oc_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_so_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.order_number = '' OR NEW.order_number IS NULL THEN
    NEW.order_number := 'OS-' || lpad(nextval('so_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- #C TRIGGER: service_orders AFTER INSERT → cria accounts_payable
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tg_create_ap_for_service_order() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_supplier_id uuid;
  v_due_date    date;
  v_amount      numeric;
BEGIN
  v_amount := COALESCE(NEW.total_value, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  SELECT supplier_id INTO v_supplier_id
  FROM public.contractors WHERE id = NEW.contractor_id;

  v_due_date := COALESCE(NEW.service_date, CURRENT_DATE) + INTERVAL '30 days';

  IF EXISTS (
    SELECT 1 FROM public.accounts_payable
    WHERE reference_type = 'service_order' AND reference_id = NEW.id
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) ||
      ' — ' || COALESCE(NEW.description, 'Ordem de serviço'),
    v_supplier_id,
    'service',
    v_due_date,
    v_amount,
    'pending',
    NEW.id,
    'service_order',
    'Lançamento automático criado a partir da OS'
  );

  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_create_ap_for_service_order() TO authenticated;

DROP TRIGGER IF EXISTS trg_create_ap_for_service_order ON public.service_orders;
CREATE TRIGGER trg_create_ap_for_service_order
  AFTER INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_ap_for_service_order();

-- ----------------------------------------------------------------------------
-- #D TRIGGER: service_orders AFTER UPDATE total_value/status → sincroniza AP
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.tg_create_ap_for_service_order_helper(public.service_orders) CASCADE;
CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order_helper(p_so public.service_orders)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_supplier_id uuid;
  v_due_date date;
BEGIN
  IF p_so.total_value <= 0 THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts_payable
             WHERE reference_type='service_order' AND reference_id = p_so.id) THEN
    RETURN;
  END IF;
  SELECT supplier_id INTO v_supplier_id FROM public.contractors WHERE id = p_so.contractor_id;
  v_due_date := COALESCE(p_so.service_date, CURRENT_DATE) + INTERVAL '30 days';
  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(p_so.order_number, p_so.id::text) ||
      ' — ' || COALESCE(p_so.description, 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, p_so.total_value, 'pending',
    p_so.id, 'service_order', 'Lançamento automático (atualizado a partir da OS)'
  );
END;
$$;

DROP FUNCTION IF EXISTS public.tg_sync_ap_on_service_order_update() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_sync_ap_on_service_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.total_value IS DISTINCT FROM OLD.total_value AND NEW.total_value > 0 THEN
    UPDATE public.accounts_payable
    SET amount = NEW.total_value, updated_at = now()
    WHERE reference_type = 'service_order' AND reference_id = NEW.id
      AND status = 'pending';
  END IF;
  IF NEW.total_value > 0 AND COALESCE(OLD.total_value, 0) <= 0 THEN
    PERFORM public.tg_create_ap_for_service_order_helper(NEW);
  END IF;
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_sync_ap_on_service_order_update() TO authenticated;

DROP TRIGGER IF EXISTS trg_sync_ap_on_service_order_update ON public.service_orders;
CREATE TRIGGER trg_sync_ap_on_service_order_update
  AFTER UPDATE OF total_value, status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_ap_on_service_order_update();

COMMENT ON FUNCTION public.tg_create_ap_for_service_order() IS
  'Cria accounts_payable automaticamente quando OS é inserida com total_value > 0. '
  'Idempotente via uq_ap_per_service_order (reference_type=service_order, reference_id).';
COMMENT ON FUNCTION public.tg_sync_ap_on_service_order_update() IS
  'Sincroniza AP quando OS muda valor. Só atualiza APs com status=pending.';
