-- =============================================================================
-- Comprar pronto usa o material já resolvido da ficha — sem receita interna
-- =============================================================================
-- Sintoma (16/11/2026, PV-00250, cópia de teste do PV-00249, I701 CHAMPAGNE,
-- GLOW METALIC, TIRA 1/TIRA 2, material_mode=follow_reference,
-- source_mode=buy_ready, pv_origem=sku_acabado):
--   Aprovar: "Tiras sem cadastro completo — … ? / CHAMPAGNE — TIRA 1:
--     nenhum material/cor elegivel. Confira o SKU oficial, largura e
--     rendimento aprovado da medida."
--   Salvar: "Nao existe conversao aprovada para TIRA CHATA 20 mm em
--     GLOW METALIC; cadastre o rendimento antes do PV"
--
-- Como o material da tira já é resolvido (não muda aqui):
--   Na ficha, "Segue o material da referência" (material_mode=follow_reference)
--   NÃO pede um material da tira. private.resolve_technical_strap_material
--   chama resolve_strap_base_group_id:
--     • ficha sem Cabedal → Forração (straps_follow_lining);
--     • ficha com Cabedal → o Cabedal (variante do item vence a ficha).
--   "Material fixo nesta posição" e "Selecionar material no pedido" são a
--   outra opção: o material base da tira é o grupo escolhido na ficha/PV.
--   Nos dois casos o grupo efetivo já chega em base_group_id. GLOW METALIC
--   do I701 é esse grupo — a mensagem de rendimento o nomeia.
--
-- O que barrava: o pré-voo do enqueue (diagnose → mobile_strap_allowed_colors)
-- e o ramo interno do writer (ensure_sale_order_internal_strap_materials)
-- tratam esse grupo como produção de Prestador e exigem SKU oficial, largura
-- e receita aprovada. A 46900/47000 só abriram o gatilho de alinhamento.
-- Comprar pronto (45300) só registra cor + metros; não consome receita.
--
-- Correção:
--   1. Writer: reference_base + (pv_origem=sku_acabado OU source_mode=buy_ready)
--      entra no ramo so-registra e NÃO chama ensure. O ELSIF interno continua
--      exigindo a receita — Prestador sem cadastro segue bloqueado.
--   2. Pré-voo: a lacuna "nenhum material/cor elegivel" só é ignorada quando
--      a linha é Comprar pronto, tem cor canônica e o resolvedor já devolveu
--      base_group_id. Sem cor, sem material resolvido, ou origem Prestador,
--      a recusa permanece. cor_nao_canonica não entra no filtro.
--   3. A referência da mensagem usa o nome da ficha quando o código interno
--      está vazio (I701 nasce com code nulo → saía "?").
--
-- Não altera resolve_strap_base_group_id. Não grava dado de PV.
-- Marcador: strap_buy_ready_segue_material_base_20270101047300
-- =============================================================================

