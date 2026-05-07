-- =============================================================================
-- Auditoria Round 2 — fixes pra 3 bugs reais confirmados
-- =============================================================================
-- A 2ª rodada da auditoria (planejamento de compras + custo + reservas)
-- gerou 11 achados. Após verificar pessoalmente cada um lendo o código,
-- 3 são bugs REAIS (3 são MENORES e 5 são falsos positivos do agente).
--
-- Bugs REAIS corrigidos aqui:
--
--   #1 (CRÍTICO) — calculate_order_cost: unit mismatch entre
--       sole_standard_items_consumption.unit (ex: 'g') e products.unit
--       (ex: 'kg'). Multiplicação direta por unit_price gera erro até 1000×.
--
--   #4 (BUG REAL) — purchase_projection_timeline: estoque_atual não
--       deduz reserved_stock. Relatórios de compra ficam otimistas
--       (sugerem comprar material já reservado).
--
--   #3 (BUG MENOR) — get_wave_material_needs: UNION ALL pode duplicar
--       um produto que aparece em sheet_materials (categoria != solado)
--       E também via resolve_sole_color. Filtro `NOT LIKE '%solado%'`
--       não cobre todos os casos.
--
-- O bug #2 (useCreatePurchaseOrder idempotency) é frontend — fix em
-- src/hooks/usePurchaseOrders.ts no mesmo commit, fora desta migration.
-- =============================================================================


-- ─── #1 calculate_order_cost — converter g↔kg, ml↔L antes de unit_price ──
-- A RPC calculate_order_consumption_by_grade emite linhas com `unit` (vindo
-- de sole_standard_items_consumption.unit). Quando o produto está em kg
-- mas o consumo é em g, multiplicar required (em g) por unit_price (R$/kg)
-- gera custo 1000× errado.
--
-- Solução: criar função `convert_to_product_unit(qty, source_unit, target_unit)`
-- que faz as conversões padrão. calculate_order_cost usa ela antes da
-- multiplicação.

