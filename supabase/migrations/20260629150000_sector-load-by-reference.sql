-- Capacidade dinâmica por referência por setor — Fase A (read-only)
--
-- Antes: /capacity-planning agrega só por setor (média ponderada das caps
-- das refs). Gestor não vê "Ref A precisa 5 dias em Costura, Ref B precisa
-- 2 dias" — só "Costura está 80% ocupada".
--
-- Agora: VIEW v_sector_load_by_reference expõe demanda × capacidade por
-- (technical_sheet_id, week_start). Frontend monta matriz refs × setores
-- pra identificar gargalo por referência.
--
-- Filtro: orders ativas (status NOT IN cancelado/concluído/entregue) com
-- planned_delivery definido. Bucket por ISO week (Mon..Sun).

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
  -- 10 capacidades por dia (uma por setor)
  COALESCE(ts.sewing_capacity_per_day, 0)::int      AS cap_corte_palmilha,
  COALESCE(ts.cutting_capacity_per_day, 0)::int     AS cap_corte_forracao,
  COALESCE(ts.costura_capacity_per_day, 0)::int     AS cap_costura,
  COALESCE(ts.mesa_daily_capacity, 0)::int          AS cap_aviamento,
  COALESCE(ts.silk_capacity_per_day, 0)::int        AS cap_silk,
  COALESCE(ts.gluing_capacity_per_day, 0)::int      AS cap_colagem,
  COALESCE(ts.assembly_capacity_per_day, 0)::int    AS cap_montagem,
  COALESCE(ts.soling_capacity_per_day, 0)::int      AS cap_solagem,
  COALESCE(ts.finishing_capacity_per_day, 0)::int   AS cap_acabamento,
  COALESCE(ts.expedition_capacity_per_day, 0)::int  AS cap_expedicao
FROM by_ref br
JOIN public.technical_sheets ts ON ts.id = br.tech_sheet_id;

GRANT SELECT ON public.v_sector_load_by_reference TO authenticated;

COMMENT ON VIEW public.v_sector_load_by_reference IS
  'Demanda por referência por semana + capacidade diária por setor da ficha técnica. Frontend monta matriz pra detectar bottleneck por ref.';
