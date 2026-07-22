-- ════════════════════════════════════════════════════════════════════════════
-- Auditoria de motores — Fase 2 — Pacote P1
-- F1-02: /gargalos + detect_wave_capacity_overflow rodavam num motor legado
--         (4 setores, janelas em dias CORRIDOS, caps hardcoded 300/275/500/450)
-- F1-03: v_capacity_driven_lead_times somava tudo sequencial (sem paralelismo),
--         sem Costura/Solagem/Aviamento, com aliases cruzados (sewing→"forracao")
--         e v_sector_load fazia join errado (product_references — 0/244 casam;
--         tudo caía em 'Geral' e as cargas viravam 0)
-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 1 — v_sector_weekly_load + v_sector_bottlenecks
--
-- A view agora deriva as janelas da MESMA cascata do compute_wave_timeline:
--   • leads por setor via cadeia ficha > default_lead_times (categoria) > lead
--     legado — idêntico ao motor de ondas (pós-fix F1-01/F1-08 da mig
--     20260920100000) e ao TS (leadTime.ts/sectorCapacity.ts);
--   • gating pelo roteiro (production_sectors) com sector_display_to_enum —
--     Montagem/Acabamento sempre presentes (paridade com o wave engine);
--   • colocação por DIAS ÚTEIS (add_business_days, feriado-aware), não
--     subtração de calendário;
--   • topologia canônica: preps PARALELOS (Corte Palmilha ‖ Corte Forração ‖
--     Aviamento/Mesa ‖ Costura) terminando no início da cadeia sequencial
--     Silk → Colagem → Montagem → Solagem → Acabamento → entrega;
--   • 9 setores (antes só 4).
--
-- Contrato de colunas preservado (useSectorBottlenecks, useCapacityOverflow,
-- detect_wave_capacity_overflow): mesmos nomes/semântica; `sector` ganha os
-- valores novos ('silk','colagem','montagem','solagem','acabamento').
-- `capacity_per_day` = capacidade efetiva (ficha > categoria); quando o lead
-- veio de fallback legado (sem cap em lugar nenhum), expõe a taxa IMPLÍCITA
-- ceil(qty/lead) pra manter a matemática de utilização consistente.
-- `end_date` agora é o INÍCIO do estágio seguinte (janela [start, end) — mesma
-- convenção do TS computeParallelWindows); window_days = lead em dias úteis.
--
-- v_sector_bottlenecks usa o modelo ADITIVO de dias de máquina (mesma correção
-- já autorada em 20260723150000): Σ(pares/capacidade) vs dias úteis da semana.

DROP VIEW IF EXISTS public.v_sector_bottlenecks;
DROP VIEW IF EXISTS public.v_sector_weekly_load;

