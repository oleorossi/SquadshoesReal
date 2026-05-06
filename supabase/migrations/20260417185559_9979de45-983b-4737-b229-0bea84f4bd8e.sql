-- Sincroniza production_unit e purchase_unit com a unidade real do material (campo "unit")
-- Corrige itens onde production_unit='un' mas o unit é uma medida (m, metros, kg, L, dm² etc.)
-- Isso resolve o caso do "Elástico Sarja", "Elástico 6MM", "Tira Overlock", "Dublado", "Napa", etc.

UPDATE products
SET 
  production_unit = CASE 
    WHEN LOWER(TRIM(unit)) IN ('m', 'metro', 'metros') THEN 'metros'
    WHEN LOWER(TRIM(unit)) IN ('kg', 'quilo', 'quilograma') THEN 'kg'
    WHEN LOWER(TRIM(unit)) IN ('l', 'litro', 'litros') THEN 'L'
    WHEN LOWER(TRIM(unit)) IN ('dm²', 'dm2') THEN 'dm²'
    WHEN LOWER(TRIM(unit)) IN ('m²', 'm2') THEN 'm²'
    WHEN LOWER(TRIM(unit)) IN ('g', 'grama', 'gramas') THEN 'g'
    WHEN LOWER(TRIM(unit)) IN ('ml') THEN 'ml'
    ELSE production_unit
  END,
  purchase_unit = CASE
    WHEN LOWER(TRIM(unit)) IN ('m', 'metro', 'metros') AND LOWER(TRIM(COALESCE(purchase_unit, ''))) IN ('un', 'unidade', '') THEN 'metro'
    WHEN LOWER(TRIM(unit)) IN ('kg', 'quilo', 'quilograma') AND LOWER(TRIM(COALESCE(purchase_unit, ''))) IN ('un', 'unidade', '') THEN 'kg'
    WHEN LOWER(TRIM(unit)) IN ('l', 'litro', 'litros') AND LOWER(TRIM(COALESCE(purchase_unit, ''))) IN ('un', 'unidade', '') THEN 'L'
    WHEN LOWER(TRIM(unit)) IN ('dm²', 'dm2') AND LOWER(TRIM(COALESCE(purchase_unit, ''))) IN ('un', 'unidade', '') THEN 'm²'
    WHEN LOWER(TRIM(unit)) IN ('m²', 'm2') AND LOWER(TRIM(COALESCE(purchase_unit, ''))) IN ('un', 'unidade', '') THEN 'm²'
    ELSE purchase_unit
  END,
  updated_at = now()
WHERE 
  active = true
  AND unit IS NOT NULL
  AND LOWER(TRIM(unit)) IN ('m', 'metro', 'metros', 'kg', 'quilo', 'quilograma', 'l', 'litro', 'litros', 'dm²', 'dm2', 'm²', 'm2', 'g', 'grama', 'gramas', 'ml')
  AND (
    production_unit IS NULL 
    OR LOWER(TRIM(production_unit)) IN ('un', 'unidade', 'unidades', 'pc', 'peça', 'pç')
    OR LOWER(TRIM(production_unit)) <> LOWER(TRIM(unit))
  );