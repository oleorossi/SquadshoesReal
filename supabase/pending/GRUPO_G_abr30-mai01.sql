-- GRUPO G: Kanban, embalagem por solado, débito conjugado (abr/30 - mai/01)

-- ========== 20260430100000_sync-kanban-wave-bidirectional.sql ==========
-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SYNC BIDIRECIONAL — Kanban (order_stages) ↔ Ondas (production_wave_stages) ║
-- ║                                                                            ║
-- ║ Problema: os dois sistemas rastreavam estágio de forma independente.       ║
-- ║  · Kanban usa order_stages (por OP individual, nomes em PT)                ║
-- ║  · Ondas usa production_wave_stages (por onda, enum production_stage_enum) ║
-- ║                                                                            ║
-- ║ Esta migration adiciona:                                                   ║
-- ║  1. wave_stage_to_kanban_stages()  — mapeamento enum → array de nomes     ║
-- ║  2. kanban_stage_to_wave_stage()   — mapeamento nome → enum               ║
-- ║  3. sync_wave_from_kanban()        — re-deriva estágio da onda a partir    ║
-- ║     do progresso real das OPs no Kanban                                    ║
-- ║  4. fn_sync_wave_on_stage_complete() + trigger — ao concluir um setor no   ║
-- ║     Kanban, tenta auto-avançar a onda correspondente                       ║
-- ║  5. advance_wave_stage() atualizado — além de avançar a onda,             ║
-- ║     marca os order_stages correspondentes como concluido                   ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── 1. Mapeamento: estágio da onda → nomes de setores no Kanban ──────────────
-- Nomes em lowercase para comparação case-insensitive.
CREATE OR REPLACE FUNCTION public.wave_stage_to_kanban_stages(s production_stage_enum)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN ARRAY['corte']
    WHEN 'palmilha'   THEN ARRAY['palmilha']
    WHEN 'costura'    THEN ARRAY['costura','forração','forro','forra','aviamento','silk','serigrafia','silkscreen']
    WHEN 'montagem'   THEN ARRAY['montagem','colagem']
    WHEN 'solagem'    THEN ARRAY['solagem']
    WHEN 'mesa'       THEN ARRAY['mesa']
    WHEN 'acabamento' THEN ARRAY['acabamento','expedição','expedicao']
    ELSE              ARRAY[]::text[]
  END;
$$;

GRANT EXECUTE ON FUNCTION public.wave_stage_to_kanban_stages(production_stage_enum) TO authenticated;

-- ── 2. Mapeamento: nome de setor do Kanban → estágio da onda ─────────────────
CREATE OR REPLACE FUNCTION public.kanban_stage_to_wave_stage(p_stage_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_stage_name))
    WHEN 'corte'       THEN 'corte'::production_stage_enum
    WHEN 'palmilha'    THEN 'palmilha'::production_stage_enum
    WHEN 'costura'     THEN 'costura'::production_stage_enum
    WHEN 'forração'    THEN 'costura'::production_stage_enum
    WHEN 'forro'       THEN 'costura'::production_stage_enum
    WHEN 'forra'       THEN 'costura'::production_stage_enum
    WHEN 'aviamento'   THEN 'costura'::production_stage_enum
    WHEN 'silk'        THEN 'costura'::production_stage_enum
    WHEN 'serigrafia'  THEN 'costura'::production_stage_enum
    WHEN 'silkscreen'  THEN 'costura'::production_stage_enum
    WHEN 'colagem'     THEN 'montagem'::production_stage_enum
    WHEN 'montagem'    THEN 'montagem'::production_stage_enum
    WHEN 'solagem'     THEN 'solagem'::production_stage_enum
    WHEN 'mesa'        THEN 'mesa'::production_stage_enum
    WHEN 'acabamento'  THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'   THEN 'acabamento'::production_stage_enum
    WHEN 'expedicao'   THEN 'acabamento'::production_stage_enum
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.kanban_stage_to_wave_stage(text) TO authenticated;