CREATE VIEW public.v_sector_weekly_load
WITH (security_invoker = true) AS
WITH active_ops AS (
  SELECT
    o.id AS order_id,
    o.order_number,
    o.sale_order_id,
    o.reference_id,
    o.quantity,
    o.planned_delivery,
    o.color,
    o.status,
    ts.id AS sheet_id,
    ts.name AS sheet_name,
    COALESCE(ts.production_sectors, '[]'::jsonb) AS roteiro,
    -- Capacidade efetiva: ficha > default da categoria (NULLIF(0) porque a
    -- ficha grava 0 quando não preenchida) — MESMA cadeia do compute_wave_timeline
    COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day, 0)::numeric      AS cap_palmilha,
    COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day, 0)::numeric    AS cap_forracao,
    COALESCE(NULLIF(ts.costura_capacity_per_day, 0::numeric), dlt.costura_capacity_per_day, 0::numeric) AS cap_costura,
    COALESCE(NULLIF(ts.mesa_daily_capacity, 0), dlt.mesa_daily_capacity, 0)::numeric              AS cap_mesa,
    COALESCE(NULLIF(ts.silk_capacity_per_day, 0::numeric), dlt.silk_capacity_per_day, 0::numeric) AS cap_silk,
    COALESCE(NULLIF(ts.gluing_capacity_per_day, 0::numeric), dlt.gluing_capacity_per_day, 0::numeric) AS cap_colagem,
    COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day, 0)::numeric  AS cap_montagem,
    COALESCE(NULLIF(ts.soling_capacity_per_day, 0::numeric), dlt.soling_capacity_per_day, 0::numeric) AS cap_solagem,
    COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day, 0)::numeric AS cap_acabamento,
    -- Fallbacks legados de lead (mesmos do compute_wave_timeline pós F1-08)
    COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 1)         AS lt_corte_palmilha,
    COALESCE(NULLIF(ts.lead_time_corte_dias, 0), dlt.lead_time_corte_dias, 2)         AS lt_corte_forracao,
    COALESCE(NULLIF(ts.lead_time_costura_dias, 0), dlt.lead_time_costura_dias, 1)     AS lt_costura,
    COALESCE(NULLIF(ts.lead_time_montagem_dias, 0), dlt.lead_time_montagem_dias, 2)   AS lt_montagem,
    COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0), dlt.lead_time_acabamento_dias, 1) AS lt_acabamento
  FROM public.orders o
  JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  -- Lista de exclusão espelhada em src/lib/orderStatus.ts (EXCLUDED_ORDER_STATUSES)
  WHERE o.status NOT IN ('Finalizado','Concluído','Cancelada','Cancelado','finalizado','concluído','concluido','cancelada','cancelado','Rascunho','rascunho')
    AND o.deleted_at IS NULL
    AND o.planned_delivery IS NOT NULL
    AND o.quantity > 0
),
leads AS (
  SELECT ao.*,
    -- Lead (dias úteis) por setor — MESMO CASE do compute_wave_timeline:
    -- setor no roteiro? → cap > 0 ? ceil(qty/cap) : fallback legado ; senão 0
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'corte_palmilha')
         THEN CASE WHEN ao.cap_palmilha > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_palmilha)::int) ELSE ao.lt_corte_palmilha END
         ELSE 0 END AS lead_palmilha,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'corte_forracao')
         THEN CASE WHEN ao.cap_forracao > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_forracao)::int) ELSE ao.lt_corte_forracao END
         ELSE 0 END AS lead_forracao,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'costura')
         THEN CASE WHEN ao.cap_costura > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_costura)::int) ELSE ao.lt_costura END
         ELSE 0 END AS lead_costura,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'mesa')
         THEN CASE WHEN ao.cap_mesa > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_mesa)::int) ELSE 1 END
         ELSE 0 END AS lead_mesa,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'silk')
         THEN CASE WHEN ao.cap_silk > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_silk)::int) ELSE 1 END
         ELSE 0 END AS lead_silk,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'colagem')
         THEN CASE WHEN ao.cap_colagem > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_colagem)::int) ELSE 1 END
         ELSE 0 END AS lead_colagem,
    -- Montagem/Acabamento: sempre presentes (paridade com o wave engine)
    CASE WHEN ao.cap_montagem > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_montagem)::int) ELSE ao.lt_montagem END AS lead_montagem,
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(ao.roteiro) x WHERE public.sector_display_to_enum(x.value) = 'solagem')
         THEN CASE WHEN ao.cap_solagem > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_solagem)::int) ELSE 1 END
         ELSE 0 END AS lead_solagem,
    CASE WHEN ao.cap_acabamento > 0 THEN GREATEST(1, CEIL(ao.quantity::numeric / ao.cap_acabamento)::int) ELSE ao.lt_acabamento END AS lead_acabamento
  FROM active_ops ao
),
cascaded AS (
  SELECT l.*,
    -- Fronteiras da cadeia sequencial, retroagindo da entrega em DIAS ÚTEIS
    public.add_business_days(l.planned_delivery, -(l.lead_acabamento + l.lead_solagem + l.lead_montagem + l.lead_colagem + l.lead_silk))::date AS seq_start,
    public.add_business_days(l.planned_delivery, -(l.lead_acabamento + l.lead_solagem + l.lead_montagem + l.lead_colagem))::date AS b_colagem_start,
    public.add_business_days(l.planned_delivery, -(l.lead_acabamento + l.lead_solagem + l.lead_montagem))::date AS b_montagem_start,
    public.add_business_days(l.planned_delivery, -(l.lead_acabamento + l.lead_solagem))::date AS b_solagem_start,
    public.add_business_days(l.planned_delivery, -l.lead_acabamento)::date AS b_acab_start
  FROM leads l
),
sector_windows AS (
  -- Preps PARALELOS: todos terminam em seq_start (início da cadeia sequencial)
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'corte_palmilha'::text AS sector,
         CASE WHEN c.cap_palmilha > 0 THEN c.cap_palmilha ELSE CEIL(c.quantity::numeric / c.lead_palmilha) END AS capacity_per_day,
         public.add_business_days(c.seq_start, -c.lead_palmilha)::date AS start_date,
         c.seq_start AS end_date,
         c.lead_palmilha AS lead_days
  FROM cascaded c WHERE c.lead_palmilha > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'corte_forracao'::text,
         CASE WHEN c.cap_forracao > 0 THEN c.cap_forracao ELSE CEIL(c.quantity::numeric / c.lead_forracao) END,
         public.add_business_days(c.seq_start, -c.lead_forracao)::date,
         c.seq_start,
         c.lead_forracao
  FROM cascaded c WHERE c.lead_forracao > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'costura'::text,
         CASE WHEN c.cap_costura > 0 THEN c.cap_costura ELSE CEIL(c.quantity::numeric / c.lead_costura) END,
         public.add_business_days(c.seq_start, -c.lead_costura)::date,
         c.seq_start,
         c.lead_costura
  FROM cascaded c WHERE c.lead_costura > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'mesa'::text,
         CASE WHEN c.cap_mesa > 0 THEN c.cap_mesa ELSE CEIL(c.quantity::numeric / c.lead_mesa) END,
         public.add_business_days(c.seq_start, -c.lead_mesa)::date,
         c.seq_start,
         c.lead_mesa
  FROM cascaded c WHERE c.lead_mesa > 0
  UNION ALL
  -- Cadeia SEQUENCIAL pós-prep
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'silk'::text,
         CASE WHEN c.cap_silk > 0 THEN c.cap_silk ELSE CEIL(c.quantity::numeric / c.lead_silk) END,
         c.seq_start,
         c.b_colagem_start,
         c.lead_silk
  FROM cascaded c WHERE c.lead_silk > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'colagem'::text,
         CASE WHEN c.cap_colagem > 0 THEN c.cap_colagem ELSE CEIL(c.quantity::numeric / c.lead_colagem) END,
         c.b_colagem_start,
         c.b_montagem_start,
         c.lead_colagem
  FROM cascaded c WHERE c.lead_colagem > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'montagem'::text,
         CASE WHEN c.cap_montagem > 0 THEN c.cap_montagem ELSE CEIL(c.quantity::numeric / c.lead_montagem) END,
         c.b_montagem_start,
         c.b_solagem_start,
         c.lead_montagem
  FROM cascaded c WHERE c.lead_montagem > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'solagem'::text,
         CASE WHEN c.cap_solagem > 0 THEN c.cap_solagem ELSE CEIL(c.quantity::numeric / c.lead_solagem) END,
         c.b_solagem_start,
         c.b_acab_start,
         c.lead_solagem
  FROM cascaded c WHERE c.lead_solagem > 0
  UNION ALL
  SELECT c.order_id, c.order_number, c.sale_order_id, c.reference_id, c.quantity,
         c.planned_delivery, c.color, c.status, c.sheet_id, c.sheet_name,
         'acabamento'::text,
         CASE WHEN c.cap_acabamento > 0 THEN c.cap_acabamento ELSE CEIL(c.quantity::numeric / c.lead_acabamento) END,
         c.b_acab_start,
         c.planned_delivery,
         c.lead_acabamento
  FROM cascaded c WHERE c.lead_acabamento > 0
)
SELECT
  sw.order_id, sw.order_number, sw.sale_order_id, sw.reference_id,
  sw.quantity, sw.planned_delivery, sw.color, sw.status,
  sw.sheet_id, sw.sheet_name,
  sw.sector,
  sw.capacity_per_day,
  sw.start_date,
  sw.end_date,
  sw.lead_days AS window_days,
  sw.quantity::numeric / sw.lead_days::numeric AS pairs_per_day,
  date_trunc('week', sw.start_date::timestamp)::date AS week_start,
  EXTRACT(YEAR FROM date_trunc('week', sw.start_date::timestamp)) AS iso_year,
  EXTRACT(WEEK FROM date_trunc('week', sw.start_date::timestamp)) AS iso_week
