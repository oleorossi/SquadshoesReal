-- =============================================================================
-- Remove carimbo MCP duplicado abaixo do cutover
-- =============================================================================
-- Em 14/09/2026 o apply_migration do MCP gravou
-- 20260914210409_restaurar_cola_forte_14g_solado_01 — a data real do dia,
-- menor que o corte sintético 20270101009300.
--
-- O SQL já estava registrado no carimbo canônico 20270101025000 (arquivo do
-- repo). O duplicado inflou o fetch legado de 2294 para 2295 e derrubou
-- supabase-migrate.yml (esperado 2294, encontrado 2295).
--
-- Idempotente: se o carimbo já saiu, o DELETE não mexe em mais nada.
-- Marcador: drop_duplicate_mcp_stamp_20260914210409_20270101025200
-- =============================================================================

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260914210409'
  AND name = 'restaurar_cola_forte_14g_solado_01'
  AND EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101025000'
      AND canonical.name = 'restaurar_cola_forte_14g_solado_01'
  );