-- ── 3. sync_wave_from_kanban: re-deriva estágio da onda a partir de order_stages ──
-- Para cada estágio da onda (em ordem de nível), verifica se TODAS as OPs da onda
-- têm o(s) setor(es) correspondente(s) do Kanban como 'concluido'.
-- Se sim → marca o wave_stage como 'completed'.
-- Primeiro wave_stage não concluído → 'in_progress' e define current_stage.
-- Retorna o novo current_stage (NULL se onda finalizada).
CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec            RECORD;
  v_total_orders   int;
  v_done_orders    int;
  v_new_current    production_stage_enum;
  v_now            timestamptz := now();
BEGIN
  -- Total de OPs ativas na onda
  SELECT COUNT(DISTINCT o.id)
    INTO v_total_orders
    FROM production_wave_items pwi
    JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
    JOIN orders o ON o.sale_order_id = pwis.sale_order_id
   WHERE pwi.wave_id = p_wave_id
     AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado');

  IF v_total_orders = 0 THEN
    RETURN NULL;
  END IF;

  -- Percorre estágios ordenados por nível
  FOR v_rec IN
    SELECT pws.stage, stage_order(pws.stage) AS lvl, pws.status AS cur_status
      FROM production_wave_stages pws
     WHERE pws.wave_id = p_wave_id
     ORDER BY stage_order(pws.stage), pws.stage
  LOOP
    -- Conta OPs que possuem ALGUM setor do Kanban correspondente como 'concluido'
    SELECT COUNT(DISTINCT o.id)
      INTO v_done_orders
      FROM production_wave_items pwi
      JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN orders o ON o.sale_order_id = pwis.sale_order_id
     WHERE pwi.wave_id = p_wave_id
       AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado')
       AND EXISTS (
         SELECT 1
           FROM order_stages os
          WHERE os.order_id = o.id
            AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_rec.stage))
            AND os.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       );

    IF v_done_orders >= v_total_orders THEN
      -- Todos concluídos → marca wave_stage como completed
      UPDATE production_wave_stages
         SET status      = 'completed',
             finished_at = COALESCE(finished_at, v_now),
             progress_pct = 100,
             updated_at  = v_now
       WHERE wave_id = p_wave_id
         AND stage = v_rec.stage
         AND status <> 'completed';
    ELSE
      -- Primeiro estágio não totalmente concluído → current
      IF v_new_current IS NULL THEN
        v_new_current := v_rec.stage;

        -- Calcula progresso parcial
        UPDATE production_wave_stages
           SET status      = 'in_progress',
               started_at  = COALESCE(started_at, v_now),
               progress_pct = CASE WHEN v_total_orders > 0
                                   THEN round((v_done_orders::numeric / v_total_orders) * 100)
                                   ELSE 0 END,
               updated_at  = v_now
         WHERE wave_id = p_wave_id
           AND stage = v_rec.stage
           AND status <> 'completed';  -- não regride estágio já concluído
      END IF;
    END IF;
  END LOOP;

  -- Atualiza current_stage na onda
  IF v_new_current IS NULL THEN
    -- Todos os estágios finalizados
    UPDATE production_waves
       SET status      = 'finished',
           current_stage = NULL,
           finished_at = COALESCE(finished_at, v_now)
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  ELSE
    UPDATE production_waves
       SET current_stage = v_new_current,
           status        = 'running'
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  END IF;

  RETURN v_new_current;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_wave_from_kanban(uuid) TO authenticated;

