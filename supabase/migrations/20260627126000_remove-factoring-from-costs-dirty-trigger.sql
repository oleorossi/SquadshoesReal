-- =============================================================================
-- 20260627126000 — REMOVE factoring fields from costs_dirty trigger (B5)
-- =============================================================================
--
-- Suspeita B5 confirmada: tg_mark_so_costs_dirty_self marca dirty quando
-- is_factoring / factoring_config_id mudam, mas calculate_order_cost_item
-- (20260627123000) não lê factoring (COGS não inclui despesa financeira).
--
-- Resultado: cron recalcula PV inteiro à toa em todo toggle de factoring.
-- Decisão: factoring é despesa financeira (não COGS) — remove do watch list.
-- Se no futuro for desejo do gestor incluir factoring no custo, recriar o
-- trigger E adicionar lookup em factoring_configs no calculate_order_cost_item.

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_self()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IN ('Cancelado', 'Cancelada', 'Rascunho') THEN
    RETURN NEW;
  END IF;
  -- B5: factoring removido. Calc de custo é COGS puro (material + MO + overhead
  -- + embalagem); fee de antecipação não entra. Toggle de factoring não
  -- precisa invalidar cache de custo.
  IF (OLD.total IS DISTINCT FROM NEW.total)
     OR (OLD.status IS DISTINCT FROM NEW.status
         AND OLD.status IN ('Cancelado', 'Cancelada', 'Rascunho')) THEN
    NEW.costs_dirty_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_self ON public.sale_orders;
CREATE TRIGGER trg_mark_so_costs_dirty_self
  BEFORE UPDATE OF total, status
  ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_so_costs_dirty_self();
