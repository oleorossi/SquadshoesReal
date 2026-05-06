-- =================================================================
-- 02_verify_pending_migrations.sql
--
-- Queries de verificação para confirmar que as 7 migrations pendentes
-- foram aplicadas com sucesso. Cada bloco retorna OK/FALTANDO numa
-- coluna `status`. Pode ser colado inteiro no SQL Editor — cada
-- bloco é isolado por título.
-- =================================================================

-- ── 1. Verifica que calculate_order_cost soma packaging ────────────
-- Esperado: prosrc da função contém 'v_packaging' e 'packaging_cost_per_pair'
SELECT
  CASE
    WHEN prosrc LIKE '%v_packaging%' AND prosrc LIKE '%packaging_cost_per_pair%' THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504120000'
  END AS check_calculate_order_cost_packaging
FROM pg_proc
WHERE proname = 'calculate_order_cost'
  AND pronamespace = 'public'::regnamespace;

-- ── 2. Verifica que calculate_order_cost usa grade quando disponível ──
SELECT
  CASE
    WHEN prosrc LIKE '%calculate_order_consumption_by_grade%' THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504120000'
  END AS check_calculate_order_cost_grade
FROM pg_proc
WHERE proname = 'calculate_order_cost'
  AND pronamespace = 'public'::regnamespace;

-- ── 3. Verifica RPC atômica de débito de embalagem ─────────────────
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504130000'
  END AS check_atomic_packaging_rpc
FROM pg_proc
WHERE proname = 'debit_packaging_for_order_atomic'
  AND pronamespace = 'public'::regnamespace;

-- ── 4. Verifica colunas de override manual em clients ──────────────
SELECT
  CASE
    WHEN COUNT(*) FILTER (WHERE column_name = 'endereco_manual_override') = 1
     AND COUNT(*) FILTER (WHERE column_name = 'endereco_updated_at') = 1
    THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504140000'
  END AS check_clients_address_override
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'clients'
  AND column_name IN ('endereco_manual_override', 'endereco_updated_at');

-- ── 5. Verifica trigger de tracking de edição manual ───────────────
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504140000'
  END AS check_trigger_address_manual_edit
FROM pg_trigger
WHERE tgname = 'trg_track_client_address_manual_edit';

-- ── 6. Verifica fn_projected_demand com status case-insensitive ────
SELECT
  CASE
    WHEN prosrc ~* 'lower\s*\(\s*coalesce\s*\(\s*so\.status' THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504150000'
  END AS check_mrp_status_lower
FROM pg_proc
WHERE proname = 'fn_projected_demand'
  AND pronamespace = 'public'::regnamespace;

-- ── 7. Verifica trigger de integridade de sale_orders.total ────────
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504160000'
  END AS check_sale_order_total_trigger
FROM pg_trigger
WHERE tgname = 'trg_sync_sale_order_total';

-- ── 8. Verifica RPC recalc_sale_order_total ────────────────────────
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504160000'
  END AS check_recalc_sale_order_total_rpc
FROM pg_proc
WHERE proname = 'recalc_sale_order_total'
  AND pronamespace = 'public'::regnamespace;

-- ── 9. Verifica integridade pós-backfill: sale_orders.total = SUM(itens) ──
-- Esperado: 0 pedidos divergentes após o backfill da migration 20260504160000
SELECT
  COUNT(*) AS pedidos_com_total_divergente,
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'FALHA — backfill não executou' END AS status
FROM (
  SELECT
    so.id,
    so.total,
    COALESCE(SUM(soi.quantity * soi.unit_price), 0) AS sum_itens
  FROM public.sale_orders so
  LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  GROUP BY so.id, so.total
  HAVING ABS(COALESCE(so.total, 0) - COALESCE(SUM(soi.quantity * soi.unit_price), 0)) > 0.01
) divergentes;

-- ── 10. Verifica tabela resync_queue ───────────────────────────────
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504180000'
  END AS check_resync_queue_table
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'resync_queue';

-- ── 11. Verifica RPCs de resync atômico ────────────────────────────
SELECT
  CASE
    WHEN COUNT(*) FILTER (WHERE proname = 'resync_op_atomic') = 1
     AND COUNT(*) FILTER (WHERE proname = 'process_resync_queue') = 1
    THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504180000'
  END AS check_resync_rpcs
FROM pg_proc
WHERE proname IN ('resync_op_atomic', 'process_resync_queue')
  AND pronamespace = 'public'::regnamespace;

-- ── 12. Verifica triggers de cobertura de resync ───────────────────
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  CASE WHEN tgenabled = 'O' THEN 'OK' ELSE 'DESABILITADO' END AS status
FROM pg_trigger
WHERE tgname IN (
  'trg_resync_for_sole_conjugation',
  'trg_resync_for_palmilha_colors',
  'trg_resync_for_artisanal_recipe'
)
ORDER BY tgname;

-- ── 13. Verifica colunas superseded em production_consumptions ─────
SELECT
  CASE
    WHEN COUNT(*) FILTER (WHERE column_name = 'superseded_at') = 1
     AND COUNT(*) FILTER (WHERE column_name = 'superseded_reason') = 1
    THEN 'OK'
    ELSE 'FALTANDO — aplicar 20260504180000'
  END AS check_production_consumptions_superseded
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'production_consumptions'
  AND column_name IN ('superseded_at', 'superseded_reason');

-- ── 14. Estatísticas pós-aplicação ─────────────────────────────────
-- Quantos pedidos ativos e quantos já têm order_costs persistido
SELECT
  COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) NOT IN
    ('cancelado','cancelada','cancelled','entregue','delivered',
     'finalizado','finalizada','finished','completed',
     'faturado','faturada','invoiced')) AS pedidos_ativos,
  (SELECT COUNT(*) FROM public.order_costs) AS order_costs_total,
  (SELECT COUNT(*) FROM public.order_costs WHERE breakdown ? 'packaging_per_pair') AS order_costs_com_packaging,
  (SELECT COUNT(*) FROM public.order_costs WHERE (breakdown->>'used_grade')::boolean) AS order_costs_com_grade
FROM public.sale_orders;
