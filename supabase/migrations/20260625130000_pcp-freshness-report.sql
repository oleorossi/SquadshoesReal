-- Tema C (2026-06-25): relatório de FRESCOR do PCP — surface (read-only) das
-- costuras manuais que ficam stale, pra gestor agir antes de virar prejuízo.
--
-- C1 — ficha alterada depois do snapshot congelado: o custo/consumo da OP usa um
--   technical_sheet_snapshots congelado; se a ficha mudou depois (updated_at >
--   frozen_at) e o snapshot não foi marcado outdated, o custo está velho. (NOTIFY:
--   o gestor recalcula/reabre — não auto-mutamos OP em produção.)
-- C2 — prazo de compra da onda vencido/iminente: production_waves.purchase_deadline
--   é persistido; se a data já passou (ou está a ≤7 dias) numa onda ativa, a
--   matéria-prima corre risco de chegar tarde e parar a linha.
--
-- Mesma forma de consumption_consistency_report() (check_name, severity,
-- item_count, sample) → casa com a tela /system-diagnostics.

CREATE OR REPLACE FUNCTION public.pcp_freshness_report()
RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT DISTINCT s.sheet_id, s.sheet_name
    FROM technical_sheet_snapshots s
    JOIN technical_sheets t ON t.id = s.sheet_id
    WHERE t.updated_at > s.frozen_at AND s.outdated_at IS NULL
  ),
  overdue AS (
    SELECT code, purchase_deadline
    FROM production_waves
    WHERE purchase_deadline IS NOT NULL
      AND purchase_deadline < current_date
      AND status::text IN ('planning', 'running')
  ),
  imminent AS (
    SELECT code, purchase_deadline
    FROM production_waves
    WHERE purchase_deadline IS NOT NULL
      AND purchase_deadline BETWEEN current_date AND current_date + 7
      AND status::text IN ('planning', 'running')
  )
  SELECT 'ficha_alterada_apos_snapshot'::text, 'medio'::text,
         (SELECT count(*)::int FROM stale),
         COALESCE((SELECT string_agg(sheet_name, ' · ') FROM (SELECT sheet_name FROM stale ORDER BY sheet_name LIMIT 5) a), '—')
  UNION ALL
  SELECT 'compra_vencida_onda_ativa'::text, 'alto'::text,
         (SELECT count(*)::int FROM overdue),
         COALESCE((SELECT string_agg(code, ' · ') FROM (SELECT code FROM overdue ORDER BY purchase_deadline LIMIT 8) b), '—')
  UNION ALL
  SELECT 'compra_iminente_7d'::text, 'medio'::text,
         (SELECT count(*)::int FROM imminent),
         COALESCE((SELECT string_agg(code, ' · ') FROM (SELECT code FROM imminent ORDER BY purchase_deadline LIMIT 8) c), '—');
END;
$$;
