-- =============================================================================
-- /terceirizados/relatorios — métricas agregadas por contractor
-- =============================================================================
-- Página de relatório precisa de números agregados: quantas OSs no período,
-- quanto pagou, taxa de pontualidade, atraso médio. Centralizar em VIEW
-- pra evitar 4 queries diferentes na UI.
--
-- Definições de pontualidade:
--   • on_time      → status='received' E (receipt_generated_at <= quoted_deadline OR quoted_deadline IS NULL)
--   • late         → status='received' E receipt_generated_at > quoted_deadline
--   • open_overdue → status NÃO finalizado E quoted_deadline < CURRENT_DATE
--   • open_on_time → status NÃO finalizado E (quoted_deadline >= CURRENT_DATE OR NULL)
--
-- A view retorna 1 linha por contractor com agregados desde o início do tempo.
-- Filtros de período (mês corrente, últimos 30 dias, etc.) ficam no frontend
-- via consulta com WHERE em service_orders.created_at + GROUP BY contractor_id.
--
-- Uma segunda view v_contractor_history_orders expõe linha por OS já
-- finalizada (received/Concluído) com os campos pra tabela do relatório.
-- =============================================================================

-- Métricas agregadas all-time por contractor
CREATE OR REPLACE VIEW public.v_contractor_metrics
WITH (security_invoker = true) AS
SELECT
  c.id                                                   AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  c.service_type                                         AS service_type,
  c.active                                               AS active,
  COUNT(so.id)                                           AS total_orders,
  COUNT(so.id) FILTER (
    WHERE so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado')
  )                                                      AS completed_orders,
  COUNT(so.id) FILTER (
    WHERE so.status IN ('Cancelado','cancelled','cancelado')
  )                                                      AS cancelled_orders,
  COUNT(so.id) FILTER (
    WHERE so.status NOT IN (
      'Concluído','Concluido','concluido','received','finalizado','Finalizado',
      'Cancelado','cancelled','cancelado'
    )
  )                                                      AS open_orders,
  -- Pontualidade (apenas OSs já recebidas com prazo definido)
  COUNT(so.id) FILTER (
    WHERE so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado')
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline
  )                                                      AS on_time_count,
  COUNT(so.id) FILTER (
    WHERE so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado')
      AND so.quoted_deadline IS NOT NULL
      AND COALESCE(so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
  )                                                      AS late_count,
  COUNT(so.id) FILTER (
    WHERE so.status NOT IN (
      'Concluído','Concluido','concluido','received','finalizado','Finalizado',
      'Cancelado','cancelled','cancelado'
    )
    AND so.quoted_deadline IS NOT NULL
    AND so.quoted_deadline < CURRENT_DATE
  )                                                      AS open_overdue_count,
  -- Atraso médio em dias (somente OSs recebidas com atraso)
  COALESCE(AVG(
    CASE
      WHEN so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado')
       AND so.quoted_deadline IS NOT NULL
       AND COALESCE(so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
      THEN COALESCE(so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
    END
  ), 0)::numeric(10,1)                                   AS avg_late_days,
  -- Valor agregado
  COALESCE(SUM(
    CASE WHEN so.status NOT IN ('Cancelado','cancelled','cancelado')
    THEN so.total_value ELSE 0 END
  ), 0)                                                  AS total_value_all,
  COALESCE(SUM(
    CASE WHEN so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado')
    THEN so.total_value ELSE 0 END
  ), 0)                                                  AS total_value_paid,
  COALESCE(SUM(
    CASE WHEN so.status NOT IN (
      'Concluído','Concluido','concluido','received','finalizado','Finalizado',
      'Cancelado','cancelled','cancelado'
    )
    THEN so.total_value ELSE 0 END
  ), 0)                                                  AS total_value_open,
  COALESCE(SUM(
    CASE WHEN so.status NOT IN ('Cancelado','cancelled','cancelado')
    THEN so.quantity ELSE 0 END
  ), 0)                                                  AS total_quantity,
  MAX(so.created_at)                                     AS last_order_at
FROM public.contractors c
LEFT JOIN public.service_orders so ON so.contractor_id = c.id
GROUP BY c.id, c.trade_name, c.name, c.service_type, c.active;

COMMENT ON VIEW public.v_contractor_metrics IS
  'Métricas all-time agregadas por contractor. Usado pelo dashboard de relatórios em /terceirizados/relatorios. Filtro de período aplica-se no frontend via query auxiliar em service_orders.';

GRANT SELECT ON public.v_contractor_metrics TO authenticated;

-- View histórica: 1 linha por OS finalizada (pra tabela do relatório com filtro de período)
CREATE OR REPLACE VIEW public.v_contractor_history_orders
WITH (security_invoker = true) AS
SELECT
  so.id                                                  AS id,
  so.contractor_id                                       AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  so.order_number                                        AS order_number,
  so.receipt_number                                      AS receipt_number,
  so.description                                         AS description,
  COALESCE(NULLIF(so.target_sector, ''), 'costura')      AS sector,
  so.service_date                                        AS service_date,
  so.quoted_deadline                                     AS quoted_deadline,
  COALESCE(so.receipt_generated_at, so.updated_at)       AS finished_at,
  so.quantity                                            AS quantity,
  so.unit_price                                          AS unit_price,
  so.total_value                                         AS total_value,
  so.status                                              AS status,
  CASE
    WHEN so.quoted_deadline IS NULL THEN 'no_deadline'
    WHEN COALESCE(so.receipt_generated_at::date, so.updated_at::date) <= so.quoted_deadline THEN 'on_time'
    ELSE 'late'
  END                                                    AS punctuality,
  CASE
    WHEN so.quoted_deadline IS NOT NULL
     AND COALESCE(so.receipt_generated_at::date, so.updated_at::date) > so.quoted_deadline
    THEN COALESCE(so.receipt_generated_at::date, so.updated_at::date) - so.quoted_deadline
    ELSE 0
  END                                                    AS days_late,
  (so.artisanal_recipe_id IS NOT NULL)                   AS is_artisanal,
  so.materials_sent                                      AS materials_sent,
  so.signed_photo_url                                    AS signed_photo_url,
  so.created_at                                          AS created_at
FROM public.service_orders so
LEFT JOIN public.contractors c ON c.id = so.contractor_id
WHERE so.status IN ('Concluído','Concluido','concluido','received','finalizado','Finalizado');

COMMENT ON VIEW public.v_contractor_history_orders IS
  'Histórico de OSs finalizadas por contractor (received/Concluído). Usado pela tabela da página /terceirizados/relatorios. Frontend aplica filtros adicionais (período, contractor) via WHERE.';

GRANT SELECT ON public.v_contractor_history_orders TO authenticated;

-- Garante bucket de Storage pra fotos do recibo assinado (caso ainda não exista)
INSERT INTO storage.buckets (id, name, public)
VALUES ('service-orders', 'service-orders', false)
ON CONFLICT (id) DO NOTHING;

-- RLS pro bucket — apenas usuários autenticados podem ler/escrever
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'service_orders_authenticated_select'
  ) THEN
    CREATE POLICY service_orders_authenticated_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'service-orders');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'service_orders_authenticated_insert'
  ) THEN
    CREATE POLICY service_orders_authenticated_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'service-orders');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'service_orders_authenticated_update'
  ) THEN
    CREATE POLICY service_orders_authenticated_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'service-orders');
  END IF;
END $$;
