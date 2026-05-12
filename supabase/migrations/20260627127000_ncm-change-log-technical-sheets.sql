-- =============================================================================
-- 20260627127000 — NCM change log também em technical_sheets (M4)
-- =============================================================================
--
-- Bug M4 da auditoria: o emit-nfe lê NCM de technical_sheets.ncm
-- (linha 184: `it._variant?.ncm || it.technical_sheets?.ncm`), mas o trigger
-- de log de mudanças (20260620320000) só monitora products.ncm. Se alguém
-- editar technical_sheets.ncm direto, mudança fica sem trilha.
--
-- Fix: adiciona coluna technical_sheet_id à ncm_change_log (nullable) e cria
-- trigger paralelo em technical_sheets.

ALTER TABLE public.ncm_change_log
  ADD COLUMN IF NOT EXISTS technical_sheet_id uuid REFERENCES public.technical_sheets(id) ON DELETE CASCADE;

-- product_id já era NOT NULL — relaxa pra permitir log só de ficha técnica
ALTER TABLE public.ncm_change_log
  ALTER COLUMN product_id DROP NOT NULL;

-- Garante que pelo menos um dos dois esteja setado
ALTER TABLE public.ncm_change_log
  DROP CONSTRAINT IF EXISTS ncm_change_log_target_chk;
ALTER TABLE public.ncm_change_log
  ADD CONSTRAINT ncm_change_log_target_chk
  CHECK (product_id IS NOT NULL OR technical_sheet_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ncm_change_log_sheet
  ON public.ncm_change_log(technical_sheet_id, changed_at DESC)
  WHERE technical_sheet_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_log_ncm_change_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ncm IS DISTINCT FROM OLD.ncm THEN
    INSERT INTO public.ncm_change_log (technical_sheet_id, old_ncm, new_ncm, changed_by)
    VALUES (NEW.id, OLD.ncm, NEW.ncm, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ncm_change_sheet ON public.technical_sheets;
CREATE TRIGGER trg_log_ncm_change_sheet
  AFTER UPDATE OF ncm ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_log_ncm_change_sheet();
