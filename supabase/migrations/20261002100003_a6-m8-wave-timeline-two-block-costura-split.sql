-- ============================================================================
-- A6 + M8 (auditoria 2026-07-28) — compute_wave_timeline /
-- compute_min_billing_date / purchase_projection_timeline com topologia de
-- preparo obsoleta após o split da Costura.
--
-- O SQL vivo (20260920161000; view em 20260920122000) mantinha a Costura
-- PARALELA aos 3 preps (lead prep = GREATEST(palmilha, forracao, mesa,
-- costura)) e lia só a capacidade legada costura_capacity_per_day. O frontend
-- (src/lib/sectorCapacity.ts / leadTime.ts) já modela DOIS blocos:
--
--   bloco 1 — Corte Palmilha ‖ Corte Forração        (termina quando o 2 começa)
--   bloco 2 — Costura Palmilha ‖ Costura Cabedal ‖ Aviamento (termina no Silk)
--
-- e lê costura_palmilha_capacity_per_day / costura_cabedal_capacity_per_day
-- com fallback na legada. Datas das telas divergiam de material_ready_date /
-- purchase_deadline e das âncoras de compra — mesma classe do bug fechado na
-- 20260524120000.
--
-- Fix: diff mínimo sobre as definições vivas —
--   • lead da fase costura = GREATEST das duas pernas, cada uma com a coluna
--     nova e fallback na legada (ficha e default_lead_times);
--   • cortes ancoram no início do bloco 2 (não mais no início do Silk);
--   • material_ready/purchase_deadline derivam do início mais cedo dos cortes;
--   • purchase_projection_timeline (espelho de compras que NÃO delega à wave)
--     recalculada com a mesma topologia — colunas de saída inalteradas.
-- As demais âncoras (compute_po_purchase_by_date, get_wave_material_needs,
-- v_mrp_needs) delegam a compute_wave_timeline e herdam o fix.
-- Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
 RETURNS TABLE(earliest_deadline date, corte_palmilha_start_date date, corte_forracao_start_date date, costura_start_date date, mesa_start_date date, silk_start_date date, colagem_start_date date, montagem_start_date date, solagem_start_date date, acabamento_start_date date, acabamento_end_date date, pickup_tuesday_date date, pickup_friday_date date, material_ready_date date, purchase_deadline date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int; v_lead_forracao int; v_lead_costura int; v_lead_mesa int;
  v_lead_cost_palm int; v_lead_cost_cab int; v_block2_max int; v_block2_start date;
  v_lead_silk int; v_lead_colagem int; v_lead_montagem int; v_lead_solagem int;
  v_lead_acab int; v_lead_buffer int; v_lead_supplier int;
  v_deadline date; v_lead_prep_max int; v_post_prep int;
  v_seq_start date; v_earliest_prep date; v_acab_start date; v_acab_end date;
  v_pickup_tue date; v_pickup_fri date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline FROM sale_orders so
   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    -- Split da Costura (20261001120000): lead POR PERNA, capacidade nova com
    -- fallback na legada (espelho de src/lib/leadTime.ts). 'costura' legado no
    -- roteiro conta como palmilha (mesma regra do trg_normalize).
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) IN ('costura palmilha','costura'))
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) = 'costura cabedal')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_cost_palm, v_lead_cost_cab, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  -- F3-5 v2: gate de fornecedor derivado do motor CANÔNICO de necessidades
  -- (get_wave_material_needs_core), que resolve cor/variante/grade/tiras,
  -- converte dm²→unidade física e devolve reservas dos próprios PVs — fecha o
  -- falso-positivo POR COR da soma crua de sheet_materials (estoque do produto
  -- na cor ERRADA contava como cobertura e omitia o lead do fornecedor).
  -- ⚠ Chamar a _CORE (p_corte_start NULL — os_send_date é irrelevante pro
  -- gate), NUNCA get_wave_material_needs: a v1 (mig 20260920160000, revertida)
  -- chamava o wrapper, que chama compute_wave_timeline na 1ª instrução →
  -- recursão mútua infinita (54001) em produção.
  -- conversion_warning (largura faltando) não aciona o lead (valor cru em dm²
  -- é ~100× o físico → shortage falso). Item ARTESANAL aciona pelo shortage do
  -- produto BASE (napa) — a tira final é produzida internamente.
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs_core(p_sale_order_ids, NULL) n;
  -- A6/M8: preparo em DOIS blocos (espelho de sectorCapacity.ts):
  --   bloco 1 — Corte Palmilha ‖ Corte Forração
  --   bloco 2 — Costura Palmilha ‖ Costura Cabedal ‖ Aviamento
  -- O bloco 1 termina quando o 2 começa; o lead da fase de costura no nível
  -- da onda é o MAIOR das duas pernas (cabeçalho da 20261001120000).
  v_lead_costura := GREATEST(v_lead_cost_palm, v_lead_cost_cab);
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk;
  v_seq_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_block2_max := GREATEST(v_lead_costura, v_lead_mesa);
  v_block2_start := add_business_days(v_seq_start, -v_block2_max)::date;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao);
  v_earliest_prep := add_business_days(v_block2_start, -v_lead_prep_max)::date;
  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end := v_deadline;
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2);
  IF v_pickup_tue >= v_pickup_fri THEN v_pickup_tue := v_pickup_fri - 3; END IF;
  RETURN QUERY SELECT v_deadline,
    add_business_days(v_block2_start, -v_lead_palmilha)::date,
    add_business_days(v_block2_start, -v_lead_forracao)::date,
    add_business_days(v_seq_start, -v_lead_costura)::date,
    add_business_days(v_seq_start, -v_lead_mesa)::date,
    v_seq_start,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem + v_lead_montagem))::date,
    add_business_days(v_deadline, -(v_lead_acab + v_lead_solagem))::date,
    v_acab_start, v_acab_end, v_pickup_tue, v_pickup_fri,
    add_business_days(v_earliest_prep, -v_lead_buffer)::date,
    add_business_days(v_earliest_prep, -(v_lead_buffer + v_lead_supplier))::date;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_min_billing_date(p_sale_order_id uuid)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int := 0; v_lead_forracao int := 0; v_lead_costura int := 0; v_lead_mesa int := 0;
  v_lead_cost_palm int := 0; v_lead_cost_cab int := 0;
  v_lead_silk int := 0; v_lead_colagem int := 0; v_lead_montagem int := 0; v_lead_solagem int := 0;
  v_lead_acab int := 0; v_lead_buffer int := 0; v_lead_supplier int := 0;
  v_total_business_days int := 0; v_raw_date date; v_next_tue date; v_next_fri date;
