-- =============================================================================
-- OC/OS abertas: 1 por fornecedor/contractor, agrega PVs e itens
-- =============================================================================
-- User: "Ordens de serviço e ordem de compra devem ser editáveis pelo sistema,
-- até ela ser finalizada, ir adicionando a cada pedido que entrar e tiver
-- necessidade do material, deixar uma a cada fornecedor. Apenas na ordem ir
-- adicionando o número de todos os pedidos que solicitaram aquilo."
--
-- Mudança: ao invés de criar OC/OS nova pra cada PV, sistema procura uma
-- ABERTA (status NÃO em received/receiving/cancelled / Concluído/Cancelado)
-- pro mesmo fornecedor/contractor e agrega:
--   - itens do mesmo product_id+color → soma quantidades
--   - artisanais do mesmo recipe+color → soma artisanal_output_meters
--   - sale_order_id é appended em linked_sale_order_ids[]
--
-- Quando OC/OS é finalizada, status muda → próximo PV cria nova.
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- #A SCHEMA: linked_sale_order_ids[] em OC e OS
-- ----------------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS linked_sale_order_ids uuid[] DEFAULT ARRAY[]::uuid[];

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS linked_sale_order_ids uuid[] DEFAULT ARRAY[]::uuid[];

CREATE INDEX IF NOT EXISTS idx_po_linked_sale_orders
  ON public.purchase_orders USING gin (linked_sale_order_ids);
CREATE INDEX IF NOT EXISTS idx_so_linked_sale_orders
  ON public.service_orders USING gin (linked_sale_order_ids);

-- Backfill: PVs já vinculados em colunas singulares viram primeiro elemento.
UPDATE public.purchase_orders
SET linked_sale_order_ids = ARRAY[reference_order_id]
WHERE reference_order_id IS NOT NULL
  AND (linked_sale_order_ids IS NULL OR cardinality(linked_sale_order_ids) = 0);

UPDATE public.service_orders
SET linked_sale_order_ids = ARRAY[sale_order_id]
WHERE sale_order_id IS NOT NULL
  AND (linked_sale_order_ids IS NULL OR cardinality(linked_sale_order_ids) = 0);

