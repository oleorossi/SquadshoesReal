
-- Drop FK constraints pointing to colors table
ALTER TABLE public.technical_sheets DROP CONSTRAINT IF EXISTS technical_sheets_cor_predominante_id_fkey;
ALTER TABLE public.technical_sheets DROP CONSTRAINT IF EXISTS technical_sheets_cor_palmilha_id_fkey;
ALTER TABLE public.technical_sheets DROP CONSTRAINT IF EXISTS technical_sheets_cor_tiras_id_fkey;
ALTER TABLE public.technical_sheets DROP CONSTRAINT IF EXISTS technical_sheets_cor_solado_id_fkey;

-- Add FK constraints pointing to product_groups table
ALTER TABLE public.technical_sheets 
  ADD CONSTRAINT technical_sheets_cor_predominante_id_fkey FOREIGN KEY (cor_predominante_id) REFERENCES public.product_groups(id),
  ADD CONSTRAINT technical_sheets_cor_palmilha_id_fkey FOREIGN KEY (cor_palmilha_id) REFERENCES public.product_groups(id),
  ADD CONSTRAINT technical_sheets_cor_tiras_id_fkey FOREIGN KEY (cor_tiras_id) REFERENCES public.product_groups(id),
  ADD CONSTRAINT technical_sheets_cor_solado_id_fkey FOREIGN KEY (cor_solado_id) REFERENCES public.product_groups(id);

-- Clear any existing color IDs that would violate the new FK (they pointed to colors, not groups)
UPDATE public.technical_sheets SET cor_predominante_id = NULL, cor_palmilha_id = NULL, cor_tiras_id = NULL, cor_solado_id = NULL WHERE cor_predominante_id IS NOT NULL OR cor_palmilha_id IS NOT NULL OR cor_tiras_id IS NOT NULL OR cor_solado_id IS NOT NULL;
