-- =============================================================================
-- Alinhamento: Comprar pronto entra pelo source_mode buy_ready (não só pv_origem)
-- =============================================================================
-- Sintoma (16/11/2026, PV novo /sales/new, E705 · TIRA CHATA 20 mm · GLOW
-- METALIC · CHAMPAGNE, ORIGEM "Comprar pronto" na tela):
--   "Erro: O pedido NÃO foi salvo. Tira interna deve usar a cor exigida pela
--    ficha, origem internal e napa exata"
--
-- Causa: a 45300 roteia o ramo so-registra só com
--   pv_origem = 'sku_acabado'. No PV novo o catálogo aplica default Prestador
--   (pv_origem='fabrica') e o operador troca a ORIGEM — o strap_sourcing fica
--   buy_ready completo ("histórico congelado"), mas se pv_origem não acompanhar
--   (ou outro item do lote ficar fabrica+buy_ready), o ELSIF reference_base
--   interno dispara: source_mode buy_ready ≠ 'internal' → mesma RAISE.
--
-- A 46900 já liberou a pré-checagem; este patch fecha o roteamento do ramo.
--
-- Correção: reference_base + (pv_origem=sku_acabado OU source_mode=buy_ready)
-- entra no ramo so-registra. O ELSIF interno continua exigindo internal.
--
-- Marcador: strap_alinhamento_comprar_pronto_honra_buy_ready_20270101047000
-- =============================================================================

DO $patch_route$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$-- strap_comprar_pronto_so_registra_20270101045300
    -- Tira de napa comprada pronta só registra napa · cor + metros: origem
    -- buy_ready, cor da tira, e NENHUM SKU/variante/receita/napa oficial.
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN$old$;
  v_new text := $new$-- strap_comprar_pronto_so_registra_20270101045300
    -- strap_alinhamento_comprar_pronto_honra_buy_ready_20270101047000
    -- Tira de napa comprada pronta só registra napa · cor + metros: origem
    -- buy_ready, cor da tira, e NENHUM SKU/variante/receita/napa oficial.
    -- Roteia também por source_mode=buy_ready: o default Prestador do catálogo
    -- pode deixar pv_origem='fabrica' enquanto o operador já congelou buy_ready.
    IF v_basis = 'reference_base'
       AND (
         nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
         OR v_source_mode = 'buy_ready'
       ) THEN$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_comprar_pronto_honra_buy_ready_20270101047000' IN v_def) > 0 THEN
    RETURN; -- ja aplicado
  END IF;

  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Ramo so-registra (45300) ausente no corpo vivo; aplique a 45300 antes da 47000';
  END IF;
  IF position('strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Precheck 46900 ausente no corpo vivo; aplique a 46900 antes da 47000';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ancora do ramo so-registra 45300 nao encontrada (hits=%); revise 47000',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_comprar_pronto_honra_buy_ready_20270101047000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador 47000 nao gravado no alinhamento; revise 47000';
  END IF;
  IF position($chk$OR v_source_mode = 'buy_ready'
       ) THEN$chk$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Roteamento buy_ready nao ficou no IF so-registra; revise 47000';
  END IF;
  -- ELSIF interno continua barrando buy_ready (nao virou opcional).
  IF position($chk2$OR v_source_mode IS DISTINCT FROM 'internal'$chk2$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'ELSIF interno perdeu a exigencia de source_mode=internal; revise 47000';
  END IF;
END;
$patch_route$;

COMMENT ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment() IS
  'Valida sale_order_items.strap_colors/strap_sourcing contra a ficha tecnica vigente. reference_base + (pv_origem=sku_acabado OU source_mode=buy_ready) → so-registra (45300/46900/47000). reference_base demais → internal. finished_product_group → buy_ready com SKU.';
