-- FASE 2: funções SQL respeitam o tipo de solado
--
-- 1. resolve_palmilha_color: mapeia cor cabedal → cor palmilha pronta (Tipo 2)
-- 2. tg_sync_insole_consumption_unit: trigger que mantém insole_consumption_unit
--    coordenado com insole_ready_made + sole_classification do solado vinculado

CREATE OR REPLACE FUNCTION public.resolve_palmilha_color(
  p_sheet_id uuid,
  p_cabedal_color text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_palm text;
BEGIN
  IF p_sheet_id IS NULL OR p_cabedal_color IS NULL THEN
    RETURN '';
  END IF;

  SELECT palmilha_color INTO v_palm
    FROM public.technical_sheet_palmilha_colors
   WHERE sheet_id = p_sheet_id
     AND lower(unaccent(trim(cabedal_color))) = lower(unaccent(trim(p_cabedal_color)))
   LIMIT 1;

  RETURN COALESCE(v_palm, '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_palmilha_color(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_sync_insole_consumption_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sole_class text;
BEGIN
  IF NEW.insole_ready_made = true THEN
    NEW.insole_consumption_unit := 'un';
    RETURN NEW;
  END IF;

  IF NEW.sole_group_id IS NOT NULL THEN
    SELECT MAX(sole_classification::text) INTO v_sole_class
      FROM public.products
     WHERE category = 'Solado' AND group_id = NEW.sole_group_id;

    IF v_sole_class = 'palmilha_pronta' THEN
      NEW.insole_consumption_unit := 'un';
      IF NEW.insole_ready_made IS NULL OR NEW.insole_ready_made = false THEN
        NEW.insole_ready_made := true;
      END IF;
    ELSE
      NEW.insole_consumption_unit := COALESCE(NEW.insole_consumption_unit, 'dm2');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_insole_consumption_unit ON public.technical_sheets;
CREATE TRIGGER trg_sync_insole_consumption_unit
  BEFORE INSERT OR UPDATE OF sole_group_id, insole_ready_made ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_insole_consumption_unit();
