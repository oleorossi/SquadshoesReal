-- ============================================================================
-- upsert_open_purchase_order: merge JSONB grade quando há item existente
-- ============================================================================
-- Antes: ao agregar shortage de mesmo (product_id, color) numa OC já aberta,
-- a função somava quantity mas ignorava o `grade` recém-recebido. Resultado:
-- grade ficava fixa no que entrou primeiro, divergindo da quantity somada.
--
-- Agora: faz merge somando jsonb_each_text das duas grades por chave (tamanho).
-- Se nenhuma das duas tem grade, mantém NULL.
--
-- Bug original: solado de PV-A (color=CARAMELO, 100 pares, grade {35:50,36:50})
-- + solado de PV-B (color=CARAMELO, 80 pares, grade {37:80}) em OCs sucessivas
-- gerava 1 item com quantity=180 mas grade={35:50, 36:50} (faltava o 37=80).
--
-- Idempotente. Reaplicar não muda nada de schema.
-- ============================================================================

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
  v_item jsonb;
  v_existing_id uuid;
  v_existing_qty numeric;
  v_existing_grade jsonb;
  v_new_grade jsonb;
  v_merged_grade jsonb;
  v_was_created boolean := false;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id é obrigatório pra agrupar OC';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items vazio — nada pra inserir/atualizar';
  END IF;

  -- Procura OC aberta deste fornecedor (lock pra evitar race em criação concorrente)
  SELECT id INTO v_po_id
  FROM public.purchase_orders
  WHERE supplier_id = p_supplier_id
    AND status NOT IN ('received','receiving','cancelled')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_po_id IS NULL THEN
    -- Cria nova
    INSERT INTO public.purchase_orders (
      supplier_id, supplier_name, notes, auto_generated, linked_sale_order_ids
    ) VALUES (
      p_supplier_id, p_supplier_name,
      COALESCE(p_notes, ''), true,
      CASE WHEN p_sale_order_id IS NOT NULL THEN ARRAY[p_sale_order_id] ELSE ARRAY[]::uuid[] END
    )
    RETURNING id INTO v_po_id;
    v_was_created := true;
  ELSE
    -- Append PV (DISTINCT)
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

  -- Merge itens: se existe row com mesmo product_id+color → soma quantity E grade
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
      -- Merge grade: soma valores por chave (tamanho).
      -- COALESCE evita explosão quando uma das duas é NULL.
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

  -- Recalcula total_value
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
