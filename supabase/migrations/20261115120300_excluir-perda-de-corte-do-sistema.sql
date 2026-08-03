-- REGRA DE NEGÓCIO (decisão do dono, 03/08/2026): a perda de corte NÃO EXISTE
-- neste sistema. Os valores de consumo cadastrados (dm²/par, g/par, un/par) já
-- consideram o rendimento REAL do material. Somar um percentual por cima conta a
-- mesma perda duas vezes e infla consumo, reserva, débito, custeio e compra.
--
-- Contexto: `20261112120800` zerou o DADO (waste_pct = 0 em todas as linhas) mas
-- deixou o `× (1 + waste/100)` vivo no cálculo. Enquanto o cálculo existir,
-- qualquer INSERT/UPDATE que volte a gravar um waste > 0 reintroduz a
-- duplicidade — e o sintoma é sutil: itens de MESMA grade e MESMA quantidade
-- saindo com consumos diferentes por cor (bug do PV-00150, onde a napa fechava
-- 81,09 m no PRETO e 87,57 m no NEW WHISKY/OFF WHITE, razão exata 1,08).
--
-- Esta migration arranca o conceito do lado SQL. O lado TS saiu nos commits
-- 9a0ea69 e ad1cc18 — os dois lados param juntos, sem janela de drift (o drift
-- de 8% entre TS e SQL está registrado em docs/AUDITORIA_MOTORES_2026-07-21.md).
--
-- ⚠ ACHADO durante a aplicação: a perda era aplicada em 8 pontos, não 7. O 8º é
-- a VIEW `purchase_projection_timeline`, que não aparece em nenhuma varredura de
-- pg_proc. Quem repetir esse tipo de expurgo precisa varrer pg_views também.
--
-- Verificado após aplicar: as 18 linhas de consumo do PV-00150 (3 cores × 6
-- materiais) ficaram BYTE A BYTE iguais ao baseline — a remoção é numericamente
-- neutra hoje, porque o dado já estava zerado. O que muda é o futuro: não há
-- mais como reintroduzir perda.

BEGIN;

-- 1. CONSUMIDORES — remove o `× (1 + COALESCE(v_conv.waste_pct, 0) / 100)`.
--    Transformação TEXTUAL sobre pg_get_functiondef: preserva byte a byte todo o
--    resto das duas funções (by_grade tem ~48 KB). Reescrever à mão seria a
--    forma mais provável de introduzir um erro silencioso aqui.
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  FOR v_def IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('calculate_order_consumption_by_grade', 'check_stock_availability')
  LOOP
    v_new := regexp_replace(
      v_def,
      '\s*\*\s*\(1 \+ COALESCE\(v_conv\.waste_pct, 0\) / 100\)',
      '',
      'g'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Nenhuma ocorrencia de perda removida — o padrao mudou. Abortando para nao deixar o SQL divergente do TS.';
    END IF;
    EXECUTE v_new;
  END LOOP;
END $mig$;

-- 2. get_material_conversion_info deixa de devolver `waste_pct`, e a view que
--    depende dela é recriada sem os dois multiplicadores de perda.
--    A view PRECISA cair antes da função (dependência real) e volta na mesma
--    transação, com os grants restaurados.
DO $mig$
DECLARE
  v_view text;
BEGIN
  SELECT pg_get_viewdef('public.purchase_projection_timeline'::regclass, true) INTO v_view;

  v_view := replace(v_view,
    'conv(dm2_per_unit, waste_pct, target_unit, conversion_warning)',
    'conv(dm2_per_unit, target_unit, conversion_warning)');
  v_view := replace(v_view,
    ' * (1::numeric + COALESCE(conv.waste_pct, 0::numeric) / 100::numeric)', '');

  IF v_view ILIKE '%waste%' THEN
    RAISE EXCEPTION 'Sobrou referencia a waste na view apos a transformacao. Abortando.';
  END IF;

  DROP VIEW public.purchase_projection_timeline;
  DROP FUNCTION public.get_material_conversion_info(uuid);

  CREATE FUNCTION public.get_material_conversion_info(p_product_id uuid)
   RETURNS TABLE(dm2_per_unit numeric, target_unit text, conversion_warning text)
   LANGUAGE plpgsql STABLE
  AS $fn$
  DECLARE
    v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
    v_prod_unit text; v_group_id uuid; v_is_linear boolean;
    v_has_cs boolean; v_is_area boolean;
  BEGIN
    SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
    SELECT dimensions_width, dimensions_length, dimensions_unit
      INTO v_width, v_length, v_dim_unit
      FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
    v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));
    IF v_dim <= 0 THEN
      SELECT GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)), cs.dimensions_unit
        INTO v_dim, v_dim_unit
        FROM public.component_sheets cs
        WHERE cs.group_id = v_group_id
          AND GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)) > 0
        ORDER BY (COALESCE(cs.dimensions_width, 0) > 0) DESC, cs.updated_at DESC NULLS LAST, cs.id
        LIMIT 1;
    END IF;
    v_prod_unit := LOWER(v_prod_unit);
    v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
    IF v_is_linear THEN
      IF v_dim IS NOT NULL AND v_dim > 0 THEN
        IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
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
  $fn$;

  EXECUTE 'CREATE VIEW public.purchase_projection_timeline AS ' || v_view;
  GRANT ALL ON public.purchase_projection_timeline TO anon, authenticated, service_role, postgres;