FROM sector_windows sw;

COMMENT ON VIEW public.v_sector_weekly_load IS
  'Carga estimada por (setor, OP, semana ISO de início). Janelas derivadas da MESMA cascata do compute_wave_timeline: leads ficha > default_lead_times > lead legado, gating pelo roteiro (production_sectors), dias úteis (feriado-aware) e paralelismo dos preps. 9 setores do fluxo. Janela = [start_date, end_date) — end_date é o início do estágio seguinte.';

GRANT SELECT ON public.v_sector_weekly_load TO authenticated, service_role;

-- v_sector_bottlenecks — modelo ADITIVO de dias de máquina (fix da 20260723150000
-- reaplicado sobre a nova base). Colunas de saída inalteradas.
CREATE VIEW public.v_sector_bottlenecks
WITH (security_invoker = true) AS
WITH agg AS (
  SELECT
    sector,
    week_start,
    iso_year::int AS iso_year,
    iso_week::int AS iso_week,
    COUNT(DISTINCT order_id) AS ops_count,
    SUM(quantity)::numeric AS total_pairs,
    -- dias de máquina necessários no setor (aditivo, sem média ponderada)
    SUM(quantity::numeric / NULLIF(capacity_per_day, 0)) AS days_needed,
    -- dias úteis seg–sex da semana ISO (desconta feriados; inclusivo nas pontas)
    GREATEST(1, public.biz_days_between(week_start, (week_start + 4))) AS days_available,
    ARRAY_AGG(json_build_object(
      'order_id', order_id,
      'order_number', order_number,
      'sale_order_id', sale_order_id,
      'sheet_name', sheet_name,
      'color', color,
      'quantity', quantity,
      'planned_delivery', planned_delivery,
      'pairs_per_day', ROUND(pairs_per_day, 1)
    ) ORDER BY quantity DESC) AS contributing_orders
  FROM public.v_sector_weekly_load
  GROUP BY sector, week_start, iso_year, iso_week
)
SELECT
  sector,
  week_start,
  iso_year,
  iso_week,
  ops_count,
  total_pairs::int AS total_pairs_planned,
  -- pares que cabem nos dias disponíveis ao throughput combinado
  CASE WHEN COALESCE(days_needed, 0) > 0
       THEN ROUND(total_pairs * days_available / days_needed)::int
       ELSE 0 END AS total_capacity_week,
  CASE WHEN days_available > 0 AND COALESCE(days_needed, 0) > 0
       THEN ROUND(days_needed / days_available * 100)::int
       ELSE 0 END AS utilization_pct,
  (COALESCE(days_needed, 0) > days_available) AS is_bottleneck,
  CASE
    WHEN COALESCE(days_needed, 0) > days_available * 1.5 THEN 'critical'
    WHEN COALESCE(days_needed, 0) > days_available       THEN 'warning'
    ELSE 'ok'
  END AS severity,
  contributing_orders
