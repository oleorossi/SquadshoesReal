-- Decouple do forro do CABEDAL da ficha do solado (2026-06-30)
-- ----------------------------------------------------------------------------
-- O forro interno do cabedal NÃO é padronizado por solado — é cabedal a cabedal
-- (definido na ficha técnica do MODELO: technical_sheets.lining_consumption +
-- lining_consumption_per_size). A coluna sole_technical_specs.lining_consumption_dm2
-- foi removida da UI (SoleTechnicalDetails — "Consumo por numeração") e dos fluxos
-- que propagavam o valor do solado pro modelo/BOM (autoFillFromSoleSpecs e o
-- auto-add de BOM em TechnicalSheets).
--
-- Aqui zeramos os valores órfãos que restaram na tabela (apenas variantes do
-- SOLADO 01, 14 linhas) pra neutralizar de vez o fallback de cabedal-lining em
-- calculate_order_consumption / calculate_order_consumption_by_grade — esse
-- fallback só dispara quando lining_consumption_dm2 > 0, então com a coluna
-- zerada ele vira dead-code inerte (a função SQL fica intacta, sem risco pro
-- motor de consumo).
--
-- Impacto verificado = ZERO: a interseção "ficha sole-driven SEM forração
-- própria que usa o SOLADO 01" é vazia no banco, logo esses valores nunca
-- dirigiram consumo de cabedal de verdade.
--
-- ⚠ NÃO toca insole_consumption_dm2 (placa) nem insole_lining_consumption_dm2
-- (forração da palmilha, "coluna 3") — essas SÃO padronizadas por solado e
-- continuam vivas em toda a cadeia (UI, autofill, BOM, SQL).

UPDATE sole_technical_specs
   SET lining_consumption_dm2 = NULL
 WHERE lining_consumption_dm2 IS NOT NULL;
