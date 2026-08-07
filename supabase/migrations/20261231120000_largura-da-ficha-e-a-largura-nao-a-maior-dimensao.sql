-- ============================================================================
-- A LARGURA DA FICHA DE COMPONENTE É A LARGURA — não "a maior dimensão"
-- ============================================================================
--
-- REGRA CANÔNICA (CLAUDE.md): material de ÁREA cortado de bobina converte
--   metros lineares = dm² ÷ (largura_mm / 10)
-- A palavra é LARGURA. `get_material_conversion_info` usava
-- `GREATEST(dimensions_width, dimensions_length)`, e o motor TS espelhava com
-- `Math.max(widthMm, lengthMm)`.
--
-- Enquanto todo cadastro tem largura >= comprimento, GREATEST e width dão o
-- mesmo número — e foi por isso que passou. O grupo PALMILHA quebrou o empate:
-- tinha TRÊS fichas de componente, duas gravadas 1500x1000 e uma 1000x1500.
-- O GREATEST devolvia 1500 nas três e mascarava a contradição do cadastro.
--
-- Decisão do dono (07/08/2026): a placa/bobina de palmilha é **1000 x 1500 mm**
-- ⇒ largura = 1000 ⇒ divisor = 100 dm²/m (não 150).
--
-- ⚠ A coincidência que escondeu o erro: 1000mm x 1500mm dá ÁREA de 150 dm² —
-- exatamente o divisor que estava em uso. O número certo pra unidade PLACA
-- estava sendo aplicado como se fosse dm² por METRO linear.
--
-- IMPACTO MEDIDO (simulado produto a produto antes de aplicar): só o grupo
-- PALMILHA muda (150 -> 100). Napas, dublagem, suede e glow metalic ficam em
-- 137, porque nelas largura E maior-dimensão já eram 1370. Consumo de palmilha
-- em metros estava 33% subestimado; passa a debitar 1,5x mais.
--
-- Ordem importa: normalizar os DADOS primeiro, trocar a FÓRMULA depois. Fazer
-- só a fórmula, com cadastro invertido no banco, moveria grupos que hoje estão
-- certos por acidente.
--
-- ── ⚠ ISTO NÃO É UM REVERT DA `20260812120000` ─────────────────────────────
-- O GREATEST não foi descuido: a migration `20260812120000_conversion-info-
-- greatest-dimension` o introduziu DE PROPÓSITO, pra casar SQL e TS quando 25
-- fichas de napa estavam gravadas 1000x1370 (o SQL lia largura=1000 e dava
-- divisor 100; o TS já fazia max() e dava 137, superestimando ~37% o custeio).
--
-- Ela deixou a premissa escrita: *"a maior dimensão linear cadastrada é sempre
-- a largura da bobina (≤1500mm); o comprimento de 40m do rolo NÃO é cadastrado
-- em component_sheets (verificado: máximo é 1500)"*.
--
-- A premissa era verdadeira em 2026-08-12 e CADUCOU: o grupo PALMILHA cadastrou
-- 1000 x 1500 mm onde 1500 é o COMPRIMENTO da placa. Exatamente o "máximo 1500"
-- que a migration citou como teto seguro virou o contraexemplo.
--
-- Esta migration preserva o OBJETIVO daquela (paridade TS×SQL, divisor 137 nas
-- napas) e troca o MECANISMO: em vez de compensar no cálculo o cadastro
-- invertido, conserta o cadastro (passo 2) e passa a ler a largura. O resultado
-- numérico das napas é idêntico — só a PALMILHA muda, que é o caso que o
-- GREATEST errava.
--
-- ⚠ Não "restaure" o GREATEST por analogia com a 20260812120000: com o dado já
-- normalizado, ele volta a quebrar a palmilha e não conserta mais nada.
-- ============================================================================

-- ── 1. PALMILHA: largura é 1000, comprimento é 1500 ─────────────────────────
-- Duas das três fichas estavam com os campos trocados.
UPDATE public.component_sheets cs
   SET dimensions_width  = 1000,
       dimensions_length = 1500,
       dimensions_unit   = 'mm',
       updated_at        = now()
  FROM public.product_groups pg
 WHERE pg.id = cs.group_id
   AND pg.name = 'PALMILHA'
   AND GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0)) > 0
   AND (COALESCE(cs.dimensions_width, 0) <> 1000 OR COALESCE(cs.dimensions_length, 0) <> 1500);

