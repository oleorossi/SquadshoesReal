-- =================================================================
-- 04_rollback_pending_migrations.sql
--
-- Reverte as 7 migrations dos Grupos 9, 10, 11 caso algo dê errado em
-- produção. NÃO desfaz dados — apenas remove funções, triggers e
-- colunas adicionadas.
--
-- AVISO: rodando este script:
--   - calculate_order_cost VOLTA a ignorar packaging e grade
--   - sale_orders.total VOLTA a poder divergir de SUM(itens) → NF-e
--     pode ser rejeitada na origem
--   - Trigger de address override é removido → sync-cnpj volta a
--     sobrescrever filiais editadas manualmente
--   - resync_queue é dropada → mudanças em sole_size_conjugations,
--     palmilha_colors e artisanal_recipes voltam a NÃO disparar resync
--
-- USE APENAS SE houver bug crítico nas novas funções e for impossível
-- corrigir rapidamente. Prefira reaplicar a migration corrigida em vez
-- de rollback.
-- =================================================================

-- ── Reverter 20260504180000 (resync_queue + RPCs + triggers) ──────
DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
DROP TRIGGER IF EXISTS trg_resync_for_palmilha_colors ON public.technical_sheet_palmilha_colors;
DROP TRIGGER IF EXISTS trg_resync_for_artisanal_recipe ON public.artisanal_recipes;

DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_sole_conjugation();
DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_palmilha_colors();
DROP FUNCTION IF EXISTS public.fn_enqueue_resync_for_artisanal_recipe();
DROP FUNCTION IF EXISTS public.process_resync_queue(integer);
DROP FUNCTION IF EXISTS public.resync_op_atomic(uuid);

-- production_consumptions: remove colunas mas preserva linhas existentes
ALTER TABLE public.production_consumptions
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS superseded_reason;

DROP TABLE IF EXISTS public.resync_queue;

-- ── Reverter 20260504170000 (backfill de order_costs) ─────────────
-- Não há rollback — order_costs já foi UPSERTado com valores corretos.
-- Se quiser zerar a coluna packaging_cost de breakdown:
-- UPDATE public.order_costs
--    SET breakdown = breakdown - 'packaging_per_pair' - 'used_grade';

-- ── Reverter 20260504160000 (sale_orders.total trigger) ───────────
DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
DROP FUNCTION IF EXISTS public.fn_sync_sale_order_total();
DROP FUNCTION IF EXISTS public.recalc_sale_order_total(uuid);

-- ── Reverter 20260504150000 (MRP status filter) ───────────────────
-- Restaura a versão original (case-sensitive). Se for revertido, MRP
-- volta a ignorar pedidos com status em capitalização diferente.
CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_required numeric,
  earliest_deadline date,
  orders_count integer,
  order_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         FROM public.calculate_order_consumption(
           soi.reference_id, soi.quantity, COALESCE(soi.color,''),
           (SELECT key::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE so.status NOT IN ('Cancelado', 'Entregue', 'Finalizado', 'Faturado')
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT sale_order_id, delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name') AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT e.product_id, MAX(e.product_name), SUM(e.required),
         MIN(e.delivery_deadline), COUNT(DISTINCT e.sale_order_id)::integer,
         array_agg(DISTINCT e.sale_order_id)
    FROM exploded e
   WHERE e.product_id IS NOT NULL
   GROUP BY e.product_id;
END;
$$;

-- ── Reverter 20260504140000 (clients address override) ────────────
DROP TRIGGER IF EXISTS trg_track_client_address_manual_edit ON public.clients;
DROP FUNCTION IF EXISTS public.fn_track_client_address_manual_edit();

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS endereco_manual_override,
  DROP COLUMN IF EXISTS endereco_updated_at;

-- ── Reverter 20260504130000 (atomic packaging RPC) ────────────────
DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text);
-- AVISO: src/hooks/useOrders.ts agora chama essa RPC. Sem ela, criação
-- de OP com embalagem vai falhar com "function does not exist" no
-- frontend. Reverter o useOrders.ts em paralelo se aplicar este rollback.

-- ── Reverter 20260504120000 (calculate_order_cost packaging+grade) ──
-- Restaura a versão original sem packaging e sem grade.
CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record; v_ref uuid; v_color text; v_qty numeric; v_unit_price numeric;
  v_cons jsonb; v_line jsonb;
  v_material numeric := 0; v_labor numeric := 0;
  v_overhead_pct numeric; v_overhead numeric := 0; v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric; v_margin numeric; v_margin_pct numeric;
  v_op record; v_prod record; v_out jsonb;
BEGIN
  SELECT value INTO v_overhead_pct FROM public.cost_parameters WHERE key = 'overhead_pct';
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  SELECT soi.id, soi.reference_id, soi.color, soi.quantity, soi.unit_price
    INTO v_item FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR soi.id = p_sale_order_item_id)
   ORDER BY soi.created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := v_item.unit_price;

  SELECT consumption_snapshot INTO v_cons FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id) LIMIT 1;
  IF v_cons IS NULL THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cons
      FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL) c;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name INTO v_prod FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_material := v_material + COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric;
  END LOOP;

  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
  END LOOP;

  v_overhead := v_overhead_pct * (v_material + v_labor);
  v_total := v_material + v_labor + v_overhead;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost', v_material, 'labor_cost', v_labor,
    'overhead_cost', v_overhead, 'total_cost', v_total,
    'revenue', v_revenue, 'margin', v_margin, 'margin_pct', v_margin_pct
  );
  RETURN v_out;
END;
$$;
