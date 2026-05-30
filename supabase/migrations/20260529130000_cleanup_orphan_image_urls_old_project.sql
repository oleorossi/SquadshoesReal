-- =============================================================================
-- CLEANUP: URLs órfãs apontando pro projeto antigo qrdvwoijghmgugejponz
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
-- Arquivo no repo pra histórico.
--
-- Contexto:
--   Em mai/2026 o sistema migrou do Supabase qrdvwoijghmgugejponz pro
--   ssvxfoybzmjlypnipqzn (CLAUDE.md). O DB foi exportado/importado mas os
--   arquivos de Storage NÃO foram migrados — ficaram no projeto antigo,
--   inacessível. As URLs no DB continuaram apontando pro host antigo
--   gerando 400/404 ao carregar.
--
-- Auditoria pré-cleanup:
--   - technical_sheets.images: 22 rows com URL antiga
--   - reference_color_variants.image_url: 22 rows com URL antiga
--   - 0 dos 22 filenames existem no novo bucket (não há recuperação)
--
-- Cleanup:
--   - technical_sheets.images: limpa array (vira [])
--   - reference_color_variants.image_url: limpa (vira '')
--
-- Frontend (commit relacionado):
--   - SignedImage agora trata erros graciosamente com placeholder visual.
--   - Default object-cover (preenche miniatura) — opt-out via fit="contain".
--
-- Outras tabelas com colunas de URL (clients.silk_url, product_groups.silk_url,
-- products.image_url, profiles.avatar_url, etc) ficam pendentes — não foi
-- detectado padrão de host antigo lá no momento da migration, mas fica como
-- backlog se algum reaparecer. O frontend já trata o erro.
-- =============================================================================

UPDATE technical_sheets
SET images = '[]'::jsonb,
    updated_at = now()
WHERE images::text LIKE '%qrdvwoijghmgugejponz%';

UPDATE reference_color_variants
SET image_url = '',
    updated_at = now()
WHERE image_url LIKE '%qrdvwoijghmgugejponz%';
