-- payroll_runs ganha os PARES produzidos do período (regime por par).
--
-- Por quê: a folha guarda só dinheiro e minutos. Para quem é pago por par, a
-- BASE do valor são os pares — e eles só existiam como texto dentro de `notes`
-- ("Por par: 3468 pares (…)"). Holerite, recibo assinado e histórico de
-- pagamentos precisam desse número; nenhum deles pode depender de reprocessar a
-- Ficha de Montadores (o recibo é emitido meses depois, e o valor tem de ser o
-- que foi PAGO, não o que a ficha diz hoje).
--
-- `business_days_worked` já guarda os DIAS PRODUTIVOS neste regime (ver
-- Payroll.tsx) — por isso não há coluna nova para dias.

ALTER TABLE public.payroll_runs
  ADD COLUMN IF NOT EXISTS pares_medio   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pares_dificil numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_runs.pares_medio   IS 'Pares MÉDIOS do período (regime por par). 0 nos demais regimes.';
COMMENT ON COLUMN public.payroll_runs.pares_dificil IS 'Pares DIFÍCEIS do período (regime por par). 0 nos demais regimes.';

-- Backfill das folhas em rascunho já recalculadas pela migration anterior,
-- usando a MESMA agregação (fallback: linha sem detalhe = total em médio).
WITH periodo AS (
  SELECT pr.id, pr.employee_id,
         CASE WHEN pr.period ~ '^\d{4}-\d{2}$'
              THEN to_date(pr.period || '-01', 'YYYY-MM-DD')
              ELSE to_date(split_part(pr.period, '_', 1), 'YYYY-MM-DD') END AS d_from,
         CASE WHEN pr.period ~ '^\d{4}-\d{2}$'
              THEN (to_date(pr.period || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
              ELSE to_date(split_part(pr.period, '_', 2), 'YYYY-MM-DD') END AS d_to
    FROM payroll_runs pr
    JOIN employees e ON e.id = pr.employee_id
   WHERE e.payment_type = 'producao'
     AND pr.status = 'rascunho'
),
agg AS (
  SELECT p.id,
         COALESCE(SUM(
           CASE WHEN f.detalhe IS NULL OR jsonb_array_length(f.detalhe) = 0
                THEN COALESCE(f.total, 0)
                ELSE (SELECT COALESCE(SUM(COALESCE((d->>'medio')::numeric, (d->>'pares')::numeric, 0)), 0)
                        FROM jsonb_array_elements(f.detalhe) d) END), 0) AS pmed,
         COALESCE(SUM(
           CASE WHEN f.detalhe IS NULL OR jsonb_array_length(f.detalhe) = 0 THEN 0
                ELSE (SELECT COALESCE(SUM(COALESCE((d->>'dificil')::numeric, 0)), 0)
                        FROM jsonb_array_elements(f.detalhe) d) END), 0) AS pdif
    FROM periodo p
    LEFT JOIN ficha_montadores f
           ON f.montador_id = p.employee_id
          AND COALESCE(f.origem, 'chamada') = 'chamada'
          AND f.dia BETWEEN p.d_from AND p.d_to
   GROUP BY p.id
)
UPDATE payroll_runs pr
   SET pares_medio = agg.pmed, pares_dificil = agg.pdif
  FROM agg WHERE pr.id = agg.id;
