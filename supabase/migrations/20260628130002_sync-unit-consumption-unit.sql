-- =============================================================================
-- Sincronização unit ↔ consumption_unit em products
-- =============================================================================
-- O sistema tinha 2 colunas redundantes:
--   - products.unit            → "unidade de estoque" (form)
--   - products.consumption_unit → "unidade de consumo" (BOM/ficha técnica)
--
-- Decisão (2026-05-13): unidade de estoque == unidade de consumo (sempre).
-- A coluna 'unit' fica no schema por compat com queries existentes, mas é
-- garantida igual a consumption_unit via trigger BEFORE INSERT/UPDATE.
--
-- Frontend (ProductFormDialog) já espelha consumption_unit = unit no save,
-- mas o trigger garante consistência mesmo se algum código antigo escrever
-- direto no banco (GroupEditDialog, mass updates, scripts admin, etc.).
-- =============================================================================

-- ─── 1. Backfill: produtos com consumption_unit divergente ─────────────────
-- Sincroniza pelo unit (que é o campo dominante no form atual). Casos com
-- consumption_unit NULL recebem o unit; casos onde consumption_unit já tem
-- valor mas diverge ficam com o unit pra refletir a regra "são a mesma coisa".
UPDATE public.products
   SET consumption_unit = unit
 WHERE unit IS NOT NULL
   AND (consumption_unit IS NULL OR consumption_unit IS DISTINCT FROM unit);


-- ─── 2. Trigger BEFORE INSERT/UPDATE pra manter sincronizado ───────────────
-- Regra: o que mudou propaga pro outro.
--   INSERT: prioriza unit (form geralmente seta este).
--   UPDATE: se apenas um mudou, sincroniza o outro. Se ambos mudaram, deixa
--           como veio (chamador sabe o que quer — ex: migration explícita).
CREATE OR REPLACE FUNCTION public.tg_products_sync_consumption_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unit IS NOT NULL AND COALESCE(NEW.consumption_unit, '') = '' THEN
      NEW.consumption_unit := NEW.unit;
    ELSIF NEW.consumption_unit IS NOT NULL AND COALESCE(NEW.unit, '') = '' THEN
      NEW.unit := NEW.consumption_unit;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Caso 1: unit mudou, consumption_unit não → sincroniza consumption_unit
    IF NEW.unit IS DISTINCT FROM OLD.unit
       AND NEW.consumption_unit IS NOT DISTINCT FROM OLD.consumption_unit THEN
      NEW.consumption_unit := NEW.unit;
    -- Caso 2: consumption_unit mudou, unit não → sincroniza unit
    ELSIF NEW.consumption_unit IS DISTINCT FROM OLD.consumption_unit
       AND NEW.unit IS NOT DISTINCT FROM OLD.unit THEN
      NEW.unit := NEW.consumption_unit;
    END IF;
    -- Caso 3: ambos mudaram → respeita o que veio (raríssimo, mass update)
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sync_consumption_unit ON public.products;
CREATE TRIGGER trg_products_sync_consumption_unit
  BEFORE INSERT OR UPDATE OF unit, consumption_unit ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_products_sync_consumption_unit();

COMMENT ON FUNCTION public.tg_products_sync_consumption_unit() IS
  'Mantém products.unit == products.consumption_unit em INSERTs/UPDATEs. '
  'Decisão 2026-05-13: unidade de estoque e de consumo são a mesma coisa; '
  'o form de produto só edita uma e o banco garante a outra alinhada.';