FROM agg;

COMMENT ON VIEW public.v_sector_bottlenecks IS
  'Gargalos por (setor, semana ISO) sobre a v_sector_weekly_load canônica (cascata do compute_wave_timeline, 9 setores). Capacidade pelo modelo ADITIVO de dias de máquina (Σ pares/capacidade vs dias úteis da semana, feriado-aware). is_bottleneck=true quando dias necessários > dias disponíveis.';

GRANT SELECT ON public.v_sector_bottlenecks TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- PARTE 2 — v_sector_load + v_capacity_driven_lead_times (F1-03)
--
-- v_sector_load:
--   • join correto: orders.reference_id → technical_sheets (antes apontava
--     product_references, que casa 0/244 — toda carga caía em 'Geral' e a
--     página Lead Time mostrava só o buffer);
--   • buckets normalizados por sector_display_to_enum (o legado 'Corte' vai pro
--     Corte Palmilha, 'Forração' pro Corte Forração, 'Mesa' pro Aviamento —
--     antes 'Corte' somava com 'Corte Forração' e 'Corte Palmilha' com
--     'Forração', cruzando os setores);
--   • 10 setores (inclui Costura, Solagem, Aviamento, Expedição);
--   • ignora OPs canceladas/rascunho/deletadas.
--
-- v_capacity_driven_lead_times:
--   • aliases CANÔNICOS: corte_palmilha_capacity_per_day = dlt.sewing_...,
--     corte_forracao_capacity_per_day = dlt.cutting_... (o alias antigo
--     'forracao_capacity_per_day' expunha a capacidade do CORTE PALMILHA com
--     rótulo de Forração — o RCCP comparava demanda contra o setor errado);
--   • total com PARALELISMO canônico: MAX(preps: corte_palmilha, corte_forracao,
--     costura, aviamento) + soma(silk, colagem, montagem, solagem, acabamento)
--     + buffer (Expedição fora do total, como no compute_wave_timeline);
--   • dynamic_days_expedicao agora existe (LeadTime.tsx já o renderizava).
-- Consumidores atualizados no mesmo pacote: RCCPPlanning.tsx e LeadTime.tsx.

