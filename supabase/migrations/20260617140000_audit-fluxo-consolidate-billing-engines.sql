-- =============================================================================
-- AUDIT FLUXO COMPLETO — P1-P3: consolida motores de prazo divergentes
-- =============================================================================
--
-- Bugs:
--   🔴 P1 — 3 motores divergentes:
--      - compute_wave_timeline (paralelo PR3, business days, com Costura)
--      - compute_min_billing_date (sequencial, dias-calendário, SEM Mesa/Silk/
--        Colagem/Solagem/Costura — só 4 setores antigos)
--      - VIEW purchase_projection_timeline (sequencial, dias-calendário, sem
--        Costura/Silk/Colagem/Solagem)
--   🔴 P2 — compute_min_billing_date usa CURRENT_DATE + dias (calendar);
--           outros usam add_business_days() (úteis). Em 15 dias úteis, diferença ~6.
--   🔴 P3 — supplier_lead em compute_wave_timeline só >0 quando total > p.quantity
--           SEM deduzir reserved_stock; outras OPs já reservaram → sistema diz
--           "comprar hoje serve" e promete prazo impossível.
--
-- Fix: reescreve compute_min_billing_date espelhando a fórmula da
-- compute_wave_timeline (mesma cascata, mesmos setores, business days, deduz
-- reserved_stock no check de supplier). Recria view purchase_projection_timeline
-- incluindo Costura/Silk/Colagem/Solagem e usando paralelismo prep.
-- =============================================================================

-- ─── 1. compute_min_billing_date refatorada ────────────────────────────────
DROP VIEW IF EXISTS public.sale_order_min_billing CASCADE;
DROP FUNCTION IF EXISTS public.compute_min_billing_date(p_sale_order_id uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_qty integer := 0;
  v_lead_palmilha int := 0;
  v_lead_forracao int := 0;
  v_lead_costura  int := 0;
  v_lead_mesa     int := 0;
  v_lead_silk     int := 0;
  v_lead_colagem  int := 0;
  v_lead_montagem int := 0;
  v_lead_solagem  int := 0;
  v_lead_acab     int := 0;
  v_lead_buffer   int := 0;
  v_lead_supplier int := 0;
  v_total_business_days int := 0;
  v_raw_date date;
  v_next_tue date;
  v_next_fri date;
BEGIN
  -- Resolve lead times respeitando production_sectors da ficha (setor não
  -- presente conta 0). Idêntica à fórmula em compute_wave_timeline pra evitar
  -- divergência entre os motores.
  SELECT
    -- Corte Palmilha
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1)
          END
        ELSE 0 END
    ), 0),
    -- Corte Forração
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'corte_forracao')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
            ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2)
          END
        ELSE 0 END
    ), 0),
    -- Costura (PR 2)
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'costura')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
            ELSE 1
          END
        ELSE 0 END
    ), 0),
    -- Mesa/Aviamento
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'mesa')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
            ELSE 1
          END
        ELSE 0 END
    ), 0),
    -- Silk
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'silk')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
            ELSE 1
          END
        ELSE 0 END
    ), 0),
    -- Colagem
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'colagem')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
            ELSE 1
          END
        ELSE 0 END
    ), 0),
    -- Montagem (sempre presente)
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END
    ), 2),
    -- Solagem
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                        WHERE sector_display_to_enum(x.value) = 'solagem')
        THEN
          CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
            THEN GREATEST(1, CEIL(soi.quantity::numeric /
                 COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
            ELSE 1
          END
        ELSE 0 END
    ), 0),
    -- Acabamento (sempre)
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    -- Buffer
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0),
                          dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;

  IF v_lead_palmilha IS NULL THEN
    RETURN NULL;
  END IF;

  -- Supplier lead time: deduz reserved_stock antes de checar ruptura (fix P3).
  -- Considera o lead do fornecedor SÓ quando total_needed > (quantity - reserved_stock).
  SELECT COALESCE(MAX(
    CASE WHEN COALESCE(needed.total_needed,0)
              > GREATEST(0, COALESCE(p.quantity,0) - COALESCE(p.reserved_stock,0))
         THEN COALESCE(p.supplier_lead_time_days,10)
         ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id;

  -- Cascata PARALELA: prep (palmilha ‖ forração ‖ mesa) → costura → silk →
  -- colagem → montagem → solagem → acabamento. + buffer + supplier antes.
  v_total_business_days :=
      COALESCE(v_lead_supplier, 0)
    + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa)  -- prep paralelo
    + COALESCE(v_lead_costura, 0)
    + COALESCE(v_lead_silk, 0)
    + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2)
    + COALESCE(v_lead_solagem, 0)
    + COALESCE(v_lead_acab, 1);

  -- BUSINESS DAYS (fix P2): usa add_business_days em vez de CURRENT_DATE + dias.
  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;

  -- Snap pra próxima janela de pickup viável (Ter ou Sex, o que vier antes).
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_min_billing_date(uuid) IS
  'Data mínima de faturamento consolidada: usa MESMA fórmula da '
  'compute_wave_timeline (paralelismo prep, business days, dedução de '
  'reserved_stock no supplier lead). Snap para próxima Ter/Sex.';

