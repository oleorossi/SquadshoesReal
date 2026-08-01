-- Duas lacunas de cadastro que o diagnostico do PV-00151 apontou
-- ============================================================================
-- 1) NAPA SUDANI nao tinha NENHUMA receita artesanal. Com a familia da tira
--    passando a sair da VARIANTE do item (mig 20261026120000), toda variante
--    "-SD" de modelo com tira artesanal passou a BLOQUEAR a OP por falta de
--    receita: 12 combinacoes ficha x tira (I90I, I100, I50, I80, I110, I132,
--    120, DS22). Antes elas nao bloqueavam porque usavam a familia da FICHA --
--    ou seja, debitavam a napa errada em silencio.
--
--    Os numeros sao os MESMOS das outras familias, e isso nao e copia
--    preguicosa: toda napa e 1000x1370 (decisao do dono, 31/07), entao o
--    rendimento por metro e o mesmo -- ele depende da largura util e da largura
--    de corte, nao da familia. Espelha as irmas de NAPA SOFT, inclusive
--    cut_width_mm, mao de obra e prestador padrao.
--
-- 2) PALMILHA: OURO LIGHT era o unico item do grupo PALMILHA sem ficha de
--    componente (largura/comprimento nulos) -- material de area sem largura nao
--    converte dm2 -> metro. Herda 1000x1500 do grupo, que ja tem largura
--    canonica (1500mm) e cujos dois outros itens (EVA 3MM, PLACA 1.0 EVA 3.0)
--    sao unanimes nessa dimensao. E a regra "o grupo manda" aplicada a um caso
--    sem ambiguidade, nao um chute.
--
-- NAO inclui as specs por numeracao do solado INFANTIL (23-33), que e a outra
-- lacuna do mesmo diagnostico: la a placa esta CHAPADA (4,68 em todos os
-- tamanhos) e o forro da palmilha PROGRIDE em degraus (5,7083 / 6,5238 / 6,85).
-- Sao duas convencoes de fabrica no mesmo solado, e a regra de gradeScaling
-- (ponto frances, fator^2) contradiz a primeira. Gerar ali seria inventar dado
-- de bancada em 147 itens de PV.

-- ── 1) Receitas de NAPA SUDANI ───────────────────────────────────────────────
INSERT INTO public.artisanal_recipes
  (name, artisanal_product_name, base_product_name, yield_per_meter,
   cut_width_mm, labor_cost_per_meter, default_contractor_id, active)
SELECT
  regexp_replace(r.name, '\s*NAPA SOFT\s*', ' ', 'gi') || ' — NAPA SUDANI',
  r.artisanal_product_name,
  'NAPA SUDANI',
  r.yield_per_meter,
  r.cut_width_mm,
  r.labor_cost_per_meter,
  r.default_contractor_id,
  true
FROM public.artisanal_recipes r
WHERE r.active
  AND upper(btrim(r.base_product_name)) = 'NAPA SOFT'
  AND r.artisanal_product_name IN
      ('Tira chata 8mm', 'TIRA OVERLOCK 5MM', 'TIRA CHATA COSTURADA 11MM', 'TRANÇA')
  -- Idempotente: nao recria se a irma de SUDANI ja existir.
  AND NOT EXISTS (
    SELECT 1 FROM public.artisanal_recipes x
     WHERE x.active
       AND lower(btrim(unaccent(x.artisanal_product_name)))
         = lower(btrim(unaccent(r.artisanal_product_name)))
       AND upper(btrim(x.base_product_name)) = 'NAPA SUDANI'
  );

-- ── 2) Ficha de componente da PALMILHA: OURO LIGHT ───────────────────────────
INSERT INTO public.component_sheets
  (product_id, dimensions_length, dimensions_width, dimensions_unit, group_id)
SELECT p.id, 1000, 1500, 'mm', p.group_id
  FROM public.products p
  JOIN public.product_groups pg ON pg.id = p.group_id
 WHERE p.active
   AND upper(btrim(pg.name)) = 'PALMILHA'
   AND btrim(p.name) = 'PALMILHA: OURO LIGHT'
   AND NOT EXISTS (SELECT 1 FROM public.component_sheets cs WHERE cs.product_id = p.id);

-- ── Guardas: falha alto se o cadastro nao ficou como esperado ────────────────
DO $check$
DECLARE v_recipes int; v_sheet int;
BEGIN
  SELECT count(*) INTO v_recipes FROM public.artisanal_recipes
   WHERE active AND upper(btrim(base_product_name)) = 'NAPA SUDANI';
  IF v_recipes < 4 THEN
    RAISE EXCEPTION 'Esperava 4 receitas de NAPA SUDANI, encontrei %', v_recipes;
  END IF;

  SELECT count(*) INTO v_sheet
    FROM public.products p JOIN public.component_sheets cs ON cs.product_id = p.id
   WHERE btrim(p.name) = 'PALMILHA: OURO LIGHT' AND p.active
     AND COALESCE(GREATEST(cs.dimensions_width, cs.dimensions_length), 0) > 0;
  IF v_sheet < 1 THEN
    RAISE EXCEPTION 'PALMILHA: OURO LIGHT continua sem largura na ficha de componente';
  END IF;
END $check$;