-- ── 2. Fichas com largura/comprimento trocados em grupos de NAPA ────────────
-- 26 fichas gravadas 1000x1370 (TIRA OVERLOCK 5MM e uma cruzada em GLOW
-- METALIC). São cópias do cadastro de napa com os campos invertidos: a napa é
-- 1370 de largura. Alinhar mantém o divisor 137 que já estava em uso — este
-- passo é COMPORTAMENTO-NEUTRO, existe só pra fórmula nova não mudar o número.
--
-- ⚠ NÃO confundir com conserto: uma tira de 5 mm não tem 1,37 m de largura.
-- Essas fichas são cadastro copiado que provavelmente não deveria existir (tira
-- é item linear DIRETO, sem conversão de área). Hoje é inócuo — Tira Overlock
-- chega pelo caminho de tiras (`order_strap_needs`), que não divide por
-- dm2_per_unit, e não está em `sheet_materials` nem em acessório obrigatório.
-- Vira erro de 137x no dia em que alguém puser essa tira no BOM. A remoção é
-- decisão de cadastro do dono, não deste expurgo.
UPDATE public.component_sheets
   SET dimensions_width  = 1370,
       dimensions_length = 1000,
       updated_at        = now()
 WHERE COALESCE(dimensions_width, 0)  = 1000
   AND COALESCE(dimensions_length, 0) = 1370;

-- ── 3. A fórmula: largura, com o comprimento só como último recurso ─────────
CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
    v_prod_unit text; v_group_id uuid; v_is_linear boolean;
    v_has_cs boolean; v_is_area boolean;
  BEGIN
    SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
    SELECT dimensions_width, dimensions_length, dimensions_unit
      INTO v_width, v_length, v_dim_unit
      FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
    -- LARGURA é a dimensão que define quantos dm² cabem em 1 metro de bobina.
    -- O comprimento entra apenas quando a largura não foi cadastrada, pra não
    -- regredir fichas legadas que gravaram a medida no campo errado.
    v_dim := COALESCE(NULLIF(v_width, 0), NULLIF(v_length, 0), 0);
    IF v_dim <= 0 THEN
      SELECT COALESCE(NULLIF(cs.dimensions_width, 0), NULLIF(cs.dimensions_length, 0)), cs.dimensions_unit
        INTO v_dim, v_dim_unit
        FROM public.component_sheets cs
        WHERE cs.group_id = v_group_id
          AND COALESCE(NULLIF(cs.dimensions_width, 0), NULLIF(cs.dimensions_length, 0)) > 0
        ORDER BY (COALESCE(cs.dimensions_width, 0) > 0) DESC, cs.updated_at DESC NULLS LAST, cs.id
        LIMIT 1;
    END IF;
    v_prod_unit := LOWER(v_prod_unit);
    v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
    IF v_is_linear THEN
      IF v_dim IS NOT NULL AND v_dim > 0 THEN
        IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
        ELSIF LOWER(v_dim_unit) = 'dm' THEN v_dim := v_dim * 100;
        ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;
        dm2_per_unit := v_dim / 10;
        IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
        conversion_warning := NULL;
      ELSE
        dm2_per_unit := 1;
        SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                       WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id) INTO v_has_cs;
        SELECT EXISTS (
          SELECT 1 FROM public.product_groups pg
           WHERE pg.id = v_group_id
             AND (pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
                  OR EXISTS (SELECT 1 FROM public.technical_sheets ts
                              WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))))
        ) INTO v_is_area;
        IF v_has_cs OR v_is_area THEN
          conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
            'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
        ELSE
          conversion_warning := NULL;
        END IF;
      END IF;
    ELSE
      dm2_per_unit := 1;
      conversion_warning := NULL;
    END IF;
    target_unit := v_prod_unit;
    RETURN NEXT;
  END;
  $function$;

-- ── 4. A guarda de cadastro passa a exigir a LARGURA ────────────────────────
-- Exigia GREATEST(width, length) > 0: uma ficha com só o comprimento
-- preenchido passava na guarda e mesmo assim não convertia.
CREATE OR REPLACE FUNCTION public.tg_require_width_for_area_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group_id uuid; v_unit text; v_is_area boolean;
BEGIN
  SELECT p.group_id, LOWER(p.unit) INTO v_group_id, v_unit
    FROM public.products p WHERE p.id = NEW.product_id;

  IF v_unit NOT IN ('m','meters','metros','mt','cm','m linear') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.product_groups pg
     WHERE pg.id = v_group_id
       AND (
         pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
         OR EXISTS (
           SELECT 1 FROM public.technical_sheets ts
            WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
               OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
               OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))
         )
       )
  ) INTO v_is_area;

  IF v_is_area AND COALESCE(NEW.dimensions_width, 0) <= 0 THEN
    RAISE EXCEPTION
      'Material de área exige a LARGURA na ficha de componente (não o comprimento). Preencha Dimensões > Largura (mm) antes de salvar.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.get_material_conversion_info(uuid) IS
  'dm² por unidade física de estoque. Usa dimensions_width (a LARGURA da bobina), '
  'caindo em dimensions_length só quando a largura não foi cadastrada. '
  'Antes usava GREATEST(width, length), que mascarou o cadastro invertido do grupo PALMILHA.';
