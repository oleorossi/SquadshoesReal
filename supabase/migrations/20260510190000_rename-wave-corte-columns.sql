-- =============================================================================
-- Rename de colunas legadas em production_waves
-- =============================================================================
--
-- Após o rename de setores em 20260506120000, os campos `corte_start_date` e
-- `costura_start_date` ficaram com nomes inconsistentes com o vocabulário novo:
--
--   corte_start_date   → corte_palmilha_start_date  (= Corte Palmilha)
--   costura_start_date → corte_forracao_start_date  (= Corte Forração)
--
-- Esta migration:
--   1) Renomeia as colunas em production_waves.
--   2) Recria `compute_wave_timeline()` com o RETURNS TABLE atualizado.
--   3) Recria `update_wave_timeline()` para gravar nas colunas renomeadas.
--   4) Recria `get_wave_material_needs()` que lia `t.corte_start_date`.
--
-- O corpo de compute_wave_timeline (cálculo de lead times) é IDÊNTICO ao da
-- migration 20260506120000 — apenas o RETURNS TABLE e os aliases finais
-- mudam de nome.
-- =============================================================================

-- ── 1) RENAME columns ───────────────────────────────────────────────────────
ALTER TABLE public.production_waves
  RENAME COLUMN corte_start_date TO corte_palmilha_start_date;

ALTER TABLE public.production_waves
  RENAME COLUMN costura_start_date TO corte_forracao_start_date;

-- ── 2) Recria compute_wave_timeline ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline             date, corte_palmilha_start_date     date, corte_forracao_start_date     date, montagem_start_date           date, acabamento_start_date         date, silk_start_date               date, colagem_start_date            date, solagem_start_date            date, material_ready_date           date, purchase_deadline             date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_palmilha  int;
  v_lead_forracao  int;
  v_lead_mesa      int;
  v_lead_silk      int;
  v_lead_colagem   int;
  v_lead_montagem  int;
  v_lead_solagem   int;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_supplier  int;
  v_deadline       date;
BEGIN
  SELECT MIN(so.delivery_deadline)
    INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids)
     AND so.delivery_deadline IS NOT NULL;

  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    -- Corte Palmilha
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_palmilha'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                          dlt.sewing_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                            dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0),
                          dlt.lead_time_costura_dias,
                          (SELECT sc.costura_dias FROM shoe_category_lead_times sc
                           WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                          1)
          END
        ELSE 0
      END
    ), 1),

    -- Corte Forração
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'corte_forracao'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                          dlt.cutting_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                            dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0),
                          dlt.lead_time_corte_dias,
                          (SELECT sc.corte_dias FROM shoe_category_lead_times sc
                           WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                          2)
          END
        ELSE 0
      END
    ), 0),

    -- Mesa
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'mesa'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.mesa_daily_capacity::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Silk
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'silk'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.silk_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Colagem
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'colagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.gluing_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Montagem
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                        dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0),
                      dlt.lead_time_montagem_dias,
                      (SELECT sc.montagem_dias FROM shoe_category_lead_times sc
                       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      2)
      END
    ), 2),

    -- Solagem
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'solagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0), 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   ts.soling_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Acabamento
    COALESCE(MAX(
      CASE
        WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric /
               COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                        dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0),
                      dlt.lead_time_acabamento_dias,
                      (SELECT sc.acabamento_dias FROM shoe_category_lead_times sc
                       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
                      1)
      END
    ), 1),

    -- Buffer
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias, 0),
      dlt.lead_time_buffer_material_dias,
      (SELECT sc.buffer_material_dias FROM shoe_category_lead_times sc
       WHERE sc.shoe_category = ts.shoe_category LIMIT 1),
      2
    )), 2)

  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_mesa,
    v_lead_silk, v_lead_colagem,
    v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer

  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed, 0) > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 10) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  RETURN QUERY SELECT
    v_deadline                                             AS earliest_deadline,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao + v_lead_palmilha)
    )::date                                                AS corte_palmilha_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao)
    )::date                                                AS corte_forracao_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date                                                AS montagem_start_date,

    add_business_days(
      v_deadline, -v_lead_acab
    )::date                                                AS acabamento_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk)
    )::date                                                AS silk_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date                                                AS colagem_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem)
    )::date                                                AS solagem_start_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer)
    )::date                                                AS material_ready_date,

    add_business_days(
      v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer + v_lead_supplier)
    )::date                                                AS purchase_deadline;
END;
$$;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Cronograma reverso de uma onda de produção. Corpo idêntico ao da migration '
  '20260506120000; apenas as colunas legadas corte_start_date / costura_start_date '
  'foram renomeadas para corte_palmilha_start_date / corte_forracao_start_date.';

-- ── 3) Recria update_wave_timeline com nomes novos ──────────────────────────
DROP FUNCTION IF EXISTS public.update_wave_timeline(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl             record;
BEGIN
  SELECT array_agg(DISTINCT sale_order_id)
    INTO v_sale_order_ids
    FROM public.orders
   WHERE wave_id = p_wave_id;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl
    FROM public.compute_wave_timeline(v_sale_order_ids)
   LIMIT 1;

  UPDATE public.production_waves
     SET earliest_deadline         = v_tl.earliest_deadline,
         corte_palmilha_start_date = v_tl.corte_palmilha_start_date,
         corte_forracao_start_date = v_tl.corte_forracao_start_date,
         silk_start_date           = v_tl.silk_start_date,
         colagem_start_date        = v_tl.colagem_start_date,
         solagem_start_date        = v_tl.solagem_start_date,
         purchase_deadline         = v_tl.purchase_deadline,
         material_ready_date       = v_tl.material_ready_date,
         updated_at                = now()
   WHERE id = p_wave_id;
END;
$$;

-- ── 4) Recria get_wave_material_needs com nome novo ─────────────────────────
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
    FROM compute_wave_timeline(p_sale_order_ids) t
   LIMIT 1;

  RETURN QUERY
  WITH
  sheet_needed AS (
    SELECT
      sm.product_id,
      COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color,
      SUM(sm.quantity_per_unit * soi.quantity)       AS needed_qty
    FROM sale_order_items soi
    JOIN sheet_materials  sm ON sm.sheet_id = soi.reference_id
    JOIN products         sp ON sp.id = sm.product_id
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
      COALESCE(p.supplier_lead_time_days, 10)::int        AS supplier_lead_time_days,
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
