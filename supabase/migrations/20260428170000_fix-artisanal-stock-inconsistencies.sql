-- Detect and fix artisanal service orders where the artisanal output was added to
-- stock but the base material was NOT debited (bug: old code showed warning and
-- continued instead of stopping when base product was not found).
--
-- For each inconsistency found:
--   • If base product exists with sufficient stock → debit it now and log movement.
--   • If not found or insufficient stock → RAISE NOTICE for manual review.

DO $$
DECLARE
  rec             record;
  v_base_prod_id  uuid;
  v_base_qty      numeric;
  v_base_needed   numeric;
  v_new_qty       numeric;
  v_fixed         int := 0;
  v_needs_review  int := 0;
BEGIN
  FOR rec IN
    SELECT
      so.id                                                          AS os_id,
      so.order_number                                                AS os_number,
      so.artisanal_output_meters                                     AS output_meters,
      COALESCE(so.artisanal_base_color, so.artisanal_output_color, '') AS base_color,
      ar.base_product_name,
      ar.yield_per_meter,
      so.artisanal_output_meters / NULLIF(ar.yield_per_meter, 0)    AS base_needed
    FROM service_orders so
    JOIN artisanal_recipes ar ON ar.id = so.artisanal_recipe_id
    WHERE so.status             = 'Concluído'
      AND so.artisanal_stock_entry_done = true
      AND so.artisanal_recipe_id IS NOT NULL
      AND so.artisanal_output_meters > 0
      -- Output 'in' movement exists for this OS
      AND EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'in'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND sm.description   ILIKE '%artesanal%'
          )
      -- Base 'out' movement is MISSING for this OS
      AND NOT EXISTS (
            SELECT 1 FROM stock_movements sm
             WHERE sm.movement_type = 'out'
               AND sm.description   ILIKE '%' || so.order_number || '%'
               AND (sm.description  ILIKE '%artesanal%' OR sm.description ILIKE '%Consumo artesanal%')
          )
  LOOP
    v_base_needed := rec.base_needed;

    -- Try to find the base product by name + color
    SELECT p.id, p.quantity
      INTO v_base_prod_id, v_base_qty
      FROM products p
     WHERE (lower(p.name) = lower(rec.base_product_name)
            OR lower(p.name) LIKE lower(rec.base_product_name) || ':%'
            OR lower(p.name) LIKE lower(rec.base_product_name) || ' -%')
       AND (rec.base_color = ''
            OR lower(COALESCE(p.color, '')) = lower(rec.base_color))
     ORDER BY p.updated_at DESC
     LIMIT 1;

    IF v_base_prod_id IS NULL THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) não encontrada no estoque. Débito de %.2fm pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    IF v_base_qty < v_base_needed THEN
      RAISE NOTICE '[REVISAR] OS % — base "%" (%) com estoque insuficiente: disponível %, necessário %. Débito pendente.',
        rec.os_number, rec.base_product_name, rec.base_color, v_base_qty, v_base_needed;
      v_needs_review := v_needs_review + 1;
      CONTINUE;
    END IF;

    -- Debit base material
    v_new_qty := v_base_qty - v_base_needed;

    UPDATE products
       SET quantity   = v_new_qty,
           updated_at = now()
     WHERE id = v_base_prod_id;

    INSERT INTO stock_movements
      (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES
      (v_base_prod_id, 'out', v_base_needed, v_base_qty, v_new_qty,
       'Débito retroativo MP artesanal — ' || rec.os_number || ' (correção automática)');

    RAISE NOTICE '[CORRIGIDO] OS % — debitado %.2fm de "%" (%). Estoque: % → %.',
      rec.os_number, v_base_needed, rec.base_product_name, rec.base_color, v_base_qty, v_new_qty;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== Resumo: % OS(s) corrigida(s), % OS(s) aguardam revisão manual. ===', v_fixed, v_needs_review;
END;
$$;
