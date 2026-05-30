-- =============================================================================
-- SUPPLIERS: cálculo automático de avg_lead_time_days + on_time_rate (2026-05-29)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
-- Arquivo no repo pra histórico.
--
-- Diagnóstico antes do fix:
--   - suppliers tem colunas avg_lead_time_days, on_time_rate, last_purchase_date
--     mas NÃO havia função/trigger que populasse elas. Sempre NULL.
--   - Lead time mostrado na UI vinha só de lead_time_days (configurado manual)
--     — não refletia desempenho real.
--   - 11 fornecedores ativos, 0 com avg_lead_time_days calculado.
--
-- Fix:
--   1. Função refresh_supplier_lead_time_stats(supplier_id) — recalcula
--      avg_lead_time_days, on_time_rate, last_purchase_date a partir das
--      últimas 20 OCs recebidas do fornecedor.
--   2. Trigger AFTER INSERT/UPDATE/DELETE em purchase_orders quando received_at
--      ou promised_date ou status mudam.
--   3. Backfill — roda em todos suppliers que têm OCs recebidas.
--
-- Definições:
--   - avg_lead_time_days = média de (received_at - created_at) em dias,
--     últimas 20 OCs recebidas, ignorando 'cancelled'
--   - on_time_rate = % de OCs com received_at <= promised_date. NULL quando
--     não há OC com promised_date (mais honesto que default 100%).
--   - last_purchase_date = MAX(received_at::date)
--
-- Frontend (commit relacionado):
--   - SupplierFormDialog ganha campos: supplier_category, homologation_status,
--     certifications, min_order_quantity, ratings (qualidade/entrega/preço/
--     atendimento como 0-5 estrelas)
--   - Listagem mostra "X d real / Y d cfg" quando ambos existem,
--     pontualidade < 100% colorida, badge de homologação em_homologacao/bloqueado
-- =============================================================================

CREATE OR REPLACE FUNCTION public.refresh_supplier_lead_time_stats(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_avg_lead numeric;
  v_on_time_rate numeric;
  v_last_purchase date;
  v_total_recebidas int;
  v_no_prazo int;
BEGIN
  SELECT
    AVG(EXTRACT(epoch FROM (received_at - created_at)) / 86400.0),
    MAX(received_at::date)
  INTO v_avg_lead, v_last_purchase
  FROM (
    SELECT received_at, created_at
    FROM purchase_orders
    WHERE supplier_id = p_supplier_id
      AND status NOT IN ('cancelled')
      AND received_at IS NOT NULL
      AND created_at IS NOT NULL
    ORDER BY received_at DESC
    LIMIT 20
  ) recentes;

  SELECT
    COUNT(*) FILTER (WHERE promised_date IS NOT NULL),
    COUNT(*) FILTER (WHERE promised_date IS NOT NULL AND received_at::date <= promised_date)
  INTO v_total_recebidas, v_no_prazo
  FROM purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('cancelled')
    AND received_at IS NOT NULL;

  IF v_total_recebidas > 0 THEN
    v_on_time_rate := (v_no_prazo::numeric / v_total_recebidas::numeric) * 100.0;
  ELSE
    v_on_time_rate := NULL;
  END IF;

  UPDATE public.suppliers
  SET avg_lead_time_days = ROUND(v_avg_lead::numeric, 1),
      on_time_rate = ROUND(v_on_time_rate::numeric, 1),
      last_purchase_date = v_last_purchase,
      updated_at = now()
  WHERE id = p_supplier_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_refresh_supplier_lead_time_stats()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.received_at IS NOT NULL AND NEW.supplier_id IS NOT NULL THEN
    PERFORM public.refresh_supplier_lead_time_stats(NEW.supplier_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.supplier_id IS NOT NULL
        AND (NEW.received_at IS DISTINCT FROM OLD.received_at
             OR NEW.promised_date IS DISTINCT FROM OLD.promised_date
             OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.refresh_supplier_lead_time_stats(NEW.supplier_id);
  ELSIF TG_OP = 'DELETE' AND OLD.received_at IS NOT NULL AND OLD.supplier_id IS NOT NULL THEN
    PERFORM public.refresh_supplier_lead_time_stats(OLD.supplier_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_refresh_supplier_lead_time_stats ON public.purchase_orders;
CREATE TRIGGER tg_refresh_supplier_lead_time_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_supplier_lead_time_stats();

DO $$
DECLARE
  v_sid uuid;
BEGIN
  FOR v_sid IN
    SELECT DISTINCT supplier_id FROM purchase_orders
    WHERE supplier_id IS NOT NULL AND received_at IS NOT NULL
  LOOP
    PERFORM public.refresh_supplier_lead_time_stats(v_sid);
  END LOOP;
END $$;
