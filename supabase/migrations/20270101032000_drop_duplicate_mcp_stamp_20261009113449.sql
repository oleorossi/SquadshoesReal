-- =============================================================================
-- Remove carimbo MCP duplicado abaixo do cutover
-- =============================================================================
-- Em 09/10/2026 o apply_migration do MCP gravou
-- 20261009113449_pv_sku_acabado_buy_ready_sem_variante — a data real do dia,
-- menor que o corte sintético 20270101009300.
--
-- O SQL já estava registrado no carimbo canônico 20270101031900 (arquivo do
-- repo). O duplicado inflou o fetch legado de 2295 para 2296 e derrubou
-- supabase-migrate.yml (esperado 2295, encontrado 2296).
--
-- Idempotente: se o carimbo já saiu, o DELETE não mexe em mais nada.
-- Marcador: drop_duplicate_mcp_stamp_20261009113449_20270101032000
-- =============================================================================

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261009113449'
  AND name = 'pv_sku_acabado_buy_ready_sem_variante'
  AND EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101031900'
      AND canonical.name = 'pv-sku-acabado-buy-ready-sem-variante'
  );
