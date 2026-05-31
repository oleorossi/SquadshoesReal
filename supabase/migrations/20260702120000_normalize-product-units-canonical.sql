-- Normalização de unidades por produto (padrão industrial: 1 unidade-base por produto)
-- + correção dos conversion_rate mal-alocados. Aprovado pelo usuário em 2026-05-30
-- (docs/AUDITORIA_UNIDADES_PRODUTOS.md). Regra: purchase_unit == unit ⇒ rate = 1;
-- a conversão dm²→metro de materiais de área mora na FICHA DE COMPONENTE (largura),
-- não no produto.

-- 1) PLACA EVA: era unit='m'/purchase='chapa'/production='dm²'. Material de ÁREA:
--    base = dm², compra em placa (1 placa = 150 dm² → conversion_rate mantido).
UPDATE public.products
   SET unit = 'dm²', purchase_unit = 'placa', production_unit = 'dm²', consumption_unit = 'dm²'
 WHERE name = 'PLACA 1.0 EVA 3.0';

-- 2) COLA FORTE / COLA PVC: production_unit/purchase_unit categoricamente errados.
--    Colas são faturadas e estocadas em kg (NF vem em kg).
UPDATE public.products SET purchase_unit = 'kg' WHERE name = 'COLA FORTE' AND lower(trim(purchase_unit)) = 'un';
UPDATE public.products SET production_unit = 'kg' WHERE name = 'COLA PVC'  AND lower(trim(production_unit)) = 'un';

-- 3) Normalização de grafia → canônico, em TODOS os campos de unidade.
--    metro/metros/mt→m · gr→g · litro/l→L · dm2→dm² · m2→m² · chapa→placa
CREATE OR REPLACE FUNCTION pg_temp.canon_unit(u text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(coalesce(u,'')))
    WHEN 'metro' THEN 'm' WHEN 'metros' THEN 'm' WHEN 'mt' THEN 'm' WHEN 'mts' THEN 'm'
    WHEN 'gr' THEN 'g' WHEN 'grama' THEN 'g' WHEN 'gramas' THEN 'g'
    WHEN 'litro' THEN 'L' WHEN 'litros' THEN 'L' WHEN 'l' THEN 'L'
    WHEN 'dm2' THEN 'dm²' WHEN 'm2' THEN 'm²' WHEN 'cm2' THEN 'cm²'
    WHEN 'chapa' THEN 'placa' WHEN 'placas' THEN 'placa'
    WHEN 'unid' THEN 'un' WHEN 'unidade' THEN 'un' WHEN 'und' THEN 'un'
    ELSE u END;
$$;

UPDATE public.products SET
  unit             = pg_temp.canon_unit(unit),
  purchase_unit    = pg_temp.canon_unit(purchase_unit),
  production_unit  = pg_temp.canon_unit(production_unit),
  consumption_unit = pg_temp.canon_unit(consumption_unit)
WHERE pg_temp.canon_unit(unit) IS DISTINCT FROM unit
   OR pg_temp.canon_unit(purchase_unit) IS DISTINCT FROM purchase_unit
   OR pg_temp.canon_unit(production_unit) IS DISTINCT FROM production_unit
   OR pg_temp.canon_unit(consumption_unit) IS DISTINCT FROM consumption_unit;

-- 4) INVARIANTE: se a unidade de compra == unidade de estoque, o fator é 1.
--    Corrige napas (137→1, a largura cuida da área na ficha), napa rate=0→1,
--    colas kg/kg (25/14/0.08→1), tira overlock cobre (137→1). EVA (dm²≠placa) mantém 150.
UPDATE public.products
   SET conversion_rate = 1
 WHERE conversion_rate IS DISTINCT FROM 1
   AND lower(trim(coalesce(purchase_unit,''))) = lower(trim(coalesce(unit,'')))
   AND coalesce(purchase_unit,'') <> '';

-- 5) conversion_rate = 0 nunca é válido (zeraria consumo/compra) → 1.
UPDATE public.products SET conversion_rate = 1 WHERE conversion_rate = 0;
