-- =============================================================================
-- FIX: upsert_open_purchase_order — idempotência por PV (2026-05-29)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
-- Arquivo no repo pra histórico.
--
-- Bug raiz (incidente OC-00031):
--   A função SOMAVA quantity ao item existente sempre que era chamada, sem
--   checar se o p_sale_order_id já estava em linked_sale_order_ids[]. Cada
--   save/edit do PV dispara MaterialPurchaseConfirmDialog → upsert_open_PO.
--   Resultado:
--     OC-00031 → 7 disparos pra 3 PVs → qty 9232 (correto ~1240)
--     OC-00029 → 5 disparos pra 2 PVs → qty inflada também
--
-- Fix:
--   - Early-return idempotente quando p_sale_order_id já está em
--     linked_sale_order_ids[] da OC aberta encontrada
--   - PV novo na OC: comportamento original mantido (cria/agrega item)
--   - PV já vinculado: no-op (retorna v_po_id sem alterar quantidades)
--
-- Trade-off:
--   Quando user EDITAR um PV com mudança real (qty), precisa cancelar OC atual
--   e gerar nova. Sem rastrear "contribuição original de cada PV" (que exigiria
--   coluna extra ou tabela junction), não dá pra recalcular automaticamente.
--   Aceito: segurança contra inflação > flexibilidade automática.
--
-- Cleanup junto com a migration:
--   - OC-00031 e OC-00029 marcadas como 'cancelled' com nota explicativa
--     (qty corrompida pelo bug — recriar manualmente se necessário)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_open_purchase_order(
  p_supplier_id uuid,
  p_supplier_name text,
  p_sale_order_id uuid,
  p_notes text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_linked uuid[];
  v_item jsonb;
  v_existing_id uuid;
  v_existing_qty numeric;
  v_existing_grade jsonb;
  v_new_grade jsonb;
  v_merged_grade jsonb;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id é obrigatório pra agrupar OC';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items vazio — nada pra inserir/atualizar';
  END IF;

  -- Busca OC aberta existente do fornecedor + array de PVs linkados
  SELECT id, COALESCE(linked_sale_order_ids, ARRAY[]::uuid[])
  INTO v_po_id, v_linked
  FROM public.purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('received','receiving','cancelled')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  -- ── IDEMPOTÊNCIA POR PV ──
  -- Se a OC já tem esse PV vinculado, considera disparo duplicado e retorna
  -- sem alterar nada. Protege contra inflação por save/edit múltiplo do PV.
  IF v_po_id IS NOT NULL
     AND p_sale_order_id IS NOT NULL
     AND p_sale_order_id = ANY(v_linked) THEN
    RETURN v_po_id;
  END IF;

  IF v_po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      supplier_id, supplier_name, notes, auto_generated, linked_sale_order_ids
    ) VALUES (
      p_supplier_id, p_supplier_name,
      COALESCE(p_notes, ''), true,
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
    SELECT id, quantity, grade INTO v_existing_id, v_existing_qty, v_existing_grade
    FROM public.purchase_order_items
    WHERE purchase_order_id = v_po_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(color, '') = COALESCE(v_item->>'color', '')
    LIMIT 1;

    v_new_grade := v_item->'grade';

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_grade IS NOT NULL AND v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        SELECT jsonb_object_agg(k, (COALESCE((v_existing_grade->>k)::numeric, 0)
                                  + COALESCE((v_new_grade->>k)::numeric, 0)))
        INTO v_merged_grade
        FROM (
          SELECT jsonb_object_keys(v_existing_grade) AS k
          UNION
          SELECT jsonb_object_keys(v_new_grade) AS k
        ) keys;
      ELSIF v_new_grade IS NOT NULL AND jsonb_typeof(v_new_grade) = 'object' THEN
        v_merged_grade := v_new_grade;
      ELSE
        v_merged_grade := v_existing_grade;
      END IF;

      UPDATE public.purchase_order_items
      SET quantity = v_existing_qty + COALESCE((v_item->>'quantity')::numeric, 0),
          suggested_quantity = COALESCE(suggested_quantity, 0) + COALESCE((v_item->>'quantity')::numeric, 0),
          unit_price = COALESCE(NULLIF((v_item->>'unit_price')::numeric, 0), unit_price),
          grade = v_merged_grade
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
    SELECT SUM(quantity * unit_price)
    FROM public.purchase_order_items
    WHERE purchase_order_id = po.id
  ), 0),
  updated_at = now()
  WHERE id = v_po_id;

  RETURN v_po_id;
END;
$function$;
