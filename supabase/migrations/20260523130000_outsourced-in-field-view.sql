-- =============================================================================
-- Página /terceiros-na-rua — view unificada do que está fora da fábrica
-- =============================================================================
-- Squad Shoes tem 2 caminhos de terceirização hoje:
--   (1) service_orders — OS individual (gargalo OU artesanal)
--   (2) orders.outsourced_to_contractor_id — OP inteira terceirizada
--       (criado via CapacityOverflowDialog, sem service_order correspondente)
--
-- O gestor precisa ver TUDO que está fora da fábrica num único lugar pra
-- acompanhar prazo + atraso. Esta migration entrega:
--
--   A) Coluna nova orders.outsourced_returned_at — marca quando a OP volta
--      da rua. Sem isso, a query "ainda na rua" não consegue filtrar — todas
--      as OPs já terceirizadas no histórico apareceriam pra sempre.
--   B) VIEW v_outsourced_in_field — UNION das duas fontes com schema comum:
--      source, contractor, setor, OP, PV, modelo/cor, pares, enviado em,
--      prazo previsto, dias de atraso, status, valor.
--
-- A view é só leitura (security_invoker). Inclui apenas linhas ATIVAS
-- (status não-final + não-devolvido), porque a página é operacional.
-- Histórico fica em /terceirizados (que mostra service_orders completos).
-- =============================================================================

-- A) Marca de retorno da rua pra OPs terceirizadas via outsourced_to_contractor_id
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS outsourced_returned_at timestamptz;

COMMENT ON COLUMN public.orders.outsourced_returned_at IS
  'Data/hora em que as peças voltaram da terceirizada (OP estava com outsourced_to_contractor_id preenchido). NULL = ainda na rua.';

CREATE INDEX IF NOT EXISTS idx_orders_outsourced_in_field
  ON public.orders(outsourced_to_contractor_id)
  WHERE outsourced_to_contractor_id IS NOT NULL
    AND outsourced_returned_at IS NULL;

-- B) View unificada — duas fontes, mesmo shape
CREATE OR REPLACE VIEW public.v_outsourced_in_field
WITH (security_invoker = true) AS
WITH service_order_rows AS (
  -- Fonte 1: service_orders ativas (gargalo + artesanal sem stock_entry_done)
  -- Filtra status finalizados (em todas as variantes legacy + novas)
  SELECT
    'service_order'::text                                  AS source,
    so.id                                                  AS id,
    so.contractor_id                                       AS contractor_id,
    COALESCE(c.trade_name, c.name, '—')                    AS contractor_name,
    COALESCE(NULLIF(so.target_sector, ''), 'costura')      AS sector,
    o.id                                                   AS order_id,
    COALESCE(o.order_number, '—')                          AS op_number,
    sord.id                                                AS sale_order_id,
    COALESCE(sord.order_number, '—')                       AS sale_order_number,
    COALESCE(sord.client_name, '')                         AS client_name,
    COALESCE(ts.name, ts.code, '—')                        AS sheet_name,
    COALESCE(NULLIF(so.material_color, ''), o.color, '')   AS color,
    COALESCE(so.quantity, o.quantity, 0)::numeric          AS pairs,
    COALESCE(so.service_date, so.created_at::date)         AS sent_at,
    so.quoted_deadline                                     AS expected_back,
    CASE
      WHEN so.quoted_deadline IS NOT NULL
       AND so.quoted_deadline < CURRENT_DATE
      THEN (CURRENT_DATE - so.quoted_deadline)
      ELSE 0
    END                                                    AS days_late,
    so.status                                              AS status,
    so.unit_price                                          AS unit_price,
    so.total_value                                         AS total_value,
    so.created_at                                          AS created_at
  FROM public.service_orders so
  LEFT JOIN public.contractors  c    ON c.id    = so.contractor_id
  LEFT JOIN public.orders       o    ON o.id    = so.order_id
  LEFT JOIN public.sale_orders  sord ON sord.id = COALESCE(so.sale_order_id, o.sale_order_id)
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE so.status NOT IN (
          'Concluído','Concluido','concluido','received',
          'Cancelado','cancelled','cancelado',
          'finalizado','Finalizado'
        )
),
outsourced_op_rows AS (
  -- Fonte 2: OPs com outsourced_to_contractor_id e ainda não retornadas
  -- (sem service_order vinculada via order_id — evita duplicação com fonte 1)
  SELECT
    'outsourced_op'::text                                  AS source,
    o.id                                                   AS id,
    o.outsourced_to_contractor_id                          AS contractor_id,
    COALESCE(c.trade_name, c.name, '—')                    AS contractor_name,
    COALESCE(NULLIF(o.outsourced_sector, ''), 'costura')   AS sector,
    o.id                                                   AS order_id,
    COALESCE(o.order_number, '—')                          AS op_number,
    sord.id                                                AS sale_order_id,
    COALESCE(sord.order_number, '—')                       AS sale_order_number,
    COALESCE(sord.client_name, '')                         AS client_name,
    COALESCE(ts.name, ts.code, '—')                        AS sheet_name,
    COALESCE(o.color, '')                                  AS color,
    COALESCE(o.quantity, 0)::numeric                       AS pairs,
    COALESCE(o.outsourced_at::date, o.created_at::date)    AS sent_at,
    -- OPs terceirizadas pré-produção não têm prazo prometido formal;
    -- usa planned_delivery da OP como referência se existir.
    o.planned_delivery                                     AS expected_back,
    CASE
      WHEN o.planned_delivery IS NOT NULL
       AND o.planned_delivery < CURRENT_DATE
      THEN (CURRENT_DATE - o.planned_delivery)
      ELSE 0
    END                                                    AS days_late,
    'outsourced'::text                                     AS status,
    NULL::numeric                                          AS unit_price,
    NULL::numeric                                          AS total_value,
    o.outsourced_at                                        AS created_at
  FROM public.orders o
  LEFT JOIN public.contractors c    ON c.id    = o.outsourced_to_contractor_id
  LEFT JOIN public.sale_orders sord ON sord.id = o.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.outsourced_to_contractor_id IS NOT NULL
    AND o.outsourced_returned_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
          'Concluído','Concluido','concluido',
          'Entregue','entregue',
          'Cancelado','cancelled','cancelado'
        )
    -- Evita duplicar: se já existe service_order ativa pra essa OP, ignora aqui
    AND NOT EXISTS (
      SELECT 1 FROM public.service_orders so2
      WHERE so2.order_id = o.id
        AND so2.status NOT IN (
              'Concluído','Concluido','concluido','received',
              'Cancelado','cancelled','cancelado',
              'finalizado','Finalizado'
            )
    )
)
SELECT * FROM service_order_rows
UNION ALL
SELECT * FROM outsourced_op_rows;

COMMENT ON VIEW public.v_outsourced_in_field IS
  'Visão unificada do que está fora da fábrica AGORA. Une service_orders ativas + orders.outsourced_to_contractor_id ainda não retornadas. Usado pela página /terceiros-na-rua.';

GRANT SELECT ON public.v_outsourced_in_field TO authenticated;
