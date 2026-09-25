-- =============================================================================
-- PV: sku_acabado sem group_id na ficha artesanal vira Fazer (fábrica)
-- =============================================================================
-- Sintoma: G03 (reference_base, sem group_id) com "Todas comprar pronto" numa
-- cor colapsada + UI em Fazer na aba aberta → prepare RAISE e o PV inteiro
-- morre. Frontend coerção (ec72394) não alcança quem está no SW antigo
-- ("Nova versão disponível").
--
-- Writer: se pv_origem=sku_acabado e a linha não traz group_id nem
-- identity_group_id, reescreve para fabrica e segue o ramo interno.
-- Marcador: strap_pv_sku_sem_group_id_vira_fabrica_20270101028600
-- =============================================================================

DO $patch_prepare$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
$old$;
  v_new text := $new$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    -- strap_pv_sku_sem_group_id_vira_fabrica_20270101028600
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
       AND nullif(v_line ->> 'group_id', '') IS NULL
       AND nullif(v_line ->> 'identity_group_id', '') IS NULL THEN
      v_line := v_line || jsonb_build_object('pv_origem', 'fabrica');
    END IF;
    IF v_sheet_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_sem_group_id_vira_fabrica_20270101028600' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Gate sku_acabado do prepare não encontrado (hits=%); recuse 28600',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_prepare$;

-- Guard de INSERT/UPDATE: mesma coerção antes de exigir buy_ready.
DO $patch_guard$
DECLARE
  v_fn regprocedure := 'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text := $old$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
$old$;
  v_new text := $new$
    -- strap_pv_sku_acabado_fornecedor_20270101024000
    -- strap_pv_sku_sem_group_id_vira_fabrica_20270101028600
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado'
       AND nullif(v_line ->> 'group_id', '') IS NULL
       AND nullif(v_line ->> 'identity_group_id', '') IS NULL THEN
      v_line := v_line || jsonb_build_object('pv_origem', 'fabrica');
    END IF;
    IF v_basis = 'reference_base'
       AND nullif(v_line ->> 'pv_origem', '') = 'sku_acabado' THEN
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.tg_validate_sale_order_item_strap_color_alignment()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_sale_order_item_strap_color_alignment() ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_sem_group_id_vira_fabrica_20270101028600' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Gate sku_acabado do guard de tira não encontrado (hits=%); recuse 28600',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_guard$;