BEGIN
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    -- Split da Costura (20261001120000): lead POR PERNA, capacidade nova com
    -- fallback na legada (espelho de src/lib/leadTime.ts). 'costura' legado no
    -- roteiro conta como palmilha (mesma regra do trg_normalize).
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) IN ('costura palmilha','costura'))
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_palmilha_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE LOWER(TRIM(x.value)) = 'costura cabedal')
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), NULLIF(ts.costura_capacity_per_day,0), NULLIF(dlt.costura_cabedal_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
      THEN CASE WHEN COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
      THEN CASE WHEN COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END), 2),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
      THEN CASE WHEN COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric)::int)
          ELSE 1 END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric)::int)
        ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_cost_palm, v_lead_cost_cab, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;
  IF v_lead_palmilha IS NULL THEN RETURN NULL; END IF;
  -- F3-5 v2: mesmo gate canônico do compute_wave_timeline — derivado da
  -- get_wave_material_needs_core (cor/variante/grade/dm²→física/reservas
  -- próprias), fechando o falso-positivo POR COR da soma crua de
  -- sheet_materials. ⚠ Chamar a _CORE, NUNCA get_wave_material_needs (o
  -- wrapper chama compute_wave_timeline → recursão mútua 54001 — incidente da
  -- v1/20260920160000, revertida). conversion_warning não aciona o lead;
  -- artesanal aciona pelo produto BASE.
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs_core(ARRAY[p_sale_order_id], NULL) n;
  -- A6/M8: dois blocos SEQUENCIAIS de preparo (cortes → costuras ‖ aviamento),
  -- espelhando computeForwardSchedule (sectorCapacity.ts).
  v_lead_costura := GREATEST(v_lead_cost_palm, v_lead_cost_cab);
  v_total_business_days := COALESCE(v_lead_supplier, 0) + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao)
    + GREATEST(v_lead_costura, v_lead_mesa)
    + COALESCE(v_lead_silk, 0) + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2) + COALESCE(v_lead_solagem, 0) + COALESCE(v_lead_acab, 1);
  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$function$;

