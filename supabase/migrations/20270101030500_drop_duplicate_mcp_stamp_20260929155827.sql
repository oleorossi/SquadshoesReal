-- =============================================================================
-- Remove carimbo MCP duplicado abaixo do cutover
-- =============================================================================
-- Em 29/09/2026 o apply_migration do MCP gravou
-- 20260929155827_pdf_queue_file_size_100mb — a data real do dia, menor
-- que o corte sintético 20270101009300.
--
-- O SQL já estava registrado no carimbo canônico 20270101030400 (arquivo do
-- repo). O duplicado inflou o fetch legado de 2295 para 2296 e derrubou
-- supabase-migrate.yml (esperado 2295, encontrado 2296).
--
-- Idempotente: se o carimbo já saiu, o DELETE não mexe em mais nada.
-- Marcador: drop_duplicate_mcp_stamp_20260929155827_20270101030500
-- =============================================================================

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260929155827'
  AND name = 'pdf_queue_file_size_100mb'
  AND EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101030400'
      AND canonical.name = 'pdf_queue_file_size_100mb'
  );
