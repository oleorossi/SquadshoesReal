-- Tipo de construção do cabedal e marcadores de roteiro
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS construction_type text NOT NULL DEFAULT 'corte_costura',
  ADD COLUMN IF NOT EXISTS requires_cutting boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_sewing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS has_straps boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_colored_lining boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS colored_lining_mode text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS insole_color_mode text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS max_insole_colors integer NOT NULL DEFAULT 3;

-- Constraints de domínio
ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_construction_type_check;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_construction_type_check
  CHECK (construction_type IN ('corte_fio', 'corte_costura', 'tiras', 'misto'));

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_colored_lining_mode_check;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_colored_lining_mode_check
  CHECK (colored_lining_mode IN ('standard', 'follows_variant', 'manual_mapping'));

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_insole_color_mode_check;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_insole_color_mode_check
  CHECK (insole_color_mode IN ('single', 'follows_lining', 'restricted_palette', 'free'));

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_max_insole_colors_check;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_max_insole_colors_check
  CHECK (max_insole_colors > 0 AND max_insole_colors <= 20);

-- Função: sincroniza flags de roteiro com construction_type
CREATE OR REPLACE FUNCTION public.sync_construction_routing()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.construction_type = 'corte_fio' THEN
    NEW.requires_cutting := true;
    NEW.requires_sewing := false;
    NEW.has_straps := false;
  ELSIF NEW.construction_type = 'corte_costura' THEN
    NEW.requires_cutting := true;
    NEW.requires_sewing := true;
    NEW.has_straps := false;
  ELSIF NEW.construction_type = 'tiras' THEN
    NEW.requires_cutting := false;
    NEW.requires_sewing := false;
    NEW.has_straps := true;
  ELSIF NEW.construction_type = 'misto' THEN
    -- Misto: mantém valores explícitos do usuário (corte + tiras, etc.)
    NEW.has_straps := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_construction_routing ON public.technical_sheets;
CREATE TRIGGER trg_sync_construction_routing
  BEFORE INSERT OR UPDATE OF construction_type ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_construction_routing();

-- Índice para filtros de roteiro produtivo
CREATE INDEX IF NOT EXISTS idx_technical_sheets_construction
  ON public.technical_sheets(construction_type);
CREATE INDEX IF NOT EXISTS idx_technical_sheets_routing
  ON public.technical_sheets(requires_cutting, requires_sewing, has_straps);