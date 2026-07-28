-- Costura passa a somar duas etapas sequenciais: Cabedal + Palmilha.
-- Não-regressão: enquanto a capacidade de Palmilha estiver vazia/zero, somente
-- Cabedal contribui, com a mesma cadeia de fallback da capacidade única e do
-- lead legado que a função anterior usava.
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
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
        AND COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_palmilha')
        AND NOT (COALESCE(NULLIF(ts.sewing_capacity_per_day,0), dlt.sewing_capacity_per_day, 0) > 0)
        THEN COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 1) END)
    ), 1),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
        AND COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'corte_forracao')
        AND NOT (COALESCE(NULLIF(ts.cutting_capacity_per_day,0), dlt.cutting_capacity_per_day, 0) > 0)
        THEN COALESCE(NULLIF(ts.lead_time_corte_dias,0), dlt.lead_time_corte_dias, 2) END)
    ), 0),
    -- COSTURA = cabedal (com fallback pro cap único/legado) + palmilha (aditivo)
    (
      COALESCE(GREATEST(
        CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
          AND COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), dlt.costura_cabedal_capacity_per_day, NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0
          THEN soi.quantity::numeric / COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), dlt.costura_cabedal_capacity_per_day, NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day)::numeric END))::int,
        MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
          AND NOT (COALESCE(NULLIF(ts.costura_cabedal_capacity_per_day,0), dlt.costura_cabedal_capacity_per_day, NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0)
          THEN COALESCE(NULLIF(ts.lead_time_costura_dias,0), dlt.lead_time_costura_dias, 1) END)
      ), 0)
      +
      COALESCE(CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'costura')
        AND COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), dlt.costura_palmilha_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.costura_palmilha_capacity_per_day,0), dlt.costura_palmilha_capacity_per_day)::numeric END))::int, 0)
    ),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
        AND COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'mesa')
        AND NOT (COALESCE(NULLIF(ts.mesa_daily_capacity,0), dlt.mesa_daily_capacity, 0) > 0)
        THEN 1 END)
    ), 0),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
        AND COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'silk')
        AND NOT (COALESCE(NULLIF(ts.silk_capacity_per_day,0), dlt.silk_capacity_per_day, 0) > 0)
        THEN 1 END)
    ), 0),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
        AND COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'colagem')
        AND NOT (COALESCE(NULLIF(ts.gluing_capacity_per_day,0), dlt.gluing_capacity_per_day, 0) > 0)
        THEN 1 END)
    ), 0),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN NOT (COALESCE(NULLIF(ts.assembly_capacity_per_day,0), dlt.assembly_capacity_per_day, 0) > 0)
        THEN COALESCE(NULLIF(ts.lead_time_montagem_dias,0), dlt.lead_time_montagem_dias, 2) END)
    ), 2),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
        AND COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors,'[]'::jsonb)) x WHERE sector_display_to_enum(x.value) = 'solagem')
        AND NOT (COALESCE(NULLIF(ts.soling_capacity_per_day,0), dlt.soling_capacity_per_day, 0) > 0)
        THEN 1 END)
    ), 0),
    COALESCE(GREATEST(
      CEIL(SUM(CASE WHEN COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0
        THEN soi.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day)::numeric END))::int,
      MAX(CASE WHEN NOT (COALESCE(NULLIF(ts.finishing_capacity_per_day,0), dlt.finishing_capacity_per_day, 0) > 0)
        THEN COALESCE(NULLIF(ts.lead_time_acabamento_dias,0), dlt.lead_time_acabamento_dias, 1) END)
    ), 1),
    COALESCE(MAX(COALESCE(NULLIF(ts.lead_time_buffer_material_dias,0), dlt.lead_time_buffer_material_dias, 2)), 2)
  INTO v_lead_palmilha, v_lead_forracao, v_lead_costura, v_lead_mesa,
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
