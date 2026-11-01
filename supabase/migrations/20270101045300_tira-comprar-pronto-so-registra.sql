-- =============================================================================
-- Tira de NAPA em "Comprar pronto" só registra napa · cor + metros
-- =============================================================================
-- Spec: specs/tira-comprar-pronto-so-registra.md (grill do dono 11/10/2026).
-- Marcador: strap_comprar_pronto_so_registra_20270101045300
--
-- Sintoma (PV novo I701 GLOW METALIC CHAMPAGNE, 01/11/2026):
--   "O pedido NÃO foi salvo. Escritor legado de produto de tira congelado;
--    use o catalogo canonico"
--
-- Causa:
--   O ramo reference_base + sku_acabado do prepare (31900) fazia INSERT em
--   products com is_artisanal=true SEM o token app.artisanal_strap_catalog_write.
--   O guard tg_guard_legacy_artisanal_product_writer abortava o PV inteiro.
--   A 45200 trocou o INSERT por RAISE pedindo cadastro no Hub — ainda bloqueia
--   e contradiz a decisão do dono (D1): Comprar pronto de napa NÃO cria SKU.
--
-- Correção (só tira de napa / reference_base + sku_acabado):
--   1. writer: valida cor, congela buy_ready + color_id + napa + metros;
--      finished_product_id/variante/receita ficam NULL; não exige group_id.
--   2. alinhamento: aceita esse snapshot sem SKU/variante.
--   3. guarda strap_sourcing: buy_ready sem variante E sem SKU é válido
--      (registro de napa).
--
-- STRASS (finished_product_group) NÃO muda: continua exigindo SKU do grupo.
-- enqueue já ignora buy_ready sem variante (vivo); não precisa de patch.
-- =============================================================================

-- ── 1. Writer ───────────────────────────────────────────────────────────────
DO $patch_writer$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_start_marker text := '-- strap_pv_sku_acabado_fornecedor_20270101024000';
  v_end_marker text := 'ELSIF v_sheet_basis = ''reference_base'' THEN';
  v_start integer;
  v_end integer;
  v_new text := $new$-- strap_comprar_pronto_so_registra_20270101045300
    -- Comprar pronto de tira de napa só registra napa · cor + metros
    -- (substitui 24000/28600/31900/33000/33200/45200): não exige grupo
    -- acabado na ficha, não acha nem cria SKU, não gera demanda. A cor é a
    -- da própria tira; follow_main usa a Cor Principal do item.
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      v_color_mode := coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main');
      IF v_color_mode = 'select_on_order' THEN
        v_line_color_id := public.try_parse_uuid(v_line ->> 'color_id');
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: selecione a cor da tira comprada pronta no Pedido de Venda',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
        SELECT c.name INTO v_line_color_name
          FROM public.canonical_colors c
         WHERE c.id = v_line_color_id
           AND c.active;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Modelo % / %, %: a cor escolhida para a tira comprada pronta nao existe ou esta inativa',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSE
        v_line_color_id := v_color_id;
        v_line_color_name := v_color_name;
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION 'Modelo % / %, %: tira comprada pronta exige a Cor Principal canonica do item',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      END IF;
      v_line := (v_line - 'color_id') || jsonb_build_object(
        'color', v_line_color_name, 'color_id', v_line_color_id
      );
      v_sourcing := jsonb_set(
        v_sourcing,
        ARRAY[v_line_id::text],
        (v_existing_source
          - 'source_mode' - 'color_id' - 'strap_variant_id' - 'finished_product_id'
          - 'recipe_id' - 'base_product_id' - 'base_group_id' - 'base_group_name'
          - 'gross_required_m')
        || jsonb_build_object(
          'source_mode', 'buy_ready',
          'color_id', v_line_color_id,
          'base_group_id', v_line -> 'base_group_id',
          'base_group_name', v_line -> 'base_group_name',
          'strap_variant_id', NULL,
          'finished_product_id', NULL,
          'recipe_id', NULL,
          'base_product_id', NULL,
          'gross_required_m', round(public.calculate_strap_line_required_m(
            v_line,
            coalesce(
              nullif(p_item ->> 'quantity', '')::numeric,
              coalesce(nullif(p_item ->> 'fichas', '')::numeric, 1) * coalesce((
                SELECT sum(g.value::numeric)
                  FROM jsonb_each_text(CASE WHEN jsonb_typeof(p_item -> 'grade') = 'object'
                    THEN p_item -> 'grade' ELSE '{}'::jsonb END) g
                 WHERE g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              ), 0)
            ),
            coalesce(p_item -> 'grade', '{}'::jsonb)
          ), 4)
        ),
        true
      );
    $new$;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_start := position(v_start_marker IN v_def);
  v_end := position(v_end_marker IN v_def);
  IF v_start = 0 OR v_end = 0 OR v_end <= v_start
     OR position(v_start_marker IN substr(v_def, v_start + 1)) > 0
     OR position(v_end_marker IN substr(v_def, v_end + 1)) > 0 THEN
    RAISE EXCEPTION
      'prepare: ancora do ramo sku_acabado nao encontrada/unica (start=% end=%); revise 45300',
      v_start, v_end;
  END IF;
  v_def := left(v_def, v_start - 1) || v_new || substr(v_def, v_end);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'prepare: marcador 45300 nao gravado';
  END IF;
  IF position('INSERT INTO public.products' IN v_def) > 0 THEN
    RAISE EXCEPTION 'prepare: ainda ha INSERT em products apos so-registra';
  END IF;
  IF position('strap_pv_sku_acabado_exige_cadastro_hub_20270101045200' IN v_def) > 0 THEN
    RAISE EXCEPTION 'prepare: RAISE de Hub 45200 ainda presente';
  END IF;
