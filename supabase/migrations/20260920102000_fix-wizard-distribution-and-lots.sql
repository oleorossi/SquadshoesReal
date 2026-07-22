-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria de motores — Fase 2 — Pacote P1
-- F1-04: Wizard (auto_fill_sector_distribution) alocava pares em setores que o
--         modelo NÃO tem no roteiro e bucketava TODA a demanda na semana da
--         ENTREGA (sem a defasagem da cascata — o Corte de uma OP que entrega
--         dia 30 caía na semana do dia 30, enquanto o motor de ondas manda
--         cortar 2–3 semanas antes)
-- F1-11: split_order_into_lots usava get_sheet_bottleneck_capacity SÓ com a
--         ficha (default 100 quando vazia) — cadeia de capacidade diferente do
--         motor de ondas (ficha > default_lead_times), gerando lotes/datas que
--         contam histórias diferentes
-- ════════════════════════════════════════════════════════════════════════════

-- ── F1-04 (a): v_sector_load_by_reference — gating pelo roteiro ─────────────
-- Cap de setor AUSENTE de technical_sheets.production_sectors vira 0 (o
-- auto_fill pula cap 0). Montagem/Acabamento nunca são gated (sempre presentes,
-- paridade com compute_wave_timeline). Roteiro vazio/NULL não gateia nada
-- (mesma semântica do motor de recompute: sem roteiro → todos os setores).
-- Colunas/nomes/ordem preservados (useSectorDistribution lê '*').

CREATE OR REPLACE VIEW public.v_sector_load_by_reference AS
WITH planned_orders AS (
  SELECT o.reference_id AS tech_sheet_id,
         o.quantity AS qty,
         o.planned_delivery,
         date_trunc('week'::text, o.planned_delivery::timestamp with time zone)::date AS week_start
    FROM orders o
   WHERE (o.status <> ALL (ARRAY['Cancelado'::text, 'Concluído'::text, 'Concluida'::text, 'Entregue'::text, 'Expedido'::text]))
     AND o.planned_delivery IS NOT NULL
     AND o.quantity > 0
), by_ref AS (
  SELECT po.tech_sheet_id,
         po.week_start,
         SUM(po.qty)::integer AS total_qty,
         COUNT(*)::integer AS op_count
    FROM planned_orders po
   GROUP BY po.tech_sheet_id, po.week_start
)
SELECT br.tech_sheet_id,
  br.week_start,
  br.total_qty,
  br.op_count,
  ts.code AS reference_code,
  ts.name AS reference_name,
  ts.shoe_category,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'corte_palmilha')
       THEN COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day, 0)
       ELSE 0 END AS cap_corte_palmilha,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'corte_forracao')
       THEN COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day, 0)
       ELSE 0 END AS cap_corte_forracao,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'costura')
       THEN COALESCE(NULLIF(ts.costura_capacity_per_day, 0::numeric), dlt.costura_capacity_per_day, 0::numeric)::integer
       ELSE 0 END AS cap_costura,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'mesa')
       THEN COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity, 0)
       ELSE 0 END AS cap_aviamento,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'silk')
       THEN COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day, 0::numeric)::integer
       ELSE 0 END AS cap_silk,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'colagem')
       THEN COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day, 0::numeric)::integer
       ELSE 0 END AS cap_colagem,
  -- Montagem/Acabamento: sempre presentes (sem gating — paridade com o wave engine)
  COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day, 0) AS cap_montagem,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'solagem')
       THEN COALESCE(NULLIF(ts.soling_capacity_per_day, 0)::numeric, dlt.soling_capacity_per_day, 0::numeric)::integer
       ELSE 0 END AS cap_solagem,
  COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day, 0) AS cap_acabamento,
  CASE WHEN jsonb_array_length(COALESCE(ts.production_sectors, '[]'::jsonb)) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE public.sector_display_to_enum(x.value) = 'expedicao')
       THEN COALESCE(NULLIF(ts.expedition_capacity_per_day, 0::numeric), dlt.expedition_capacity_per_day::numeric, 0::numeric)::integer
       ELSE 0 END AS cap_expedicao,
  CASE
    WHEN ts.cutting_capacity_per_day IS NOT NULL AND ts.cutting_capacity_per_day > 0 THEN 'ficha'::text
    WHEN dlt.cutting_capacity_per_day IS NOT NULL THEN 'categoria'::text
    ELSE 'nenhuma'::text
  END AS capacity_source
FROM by_ref br
  JOIN technical_sheets ts ON ts.id = br.tech_sheet_id
  LEFT JOIN default_lead_times dlt ON dlt.shoe_category = ts.shoe_category;

