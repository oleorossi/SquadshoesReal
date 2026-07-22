-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria de motores — Fase 3 (complemento do F3-5, pós-verificação)
-- O gate de lead de fornecedor de compute_wave_timeline/compute_min_billing_date
-- passa a derivar de get_wave_material_needs (motor canônico: cor/variante/grade/
-- conversão dm²→física + devolução de reservas próprias, pós F3-3/F3-10) em vez
-- da soma crua de sheet_materials — fecha o falso-positivo POR COR que a mig
-- 20260920121000 não cobria (a perna dm² já estava fechada).
-- Base: definição VIVA de 2026-07-22 (= 20260920100000 + gate da 20260920121000);
-- diff = somente o bloco INTO v_lead_supplier nas duas funções. Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
 RETURNS TABLE(earliest_deadline date, corte_palmilha_start_date date, corte_forracao_start_date date, costura_start_date date, mesa_start_date date, silk_start_date date, colagem_start_date date, montagem_start_date date, solagem_start_date date, acabamento_start_date date, acabamento_end_date date, pickup_tuesday_date date, pickup_friday_date date, material_ready_date date, purchase_deadline date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_palmilha int; v_lead_forracao int; v_lead_costura int; v_lead_mesa int;
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
          -- F1-08: fallback legado correto do Corte Palmilha é lead_time_corte_dias
          -- (fix TS de 2026-05-23 replicado aqui; antes lia lead_time_costura_dias)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 1),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      -- F1-01: Costura agora usa a MESMA cadeia dos demais setores
      -- (cap da ficha > cap da categoria > lead legado ficha > lead legado categoria > 1)
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
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
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  -- F3-5 (complemento pós-verificação Fase 3): o gate de lead de fornecedor
  -- deriva do MOTOR CANÔNICO get_wave_material_needs — que resolve cor/variante/
  -- grade, converte dm²→unidade física e devolve as reservas dos próprios PVs —
  -- em vez de somar sheet_materials cru por product_id (a soma crua cobrava o
  -- total do PV contra CADA cor de solado da BOM e recuava purchase_deadline em
  -- até 21 dias úteis à toa; caso real: PV-00146, 7 solados-por-cor × 2.808
  -- pares). Regras: conversion_warning não aciona o gate; item artesanal usa a
  -- falta da BASE (a tira é produzida internamente, o lead é do material-base).
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs(p_sale_order_ids) n;
  v_post_prep := v_lead_acab + v_lead_solagem + v_lead_montagem + v_lead_colagem + v_lead_silk;
  v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura);
  v_seq_start := add_business_days(v_deadline, -v_post_prep)::date;
  v_earliest_prep := add_business_days(v_seq_start, -v_lead_prep_max)::date;
  v_acab_start := add_business_days(v_deadline, -v_lead_acab)::date;
  v_acab_end := v_deadline;
  v_pickup_fri := public.next_dow(v_acab_end, 5);
  v_pickup_tue := public.next_dow(add_business_days(v_acab_start, GREATEST(1, v_lead_acab/2))::date, 2);
  IF v_pickup_tue >= v_pickup_fri THEN v_pickup_tue := v_pickup_fri - 3; END IF;
  RETURN QUERY SELECT v_deadline,
    add_business_days(v_seq_start, -v_lead_palmilha)::date,
    add_business_days(v_seq_start, -v_lead_forracao)::date,
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
  v_lead_silk int := 0; v_lead_colagem int := 0; v_lead_montagem int := 0; v_lead_solagem int := 0;
  v_lead_acab int := 0; v_lead_buffer int := 0; v_lead_supplier int := 0;
  v_total_business_days int := 0; v_raw_date date; v_next_tue date; v_next_fri date;
BEGIN
  SELECT
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
      THEN CASE WHEN COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric)::int)
          -- F1-08: mesmo fix do compute_wave_timeline (lead_time_corte_dias)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
      THEN CASE WHEN COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric)::int)
          ELSE COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END
      ELSE 0 END), 0),
    COALESCE(MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
      -- F1-01: mesma cadeia ficha > default_lead_times > lead legado do wave engine
      THEN CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN GREATEST(1, CEIL(soi.quantity::numeric / COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric)::int)
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
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
       v_lead_silk, v_lead_colagem, v_lead_montagem, v_lead_solagem, v_lead_acab, v_lead_buffer
  FROM sale_order_items soi
  JOIN technical_sheets ts ON ts.id = soi.reference_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE soi.sale_order_id = p_sale_order_id;
  IF v_lead_palmilha IS NULL THEN RETURN NULL; END IF;
  -- F3-5 (complemento pós-verificação Fase 3): o gate de lead de fornecedor
  -- deriva do MOTOR CANÔNICO get_wave_material_needs — que resolve cor/variante/
  -- grade, converte dm²→unidade física e devolve as reservas dos próprios PVs —
  -- em vez de somar sheet_materials cru por product_id (a soma crua cobrava o
  -- total do PV contra CADA cor de solado da BOM e recuava purchase_deadline em
  -- até 21 dias úteis à toa; caso real: PV-00146, 7 solados-por-cor × 2.808
  -- pares). Regras: conversion_warning não aciona o gate; item artesanal usa a
  -- falta da BASE (a tira é produzida internamente, o lead é do material-base).
  SELECT COALESCE(MAX(CASE
           WHEN n.conversion_warning IS NOT NULL THEN 0
           WHEN COALESCE(n.is_artisanal, false) THEN
             CASE WHEN COALESCE(n.base_shortage, 0) > 0 AND n.base_product_id IS NOT NULL
                  THEN public.get_effective_supplier_lead_days(n.base_product_id, NULL) ELSE 0 END
           WHEN COALESCE(n.shortage, 0) > 0
             THEN public.get_effective_supplier_lead_days(n.product_id, NULL)
           ELSE 0 END), 0)
    INTO v_lead_supplier
    FROM public.get_wave_material_needs(ARRAY[p_sale_order_id]) n;
  -- Costura roda em PARALELO com Corte Palmilha/Corte Forração/Mesa (decisão 2026-06-28,
  -- já refletida em compute_wave_timeline) — entra no GREATEST junto dos outros preps,
  -- não mais somada depois. Mantém paridade entre as duas engines de prazo.
  v_total_business_days := COALESCE(v_lead_supplier, 0) + COALESCE(v_lead_buffer, 2)
    + GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura)
    + COALESCE(v_lead_silk, 0) + COALESCE(v_lead_colagem, 0)
    + COALESCE(v_lead_montagem, 2) + COALESCE(v_lead_solagem, 0) + COALESCE(v_lead_acab, 1);
  v_raw_date := public.add_business_days(CURRENT_DATE, v_total_business_days)::date;
  v_next_tue := public.next_dow(v_raw_date, 2);
  v_next_fri := public.next_dow(v_raw_date, 5);
  RETURN LEAST(v_next_tue, v_next_fri);
END;
$function$;
