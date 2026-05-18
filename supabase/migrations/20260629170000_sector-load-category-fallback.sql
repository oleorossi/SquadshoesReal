-- Capacidade por referência: fallback pra default_lead_times (por shoe_category)
-- quando a ficha técnica não tem capacity_per_day preenchida.
--
-- Antes: v_sector_load_by_reference usava só ts.X_capacity_per_day. Fichas
-- sem cap configurada (caso comum — só algumas fichas têm cap específica)
-- voltavam 0 e auto-fill não alocava nada.
--
-- Agora: COALESCE(NULLIF(ts.X, 0), dlt.X, 0). Trata 0 como "não preenchido"
-- e cai pra default por categoria. Mesmo pattern usado em
-- 20260418182021 (motor de waves de produção).
--
-- Coluna nova capacity_source ('ficha' | 'categoria' | 'nenhuma') deixa UI
-- mostrar de onde veio o número.
--
-- Expedição: default_lead_times não tem expedition_capacity_per_day; fica 0
-- se a ficha não preencher (manter como TODO até o usuário definir um default).

CREATE OR REPLACE VIEW public.v_sector_load_by_reference AS
WITH planned_orders AS (
  SELECT
    o.reference_id                                 AS tech_sheet_id,
    o.quantity                                     AS qty,
    o.planned_delivery,
    date_trunc('week', o.planned_delivery)::date   AS week_start
  FROM public.orders o
  WHERE o.status NOT IN ('Cancelado', 'Concluído', 'Concluida', 'Entregue', 'Expedido')
    AND o.planned_delivery IS NOT NULL
    AND o.quantity > 0
),
by_ref AS (
  SELECT
    po.tech_sheet_id,
    po.week_start,
    SUM(po.qty)::int   AS total_qty,
    COUNT(*)::int      AS op_count
  FROM planned_orders po
  GROUP BY po.tech_sheet_id, po.week_start
)
SELECT
  br.tech_sheet_id,
  br.week_start,
  br.total_qty,
  br.op_count,
  ts.code                                AS reference_code,
  ts.name                                AS reference_name,
  ts.shoe_category,
  COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),     dlt.sewing_capacity_per_day,     0)::int AS cap_corte_palmilha,
  COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),    dlt.cutting_capacity_per_day,    0)::int AS cap_corte_forracao,
  COALESCE(NULLIF(ts.costura_capacity_per_day, 0),    dlt.costura_capacity_per_day,    0)::int AS cap_costura,
  COALESCE(NULLIF(ts.mesa_daily_capacity, 0),         dlt.mesa_daily_capacity,         0)::int AS cap_aviamento,
  COALESCE(NULLIF(ts.silk_capacity_per_day, 0),       dlt.silk_capacity_per_day,       0)::int AS cap_silk,
  COALESCE(NULLIF(ts.gluing_capacity_per_day, 0),     dlt.gluing_capacity_per_day,     0)::int AS cap_colagem,
  COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),   dlt.assembly_capacity_per_day,   0)::int AS cap_montagem,
  COALESCE(NULLIF(ts.soling_capacity_per_day, 0),     dlt.soling_capacity_per_day,     0)::int AS cap_solagem,
  COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),  dlt.finishing_capacity_per_day,  0)::int AS cap_acabamento,
  COALESCE(ts.expedition_capacity_per_day, 0)::int AS cap_expedicao,
  -- Origem da capacidade (qualquer setor configurado na ficha → 'ficha').
  -- Critério: olha cutting_capacity_per_day como proxy. Cobre o caso real
  -- (gestor preenche todas as caps ou nenhuma; raro preencher só uma).
  CASE
    WHEN ts.cutting_capacity_per_day IS NOT NULL AND ts.cutting_capacity_per_day > 0 THEN 'ficha'
    WHEN dlt.cutting_capacity_per_day IS NOT NULL THEN 'categoria'
    ELSE 'nenhuma'
  END AS capacity_source
FROM by_ref br
JOIN public.technical_sheets ts ON ts.id = br.tech_sheet_id
LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category;

GRANT SELECT ON public.v_sector_load_by_reference TO authenticated;

COMMENT ON VIEW public.v_sector_load_by_reference IS
  'Demanda por referencia/semana + capacidade/dia/setor com fallback: ficha tecnica primeiro, default_lead_times por shoe_category como backup. Coluna capacity_source indica origem.';
