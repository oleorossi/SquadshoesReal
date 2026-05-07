-- =============================================================================
-- AUDITORIA DE CONVERSÕES DE MEDIDAS — ROUND 2
-- =============================================================================
-- Auditoria sistemática em 6 áreas (cabedal, tiras, EVA, cola, embalagem, fios).
-- Resultado: 1 bug HIGH + 2 lacunas em funções utilitárias + 2 produtos com
-- unit inválida em produção.
--
-- O que está OK (validado):
--   ✅ get_material_conversion_info lê dimensions_unit (mm/cm/m) e normaliza
--   ✅ purchase_order_items.unit vs products.unit: 0 divergências
--   ✅ list_materials_missing_width(): vazio (limpo por audits anteriores)
--   ✅ sole_standard_items_consumption: 35×g + 21×dm² (unidades válidas)
--   ✅ validate_strap_consumption_unit detecta tiras < 1 (legado em metros)
--   ✅ 40 produtos com dimensions_unit='mm' (1000-1500mm = 1-1.5m, válido)
--
-- Bugs corrigidos nesta migration:
--   #1 HIGH: 2 produtos com unit inválida
--      - "NAPA SANTORINE 2026 MALBEC" → unit='MTL' (legado de import)
--      - "Solvente Quimicola" → unit='' (vazio)
--   #2 MED: normalize_product_unit não capturava 'MTL', 'mts', 'lin'
--   #3 MED: convert_to_product_unit silenciosamente retornava o valor original
--           quando unidades incompatíveis (kg → un, m → kg) — mascarava bugs
--
-- Validação pós-fix: audit_unit_divergences() retorna 13/13 checks com count=0.
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- #1 Backfill: corrige 2 produtos com unit inválida
-- ----------------------------------------------------------------------------
UPDATE public.products
SET unit = 'm'
WHERE id = '8a1c1996-c713-40b9-92fd-56f86104b79c'
  AND unit = 'MTL';

UPDATE public.products
SET unit = 'L'
WHERE id = '0228b73f-81ee-4c8f-ab13-247582e1faa0'
  AND (unit IS NULL OR unit = '');