-- ── 1. Writer: Comprar pronto não materializa receita ───────────────────────
DO $patch_writer_buy_ready$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN$old$;
  v_new text := $new$    -- strap_buy_ready_segue_material_base_20270101047300
    -- Comprar pronto (escolha da linha OU sourcing já congelado) não cria
    -- variante/receita. O base_group_id da linha já veio de
    -- resolve_technical_strap_material: Forração/Cabedal em follow_reference,
    -- ou o grupo escolhido em material fixo / selecionar no pedido.
    IF v_sheet_basis = 'reference_base'
       AND (
         nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
         OR coalesce(v_existing_source ->> 'source_mode', '') = 'buy_ready'
       ) THEN$new$;
  v_old_freeze text := $old_freeze$      v_line := (v_line - 'color_id') || jsonb_build_object(
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
          'finished_product_id', NULL,$old_freeze$;
  v_new_freeze text := $new_freeze$      v_line := (v_line - 'color_id' - 'pv_origem') || jsonb_build_object(
        'color', v_line_color_name,
        'color_id', v_line_color_id,
        'pv_origem', 'sku_acabado'
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
          'finished_product_id', NULL,$new_freeze$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_segue_material_base_20270101047300' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position('strap_comprar_pronto_so_registra_20270101045300' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Ramo so-registra (45300) ausente no writer; aplique a 45300 antes da 47300';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'IF so-registra do writer nao encontrado (hits=%); revise 47300',
      coalesce(v_hits, 0);
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old_freeze, ''))) / nullif(length(v_old_freeze), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Congelamento so-registra da napa nao encontrado (hits=%); revise 47300',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(replace(v_def, v_old, v_new), v_old_freeze, v_new_freeze);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_segue_material_base_20270101047300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador 47300 nao gravado no writer';
  END IF;
  IF position($chk$OR coalesce(v_existing_source ->> 'source_mode', '') = 'buy_ready'
       ) THEN$chk$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'Writer nao roteia source_mode=buy_ready para o so-registra';
  END IF;
  -- Prestador continua materializando receita no ELSIF.
  IF position('private.ensure_sale_order_internal_strap_materials(' IN v_def) = 0
     OR position('ELSIF v_sheet_basis = ''reference_base'' THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Writer perdeu o ramo interno (ensure); revise 47300';
  END IF;
  -- O resolvedor da ficha não foi reescrito.
  IF position('private.resolve_technical_strap_material(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Writer perdeu resolve_technical_strap_material; revise 47300';
  END IF;
  IF position($origem$        'pv_origem', 'sku_acabado'$origem$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'So-registra nao congela pv_origem=sku_acabado; revise 47300';
  END IF;
END;
$patch_writer_buy_ready$;

-- ── 2. Pré-voo: Comprar pronto com material resolvido e cor canônica ────────
DO $patch_enqueue_buy_ready$
DECLARE
  v_fn regprocedure := 'public.enqueue_sale_order_materialization(uuid,text,text,bigint,text,jsonb,uuid)'::regprocedure;
  v_def text;
  v_old text := $old$      SELECT soi.reference_id,
             soi.material_variant_id,
             soi.color,
             COALESCE(NULLIF(btrim(ts.code), ''), '?') AS reference_code
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
       ORDER BY ts.code, soi.color$old$;
  v_new text := $new$      SELECT soi.reference_id,
             soi.material_variant_id,
             soi.color,
             CASE WHEN jsonb_typeof(soi.strap_colors) = 'array'
               THEN soi.strap_colors ELSE '[]'::jsonb END AS strap_colors,
             CASE WHEN jsonb_typeof(soi.strap_sourcing) = 'object'
               THEN soi.strap_sourcing ELSE '{}'::jsonb END AS strap_sourcing,
             -- code vazio (I701) não pode virar "?": a referência que o
             -- operador lê é o nome da ficha.
             COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code
        FROM public.sale_order_items soi
        LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
       WHERE soi.sale_order_id = p_sale_order_id
         AND soi.reference_id IS NOT NULL
       ORDER BY ts.code, soi.color$new$;
  v_old_agg text := $old_agg$          FROM jsonb_array_elements(
                 COALESCE(v_readiness -> 'issues', '[]'::jsonb)
               ) AS issue;$old_agg$;
  v_new_agg text := $new_agg$          FROM jsonb_array_elements(
                 COALESCE(v_readiness -> 'issues', '[]'::jsonb)
               ) AS issue
         -- strap_buy_ready_segue_material_base_20270101047300
         -- Lacuna de catálogo interno (SKU/largura/receita) não bloqueia
         -- Comprar pronto quando a cor é canônica e o material base já foi
         -- resolvido (Forração/Cabedal ou o grupo escolhido na ficha).
         -- Prestador, cor ausente e material sem grupo continuam na lista.
         WHERE NOT (
           issue.value ->> 'code' = 'material_posicao_sem_catalogo'
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(v_item.strap_colors) AS line(value)
              WHERE coalesce(
                      nullif(line.value ->> 'technical_strap_line_id', ''),
                      nullif(line.value ->> 'id', '')
                    ) IS NOT DISTINCT FROM issue.value ->> 'technical_strap_line_id'
                AND (
                  nullif(line.value ->> 'pv_origem', '') = 'sku_acabado'
                  OR coalesce(
                       v_item.strap_sourcing -> coalesce(
                         nullif(line.value ->> 'technical_strap_line_id', ''),
                         nullif(line.value ->> 'id', '')
                       ) ->> 'source_mode',
                       ''
                     ) = 'buy_ready'
                )
                AND (
                  public.resolve_strap_canonical_color_id(line.value ->> 'color') IS NOT NULL
                  OR EXISTS (
                    SELECT 1
                      FROM public.canonical_colors canonical_color
                     WHERE canonical_color.active
                       AND canonical_color.id = public.try_parse_uuid(coalesce(
                         nullif(line.value ->> 'color_id', ''),
                         nullif(
                           v_item.strap_sourcing -> coalesce(
                             nullif(line.value ->> 'technical_strap_line_id', ''),
                             nullif(line.value ->> 'id', '')
                           ) ->> 'color_id',
                           ''
                         )
                       ))
                  )
                  OR (
                    coalesce(nullif(line.value ->> 'color_mode', ''), 'follow_main') = 'follow_main'
                    AND public.resolve_strap_canonical_color_id(v_item.color) IS NOT NULL
                  )
                )
           )
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(coalesce(v_readiness -> 'lines', '[]'::jsonb)) AS resolved(value)
              WHERE resolved.value ->> 'technical_strap_line_id'
                    IS NOT DISTINCT FROM issue.value ->> 'technical_strap_line_id'
                AND nullif(resolved.value ->> 'base_group_id', '') IS NOT NULL
           )
         );$new_agg$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.enqueue_sale_order_materialization(uuid,text,text,bigint,text,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'enqueue_sale_order_materialization ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_segue_material_base_20270101047300' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'SELECT do pre-voo de tiras nao encontrado (hits=%); revise 47300',
      coalesce(v_hits, 0);
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old_agg, ''))) / nullif(length(v_old_agg), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Agregacao de lacunas de tira nao encontrada (hits=%); revise 47300',
      coalesce(v_hits, 0);
  END IF;

  v_def := replace(replace(v_def, v_old, v_new), v_old_agg, v_new_agg);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_buy_ready_segue_material_base_20270101047300' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Marcador 47300 nao gravado no enqueue';
  END IF;
  IF position('NULLIF(btrim(ts.name), '''')' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-voo de tiras continua sem o nome da ficha';
  END IF;
  IF position('public.diagnose_sale_order_internal_strap_readiness(' IN v_def) = 0
     OR position('Tiras sem cadastro completo' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Pre-voo de tiras perdeu o diagnostico ou a recusa';
  END IF;
  -- cor_nao_canonica nao foi incluida no filtro (so material_posicao_sem_catalogo).
  IF position($skip$issue.value ->> 'code' = 'material_posicao_sem_catalogo'$skip$ IN v_def) = 0
     OR position($color$issue.value ->> 'code' = 'cor_nao_canonica'$color$ IN v_def) > 0 THEN
    RAISE EXCEPTION 'Filtro de Comprar pronto afrouxou a cor ou nao filtra so o catalogo interno';
  END IF;
  IF position('nullif(resolved.value ->> ''base_group_id'', '''') IS NOT NULL' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Filtro deixou passar Comprar pronto sem material base resolvido';
  END IF;
  -- Guardas das migrations anteriores do mesmo corpo.
  IF position('idempotency_key inválida' IN v_def) = 0
     OR position('factory_gate_is_atelier_pipeline_deferral' IN v_def) = 0
     OR position('assert_sale_order_atelier_returned_for_production' IN v_def) = 0 THEN
    RAISE EXCEPTION '47300 derrubou guarda anterior do enqueue (chave, Ateliê ou Em Produção)';
  END IF;
END;
$patch_enqueue_buy_ready$;

COMMENT ON FUNCTION public.prepare_sale_order_item_internal_straps(jsonb) IS
  'Prepara tiras do item. reference_base + (pv_origem=sku_acabado OU source_mode=buy_ready) so registra cor + metros no material ja resolvido (Forração/Cabedal ou grupo escolhido) — nao exige receita (47300). Prestador continua em ensure.';
