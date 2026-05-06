-- 1) Novo campo: distingue corte do cabedal x corte de palmilha/forro
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS requires_cutting_cabedal boolean NOT NULL DEFAULT true;

-- 2) Atualiza a função de sincronização do roteiro
DROP FUNCTION IF EXISTS public.sync_construction_routing() CASCADE;
CREATE OR REPLACE FUNCTION public.sync_construction_routing()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.construction_type = 'corte_fio' THEN
    -- Corte a fio: corta cabedal + palmilha, sem costura
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := true;
    NEW.requires_sewing := false;
    NEW.has_straps := false;
  ELSIF NEW.construction_type = 'corte_costura' THEN
    -- Corte + costura: corta cabedal + palmilha, com costura
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := true;
    NEW.requires_sewing := true;
    NEW.has_straps := false;
  ELSIF NEW.construction_type = 'tiras' THEN
    -- Tiras: cabedal NÃO é cortado, mas palmilha/forro SIM continuam sendo cortados
    NEW.requires_cutting := true;            -- mantém corte ativo (palmilha/forro)
    NEW.requires_cutting_cabedal := false;   -- pula corte do cabedal
    NEW.requires_sewing := false;
    NEW.has_straps := true;
  ELSIF NEW.construction_type = 'misto' THEN
    -- Misto: mantém valores explícitos do usuário (corte + tiras, etc.)
    NEW.requires_cutting := true;
    NEW.requires_cutting_cabedal := COALESCE(NEW.requires_cutting_cabedal, true);
    NEW.has_straps := true;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Backfill: ajusta fichas existentes do tipo 'tiras' para a nova semântica
UPDATE public.technical_sheets
SET
  requires_cutting = true,
  requires_cutting_cabedal = false
WHERE construction_type = 'tiras';

UPDATE public.technical_sheets
SET requires_cutting_cabedal = true
WHERE construction_type IN ('corte_fio', 'corte_costura')
  AND requires_cutting_cabedal IS DISTINCT FROM true;

-- 4) Índice complementar
CREATE INDEX IF NOT EXISTS idx_technical_sheets_cabedal_cut
  ON public.technical_sheets(requires_cutting_cabedal);