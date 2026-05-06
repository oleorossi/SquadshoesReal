-- ========== 20260430100000_sync-kanban-wave-bidirectional.sql ==========

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
  SELECT COUNT(DISTINCT o.id)
    INTO v_total_orders
    FROM public.production_wave_items pwi
    JOIN public.production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
    JOIN public.orders o ON o.sale_order_id = pwis.sale_order_id
   WHERE pwi.wave_id = p_wave_id
     AND o.status NOT IN ('Cancelada', 'Finalizado');

  IF v_total_orders = 0 THEN
    RETURN NULL;
  END IF;

  FOR v_rec IN
    SELECT pws.stage, pws.status AS cur_status
      FROM public.production_wave_stages pws
     WHERE pws.wave_id = p_wave_id
     ORDER BY public.stage_order(pws.stage), pws.stage
  LOOP
    SELECT COUNT(DISTINCT o.id)
      INTO v_done_orders
      FROM public.production_wave_items pwi
      JOIN public.production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN public.orders o ON o.sale_order_id = pwis.sale_order_id
     WHERE pwi.wave_id = p_wave_id
       AND o.status NOT IN ('Cancelada', 'Finalizado')
       AND EXISTS (
         SELECT 1
           FROM public.order_stages os
          WHERE os.order_id = o.id
            AND lower(trim(os.stage_name)) = ANY(public.wave_stage_to_kanban_stages(v_rec.stage))
            AND os.status IN ('concluido', 'completed', 'done', 'pronto')
       );

    IF v_done_orders >= v_total_orders THEN
      UPDATE public.production_wave_stages
         SET status      = 'completed',
             finished_at = COALESCE(finished_at, v_now),
             progress_pct = 100,
             updated_at  = v_now
       WHERE wave_id = p_wave_id
         AND stage = v_rec.stage
         AND status <> 'completed';
    ELSE
      IF v_new_current IS NULL THEN
        v_new_current := v_rec.stage;
        UPDATE public.production_wave_stages
           SET status      = 'in_progress',
               started_at  = COALESCE(started_at, v_now),
               progress_pct = CASE WHEN v_total_orders > 0
                                   THEN round((v_done_orders::numeric / v_total_orders) * 100)
                                   ELSE 0 END,
               updated_at  = v_now
         WHERE wave_id = p_wave_id
           AND stage = v_rec.stage
           AND status <> 'completed';
      END IF;
    END IF;
  END LOOP;

  IF v_new_current IS NULL THEN
    UPDATE public.production_waves
       SET status      = 'finished',
           current_stage = NULL,
           finished_at = COALESCE(finished_at, v_now)
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  ELSE
    UPDATE public.production_waves
       SET current_stage = v_new_current,
           status        = 'running'
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  END IF;

  RETURN v_new_current;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_wave_on_stage_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
BEGIN
  IF NEW.status NOT IN ('concluido', 'completed', 'done', 'pronto') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('concluido', 'completed', 'done', 'pronto') THEN
    RETURN NEW;
  END IF;

  SELECT DISTINCT pwi.wave_id
    INTO v_wave_id
    FROM public.orders o
    JOIN public.production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN public.production_wave_items pwi         ON pwi.id = pwis.wave_item_id
    JOIN public.production_waves pw               ON pw.id = pwi.wave_id
   WHERE o.id = NEW.order_id
     AND pw.status = 'running'
   LIMIT 1;

  IF v_wave_id IS NOT NULL THEN
    PERFORM public.sync_wave_from_kanban(v_wave_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wave_on_stage_complete ON public.order_stages;
CREATE TRIGGER trg_sync_wave_on_stage_complete
  AFTER UPDATE OF status ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_wave_on_stage_complete();

-- ========== 20260430110000_fix-sole-qty-in-wave-material-needs.sql ==========

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
    FROM public.compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  sheet_needed AS (
    SELECT
      sm.product_id,
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM public.sale_order_items soi
    JOIN public.sheet_materials  sm ON sm.sheet_id = soi.reference_id
    JOIN public.products         sp ON sp.id = sm.product_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND lower(COALESCE(sp.category, '')) NOT LIKE '%solado%'
      AND lower(COALESCE(sp.category, '')) != 'sola'
    GROUP BY sm.product_id,
             COALESCE(NULLIF(sm.color, ''), soi.color, '')
  ),
  sole_needed AS (
    SELECT
      rsc.sole_product_id                                        AS product_id,
      COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')        AS effective_color,
      SUM(soi.quantity)                                          AS needed_qty
    FROM public.sale_order_items soi
    CROSS JOIN LATERAL (
      SELECT sole_product_id, sole_color
        FROM public.resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))
    ) rsc
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
      AND rsc.sole_product_id IS NOT NULL
    GROUP BY rsc.sole_product_id,
             COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '')
  ),
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
    JOIN public.products p ON p.id = n.product_id
    LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
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
  LEFT JOIN public.artisanal_recipes ar
         ON e.is_artisanal = true
        AND ar.active = true
        AND (
              lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%'
           OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%'
            )
  LEFT JOIN public.products bp
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

-- ========== 20260430120000_packaging-per-sole-product.sql ==========

ALTER TABLE public.packaging_configs
  ADD COLUMN IF NOT EXISTS sole_product_id UUID
    REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.packaging_configs
  DROP CONSTRAINT IF EXISTS packaging_configs_anchor_check;
