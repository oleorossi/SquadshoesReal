-- Adiciona expedition_capacity_per_day em default_lead_times pra fechar o
-- último setor que ainda ficava sem fallback. Expedição é embalar + conferir
-- + romaneio — pouca variação por tipo de calçado, então um default de 600
-- pares/dia cobre bem (gestor pode ajustar por categoria depois).

ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS expedition_capacity_per_day integer NULL;

UPDATE public.default_lead_times
   SET expedition_capacity_per_day = 600
 WHERE expedition_capacity_per_day IS NULL;

COMMENT ON COLUMN public.default_lead_times.expedition_capacity_per_day IS
  'Pares por dia em Expedição (embalagem + conferência + romaneio). Default 600. Editável por categoria conforme a equipe de Expedição cresça.';

-- Atualiza a view pra usar o fallback também em Expedição
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
  COALESCE(NULLIF(ts.expedition_capacity_per_day, 0), dlt.expedition_capacity_per_day, 0)::int AS cap_expedicao,
  CASE
    WHEN ts.cutting_capacity_per_day IS NOT NULL AND ts.cutting_capacity_per_day > 0 THEN 'ficha'
    WHEN dlt.cutting_capacity_per_day IS NOT NULL THEN 'categoria'
    ELSE 'nenhuma'
  END AS capacity_source
FROM by_ref br
JOIN public.technical_sheets ts ON ts.id = br.tech_sheet_id
LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category;

GRANT SELECT ON public.v_sector_load_by_reference TO authenticated;
