-- compute_order_planned_dates referenciava ts.handling_time_minutes, que foi
-- dropada no PR 7 (migration 20260523120000_drop-unused-technical-sheets-columns).
-- Resultado: qualquer INSERT em orders falhava com 42703 (incluindo a trigger
-- auto-criação de OPs no PV→Em Produção).
--
-- Fix: substituir por mesa_daily_capacity (pares/dia), que é a coluna ativa
-- pro cálculo de lead time da Mesa.

CREATE OR REPLACE FUNCTION public.compute_order_planned_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_delivery   date;
  v_corte      int;
  v_costura    int;
  v_montagem   int;
  v_mesa       int;
  v_acabamento int;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT so.delivery_deadline INTO v_delivery
  FROM public.sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;

  SELECT
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                       dlt.cutting_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                       dlt.sewing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                       dlt.assembly_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    CASE WHEN ts.has_straps = true AND COALESCE(ts.mesa_daily_capacity, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              ts.mesa_daily_capacity::numeric)::int)
         WHEN ts.has_straps = true
         THEN 1
         ELSE 0 END,
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                       dlt.finishing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_mesa, v_acabamento
  FROM public.technical_sheets ts
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE ts.id = NEW.reference_id;

  IF v_corte IS NULL THEN RETURN NEW; END IF;

  NEW.planned_start := v_delivery
    - v_acabamento - v_mesa - v_montagem - v_costura - v_corte;
  RETURN NEW;
END;
$function$;