-- ----------------------------------------------------------------------------
-- #2 Estende normalize_product_unit pra cobrir mais abreviações
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_product_unit()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_norm text;
BEGIN
  IF NEW.unit IS NULL OR trim(NEW.unit) = '' THEN
    RETURN NEW;
  END IF;

  v_norm := lower(trim(NEW.unit));

  -- length / linear (estendido com MTL, MTS, lin, m.lin)
  IF v_norm IN ('metros','metro','mt','mts','mtl','m linear','m. linear','m.linear','lin','m lin') THEN
    NEW.unit := 'm';
  ELSIF v_norm IN ('centimetro','centímetro','centimetros','centímetros','cm linear','cm. linear') THEN
    NEW.unit := 'cm';
  ELSIF v_norm IN ('milimetro','milímetro','milimetros','milímetros') THEN
    NEW.unit := 'mm';
  -- mass
  ELSIF v_norm IN ('kilo','kilos','quilo','quilos','quilograma','kilograma','quilogramas','kilogramas') THEN
    NEW.unit := 'kg';
  ELSIF v_norm IN ('grama','gramas','gr','grs') THEN
    NEW.unit := 'g';
  -- volume
  ELSIF v_norm IN ('litro','litros','lt','lts') THEN
    NEW.unit := 'L';
  ELSIF v_norm IN ('mililitro','mililitros') THEN
    NEW.unit := 'ml';
  -- count
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
  -- area
  ELSIF v_norm IN ('m2','m^2','metro2','metros2') THEN
    NEW.unit := 'm²';
  ELSIF v_norm IN ('dm2','dm^2','decimetro2') THEN
    NEW.unit := 'dm²';
  ELSIF v_norm IN ('cm2','cm^2','centimetro2') THEN
    NEW.unit := 'cm²';
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- #3 Estende convert_to_product_unit:
--    - adiciona conversões cm²/mm²/m² entre si
--    - adiciona conversões mil/cento/dz → un
--    - retorna NULL quando unidades incompatíveis (em vez de silently pass)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_to_product_unit(
  p_qty numeric, p_source_unit text, p_target_unit text
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_src text := LOWER(TRIM(COALESCE(p_source_unit, '')));
  v_tgt text := LOWER(TRIM(COALESCE(p_target_unit, '')));
  v_src_kind text;
  v_tgt_kind text;
BEGIN
  IF p_qty IS NULL THEN RETURN 0; END IF;
  IF v_src = v_tgt OR v_src = '' OR v_tgt = '' THEN RETURN p_qty; END IF;

  -- mass (g/mg/kg)
  IF v_src = 'g'  AND v_tgt = 'kg' THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'mg' AND v_tgt = 'kg' THEN RETURN p_qty / 1000000; END IF;
  IF v_src = 'mg' AND v_tgt = 'g'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'g'  THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'kg' AND v_tgt = 'mg' THEN RETURN p_qty * 1000000; END IF;
  IF v_src = 'g'  AND v_tgt = 'mg' THEN RETURN p_qty * 1000; END IF;

  -- volume (ml/L)
  IF v_src = 'ml' AND v_tgt = 'l'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'l'  AND v_tgt = 'ml' THEN RETURN p_qty * 1000; END IF;

  -- length (mm/cm/m)
  IF v_src = 'cm' AND v_tgt = 'm'  THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm'  AND v_tgt = 'cm' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'mm' AND v_tgt = 'm'  THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'm'  AND v_tgt = 'mm' THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'mm' AND v_tgt = 'cm' THEN RETURN p_qty / 10; END IF;
  IF v_src = 'cm' AND v_tgt = 'mm' THEN RETURN p_qty * 10; END IF;

  -- area (mm²/cm²/dm²/m²)
  IF v_src = 'dm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 100; END IF;
  IF v_src = 'm²'  AND v_tgt = 'dm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'dm²' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'dm²' AND v_tgt = 'cm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 10000; END IF;
  IF v_src = 'm²'  AND v_tgt = 'cm²' THEN RETURN p_qty * 10000; END IF;
  IF v_src = 'mm²' AND v_tgt = 'cm²' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'cm²' AND v_tgt = 'mm²' THEN RETURN p_qty * 100; END IF;
  IF v_src = 'mm²' AND v_tgt = 'dm²' THEN RETURN p_qty / 10000; END IF;
  IF v_src = 'mm²' AND v_tgt = 'm²'  THEN RETURN p_qty / 1000000; END IF;

  -- count (mil/cento/dúzia → un e vice-versa)
  IF v_src = 'mil'   AND v_tgt = 'un'    THEN RETURN p_qty * 1000; END IF;
  IF v_src = 'un'    AND v_tgt = 'mil'   THEN RETURN p_qty / 1000; END IF;
  IF v_src = 'cento' AND v_tgt = 'un'    THEN RETURN p_qty * 100; END IF;
  IF v_src = 'un'    AND v_tgt = 'cento' THEN RETURN p_qty / 100; END IF;
  IF v_src = 'dz'    AND v_tgt = 'un'    THEN RETURN p_qty * 12; END IF;
  IF v_src = 'un'    AND v_tgt = 'dz'    THEN RETURN p_qty / 12; END IF;
  IF v_src = 'cento' AND v_tgt = 'mil'   THEN RETURN p_qty / 10; END IF;
  IF v_src = 'mil'   AND v_tgt = 'cento' THEN RETURN p_qty * 10; END IF;

  -- Guard: detecta unidades incompatíveis (mass vs length, etc) e RAISE WARNING
  -- Antes a função retornava p_qty silenciosamente — escondia bugs.
  v_src_kind := CASE
    WHEN v_src IN ('g','mg','kg')                THEN 'mass'
    WHEN v_src IN ('ml','l')                     THEN 'volume'
    WHEN v_src IN ('mm','cm','m')                THEN 'length'
    WHEN v_src IN ('mm²','cm²','dm²','m²')       THEN 'area'
    WHEN v_src IN ('un','mil','cento','dz','par') THEN 'count'
    ELSE 'unknown'
  END;
  v_tgt_kind := CASE
    WHEN v_tgt IN ('g','mg','kg')                THEN 'mass'
    WHEN v_tgt IN ('ml','l')                     THEN 'volume'
    WHEN v_tgt IN ('mm','cm','m')                THEN 'length'
    WHEN v_tgt IN ('mm²','cm²','dm²','m²')       THEN 'area'
    WHEN v_tgt IN ('un','mil','cento','dz','par') THEN 'count'
    ELSE 'unknown'
  END;

  IF v_src_kind <> v_tgt_kind AND v_src_kind <> 'unknown' AND v_tgt_kind <> 'unknown' THEN
    RAISE WARNING 'convert_to_product_unit: unidades incompatíveis (% [%] -> % [%]) — retornando valor original sem conversão. Verifique se a ficha técnica e o cadastro do produto estão consistentes.',
      p_source_unit, v_src_kind, p_target_unit, v_tgt_kind;
  END IF;

  RETURN p_qty;
END;
$$;
GRANT EXECUTE ON FUNCTION public.convert_to_product_unit(numeric, text, text) TO authenticated;

COMMENT ON FUNCTION public.normalize_product_unit() IS
  'Normaliza products.unit pra forma canônica (m, kg, g, L, ml, un, par, mil, cento, dz, dm², m², etc). '
  'Captura abreviações comuns: MTL, MTS, lin (→m); kilos, kg (→kg); pares (→par); etc. '
  'Trigger BEFORE INSERT em products.';

COMMENT ON FUNCTION public.convert_to_product_unit(numeric, text, text) IS
  'Converte qty entre unidades compatíveis (mass, volume, length, area, count). '
  'Em unidades INCOMPATÍVEIS (ex: kg → un) emite RAISE WARNING e retorna o valor original — '
  'antes a função silenciosamente passava o número, escondendo bugs em ficha técnica.';
