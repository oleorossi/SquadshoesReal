-- ============================================================================
-- DIAGNÓSTICO: Quais Grupos de migrations ainda precisam ser aplicados?
-- ============================================================================
-- Cole este script INTEIRO no SQL Editor do Supabase e clique Run.
-- A saída diz, para cada Grupo (1 a 11), se ele JÁ ESTÁ APLICADO ou se PRECISA ser aplicado.
-- Rode este antes de qualquer 00a/00b/00c/01 — economiza 5-15min de aplicação desnecessária.
--
-- URL: https://supabase.com/dashboard/project/qrdvwoijghmgugejponz/sql/new
-- ============================================================================

DO $$
DECLARE
  v_status TEXT;
BEGIN
  RAISE NOTICE '╔════════════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║           DIAGNÓSTICO DE MIGRATIONS PENDENTES                      ║';
  RAISE NOTICE '╚════════════════════════════════════════════════════════════════════╝';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 1 — Correções anteriores
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 1' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'restore_product_stocks_for_order')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00a_grupos_1_2.sql'
  END AS status,
  'fix-sole-double-debit, production-wave-engine, perf-restore-stocks, erp-improvements, supplier-price-history' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 2 — Pendentes confirmadas (parte do 00a também)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 2' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'adjust_stock')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'work_schedules' AND column_name = 'minimum_overtime_minutes')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00a_grupos_1_2.sql'
  END AS status,
  'strap-color-fallback, minimum-overtime, artisanal-recipes, consumption-per-size, packaging-debit, adjust_stock RPC' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 3 — Conjugações de solado
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 3' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sole_size_conjugations')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_sole_size_key')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00b_grupos_3_4.sql'
  END AS status,
  'consumption-per-size primary, sole-size-conjugations, conjugation-debit-fallback' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 4 — NF-e + cronograma de mesa
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 4' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'production_waves' AND column_name = 'earliest_deadline')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'import_time_records_safe')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00b_grupos_3_4.sql'
  END AS status,
  'mesa-sector-planning, block-rascunho-wave, nfe-companies, wave-material-intelligence, time-records-safe' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 5 — Corte a Faca
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 5' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'technical_sheets' AND column_name = 'corte_a_faca')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00c_grupos_5_a_8.sql'
  END AS status,
  'add-corte-a-faca em technical_sheets' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 6 — Consumo por grade
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 6' AS grupo,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'calculate_order_consumption_by_grade'
        AND prosrc LIKE '%insole_has_lining%'
    )
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00c_grupos_5_a_8.sql'
  END AS status,
  'fix-consumption-by-grade-per-size, fix-conjugated-debit-strict' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 7 — RLS policies
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 7' AS grupo,
  CASE
    WHEN (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') > 50
      AND EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'baus' AND rowsecurity = true)
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00c_grupos_5_a_8.sql'
  END AS status,
  'RLS policies idempotentes em 19 tabelas + RLS habilitado em baus, box_types, etc.' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 8 — Modelos de construção
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 8' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'technical_sheets' AND column_name = 'mesa_daily_capacity')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'technical_sheets' AND column_name = 'insole_ready_made')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'product_groups' AND column_name = 'insole_included')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/00c_grupos_5_a_8.sql'
  END AS status,
  'mesa_daily_capacity, insole_ready_made, insole_included em product_groups' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 9 — Custo do pedido com embalagem
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 9' AS grupo,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'calculate_order_cost'
        AND prosrc LIKE '%packaging_cost%'
    )
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/01_apply_pending_migrations.sql'
  END AS status,
  'fix-order-cost-packaging-and-grade (margem 2-5% inflada se faltar)' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 10 — Atomicidade e edição manual
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 10' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'debit_packaging_for_order_atomic')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'clients' AND column_name = 'endereco_manual_override')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recalc_sale_order_total')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/01_apply_pending_migrations.sql'
  END AS status,
  'debit_packaging_atomic, address-manual-override, mrp-status-lower, sale-order-total-trigger, backfill order_costs' AS conteudo;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRUPO 11 — Resync atômico
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'GRUPO 11' AS grupo,
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'resync_queue')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'resync_op_atomic')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_resync_queue')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'production_consumptions' AND column_name = 'superseded_at')
      THEN '✅ APLICADO'
    ELSE '❌ FALTANDO — rodar scripts/01_apply_pending_migrations.sql'
  END AS status,
  'resync_queue table, resync_op_atomic RPC, process_resync_queue RPC, superseded_at coluna' AS conteudo;

-- ============================================================================
-- RESUMO FINAL — quais scripts você precisa rodar
-- ============================================================================
DO $$
DECLARE
  v_falta_00a BOOLEAN := NOT (EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'restore_product_stocks_for_order')
                              AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'adjust_stock'));
  v_falta_00b BOOLEAN := NOT (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sole_size_conjugations')
                              AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'companies'));
  v_falta_00c BOOLEAN := NOT (EXISTS (SELECT 1 FROM information_schema.columns
                                      WHERE table_name = 'technical_sheets' AND column_name = 'mesa_daily_capacity'));
  v_falta_01 BOOLEAN := NOT (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'resync_queue'));
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════ RESUMO ═══════════════════════';
  IF v_falta_00a THEN RAISE NOTICE '  📜 00a_grupos_1_2.sql       — RODAR (1381 linhas)'; ELSE RAISE NOTICE '  ✓ 00a_grupos_1_2          — já aplicado'; END IF;
  IF v_falta_00b THEN RAISE NOTICE '  📜 00b_grupos_3_4.sql       — RODAR (1738 linhas)'; ELSE RAISE NOTICE '  ✓ 00b_grupos_3_4          — já aplicado'; END IF;
  IF v_falta_00c THEN RAISE NOTICE '  📜 00c_grupos_5_a_8.sql     — RODAR (1128 linhas)'; ELSE RAISE NOTICE '  ✓ 00c_grupos_5_a_8        — já aplicado'; END IF;
  IF v_falta_01  THEN RAISE NOTICE '  📜 01_apply_pending_migrations.sql — RODAR (976 linhas)'; ELSE RAISE NOTICE '  ✓ 01_apply_pending        — já aplicado'; END IF;
  RAISE NOTICE '═════════════════════════════════════════════════════';

  IF NOT (v_falta_00a OR v_falta_00b OR v_falta_00c OR v_falta_01) THEN
    RAISE NOTICE '🎉 TUDO APLICADO! Nenhuma ação necessária.';
  ELSE
    RAISE NOTICE 'Aplique na ORDEM acima (mais antigo primeiro).';
    RAISE NOTICE 'Rode scripts/02_verify_pending_migrations.sql ao final.';
  END IF;
  RAISE NOTICE '';
END $$;
