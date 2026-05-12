-- =============================================================================
-- 20260512210000 — DROP campos mortos restantes em technical_sheets
-- =============================================================================
-- Auditoria de dead fields (post-PR7 cleanup) identificou 8 colunas com zero
-- leitura em business logic / UI:
--
-- - colors          → substituído por color_images (jsonb com galeria de fotos por cor)
-- - image_url       → substituído por images (jsonb array)
-- - cost_price      → custo nunca exibido nem usado (só sale_price é lido)
-- - suggested_price → nunca lido em parte alguma
-- - barcode         → barcode vive em material_variants, não no sheet
-- - assembly_steps  → jsonb que nunca era iterado/exibido
-- - cor_palmilha_id → FK órfã (cor_predominante_id + cor_solado_id são lidos)
-- - cor_tiras_id    → FK órfã (idem)
--
-- Frontend já foi atualizado (SheetFormData removeu esses campos).
-- =============================================================================

ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS colors;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS image_url;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cost_price;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS suggested_price;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS barcode;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS assembly_steps;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cor_palmilha_id;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cor_tiras_id;
