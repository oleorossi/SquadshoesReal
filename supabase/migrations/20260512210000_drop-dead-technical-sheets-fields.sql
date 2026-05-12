-- =============================================================================
-- 20260512210000 — DROP campos mortos restantes em technical_sheets
-- =============================================================================
-- Auditoria de dead fields (post-PR7 cleanup) identificou 5 colunas confirmadas
-- sem nenhuma leitura em código:
--
-- - suggested_price → nunca lido em parte alguma
-- - barcode         → barcode vive em material_variants, não no sheet
-- - assembly_steps  → jsonb que nunca era iterado/exibido
-- - cor_palmilha_id → FK órfã (cor_predominante_id e cor_solado_id são lidos,
--                     mas cor_palmilha_id e cor_tiras_id não)
-- - cor_tiras_id    → idem
--
-- IMPORTANTE: image_url, colors e cost_price NÃO são dropadas porque ainda
-- têm callers vivos no frontend (LabelProductionTab, ReadyStockPanel,
-- OrderDetailsModal, useReadyStock, PrintWorkSheetsPage). Mantidas pra evitar
-- 400 do PostgREST.
--
-- Frontend já foi atualizado (SheetFormData removeu suggested_price,
-- barcode, assembly_steps, cor_palmilha_id, cor_tiras_id).
-- =============================================================================

ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS suggested_price;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS barcode;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS assembly_steps;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cor_palmilha_id;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cor_tiras_id;
