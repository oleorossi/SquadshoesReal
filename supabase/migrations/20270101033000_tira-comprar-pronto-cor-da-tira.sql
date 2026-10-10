-- Tira "Comprar pronto" pode ter cor própria (Q37, grill 10/10/2026).
-- Spec: specs/tiras-redesenho.md → Cores combinadas por tira.
--
-- A 20270101031900 forçava a tira de napa (reference_base) com origem
-- Comprar pronto ('sku_acabado') a usar a Cor Principal do item, tanto no
-- writer quanto no gatilho de validação. Com as cores combinadas por tira
-- (ficha "Tiras com cores combinadas", color_mode = 'select_on_order'), a
-- tira comprada pronta precisa aceitar a cor escolhida para ela: a OC e o
-- SKU acabado saem nessa cor.
--
-- Regra nova: linha com color_mode = 'select_on_order' e color_id escolhido
-- usa a cor DA TIRA (canônica e ativa); qualquer outra continua na Cor
-- Principal, como antes.
--
-- Patch por substituição de texto dos corpos vivos (padrão 32200/32300);
-- falha alto se o trecho esperado não aparecer exatamente uma vez.

DO $patch$
DECLARE
  v_def text;
  v_hits integer;
  v_old_writer text := $old_w$      v_color_mode := 'follow_main';
      v_line_color_id := v_color_id;
      v_line_color_name := v_color_name;$old_w$;
  v_new_writer text := $new_w$      -- strap_pv_sku_acabado_cor_da_tira_20270101033000
      IF coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') = 'select_on_order'
         AND nullif(v_line ->> 'color_id', '') IS NOT NULL THEN
        v_color_mode := 'select_on_order';
        BEGIN
          v_line_color_id := (v_line ->> 'color_id')::uuid;
        EXCEPTION WHEN OTHERS THEN
          v_line_color_id := NULL;
        END;
        SELECT c.id, c.name
          INTO v_line_color_id, v_line_color_name
          FROM public.canonical_colors c
         WHERE c.id = v_line_color_id
           AND c.active;
        IF v_line_color_id IS NULL THEN
          RAISE EXCEPTION
            'Modelo % / %, %: a cor escolhida para a tira comprada pronta nao existe ou esta inativa',
            coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
            coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
            coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
        END IF;
      ELSE
        v_color_mode := 'follow_main';
        v_line_color_id := v_color_id;
        v_line_color_name := v_color_name;
      END IF;$new_w$;
  v_old_guard text := $old_g$      IF v_expected_color_id IS NULL
         OR v_line_color_id IS DISTINCT FROM v_expected_color_id
         OR v_source_mode IS DISTINCT FROM 'buy_ready'$old_g$;
  v_new_guard text := $new_g$      -- strap_pv_sku_acabado_cor_da_tira_20270101033000
      IF (
           coalesce(nullif(v_line ->> 'color_mode', ''), 'follow_main') <> 'select_on_order'
           AND (v_expected_color_id IS NULL
                OR v_line_color_id IS DISTINCT FROM v_expected_color_id)
         )
         OR v_line_color_id IS NULL
         OR v_source_mode IS DISTINCT FROM 'buy_ready'$new_g$;
BEGIN
  -- writer
  v_def := pg_get_functiondef('public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure);
  IF position('strap_pv_sku_acabado_cor_da_tira_20270101033000' IN v_def) = 0 THEN
    v_hits := (length(v_def) - length(replace(v_def, v_old_writer, ''))) / length(v_old_writer);
    IF v_hits IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'prepare: trecho da Cor Principal da tira pronta nao encontrado (hits=%); revise 33000', v_hits;
    END IF;
    EXECUTE replace(v_def, v_old_writer, v_new_writer);
  END IF;

  -- gatilho de validação
  v_def := pg_get_functiondef('public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure);
  IF position('strap_pv_sku_acabado_cor_da_tira_20270101033000' IN v_def) = 0 THEN
    v_hits := (length(v_def) - length(replace(v_def, v_old_guard, ''))) / length(v_old_guard);
    IF v_hits IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'validacao: guarda da Cor Principal da tira pronta nao encontrada (hits=%); revise 33000', v_hits;
    END IF;
    EXECUTE replace(v_def, v_old_guard, v_new_guard);
  END IF;
END
$patch$;
