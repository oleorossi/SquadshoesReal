-- VIEW que agrega carga ativa de cada setor por (modelo, cor). Permite que
-- a nova página /producao/visao-agregada (e qualquer outra UI futura)
-- exiba operação consolidada — em vez de N cartões individuais de 12 pares,
-- mostra "X pares do modelo Y / cor Z" como um bloco único.
--
-- Setores que ignoram cor (ex.: Corte Palmilha — mesmo molde) reagregam
-- no client via useSectorWorkload({ groupByColor: false }).
CREATE OR REPLACE VIEW public.v_sector_workload_active
WITH (security_invoker = true) AS
SELECT
  os.stage_name AS sector,
  o.reference_id,
  ts.name AS model_name,
  ts.shoe_category,
  o.color,
  COUNT(o.id) AS ops_count,
  SUM(o.quantity)::int AS total_pairs,
  SUM(GREATEST(0, COALESCE(os.quantity_total,0) - COALESCE(os.quantity_processed,0)))::int AS remaining_pairs,
  SUM(COALESCE(os.quantity_processed,0))::int AS processed_pairs,
  MIN(o.planned_delivery) AS earliest_deadline,
  MAX(o.planned_delivery) AS latest_deadline,
  ARRAY_AGG(o.id ORDER BY o.planned_delivery NULLS LAST) AS order_ids,
  ARRAY_AGG(o.order_number ORDER BY o.planned_delivery NULLS LAST) AS order_numbers,
  (SELECT jsonb_object_agg(key, value)
     FROM (
       SELECT key, SUM((value)::numeric)::text::int AS value
       FROM unnest(ARRAY_AGG(COALESCE(o.grade,'{}'::jsonb))) AS g, jsonb_each_text(g)
       GROUP BY key
     ) merged
  ) AS aggregated_grade,
  CASE
    WHEN BOOL_OR(os.status = 'em_andamento' OR os.status = 'em_progresso') THEN 'em_andamento'
    ELSE 'pendente'
  END AS aggregated_status
FROM public.orders o
JOIN public.order_stages os ON os.order_id = o.id
JOIN public.technical_sheets ts ON ts.id = o.reference_id
WHERE os.status IN ('pendente', 'em_andamento', 'em_progresso')
  AND o.status NOT IN ('Cancelada','Cancelado','cancelada','cancelado','Finalizado','finalizado','Concluído','concluido')
GROUP BY os.stage_name, o.reference_id, ts.name, ts.shoe_category, o.color;

GRANT SELECT ON public.v_sector_workload_active TO authenticated, service_role;