COMMENT ON VIEW public.v_sector_load_by_reference IS
  'Demanda planejada por (referência, semana da ENTREGA) com capacidades por setor (ficha > default_lead_times), agora GATED pelo roteiro da ficha (production_sectors): setor ausente → cap 0 (Montagem/Acabamento sempre presentes). A semana aqui é a da entrega — para o faseamento por setor use v_sector_weekly_load.';

GRANT SELECT ON public.v_sector_load_by_reference TO authenticated;

-- ── F1-04 (b): auto_fill_sector_distribution — semana-alvo pela CASCATA ─────
-- Antes: demanda de TODOS os setores vinha de v_sector_load_by_reference
-- (bucket = semana da entrega). Agora os 9 setores de produção puxam de
-- v_sector_weekly_load (janela do setor derivada da MESMA cascata do
-- compute_wave_timeline — mig 20260920101000): o Corte Palmilha de uma OP que
-- entrega dia 30 cai na semana em que o motor de ondas manda cortar.
-- Expedição não é modelada na cascata (acontece junto da entrega) → mantém a
-- fonte por semana de entrega (v_sector_load_by_reference, cap agora gated).
-- Gating por roteiro vem de graça: a weekly_load só emite setor presente no
-- roteiro. Contrato de retorno (jsonb) inalterado (useSectorDistribution).