DROP VIEW IF EXISTS public.v_capacity_driven_lead_times;
DROP VIEW IF EXISTS public.v_sector_load;

CREATE VIEW public.v_sector_load
WITH (security_invoker = true) AS
WITH pending_stages AS (
  SELECT COALESCE(ts.shoe_category, 'Geral'::text) AS shoe_category,
         public.sector_display_to_enum(os.stage_name)::text AS sector_key,
         SUM(GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0))) AS pending_quantity
    FROM public.order_stages os
    JOIN public.orders o ON os.order_id = o.id
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE os.status <> 'concluido'::text
     AND o.deleted_at IS NULL
     AND o.status NOT IN ('Finalizado','Concluído','Cancelada','Cancelado','finalizado','concluído','concluido','cancelada','cancelado','Rascunho','rascunho')
   GROUP BY 1, 2
)
SELECT shoe_category,
  SUM(CASE WHEN sector_key = 'corte_palmilha' THEN pending_quantity ELSE 0 END) AS load_corte_palmilha,
  SUM(CASE WHEN sector_key = 'corte_forracao' THEN pending_quantity ELSE 0 END) AS load_corte_forracao,
  SUM(CASE WHEN sector_key = 'costura'        THEN pending_quantity ELSE 0 END) AS load_costura,
  SUM(CASE WHEN sector_key = 'mesa'           THEN pending_quantity ELSE 0 END) AS load_aviamento,
  SUM(CASE WHEN sector_key = 'silk'           THEN pending_quantity ELSE 0 END) AS load_silk,
  SUM(CASE WHEN sector_key = 'colagem'        THEN pending_quantity ELSE 0 END) AS load_colagem,
  SUM(CASE WHEN sector_key = 'montagem'       THEN pending_quantity ELSE 0 END) AS load_montagem,
  SUM(CASE WHEN sector_key = 'solagem'        THEN pending_quantity ELSE 0 END) AS load_solagem,
  SUM(CASE WHEN sector_key = 'acabamento'     THEN pending_quantity ELSE 0 END) AS load_acabamento,
  SUM(CASE WHEN sector_key = 'expedicao'      THEN pending_quantity ELSE 0 END) AS load_expedicao
FROM pending_stages
GROUP BY shoe_category;

COMMENT ON VIEW public.v_sector_load IS
  'Carga pendente (pares) por categoria × setor canônico. Join por technical_sheets (orders.reference_id) e normalização de stage_name via sector_display_to_enum. Exclui OPs canceladas/rascunho/deletadas.';

GRANT SELECT ON public.v_sector_load TO authenticated, service_role;