-- ── 4. Trigger: quando um order_stage é concluído, tenta sincronizar a onda ──
CREATE OR REPLACE FUNCTION public.fn_sync_wave_on_stage_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
BEGIN
  -- Só dispara quando status muda PARA concluido
  IF NEW.status NOT IN ('concluido', 'concluído', 'completed', 'done', 'pronto') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto') THEN
    RETURN NEW; -- sem mudança real
  END IF;

  -- Descobre se esta OP pertence a uma onda ativa
  SELECT DISTINCT pwi.wave_id
    INTO v_wave_id
    FROM orders o
    JOIN production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN production_wave_items pwi         ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw               ON pw.id = pwi.wave_id
   WHERE o.id = NEW.order_id
     AND pw.status = 'running'
   LIMIT 1;

  IF v_wave_id IS NOT NULL THEN
    PERFORM sync_wave_from_kanban(v_wave_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wave_on_stage_complete ON public.order_stages;
CREATE TRIGGER trg_sync_wave_on_stage_complete
  AFTER UPDATE OF status ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_wave_on_stage_complete();

-- ── 5. advance_wave_stage: também atualiza order_stages ao avançar a onda ────
-- Aceita p_stage opcional para avançar um setor específico (ex.: mesa paralela).
-- Mantém compatibilidade retroativa com chamadas sem p_stage.
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum DEFAULT NULL
)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   production_stage_enum;
  v_target    production_stage_enum;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Lock pessimista na onda
  SELECT current_stage
    INTO v_current
    FROM production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_current IS NULL AND p_stage IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  -- Estágio a avançar: explícito ou atual
  v_target := COALESCE(p_stage, v_current);

  -- Marca o estágio da onda como concluído
  UPDATE production_wave_stages
     SET status      = 'completed',
         finished_at = COALESCE(finished_at, v_now),
         progress_pct = 100,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_target;

  -- Também marca os order_stages correspondentes do Kanban como concluido
  -- para todas as OPs desta onda (Wave → Kanban sync)
  UPDATE order_stages os
     SET status           = 'concluido',
         completed_at     = COALESCE(os.completed_at, v_now),
         quantity_processed = os.quantity_total
    FROM orders o
    JOIN production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN production_wave_items pwi         ON pwi.id = pwis.wave_item_id
   WHERE pwi.wave_id = p_wave_id
     AND os.order_id  = o.id
     AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_target))
     AND os.status NOT IN ('concluido', 'concluído', 'completed', 'done');

  -- Determina próximo estágio (pelo nível: todos do nível atual precisam estar completos)
  -- Se o estágio avançado tem irmãos no mesmo nível ainda pendentes, não avança o current_stage
  IF EXISTS (
    SELECT 1
      FROM production_wave_stages
     WHERE wave_id = p_wave_id
       AND stage_order(stage) = stage_order(v_target)
       AND status <> 'completed'
       AND stage <> v_target
  ) THEN
    -- Há outros estágios no mesmo nível ainda em andamento; não muda current_stage
    RETURN v_current;
  END IF;

  -- Todos os estágios do nível atual concluídos → avança para o próximo nível
  SELECT pws.stage
    INTO v_next
    FROM production_wave_stages pws
   WHERE pws.wave_id = p_wave_id
     AND stage_order(pws.stage) = stage_order(v_target) + 1
     AND pws.status <> 'completed'
   ORDER BY pws.stage
   LIMIT 1;

  IF v_next IS NULL THEN
    -- Todos os níveis concluídos → finaliza a onda
    IF NOT EXISTS (
      SELECT 1
        FROM production_wave_stages
       WHERE wave_id = p_wave_id
         AND status <> 'completed'
    ) THEN
      UPDATE production_waves
         SET status      = 'finished',
             finished_at = v_now,
             current_stage = NULL
       WHERE id = p_wave_id;
      RETURN NULL;
    END IF;
    RETURN v_current;
  END IF;

  -- Inicia o próximo estágio
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = COALESCE(started_at, v_now),
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_next;

  UPDATE production_waves
     SET current_stage = v_next
   WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;
-- Mantém assinatura original (sem p_stage) para retrocompatibilidade
GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid) TO authenticated;

-- ========== 20260430110000_fix-sole-qty-in-wave-material-needs.sql ==========
-- Fix get_wave_material_needs: correct sole quantity calculation
-- Root cause: the function calculated sole needs from sheet_materials, but soles
-- are stored in technical_sheets.sole_material (not sheet_materials). If a sole
-- product happened to appear in sheet_materials with a wrong quantity_per_unit,
-- the PO would get a wildly incorrect quantity.
--
-- Fix:
--   1. Exclude sole-category products from the sheet_materials CTE.
--   2. Add a dedicated sole_needed CTE that uses resolve_sole_color and counts
--      exactly 1 pair of soles per pair of shoes (correct for all sole types).
--
-- Also fixes OC-2026-00127 by recalculating its sole items from the actual
-- production_wave_items data (total_pairs per sole product).

