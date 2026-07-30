-- ════════════════════════════════════════════════════════════════════════════
-- "Comprar até" (purchase_by_date): backward do faturamento na OC
-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria 2026-06-28 (workflow): o backward correto (delivery_deadline − lead de
-- produção − buffer − lead do fornecedor) já existe em compute_wave_timeline /
-- purchase_projection_timeline, mas NENHUM creator de OC persistia isso. Toda OC
-- ganhava só promised_date = HOJE + lead do fornecedor (forward, via trigger) —
-- ETA do fornecedor, não "comprar até". Resultado: compra tarde em PV de produção
-- longa, cedo demais em PV distante.
--
-- Fix: coluna purchase_by_date + trigger que a deriva dos PVs vinculados
-- (per_pv=source_pv_ids, MRP/falta=linked_sale_order_ids) via compute_wave_timeline.
-- Mantém promised_date como ETA. (Aplicada via MCP; backfill das OCs abertas idem.)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS purchase_by_date date;
COMMENT ON COLUMN public.purchase_orders.purchase_by_date IS
  'Comprar até: backward do faturamento (delivery_deadline − lead produção − buffer − lead fornecedor) via compute_wave_timeline dos PVs vinculados. ≠ promised_date (ETA forward do fornecedor).';

CREATE OR REPLACE FUNCTION public.compute_po_purchase_by_date(p_sale_order_ids uuid[])
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
  SELECT t.purchase_deadline
  FROM public.compute_wave_timeline(p_sale_order_ids) t
  LIMIT 1;
$$;
COMMENT ON FUNCTION public.compute_po_purchase_by_date(uuid[]) IS
  'Data-limite de compra dos PVs (purchase_deadline do compute_wave_timeline): backward do faturamento.';

CREATE OR REPLACE FUNCTION public.tg_set_po_purchase_by_date()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_pvs uuid[];
BEGIN
  IF NEW.purchase_by_date IS NOT NULL THEN RETURN NEW; END IF;
  v_pvs := COALESCE(NULLIF(NEW.linked_sale_order_ids, '{}'::uuid[]),
                    NULLIF(NEW.source_pv_ids, '{}'::uuid[]));
  IF v_pvs IS NULL OR array_length(v_pvs, 1) IS NULL THEN RETURN NEW; END IF;
  NEW.purchase_by_date := public.compute_po_purchase_by_date(v_pvs);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_po_purchase_by_date ON public.purchase_orders;
CREATE TRIGGER trg_set_po_purchase_by_date
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_po_purchase_by_date();

-- Backfill das OCs abertas que linkam PV (idempotente).
UPDATE public.purchase_orders po
SET purchase_by_date = public.compute_po_purchase_by_date(
  COALESCE(NULLIF(po.linked_sale_order_ids, '{}'::uuid[]), NULLIF(po.source_pv_ids, '{}'::uuid[]))
)
WHERE po.purchase_by_date IS NULL
  AND COALESCE(NULLIF(po.linked_sale_order_ids, '{}'::uuid[]), NULLIF(po.source_pv_ids, '{}'::uuid[])) IS NOT NULL;
