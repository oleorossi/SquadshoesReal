-- Fase 4. Leitura do período: fábrica × prestador.
-- Enviados = pares dos jobs com sent_at no intervalo.
-- Recebidos e custo = conferências não estornadas no intervalo,
--   no preço travado na linha da OS. Interno não tem custo.
-- Pendente e atraso são o saldo de hoje dos jobs enviados no intervalo.
-- Lead é a média, em dias, do envio até a primeira entrada e até os 100%.

CREATE OR REPLACE FUNCTION public.atelier_period_report(
  p_from date,
  p_to date
)
RETURNS TABLE (
  side text,
  contractor_id uuid,
  contractor_name text,
  sent_pairs numeric,
  received_pairs numeric,
  pending_pairs numeric,
  late_jobs integer,
  avg_lead_first_days numeric,
  avg_lead_full_days numeric,
  cost numeric,
  done_pairs numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      COALESCE(p_from, CURRENT_DATE - 30) AS d0,
      COALESCE(p_to, CURRENT_DATE) AS d1
  ),
  jobs AS (
    SELECT
      j.id,
      j.pairs,
      j.sent_at,
      j.target_end,
      j.contractor_id,
      CASE WHEN j.execution_mode = 'internal' THEN 'internal' ELSE 'contractor' END AS side,
      public.atelier_job_open_received(j.id) AS received_now
    FROM public.cabedal_prep_jobs j
    WHERE j.pipeline_status <> 'cancelled'
      AND j.sector IN ('costura_cabedal', 'aviamento')
  ),
  sent AS (
    SELECT j.side, j.contractor_id,
           SUM(j.pairs) AS sent_pairs,
           SUM(GREATEST(j.pairs - j.received_now, 0)) AS pending_pairs,
           COUNT(*) FILTER (
             WHERE j.target_end IS NOT NULL
               AND j.target_end < CURRENT_DATE
               AND j.received_now + 1e-9 < j.pairs
           )::int AS late_jobs
    FROM jobs j, bounds b
    WHERE j.sent_at IS NOT NULL
      AND j.sent_at::date BETWEEN b.d0 AND b.d1
      AND j.side = 'contractor'
    GROUP BY j.side, j.contractor_id
  ),
  receipts AS (
    SELECT
      j.side,
      j.contractor_id,
      r.pairs,
      r.created_at,
      j.sent_at,
      j.id AS job_id,
      COALESCE(i.unit_price, 0) AS unit_price
    FROM public.atelier_job_receipts r
    JOIN jobs j ON j.id = r.job_id
    LEFT JOIN public.service_order_items i ON i.atelier_job_id = j.id
    CROSS JOIN bounds b
    WHERE r.reversed_at IS NULL
      AND r.created_at::date BETWEEN b.d0 AND b.d1
  ),
  received AS (
    SELECT side, contractor_id,
           SUM(pairs) AS received_pairs,
           SUM(CASE WHEN side = 'contractor' THEN pairs * unit_price ELSE 0 END) AS cost,
           SUM(CASE WHEN side = 'internal' THEN pairs ELSE 0 END) AS done_pairs
    FROM receipts
    GROUP BY side, contractor_id
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
    WHERE j.sent_at IS NOT NULL
      AND j.side = 'contractor'
      AND j.received_now + 1e-9 >= j.pairs
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
  SELECT
    k.side,
    k.contractor_id,
    CASE WHEN k.side = 'internal' THEN NULL ELSE c.name END,
    COALESCE(s.sent_pairs, 0),
    COALESCE(r.received_pairs, 0),
    COALESCE(s.pending_pairs, 0),
    COALESCE(s.late_jobs, 0),
    ROUND(l.avg_first::numeric, 1),
    ROUND(l.avg_full::numeric, 1),
    ROUND(COALESCE(r.cost, 0), 2),
    COALESCE(r.done_pairs, 0)
  FROM keys k
  LEFT JOIN sent s ON s.side = k.side AND s.contractor_id IS NOT DISTINCT FROM k.contractor_id
  LEFT JOIN received r ON r.side = k.side AND r.contractor_id IS NOT DISTINCT FROM k.contractor_id
  LEFT JOIN leads l ON k.side = 'contractor' AND l.contractor_id IS NOT DISTINCT FROM k.contractor_id
  LEFT JOIN public.contractors c ON c.id = k.contractor_id
  ORDER BY k.side, c.name NULLS FIRST;
$$;

REVOKE ALL ON FUNCTION public.atelier_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_period_report(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_period_report(date, date) IS
  'Fábrica × prestador no período. Custo só do que foi conferido, no preço da linha.';