-- ─── 1. Fix get_wave_material_needs ──────────────────────────────────────────

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
  SELECT t.corte_start_date INTO v_corte_start
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  -- ── Sheet materials (non-sole) ─────────────────────────────────────────────
  -- Sole-category products are intentionally excluded here: their quantity is
  -- always 1 per pair and must be computed via resolve_sole_color (see below).
  -- Including them via sheet_materials risks wrong quantity_per_unit values.
  sheet_needed AS (
    SELECT
      sm.product_id,
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials  sm ON sm.sheet_id = soi.reference_id
    JOIN products         sp ON sp.id = sm.product_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      -- exclude any product already tracked as a sole (category-based guard)
      AND lower(COALESCE(sp.category, '')) NOT LIKE '%solado%'
      AND lower(COALESCE(sp.category, '')) != 'sola'
    GROUP BY sm.product_id,
             COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),

  -- ── Sole needs: exactly 1 per pair ────────────────────────────────────────
  -- Resolved via technical_sheets.sole_material + resolve_sole_color.
  -- This is the only correct source for sole quantity; it is immune to wrong
  -- quantity_per_unit entries in sheet_materials.
  sole_needed AS (
    SELECT
      rsc.sole_product_id                                        AS product_id,
      COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')        AS effective_color,
      SUM(soi.quantity)                                          AS needed_qty
    FROM sale_order_items soi
    CROSS JOIN LATERAL (
      SELECT sole_product_id, sole_color
        FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))
    ) rsc
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND rsc.sole_product_id IS NOT NULL
    GROUP BY rsc.sole_product_id,
             COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')
  ),

  -- ── Merge both sources ─────────────────────────────────────────────────────
  all_needed AS (
    SELECT product_id, effective_color, needed_qty FROM sheet_needed
    UNION ALL
    SELECT product_id, effective_color, needed_qty FROM sole_needed
  ),
  needed AS (
    SELECT   product_id,
             effective_color,
             SUM(needed_qty) AS needed_qty
    FROM     all_needed
    GROUP BY product_id, effective_color
  ),

  -- ── Enrich with product + supplier info ───────────────────────────────────
  enriched AS (
    SELECT
      n.product_id,
      p.name                                              AS product_name,
      COALESCE(p.unit, 'un')                              AS unit,
      n.effective_color                                   AS color,
      n.needed_qty,
      p.quantity                                          AS stock_qty,
      GREATEST(0, n.needed_qty - p.quantity)              AS shortage,
      p.supplier_id,
      sup.name                                            AS supplier_name,
      COALESCE(p.supplier_lead_time_days, 7)::int         AS supplier_lead_time_days,
      COALESCE(p.is_artisanal, false)                     AS is_artisanal
    FROM needed n
    JOIN products p ON p.id = n.product_id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  )
  SELECT
    e.product_id,
    e.product_name,
    e.unit,
    e.color,
    e.needed_qty,
    e.stock_qty,
    e.shortage,
    e.supplier_id,
    e.supplier_name,
    e.supplier_lead_time_days,
    e.is_artisanal,
    ar.id                                                 AS artisanal_recipe_id,
    ar.name                                               AS artisanal_recipe_name,
    bp.id                                                 AS base_product_id,
    ar.base_product_name,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
      THEN ROUND(e.needed_qty / ar.yield_per_meter, 3)
      ELSE NULL
    END                                                   AS base_needed_qty,
    bp.quantity                                           AS base_stock_qty,
    CASE
      WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
      THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity)
      ELSE NULL
    END                                                   AS base_shortage,
    CASE
      WHEN e.is_artisanal AND v_corte_start IS NOT NULL
      THEN (v_corte_start - 7)::date
      ELSE NULL
    END                                                   AS os_send_date
  FROM enriched e
  LEFT JOIN artisanal_recipes ar
         ON e.is_artisanal = true
        AND ar.active = true
        AND (
              lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
           OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%'
            )
  LEFT JOIN products bp
         ON ar.id IS NOT NULL
        AND (
              lower(bp.name) = lower(ar.base_product_name)
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%'
           OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%'
            )
        AND (
              e.color = ''
           OR lower(COALESCE(bp.color, '')) = lower(e.color)
           OR bp.color IS NULL
           OR bp.color = ''
            )
  ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