CREATE VIEW public.v_capacity_driven_lead_times
WITH (security_invoker = true) AS
WITH base AS (
  SELECT dlt.shoe_category,
    dlt.notes,
    dlt.sewing_capacity_per_day   AS corte_palmilha_capacity_per_day,
    dlt.cutting_capacity_per_day  AS corte_forracao_capacity_per_day,
    dlt.costura_capacity_per_day,
    dlt.mesa_daily_capacity       AS aviamento_capacity_per_day,
    dlt.silk_capacity_per_day,
    dlt.gluing_capacity_per_day,
    dlt.assembly_capacity_per_day,
    dlt.soling_capacity_per_day,
    dlt.finishing_capacity_per_day,
    dlt.expedition_capacity_per_day,
    dlt.lead_time_buffer_material_dias,
    COALESCE(sl.load_corte_palmilha, 0)::numeric AS current_load_corte_palmilha,
    COALESCE(sl.load_corte_forracao, 0)::numeric AS current_load_corte_forracao,
    COALESCE(sl.load_costura, 0)::numeric        AS current_load_costura,
    COALESCE(sl.load_aviamento, 0)::numeric      AS current_load_aviamento,
    COALESCE(sl.load_silk, 0)::numeric           AS current_load_silk,
    COALESCE(sl.load_colagem, 0)::numeric        AS current_load_colagem,
    COALESCE(sl.load_montagem, 0)::numeric       AS current_load_montagem,
    COALESCE(sl.load_solagem, 0)::numeric        AS current_load_solagem,
    COALESCE(sl.load_acabamento, 0)::numeric     AS current_load_acabamento,
    COALESCE(sl.load_expedicao, 0)::numeric      AS current_load_expedicao
  FROM public.default_lead_times dlt
  LEFT JOIN public.v_sector_load sl ON dlt.shoe_category = sl.shoe_category
),
days AS (
  SELECT b.*,
    b.current_load_corte_palmilha / NULLIF(b.corte_palmilha_capacity_per_day, 0)::numeric AS d_corte_palmilha,
    b.current_load_corte_forracao / NULLIF(b.corte_forracao_capacity_per_day, 0)::numeric AS d_corte_forracao,
    b.current_load_costura        / NULLIF(b.costura_capacity_per_day, 0::numeric)        AS d_costura,
    b.current_load_aviamento      / NULLIF(b.aviamento_capacity_per_day, 0)::numeric      AS d_aviamento,
    b.current_load_silk           / NULLIF(b.silk_capacity_per_day, 0::numeric)           AS d_silk,
    b.current_load_colagem        / NULLIF(b.gluing_capacity_per_day, 0::numeric)         AS d_colagem,
    b.current_load_montagem       / NULLIF(b.assembly_capacity_per_day, 0)::numeric       AS d_montagem,
    b.current_load_solagem        / NULLIF(b.soling_capacity_per_day, 0::numeric)         AS d_solagem,
    b.current_load_acabamento     / NULLIF(b.finishing_capacity_per_day, 0)::numeric      AS d_acabamento,
    b.current_load_expedicao      / NULLIF(b.expedition_capacity_per_day, 0)::numeric     AS d_expedicao
  FROM base b
)
SELECT
  shoe_category,
  notes,
  corte_palmilha_capacity_per_day,
  corte_forracao_capacity_per_day,
  costura_capacity_per_day,
  aviamento_capacity_per_day,
  silk_capacity_per_day,
  gluing_capacity_per_day,
  assembly_capacity_per_day,
  soling_capacity_per_day,
  finishing_capacity_per_day,
  expedition_capacity_per_day,
  current_load_corte_palmilha,
  current_load_corte_forracao,
  current_load_costura,
  current_load_aviamento,
  current_load_silk,
  current_load_colagem,
  current_load_montagem,
  current_load_solagem,
  current_load_acabamento,
  current_load_expedicao,
  COALESCE(CEIL(d_corte_palmilha), 0)::int AS dynamic_days_corte_palmilha,
  COALESCE(CEIL(d_corte_forracao), 0)::int AS dynamic_days_corte_forracao,
  COALESCE(CEIL(d_costura), 0)::int        AS dynamic_days_costura,
  COALESCE(CEIL(d_aviamento), 0)::int      AS dynamic_days_aviamento,
  COALESCE(CEIL(d_silk), 0)::int           AS dynamic_days_silk,
  COALESCE(CEIL(d_colagem), 0)::int        AS dynamic_days_colagem,
  COALESCE(CEIL(d_montagem), 0)::int       AS dynamic_days_montagem,
  COALESCE(CEIL(d_solagem), 0)::int        AS dynamic_days_solagem,
  COALESCE(CEIL(d_acabamento), 0)::int     AS dynamic_days_acabamento,
  COALESCE(CEIL(d_expedicao), 0)::int      AS dynamic_days_expedicao,
  lead_time_buffer_material_dias,
  -- Topologia canônica (compute_wave_timeline): MAX dos preps paralelos
  -- + soma da cadeia sequencial + buffer. Expedição fora do total.
  CEIL(
    GREATEST(COALESCE(d_corte_palmilha, 0), COALESCE(d_corte_forracao, 0),
             COALESCE(d_costura, 0), COALESCE(d_aviamento, 0))
    + COALESCE(d_silk, 0) + COALESCE(d_colagem, 0) + COALESCE(d_montagem, 0)
    + COALESCE(d_solagem, 0) + COALESCE(d_acabamento, 0)
    + COALESCE(lead_time_buffer_material_dias, 0)
  )::int AS total_dynamic_lead_time_days
FROM days;

COMMENT ON VIEW public.v_capacity_driven_lead_times IS
  'Lead time dinâmico por categoria a partir do backlog (v_sector_load) ÷ capacidade (default_lead_times), com aliases canônicos por setor e total respeitando o paralelismo dos preps (MAX(Corte Palmilha, Corte Forração, Costura, Aviamento) + sequenciais + buffer), espelhando compute_wave_timeline.';

GRANT SELECT ON public.v_capacity_driven_lead_times TO authenticated, service_role;