END $mig$;

-- 3. TRIGGERS de component_sheets — param de herdar/observar a perda.
--    Precisa vir ANTES do DROP COLUMN, senão quebram no primeiro INSERT/UPDATE.
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='tg_fill_component_sheet_dims_from_group' AND pronamespace='public'::regnamespace;
  v_new := regexp_replace(v_def, '\n\s*IF COALESCE\(NEW\.waste_pct, 0\) = 0\s*THEN NEW\.waste_pct := v_model\.waste_pct; END IF;', '', 'g');
  IF v_new = v_def THEN RAISE EXCEPTION 'tg_fill: padrao de waste nao encontrado'; END IF;
  EXECUTE v_new;

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='tg_inherit_component_sheet_on_product' AND pronamespace='public'::regnamespace;
  v_new := replace(v_def, 'dimensions_unit, waste_pct, yield_per_size', 'dimensions_unit, yield_per_size');
  v_new := replace(v_new, 'v_model.dimensions_unit, v_model.waste_pct, v_model.yield_per_size', 'v_model.dimensions_unit, v_model.yield_per_size');
  IF v_new = v_def THEN RAISE EXCEPTION 'tg_inherit: padrao de waste nao encontrado'; END IF;
  EXECUTE v_new;

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='tg_mark_so_costs_dirty_from_component_sheet' AND pronamespace='public'::regnamespace;
  v_new := regexp_replace(v_def, '\n\s*AND NEW\.waste_pct\s*IS NOT DISTINCT FROM OLD\.waste_pct', '', 'g');
  IF v_new = v_def THEN RAISE EXCEPTION 'tg_mark_dirty: padrao de waste nao encontrado'; END IF;
  EXECUTE v_new;
END $mig$;

-- O trigger lista waste_pct no `UPDATE OF` (dependência de COLUNA, não só da
-- função) — recriar sem ela antes do DROP COLUMN.
DROP TRIGGER trg_mark_so_costs_dirty_from_component_sheet ON public.component_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_component_sheet
  AFTER INSERT OR DELETE OR UPDATE OF dimensions_width, dimensions_length, dimensions_unit
  ON public.component_sheets
  FOR EACH ROW EXECUTE FUNCTION tg_mark_so_costs_dirty_from_component_sheet();

-- 4. As colunas somem. Ambas estavam 100% zeradas (138 fichas de componente,
--    53 fichas técnicas), então não há valor a preservar.
ALTER TABLE public.component_sheets DROP COLUMN IF EXISTS waste_pct;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS consumption_loss_pct;

-- 5. Comentários de run_consumption_integration_tests que ainda descreviam a
--    perda como parte do contrato (o "× 1.08 (waste padrão)" do CASO 1).
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='run_consumption_integration_tests' AND pronamespace='public'::regnamespace;
  v_new := replace(v_def, '-- CASO 1 — size=37 → per-size; valor por par esperado = consumo × 1.08 (waste padrão)',
                          '-- CASO 1 — size=37 → per-size; valor por par esperado = o consumo CRU da ficha');
  v_new := replace(v_new, '-- CASO 1b — valida valor numérico do per-size (9.29 cru; waste default = 0,',
                          '-- CASO 1b — valida valor numérico do per-size (9.29 cru; perda de corte NÃO');
  v_new := replace(v_new, '-- paridade com o motor TS — só ficha de componente com waste_pct aplica perda)',
                          '-- existe mais no sistema, nem em TS nem em SQL — 03/08/2026)');
  v_new := replace(v_new, 'CASO 1b Cabedal valor ≈ 9.29 (sem waste default)', 'CASO 1b Cabedal valor ≈ 9.29 (cru, sem perda)');
  v_new := replace(v_new, '-- CASO 2 — size=38 → forro/palmilha de sole_spec (valores crus; waste default 0)',
                          '-- CASO 2 — size=38 → forro/palmilha de sole_spec (valores crus)');
  v_new := replace(v_new, '-- CASO 3 — size=99 → escalar cru (5.50; waste default 0)', '-- CASO 3 — size=99 → escalar cru (5.50)');
  v_new := replace(v_new, '-- CASO 6 — qty=100 escala linearmente (9.29 × 100 = 929; waste default 0)',
                          '-- CASO 6 — qty=100 escala linearmente (9.29 × 100 = 929)');
  EXECUTE v_new;
END $mig$;

-- 6. COLA ADESIVO HOTMELT — erro de UNIDADE no cadastro de itens-padrão do
--    solado: 0,01 foi digitado como se o campo fosse kg, mas a unidade é GRAMA.
--    Resultado: 0,00001 kg/par = 17 g de cola para 1728 pares (impossível).
--    Valor correto confirmado pelo dono: 10 g/par — bate com os 10 g/par
--    registrados na auditoria do PV-00144.
--    (COLA FORTE 14 g/par e COLA PVC 23,33 g/par foram confirmados como certos.)
UPDATE public.sole_group_standard_items i
   SET consumption_per_pair = 10, updated_at = now()
  FROM public.products p
 WHERE p.id = i.material_product_id
   AND p.name = 'COLA  ADESIVO HOTMELT'
   AND i.unit = 'g'
   AND i.consumption_per_pair = 0.01;

COMMIT;
