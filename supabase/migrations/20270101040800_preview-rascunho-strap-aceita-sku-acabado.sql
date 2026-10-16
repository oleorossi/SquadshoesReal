-- =============================================================================
-- Preview de tira em RASCUNHO: "Comprar pronto" identifica por SKU acabado
-- =============================================================================
-- Sintoma (PV-00236, Rascunho, 13/10/2026 — 6 itens / 2.220 pares): o bloco
-- "Tiras · comprar pronto" do Consumo de Materiais sai com 1.915,20 m e QUATRO
-- avisos vermelhos em TODAS as 7 linhas, simultaneamente:
--   COMPRA PRONTA BLOQUEADA: BUY_READY_NOT_ENABLED
--   A ESCOLHA DE ORIGEM DEVE PERSISTIR O UUID EXATO DA VARIANTE RESOLVIDA.
--   A TIRA INTERNA DEVE USAR A COR EXIGIDA PELA FICHA E PRODUCAO INTERNA.
--   A ORIGEM CONGELADA DA TIRA DIVERGE DO CATALOGO; SALVE NOVAMENTE O PEDIDO...
-- e o `finished_product_id` congelado no PV é PERDIDO (volta NULL), embora
-- `sale_order_items.strap_sourcing` o tenha gravado nas 7 linhas.
--
-- Causa: a MESMA divergência writer × guarda que a 39600 e a 40200 fecharam,
-- agora na TERCEIRA camada — o caminho PROSPECTIVO (PV não comprometido).
--
--   writer  `prepare_sale_order_item_internal_straps`, ramo
--           v_sheet_basis='reference_base' AND pv_origem='sku_acabado'
--           (introduzido pela 20270101031900) congela DE PROPÓSITO:
--             'source_mode','buy_ready', 'strap_variant_id', NULL,
--             'finished_product_id', <SKU acabado da Cor Principal>
--
--   leitura `public.preview_sale_order_strap_demand_draft` desvia PV em
--           Rascunho/Pendente para
--           `private.preview_sale_order_strap_demand_draft_pre_20270101015500`
--           e RETORNA (o comentário vivo diz: "Rascunho/Pendente continua
--           prospectivo"). Esse helper legado aplica o contrato PRÉ-31900:
--           reference_base ⇒ exige source_mode='internal' + receita +
--           produto-base, e compara o congelado com a VARIANTE do Hub.
--
-- Por isso o furo só aparece em rascunho. No PV comprometido a própria
-- `preview_sale_order_strap_demand_draft` já resolve: quando
-- `private.resolve_committed_strap_identity` devolve valid=true — e ela JÁ
-- honra o contrato da 31900 (conferido no corpo VIVO, nunca por arquivo — ver
-- a nota sobre marcador na pré-condição abaixo) — ela descarta
-- os códigos derivados do catálogo por uma lista NOT IN. Medido em 13/10/2026:
-- 34 PVs carregam linha `buy_ready`; os comprometidos (Faturado / Em Produção)
-- não mostram os avisos, os rascunhos mostram.
--
-- Os quatro códigos nascem em DUAS camadas (medido chamando as duas):
--   `public.preview_sale_order_strap_demand_draft_pre_05500` (motor-base)
--     → catalog_resolution_blocked + variant_identity_not_persisted,
--       e finished_product_id NULL (ele resolve a linha pelo catálogo de
--       variantes, que neste contrato não existe)
--   `private.preview_sale_order_strap_demand_draft_pre_20270101015500`
--     → herda os dois acima e ACRESCENTA reference_base_intent_mismatch +
--       frozen_source_snapshot_stale
-- Patchar só a segunda resolve os quatro, porque é ela que herda e acrescenta.
--
-- ⚠ Isto NÃO relaxa identidade. O ramo novo só existe quando a forma congelada
-- é exatamente a que o writer produz (buy_ready + variante NULA + SKU acabado
-- presente) e, dentro dele, revalida o que lhe cabe: cor exigida pela ficha,
-- AUSÊNCIA de receita/napa-base, e o SKU acabado existindo ativo e linear — o
-- MESMO teste de `resolve_committed_strap_identity`, para rascunho e PV
-- comprometido não divergirem. Linha com variante E SKU nulos continua barrada
-- pelo ramo original.
--
-- ⚠ O ramo de demanda corrente (linhas 157-220 do corpo vivo) JÁ fazia isso:
-- remove os mesmos dois códigos do motor-base e preenche finished_product_id a
-- partir da demanda. O patch 1 abaixo é o mesmo recorte, aplicado antes do
-- primeiro fato — não é política nova.
--
-- ⚠ `pinned_base_product_mismatch` passa a exigir source_mode='internal': a
-- invariante de napa pinada no cabedal não se aplica a tira COMPRADA pronta
-- (que não tem napa-base). Sem isso, uma tira pronta numa referência com napa
-- pinada ganharia um quinto bloqueio falso — latente hoje porque as 7 linhas do
-- PV-00236 resolvem pin NULO, não porque a guarda esteja certa.
--
-- Patch por substituição de texto do corpo vivo (padrão 24000/28500/28600/
-- 31900/32200/32300/39600/40200); falha alto se o trecho esperado não existir.
-- Marcador: strap_preview_rascunho_sku_acabado_sem_variante_20270101040800
-- =============================================================================

DO $patch_preview_rascunho$
DECLARE
  v_fn regprocedure :=
    'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'
    ::regprocedure;
  v_def text;
  v_marker text :=
    'strap_preview_rascunho_sku_acabado_sem_variante_20270101040800';

  -- Âncora do patch 1: fim do parse dos IDs congelados.
  v_old1 text := $old1$    EXCEPTION WHEN OTHERS THEN
      v_selected_variant_id := NULL;
      v_selected_recipe_id := NULL;
      v_selected_base_product_id := NULL;
    END;
$old1$;
  v_new1 text := $new1$    EXCEPTION WHEN OTHERS THEN
      v_selected_variant_id := NULL;
      v_selected_recipe_id := NULL;
      v_selected_base_product_id := NULL;
    END;

    -- strap_preview_rascunho_sku_acabado_sem_variante_20270101040800
    -- "Comprar pronto" escolhido no PV (pv_origem='sku_acabado', contrato da
    -- 31900) congela buy_ready com finished_product_id e SEM variante do Hub.
    -- O motor-base nao conhece esse contrato: tenta resolver a linha pelo
    -- catalogo de variantes, devolve catalog_resolution_blocked +
    -- variant_identity_not_persisted e perde o SKU congelado. A identidade
    -- PERSISTIDA tem precedencia sobre a releitura do catalogo -- mesmo recorte
    -- que o ramo de demanda corrente abaixo ja aplica, e que o caminho de PV
    -- comprometido aplica em public.preview_sale_order_strap_demand_draft.
    IF v_selected_source = 'buy_ready'
       AND v_selected_variant_id IS NULL
       AND public.try_parse_uuid(
             v_selection ->> 'finished_product_id') IS NOT NULL THEN
      finished_product_id := public.try_parse_uuid(
        v_selection ->> 'finished_product_id');
      blocking_reasons := (
        SELECT coalesce(
                 jsonb_agg(reason.value ORDER BY reason.ordinality),
                 '[]'::jsonb)
          FROM jsonb_array_elements(
            coalesce(blocking_reasons, '[]'::jsonb)
          ) WITH ORDINALITY reason(value, ordinality)
         WHERE coalesce(reason.value ->> 'code', '') NOT IN (
           'catalog_resolution_blocked',
           'variant_identity_not_persisted'
         )
      );
    END IF;
$new1$;

  -- Patch 2: intencao do ramo reference_base.
  v_old2 text := $old2$      IF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL$old2$;
  v_new2 text := $new2$      -- strap_preview_rascunho_sku_acabado_sem_variante_20270101040800
      -- Ramo "Comprar pronto" do PV: identidade por SKU acabado, variante do
      -- Hub NULA de proposito. A cor continua sendo a que a ficha exige e a
      -- linha nao pode carregar receita nem napa-base (isso e tira interna).
      IF v_selected_source = 'buy_ready'
         AND v_selected_variant_id IS NULL
         AND public.try_parse_uuid(
               v_selection ->> 'finished_product_id') IS NOT NULL THEN
        IF v_selected_recipe_id IS NOT NULL
           OR v_selected_base_product_id IS NOT NULL
           OR (v_line_color_mode = 'follow_main' AND (
             v_main_color_id IS NULL
             OR v_line_color_id IS DISTINCT FROM v_main_color_id
           ))
           OR (v_line_color_mode = 'select_on_order'
             AND v_line_color_id IS NULL) THEN
          blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object(
              'code', 'reference_base_intent_mismatch',
              'field', 'strap_sourcing',
              'message', 'A tira comprada pronta deve usar a cor exigida pela ficha e nao pode carregar receita nem napa-base.'
            ));
        END IF;
      ELSIF v_selected_source IS DISTINCT FROM 'internal'
         OR v_selected_recipe_id IS NULL
         OR v_selected_base_product_id IS NULL$new2$;

  -- Patch 3: a invariante de napa pinada e so de producao interna.
  v_old3 text := $old3$      IF v_line_color_mode = 'follow_main'
         AND v_pinned_base_product_id IS NOT NULL$old3$;
  v_new3 text := $new3$      -- strap_preview_rascunho_sku_acabado_sem_variante_20270101040800
      -- Tira COMPRADA pronta nao tem napa-base: a invariante de pin do cabedal
      -- so vale para producao interna.
      IF v_line_color_mode = 'follow_main'
         AND v_selected_source = 'internal'
         AND v_pinned_base_product_id IS NOT NULL$new3$;

  -- Patch 4: frescor do congelado.
  v_old4 text := $old4$    IF v_selected_variant_id IS NULL
       OR strap_variant_id IS DISTINCT FROM v_selected_variant_id
       OR recipe_id IS DISTINCT FROM v_selected_recipe_id
       OR base_product_id IS DISTINCT FROM v_selected_base_product_id THEN$old4$;
  v_new4 text := $new4$    -- strap_preview_rascunho_sku_acabado_sem_variante_20270101040800
    -- Sem variante do Hub nao ha o que comparar com o catalogo: o que precisa
    -- continuar existindo e o SKU acabado congelado. MESMO teste de
    -- private.resolve_committed_strap_identity (ativo + unidade linear), para
    -- rascunho e PV comprometido nao divergirem na mesma linha.
    IF v_selected_source = 'buy_ready'
       AND v_selected_variant_id IS NULL
       AND public.try_parse_uuid(
             v_selection ->> 'finished_product_id') IS NOT NULL THEN
      IF NOT EXISTS (
           SELECT 1
             FROM public.products product
            WHERE product.id = public.try_parse_uuid(
                    v_selection ->> 'finished_product_id')
              AND product.active
              AND product.unit = 'm'
         ) THEN
        blocking_reasons := coalesce(blocking_reasons, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'code', 'frozen_source_snapshot_stale',
            'field', 'strap_sourcing',
            'message', 'O SKU acabado congelado da tira pronta nao existe mais, esta inativo ou nao e vendido por metro; salve novamente o pedido antes de confirmar.'
          ));
      END IF;
    ELSIF v_selected_variant_id IS NULL
       OR strap_variant_id IS DISTINCT FROM v_selected_variant_id
       OR recipe_id IS DISTINCT FROM v_selected_recipe_id
       OR base_product_id IS DISTINCT FROM v_selected_base_product_id THEN$new4$;

  v_hits integer;