CREATE OR REPLACE FUNCTION public.convert_to_product_unit(
  p_qty numeric,
  p_source_unit text,
  p_target_unit text
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_src text := LOWER(TRIM(COALESCE(p_source_unit, '')));
  v_tgt text := LOWER(TRIM(COALESCE(p_target_unit, '')));
BEGIN
  IF p_qty IS NULL THEN RETURN 0; END IF;
  IF v_src = v_tgt OR v_src = '' OR v_tgt = '' THEN
    RETURN p_qty;
  END IF;

  -- Massa
  IF v_src = 'g'  AND v_tgt = 'kg' THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'mg' AND v_tgt = 'kg' THEN RETURN p_qty / 1000000; END IF;
  IF v_src = 'mg' AND v_tgt = 'g'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'g'  THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'mg' THEN RETURN p_qty * 1000000; END IF;
  IF v_src = 'g'  AND v_tgt = 'mg' THEN RETURN p_qty * 1000; END IF;

  -- Volume
  IF v_src = 'ml' AND v_tgt = 'l'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'l'  AND v_tgt = 'ml' THEN RETURN p_qty * 1000; END IF;

  -- Comprimento (caso raro)
  IF v_src = 'cm' AND v_tgt = 'm'  THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm'  AND v_tgt = 'cm' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'mm' AND v_tgt = 'm'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'm'  AND v_tgt = 'mm' THEN RETURN p_qty * 1000; END IF;

  -- Área
  IF v_src = 'dm²' AND v_tgt = 'm²' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm²'  AND v_tgt = 'dm²' THEN RETURN p_qty * 100; END IF;

  -- Sem conversão conhecida — retorna qty original (assume mesma unidade)
  RETURN p_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_to_product_unit(numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.convert_to_product_unit(numeric, text, text) IS
  'Converte quantidade entre unidades padrão (g↔kg, ml↔L, mm↔cm↔m, dm²↔m²). '
  'Retorna qty original se as unidades são iguais ou sem conversão conhecida. '
  'Usado em calculate_order_cost pra alinhar consumption.unit com products.unit.';


-- Recria calculate_order_cost aplicando conversão antes do unit_price
DROP FUNCTION IF EXISTS public.calculate_order_cost(p_sale_order_id uuid, p_sale_order_item_id uuid, p_persist boolean) CASCADE;
CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_ref uuid;
  v_color text;
  v_qty numeric;
  v_unit_price numeric;
  v_grade jsonb;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0;
  v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric;
  v_margin numeric;
  v_margin_pct numeric;
  v_op record;
  v_prod record;
  v_out jsonb;
  v_required_in_product_unit numeric;  -- ← NOVO: required convertido pra unit do produto
  v_subtotal numeric;
BEGIN
  SELECT i.id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR i.id = p_sale_order_item_id)
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_ref        := v_item.reference_id;
  v_color      := v_item.color;
  v_qty        := v_item.quantity;
  v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade      := v_item.grade;

  SELECT COALESCE(overhead_pct, 0) / 100.0 INTO v_overhead_pct
    FROM public.cost_policies LIMIT 1;
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_ref, v_grade, COALESCE(v_color, ''), v_item.material_variant_id
      );
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL::integer, v_item.material_variant_id) c;
    END IF;
  END IF;

  -- ── Material cost com CONVERSÃO de unidade ─────────────────────
  -- A linha de consumo pode emitir 'unit' diferente da product.unit
  -- (ex.: cola consumption em 'g' mas product em 'kg'). Antes de
  -- multiplicar por unit_price, convertemos qty pra unit do produto.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name, unit INTO v_prod
      FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;

    -- Converte required (na consumption.unit) pra products.unit
    v_required_in_product_unit := public.convert_to_product_unit(
      (v_line ->> 'required')::numeric,
      v_line ->> 'unit',          -- source: unit do consumption (pode ser g, dm², m, ...)
      COALESCE(v_prod.unit, '')   -- target: unit do produto
    );

    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
    v_material := v_material + v_subtotal;

    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id',   v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component',    v_line ->> 'component',
      'required',     (v_line ->> 'required')::numeric,
      'required_in_product_unit', v_required_in_product_unit,
      'consumption_unit', v_line ->> 'unit',
      'product_unit', v_prod.unit,
      'unit_price',   COALESCE(v_prod.unit_price, 0),
      'subtotal',     v_subtotal
    );
  END LOOP;

  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation',        v_op.operation_name,
      'hour_cost',        v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal',         (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty
    );
  END LOOP;

  v_overhead  := v_overhead_pct * (v_material + v_labor);
  v_packaging := v_packaging_per_pair * v_qty;
  v_total     := v_material + v_labor + v_overhead + v_packaging;
  v_revenue   := v_unit_price * v_qty;
  v_margin    := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost',  v_material,
    'labor_cost',     v_labor,
    'overhead_cost',  v_overhead,
    'packaging_cost', v_packaging,
    'total_cost',     v_total,
    'revenue',        v_revenue,
    'margin',         v_margin,
    'margin_pct',     v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials',         v_breakdown_materials,
      'labor',             v_breakdown_labor,
      'overhead_pct',      v_overhead_pct,
      'packaging_per_pair',v_packaging_per_pair,
      'used_grade',        v_grade IS NOT NULL AND v_grade <> '{}'::jsonb
    )
  );

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, packaging_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      p_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_packaging, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown'
    )
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost  = EXCLUDED.material_cost,
      labor_cost     = EXCLUDED.labor_cost,
      overhead_cost  = EXCLUDED.overhead_cost,
      packaging_cost = EXCLUDED.packaging_cost,
      total_cost     = EXCLUDED.total_cost,
      revenue        = EXCLUDED.revenue,
      margin         = EXCLUDED.margin,
      margin_pct     = EXCLUDED.margin_pct,
      breakdown      = EXCLUDED.breakdown,
      calculated_at  = now();
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) IS
  'Custo da OP. Aplica conversão de unidade (convert_to_product_unit) ANTES '
  'de multiplicar por unit_price — corrige bug onde sole_standard_items em '
  'unit "g" eram multiplicadas por R$/kg gerando custo 1000× errado. '
  'Breakdown agora expõe required_in_product_unit + consumption_unit + product_unit.';