-- ─── 2. Fix OC-2026-00127 sole items ─────────────────────────────────────────
-- Strategy:
--   a. Re-deduplicate (idempotent, safe to run again).
--   b. For each sole product still in this OC, recalculate needed_qty from the
--      production_wave_items that were active around the OC creation date.
--      shortage = MAX(0, total_wave_pairs_for_sole - current_sole_stock)
--   c. If shortage = 0 for a sole item → remove it from the OC (no longer needed).
--   d. Recalculate OC total_value.

DO $$
DECLARE
  v_po_id        uuid;
  v_creation_date date;
  v_sole_id      uuid;
  v_sole_name    text;
  v_wave_pairs   numeric;
  v_stock        numeric;
  v_correct_qty  numeric;
  v_item_id      uuid;
  v_item_qty     numeric;
  v_new_total    numeric;
  v_sole_cat     text;
BEGIN
  -- ── Find the OC ────────────────────────────────────────────────────────────
  SELECT id, created_at::date
    INTO v_po_id, v_creation_date
    FROM purchase_orders
   WHERE order_number = 'OC-2026-00127';

  IF v_po_id IS NULL THEN
    RAISE NOTICE 'OC-2026-00127 não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- ── Step a: Dedup (keep highest-quantity row per product) ──────────────────
  DELETE FROM purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id
             FROM purchase_order_items
            WHERE purchase_order_id = v_po_id
            ORDER BY product_id, quantity DESC, created_at DESC
         );

  -- ── Step b: Recalculate sole items using actual wave data ──────────────────
  -- Find sole items in this OC
  FOR v_item_id, v_sole_id, v_item_qty IN
    SELECT poi.id, poi.product_id, poi.quantity
      FROM purchase_order_items poi
      JOIN products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = v_po_id
       AND (lower(COALESCE(p.category, '')) LIKE '%solado%'
         OR lower(COALESCE(p.category, '')) = 'sola')
  LOOP
    -- Total pairs for this sole across all wave items created on or near the OC date
    -- (wave creation and OC creation happen in the same transaction, so dates match)
    SELECT COALESCE(SUM(pwi.total_quantity), 0)
      INTO v_wave_pairs
      FROM production_wave_items pwi
      JOIN production_waves pw ON pw.id = pwi.wave_id
     WHERE pwi.sole_product_id = v_sole_id
       AND pw.created_at::date BETWEEN (v_creation_date - INTERVAL '1 day')
                                   AND (v_creation_date + INTERVAL '1 day');

    -- Current stock of this sole
    SELECT COALESCE(quantity, 0) INTO v_stock
      FROM products WHERE id = v_sole_id;

    v_correct_qty := GREATEST(0, v_wave_pairs - v_stock);

    IF v_correct_qty = 0 THEN
      -- No shortage → remove the item
      DELETE FROM purchase_order_items WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'OC-2026-00127: removido item sem falta — solado % (era %)', v_sole_name, v_item_qty;
    ELSIF v_correct_qty <> v_item_qty THEN
      -- Wrong quantity → correct it
      UPDATE purchase_order_items
         SET quantity = v_correct_qty,
             suggested_quantity = v_correct_qty
       WHERE id = v_item_id;
      SELECT name INTO v_sole_name FROM products WHERE id = v_sole_id;
      RAISE NOTICE 'OC-2026-00127: corrigido solado % de % para %', v_sole_name, v_item_qty, v_correct_qty;
    ELSE
      RAISE NOTICE 'OC-2026-00127: solado já com quantidade correta (%)' , v_item_qty;
    END IF;
  END LOOP;

  -- ── Step c: If no wave items found at all (no match by date), log a warning ─
  -- The user should verify manually in this edge case.

  -- ── Step d: Recalculate OC total_value ────────────────────────────────────
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_new_total
    FROM purchase_order_items
   WHERE purchase_order_id = v_po_id;

  UPDATE purchase_orders
     SET total_value = v_new_total
   WHERE id = v_po_id;

  RAISE NOTICE 'OC-2026-00127: total_value atualizado para R$ %', v_new_total;
END;
$$;

