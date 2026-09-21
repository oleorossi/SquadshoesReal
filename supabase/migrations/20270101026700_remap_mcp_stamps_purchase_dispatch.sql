-- =============================================================================
-- Remapeia carimbos MCP de purchase dispatch para versões canônicas
-- =============================================================================
-- Em 21/09/2026 o apply_migration do MCP gravou:
--   20260921152419_purchase_dispatch_setup_and_pv_labels
--   20260921153257_refresh_po_dispatch_on_outbox_update
-- com a data real do dia (abaixo do corte sintético 20270101009300).
--
-- O SQL já estava no repo sob os carimbos canônicos:
--   20270101026500_purchase_dispatch_setup_and_pv_labels
--   20270101026600_refresh_po_dispatch_on_outbox_update
-- mas esses NÃO chegaram a ser registrados em schema_migrations — só os
-- carimbos MCP. Isso inflou o legado de 2294 → 2296 e deixou o wait de
-- produção pedindo 26500/26600 que "faltavam" no pós-cutover.
--
-- Remap (UPDATE version) em vez de DELETE+reaplicar: o SQL já está no banco.
-- Idempotente: se o canônico já existir ou o MCP stamp já tiver sumido, no-op.
-- Marcador: remap_mcp_stamps_purchase_dispatch_20270101026700
-- =============================================================================

UPDATE supabase_migrations.schema_migrations
SET version = '20270101026500',
    name = 'purchase_dispatch_setup_and_pv_labels'
WHERE version = '20260921152419'
  AND name = 'purchase_dispatch_setup_and_pv_labels'
  AND NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101026500'
  );

UPDATE supabase_migrations.schema_migrations
SET version = '20270101026600',
    name = 'refresh_po_dispatch_on_outbox_update'
WHERE version = '20260921153257'
  AND name = 'refresh_po_dispatch_on_outbox_update'
  AND NOT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations canonical
    WHERE canonical.version = '20270101026600'
  );
