-- =============================================================================
-- Remapeia carimbo MCP de promote_op_on_first_pointing para versão canônica
-- =============================================================================
-- Em 21/09/2026 o apply_migration do MCP gravou
-- 20260921193727_promote_op_on_first_pointing — a data real do dia, menor
-- que o corte sintético 20270101009300.
--
-- O SQL já estava no repo sob 20270101027000_promote_op_on_first_pointing,
-- mas esse carimbo NÃO chegou a ser registrado — só o MCP. Isso inflou o
-- legado de 2294 → 2295 e derrubou supabase-migrate.yml
-- (esperado 2294, encontrado 2295).
--
-- Remap (UPDATE version) em vez de DELETE+reaplicar: o trigger já está no banco.
-- Idempotente: se o canônico já existir ou o MCP stamp já tiver sumido, no-op.
-- Marcador: remap_mcp_stamp_promote_op_on_first_pointing_20270101027300
-- =============================================================================

UPDATE supabase_migrations.schema_migrations
SET version = '20270101027000',
    name = 'promote_op_on_first_pointing'
WHERE version = '20260921193727'
  AND name = 'promote_op_on_first_pointing'
  AND NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101027000'
  );
