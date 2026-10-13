-- =============================================================================
-- Alinhamento de tira no PV: "Comprar pronto" identifica por SKU acabado
-- =============================================================================
-- Sintoma (PV novo, 13/10/2026, tira FRENTE TIRA CHATA 8MM / NAPA ROOTS com
-- ORIGEM trocada para "Comprar pronto", cor COR DO CABEDAL = OFF WHITE):
--   "Erro: O pedido NAO foi salvo. Tira sem cor/variante canonica congelada
--    no PV"
-- O PV inteiro aborta (5 itens, 1.860 pares), nao so a linha da tira.
--
-- Causa: a MESMA divergencia writer x guarda que a 39600 fechou, so que na
-- SEGUNDA guarda da cadeia. A 39600 corrigiu
-- `tg_version_and_guard_sale_order_item_strap_sourcing` (erro "Origem/variante
-- persistida invalida para linha %"); com ela aplicada, o INSERT avanca e
-- esbarra na guarda seguinte.
--
-- Ordem dos BEFORE triggers de sale_order_items (alfabetica), no INSERT:
--   trg_guard_sale_order_item_strap_sourcing_insert      -> corrigida pela 39600
--   trg_validate_sale_order_item_strap_color_alignment_insert -> esta aqui
--
--   writer  `prepare_sale_order_item_internal_straps`, ramo
--           v_sheet_basis='reference_base' AND pv_origem='sku_acabado'
--           (introduzido pela 20270101031900) congela DE PROPOSITO:
--             'source_mode','buy_ready', 'strap_variant_id', NULL,
--             'finished_product_id', <SKU acabado da Cor Principal>
--
--   guarda  `tg_validate_sale_order_item_strap_color_alignment` exige
--           `v_source_variant_id IS NOT NULL` numa PRE-CHECAGEM generica, que
--           roda ANTES de escolher o ramo por identidade.
--
-- A 31900 patchou esta mesma funcao -- adicionou o ramo
-- `IF v_basis = 'reference_base' AND pv_origem = 'sku_acabado'`, que exige o
-- OPOSTO (`v_source_variant_id IS NOT NULL` -> RAISE 'Tira pronta exige origem
-- buy_ready com SKU acabado e Cor Principal') -- mas NAO mexeu na pre-checagem
-- logo acima. As duas condicoes sao mutuamente impossiveis: a linha nunca
-- chegava ao ramo que a aceitaria. Codigo morto desde que foi escrito, igual ao
-- que a 39600 mediu na outra guarda.
--
-- O lado TS ja migrou (`isCompleteStrapSourcingSelection` em
-- src/lib/strapSourcing.ts aceita strap_variant_id OU finished_product_id), por
-- isso a tela valida, libera o botao "Criar Pedido" e o banco recusa.
--
-- Esta migration alinha a PRE-CHECAGEM ao writer:
--   identidade congelada completa = strap_variant_id OU finished_product_id.
--
-- ⚠ Isto NAO relaxa nenhuma identidade, porque cada ramo abaixo revalida o
-- campo que lhe cabe -- e os tres ramos sao exaustivos:
--   reference_base + sku_acabado -> EXIGE variante NULA e confere o SKU acabado
--                                   contra grupo/cor da ficha (EXISTS products)
--   reference_base (demais)      -> EXIGE source_mode='internal', receita,
--                                   produto-base e `av.id = v_source_variant_id`
--                                   (EXISTS com NULL nunca casa)
--   finished_product_group       -> EXIGE `av.id = v_source_variant_id` idem
-- Ou seja: uma linha que chegue aqui com os DOIS campos nulos continua barrada,
-- so que pela mensagem especifica do seu ramo.
--
-- ⚠ O cast do SKU acabado passa a ser validado AQUI tambem. No UPDATE esta
-- guarda roda ANTES da 39600 ('trg_validate...' < 'trg_version...' na ordem
-- alfabetica), entao sem este BEGIN/EXCEPTION um finished_product_id malformado
-- estouraria com "invalid input syntax for type uuid" cru la na frente, no
-- EXISTS do ramo sku_acabado, em vez da mensagem de snapshot invalido.
--
-- Patch por substituicao de texto do corpo VIVO (padrao 24000/28500/28600/
-- 31900/32200/32300/39600); falha alto se o trecho esperado nao existir.
-- Marcador: strap_alinhamento_sku_acabado_sem_variante_20270101040200
-- =============================================================================

DO $patch_alinhamento$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$    IF v_line_color_id IS NULL
       OR v_source_color_id IS DISTINCT FROM v_line_color_id
       OR v_source_variant_id IS NULL THEN
      RAISE EXCEPTION 'Tira sem cor/variante canonica congelada no PV';
    END IF;$old$;
  v_new text := $new$    -- strap_alinhamento_sku_acabado_sem_variante_20270101040200
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
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_sku_acabado_sem_variante_20270101040200' IN v_def) > 0 THEN
    RETURN; -- ja aplicado
  END IF;

  -- O ramo sku_acabado da 31900 precisa existir: sem ele, relaxar a
  -- pre-checagem deixaria a linha sem NENHUMA validacao de identidade.
  -- Conferido pelo RAISE do proprio ramo, e NAO pelo marcador literal da 31900:
  -- no repo, o ultimo arquivo que cita um marcador e tratado como quem define
  -- aquele corpo (contrato pvSkuAcabadoBuyReadySemVariante), e esta migration
  -- patcha a pre-checagem, nao o ramo.
  IF position($r31900$RAISE EXCEPTION 'Tira pronta exige origem buy_ready com SKU acabado e Cor Principal';$r31900$ IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Ramo sku_acabado (31900) ausente no corpo vivo; aplique a 31900 antes da 40200';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Pre-checagem de cor/variante nao encontrada (hits=%); corpo mudou, revise 40200',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;

  -- Conferencia do corpo VIVO: o arquivo da migration nao prova nada sozinho.
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_alinhamento_sku_acabado_sem_variante_20270101040200' IN v_def) = 0
     OR position($chk$AND nullif(v_source ->> 'finished_product_id', '') IS NULL) THEN$chk$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-checagem nao ficou com o contrato novo; revise 40200';
  END IF;
  -- Os tres ramos de identidade precisam ter sobrevivido intactos.
  IF position($chk2$RAISE EXCEPTION 'Tira pronta exige origem buy_ready com SKU acabado e Cor Principal';$chk2$ IN v_def) = 0
     OR position($chk3$RAISE EXCEPTION 'Tira interna deve usar a cor exigida pela ficha, origem internal e napa exata';$chk3$ IN v_def) = 0
     OR position($chk4$RAISE EXCEPTION 'Tira de grupo acabado exige origem fixa buy_ready';$chk4$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Guarda perdeu um dos ramos de identidade; revise 40200';
  END IF;
  -- O ramo sku_acabado continua EXIGINDO variante nula (nao virou opcional).
  IF position($chk5$OR v_source_variant_id IS NOT NULL THEN$chk5$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Ramo sku_acabado deixou de exigir variante nula; revise 40200';
  END IF;
END;
$patch_alinhamento$;

COMMENT ON FUNCTION public.tg_validate_sale_order_item_strap_color_alignment() IS
  'Valida sale_order_items.strap_colors/strap_sourcing contra a ficha tecnica vigente. Identidade congelada completa: strap_variant_id (internal e linha finished_product_group) OU finished_product_id (Comprar pronto do PV sobre linha reference_base, migration 20270101031900, que congela o SKU acabado da Cor Principal sem variante Hub). Cada ramo revalida o campo da sua identidade.';
