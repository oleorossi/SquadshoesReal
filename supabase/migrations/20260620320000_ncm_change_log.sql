-- Audit log de mudanças de NCM em products. Mantém histórico de quem
-- mudou, quando e o valor anterior/novo. Útil pra rastrear ajustes
-- fiscais e auditoria de NF-e rejeitada por NCM incorreto.

CREATE TABLE IF NOT EXISTS public.ncm_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_ncm text,
  new_ncm text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ncm_change_log_product ON public.ncm_change_log(product_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.tg_log_ncm_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ncm IS DISTINCT FROM OLD.ncm THEN
    INSERT INTO public.ncm_change_log (product_id, old_ncm, new_ncm, changed_by)
    VALUES (NEW.id, OLD.ncm, NEW.ncm, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ncm_change ON public.products;
CREATE TRIGGER trg_log_ncm_change
  AFTER UPDATE OF ncm ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_log_ncm_change();

ALTER TABLE public.ncm_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ncm_change_log_select" ON public.ncm_change_log
  FOR SELECT TO authenticated USING (true);
