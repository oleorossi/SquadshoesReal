-- ============================================================================
-- Motor de consumo: componente que NÃO resolve produto para de sumir em silêncio
--
-- CONTEXTO
-- --------
-- `calculate_order_consumption_by_grade` (motor ÚNICO — o escalar
-- `calculate_order_consumption` só delega a ele) monta o payload de consumo
-- linha a linha. Toda linha só é emitida quando o componente RESOLVEU um
-- `product_id`. Quando não resolve, a linha simplesmente não entra no array:
-- não aparece no modal/ficha, não é reservada, não é debitada, não entra no
-- custeio nem no MRP — e ninguém é avisado. Casos reais apurados na auditoria
-- (todos confirmados por SELECT contra o banco vivo em 2026-09-25):
--
--   (a) `direct_components` apontando product_id que não existe mais em
--       products → 23 pares ficha/componente. Ex.: EC06/"BINÓCULO 6MM" 8 un/par,
--       I90/"BINÓCULO 6MM: DOURADO" 2/par + "Coração" 30/par, I91 4/par,
--       S-039. 4/par, ST15/ST17/ST702/ST703/STX "Fivela Dourada 10.7mm" 2/par.
--       O ramo `IF FOUND THEN ... END IF` descartava a entrada sem ELSE.
--
--   (b) `insole_material` = '' (string VAZIA) com consumo de palmilha
--       preenchido → o gate `IF v_sheet.insole_material <> ''` não resolve
--       `v_insole_pid` e a linha "Palmilha" inteira é descartada. Afeta
--       NL01–NL04 (insole_consumption 4,4343 dm²/par + per_size 34–40 cheio),
--       hoje 12 OPs ativas do PV-00148 = 528 pares de placa fora do cálculo.
--
--   (c) `sole_material` é TEXTO LIVRE sem `sole_group_id` nem `primary_sole_id`
--       nem mapping em technical_sheet_sole_colors → `resolve_sole_color`
--       devolve NULL e a linha "Solado" não existe. BT01 (37337286) e BT02
--       (3826a264), ambas "Solado Ricardo Tratorado": 3 OPs / 440 pares em
--       produção nos PV-00139 e PV-00142 sem NENHUM solado no consumo.
--       (Também EC11/EC12 "Solado Barato", SP130 e i40 — sem OP ativa.)
--
--   (d) tamanho da grade SEM spec no solado E com escalar da ficha = 0
--       contribui ZERO sem nenhum `consumption_warning`: o gate do aviso
--       (`v_fb_*`) exige `COALESCE(escalar, 0) > 0`. Caso real: solado INFANTIL
--       tem sole_technical_specs só de 34 a 40, mas a grade infantil de I90/I91
--       vai de 25 a 34 → a "Forração Palmilha" contou SÓ o tamanho 34
--       (insole_lining_consumption escalar = 0) e saiu sem aviso nenhum.
--
-- O QUE MUDA
-- ----------
-- 1. O motor passa a EMITIR uma linha de diagnóstico no lugar da omissão:
--       product_id = NULL, required = 0, available = 0, stock_ok = false,
--       consumption_per_unit = 0, debit_mode = 'soft', source = 'unresolved',
--       consumption_warning = <explicação em pt-BR>
--    Formato JÁ existente no payload (o ramo "solado fachetado sem specs de
--    fachete" emite product_id NULL desde a mig 20260721150000) e já aceito
--    pelo Zod do frontend (`ConsumptionLineSchema`: product_id nulo permitido
--    em linha de AVISO = required 0 + consumption_warning).
--
-- 2. Caso (d): o aviso passa a sair TAMBÉM quando o escalar é 0 — os tamanhos
--    entram em `Tamanhos SEM consumo cadastrado — contribuíram ZERO ao
--    cálculo: ...`, concatenado ao aviso de média escalar quando os dois
--    ocorrem. (O texto do fallback_average NÃO muda: o teste
--    `run_consumption_integration_tests` CASO 3c depende dele.)
--
-- 3. SEGURANÇA DOS CONSUMIDORES (mapeados um a um antes de mexer no motor):
--    todas as funções que leem o payload passam por
--    `filter_caixa_by_packaging_mode` — try_reserve_materials,
--    hybrid_debit_stock_for_order, calculate_order_cost_item,
--    freeze_technical_sheet (que congela o snapshot lido depois pelo débito),
--    get_wave_material_needs_core, compute_materials_per_pv,
--    fn_projected_demand, check_stock_availability,
--    resync_op_material_reservations e list_ops_with_stale_reservations.
--    A maioria já filtra `product_id IS NOT NULL`, MAS duas não filtravam:
--      • hybrid_debit_stock_for_order — `SELECT ... INTO v_product FROM products
--        WHERE id = v_pid; IF NOT FOUND THEN RAISE EXCEPTION` → linha com
--        product_id NULL ABORTA a baixa da OP (bug latente já hoje por causa da
--        linha de fachete, que só não estourou porque nenhum solado fachetado
--        ficou sem spec num PV finalizado);
--      • calculate_order_cost_item — geraria `unit_mismatch:?` fantasma no
--        breakdown de custo.
--    Em vez de reescrever essas duas funções críticas (8,7k e 12,5k chars) só
--    pra inserir um CONTINUE, o filtro entra no PONTO DE ESTRANGULAMENTO comum:
--    `filter_caixa_by_packaging_mode` passa a SEMPRE remover as linhas de
--    diagnóstico (via `strip_diagnostic_consumption_lines`) antes de devolver.
--    Efeito: quem MEXE em material (reserva/débito/custeio/compra/snapshot)
--    nunca enxerga linha sem produto; quem só EXIBE (modal do PV, painel de
--    precificação, Wizard de compras — que chamam a RPC direto, sem o filtro)
--    continua vendo o aviso. Nenhum consumidor ganha débito/reserva fantasma:
--    product_id NULL nunca vira UPDATE em products nem INSERT em
--    material_reservations/stock_movements.
--    ⚠ `filter_caixa_by_packaging_mode` também é aplicada ao BOM em
--    `freeze_technical_sheet` (bom_snapshot). Pra o strip NÃO poder mutilar
--    esse snapshot, o predicado do helper só derruba linha que TEM a chave
--    `component` (assinatura do motor de consumo) — linha de sheet_materials
--    (`to_jsonb(sm)`) não tem essa chave e passa sempre. Verificado em
--    2026-09-25: `sheet_materials` não tem coluna `component`, as 163 linhas
--    têm product_id e nenhum dos 95 snapshots tem linha sem product_id.
--
-- 4. REPARO DE CADASTRO (fim do arquivo): tenta re-mapear os `direct_components`
--    órfãos por NOME (unaccent+lower, match ÚNICO e exato entre produtos
--    ativos). Idempotente — só age em entradas cujo product_id não existe mais.
--    Verificado em 2026-09-25: NENHUM dos 6 nomes órfãos ("BINÓCULO 6MM",
--    "BINÓCULO 6MM: DOURADO", "Coração", "Dedinho GOLD", "Elástico 7mm
--    dedinho", "Fivela Dourada 10.7mm") tem produto ativo homônimo hoje — o
--    bloco remapeia 0 agora e serve de rede quando o produto for recadastrado
--    com o mesmo nome. Os ambíguos (ex.: "Binóculo 10mm" é OUTRA bitola)
--    continuam no aviso, por decisão do usuário.
--
-- Espelho TS (mesma semântica de aviso): src/lib/orderConsumption.ts.
-- ============================================================================

-- ── 1) Helper: remove as linhas de DIAGNÓSTICO do payload de consumo ────────
-- Linha de diagnóstico = linha DO MOTOR DE CONSUMO (tem a chave `component`)
-- sem product_id (required 0 + consumption_warning).
-- Serve pra qualquer consumidor que AJA sobre material (reserva, débito,
-- custeio, compra) — nunca pra quem só exibe.
--
-- ⚠ O predicado exige `component` de propósito: `filter_caixa_by_packaging_mode`
-- é aplicada TAMBÉM ao `bom_snapshot` em freeze_technical_sheet, que é
-- `jsonb_agg(to_jsonb(sheet_materials))` — uma linha de BOM NÃO tem `component`
-- (verificado em 2026-09-25: a coluna não existe em sheet_materials). Sem esse
-- predicado, uma linha de BOM só com group_id (product_id NULL) sumiria do
-- snapshot de auditoria. Toda linha do motor emite `component` (é a 1ª chave de
-- todos os jsonb_build_object), então o strip cobre 100% dos diagnósticos.
CREATE OR REPLACE FUNCTION public.strip_diagnostic_consumption_lines(p_cons jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_cons IS NULL OR jsonb_typeof(p_cons) <> 'array' THEN p_cons
    ELSE COALESCE(
      (SELECT jsonb_agg(line)
         FROM jsonb_array_elements(p_cons) AS line
        -- jsonb_exists(...) e não `line ? 'component'`: o operador `?` pode ser
        -- comido como placeholder por alguns clientes que aplicam migration.
        WHERE NULLIF(btrim(COALESCE(line ->> 'product_id', '')), '') IS NOT NULL
           OR NOT jsonb_exists(line, 'component')),
      '[]'::jsonb)
  END;
$fn$;

COMMENT ON FUNCTION public.strip_diagnostic_consumption_lines(jsonb) IS
  'Remove do payload de calculate_order_consumption* as linhas de diagnóstico (product_id NULL, source=unresolved/sole_fachete sem produto). Aplicado por filter_caixa_by_packaging_mode — ponto único por onde passam reserva, débito, custeio, snapshot, ondas e MRP.';

-- ── 2) filter_caixa_by_packaging_mode: aplica o strip SEMPRE ────────────────
-- Mesma lógica de caixa de antes; o que muda é que as linhas de diagnóstico
-- saem ANTES de qualquer retorno (inclusive no early-return de
-- p_packaging_mode NULL, que é o caminho da maioria dos PVs).
CREATE OR REPLACE FUNCTION public.filter_caixa_by_packaging_mode(p_cons jsonb, p_packaging_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $fn$
DECLARE
  v_target text;
  v_types  text[];
  v_result jsonb;
  v_cons   jsonb;
BEGIN
  IF p_cons IS NULL OR jsonb_typeof(p_cons) <> 'array' THEN
    RETURN p_cons;
  END IF;

  -- CONS-8: linha de diagnóstico (product_id NULL) NUNCA chega em quem age
  -- sobre material — hybrid_debit_stock_for_order aborta a baixa com
  -- "Produto % do snapshot não encontrado" e calculate_order_cost_item
  -- geraria unit_mismatch fantasma. Quem só EXIBE chama a RPC direto.
  v_cons := public.strip_diagnostic_consumption_lines(p_cons);

  IF p_packaging_mode IS NULL THEN
    RETURN v_cons;
  END IF;

  v_target := public.packaging_mode_collective_type(p_packaging_mode);

  SELECT array_agg(DISTINCT t) INTO v_types
  FROM (
    SELECT public.caixa_collective_type(pr.name) AS t
    FROM jsonb_array_elements(v_cons) AS line
    JOIN public.products pr ON pr.id = (line->>'product_id')::uuid
  ) s
  WHERE t IS NOT NULL;

  IF v_types IS NULL OR array_length(v_types, 1) < 2 OR NOT (v_target = ANY(v_types)) THEN
    RETURN v_cons;
  END IF;

  SELECT COALESCE(jsonb_agg(line), '[]'::jsonb) INTO v_result
  FROM jsonb_array_elements(v_cons) AS line
  LEFT JOIN public.products pr ON pr.id = (line->>'product_id')::uuid
  WHERE public.caixa_collective_type(pr.name) IS NULL
     OR public.caixa_collective_type(pr.name) = v_target;

  RETURN v_result;
END;
$fn$;

-- ── 3) Motor: emite linha de diagnóstico em vez de omitir ───────────────────
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(p_reference_id uuid, p_grade jsonb, p_color text, p_material_variant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_sheet RECORD; v_sole_product_id uuid; v_sole_color text;
  v_total_qty numeric := 0; v_size integer; v_pairs numeric;
  v_spec RECORD; v_upper numeric; v_lining numeric; v_insole numeric;
  v_resolved RECORD; v_conv RECORD; v_row RECORD; v_item jsonb;
  v_consumption numeric; v_required numeric; v_group_name text;
  v_covered_categories text[] := ARRAY[]::text[];
  v_covered_product_ids uuid[] := ARRAY[]::uuid[];
  v_row_cat_norm text;
  v_acc_upper jsonb := '{}'::jsonb;
  v_acc_lining jsonb := '{}'::jsonb;
  v_acc_insole jsonb := '{}'::jsonb;
  v_acc_std jsonb := '{}'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_upper_pid uuid; v_lining_pid uuid; v_insole_pid uuid;
  v_std_item RECORD; v_key text;
  v_acc_required numeric; v_acc_avail numeric; v_acc_name text;
  v_palmilha_color text;
  v_variant RECORD; v_variant_sole_pid uuid;
  v_is_palmilha_pronta boolean := false;
  v_insole_lining numeric;
  v_acc_insole_lining jsonb := '{}'::jsonb;
  v_pid uuid;
  v_is_fachetado boolean := false;
  v_fachete numeric;
  v_acc_fachete jsonb := '{}'::jsonb;
  v_warn_fachete_sizes integer[] := ARRAY[]::integer[];
  v_prod_unit text; v_std_unit text; v_converted numeric; v_std_color text;
  v_has_color_components boolean := false;
  v_lining_group text;
  v_lining_is_alt boolean := false;
  v_lining_alt_group text;
  v_lining_alt_cons numeric;
  v_suppress_cabedal_lining boolean := false;
  v_sole_has_palm_forro boolean;
  v_sole_has_cabedal_forro boolean;
  -- CONS-1: tamanhos que caíram na média escalar da ficha, por componente
  v_fb_upper text[] := ARRAY[]::text[];
  v_fb_lining text[] := ARRAY[]::text[];
  v_fb_insole text[] := ARRAY[]::text[];
  v_fb_insole_lining text[] := ARRAY[]::text[];
  v_ovr_upper numeric; v_ovr_lining numeric; v_ovr_insole numeric;
  -- CONS-6: grupo do fachete (products.fachete_material_group_id do solado)
  v_fachete_group text;
  -- CONS-8 (2026-09-25): tamanhos que contribuíram ZERO (sem valor por
  -- numeração E escalar da ficha = 0) — antes sumiam sem aviso nenhum.
  v_zs_upper text[] := ARRAY[]::text[];
  v_zs_lining text[] := ARRAY[]::text[];
  v_zs_insole text[] := ARRAY[]::text[];
  v_zs_insole_lining text[] := ARRAY[]::text[];
  -- CONS-8: consumo acumulado de componente que NÃO resolveu produto — vira
  -- linha de diagnóstico (product_id NULL) no fim, em vez de sumir.
  v_nopid_upper numeric := 0;
  v_nopid_lining numeric := 0;
  v_nopid_insole numeric := 0;
  v_nopid_insole_lining numeric := 0;
  v_warn text;
  v_dc_name text;
BEGIN
  IF p_grade IS NULL OR jsonb_typeof(p_grade) <> 'object' THEN
    RAISE EXCEPTION 'Grade invalida (precisa ser JSON object {size: pairs})';
  END IF;
  SELECT * INTO v_sheet FROM technical_sheets WHERE id = p_reference_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica % nao encontrada', p_reference_id; END IF;

  SELECT COALESCE(SUM((value)::numeric), 0) INTO v_total_qty
  FROM jsonb_each_text(p_grade) WHERE key ~ '^[0-9]+(/[0-9]+)?$' AND (value)::numeric > 0;
  IF v_total_qty <= 0 THEN RAISE EXCEPTION 'Grade vazia (sem pares)'; END IF;

  SELECT sole_product_id, sole_color INTO v_sole_product_id, v_sole_color
  FROM resolve_sole_color(p_reference_id, COALESCE(p_color, ''));

  IF p_material_variant_id IS NOT NULL THEN
    SELECT product_id INTO v_variant_sole_pid FROM public.resolve_sole_for_variant(p_material_variant_id);
    IF v_variant_sole_pid IS NOT NULL THEN v_sole_product_id := v_variant_sole_pid; END IF;
  END IF;

  v_is_palmilha_pronta := COALESCE(v_sheet.insole_ready_made, false)
    OR EXISTS (SELECT 1 FROM products WHERE id = v_sole_product_id AND sole_classification::text = 'palmilha_pronta');

  IF v_sole_product_id IS NOT NULL THEN
    SELECT COALESCE(is_fachetado, false) INTO v_is_fachetado
      FROM products WHERE id = v_sole_product_id;
  END IF;

  IF COALESCE(v_sheet.sole_drives_consumption, false) AND v_sole_product_id IS NOT NULL THEN
    SELECT bool_or(COALESCE(insole_lining_consumption_dm2, 0) > 0),
           bool_or(COALESCE(lining_consumption_dm2, 0) > 0)
      INTO v_sole_has_palm_forro, v_sole_has_cabedal_forro
      FROM sole_technical_specs WHERE sole_id = v_sole_product_id;
    v_suppress_cabedal_lining := COALESCE(v_sole_has_palm_forro, false)
                                 AND NOT COALESCE(v_sole_has_cabedal_forro, false);
  END IF;

  IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> '' THEN
    SELECT * INTO v_resolved FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
    v_upper_pid := v_resolved.product_id;
  END IF;

  -- CONS-7: o forro do CABEDAL não depende de insole_has_lining (que descreve a
  -- PALMILHA) — o motor TS canônico (orderConsumption.ts) nunca teve esse gate.
  -- O gate permanece só na emissão de 'Forração Palmilha' (abaixo), como no TS.
  IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
    IF p_color IS NULL OR btrim(p_color) = ''
       OR public.group_covers_color(v_sheet.lining_material, p_color) THEN
      v_lining_group := v_sheet.lining_material;
    ELSIF jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN
      SELECT t.acc->>'material', (t.acc->>'consumption')::numeric
        INTO v_lining_alt_group, v_lining_alt_cons
        FROM jsonb_array_elements(v_sheet.lining_accessories) WITH ORDINALITY AS t(acc, ord)
       WHERE COALESCE((t.acc->>'consumption')::numeric, 0) > 0
         AND COALESCE(t.acc->>'material', '') <> ''
         AND public.group_covers_color(t.acc->>'material', p_color)
       ORDER BY t.ord LIMIT 1;
      IF v_lining_alt_group IS NOT NULL THEN
        v_lining_is_alt := true; v_lining_group := v_lining_alt_group;
      ELSE
        v_lining_group := v_sheet.lining_material;
      END IF;
    ELSE
      v_lining_group := v_sheet.lining_material;
    END IF;

    IF v_lining_is_alt THEN
      SELECT product_id INTO v_lining_pid FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
      v_lining_pid := v_resolved.product_id;
    END IF;
  ELSIF jsonb_typeof(v_sheet.lining_accessories) = 'array' THEN -- CONS-7
    SELECT t.acc->>'material', (t.acc->>'consumption')::numeric
      INTO v_lining_alt_group, v_lining_alt_cons
      FROM jsonb_array_elements(v_sheet.lining_accessories) WITH ORDINALITY AS t(acc, ord)
     WHERE COALESCE((t.acc->>'consumption')::numeric, 0) > 0
       AND COALESCE(t.acc->>'material', '') <> ''
     ORDER BY public.group_covers_color(t.acc->>'material', p_color) DESC, t.ord
     LIMIT 1;
    IF v_lining_alt_group IS NOT NULL THEN
      v_lining_is_alt := true; v_lining_group := v_lining_alt_group;
      SELECT product_id INTO v_lining_pid FROM resolve_material_product(v_lining_group, p_color, 0, false);
    END IF;
  END IF;

  v_palmilha_color := p_color;
  IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> '' THEN
    IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
      SELECT palmilha_color INTO v_palmilha_color FROM technical_sheet_palmilha_colors
      WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
      ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
      v_palmilha_color := COALESCE(v_palmilha_color, p_color);
    END IF;
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
    v_insole_pid := v_resolved.product_id;
  END IF;

  IF p_material_variant_id IS NOT NULL THEN
    SELECT upper_consumption_override, lining_consumption_override, insole_consumption_override
      INTO v_variant FROM public.reference_material_variants WHERE id = p_material_variant_id;
    v_ovr_upper := v_variant.upper_consumption_override;
    v_ovr_lining := v_variant.lining_consumption_override;
    v_ovr_insole := v_variant.insole_consumption_override;
  END IF;

  FOR v_size, v_pairs IN
    SELECT split_part(key, '/', 1)::integer, value::numeric FROM jsonb_each_text(p_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$' AND (value)::numeric > 0
  LOOP
    v_upper  := NULLIF(COALESCE((v_sheet.upper_consumption_per_size  ->>(v_size::text))::numeric, 0), 0);
    v_lining := NULLIF(COALESCE((v_sheet.lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole := NULLIF(COALESCE((v_sheet.insole_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_insole_lining := NULLIF(COALESCE((v_sheet.insole_lining_consumption_per_size ->>(v_size::text))::numeric, 0), 0);
    v_fachete := NULL;

    IF (v_upper IS NULL OR v_lining IS NULL OR v_insole IS NULL OR v_insole_lining IS NULL OR v_is_fachetado)
       AND (COALESCE(v_sheet.sole_drives_consumption, false) OR v_is_fachetado)
       AND v_sole_product_id IS NOT NULL THEN
      SELECT * INTO v_spec FROM sole_technical_specs WHERE sole_id = v_sole_product_id AND size = v_size;
      IF FOUND THEN
        IF v_lining IS NULL AND COALESCE(v_spec.lining_consumption_dm2, 0) > 0 THEN v_lining := v_spec.lining_consumption_dm2; END IF;
        IF v_insole IS NULL AND COALESCE(v_spec.insole_consumption_dm2, 0) > 0 THEN v_insole := v_spec.insole_consumption_dm2; END IF;
        IF v_insole_lining IS NULL AND COALESCE(v_spec.insole_lining_consumption_dm2, 0) > 0 THEN v_insole_lining := v_spec.insole_lining_consumption_dm2; END IF;
        IF v_is_fachetado AND COALESCE(v_spec.fachete_lining_consumption_dm2, 0) > 0 THEN v_fachete := v_spec.fachete_lining_consumption_dm2; END IF;
      END IF;
    END IF;

    -- CONS-1 (contrato da mig 20260518120000, reintroduzido): tamanho SEM valor
    -- por numeração (nem per_size da ficha, nem spec do solado) que cai na média
    -- escalar é marcado — a linha sai com source='fallback_average' +
    -- consumption_warning em vez do rótulo enganoso 'sheet_per_size'.
    -- Override da variante e forro alternativo/suprimido são consumo EXPLÍCITO,
    -- não fallback.
    -- CONS-8: quando o escalar TAMBÉM é 0, o tamanho contribui ZERO — antes
    -- ficava fora dos dois avisos (o gate exigia escalar > 0) e o consumo saía
    -- silenciosamente menor. Agora entra em v_zs_* (mesmos guards).
    IF v_upper IS NULL AND v_ovr_upper IS NULL THEN
      IF COALESCE(v_sheet.upper_consumption, 0) > 0 THEN
        v_fb_upper := array_append(v_fb_upper, v_size::text);
      ELSE
        v_zs_upper := array_append(v_zs_upper, v_size::text);
      END IF;
    END IF;
    IF v_lining IS NULL AND v_ovr_lining IS NULL
       AND NOT v_lining_is_alt AND NOT v_suppress_cabedal_lining THEN
      IF COALESCE(v_sheet.lining_consumption, 0) > 0 THEN
        v_fb_lining := array_append(v_fb_lining, v_size::text);
      ELSE
        v_zs_lining := array_append(v_zs_lining, v_size::text);
      END IF;
    END IF;
    IF v_insole IS NULL AND v_ovr_insole IS NULL AND NOT v_is_palmilha_pronta THEN
      IF COALESCE(v_sheet.insole_consumption, 0) > 0 THEN
        v_fb_insole := array_append(v_fb_insole, v_size::text);
      ELSE
        v_zs_insole := array_append(v_zs_insole, v_size::text);
      END IF;
    END IF;
    IF v_insole_lining IS NULL AND NOT v_is_palmilha_pronta THEN
      IF COALESCE(v_sheet.insole_lining_consumption, 0) > 0 THEN
        v_fb_insole_lining := array_append(v_fb_insole_lining, v_size::text);
      ELSE
        v_zs_insole_lining := array_append(v_zs_insole_lining, v_size::text);
      END IF;
    END IF;

    v_upper  := COALESCE(v_upper,  v_sheet.upper_consumption,  0);
    v_lining := COALESCE(v_lining, v_sheet.lining_consumption, 0);
    v_insole := COALESCE(v_insole, v_sheet.insole_consumption, 0);
    v_insole_lining := COALESCE(v_insole_lining, v_sheet.insole_lining_consumption, 0);
    IF v_is_fachetado AND v_fachete IS NULL THEN
      v_warn_fachete_sizes := array_append(v_warn_fachete_sizes, v_size);
    END IF;

    IF p_material_variant_id IS NOT NULL THEN
      IF v_variant.upper_consumption_override  IS NOT NULL THEN v_upper  := v_variant.upper_consumption_override;  END IF;
      IF v_variant.lining_consumption_override IS NOT NULL THEN v_lining := v_variant.lining_consumption_override; END IF;
      IF v_variant.insole_consumption_override IS NOT NULL THEN v_insole := v_variant.insole_consumption_override; END IF;
    END IF;

    IF v_lining_is_alt THEN v_lining := COALESCE(v_lining_alt_cons, 0); END IF;

    IF v_suppress_cabedal_lining THEN v_lining := 0; END IF;

    IF v_upper_pid  IS NOT NULL AND v_upper  > 0 THEN
      v_acc_upper := jsonb_set(v_acc_upper, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_upper->>'required')::numeric, 0) + v_upper * v_pairs));
    ELSIF v_upper_pid IS NULL AND v_upper > 0 THEN
      v_nopid_upper := v_nopid_upper + v_upper * v_pairs;   -- CONS-8
    END IF;
    IF v_lining_pid IS NOT NULL AND v_lining > 0 THEN
      v_acc_lining := jsonb_set(v_acc_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_lining->>'required')::numeric, 0) + v_lining * v_pairs));
    ELSIF v_lining_pid IS NULL AND v_lining > 0 THEN
      v_nopid_lining := v_nopid_lining + v_lining * v_pairs; -- CONS-8
    END IF;
    IF v_insole_pid IS NOT NULL AND v_insole > 0 THEN
      v_acc_insole := jsonb_set(v_acc_insole, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole->>'required')::numeric, 0) + v_insole * v_pairs));
    ELSIF v_insole_pid IS NULL AND v_insole > 0 AND NOT v_is_palmilha_pronta THEN
      v_nopid_insole := v_nopid_insole + v_insole * v_pairs; -- CONS-8 (caso b)
    END IF;
    IF NOT v_is_palmilha_pronta AND v_lining_pid IS NOT NULL AND v_insole_lining > 0 THEN
      v_acc_insole_lining := jsonb_set(v_acc_insole_lining, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_insole_lining->>'required')::numeric, 0) + v_insole_lining * v_pairs));
    ELSIF NOT v_is_palmilha_pronta AND v_lining_pid IS NULL AND v_insole_lining > 0 THEN
      v_nopid_insole_lining := v_nopid_insole_lining + v_insole_lining * v_pairs; -- CONS-8
    END IF;
    IF v_is_fachetado AND v_fachete IS NOT NULL AND v_fachete > 0 THEN
      v_acc_fachete := jsonb_set(v_acc_fachete, ARRAY['required'],
        to_jsonb(COALESCE((v_acc_fachete->>'required')::numeric, 0) + v_fachete * v_pairs));
    END IF;

    IF v_sole_product_id IS NOT NULL THEN
      FOR v_std_item IN
        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit
          FROM sole_standard_items_consumption ssic
         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0
      LOOP
        v_key := v_std_item.pid::text;
        v_acc_required := COALESCE((v_acc_std #>> ARRAY[v_key,'required'])::numeric, 0) + v_std_item.cons * v_pairs;
        v_acc_std := jsonb_set(v_acc_std, ARRAY[v_key],
          jsonb_build_object('required', v_acc_required, 'unit', v_std_item.unit));
      END LOOP;
    END IF;
  END LOOP;

  IF v_sole_product_id IS NOT NULL THEN
    SELECT name, quantity INTO v_acc_name, v_acc_avail FROM products WHERE id = v_sole_product_id;
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', v_sole_product_id, 'product_name', v_acc_name,
      'color', v_sole_color, 'consumption_per_unit', 1, 'required', v_total_qty,
      'available', v_acc_avail, 'stock_ok', v_acc_avail >= v_total_qty,
      'debit_mode', 'hard',
      'source', CASE WHEN v_variant_sole_pid IS NOT NULL THEN 'variant_sole' ELSE 'primary_sole' END);
    v_covered_categories  := array_append(v_covered_categories,  'solado');
    v_covered_product_ids := array_append(v_covered_product_ids, v_sole_product_id);
  END IF;

  IF v_upper_pid IS NOT NULL AND COALESCE((v_acc_upper->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_upper_material_for_variant(p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_upper_pid);
    v_required := ((v_acc_upper->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_warn := NULL;
    IF array_length(v_fb_upper, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_upper, ', ');
    END IF;
    IF array_length(v_zs_upper, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_upper, ', ');
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', v_upper_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_upper, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', v_warn);
    v_covered_categories  := array_append(v_covered_categories,  'cabedal');
    v_covered_product_ids := array_append(v_covered_product_ids, v_upper_pid);
  END IF;

  IF v_lining_pid IS NOT NULL AND COALESCE((v_acc_lining->>'required')::numeric, 0) > 0 THEN
    IF v_lining_is_alt THEN
      SELECT product_id, product_name, available_qty, matched_by
        INTO v_resolved FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    END IF;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_warn := NULL;
    IF NOT v_lining_is_alt AND array_length(v_fb_lining, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_lining, ', ');
    END IF;
    IF NOT v_lining_is_alt AND array_length(v_zs_lining, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_lining, ', ');
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'Forração', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_lining_is_alt THEN 'lining_alt'
                     WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_lining, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', v_warn);
    v_covered_categories  := array_append(v_covered_categories,  'forro');
    v_covered_categories  := array_append(v_covered_categories,  'forração');
    v_covered_categories  := array_append(v_covered_categories,  'forracao');
    v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
  END IF;

  IF v_insole_pid IS NOT NULL AND COALESCE((v_acc_insole->>'required')::numeric, 0) > 0
     AND NOT v_is_palmilha_pronta THEN
    SELECT * INTO v_resolved FROM resolve_insole_material_for_variant(p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
    SELECT * INTO v_conv FROM get_material_conversion_info(v_insole_pid);
    v_required := ((v_acc_insole->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_warn := NULL;
    IF array_length(v_fb_insole, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole, ', ');
    END IF;
    IF array_length(v_zs_insole, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_insole, ', ');
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', v_insole_pid, 'product_name', v_resolved.product_name,
      'color', v_palmilha_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN v_resolved.matched_by = 'variant' THEN 'variant'
                     WHEN array_length(v_fb_insole, 1) > 0 THEN 'fallback_average'
                     ELSE 'sheet_per_size' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', v_warn);
    v_covered_categories  := array_append(v_covered_categories,  'palmilha');
    v_covered_product_ids := array_append(v_covered_product_ids, v_insole_pid);
  END IF;

  IF NOT v_is_palmilha_pronta
     AND v_lining_pid IS NOT NULL
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND COALESCE((v_acc_insole_lining->>'required')::numeric, 0) > 0 THEN
    IF v_lining_is_alt THEN
      SELECT product_id, product_name, available_qty, matched_by
        INTO v_resolved FROM resolve_material_product(v_lining_group, p_color, 0, false);
    ELSE
      SELECT * INTO v_resolved FROM resolve_lining_material_for_variant(p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
    END IF;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_lining_pid);
    v_required := ((v_acc_insole_lining->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    v_warn := NULL;
    IF array_length(v_fb_insole_lining, 1) > 0 THEN
      v_warn := 'Tamanhos usando a média escalar da ficha (sem consumo por numeração): ' || array_to_string(v_fb_insole_lining, ', ');
    END IF;
    IF array_length(v_zs_insole_lining, 1) > 0 THEN
      v_warn := COALESCE(v_warn || ' | ', '')
        || 'Tamanhos SEM consumo cadastrado — contribuíram ZERO ao cálculo: ' || array_to_string(v_zs_insole_lining, ', ');
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', v_lining_pid, 'product_name', v_resolved.product_name,
      'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_resolved.available_qty,
      'stock_ok', v_resolved.available_qty >= v_required, 'debit_mode', 'soft',
      'source', CASE WHEN array_length(v_fb_insole_lining, 1) > 0 THEN 'fallback_average'
                     ELSE 'insole_lining' END,
      'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning,
      'consumption_warning', v_warn);
    IF NOT (v_lining_pid = ANY(v_covered_product_ids)) THEN
      v_covered_product_ids := array_append(v_covered_product_ids, v_lining_pid);
    END IF;
  END IF;

  -- CONS-6 (paridade TS): o grupo do fachete vem de
  -- products.fachete_material_group_id do SOLADO (prioridade do motor canônico
  -- orderConsumption.ts); só na falta dele cai no lining_material da ficha.
  v_fachete_group := NULL;
  IF v_is_fachetado AND v_sole_product_id IS NOT NULL THEN
    SELECT pg2.name INTO v_fachete_group
      FROM products p2 JOIN product_groups pg2 ON pg2.id = p2.fachete_material_group_id
     WHERE p2.id = v_sole_product_id;
  END IF;
  v_fachete_group := COALESCE(v_fachete_group, NULLIF(v_sheet.lining_material, ''));

  IF v_is_fachetado
     AND v_fachete_group IS NOT NULL
     AND COALESCE((v_acc_fachete->>'required')::numeric, 0) > 0 THEN
    SELECT * INTO v_resolved FROM resolve_material_product(v_fachete_group, p_color, 0, false);
    IF v_resolved.product_id IS NOT NULL THEN
      SELECT * INTO v_conv FROM get_material_conversion_info(v_resolved.product_id);
      v_required := ((v_acc_fachete->>'required')::numeric / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
      v_result := v_result || jsonb_build_object(
        'component', 'Fachete', 'product_id', v_resolved.product_id, 'product_name', v_resolved.product_name,
        'color', p_color, 'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
        'required', v_required, 'available', v_resolved.available_qty,
        'stock_ok', v_resolved.available_qty >= v_required,
        'debit_mode', 'soft', 'source', 'sole_fachete',
        'matched_by', v_resolved.matched_by, 'unit', v_conv.target_unit,
        'consumption_warning', CASE
          WHEN array_length(v_warn_fachete_sizes, 1) > 0
            THEN 'Tamanhos sem consumo de fachete: ' || array_to_string(v_warn_fachete_sizes, ', ')
          ELSE NULL
        END);
    ELSE
      -- CONS-8: grupo do fachete cadastrado mas SEM produto resolvível (grupo
      -- vazio / cor inexistente) — antes a linha inteira sumia.
      v_result := v_result || jsonb_build_object(
        'component', 'Fachete', 'product_id', NULL, 'product_name', v_fachete_group,
        'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
        'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
        'consumption_warning', 'Fachete: o grupo "' || v_fachete_group
          || '" não resolve nenhum produto ativo no estoque — a forração do salto NÃO será reservada nem debitada. Cadastre um produto no grupo (ou corrija o grupo do fachete no solado).');
    END IF;
  ELSIF v_is_fachetado AND array_length(v_warn_fachete_sizes, 1) > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Fachete', 'product_id', NULL, 'product_name', COALESCE(v_fachete_group, v_sheet.lining_material, 'forro do fachete'),
      'color', p_color, 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'sole_fachete',
      'consumption_warning', 'Solado fachetado sem fachete_lining_consumption_dm2 nos tamanhos: '
        || array_to_string(v_warn_fachete_sizes, ', '));
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_acc_std) LOOP
    v_acc_required := (v_acc_std #>> ARRAY[v_key,'required'])::numeric;
    v_std_unit := (v_acc_std #>> ARRAY[v_key,'unit']);
    SELECT name, quantity, category, unit, color INTO v_acc_name, v_acc_avail, v_row_cat_norm, v_prod_unit, v_std_color FROM products WHERE id = v_key::uuid;
    IF v_acc_required > 0 AND v_acc_name IS NOT NULL THEN
      v_converted := public.convert_to_product_unit(v_acc_required, v_std_unit, v_prod_unit);
      v_result := v_result || jsonb_build_object(
        'component', 'Item padrão (solado)', 'product_id', v_key::uuid, 'product_name', v_acc_name,
        'color', COALESCE(v_std_color, ''), 'consumption_per_unit', ROUND(COALESCE(v_converted, v_acc_required) / NULLIF(v_total_qty, 0), 4),
        'required', COALESCE(v_converted, v_acc_required), 'available', v_acc_avail,
        'stock_ok', v_acc_avail >= COALESCE(v_converted, v_acc_required),
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row_cat_norm,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
        'source', 'sole_standard_per_size',
        'unit', CASE WHEN v_converted IS NOT NULL THEN v_prod_unit ELSE v_std_unit END,
        'conversion_warning', CASE
          WHEN v_converted IS NULL AND v_std_unit IS DISTINCT FROM v_prod_unit
            THEN 'Unidade do item-padrão (' || COALESCE(v_std_unit,'?') || ') incompatível com a unidade do produto (' || COALESCE(v_prod_unit,'?') || ') — quantidade NÃO convertida; cadastre a unidade correta'
          ELSE NULL END);
      v_covered_product_ids := array_append(v_covered_product_ids, v_key::uuid);
    END IF;
  END LOOP;

  IF COALESCE(v_sheet.component_colors_enabled, false)
     AND p_color IS NOT NULL AND btrim(p_color) <> '' THEN
    FOR v_row IN
      SELECT tcc.product_id AS pid, tcc.quantity_per_unit AS qpu, p.name AS pname,
             GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
             p.category AS category, p.unit AS unit, p.color AS color
        FROM technical_sheet_component_colors tcc
        JOIN products p ON p.id = tcc.product_id
       WHERE tcc.sheet_id = p_reference_id
         AND lower(btrim(extensions.unaccent(tcc.cabedal_color))) = lower(btrim(extensions.unaccent(p_color)))
    LOOP
      v_has_color_components := true;
      IF v_row.pid = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
      v_required := COALESCE(v_row.qpu, 0) * v_total_qty;
      IF v_required <= 0 THEN CONTINUE; END IF;
      v_result := v_result || jsonb_build_object(
        'component', 'Componente Direto', 'product_id', v_row.pid, 'product_name', v_row.pname,
        'color', COALESCE(v_row.color, ''),
        'consumption_per_unit', v_row.qpu, 'required', v_required,
        'available', v_row.available, 'stock_ok', v_row.available >= v_required,
        'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
          ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
        'source', 'component_color', 'unit', v_row.unit);
      v_covered_product_ids := array_append(v_covered_product_ids, v_row.pid);
    END LOOP;
  END IF;

  IF NOT v_has_color_components
     AND v_sheet.direct_components IS NOT NULL AND jsonb_typeof(v_sheet.direct_components) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_sheet.direct_components) LOOP
      v_pid := (v_item ->> 'product_id')::uuid;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        v_required := COALESCE((v_item ->> 'quantity')::numeric, 0) * v_total_qty;
        IF v_required > 0 THEN
          SELECT p.name AS name,
                 GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
                 p.category AS category, p.unit AS unit, p.color AS color
            INTO v_row FROM products p WHERE p.id = v_pid;
          IF FOUND THEN
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', v_pid, 'product_name', v_row.name,
              'color', COALESCE(v_row.color, ''),
              'consumption_per_unit', (v_item ->> 'quantity')::numeric, 'required', v_required,
              'available', v_row.available, 'stock_ok', v_row.available >= v_required,
              'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
                ('acessório','embalagem','cola / químico','ferramentas','solado','componente','componentes') THEN 'hard' ELSE 'soft' END,
              'source', 'direct_components', 'unit', v_row.unit);
            v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
          ELSE
            -- CONS-8 (caso a): o product_id do componente direto não existe mais
            -- em products (cadastro apagado). Antes o IF sem ELSE descartava a
            -- linha: a ficha pedia 8 binóculos/par e ninguém via nada.
            v_dc_name := COALESCE(NULLIF(btrim(v_item ->> 'product_name'), ''), 'Componente sem cadastro');
            v_result := v_result || jsonb_build_object(
              'component', 'Componente Direto', 'product_id', NULL, 'product_name', v_dc_name,
              'color', '', 'consumption_per_unit', 0, 'required', 0,
              'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
              -- sem 'unit': o Zod do frontend aceita unit ausente (optional),
              -- mas NÃO aceita null — e aqui não há produto pra dar a unidade.
              'consumption_warning', 'Componente direto "' || v_dc_name || '" ('
                || trim(to_char(COALESCE((v_item ->> 'quantity')::numeric, 0), 'FM999999990.####'))
                || '/par) não resolve produto no estoque — cadastro apagado. NÃO será reservado nem debitado. Recadastre o produto e refaça o vínculo em Ficha Técnica → Componentes.');
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  FOR v_row IN
    -- SQL-1: BOM EFETIVO da variante (get_effective_bom): linha compartilhada
    -- (variant NULL) + override da variante deste item; linha de OUTRA variante
    -- fica fora — paridade com o motor TS e com o débito.
    SELECT sm.product_id, sm.quantity_per_unit, p.name,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available,
           p.category, p.color AS product_color
      FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
      JOIN products p ON p.id = sm.product_id
     WHERE p.active = true
  LOOP
    v_row_cat_norm := LOWER(COALESCE(v_row.category, ''));
    IF v_row.product_id = ANY(v_covered_product_ids) THEN CONTINUE; END IF;
    IF v_row_cat_norm = ANY(v_covered_categories)    THEN CONTINUE; END IF;
    v_required := v_row.quantity_per_unit * v_total_qty;
    SELECT * INTO v_conv FROM get_material_conversion_info(v_row.product_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color,
      'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4),
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category,
      'unit', v_conv.target_unit,
      'conversion_warning', v_conv.conversion_warning);
    v_covered_product_ids := array_append(v_covered_product_ids, v_row.product_id);
  END LOOP;

  IF v_sheet.components_accessories IS NOT NULL AND jsonb_typeof(v_sheet.components_accessories) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_sheet.components_accessories) AS value LOOP
      IF COALESCE((v_item ->> 'mandatory')::boolean, false) <> true THEN CONTINUE; END IF;
      v_consumption := COALESCE((v_item ->> 'consumption')::numeric, 0);
      IF v_consumption <= 0 THEN CONTINUE; END IF;
      v_required := v_consumption * v_total_qty;
      v_pid := NULL;
      BEGIN v_pid := NULLIF(v_item ->> 'product_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      IF v_pid IS NULL THEN
        BEGIN v_pid := NULLIF(v_item ->> 'id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_pid := NULL; END;
      END IF;
      IF v_pid IS NULL AND COALESCE(v_item ->> 'material', '') <> '' THEN
        SELECT product_id INTO v_pid FROM resolve_material_product(v_item ->> 'material', p_color, v_required, false);
      END IF;
      IF v_pid IS NOT NULL AND NOT (v_pid = ANY(v_covered_product_ids)) THEN
        SELECT p.name AS name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))::numeric AS avail
          INTO v_row FROM products p WHERE p.id = v_pid AND p.active = true;
        IF FOUND THEN
          SELECT * INTO v_conv FROM get_material_conversion_info(v_pid);
          v_required := (v_required / NULLIF(v_conv.dm2_per_unit, 0)) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
          v_result := v_result || jsonb_build_object(
            'component', COALESCE(NULLIF(v_item ->> 'label', ''), 'Componente Extra (cabedal)'),
            'product_id', v_pid, 'product_name', v_row.name, 'color', p_color,
            'consumption_per_unit', ROUND(v_required / NULLIF(v_total_qty, 0), 4), 'required', v_required,
            'available', v_row.avail, 'stock_ok', v_row.avail >= v_required,
            'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
            'conversion_warning', v_conv.conversion_warning);
          v_covered_product_ids := array_append(v_covered_product_ids, v_pid);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── CONS-8: DIAGNÓSTICO — componentes que NÃO resolveram produto ──────────
  -- Linhas com product_id NULL e required 0. filter_caixa_by_packaging_mode as
  -- remove antes de reserva/débito/custeio/snapshot; a UI que chama a RPC
  -- direto (modal, precificação, wizard de compras) exibe o aviso.

  -- (c) Solado: a ficha aponta solado (texto livre, grupo ou primary) mas a
  -- cascata resolve_sole_color não chegou a produto nenhum.
  IF v_sole_product_id IS NULL
     AND (COALESCE(btrim(v_sheet.sole_material), '') <> ''
          OR v_sheet.sole_group_id IS NOT NULL
          OR v_sheet.primary_sole_id IS NOT NULL) THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Solado', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.sole_material), ''), 'Solado da ficha'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Solado "'
        || COALESCE(NULLIF(btrim(v_sheet.sole_material), ''), '(sem nome)')
        || '" não resolve produto no estoque (texto livre, sem grupo de solado, sem solado principal e sem mapeamento por cor) — '
        || trim(to_char(v_total_qty, 'FM999999990.##'))
        || ' pares ficam SEM solado no consumo, e ele não será reservado nem debitado. Vincule o solado em Ficha Técnica → Solado.');
  END IF;

  -- (b) Palmilha: há consumo de palmilha mas o material não resolve produto
  -- (insole_material vazio — NL01–NL04 — ou grupo sem produto ativo).
  IF NOT v_is_palmilha_pronta AND v_insole_pid IS NULL AND v_nopid_insole > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Palmilha', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.insole_material), ''), 'Palmilha sem material'),
      'color', COALESCE(v_palmilha_color, p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', CASE
        WHEN COALESCE(btrim(v_sheet.insole_material), '') = ''
          THEN 'A ficha tem consumo de palmilha ('
               || trim(to_char(v_nopid_insole, 'FM999999990.##'))
               || ' dm² no total) mas NÃO tem Material da Palmilha cadastrado — a linha inteira fica fora do consumo, da reserva e do débito. Cadastre em Ficha Técnica → Palmilha.'
        ELSE 'Material da palmilha "' || btrim(v_sheet.insole_material)
             || '" não resolve produto ativo no estoque — '
             || trim(to_char(v_nopid_insole, 'FM999999990.##'))
             || ' dm² ficam fora do consumo, da reserva e do débito.'
        END);
  END IF;

  -- Cabedal / Forração / Forração Palmilha sem produto resolvido.
  IF v_upper_pid IS NULL AND v_nopid_upper > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Cabedal', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(v_sheet.upper_material), ''), 'Cabedal sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Cabedal: '
        || CASE WHEN COALESCE(btrim(v_sheet.upper_material), '') = ''
                THEN 'a ficha tem consumo mas NÃO tem material cadastrado'
                ELSE 'o material "' || btrim(v_sheet.upper_material) || '" não resolve produto ativo no estoque' END
        || ' — ' || trim(to_char(v_nopid_upper, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  IF v_lining_pid IS NULL AND v_nopid_lining > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Forração', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), ''), 'Forração sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Forração: '
        || CASE WHEN COALESCE(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), '') = ''
                THEN 'a ficha tem consumo mas NÃO tem material de forro cadastrado'
                ELSE 'o material "' || btrim(COALESCE(v_lining_group, v_sheet.lining_material)) || '" não resolve produto ativo no estoque' END
        || ' — ' || trim(to_char(v_nopid_lining, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  IF NOT v_is_palmilha_pronta
     AND COALESCE(v_sheet.insole_has_lining, true) = true
     AND v_lining_pid IS NULL AND v_nopid_insole_lining > 0 THEN
    v_result := v_result || jsonb_build_object(
      'component', 'Forração Palmilha', 'product_id', NULL,
      'product_name', COALESCE(NULLIF(btrim(COALESCE(v_lining_group, v_sheet.lining_material)), ''), 'Forração sem material'),
      'color', COALESCE(p_color, ''), 'consumption_per_unit', 0, 'required', 0,
      'available', 0, 'stock_ok', false, 'debit_mode', 'soft', 'source', 'unresolved',
      'consumption_warning', 'Forração da palmilha: o material de forro da ficha não resolve produto ativo no estoque — '
        || trim(to_char(v_nopid_insole_lining, 'FM999999990.##'))
        || ' dm² ficam fora do consumo, da reserva e do débito.');
  END IF;

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text, uuid) IS
  'Motor ÚNICO de consumo por grade. Componente que não resolve produto EMITE linha de diagnóstico (product_id NULL, required 0, source=unresolved) em vez de sumir — mig 20260925131000. As linhas de diagnóstico são removidas por filter_caixa_by_packaging_mode antes de reserva/débito/custeio/snapshot.';

-- ── 4) Reparo de cadastro: re-mapeia direct_components órfãos por NOME ──────
-- Só remapeia quando o nome gravado casa EXATAMENTE (unaccent+lower) com UM
-- ÚNICO produto ativo. Ambíguo ou sem match fica pro aviso do motor.
--
-- ⚠ EFEITOS COLATERAIS do UPDATE em technical_sheets (mapeados em 2026-09-25):
--   • `trg_mark_so_costs_dirty_from_sheet` (AFTER UPDATE OF direct_components)
--     marca `sale_orders.costs_dirty_at`, `sale_orders.reservations_outdated_at`
--     e `technical_sheet_snapshots.outdated_at` dos PVs da ficha. É o
--     comportamento CORRETO (o componente mudou de produto), mas quem debitar
--     depois vai ver o RAISE WARNING de "snapshot DESATUALIZADO".
--   • `tg_strip_invalid_direct_components` (BEFORE) só derruba entrada cujo
--     product_id não é UUID válido — órfão de UUID válido NÃO é perdido.
--   • `tg_guard_implausible_consumption` (BEFORE) ABORTA o UPDATE quando a
--     ficha tem consumo > 50 dm²/par (dado sujo pré-existente: "CF 09 " tem
--     upper_consumption = 2000 E um direct_component órfão). Por isso cada
--     UPDATE roda em bloco próprio com EXCEPTION: uma ficha problemática vira
--     NOTICE em vez de derrubar a migration inteira.
DO $repair$
DECLARE
  r RECORD;
  v_fixed  int := 0;
  v_skip   int := 0;
  v_left   int := 0;
BEGIN
  FOR r IN
    WITH exploded AS (
      SELECT ts.id AS sheet_id, e.ord AS ord, e.elem AS elem
        FROM public.technical_sheets ts,
             LATERAL jsonb_array_elements(ts.direct_components) WITH ORDINALITY AS e(elem, ord)
       WHERE jsonb_typeof(ts.direct_components) = 'array'
    ),
    orphans AS (
      SELECT x.sheet_id, x.ord,
             NULLIF(btrim(x.elem ->> 'product_name'), '') AS nome
        FROM exploded x
       WHERE COALESCE(x.elem ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND NOT EXISTS (
           SELECT 1 FROM public.products p WHERE p.id = (x.elem ->> 'product_id')::uuid)
    )
    SELECT o.sheet_id, o.ord, m.id AS new_pid
      FROM orphans o
      JOIN LATERAL (
        SELECT p.id
          FROM public.products p
         WHERE p.active = true
           AND lower(btrim(extensions.unaccent(p.name))) = lower(btrim(extensions.unaccent(o.nome)))
         LIMIT 1
      ) m ON true
     WHERE o.nome IS NOT NULL
       AND (SELECT count(*) FROM public.products p2
             WHERE p2.active = true
               AND lower(btrim(extensions.unaccent(p2.name))) = lower(btrim(extensions.unaccent(o.nome)))) = 1
     ORDER BY o.sheet_id, o.ord
  LOOP
    BEGIN
      UPDATE public.technical_sheets
         SET direct_components = jsonb_set(
               direct_components,
               ARRAY[(r.ord - 1)::text, 'product_id'],
               to_jsonb(r.new_pid::text),
               false)
       WHERE id = r.sheet_id;
      v_fixed := v_fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Trigger de guarda da própria ficha (consumo implausível, FK órfão…)
      -- bloqueou o UPDATE: pula a ficha, o motor segue emitindo o aviso.
      v_skip := v_skip + 1;
      RAISE NOTICE 'reparo direct_components: ficha % (pos %) PULADA — %',
        r.sheet_id, r.ord, SQLERRM;
    END;
  END LOOP;

  SELECT count(*) INTO v_left
    FROM public.technical_sheets ts,
         LATERAL jsonb_array_elements(ts.direct_components) AS e
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND COALESCE(e ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (e ->> 'product_id')::uuid);

  RAISE NOTICE 'direct_components órfãos: % remapeados por nome único, % pulados por trigger de guarda, % continuam órfãos (viram aviso source=unresolved no motor)',
    v_fixed, v_skip, v_left;
END;
$repair$;
