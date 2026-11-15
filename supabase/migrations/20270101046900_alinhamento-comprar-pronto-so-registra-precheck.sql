-- =============================================================================
-- Alinhamento: pré-checagem aceita Comprar pronto só com cor (so-registra)
-- =============================================================================
-- Sintoma (15/11/2026, PV novo /sales/new, TIRA CHATA 20 mm · GLOW METALIC ·
-- CHAMPAGNE, ORIGEM "Comprar pronto"):
--   "Erro: O pedido NÃO foi salvo. Tira sem cor/variante canonica congelada
--    no PV"
--
-- Causa: a 45300 (so-registra) fez o writer congelar buy_ready de napa com
--   strap_variant_id = NULL e finished_product_id = NULL (só color_id +
--   metros), e patchou o RAMO sku_acabado da guarda de alinhamento. Mas a
--   PRÉ-CHECAGEM genérica — herdada da 40200 — ainda exige
--   variante OU finished_product_id ANTES de escolher o ramo. As duas
--   condições são mutuamente impossíveis: a linha nunca chega ao ramo que
--   a 45300 escreveu para aceitá-la. Mesma classe de bug writer × guarda
--   que a 39600 e a 40200 já fecharam nas outras camadas.
--
-- Correção: na pré-checagem, buy_ready com cor canônica congelada completa
-- a identidade (terceiro caminho). Cada ramo abaixo continua revalidando:
--   reference_base + sku_acabado → exige variante E SKU nulos (45300)
--   reference_base (demais)      → exige variante via EXISTS
--   finished_product_group       → exige finished_product_id (45600)
--
-- Marcador: strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900
-- =============================================================================

DO $patch_precheck$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$    -- strap_alinhamento_sku_acabado_sem_variante_20270101040200
    -- buy_ready do PV (31900) congela finished_product_id SEM variante Hub.
    -- Identidade completa = strap_variant_id OU finished_product_id; cada ramo
    -- abaixo revalida o campo da sua identidade (o ramo sku_acabado exige
    -- variante NULA + SKU acabado; internal e grupo acabado exigem a variante
    -- via EXISTS), entao aceitar um dos dois aqui nao abre caminho para linha
    -- sem identidade.
    BEGIN
      PERFORM nullif(v_source ->> 'finished_product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Snapshot de identidade/origem da tira possui UUID invalido';
    END;
    IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id
       OR (v_source_variant_id IS NULL
           AND nullif(v_source ->> 'finished_product_id', '') IS NULL) THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;$old$;
  v_new text := $new$    -- strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900
    -- 45300: Comprar pronto de napa congela buy_ready + color_id SEM
    -- finished_product_id e SEM variante. A 40200 aceitava variante OU SKU;
    -- faltou o terceiro caminho. Cada ramo abaixo revalida (sku_acabado
    -- exige os dois nulos; finished_product_group exige o SKU; internal
    -- exige a variante), entao liberar buy_ready so com cor aqui nao abre
    -- furo.
    BEGIN
      PERFORM nullif(v_source ->> 'finished_product_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Snapshot de identidade/origem da tira possui UUID invalido';
    END;
    IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id
       OR (v_source_variant_id IS NULL
           AND nullif(v_source ->> 'finished_product_id', '') IS NULL
           AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900' IN v_def) > 0 THEN
    RETURN; -- ja aplicado
  END IF;

  -- O ramo so-registra da 45300 precisa existir: sem ele, liberar buy_ready
  -- sem SKU na pre-checagem deixaria a linha sem validacao no ramo.
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Ramo so-registra (45300) ausente no corpo vivo; aplique a 45300 antes da 46900';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Pre-checagem 40200 nao encontrada (hits=%); corpo mudou, revise 46900',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_comprar_pronto_so_registra_precheck_20270101046900' IN v_def) = 0
     OR position($chk$AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN$chk$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-checagem nao ficou com o contrato so-registra; revise 46900';
  END IF;
  -- Continua barrando internal sem variante (nao virou opcional).
  IF position($chk2$OR (v_source_variant_id IS NULL
           AND nullif(v_source ->> 'finished_product_id', '') IS NULL
           AND v_source_mode IS DISTINCT FROM 'buy_ready') THEN$chk2$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-checagem relaxou internal sem variante; revise 46900';
  END IF;
  -- Cor canonica continua obrigatoria.
  IF position($chk3$IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id$chk3$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-checagem perdeu a exigencia de cor; revise 46900';
  END IF;
END;
$patch_precheck$;

COMMENT ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment() IS
  'Valida sale_order_items.strap_colors/strap_sourcing contra a ficha tecnica vigente. Identidade congelada: strap_variant_id (internal) OU finished_product_id (strass buy_ready) OU so color_id em buy_ready de napa (45300/46900 so-registra). Cada ramo revalida o campo da sua identidade.';
