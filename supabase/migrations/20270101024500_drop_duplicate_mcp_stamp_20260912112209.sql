-- =============================================================================
-- Remove carimbo MCP duplicado abaixo do cutover
-- =============================================================================
-- Em 12/09/2026 o apply_migration do MCP gravou
-- 20260912112209_refresh_draft_strap_freeze_on_confirm — a data real do dia,
-- menor que o corte sintético 20270101009300.
--
-- O SQL já estava registrado no carimbo canônico 20270101023800 (arquivo do
-- repo). O duplicado inflou o fetch legado de 2294 para 2295 e derrubou
-- supabase-migrate.yml + o check "Supabase Preview" (versão remota sem arquivo
-- local).
--
-- Idempotente: se o carimbo já saiu, o DELETE não mexe em mais nada.
-- Marcador: drop_duplicate_mcp_stamp_20260912112209_20270101024500
-- =============================================================================

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260912112209'
  AND name = 'refresh_draft_strap_freeze_on_confirm'
  AND EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101023800'
      AND canonical.name = 'refresh_draft_strap_freeze_on_confirm'
  );
