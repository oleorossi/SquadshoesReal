-- O relatório do período separa defeito ainda aberto do que já foi retrabalhado
-- ou descartado. O custo continua sem o par que voltou do retrabalho.

DROP FUNCTION IF EXISTS public.atelier_period_report(date, date);

CREATE FUNCTION public.atelier_period_report(p_from date, p_to date)
RETURNS TABLE (
  side text, contractor_id uuid, contractor_name text,
  sent_pairs numeric, received_pairs numeric, pending_pairs numeric,
  late_jobs integer, avg_lead_first_days numeric, avg_lead_full_days numeric,
  cost numeric, done_pairs numeric, defect_pairs numeric, loss_pairs numeric,
  defect_resolved_pairs numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT COALESCE(p_from, CURRENT_DATE - 30) AS d0, COALESCE(p_to, CURRENT_DATE) AS d1
  ),
  jobs AS (
    SELECT j.id, j.pairs, j.sent_at, j.target_end, j.sector, j.contractor_id,
           CASE WHEN j.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           public.atelier_job_open_received(j.id) AS received_now
      FROM public.cabedal_prep_jobs j
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
  ),
  sent_rows AS (
    SELECT CASE WHEN p.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
           p.contractor_id, p.pairs::numeric AS pairs,
           GREATEST(p.pairs - COALESCE((
             SELECT SUM(rr.pairs + COALESCE(rr.qty_defect, 0) + COALESCE(rr.qty_loss, 0))
               FROM public.atelier_job_receipts rr
              WHERE rr.reversed_at IS NULL
                AND rr.rework_resolution_id IS NULL
                AND (
                  rr.part_id = p.id
                  OR (
                    rr.part_id IS NULL
                    AND rr.job_id = p.job_id
                    AND (SELECT COUNT(*) FROM public.atelier_job_parts px WHERE px.job_id = p.job_id) = 1
                  )
                )
           ), 0), 0)::numeric AS pending,
           p.sent_at,
           (p.return_on IS NOT NULL AND p.return_on < CURRENT_DATE AND p.received_pairs + 1e-9 < p.pairs) AS late
      FROM public.atelier_job_parts p
      JOIN public.cabedal_prep_jobs j ON j.id = p.job_id
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
       AND p.sent_at IS NOT NULL
    UNION ALL
    SELECT j.side, j.contractor_id, j.pairs,
           GREATEST(j.pairs - j.received_now, 0), j.sent_at,
           j.target_end IS NOT NULL
             AND public.atelier_job_return_date(j.target_end, j.sector) < CURRENT_DATE
             AND j.received_now + 1e-9 < j.pairs
      FROM jobs j
     WHERE j.sent_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.atelier_job_parts p WHERE p.job_id = j.id)
  ),
  sent AS (
    SELECT side, contractor_id, SUM(pairs) AS sent_pairs, SUM(pending) AS pending_pairs,
           COUNT(*) FILTER (WHERE late)::int AS late_jobs
      FROM sent_rows, bounds b
     WHERE sent_at::date BETWEEN b.d0 AND b.d1 AND side = 'contractor'
     GROUP BY side, contractor_id
  ),
  receipts AS (
    SELECT j.side, j.contractor_id, r.pairs,
           COALESCE(r.qty_defect, 0) AS qty_defect,
           LEAST(
             COALESCE(r.qty_defect, 0),
             COALESCE((
               SELECT SUM(d.pairs)
                 FROM public.atelier_defect_resolutions d
                WHERE d.receipt_id = r.id AND d.kind IN ('rework', 'scrap')
             ), 0)
           ) AS defect_resolved,
           COALESCE(r.qty_loss, 0) AS qty_loss,
           r.rework_resolution_id,
           r.created_at,
           COALESCE(p.sent_at, j.sent_at) AS sent_at,
           j.id AS job_id,
           COALESCE(p.unit_price, i.unit_price, 0) AS unit_price
      FROM public.atelier_job_receipts r
      JOIN jobs j ON j.id = r.job_id
      LEFT JOIN public.atelier_job_parts p ON p.id = r.part_id
      LEFT JOIN LATERAL (
        SELECT unit_price FROM public.service_order_items si
         WHERE (r.part_id IS NOT NULL AND si.atelier_part_id = r.part_id)
            OR (r.part_id IS NULL AND si.atelier_job_id = j.id)
         ORDER BY si.created_at LIMIT 1
      ) i ON true
      CROSS JOIN bounds b
     WHERE r.reversed_at IS NULL AND r.created_at::date BETWEEN b.d0 AND b.d1
  ),
  received AS (
    SELECT side, contractor_id, SUM(pairs) AS received_pairs,
           SUM(GREATEST(qty_defect - defect_resolved, 0)) AS defect_pairs,
           SUM(defect_resolved) AS defect_resolved_pairs,
           SUM(qty_loss) AS loss_pairs,
           SUM(CASE WHEN side = 'contractor' AND rework_resolution_id IS NULL THEN pairs * unit_price ELSE 0 END) AS cost,
           SUM(CASE WHEN side = 'internal' THEN pairs ELSE 0 END) AS done_pairs
      FROM receipts GROUP BY side, contractor_id
  ),
  first_receipt AS (
    SELECT j.id, MIN(r.created_at) AS first_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor'
     GROUP BY j.id
  ),
  full_receipt AS (
    SELECT j.id, MAX(r.created_at) AS full_at
      FROM jobs j
      JOIN public.atelier_job_receipts r ON r.job_id = j.id AND r.reversed_at IS NULL
     WHERE j.sent_at IS NOT NULL AND j.side = 'contractor' AND j.received_now + 1e-9 >= j.pairs
     GROUP BY j.id
  ),
  leads AS (
    SELECT j.contractor_id,
           AVG(EXTRACT(EPOCH FROM (f.first_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_first,
           AVG(EXTRACT(EPOCH FROM (u.full_at - j.sent_at)) / 86400.0)
             FILTER (WHERE j.sent_at::date BETWEEN b.d0 AND b.d1) AS avg_full
      FROM jobs j
      CROSS JOIN bounds b
      LEFT JOIN first_receipt f ON f.id = j.id
      LEFT JOIN full_receipt u ON u.id = j.id
     WHERE j.side = 'contractor'
     GROUP BY j.contractor_id
  ),
  keys AS (
    SELECT side, contractor_id FROM sent
    UNION
    SELECT side, contractor_id FROM received
  )
  SELECT k.side, k.contractor_id,
         CASE WHEN k.side = 'internal' THEN NULL ELSE c.name END,
         COALESCE(s.sent_pairs, 0), COALESCE(r.received_pairs, 0), COALESCE(s.pending_pairs, 0),
         COALESCE(s.late_jobs, 0), ROUND(l.avg_first::numeric, 1), ROUND(l.avg_full::numeric, 1),
         ROUND(COALESCE(r.cost, 0), 2), COALESCE(r.done_pairs, 0),
         COALESCE(r.defect_pairs, 0), COALESCE(r.loss_pairs, 0),
         COALESCE(r.defect_resolved_pairs, 0)
    FROM keys k
    LEFT JOIN sent s ON s.side = k.side AND s.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN received r ON r.side = k.side AND r.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN leads l ON k.side = 'contractor' AND l.contractor_id IS NOT DISTINCT FROM k.contractor_id
    LEFT JOIN public.contractors c ON c.id = k.contractor_id
   ORDER BY k.side, c.name NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.atelier_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_period_report(date, date) TO authenticated, service_role;
