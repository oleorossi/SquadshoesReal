-- =============================================================================
-- Pickup hybrid model — fixes pós-deploy
-- =============================================================================
-- Dois fixes encontrados no teste E2E:
--
-- 1. `get_wave_material_needs` falhava com `column reference "product_id" is
--    ambiguous` (bug pré-existente, não relacionado ao pickup, mas bloqueava
--    o fluxo de OC + OS na criação da onda). Causa: RETURNS TABLE declara
--    `product_id` como variável PL/pgSQL que conflita com colunas das CTEs.
--    Fix: `#variable_conflict use_column` no topo do corpo.
--
-- 2. `update_wave_timeline` jogava bloco ÚNICO de pares todo pra friday
--    (running > half após 1 item). Péssimo pro cash flow — onda pequena
--    (1 PV / 1 bloco) saía só na sexta, perdendo a vantagem da terça.
--    Fix: usar `prev_running < half` em vez de `running <= half`. Garante
--    que se PARTE do item está na primeira metade, o item inteiro vai pra
--    tuesday — preservando integridade de bloco e priorizando cash flow.
-- =============================================================================

-- ── Fix 1 ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE(product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days integer, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  sole_product_ids AS (
    SELECT DISTINCT rsc.sole_product_id
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
  ),
  sheet_needed AS (
    SELECT sm.product_id,
           COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity) AS needed_qty
      FROM public.sale_order_items soi
      JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
      JOIN public.products sp ON sp.id = sm.product_id
     WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       AND sm.product_id NOT IN (SELECT sole_product_id FROM sole_product_ids)
     GROUP BY sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '')
  ),
  sole_needed AS (
    SELECT rsc.sole_product_id AS product_id,
           COALESCE(NULLIF(rsc.sole_color,''), soi.color, '') AS effective_color,
           SUM(soi.quantity) AS needed_qty
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id, sole_color FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
     GROUP BY rsc.sole_product_id, COALESCE(NULLIF(rsc.sole_color,''), soi.color, '')
  ),
  all_needed AS (
    SELECT product_id, effective_color, needed_qty FROM sheet_needed
    UNION ALL
    SELECT product_id, effective_color, needed_qty FROM sole_needed
  ),
  needed AS (
    SELECT product_id, effective_color, SUM(needed_qty) AS needed_qty
      FROM all_needed GROUP BY product_id, effective_color
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, COALESCE(p.unit,'un') AS unit,
           n.effective_color AS color, n.needed_qty,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN public.products p ON p.id = n.product_id
      LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty,
         e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days,
         e.is_artisanal,
         ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
         bp.id AS base_product_id, ar.base_product_name,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
              THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
         bp.quantity AS base_stock_qty,
         CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
              THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
              ELSE NULL END AS base_shortage,
         CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL
              THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
    FROM enriched e
    LEFT JOIN public.artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND (lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
            OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%')
    LEFT JOIN public.products bp
           ON ar.id IS NOT NULL
          AND (lower(bp.name) = lower(ar.base_product_name)
            OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
            OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%')
          AND (e.color = '' OR lower(COALESCE(bp.color, '')) = lower(e.color)
            OR bp.color IS NULL OR bp.color = '')
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$function$;

-- ── Fix 2 ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  v_sale_order_ids uuid[];
  v_tl record;
  v_total_pairs numeric;
  v_running_pairs numeric := 0;
  v_half_pairs numeric;
  v_item record;
  v_prev_running numeric;
BEGIN
  SELECT array_agg(DISTINCT wis.sale_order_id) INTO v_sale_order_ids
    FROM production_wave_item_sources wis
    JOIN production_wave_items wi ON wi.id = wis.wave_item_id
   WHERE wi.wave_id = p_wave_id AND wis.sale_order_id IS NOT NULL;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids,1) IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl FROM public.compute_wave_timeline(v_sale_order_ids) LIMIT 1;
  IF v_tl IS NULL OR v_tl.earliest_deadline IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.production_waves
     SET earliest_deadline         = v_tl.earliest_deadline,
         purchase_deadline         = v_tl.purchase_deadline,
         material_ready_date       = v_tl.material_ready_date,
         corte_palmilha_start_date = v_tl.corte_palmilha_start_date,
         corte_forracao_start_date = v_tl.corte_forracao_start_date,
         costura_start_date        = v_tl.costura_start_date,
         mesa_start_date           = v_tl.mesa_start_date,
         silk_start_date           = v_tl.silk_start_date,
         colagem_start_date        = v_tl.colagem_start_date,
         montagem_start_date       = v_tl.montagem_start_date,
         solagem_start_date        = v_tl.solagem_start_date,
         acabamento_start_date     = v_tl.acabamento_start_date,
         pickup_tuesday_date       = v_tl.pickup_tuesday_date,
         pickup_friday_date        = v_tl.pickup_friday_date,
         updated_at                = now()
   WHERE id = p_wave_id;

  UPDATE public.production_wave_items
     SET block_key = COALESCE(sole_product_id::text,'no-sole') || '|' || COALESCE(NULLIF(color,''),'sem-cor')
   WHERE wave_id = p_wave_id AND (block_key IS NULL OR block_key = '');

  WITH per_item AS (
    SELECT wi.id AS item_id, wi.block_key,
           MIN(so.delivery_deadline) AS item_earliest_deadline
    FROM production_wave_items wi
    LEFT JOIN production_wave_item_sources wis ON wis.wave_item_id = wi.id
    LEFT JOIN sale_orders so ON so.id = wis.sale_order_id
    WHERE wi.wave_id = p_wave_id
    GROUP BY wi.id, wi.block_key
  ),
  block_min AS (
    SELECT block_key, MIN(item_earliest_deadline) AS block_earliest
      FROM per_item GROUP BY block_key
  ),
  ordered AS (
    SELECT wi.id AS item_id,
      ROW_NUMBER() OVER (
        ORDER BY bm.block_earliest NULLS LAST, wi.block_key,
                 wi.total_quantity DESC, wi.id
      ) AS seq
    FROM production_wave_items wi
    LEFT JOIN block_min bm ON bm.block_key = wi.block_key
    WHERE wi.wave_id = p_wave_id
  )
  UPDATE production_wave_items wi
     SET block_sequence = ordered.seq
    FROM ordered
   WHERE wi.id = ordered.item_id;

  SELECT SUM(total_quantity) INTO v_total_pairs
    FROM production_wave_items WHERE wave_id = p_wave_id;
  v_half_pairs := COALESCE(v_total_pairs,0) / 2;

  v_running_pairs := 0;
  FOR v_item IN
    SELECT id, total_quantity
      FROM production_wave_items
     WHERE wave_id = p_wave_id
     ORDER BY block_sequence NULLS LAST, id
  LOOP
    v_prev_running := v_running_pairs;
    v_running_pairs := v_running_pairs + COALESCE(v_item.total_quantity,0);
    UPDATE production_wave_items
       SET pickup_window = CASE
             WHEN v_total_pairs <= 0
                  OR v_prev_running < v_half_pairs
                  THEN 'tuesday'::pickup_window_enum
             ELSE 'friday'::pickup_window_enum
           END
     WHERE id = v_item.id;
  END LOOP;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.update_wave_timeline(uuid) TO authenticated;