CREATE OR REPLACE VIEW public.purchase_projection_timeline AS
 WITH lt AS (
         SELECT o.id AS order_id,
            o.order_number AS pedido_ref,
            o.sale_order_id,
            so.delivery_deadline AS data_entrega_cliente,
            o.quantity AS op_quantity,
            o.status AS order_status,
            o.reference_id,
            ts.name AS referencia_nome,
            ts.id AS sheet_id,
            ts.shoe_category AS sheet_category,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'corte_palmilha'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day)::numeric)::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 1)
                    END
                    ELSE 0
                END AS lead_time_palmilha_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'corte_forracao'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day)::numeric)::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 2)
                    END
                    ELSE 0
                END AS lead_time_forracao_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'mesa'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity)::numeric)::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_mesa_dias,
                -- A6/M8 (split da Costura, 20261001120000): lead da "fase
                -- costura" = MAIOR das duas pernas (palmilha ‖ cabedal), cada
                -- uma com capacidade nova e fallback na legada. 'costura'
                -- legado no roteiro conta como palmilha.
                GREATEST(
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE lower(btrim(x.value)) = ANY (ARRAY['costura palmilha'::text, 'costura'::text]))) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day, 0)::numeric, NULLIF(ts.costura_capacity_per_day, 0::numeric), NULLIF(dlt.costura_palmilha_capacity_per_day, 0)::numeric, dlt.costura_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day, 0)::numeric, NULLIF(ts.costura_capacity_per_day, 0::numeric), NULLIF(dlt.costura_palmilha_capacity_per_day, 0)::numeric, dlt.costura_capacity_per_day))::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0), dlt.lead_time_costura_dias, 1)
                    END
                    ELSE 0
                END,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE lower(btrim(x.value)) = 'costura cabedal'::text)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day, 0)::numeric, NULLIF(ts.costura_capacity_per_day, 0::numeric), NULLIF(dlt.costura_cabedal_capacity_per_day, 0)::numeric, dlt.costura_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day, 0)::numeric, NULLIF(ts.costura_capacity_per_day, 0::numeric), NULLIF(dlt.costura_cabedal_capacity_per_day, 0)::numeric, dlt.costura_capacity_per_day))::integer)
                        ELSE COALESCE(NULLIF(ts.lead_time_costura_dias, 0), dlt.lead_time_costura_dias, 1)
                    END
                    ELSE 0
                END) AS lead_time_costura_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'silk'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_silk_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'colagem'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_colagem_dias,
                CASE
                    WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(NULLIF(ts.lead_time_montagem_dias, 0), dlt.lead_time_montagem_dias, 2)
                END AS lead_time_montagem_dias,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x(value)
                      WHERE sector_display_to_enum(x.value) = 'solagem'::production_stage_enum)) THEN
                    CASE
                        WHEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0)::numeric, dlt.soling_capacity_per_day, 0::numeric) > 0::numeric THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day, 0)::numeric, dlt.soling_capacity_per_day))::integer)
                        ELSE 1
                    END
                    ELSE 0
                END AS lead_time_solagem_dias,
                CASE
                    WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day, 0) > 0 THEN GREATEST(1, ceil(o.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day)::numeric)::integer)
                    ELSE COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0), dlt.lead_time_acabamento_dias, 1)
                END AS lead_time_acabamento_dias,
            COALESCE(NULLIF(ts.lead_time_buffer_material_dias, 0), dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
           FROM orders o
             JOIN sale_orders so ON so.id = o.sale_order_id
             JOIN technical_sheets ts ON ts.id = o.reference_id
             LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
          WHERE (o.status <> ALL (ARRAY['Pronto'::text, 'FINALIZADO'::text, 'Cancelado'::text])) AND so.delivery_deadline IS NOT NULL
        ), lt2 AS (
         -- A6/M8: topologia em DOIS blocos do compute_wave_timeline (espelho
         -- de sectorCapacity.ts): d_silk = início do Silk (fim do bloco 2 —
         -- Costura Palmilha ‖ Costura Cabedal ‖ Aviamento); bloco2_max = maior
         -- lead do bloco 2; prep_max = cadeia completa de preparo (bloco 1 —
         -- Corte Palmilha ‖ Corte Forração — vem ANTES do bloco 2).
         SELECT lt.*,
            public.add_business_days(lt.data_entrega_cliente,
              -(lt.lead_time_acabamento_dias + lt.lead_time_solagem_dias + lt.lead_time_montagem_dias + lt.lead_time_colagem_dias + lt.lead_time_silk_dias))::date AS d_silk,
            GREATEST(lt.lead_time_costura_dias, lt.lead_time_mesa_dias) AS bloco2_max,
            GREATEST(lt.lead_time_costura_dias, lt.lead_time_mesa_dias)
              + GREATEST(lt.lead_time_palmilha_dias, lt.lead_time_forracao_dias) AS prep_max
           FROM lt
        ), rows_mat AS (
         SELECT lt2.*,
            m.id AS material_id,
            m.name AS material,
            m.group_id AS material_group_id,
            pg.name AS grupo_material,
            m.unit AS unidade,
            GREATEST(0::numeric, m.quantity - COALESCE(m.reserved_stock, 0::numeric)) AS estoque_atual,
            m.quantity AS estoque_bruto,
            COALESCE(m.reserved_stock, 0::numeric) AS estoque_reservado,
            m.min_stock,
            m.supplier_id,
            sup.name AS supplier_name,
            m.supplier_lead_time_days AS material_lead_time_raw,
            sup.lead_time_days AS supplier_lead_time_raw,
            -- F3-4: MESMA fonte de lead do compute_wave_timeline (OC aberta >
            -- grupo > produto > 10) em vez de COALESCE(sup, produto, 10).
            public.get_effective_supplier_lead_days(m.id, NULL) AS supplier_lead_time_days,
            COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric AS quantidade_necessaria_bruta,
                CASE
                    WHEN (conv.target_unit = ANY (ARRAY['m'::text, 'meters'::text, 'metros'::text, 'mt'::text, 'cm'::text])) AND conv.conversion_warning IS NULL AND COALESCE(conv.dm2_per_unit, 0::numeric) > 0::numeric THEN 'linear'::text
                    WHEN (lower(m.unit) = ANY (ARRAY['placa'::text, 'placas'::text])) AND COALESCE(plate.area_dm2, 0::numeric) > 0::numeric THEN 'placa'::text
                    ELSE 'none'::text
                END AS conversao_dm2,
                CASE
                    WHEN (conv.target_unit = ANY (ARRAY['m'::text, 'meters'::text, 'metros'::text, 'mt'::text, 'cm'::text])) AND conv.conversion_warning IS NULL AND COALESCE(conv.dm2_per_unit, 0::numeric) > 0::numeric THEN COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric / conv.dm2_per_unit * (1::numeric + COALESCE(conv.waste_pct, 0::numeric) / 100::numeric)
                    WHEN (lower(m.unit) = ANY (ARRAY['placa'::text, 'placas'::text])) AND COALESCE(plate.area_dm2, 0::numeric) > 0::numeric THEN COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric / plate.area_dm2 * (1::numeric + COALESCE(conv.waste_pct, 0::numeric) / 100::numeric)
                    ELSE COALESCE(sm.quantity_per_unit, 1::numeric) * lt2.op_quantity::numeric
                END AS quantidade_necessaria
           FROM lt2
             JOIN sheet_materials sm ON sm.sheet_id = lt2.reference_id
             JOIN products m ON m.id = sm.product_id
             LEFT JOIN product_groups pg ON pg.id = m.group_id
             LEFT JOIN suppliers sup ON sup.id = m.supplier_id
             LEFT JOIN LATERAL get_material_conversion_info(m.id) conv(dm2_per_unit, waste_pct, target_unit, conversion_warning) ON true
             LEFT JOIN LATERAL ( SELECT
                        CASE lower(cs.dimensions_unit)
                            WHEN 'cm'::text THEN cs.dimensions_width * 10::numeric
                            WHEN 'm'::text THEN cs.dimensions_width * 1000::numeric
                            ELSE cs.dimensions_width
                        END *
                        CASE lower(cs.dimensions_unit)
                            WHEN 'cm'::text THEN cs.dimensions_length * 10::numeric
                            WHEN 'm'::text THEN cs.dimensions_length * 1000::numeric
                            ELSE cs.dimensions_length
                        END / 10000.0 AS area_dm2
                   FROM component_sheets cs
                  WHERE (cs.product_id = m.id OR cs.group_id = m.group_id) AND COALESCE(cs.dimensions_width, 0::numeric) > 0::numeric AND COALESCE(cs.dimensions_length, 0::numeric) > 0::numeric
                  ORDER BY (cs.product_id = m.id) DESC
                 LIMIT 1) plate ON true
        )
 SELECT r.order_id,
    r.pedido_ref,
    r.sale_order_id,
    r.data_entrega_cliente,
    r.op_quantity,
    r.order_status,
    r.reference_id,
    r.referencia_nome,
    r.lead_time_palmilha_dias,
    r.lead_time_forracao_dias,
    r.lead_time_mesa_dias,
    r.lead_time_costura_dias,
    r.lead_time_silk_dias,
    r.lead_time_colagem_dias,
    r.lead_time_montagem_dias,
    r.lead_time_solagem_dias,
    r.lead_time_acabamento_dias,
    r.lead_time_buffer_material_dias,
    r.lead_time_forracao_dias AS lead_time_corte_dias,
    public.add_business_days(r.data_entrega_cliente, -r.lead_time_acabamento_dias)::date AS data_inicio_acabamento,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias))::date AS data_inicio_solagem,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias + r.lead_time_montagem_dias))::date AS data_inicio_montagem,
    public.add_business_days(r.data_entrega_cliente, -(r.lead_time_acabamento_dias + r.lead_time_solagem_dias + r.lead_time_montagem_dias + r.lead_time_colagem_dias))::date AS data_inicio_colagem,
    r.d_silk AS data_inicio_silk,
    -- Bloco 2 (costuras ‖ aviamento) termina no início do Silk; bloco 1
    -- (cortes) termina no início do bloco 2 — como na wave pós-split.
    public.add_business_days(r.d_silk, -r.lead_time_costura_dias)::date AS data_inicio_costura,
    public.add_business_days(public.add_business_days(r.d_silk, -r.bloco2_max)::date, -r.lead_time_forracao_dias)::date AS data_inicio_corte,
    public.add_business_days(public.add_business_days(r.d_silk, -r.bloco2_max)::date, -r.lead_time_palmilha_dias)::date AS data_inicio_palmilha,
    public.add_business_days(r.d_silk, -r.lead_time_mesa_dias)::date AS data_inicio_mesa,
    public.add_business_days(r.d_silk, -r.prep_max)::date AS data_chegada_material,
    r.supplier_lead_time_days,
    r.material_lead_time_raw,
    r.supplier_lead_time_raw,
    -- Âncora canônica (= purchase_deadline da wave, por OP×material):
    -- chegada do material − buffer − lead do fornecedor SÓ quando a
    -- necessidade convertida excede o estoque líquido (gate de shortage).
    public.add_business_days(
      public.add_business_days(r.d_silk, -r.prep_max)::date,
      -(r.lead_time_buffer_material_dias
        + CASE WHEN r.quantidade_necessaria > r.estoque_atual THEN r.supplier_lead_time_days ELSE 0 END)
    )::date AS data_limite_compra,
    r.material_id,
    r.material,
    r.material_group_id,
    r.grupo_material,
    r.unidade,
    r.estoque_atual,
    r.estoque_bruto,
    r.estoque_reservado,
    r.min_stock,
    r.supplier_id,
    r.supplier_name,
    r.quantidade_necessaria_bruta,
    r.conversao_dm2,
    r.quantidade_necessaria
   FROM rows_mat r;
