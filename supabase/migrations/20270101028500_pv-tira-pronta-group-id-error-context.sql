-- =============================================================================
-- PV: mensagem de tira pronta sem group_id nomeia modelo / cor / posição
-- =============================================================================
-- Sintoma: toast genérico "Tira pronta exige o grupo acabado (group_id) na ficha"
-- sem dizer qual item (PV com 6 cores: OFF WHITE em Fazer, PRATA ainda sku).
-- Marcador: strap_pv_sku_group_id_error_context_20270101028500
-- =============================================================================

DO $patch$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION 'Tira pronta exige o grupo acabado (group_id) na ficha';
      END IF;
$old$;
  v_new text := $new$
      -- strap_pv_sku_group_id_error_context_20270101028500
      IF v_identity_group_id IS NULL THEN
        RAISE EXCEPTION
          'Modelo % / %, %: tira pronta exige o grupo acabado (group_id) na ficha — use Fazer (fábrica) ou cadastre o grupo acabado na ficha técnica',
          coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text),
          coalesce(nullif(p_item ->> 'color', ''), 'sem cor principal'),
          coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
      END IF;
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('strap_pv_sku_group_id_error_context_20270101028500' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'RAISE group_id da tira pronta não encontrado (hits=%); recuse 28500',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;