-- ----------------------------------------------------------------------------
-- #B RPC: upsert_open_purchase_order
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_open_purchase_order(uuid, text, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.upsert_open_purchase_order(
  p_supplier_id uuid,
  p_supplier_name text,
  p_sale_order_id uuid,
  p_notes text,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_po_id uuid;
  v_item jsonb;
  v_existing_id uuid;
  v_existing_qty numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id é obrigatório pra agrupar OC';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items vazio';
  END IF;

  SELECT id INTO v_po_id
  FROM public.purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('received','receiving','cancelled')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      supplier_id, supplier_name, notes, auto_generated, linked_sale_order_ids
    ) VALUES (
      p_supplier_id, p_supplier_name, COALESCE(p_notes, ''), true,
      CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE ARRAY[]::uuid[] END
    )
    RETURNING id INTO v_po_id;
  ELSE
    IF p_sale_order_id IS NOT NULL THEN
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT array_agg(DISTINCT x ORDER BY x)
        FROM unnest(linked_sale_order_ids || p_sale_order_id) x
      ),
      notes = CASE WHEN p_notes IS NOT NULL AND p_notes <> ''
                   THEN COALESCE(notes || E'\n', '') || p_notes
                   ELSE notes END,
      updated_at = now()
      WHERE id = v_po_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT id, quantity INTO v_existing_id, v_existing_qty
    FROM public.purchase_order_items
    WHERE purchase_order_id = v_po_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(color, '') = COALESCE(v_item->>'color', '')
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.purchase_order_items
      SET quantity = v_existing_qty + COALESCE((v_item->>'quantity')::numeric, 0),
          suggested_quantity = COALESCE(suggested_quantity, 0) + COALESCE((v_item->>'quantity')::numeric, 0),
          unit_price = COALESCE(NULLIF((v_item->>'unit_price')::numeric, 0), unit_price)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, quantity, suggested_quantity,
        unit_price, unit, current_stock, min_stock, max_stock, grade, color
      ) VALUES (
        v_po_id,
        (v_item->>'product_id')::uuid,
        COALESCE((v_item->>'quantity')::numeric, 0),
        COALESCE((v_item->>'quantity')::numeric, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE(v_item->>'unit', 'un'),
        COALESCE((v_item->>'current_stock')::numeric, 0),
        COALESCE((v_item->>'min_stock')::numeric, 0),
        COALESCE((v_item->>'max_stock')::numeric, 0),
        v_item->'grade',
        v_item->>'color'
      );
    END IF;
  END LOOP;

  UPDATE public.purchase_orders po
  SET total_value = COALESCE((
    SELECT SUM(quantity * unit_price) FROM public.purchase_order_items
    WHERE purchase_order_id = po.id
  ), 0),
  updated_at = now()
  WHERE id = v_po_id;

  RETURN v_po_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_open_purchase_order(uuid, text, uuid, text, jsonb) TO authenticated;
COMMENT ON FUNCTION public.upsert_open_purchase_order IS
  'Procura OC aberta do fornecedor (status<>received/receiving/cancelled). '
  'Se existe: agrega itens (merge por product_id+color, soma quantities) e '
  'appenda sale_order_id em linked_sale_order_ids. Se não existe: cria nova.';

-- ----------------------------------------------------------------------------
-- #C RPC: upsert_open_service_order
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_open_service_order(uuid, uuid, text, text, text, numeric, numeric, numeric, text, numeric, uuid, numeric);
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
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_so_id uuid;
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
      updated_at = now()
    WHERE id = v_so_id;
  END IF;

  RETURN v_so_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_open_service_order(uuid, uuid, text, text, text, numeric, numeric, numeric, text, numeric, uuid, numeric) TO authenticated;
COMMENT ON FUNCTION public.upsert_open_service_order IS
  'Procura OS aberta (status<>Concluído/Cancelado e stock_entry_done=false) '
  'pro mesmo contractor+recipe+output_color. Se existe: soma for_order_meters '
  '(buffer for_stock fica MAX, não soma) e appenda sale_order_id. Se não: cria nova.';

-- ----------------------------------------------------------------------------
-- #D Helper views: OCs/OSs abertas com PVs vinculados
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_open_purchase_orders AS
SELECT
  po.id, po.order_number, po.status, po.supplier_id, po.supplier_name,
  po.total_value, po.created_at, po.updated_at,
  cardinality(po.linked_sale_order_ids) AS linked_pv_count,
  po.linked_sale_order_ids,
  (SELECT array_agg(so.order_number ORDER BY so.created_at)
   FROM public.sale_orders so
   WHERE so.id = ANY(po.linked_sale_order_ids)) AS linked_pv_numbers
FROM public.purchase_orders po
WHERE po.status NOT IN ('received','receiving','cancelled');
GRANT SELECT ON public.v_open_purchase_orders TO authenticated;

CREATE OR REPLACE VIEW public.v_open_service_orders AS
SELECT
  so.id, so.order_number, so.status, so.contractor_id,
  c.name AS contractor_name,
  so.artisanal_recipe_id, so.artisanal_output_name, so.artisanal_output_color,
  so.artisanal_output_meters, so.total_value, so.created_at, so.updated_at,
  cardinality(so.linked_sale_order_ids) AS linked_pv_count,
  so.linked_sale_order_ids,
  (SELECT array_agg(sa.order_number ORDER BY sa.created_at)
   FROM public.sale_orders sa
   WHERE sa.id = ANY(so.linked_sale_order_ids)) AS linked_pv_numbers
FROM public.service_orders so
LEFT JOIN public.contractors c ON c.id = so.contractor_id
WHERE so.status NOT IN ('Concluído','Cancelado');
GRANT SELECT ON public.v_open_service_orders TO authenticated;
