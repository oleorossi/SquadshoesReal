-- =============================================================================
-- Tira no padrão do catálogo não diverge da ficha
-- =============================================================================
-- Sintoma (/sales/new, SP143 / NATURAL, FRENTE, TIRA OVERLOCK 5 mm,
-- material NAPA SOFT, origem Prestador "Padrão do catálogo"):
--   "Estrutura da tira no item diverge da ficha tecnica vigente"
--
-- Causa: trg_normalize_sale_order_item_strap_colors (45800) roda ANTES da
-- guarda e, em medida sempre_fabrica, troca o group_id da linha reference_base
-- pelo grupo do mapa Hub. A ficha guarda o group_id original (nulo ou o
-- material). A guarda compara os dois e aborta o PV. O #700 só fez o save
-- chegar até aqui — antes morria no SKU sem group_id.
--
-- Correção:
--   1. A normalização não reescreve group_id de linha reference_base.
--      O SKU continua nascendo no grupo da medida pelo writer do #700.
--   2. A guarda, para reference_base, não trata como divergência o group_id
--      vazio na ficha nem o grupo do mapa da medida (padrão do catálogo).
--
-- Marcador: tira_padrao_nao_diverge_ficha_20270101050400
-- Não grava pedido nem produto.
-- =============================================================================

DO $patch_normalize$
DECLARE
  v_fn regprocedure := 'private.normalize_strap_line_sempre_fabrica(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$  IF v_map_group IS NOT NULL THEN
    v_line := v_line
      || jsonb_build_object(
           'group_id', v_map_group,
           'group_name', v_map_name
         );$old$;
  v_new text := $new$  -- tira_padrao_nao_diverge_ficha_20270101050400
  -- reference_base segue a ficha. Trocar o group_id pelo mapa faz a guarda
  -- acusar divergência. O grupo de estoque do SKU é resolvido no writer.
  IF v_map_group IS NOT NULL
     AND coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base')
         IS DISTINCT FROM 'reference_base' THEN
    v_line := v_line
      || jsonb_build_object(
           'group_id', v_map_group,
           'group_name', v_map_name
         );$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure(v_fn::text) IS NULL THEN
    RAISE EXCEPTION 'normalize_strap_line_sempre_fabrica ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('tira_padrao_nao_diverge_ficha_20270101050400' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Bloco group_id da normalizacao nao encontrado (hits=%); revise 50400',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  v_def := pg_get_functiondef(v_fn);
  IF position('IS DISTINCT FROM ''reference_base''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'normalizacao ainda reescreve group_id de reference_base';
  END IF;
END;
$patch_normalize$;

DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$       OR nullif(v_line ->> 'group_id', '')
            IS DISTINCT FROM nullif(v_sheet_line ->> 'group_id', '')$old$;
  v_new text := $new$       OR (
            -- tira_padrao_nao_diverge_ficha_20270101050400
            coalesce(v_basis, 'reference_base') IS DISTINCT FROM 'reference_base'
            AND nullif(v_line ->> 'group_id', '')
                IS DISTINCT FROM nullif(v_sheet_line ->> 'group_id', '')
          )
       OR (
            coalesce(v_basis, 'reference_base') = 'reference_base'
            AND nullif(v_line ->> 'group_id', '')
                IS DISTINCT FROM nullif(v_sheet_line ->> 'group_id', '')
            AND nullif(v_sheet_line ->> 'group_id', '') IS NOT NULL
            AND nullif(v_line ->> 'group_id', '') IS DISTINCT FROM (
              SELECT map.strap_group_id::text
                FROM public.strap_hub_measure_group_map map
               WHERE map.measure_id = v_measure_id
            )
          )$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure(v_fn::text) IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('tira_padrao_nao_diverge_ficha_20270101050400' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Comparacao de group_id da guarda nao encontrada (hits=%); revise 50400',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  v_def := pg_get_functiondef(v_fn);
  IF position('tira_padrao_nao_diverge_ficha_20270101050400' IN v_def) = 0
     OR position('Estrutura da tira no item diverge da ficha tecnica vigente' IN v_def) = 0 THEN
    RAISE EXCEPTION 'guarda nao passou a aceitar o grupo padrao do catalogo';
  END IF;
END;
$patch_guard$;
