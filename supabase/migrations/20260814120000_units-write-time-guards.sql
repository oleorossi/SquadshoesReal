-- ============================================================================
-- P2.4 + P2.3 + P1.4(cadastro) — TRAVAR dado de unidade inválido NA ESCRITA
-- ============================================================================
-- "Melhor forma de não ocorrer mais": mover a validação do diagnóstico (reativo)
-- para o banco (preventivo). Três guardas:
--   1) CHECK conversion_rate > 0  → impede o conversion_rate=0/negativo (sempre
--      inválido). Hoje 0 violações, então valida imediatamente.
--   2) purchase_order_unit deixa de ter DEFAULT 'un' e passa a HERDAR a unidade
--      de estoque (NEW.unit) quando não informado — elimina a armadilha que
--      gerava 47 produtos com purchase_unit≠unit + rate=1 (e o risco de material
--      de área novo nunca disparar a conversão dm²→largura).
--   3) normalize_product_unit passa a mapear chapa/chapas/placas → 'placa'
--      (canônico), alinhando com toCanonical do TS (nfUnitConversion.ts).
-- ============================================================================

-- 1) conversion_rate > 0 -------------------------------------------------------
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS chk_products_conversion_rate_positive;
ALTER TABLE public.products
  ADD CONSTRAINT chk_products_conversion_rate_positive
  CHECK (conversion_rate IS NULL OR conversion_rate > 0);

-- 2) purchase_order_unit herda unit (sem mais default 'un') --------------------
ALTER TABLE public.products ALTER COLUMN purchase_order_unit DROP DEFAULT;

-- 3) normalize_product_unit: + chapa→placa + herança de purchase_order_unit ----
CREATE OR REPLACE FUNCTION public.normalize_product_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF NEW.unit IS NULL OR trim(NEW.unit) = '' THEN
    RETURN NEW;
  END IF;

  v_norm := lower(trim(NEW.unit));

  IF v_norm IN ('metros','metro','mt','mts','mtl','m linear','m. linear','m.linear','lin','m lin') THEN
    NEW.unit := 'm';
  ELSIF v_norm IN ('centimetro','centímetro','centimetros','centímetros','cm linear','cm. linear') THEN
    NEW.unit := 'cm';
  ELSIF v_norm IN ('milimetro','milímetro','milimetros','milímetros') THEN
    NEW.unit := 'mm';
  ELSIF v_norm IN ('kilo','kilos','quilo','quilos','quilograma','kilograma','quilogramas','kilogramas') THEN
    NEW.unit := 'kg';
  ELSIF v_norm IN ('grama','gramas','gr','grs') THEN
    NEW.unit := 'g';
  ELSIF v_norm IN ('litro','litros','lt','lts') THEN
    NEW.unit := 'L';
  ELSIF v_norm IN ('mililitro','mililitros') THEN
    NEW.unit := 'ml';
  ELSIF v_norm IN ('unidade','unidades','unid','unids','und','unds') THEN
    NEW.unit := 'un';
  ELSIF v_norm = 'pares' THEN
    NEW.unit := 'par';
  ELSIF v_norm IN ('milheiro','milheiros','mil') THEN
    NEW.unit := 'mil';
  ELSIF v_norm IN ('cento','centos') THEN
    NEW.unit := 'cento';
  ELSIF v_norm IN ('duzia','dúzia','duzias','dúzias','dz','dzs') THEN
    NEW.unit := 'dz';
  ELSIF v_norm IN ('m2','m^2','metro2','metros2') THEN
    NEW.unit := 'm²';
  ELSIF v_norm IN ('dm2','dm^2','decimetro2') THEN
    NEW.unit := 'dm²';
  ELSIF v_norm IN ('cm2','cm^2','centimetro2') THEN
    NEW.unit := 'cm²';
  -- NOVO: chapa/placa → 'placa' (canônico), alinhado ao toCanonical do TS
  ELSIF v_norm IN ('chapa','chapas','placas') THEN
    NEW.unit := 'placa';
  END IF;

  -- NOVO: herda a unidade de compra da unidade de estoque quando não informada
  -- (elimina a armadilha do antigo default 'un' ≠ unit com rate=1).
  IF NEW.purchase_order_unit IS NULL OR trim(NEW.purchase_order_unit) = '' THEN
    NEW.purchase_order_unit := NEW.unit;
  END IF;

  RETURN NEW;
END;
$function$;
