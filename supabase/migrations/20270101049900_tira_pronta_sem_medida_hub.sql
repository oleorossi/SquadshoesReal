-- =============================================================================
-- Tira comprada pronta não exige família/medida do Hub no save
-- =============================================================================
-- Sintoma (19/11/2026, /sales/new, INL01 ROSADO, TIRA STRASS 6MM, depois do
-- deploy e47c6eec): a tela já mostra o SKU e "Comprar N m", mas o save levanta
-- "Linha tecnica sem familia/medida canonica; corrija a ficha no Estoque".
--
-- A 49800 só abriu o ramo que grava o SKU. O portão anterior do mesmo writer
-- (e o da guarda de alinhamento) ainda exige measure_id/strap_type_id em TODA
-- linha, inclusive finished_product_group. Strass cadastrado só pelo grupo de
-- estoque não tem medida do Hub e morre antes de chegar no SKU.
--
-- Artesanal (reference_base) continua exigindo família e medida.
-- Marcador: strap_pronta_sem_medida_hub_20270101049900
-- Não grava dado de ficha nem de pedido.
-- =============================================================================

DO $patch_prepare_measure$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$    IF v_measure_id IS NULL OR v_strap_type_id IS NULL THEN
      RAISE EXCEPTION 'Linha tecnica sem familia/medida canonica; corrija a ficha no Estoque';
    END IF;
    IF v_sheet_basis = 'finished_product_group' AND v_identity_group_id IS NULL THEN
      RAISE EXCEPTION 'Tira comprada pronta exige grupo proprio do componente acabado';
    END IF;$old$;
  v_new text := $new$    -- strap_pronta_sem_medida_hub_20270101049900
    -- Comprada pronta: o grupo de estoque (identity_group_id ou group_id) basta.
    -- Família/medida do Hub seguem obrigatórias só na tira artesanal.
    IF v_sheet_basis = 'finished_product_group' THEN
      v_identity_group_id := coalesce(
        v_identity_group_id,
        public.try_parse_uuid(v_sheet_line ->> 'group_id')
      );
    END IF;
    IF v_sheet_basis <> 'finished_product_group'
       AND (v_measure_id IS NULL OR v_strap_type_id IS NULL) THEN
      RAISE EXCEPTION 'Linha tecnica sem familia/medida canonica; corrija a ficha no Estoque';
    END IF;
    IF v_sheet_basis = 'finished_product_group' AND v_identity_group_id IS NULL THEN
      RAISE EXCEPTION 'Tira comprada pronta exige o grupo de estoque na ficha';
    END IF;$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pronta_sem_medida_hub_20270101049900' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Portao de medida do writer nao encontrado (hits=%); revise 49900',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_prepare_measure$;

DO $patch_alignment_measure$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$       OR v_measure_id IS NULL OR v_strap_type_id IS NULL
       OR v_item_measure_id IS DISTINCT FROM v_measure_id
       OR v_item_strap_type_id IS DISTINCT FROM v_strap_type_id$old$;
  v_new text := $new$       OR (v_basis <> 'finished_product_group'
           AND (v_measure_id IS NULL OR v_strap_type_id IS NULL))
       OR (v_basis <> 'finished_product_group'
           AND (v_item_measure_id IS DISTINCT FROM v_measure_id
                OR v_item_strap_type_id IS DISTINCT FROM v_strap_type_id))$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('v_basis <> ''finished_product_group''' IN v_def) > 0
     AND position('AND (v_measure_id IS NULL OR v_strap_type_id IS NULL)' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Portao de medida do alinhamento nao encontrado (hits=%); revise 49900',
      coalesce(v_hits, 0);
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_alignment_measure$;