BEGIN
  IF to_regprocedure(
       'private.preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'preview_sale_order_strap_demand_draft_pre_20270101015500(jsonb) ausente';
  END IF;

  v_def := pg_get_functiondef(v_fn);
  IF position(v_marker IN v_def) > 0 THEN
    RETURN; -- ja aplicado
  END IF;

  -- O contrato da 31900 precisa estar vivo do lado da leitura comprometida: e
  -- ele que prova que "buy_ready sem variante" e identidade valida neste banco.
  -- Sem isso, relaxar o caminho prospectivo deixaria rascunho e PV comprometido
  -- com contratos DIFERENTES para a mesma linha.
  --
  -- Conferido pelo 'reason' do proprio ramo, e NAO pelo marcador literal da
  -- 31900: no repo, o ultimo arquivo que menciona um marcador e tratado como
  -- quem define aquele corpo (contrato pvSkuAcabadoBuyReadySemVariante), e esta
  -- migration patcha OUTRA funcao -- o helper prospectivo, nao o resolvedor.
  IF to_regprocedure(
       'private.resolve_committed_strap_identity(uuid,uuid,jsonb)') IS NULL
     OR position(
          $r31900$'reason', 'SKU acabado congelado da tira pronta nao existe mais'$r31900$
          IN pg_get_functiondef(
            'private.resolve_committed_strap_identity(uuid,uuid,jsonb)'
            ::regprocedure)
        ) = 0 THEN
    RAISE EXCEPTION
      'Ramo sku_acabado (31900) ausente em resolve_committed_strap_identity; aplique a 31900 antes da 40800';
  END IF;

  -- Cada trecho tem de existir EXATAMENTE uma vez.
  v_hits := (length(v_def) - length(replace(v_def, v_old1, '')))
            / nullif(length(v_old1), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Parse dos IDs congelados nao encontrado (hits=%); corpo mudou, revise 40800',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old1, v_new1);

  v_hits := (length(v_def) - length(replace(v_def, v_old2, '')))
            / nullif(length(v_old2), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Ramo reference_base nao encontrado (hits=%); corpo mudou, revise 40800',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old2, v_new2);

  v_hits := (length(v_def) - length(replace(v_def, v_old3, '')))
            / nullif(length(v_old3), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Guarda de napa pinada nao encontrada (hits=%); corpo mudou, revise 40800',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old3, v_new3);

  v_hits := (length(v_def) - length(replace(v_def, v_old4, '')))
            / nullif(length(v_old4), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Guarda de frescor do congelado nao encontrada (hits=%); corpo mudou, revise 40800',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old4, v_new4);

  EXECUTE v_def;

  -- Conferencia do corpo VIVO: o arquivo da migration nao prova nada sozinho.
  v_def := pg_get_functiondef(v_fn);
  IF position(v_marker IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador nao ficou no corpo vivo; revise 40800';
  END IF;
  -- Os ramos ORIGINAIS tem de ter sobrevivido: o patch adiciona um caminho,
  -- nao substitui a politica de tira interna.
  IF position(
       'A tira interna deve usar a cor exigida pela ficha e producao interna.'
       IN v_def) = 0
     OR position('A napa congelada diverge do SKU fisico pinado no cabedal.'
       IN v_def) = 0
     OR position('A tira de grupo acabado deve permanecer buy_ready.'
       IN v_def) = 0
     OR position('A base de identidade da tira e invalida.' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Helper perdeu um dos ramos originais de identidade; revise 40800';
  END IF;
  -- E os quatro caminhos novos tem de estar presentes.
  IF position($chk1$      finished_product_id := public.try_parse_uuid($chk1$ IN v_def) = 0
     OR position($chk2$'A tira comprada pronta deve usar a cor exigida pela ficha$chk2$
          IN v_def) = 0
     OR position($chk3$         AND v_selected_source = 'internal'$chk3$ IN v_def) = 0
     OR position($chk4$O SKU acabado congelado da tira pronta nao existe mais$chk4$
          IN v_def) = 0 THEN
    RAISE EXCEPTION 'Helper nao ficou com o contrato novo; revise 40800';
  END IF;
END
$patch_preview_rascunho$;