-- Recria view sale_order_min_billing
CREATE OR REPLACE VIEW public.sale_order_min_billing AS
SELECT id AS sale_order_id, public.compute_min_billing_date(id) AS min_billing_date
  FROM public.sale_orders
 WHERE status NOT IN ('Cancelado','cancelado','FINALIZADO');

ALTER VIEW public.sale_order_min_billing SET (security_invoker = true);


-- ─── 2. purchase_projection_timeline refatorada ────────────────────────────
-- Inclui Costura/Silk/Colagem/Solagem + paralelismo prep. Dedução de
-- reserved_stock em estoque_atual. Datas de cada setor refletem cascata.
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

    -- Corte Palmilha (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
        ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 1)
      END
      ELSE 0
    END AS lead_time_palmilha_dias,
    -- Corte Forração (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
        ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
      END
      ELSE 0
    END AS lead_time_forracao_dias,
    -- Mesa/Aviamento (prep paralelo)
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(ts.mesa_daily_capacity, dlt.mesa_daily_capacity, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                      dlt.mesa_daily_capacity)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_mesa_dias,
    -- Costura
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'costura')
      THEN CASE WHEN COALESCE(ts.costura_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric / ts.costura_capacity_per_day::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_costura_dias,
    -- Silk
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(ts.silk_capacity_per_day, dlt.silk_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.silk_capacity_per_day, 0),
                      dlt.silk_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_silk_dias,
    -- Colagem
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(ts.gluing_capacity_per_day, dlt.gluing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.gluing_capacity_per_day, 0),
                      dlt.gluing_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_colagem_dias,
    -- Montagem (sempre)
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
      THEN GREATEST(1, CEIL(o.quantity::numeric /
           COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                    dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,
    -- Solagem
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x
                      WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(ts.soling_capacity_per_day, dlt.soling_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.soling_capacity_per_day, 0),
                      dlt.soling_capacity_per_day)::numeric)::integer)
        ELSE 1
      END
      ELSE 0
    END AS lead_time_solagem_dias,
    -- Acabamento (sempre)
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
      THEN GREATEST(1, CEIL(o.quantity::numeric /
           COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                    dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,
    -- Buffer
    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias

  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,

  -- Lead times individuais (todos os setores agora)
  lt.lead_time_palmilha_dias,
  lt.lead_time_forracao_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_silk_dias,
  lt.lead_time_colagem_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_solagem_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,

  -- Alias legacy (frontend ProductionScheduleTimeline ainda usa estas chaves)
  lt.lead_time_forracao_dias AS lead_time_corte_dias,

  -- Datas em cascata reversa (do deadline pra trás), com paralelismo prep.
  -- post_prep = acabamento + solagem + montagem + colagem + silk + costura
  -- costura_start = deadline - post_prep
  -- earliest_prep = costura_start - MAX(palmilha,forracao,mesa)
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias
    AS data_inicio_solagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias
    AS data_inicio_colagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    AS data_inicio_silk,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    AS data_inicio_costura,
  -- Alias legacy: frontend usa data_inicio_corte/data_inicio_mesa.
  -- Prep paralelo: data_inicio = costura_start - lead_time_prep_individual.
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_forracao_dias
    AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_palmilha_dias
    AS data_inicio_palmilha,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias - lt.lead_time_mesa_dias
    AS data_inicio_mesa,
  -- Material chega no início mais antigo de todos os prep (= mais restritivo)
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    - GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias, lt.lead_time_mesa_dias)
    AS data_chegada_material,

  COALESCE(NULLIF(sup.lead_time_days, 0),
           NULLIF(m.supplier_lead_time_days, 0),
           10) AS supplier_lead_time_days,

  m.supplier_lead_time_days        AS material_lead_time_raw,
  sup.lead_time_days               AS supplier_lead_time_raw,

  -- data_limite_compra = data_chegada_material - supplier_lead_time
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias
    - lt.lead_time_solagem_dias - lt.lead_time_montagem_dias
    - lt.lead_time_colagem_dias - lt.lead_time_silk_dias
    - lt.lead_time_costura_dias
    - GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias, lt.lead_time_mesa_dias)
    - lt.lead_time_buffer_material_dias
    - COALESCE(NULLIF(sup.lead_time_days, 0),
               NULLIF(m.supplier_lead_time_days, 0),
               10)
    AS data_limite_compra,

  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  -- Deduz reserved_stock pra refletir disponível real
  GREATEST(0, m.quantity - COALESCE(m.reserved_stock, 0))::numeric AS estoque_atual,
  m.quantity        AS estoque_bruto,
  COALESCE(m.reserved_stock, 0) AS estoque_reservado,
  m.min_stock,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric
    AS quantidade_necessaria

FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.reference_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

ALTER VIEW public.purchase_projection_timeline SET (security_invoker = true);

COMMENT ON VIEW public.purchase_projection_timeline IS
  'Cronograma reverso por OP+material — usa MESMA fórmula da compute_wave_timeline '
  'com paralelismo prep e todos os 10 setores. estoque_atual deduz reserved_stock.';