ALTER TABLE public.packaging_configs
  ADD CONSTRAINT packaging_configs_anchor_check
    CHECK (
      sheet_id IS NOT NULL
      OR sole_group_id IS NOT NULL
      OR sole_product_id IS NOT NULL
    );

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
  v_sole_group_id    uuid;
  v_order_color      text;
  v_sole_product_id  uuid;
  v_cfg_sole_id      uuid;
BEGIN
  IF p_packaging_mode = 'colmeia' THEN
    v_types_to_debit := ARRAY['colmeia'];
  ELSIF p_packaging_mode = 'individual_master' THEN
    v_types_to_debit := ARRAY['individual', 'master'];
  ELSIF p_packaging_mode = 'individual_fitilho' THEN
    v_types_to_debit := ARRAY['individual', 'fitilho'];
  ELSE
    v_types_to_debit := ARRAY['individual'];
  END IF;

  SELECT sole_group_id INTO v_sole_group_id
    FROM public.technical_sheets WHERE id = p_reference_id;

  SELECT COALESCE(color, '') INTO v_order_color
    FROM public.sale_orders WHERE id = p_sale_order_id;

  SELECT rsc.sole_product_id INTO v_sole_product_id
    FROM public.resolve_sole_color(p_reference_id, v_order_color) rsc
   LIMIT 1;

  IF v_sole_product_id IS NOT NULL THEN
    SELECT pc.sole_product_id INTO v_cfg_sole_id
      FROM public.packaging_configs pc
     WHERE pc.sole_product_id = v_sole_product_id
       AND pc.active = true
     LIMIT 1;
  END IF;

  IF v_cfg_sole_id IS NULL AND v_sole_product_id IS NOT NULL THEN
    SELECT pc.sole_product_id INTO v_cfg_sole_id
      FROM public.packaging_configs pc
      JOIN public.products sib ON sib.id = pc.sole_product_id
      JOIN public.products anchor ON anchor.id = v_sole_product_id
                           AND sib.group_id = anchor.group_id
     WHERE pc.active = true
     LIMIT 1;
  END IF;

  FOR cfg IN
    SELECT pc.id, pc.packaging_type, pc.nome, pc.pairs_per_box,
           pc.product_id, pc.box_type_id,
           p.name    AS product_name, p.quantity AS current_stock,
           bt.quantity AS box_stock,  bt.nome    AS box_name
      FROM public.packaging_configs pc
      LEFT JOIN public.products  p  ON p.id  = pc.product_id  AND p.active  = true
      LEFT JOIN public.box_types bt ON bt.id = pc.box_type_id AND bt.active = true
     WHERE (
             (v_cfg_sole_id IS NOT NULL AND pc.sole_product_id = v_cfg_sole_id)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NOT NULL
              AND pc.sole_group_id = v_sole_group_id)
          OR (v_cfg_sole_id IS NULL AND v_sole_group_id IS NULL
              AND pc.sheet_id = p_reference_id)
           )
       AND pc.active        = true
       AND pc.packaging_type = ANY(v_types_to_debit)
  LOOP
    boxes_needed := CEIL(p_order_quantity::numeric / GREATEST(cfg.pairs_per_box, 1));

    IF cfg.box_type_id IS NOT NULL THEN
      IF cfg.box_stock IS NULL OR cfg.box_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.box_name, cfg.nome), COALESCE(cfg.box_stock, 0), boxes_needed;
      END IF;
      UPDATE public.box_types SET quantity = quantity - boxes_needed, updated_at = now() WHERE id = cfg.box_type_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (cfg.box_type_id, 'out', boxes_needed, cfg.box_stock, cfg.box_stock - boxes_needed,
              'Débito embalagem ' || COALESCE(cfg.box_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);
      v_result := v_result || jsonb_build_object(
        'box_type_id', cfg.box_type_id, 'box_name', COALESCE(cfg.box_name, cfg.nome),
        'packaging_type', cfg.packaging_type, 'boxes_needed', boxes_needed, 'status', 'debited_box_types');

    ELSIF cfg.product_id IS NOT NULL THEN
      IF cfg.current_stock IS NULL OR cfg.current_stock < boxes_needed THEN
        RAISE EXCEPTION 'Estoque insuficiente para embalagem "%": disponível %, necessário %',
          COALESCE(cfg.product_name, cfg.nome), COALESCE(cfg.current_stock, 0), boxes_needed;
      END IF;
      UPDATE public.products SET quantity = quantity - boxes_needed, updated_at = now() WHERE id = cfg.product_id;
      INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES (cfg.product_id, 'out', boxes_needed, cfg.current_stock, cfg.current_stock - boxes_needed,
              'Débito embalagem ' || COALESCE(cfg.product_name, cfg.nome) || ' (' || cfg.packaging_type || ')', p_order_id);
      v_result := v_result || jsonb_build_object(
        'product_id', cfg.product_id, 'product_name', COALESCE(cfg.product_name, cfg.nome),
        'packaging_type', cfg.packaging_type, 'boxes_needed', boxes_needed, 'status', 'debited_products');
    ELSE
      v_result := v_result || jsonb_build_object(
        'packaging_type', cfg.packaging_type, 'nome', cfg.nome, 'status', 'skipped', 'reason', 'no_stock_linked');
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text) TO authenticated;