CREATE OR REPLACE FUNCTION public.auto_fill_sector_distribution(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sector text;
  v_record record;
  v_day int;
  v_remaining int;
  v_cap_today int;
  v_alloc int;
  v_day_used int;
  v_bottlenecks jsonb := '[]'::jsonb;
  v_inserts int := 0;
  v_locked_kept int := 0;
BEGIN
  DELETE FROM public.sector_distribution_plan
   WHERE week_start = p_week_start AND is_locked = false AND source = 'auto';

  FOR v_sector IN
    SELECT DISTINCT sector_unnest
      FROM (
        SELECT unnest(ARRAY[
          'Corte Palmilha','Corte Forração','Costura','Aviamento','Silk',
          'Colagem','Montagem','Solagem','Acabamento','Expedição'
        ]) AS sector_unnest
      ) sectors
  LOOP
    FOR v_record IN
      SELECT q.tech_sheet_id, q.total_qty, q.daily_cap
        FROM (
          -- Setores de PRODUÇÃO: demanda na semana em que a cascata do motor
          -- de ondas coloca a janela do setor (roteiro-gated, ficha > dlt,
          -- dias úteis). capacity_per_day da view = cap efetiva (ou taxa
          -- implícita ceil(qty/lead) quando só há lead legado).
          SELECT wl.sheet_id AS tech_sheet_id,
                 SUM(wl.quantity)::int AS total_qty,
                 GREATEST(1, MAX(wl.capacity_per_day))::int AS daily_cap
            FROM public.v_sector_weekly_load wl
           WHERE v_sector <> 'Expedição'
             AND wl.week_start = p_week_start
             AND wl.sector = public.sector_display_to_enum(v_sector)::text
           GROUP BY wl.sheet_id
          UNION ALL
          -- Expedição: semana da entrega (não modelada na cascata)
          SELECT slbr.tech_sheet_id,
                 slbr.total_qty,
                 slbr.cap_expedicao AS daily_cap
            FROM public.v_sector_load_by_reference slbr
           WHERE v_sector = 'Expedição'
             AND slbr.week_start = p_week_start
        ) q
       ORDER BY q.total_qty DESC
    LOOP
      IF v_record.daily_cap IS NULL OR v_record.daily_cap = 0 THEN CONTINUE; END IF;
      v_remaining := v_record.total_qty;
      v_day := 1;
      WHILE v_remaining > 0 AND v_day <= 5 LOOP
        SELECT COALESCE(SUM(pairs_planned), 0) INTO v_day_used
          FROM public.sector_distribution_plan
         WHERE week_start = p_week_start AND sector = v_sector AND day_of_week = v_day;
        v_cap_today := GREATEST(0, v_record.daily_cap - v_day_used);
        v_alloc := LEAST(v_remaining, v_cap_today);
        IF v_alloc > 0 THEN
          INSERT INTO public.sector_distribution_plan
            (week_start, sector, tech_sheet_id, day_of_week, pairs_planned, source)
          VALUES (p_week_start, v_sector, v_record.tech_sheet_id, v_day, v_alloc, 'auto');
          v_inserts := v_inserts + 1;
          v_remaining := v_remaining - v_alloc;
        END IF;
        v_day := v_day + 1;
      END LOOP;
      IF v_remaining > 0 THEN
        v_bottlenecks := v_bottlenecks || jsonb_build_object(
          'sector', v_sector,
          'tech_sheet_id', v_record.tech_sheet_id,
          'unallocated_pairs', v_remaining,
          'requested_pairs', v_record.total_qty,
          'daily_capacity', v_record.daily_cap
        );
      END IF;
    END LOOP;
  END LOOP;

  SELECT COUNT(*)::int INTO v_locked_kept
    FROM public.sector_distribution_plan
   WHERE week_start = p_week_start AND is_locked = true;

  RETURN jsonb_build_object(
    'week_start', p_week_start,
    'inserts', v_inserts,
    'locked_preserved', v_locked_kept,
    'bottlenecks', v_bottlenecks,
    'algorithm', 'greedy_by_qty_desc_v2_cascade_weeks'
  );
END;
$function$;

-- ── F1-11: get_sheet_bottleneck_capacity — cadeia ficha > default_lead_times ─
-- Antes: só colunas da ficha, retornando 100 quando nada cadastrado — enquanto
-- o motor de ondas cai no default da categoria (150–550). Com 40/51 fichas sem
-- caps, o split quebrava OP grande em lotes de ~100/dia enquanto o timeline da
-- onda assumia 2–4 dias. Agora cada setor usa COALESCE(ficha, dlt) — a MESMA
-- cadeia do compute_wave_timeline. O default 100 permanece só como último
-- recurso (sem ficha OU sem nenhuma capacidade em nenhum nível).
-- split_order_into_lots e v_order_split_suggestions herdam o fix (chamam esta
-- função em tempo real).

CREATE OR REPLACE FUNCTION public.get_sheet_bottleneck_capacity(p_sheet_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ts record;
  v_sectors jsonb;
  v_min int := 1000000;
  v_cap int;
  v_dlt_sewing int; v_dlt_cutting int; v_dlt_costura int; v_dlt_mesa int;
  v_dlt_silk int; v_dlt_gluing int; v_dlt_assembly int; v_dlt_finishing int;
  v_dlt_soling int;
BEGIN
  SELECT * INTO v_ts FROM public.technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RETURN 100; END IF;

  -- Fallback por categoria (mesma cadeia ficha > default_lead_times do motor de ondas)
  SELECT dlt.sewing_capacity_per_day, dlt.cutting_capacity_per_day,
         dlt.costura_capacity_per_day::int, dlt.mesa_daily_capacity,
         dlt.silk_capacity_per_day::int, dlt.gluing_capacity_per_day::int,
         dlt.assembly_capacity_per_day, dlt.finishing_capacity_per_day,
         dlt.soling_capacity_per_day::int
    INTO v_dlt_sewing, v_dlt_cutting, v_dlt_costura, v_dlt_mesa,
         v_dlt_silk, v_dlt_gluing, v_dlt_assembly, v_dlt_finishing,
         v_dlt_soling
    FROM public.default_lead_times dlt
   WHERE dlt.shoe_category = v_ts.shoe_category;

  v_sectors := COALESCE(v_ts.production_sectors, '[]'::jsonb);

  IF v_sectors @> '["Corte Palmilha"]'::jsonb OR v_sectors @> '["Corte"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.sewing_capacity_per_day, 0), NULLIF(v_dlt_sewing, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Corte Forracao"]'::jsonb OR v_sectors @> '["Corte Forração"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.cutting_capacity_per_day, 0), NULLIF(v_dlt_cutting, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Costura"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.costura_capacity_per_day, 0)::int, NULLIF(v_dlt_costura, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Mesa"]'::jsonb OR v_sectors @> '["Aviamento"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.mesa_daily_capacity, 0), NULLIF(v_dlt_mesa, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Silk"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.silk_capacity_per_day, 0)::int, NULLIF(v_dlt_silk, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Colagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.gluing_capacity_per_day, 0)::int, NULLIF(v_dlt_gluing, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  v_cap := COALESCE(NULLIF(v_ts.assembly_capacity_per_day, 0), NULLIF(v_dlt_assembly, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  v_cap := COALESCE(NULLIF(v_ts.finishing_capacity_per_day, 0), NULLIF(v_dlt_finishing, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  IF v_sectors @> '["Solagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.soling_capacity_per_day, 0)::int, NULLIF(v_dlt_soling, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;

  IF v_min = 1000000 THEN RETURN 100; END IF;
  RETURN GREATEST(v_min, 1);
END;
$function$;