-- ========== 20260430120000_packaging-per-sole-product.sql ==========
-- Packaging configured per sole PRODUCT (not per group).
-- Each sole product (e.g. "Solado 01 Preto 20-28") holds its own individual/
-- master/colmeia box links with pairs_per_box. debit_packaging_for_order prefers
-- a sole_product_id match, then falls back to sole_group_id, then sheet_id.

-- ─── 1. Add sole_product_id to packaging_configs ─────────────────────────────

ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS sole_product_id UUID
    REFERENCES public.products(id) ON DELETE CASCADE;

-- Allow sole_product_id as a valid anchor (alongside sheet_id / sole_group_id)
ALTER TABLE public.packaging_configs
  DROP CONSTRAINT IF EXISTS packaging_configs_anchor_check;
ALTER TABLE public.packaging_configs
  ADD CONSTRAINT packaging_configs_anchor_check
    CHECK (
      sheet_id IS NOT NULL
      OR sole_group_id IS NOT NULL
      OR sole_product_id IS NOT NULL
    );

-- ─── 2. Update debit_packaging_for_order ─────────────────────────────────────
-- Priority (highest first):
--   1. packaging_configs with sole_product_id matching the exact sole for this order
--   2. packaging_configs with sole_product_id matching any sibling in the same group
--   3. packaging_configs with sole_group_id = sheet's sole_group_id (legacy)
--   4. packaging_configs with sheet_id = p_reference_id (oldest fallback)

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id  uuid,
  p_order_id       uuid,
  p_reference_id   uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_amarrado'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg                RECORD;
  boxes_needed       integer;
  v_result           jsonb := '[]'::jsonb;
  v_types_to_debit   text[];
  -- anchor resolution
  v_sole_group_id    uuid;
  v_order_color      text;
  v_sole_product_id  uuid;
  v_cfg_sole_id      uuid;   -- sole_product_id actually used for the query
BEGIN
  -- ── Packaging types from mode ─────────────────────────────────────────────
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  -- ── Resolve sole product for this specific order ──────────────────────────
  SELECT sole_group_id INTO v_sole_group_id
    FROM technical_sheets WHERE id = p_reference_id;

  SELECT COALESCE(color, '') INTO v_order_color
    FROM sale_orders WHERE id = p_sale_order_id;

  SELECT sole_product_id INTO v_sole_product_id
    FROM resolve_sole_color(p_reference_id, v_order_color)
   LIMIT 1;

  -- ── Priority 1: exact sole_product_id ────────────────────────────────────
  IF v_sole_product_id IS NOT NULL THEN
    SELECT sole_product_id INTO v_cfg_sole_id
      FROM packaging_configs
     WHERE sole_product_id = v_sole_product_id
       AND active = true
     LIMIT 1;
  END IF;

  -- ── Priority 2: any sibling in the same group ─────────────────────────────
  IF v_cfg_sole_id IS NULL AND v_sole_product_id IS NOT NULL THEN
    SELECT pc.sole_product_id INTO v_cfg_sole_id
      FROM packaging_configs pc
      JOIN products sib ON sib.id = pc.sole_product_id
      JOIN products anchor ON anchor.id = v_sole_product_id
                           AND sib.group_id = anchor.group_id
     WHERE pc.active = true
     LIMIT 1;
  END IF;

  -- ── Debit loop: use product configs (priority 1/2), group, or sheet ───────
  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box,
           pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome    AS box_name
      FROM packaging_configs pc
      LEFT JOIN products  p  ON p.id  = pc.product_id  AND p.active  = true
      LEFT JOIN box_types bt ON bt.id = pc.box_type_id AND bt.active = true
     WHERE (
             -- Product-level (highest priority)
             (v_cfg_sole_id IS NOT NULL AND pc.sole_product_id = v_cfg_sole_id)
             -- Group-level fallback (only when no product configs found)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NOT NULL
              AND pc.sole_group_id = v_sole_group_id)
             -- Sheet-level fallback (oldest, when no group either)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NULL
              AND pc.sheet_id = p_reference_id)
           )
       AND pc.active        = true
       AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    -- Primary path: debit box_types (centralised packaging stock)
    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;

      UPDATE box_types
         SET quantity = quantity - boxes_needed, updated_at = now()
       WHERE id = cfg.box_type_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.box_type_id, 'out', boxes_needed,
        cfg.box_stock, cfg.box_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'box_type_id',    cfg.box_type_id,
        'box_name',       COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_box_types'
      );

    -- Legacy path: debit from products table
    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;

      UPDATE products
         SET quantity = quantity - boxes_needed, updated_at = now()
       WHERE id = cfg.product_id;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity,
        previous_stock, new_stock, description, order_id
      ) VALUES (
        cfg.product_id, 'out', boxes_needed,
        cfg.current_stock, cfg.current_stock - boxes_needed,
        'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')',
        p_order_id
      );

      v_result := v_result || jsonb_build_object(
        'product_id',     cfg.product_id,
        'product_name',   COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type,
        'boxes_needed',   boxes_needed,
        'status',         'debited_products'
      );

    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type,
        'nome',           cfg.nome,
        'status',         'skipped',
        'reason',         'no_stock_linked'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;