-- ─── #4 purchase_projection_timeline — deduzir reserved_stock ──────────
-- Recria a view com COALESCE(reserved_stock, 0) deduzido em estoque_atual.
DROP VIEW IF EXISTS public.purchase_projection_timeline CASCADE;
CREATE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,
    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,
    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,
    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,
    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.mesa_daily_capacity, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / ts.mesa_daily_capacity::numeric)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,
    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,
    COALESCE(ts.lead_time_buffer_material_dias, dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id, lt.pedido_ref, lt.sale_order_id, lt.data_entrega_cliente,
  lt.op_quantity, lt.order_status, lt.reference_id, lt.referencia_nome,
  lt.lead_time_corte_dias, lt.lead_time_costura_dias, lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias, lt.lead_time_acabamento_dias, lt.lead_time_buffer_material_dias,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias AS data_chegada_material,
  COALESCE(NULLIF(sup.lead_time_days, 0), NULLIF(m.supplier_lead_time_days, 0), 10) AS supplier_lead_time_days,
  m.supplier_lead_time_days AS material_lead_time_raw,
  sup.lead_time_days AS supplier_lead_time_raw,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias - COALESCE(NULLIF(sup.lead_time_days, 0), NULLIF(m.supplier_lead_time_days, 0), 10) AS data_limite_compra,
  m.id AS material_id, m.name AS material, m.group_id AS material_group_id,
  pg.name AS grupo_material, m.unit AS unidade,
  -- ── ANTES: estoque_atual = m.quantity (bruto)
  -- ── AGORA: deduz reserved_stock (consistente com soleAvailability.ts)
  GREATEST(0, m.quantity - COALESCE(m.reserved_stock, 0)) AS estoque_atual,
  m.quantity        AS estoque_bruto,        -- ← NOVO: pra auditoria
  COALESCE(m.reserved_stock, 0) AS estoque_reservado,
  m.min_stock, m.supplier_id, sup.name AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric AS quantidade_necessaria
FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

ALTER VIEW public.purchase_projection_timeline SET (security_invoker = true);

COMMENT ON VIEW public.purchase_projection_timeline IS
  'Cronograma reverso por OP+material. estoque_atual agora deduz '
  'reserved_stock (estoque_bruto - reserved_stock). Adiciona estoque_bruto '
  'e estoque_reservado pra auditoria.';


-- ─── #3 get_wave_material_needs — dedup robusto ───────────────────────────
-- O filtro NOT LIKE '%solado%' não é à prova de balas. Ex.: produto com
-- categoria 'Componente' que também é referenciado em sole_colors via
-- resolve_sole_color seria contado 2× (sheet_needed + sole_needed).
--
-- Solução: anti-join — sheet_needed exclui product_ids que já vão entrar
-- via sole_needed (extraídos via lateral join idêntico).
DROP FUNCTION IF EXISTS public.get_wave_material_needs(p_sale_order_ids uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE (
  product_id              uuid,
  product_name            text,
  unit                    text,
  color                   text,
  needed_qty              numeric,
  stock_qty               numeric,
  shortage                numeric,
  supplier_id             uuid,
  supplier_name           text,
  supplier_lead_time_days int,
  is_artisanal            boolean,
  artisanal_recipe_id     uuid,
  artisanal_recipe_name   text,
  base_product_id         uuid,
  base_product_name       text,
  base_needed_qty         numeric,
  base_stock_qty          numeric,
  base_shortage           numeric,
  os_send_date            date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_corte_start date;
BEGIN
  SELECT t.corte_palmilha_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t LIMIT 1;

  RETURN QUERY
  WITH
  -- IDs de solados que entram via sole_needed — pra excluir de sheet_needed
  sole_product_ids AS (
    SELECT DISTINCT rsc.sole_product_id
      FROM sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
     WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL
  ),
  sheet_needed AS (
    SELECT sm.product_id,
           COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity) AS needed_qty
      FROM sale_order_items soi
      JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
      JOIN products sp ON sp.id = sm.product_id
     WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       -- Anti-join robusto: exclui qualquer product que vai ser contabilizado
       -- via sole_needed, independente da categoria. Cobre os casos onde
       -- o filtro `category NOT LIKE '%solado%'` falhava silenciosamente.
       AND sm.product_id NOT IN (SELECT sole_product_id FROM sole_product_ids)
     GROUP BY sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '')
  ),
  sole_needed AS (
    SELECT rsc.sole_product_id AS product_id,
           COALESCE(NULLIF(rsc.sole_color,''), soi.color, '') AS effective_color,
           SUM(soi.quantity) AS needed_qty
      FROM sale_order_items soi
      CROSS JOIN LATERAL (SELECT sole_product_id, sole_color FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) rsc
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
           -- ANTES: stock_qty = p.quantity (bruto)
           -- AGORA: deduz reserved_stock (consistência com timeline view)
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS stock_qty,
           GREATEST(0, n.needed_qty - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))) AS shortage,
           p.supplier_id, sup.name AS supplier_name,
           COALESCE(p.supplier_lead_time_days, 10)::int AS supplier_lead_time_days,
           COALESCE(p.is_artisanal, false) AS is_artisanal
      FROM needed n
      JOIN products p ON p.id = n.product_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
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
    LEFT JOIN artisanal_recipes ar
           ON e.is_artisanal = true AND ar.active = true
          AND (lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
            OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%')
    LEFT JOIN products bp
           ON ar.id IS NOT NULL
          AND (lower(bp.name) = lower(ar.base_product_name)
            OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
            OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%')
          AND (e.color = '' OR lower(COALESCE(bp.color, '')) = lower(e.color)
            OR bp.color IS NULL OR bp.color = '')
   ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wave_material_needs(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_wave_material_needs(uuid[]) IS
  'Necessidades de material por onda. Usa anti-join (NOT IN sole_product_ids) '
  'pra evitar duplicação quando produto está em sheet_materials E também é '
  'resolvido via sole_color. Stock_qty deduz reserved_stock pra consistência.';
