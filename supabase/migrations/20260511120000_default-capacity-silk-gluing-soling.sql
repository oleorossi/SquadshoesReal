-- =============================================================================
-- Adiciona capacidade padrão por dia para Silk, Colagem e Solagem em
-- default_lead_times e atualiza compute_wave_timeline() para usá-las como
-- fallback de 2º nível (após ficha técnica, antes de hardcoded 1).
-- =============================================================================

-- ── 1) Novas colunas em default_lead_times ───────────────────────────────────
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS silk_capacity_per_day   integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gluing_capacity_per_day integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day integer DEFAULT NULL;

COMMENT ON COLUMN public.default_lead_times.silk_capacity_per_day   IS 'Capacidade padrão do setor Silk (pares/dia) — fallback quando ficha técnica = 0';
COMMENT ON COLUMN public.default_lead_times.gluing_capacity_per_day IS 'Capacidade padrão do setor Colagem (pares/dia) — fallback quando ficha técnica = 0';
COMMENT ON COLUMN public.default_lead_times.soling_capacity_per_day IS 'Capacidade padrão do setor Solagem (pares/dia) — fallback quando ficha técnica = 0';

-- ── 2) Recria compute_wave_timeline com dlt fallback para os 3 setores ───────
DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline             date,
  corte_palmilha_start_date     date,
  corte_forracao_start_date     date,
  montagem_start_date           date,
  acabamento_start_date         date,
  silk_start_date               date,
  colagem_start_date            date,
  solagem_start_date            date,
  mesa_start_date               date,
  material_ready_date           date,
  purchase_deadline             date
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

    -- Silk (agora com dlt fallback)
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'silk'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0),
                          dlt.silk_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.silk_capacity_per_day, 0),
                            dlt.silk_capacity_per_day)::numeric)::int)
            ELSE 1
          END
        ELSE 0
      END
    ), 0),

    -- Colagem (agora com dlt fallback)
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'colagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0),
                          dlt.gluing_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.gluing_capacity_per_day, 0),
                            dlt.gluing_capacity_per_day)::numeric)::int)
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

    -- Solagem (agora com dlt fallback)
    COALESCE(MAX(
      CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x
          WHERE sector_display_to_enum(x.value) = 'solagem'
        ) THEN
          CASE
            WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0),
                          dlt.soling_capacity_per_day, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.soling_capacity_per_day, 0),
                            dlt.soling_capacity_per_day)::numeric)::int)
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
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Flow (backward): Acabamento ← Solagem ← Montagem ← Colagem ← Silk ← Mesa ← Corte Forração ← Corte Palmilha
  RETURN QUERY SELECT
    v_deadline                                             AS earliest_deadline,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_mesa + v_lead_forracao + v_lead_palmilha)
    )::date                                                AS corte_palmilha_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_mesa + v_lead_forracao)
    )::date                                                AS corte_forracao_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem)
    )::date                                                AS montagem_start_date,

    add_business_days(
      v_deadline,
      -v_lead_acab
    )::date                                                AS acabamento_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk)
    )::date                                                AS silk_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem)
    )::date                                                AS colagem_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem)
    )::date                                                AS solagem_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_mesa)
    )::date                                                AS mesa_start_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_mesa + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer)
    )::date                                                AS material_ready_date,

    add_business_days(
      v_deadline,
      -(v_lead_acab + v_lead_solagem + v_lead_montagem
        + v_lead_colagem + v_lead_silk + v_lead_mesa + v_lead_forracao
        + v_lead_palmilha + v_lead_buffer + v_lead_supplier)
    )::date                                                AS purchase_deadline;
END;
$$;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Cronograma reverso de uma onda de produção. Silk/Colagem/Solagem agora '
  'usam default_lead_times.*_capacity_per_day como fallback de 2º nível '
  '(antes apenas a ficha técnica era consultada, caindo em 1 dia fixo).';