-- ========== 20260501120000_fix-conjugated-debit-strict.sql ==========
-- Fix debit_sole_stock_by_grade: strict conjugated-key handling
--
-- Previous version (20260426140000) used the conjugated key ONLY when it already
-- existed in stock_grade (as a safety fallback). This was wrong for soles that
-- HAVE conjugations configured: their stock must be stored with conjugated keys
-- (e.g. "24/25"), so debiting with individual keys ("24", "25") would fail.
--
-- New behaviour:
--   1. If p_order_grade already contains conjugated keys ("24/25") → use as-is.
--   2. If conjugations are configured for the sole group:
--      a. Map each individual size to its conjugated key via get_sole_size_key().
--      b. Sizes not covered by any conjugation → use as individual key.
--   3. No conjugations configured → use all keys from p_order_grade unchanged.
--
-- This makes the debit function work correctly for:
--   • New orders stored with conjugated grades  (case 1)
--   • Old orders stored with individual grades  (cases 2/3 — backwards compat)

CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id     uuid,
  p_color        text,
  p_order_grade  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id       uuid;
  v_sole_material       text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id    uuid;
  target_name          text;
  v_stock_grade        jsonb;
  v_size               text;
  v_size_qty           numeric;
  v_available          numeric;
  v_new_grade          jsonb;
  v_total_debited      numeric := 0;
  v_prev_total         numeric;
  v_product_group_id   uuid;
  v_effective_grade    jsonb;
  v_conj_key           text;
  v_existing_qty       numeric;
  v_has_conjugations   boolean;
BEGIN
  -- ── Resolve sole info from technical sheet ───────────────────────────────────
  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- ── Resolve target sole product (same priority chain as before) ──────────────
  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
     WHERE p.active = true AND p.id = v_mapped_sole_product_id
     LIMIT 1;
  END IF;

  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  -- ── Check whether conjugations are configured for this sole group ─────────────
  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  -- ── Build effective debit grade ───────────────────────────────────────────────
  -- Rules:
  --   • If the key already contains '/' → already a conjugated key, use as-is
  --   • Else if conjugations are configured → resolve via get_sole_size_key()
  --     - If a conjugated key is found → use it (accumulate quantities)
  --     - If not found → the size is non-conjugated within the range, use as-is
  --   • No conjugations configured → use key unchanged (legacy individual format)
  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
  LOOP
    IF v_size LIKE '%/%' THEN
      -- Already a conjugated key ("24/25") — pass through
      v_conj_key := v_size;

    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      -- Sole has conjugations; map individual size → conjugated key
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      -- Size not covered by any conjugation → keep as individual key
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;

    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  -- ── Compute previous total for stock_movements ────────────────────────────────
  v_prev_total := 0;
  FOR v_size IN SELECT jsonb_object_keys(v_stock_grade) LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  -- ── Validate stock availability ───────────────────────────────────────────────
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  -- ── Debit stock ───────────────────────────────────────────────────────────────
  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = GREATEST(0, quantity - v_total_debited),
           updated_at  = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Débito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cor: ' || p_color ELSE '' END,
      p_order_id
    );
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.debit_sole_stock_by_grade(uuid, uuid, text, jsonb) TO authenticated;