END
$patch_writer$;

-- ── 2. Alinhamento do item ──────────────────────────────────────────────────
DO $patch_alignment$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_start_marker text := '-- strap_pv_sku_acabado_fornecedor_20270101024000';
  v_end_marker text := 'ELSIF v_basis = ''reference_base'' THEN';
  v_start integer;
  v_end integer;
  v_new text := $new$-- strap_comprar_pronto_so_registra_20270101045300
    -- Tira de napa comprada pronta só registra napa · cor + metros: origem
    -- buy_ready, cor da tira, e NENHUM SKU/variante/receita/napa oficial.
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
      IF (
           v_color_mode = 'follow_main'
           AND (v_expected_color_id IS NULL
                OR v_line_color_id IS DISTINCT FROM v_expected_color_id)
         )
         OR v_line_color_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'
         OR v_source_recipe_id IS NOT NULL
         OR v_source_base_product_id IS NOT NULL
         OR v_source_variant_id IS NOT NULL
         OR nullif(v_source ->> 'finished_product_id', '') IS NOT NULL THEN
        RAISE EXCEPTION 'Tira comprada pronta so registra cor e metros: origem buy_ready, cor da tira e nenhum SKU/variante';
      END IF;
    $new$;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_start := position(v_start_marker IN v_def);
  v_end := position(v_end_marker IN v_def);
  IF v_start = 0 OR v_end = 0 OR v_end <= v_start
     OR position(v_start_marker IN substr(v_def, v_start + 1)) > 0
     OR position(v_end_marker IN substr(v_def, v_end + 1)) > 0 THEN
    RAISE EXCEPTION
      'alinhamento: ancora do ramo sku_acabado nao encontrada/unica (start=% end=%); revise 45300',
      v_start, v_end;
  END IF;
  v_def := left(v_def, v_start - 1) || v_new || substr(v_def, v_end);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'alinhamento: marcador 45300 nao gravado';
  END IF;
  IF position('SKU acabado da tira pronta nao corresponde' IN v_def) > 0 THEN
    RAISE EXCEPTION 'alinhamento: ainda exige SKU acabado no ramo napa';
  END IF;
END
$patch_alignment$;

-- ── 3. Guarda de strap_sourcing (pós-39600) ─────────────────────────────────
DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_version_and_guard_sale_order_item_strap_sourcing()'::regprocedure;
  v_def text;
  v_old text := $old$       OR (v_value->>'source_mode'='buy_ready'
           AND nullif(v_value->>'strap_variant_id','') IS NULL
           AND nullif(v_value->>'finished_product_id','') IS NULL) THEN
      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;$old$;
  v_new text := $new$       -- strap_comprar_pronto_so_registra_20270101045300
       -- buy_ready sem variante E sem SKU = registro de napa (só cor + metros).
       OR (v_value->>'source_mode'='buy_ready'
           AND nullif(v_value->>'strap_variant_id','') IS NULL
           AND nullif(v_value->>'finished_product_id','') IS NULL
           AND nullif(v_value->>'color_id','') IS NULL) THEN
      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_version_and_guard_sale_order_item_strap_sourcing()') IS NULL THEN
    RAISE EXCEPTION 'tg_version_and_guard_sale_order_item_strap_sourcing() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'guarda strap_sourcing: ancora buy_ready sem SKU nao encontrada (hits=%); revise 45300',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'guarda: marcador 45300 nao gravado';
  END IF;
  -- Continua barrando buy_ready sem color_id (identidade mínima do registro).
  IF position($chk$AND nullif(v_value->>'color_id','') IS NULL) THEN$chk$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'guarda: buy_ready sem color_id deveria continuar invalido';
  END IF;
END
$patch_guard$;

COMMENT ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb) IS
  'Prepara tiras do item do PV. reference_base + sku_acabado (Comprar pronto de napa) so registra cor + metros — nao cria SKU (45300 / spec tira-comprar-pronto-so-registra). finished_product_group (strass) continua resolvendo SKU do grupo.';
