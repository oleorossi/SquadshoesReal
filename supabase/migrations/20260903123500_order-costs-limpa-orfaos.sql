-- P0.1 / M4b — order_costs órfãos (achado durante o reprocessamento do labor).
--
-- O caminho de UPDATE do PV recria sale_order_items com id novo; o upsert de
-- order_costs é por (sale_order_id, sale_order_item_id) e NUNCA apaga a linha do
-- item antigo. Resultado medido em produção: 85 linhas órfãs (item inexistente),
-- 67 delas em PVs "Em Produção" — todo agregado por PV (ManagementReport,
-- NetMarginChart, DRE) somava custo/receita fantasma em dobro.
--
-- Fix em 2 partes:
--   1. Recálculo full-PV passa a remover linhas de itens que não existem mais
--      (só quando p_persist=true e item_id=NULL — o mesmo evento que reescreve
--      as linhas vivas; PVs terminais nunca entram aqui por causa do freeze H3).
--   2. Limpeza única das 85 órfãs existentes (inclusive de PVs terminais: a
--      linha órfã é uma VERSÃO VELHA duplicada do item — os totais corretos
--      estão nas linhas vivas; manter o fantasma é que distorce o histórico).

CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_item_result jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_total_material numeric := 0;
  v_total_labor numeric := 0;
  v_total_overhead numeric := 0;
  v_total_packaging numeric := 0;
  v_total_cost numeric := 0;
  v_total_revenue numeric := 0;
  v_total_margin numeric := 0;
  v_total_qty numeric := 0;
BEGIN
  IF p_sale_order_item_id IS NOT NULL THEN
    RETURN public.calculate_order_cost_item(p_sale_order_item_id, p_persist);
  END IF;

  -- Full-PV com persistência: remove custo de item que não existe mais no PV
  -- (senão o agregado por sale_order_id soma versão velha + versão nova).
  IF p_persist THEN
    DELETE FROM public.order_costs oc
     WHERE oc.sale_order_id = p_sale_order_id
       AND oc.sale_order_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.sale_order_items i
          WHERE i.id = oc.sale_order_item_id);
  END IF;

  FOR v_item_id IN
    SELECT id FROM public.sale_order_items
     WHERE sale_order_id = p_sale_order_id
     ORDER BY created_at NULLS LAST, id
  LOOP
    v_item_result := public.calculate_order_cost_item(v_item_id, p_persist);
    IF v_item_result IS NULL THEN CONTINUE; END IF;

    v_items_out := v_items_out || v_item_result;
    v_total_material  := v_total_material  + COALESCE((v_item_result ->> 'material_cost')::numeric, 0);
    v_total_labor     := v_total_labor     + COALESCE((v_item_result ->> 'labor_cost')::numeric, 0);
    v_total_overhead  := v_total_overhead  + COALESCE((v_item_result ->> 'overhead_cost')::numeric, 0);
    v_total_packaging := v_total_packaging + COALESCE((v_item_result ->> 'packaging_cost')::numeric, 0);
    v_total_cost      := v_total_cost      + COALESCE((v_item_result ->> 'total_cost')::numeric, 0);
    v_total_revenue   := v_total_revenue   + COALESCE((v_item_result ->> 'revenue')::numeric, 0);
    v_total_margin    := v_total_margin    + COALESCE((v_item_result ->> 'margin')::numeric, 0);
    v_total_qty       := v_total_qty       + COALESCE((v_item_result ->> 'quantity')::numeric, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'items', v_items_out,
    'item_count', jsonb_array_length(v_items_out),
    'total_quantity', v_total_qty,
    'material_cost', v_total_material,
    'labor_cost', v_total_labor,
    'overhead_cost', v_total_overhead,
    'packaging_cost', v_total_packaging,
    'total_cost', v_total_cost,
    'revenue', v_total_revenue,
    'margin', v_total_margin,
    'margin_pct', CASE WHEN v_total_revenue > 0 THEN v_total_margin / v_total_revenue ELSE 0 END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;

-- Limpeza única das órfãs existentes
DELETE FROM public.order_costs oc
 WHERE oc.sale_order_item_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.sale_order_items i
      WHERE i.id = oc.sale_order_item_id);
