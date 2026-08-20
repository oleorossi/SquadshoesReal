-- Contrato canônico do estoque de solados.
--
-- Uma unidade de estoque de solado é UM PAR COMPLETO (pé esquerdo + pé
-- direito). Logo, um par de calçado vendido consome um par de solado. As duas
-- peças físicas não são cadastradas nem debitadas separadamente e nenhum
-- cálculo deve multiplicar a necessidade por 2.

BEGIN;

-- Corrige o legado em que o saldo já estava em pares, mas compra/consumo ainda
-- apareciam como "un". Como as OCs de solado são preenchidas por grade em
-- pares, não existe conversão entre compra e estoque.
UPDATE public.products
   SET unit = 'par',
       consumption_unit = 'par',
       production_unit = 'par',
       purchase_unit = 'par',
       purchase_order_unit = 'par',
       conversion_rate = 1
 WHERE lower(btrim(COALESCE(category, ''))) = 'sola'
    OR lower(btrim(COALESCE(category, ''))) LIKE 'solado%';

CREATE OR REPLACE FUNCTION public.enforce_sole_pair_units()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(btrim(COALESCE(NEW.category, ''))) = 'sola'
     OR lower(btrim(COALESCE(NEW.category, ''))) LIKE 'solado%' THEN
    NEW.unit := 'par';
    NEW.consumption_unit := 'par';
    NEW.production_unit := 'par';
    NEW.purchase_unit := 'par';
    NEW.purchase_order_unit := 'par';
    NEW.conversion_rate := 1;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aa_enforce_sole_pair_units ON public.products;
CREATE TRIGGER trg_aa_enforce_sole_pair_units
BEFORE INSERT OR UPDATE OF category, unit, consumption_unit, production_unit,
  purchase_unit, purchase_order_unit, conversion_rate
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sole_pair_units();

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_sole_pair_units;
ALTER TABLE public.products
  ADD CONSTRAINT chk_products_sole_pair_units CHECK (
    NOT (
      lower(btrim(COALESCE(category, ''))) = 'sola'
      OR lower(btrim(COALESCE(category, ''))) LIKE 'solado%'
    )
    OR (
      unit = 'par'
      AND consumption_unit = 'par'
      AND production_unit = 'par'
      AND purchase_unit = 'par'
      AND purchase_order_unit = 'par'
      AND conversion_rate = 1
    )
  );

-- O consumo técnico também é fixo: 1 par de solado por par de calçado.
UPDATE public.technical_sheets
   SET sole_consumption = 1
 WHERE sole_group_id IS NOT NULL
    OR primary_sole_id IS NOT NULL
    OR NULLIF(btrim(COALESCE(sole_material, '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_technical_sheet_sole_pair_consumption()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.sole_group_id IS NOT NULL
     OR NEW.primary_sole_id IS NOT NULL
     OR NULLIF(btrim(COALESCE(NEW.sole_material, '')), '') IS NOT NULL THEN
    NEW.sole_consumption := 1;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_aa_enforce_sole_pair_consumption ON public.technical_sheets;
CREATE TRIGGER trg_aa_enforce_sole_pair_consumption
BEFORE INSERT OR UPDATE OF sole_group_id, primary_sole_id, sole_material, sole_consumption
ON public.technical_sheets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_technical_sheet_sole_pair_consumption();

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS chk_technical_sheets_sole_pair_consumption;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT chk_technical_sheets_sole_pair_consumption CHECK (
    NOT (
      sole_group_id IS NOT NULL
      OR primary_sole_id IS NOT NULL
      OR NULLIF(btrim(COALESCE(sole_material, '')), '') IS NOT NULL
    )
    OR sole_consumption = 1
  );

-- A variante escolhe QUAL produto/cor de solado será usado; ela não altera a
-- quantidade física por par.
UPDATE public.reference_material_variants
   SET sole_consumption_override = 1
 WHERE sole_consumption_override IS NOT NULL
   AND sole_consumption_override <> 1;

ALTER TABLE public.reference_material_variants
  DROP CONSTRAINT IF EXISTS chk_reference_variants_sole_pair_consumption;
ALTER TABLE public.reference_material_variants
  ADD CONSTRAINT chk_reference_variants_sole_pair_consumption
  CHECK (sole_consumption_override IS NULL OR sole_consumption_override = 1);

COMMENT ON FUNCTION public.enforce_sole_pair_units() IS
  'Para Solado, fixa compra, produção, consumo e estoque em par completo (pé esquerdo + pé direito).';
COMMENT ON COLUMN public.technical_sheets.sole_consumption IS
  'Consumo canônico de solado: exatamente 1 par completo por par de calçado.';
COMMENT ON COLUMN public.reference_material_variants.sole_consumption_override IS
  'Somente NULL ou 1. A variante escolhe o solado; não multiplica pares.';

NOTIFY pgrst, 'reload schema';

COMMIT;
