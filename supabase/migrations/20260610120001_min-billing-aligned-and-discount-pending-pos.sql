-- =============================================================================
-- PR 1 + PR 2 — Alinhar compute_min_billing_date com compute_wave_timeline
-- e descontar POs em trânsito do supplier lead time.
-- =============================================================================
-- Motivação:
--
-- 🔴 Bug 1: compute_min_billing_date (versão de 26/abr) somava apenas 4 setores
--    (corte, costura, montagem, acabamento) — faltavam Mesa, Silk, Colagem e
--    Solagem. Resultado: a "data mínima" sugerida ao salvar um PV era otimista
--    demais, divergindo do cronograma real calculado pela compute_wave_timeline
--    (a engine que efetivamente alimenta production_waves).
--
--    Sintoma de campo: usuário fechava PV com data sugerida "viável" e na
--    semana seguinte a onda explodia porque Mesa/Silk/Colagem/Solagem
--    consumiam dias adicionais não contados.
--
--    ✓ FIX: reescrita pra somar exatamente os mesmos 8 setores +
--    buffer + supplier_lead que compute_wave_timeline usa, usando
--    add_business_days() pra paridade total. Lê de technical_sheets
--    (capacities por setor) com fallback em default_lead_times por
--    shoe_category.
--
-- 🔴 Bug 2: compute_wave_timeline considerava só estoque atual (p.quantity)
--    ao decidir se contava supplier_lead_time. Se já existe PO 'pending' a
--    caminho cobrindo o gap, o sistema mesmo assim contava o lead time como
--    se precisasse comprar de novo — levando o material_ready_date e
--    purchase_deadline pra trás demais.
--
--    ✓ FIX: subtrai a quantidade já comprada (POs com status 'pending'
--    cobrindo cada produto) de total_needed antes de comparar com estoque.
--    Aplica também em compute_min_billing_date (mesma lógica).
--
-- Compatível com fluxo atual: assinaturas/RETURN das funções não mudam.
-- =============================================================================

-- ─── #1 compute_wave_timeline: desconta POs em trânsito do supplier lead ─────
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
            WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                          dlt.mesa_daily_capacity, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                            dlt.mesa_daily_capacity)::numeric)::int)
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

    -- Colagem
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

    -- Solagem
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

  -- Supplier lead time — DESCONTA POs em trânsito (status='pending')
  -- Lógica: pra cada produto, total_needed_liquido = total_needed - pending_qty.
  -- Se ainda > estoque, conta supplier_lead_time. Caso contrário, lead = 0.
  SELECT COALESCE(MAX(
    CASE
      WHEN GREATEST(0, needed.total_needed - COALESCE(pending.pending_qty, 0))
           > COALESCE(p.quantity, 0)
      THEN COALESCE(p.supplier_lead_time_days, 10)
      ELSE 0
    END
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
    JOIN products p ON p.id = needed.product_id
    LEFT JOIN (
      SELECT poi.product_id,
             SUM(COALESCE(poi.quantity, 0)) AS pending_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.status = 'pending'
       GROUP BY poi.product_id
    ) AS pending ON pending.product_id = needed.product_id;

  -- Cascade reverso: Acabamento ← Solagem ← Montagem ← Colagem ← Silk ← Mesa
  --                  ← Corte Forração ← Corte Palmilha
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
  'Cronograma reverso 9 setores. Desconta POs em trânsito (status pending) '
  'do supplier_lead_time pra evitar lead time fantasma quando material já '
  'foi comprado. Fonte de capacidade: ficha técnica > default_lead_times.';

GRANT EXECUTE ON FUNCTION public.compute_wave_timeline(uuid[]) TO authenticated, anon;

-- ─── #2 compute_min_billing_date: alinhada com compute_wave_timeline ─────────
-- Agora soma os MESMOS 8 setores + buffer + supplier (descontando POs pending).
-- Usa add_business_days pra paridade total com o cálculo das ondas.
DROP VIEW IF EXISTS public.sale_order_min_billing CASCADE;
DROP FUNCTION IF EXISTS public.compute_min_billing_date(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lead_palmilha  int := 0;
  v_lead_forracao  int := 0;
  v_lead_mesa      int := 0;
  v_lead_silk      int := 0;
  v_lead_colagem   int := 0;
  v_lead_montagem  int := 0;
  v_lead_solagem   int := 0;
  v_lead_acab      int := 0;
  v_lead_buffer    int := 2;
  v_lead_supplier  int := 0;
  v_total          int;
BEGIN
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
                          dlt.lead_time_costura_dias, 1)
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
                          dlt.lead_time_corte_dias, 2)
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
            WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                          dlt.mesa_daily_capacity, 0) > 0
              THEN GREATEST(1, CEIL(soi.quantity::numeric /
                   COALESCE(NULLIF(ts.mesa_daily_capacity, 0),
                            dlt.mesa_daily_capacity)::numeric)::int)
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
    -- Colagem
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
                      dlt.lead_time_montagem_dias, 2)
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
                      dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    -- Buffer
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias, 0),
      dlt.lead_time_buffer_material_dias,
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
  WHERE soi.sale_order_id = p_sale_order_id;

  -- Supplier lead time — DESCONTA POs em trânsito
  SELECT COALESCE(MAX(
    CASE
      WHEN GREATEST(0, needed.total_needed - COALESCE(pending.pending_qty, 0))
           > COALESCE(p.quantity, 0)
      THEN COALESCE(p.supplier_lead_time_days, 10)
      ELSE 0
    END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id,
             SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id
    LEFT JOIN (
      SELECT poi.product_id,
             SUM(COALESCE(poi.quantity, 0)) AS pending_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.status = 'pending'
       GROUP BY poi.product_id
    ) AS pending ON pending.product_id = needed.product_id;

  v_total := COALESCE(v_lead_palmilha, 0)
           + COALESCE(v_lead_forracao, 0)
           + COALESCE(v_lead_mesa, 0)
           + COALESCE(v_lead_silk, 0)
           + COALESCE(v_lead_colagem, 0)
           + COALESCE(v_lead_montagem, 0)
           + COALESCE(v_lead_solagem, 0)
           + COALESCE(v_lead_acab, 0)
           + COALESCE(v_lead_buffer, 0)
           + COALESCE(v_lead_supplier, 0);

  RETURN add_business_days(CURRENT_DATE, v_total)::date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_min_billing_date(uuid) IS
  'Data mínima de faturamento (somente dias úteis). Soma os 8 setores '
  '+ buffer + supplier_lead_time (descontando POs pending). Alinhada '
  'com compute_wave_timeline pra evitar divergência entre sugestão UI '
  'e cronograma real da onda.';

-- Recria a view (foi dropada por CASCADE acima)
CREATE VIEW public.sale_order_min_billing
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.delivery_deadline,
  so.manual_billing_override,
  so.original_min_billing_date,
  public.compute_min_billing_date(so.id) AS min_billing_date
FROM public.sale_orders so
WHERE so.status NOT IN ('Cancelado', 'cancelado', 'Faturado', 'faturado');

GRANT SELECT ON public.sale_order_min_billing TO authenticated, anon;

COMMENT ON VIEW public.sale_order_min_billing IS
  'Lookup de min_billing_date por sale_order — usado no frontend pra marcar '
  'PVs com delivery_deadline < min_billing_date como inviáveis (vermelho).';
