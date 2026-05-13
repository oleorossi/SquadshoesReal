-- =============================================================================
-- AUDIT-FIX 2 — Restaura paralelismo + setor Costura
-- =============================================================================
-- 🔴 Bug crítico que escapou na auditoria pós-PR1:
--
-- A migration anterior 20260610120000_min-billing-aligned-... pegou como base
-- a versão 20260513120000 de compute_wave_timeline (cascata sequencial sem
-- Costura), perdendo:
--
--   1. Setor "Costura" (introduzido em 20260521120000) — passa a ser dobrado
--      contra Corte Palmilha (mesma capacity), inflando o cálculo.
--   2. costura_start_date no RETURN — update_wave_timeline tenta gravar essa
--      coluna e FALHA silenciosamente em todas as waves running.
--   3. Paralelismo (introduzido em 20260522120000) — Corte P‖Corte F‖Mesa
--      voltaram a somar sequencialmente, esticando o lead da onda.
--
-- Sintoma observado: trigger trg_auto_assign_wave roda mas timeline da onda
-- permanece estática (porque update_wave_timeline aborta em RAISE EXCEPTION
-- engolido). Validação manual com PERFORM update_wave_timeline(...) trazia
-- "record v_tl has no field costura_start_date".
--
-- ✓ FIX: restaura compute_wave_timeline na versão de 20260522120000 (com
-- paralelismo + Costura), aplicando POR CIMA o desconto de POs em trânsito
-- que era o objetivo legítimo do PR2 anterior.
-- ✓ FIX: refaz compute_min_billing_date pra usar MAX(prep) + soma(seq) +
-- buffer + supplier (descontando POs pending), em paridade total com
-- compute_wave_timeline.
-- =============================================================================

DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline             date,
  corte_palmilha_start_date     date,
  corte_forracao_start_date     date,
  costura_start_date            date,
  mesa_start_date               date,
  silk_start_date               date,
  colagem_start_date            date,
  montagem_start_date           date,
  solagem_start_date            date,
  acabamento_start_date         date,
  material_ready_date           date,
  purchase_deadline             date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_palmilha  int;
  v_lead_forracao  int;
  v_lead_costura   int;
  v_lead_mesa      int;
  v_lead_silk      int;
  v_lead_colagem   int;
  v_lead_montagem  int;
  v_lead_solagem   int;
  v_lead_acab      int;
  v_lead_buffer    int;
  v_lead_supplier  int;
  v_deadline       date;
  v_lead_prep_max  int;
  v_post_prep      int;
  v_costura_start  date;
  v_earliest_prep  date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline
    FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha') THEN
        CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1)
        END
      ELSE 0 END
    ), 1),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao') THEN
        CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2)
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura') THEN
        CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa') THEN
        CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk') THEN
        CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem') THEN
        CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END
    ), 2),
    COALESCE(MAX(
      CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem') THEN
        CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1
        END
      ELSE 0 END
    ), 0),
    COALESCE(MAX(
      CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END
    ), 1),
    COALESCE(MAX(COALESCE(
      NULLIF(ts.lead_time_buffer_material_dias,0),
      dlt.lead_time_buffer_material_dias, 2
    )), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);

  -- Supplier lead time — DESCONTA POs pending (objetivo do PR2)
  SELECT COALESCE(MAX(
    CASE WHEN GREATEST(0, needed.total_needed - COALESCE(pending.pending_qty, 0))
              > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 10) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit*soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = ANY(p_sale_order_ids)
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id
    LEFT JOIN (
      SELECT poi.product_id, SUM(COALESCE(poi.quantity, 0)) AS pending_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.status = 'pending'
       GROUP BY poi.product_id
    ) AS pending ON pending.product_id = needed.product_id;

  -- Cascade com paralelismo (Corte P ‖ Corte F ‖ Mesa convergem em Costura)
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem
                + v_lead_colagem + v_lead_silk + v_lead_costura;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa);
  v_costura_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_costura_start, -v_lead_prep_max)::date;

  RETURN QUERY SELECT
    v_deadline AS earliest_deadline,
    add_business_days(v_costura_start, -v_lead_palmilha)::date AS corte_palmilha_start_date,
    add_business_days(v_costura_start, -v_lead_forracao)::date AS corte_forracao_start_date,
    v_costura_start                                            AS costura_start_date,
    add_business_days(v_costura_start, -v_lead_mesa)::date     AS mesa_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk))::date AS silk_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem))::date AS colagem_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem))::date AS montagem_start_date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date AS solagem_start_date,
    add_business_days(v_deadline, -v_lead_acab)::date AS acabamento_start_date,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date AS material_ready_date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date AS purchase_deadline;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_wave_timeline(uuid[]) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_wave_timeline(uuid[]) IS
  'Cascade com paralelismo (Corte P || Corte F || Mesa) + Costura sequencial. '
  'Desconta POs em transito (status pending) do supplier_lead_time. '
  'material_ready usa o inicio mais antigo dos prep para garantir matéria prima '
  'antes do primeiro setor arrancar.';

-- ─── compute_min_billing_date — alinhada com paralelismo + costura ──────────
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
  v_lead_costura   int := 0;
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
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha') THEN
        CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1)
        END ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao') THEN
        CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2)
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura') THEN
        CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / ts.costura_capacity_per_day::numeric)::int)
          ELSE 1
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa') THEN
        CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk') THEN
        CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem') THEN
        CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2)
      END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem') THEN
        CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1
        END ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1)
      END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO
    v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
    v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab,
    v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;

  SELECT COALESCE(MAX(
    CASE WHEN GREATEST(0, needed.total_needed - COALESCE(pending.pending_qty, 0))
              > COALESCE(p.quantity, 0)
         THEN COALESCE(p.supplier_lead_time_days, 10) ELSE 0 END
  ), 0)
    INTO v_lead_supplier
    FROM (
      SELECT sm.product_id, SUM(sm.quantity_per_unit * soi.quantity) AS total_needed
        FROM sale_order_items soi
        JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
       GROUP BY sm.product_id
    ) AS needed
    JOIN products p ON p.id = needed.product_id
    LEFT JOIN (
      SELECT poi.product_id, SUM(COALESCE(poi.quantity, 0)) AS pending_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.status = 'pending'
       GROUP BY poi.product_id
    ) AS pending ON pending.product_id = needed.product_id;

  -- Total = MAX(prep paralelo) + soma sequencial pós-prep + buffer + supplier
  v_total := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa)
           + v_lead_costura
           + v_lead_silk
           + v_lead_colagem
           + v_lead_montagem
           + v_lead_solagem
           + v_lead_acab
           + v_lead_buffer
           + v_lead_supplier;

  RETURN add_business_days(CURRENT_DATE, v_total)::date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_min_billing_date(uuid) TO authenticated, anon;

COMMENT ON FUNCTION public.compute_min_billing_date(uuid) IS
  'Data minima viavel de faturamento usando MAX(prep paralelo) + soma '
  'sequencial dos demais setores + buffer + supplier (descontando POs pending). '
  'Em paridade total com compute_wave_timeline.';

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

-- Recompute one-shot — agora que update_wave_timeline volta a funcionar
DO $$
DECLARE
  v_wave RECORD;
BEGIN
  FOR v_wave IN
    SELECT id FROM public.production_waves
    WHERE status::text NOT IN ('cancelled', 'finished')
  LOOP
    BEGIN
      PERFORM public.update_wave_timeline(v_wave.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'recompute pos-fix falhou pra wave %: %', v_wave.id, SQLERRM;
    END;
  END LOOP;
END $$;
