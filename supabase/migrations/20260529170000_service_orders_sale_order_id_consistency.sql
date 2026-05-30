-- =============================================================================
-- SERVICE ORDERS: sale_order_id sempre reflete PV principal (2026-05-29)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
--
-- Problema reportado: ao abrir OS auto no form, o campo "Pedido de Venda (PV)
-- — rastreio" aparece vazio mesmo quando o sistema criou a OS a partir de
-- um PV.
--
-- Causa: upsert_open_service_order só setava sale_order_id (singular) no
-- INSERT inicial. Em UPDATE (agregação de outro PV à OS aberta), só
-- atualizava linked_sale_order_ids[]. Dos 38 OS no DB: 36 com array, só 5
-- com singular.
--
-- Fix:
--   1. UPDATE da função: sale_order_id = COALESCE(sale_order_id, p_sale_order_id)
--      — preenche se NULL, preserva se já tem
--   2. Backfill: sale_order_id = linked_sale_order_ids[1] onde NULL
--
-- Resultado pós-migration: 36/38 OS com sale_order_id. Os 2 restantes são
-- OS sem PV vinculado de origem (criação manual).
--
-- Frontend (commit relacionado):
--   - ServiceOrder type ganha linked_sale_order_ids?: string[]
--   - Label "Pedido de Venda (PV) — rastreio" mostra badge "+N PVs vinculados"
--     quando há múltiplos PVs no array (rastreabilidade completa)
-- =============================================================================

UPDATE public.service_orders
SET sale_order_id = (linked_sale_order_ids)[1]
WHERE sale_order_id IS NULL
  AND linked_sale_order_ids IS NOT NULL
  AND array_length(linked_sale_order_ids, 1) > 0;

CREATE OR REPLACE FUNCTION public.upsert_open_service_order(
  p_contractor_id uuid,
  p_artisanal_recipe_id uuid,
  p_output_name text,
  p_output_color text,
  p_base_color text,
  p_for_order_meters numeric,
  p_for_stock_meters numeric,
  p_total_meters numeric,
  p_base_product_name text,
  p_base_meters_send numeric,
  p_sale_order_id uuid,
  p_unit_price numeric
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_so_id uuid;
  v_was_created boolean := false;
BEGIN
  IF p_contractor_id IS NULL OR p_artisanal_recipe_id IS NULL THEN
    RAISE EXCEPTION 'contractor_id e artisanal_recipe_id são obrigatórios';
  END IF;

  SELECT id INTO v_so_id
  FROM public.service_orders
  WHERE contractor_id = p_contractor_id
    AND artisanal_recipe_id = p_artisanal_recipe_id
    AND COALESCE(artisanal_output_color, '') = COALESCE(p_output_color, '')
    AND status NOT IN ('Concluído','Cancelado')
    AND COALESCE(artisanal_stock_entry_done, false) = false
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_so_id IS NULL THEN
    INSERT INTO public.service_orders (
      contractor_id, artisanal_recipe_id,
      artisanal_output_name, artisanal_output_color, artisanal_base_color,
      artisanal_for_order_meters, artisanal_for_stock_meters, artisanal_output_meters,
      material_name, material_color, material_meters,
      sale_order_id, linked_sale_order_ids,
      description, quantity, unit_price, total_value, status
    ) VALUES (
      p_contractor_id, p_artisanal_recipe_id,
      p_output_name, p_output_color, p_base_color,
      p_for_order_meters, p_for_stock_meters, p_total_meters,
      p_base_product_name, p_output_color, p_base_meters_send,
      p_sale_order_id,
      CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE ARRAY[]::uuid[] END,
      'OS Automática — ' || p_output_name || COALESCE(' (' || p_output_color || ')', ''),
      CEIL(p_total_meters)::int,
      p_unit_price,
      p_total_meters * p_unit_price,
      'Pendente'
    )
    RETURNING id INTO v_so_id;
    v_was_created := true;
  ELSE
    UPDATE public.service_orders
    SET
      artisanal_for_order_meters = COALESCE(artisanal_for_order_meters, 0) + COALESCE(p_for_order_meters, 0),
      artisanal_for_stock_meters = GREATEST(COALESCE(artisanal_for_stock_meters, 0), COALESCE(p_for_stock_meters, 0)),
      artisanal_output_meters = COALESCE(artisanal_for_order_meters, 0) + COALESCE(p_for_order_meters, 0)
                              + GREATEST(COALESCE(artisanal_for_stock_meters, 0), COALESCE(p_for_stock_meters, 0)),
      material_meters = (COALESCE(artisanal_for_order_meters, 0) + COALESCE(p_for_order_meters, 0)
                       + GREATEST(COALESCE(artisanal_for_stock_meters, 0), COALESCE(p_for_stock_meters, 0)))
                      / NULLIF((SELECT yield_per_meter FROM public.artisanal_recipes WHERE id = p_artisanal_recipe_id), 0),
      quantity = CEIL(COALESCE(artisanal_for_order_meters, 0) + COALESCE(p_for_order_meters, 0)
                    + GREATEST(COALESCE(artisanal_for_stock_meters, 0), COALESCE(p_for_stock_meters, 0)))::int,
      total_value = (COALESCE(artisanal_for_order_meters, 0) + COALESCE(p_for_order_meters, 0)
                   + GREATEST(COALESCE(artisanal_for_stock_meters, 0), COALESCE(p_for_stock_meters, 0)))
                  * COALESCE(NULLIF(p_unit_price, 0), unit_price),
      linked_sale_order_ids = (
        SELECT array_agg(DISTINCT x ORDER BY x)
        FROM unnest(linked_sale_order_ids || p_sale_order_id) x WHERE x IS NOT NULL
      ),
      sale_order_id = COALESCE(sale_order_id, p_sale_order_id),
      updated_at = now()
    WHERE id = v_so_id;
  END IF;

  RETURN v_so_id;
END;
$$;
