-- Apagar produto deixava a ficha apontando pro nada, em silencio
-- ============================================================================
-- MEDIDO em 31/07/2026 (PV-00151): 5 produtos apagados deixaram 25 linhas de
-- technical_sheets.direct_components com product_id morto. O modal de consumo
-- avisa "nao resolve produto no estoque - cadastro apagado. NAO sera reservado
-- nem debitado" -- ou seja, o componente some do custo e da compra sem barulho.
-- Sao 5.400 coracoes + 360 binoculos so no PV-00151.
--
-- CAUSA: direct_components e um jsonb DENTRO de technical_sheets, nao uma FK.
-- Entao:
--   - o DELETE normal nao falha (nao ha constraint pra violar) => nunca abriu o
--     dialogo de confirmacao;
--   - force_delete_product limpa sheet_materials / reservas / OCs /
--     movimentacoes e NAO toca em direct_components => deixa o lixo pra tras.
--
-- Esta migration fecha o segundo lado (a limpeza). O primeiro lado (avisar
-- ANTES, no dialogo) fica no fetchProductLinks do frontend, que agora conta
-- direct_components e forca o fluxo de confirmacao dupla.
--
-- NAO limpa as 25 linhas ja existentes de proposito: apagar a linha perderia a
-- informacao de que a ficha LEVA aquele componente. O aviso do modal ("recadastre
-- o produto e refaca o vinculo") e melhor que o silencio.

CREATE OR REPLACE FUNCTION public.force_delete_product(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_name text;
  v_sheet_materials_count    integer := 0;
  v_reservations_count       integer := 0;
  v_purchase_items_count     integer := 0;
  v_stock_movements_count    integer := 0;
  v_direct_components_count  integer := 0;
  v_reservations_released_qty numeric := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'Produto % não encontrado', p_product_id;
  END IF;

  -- Total a liberar (reporting) — somado ANTES de cancelar, em 1 linha.
  SELECT COALESCE(SUM(GREATEST(0, quantity_reserved - quantity_consumed)), 0)
    INTO v_reservations_released_qty
    FROM public.material_reservations
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed');

  -- Cancela as reservas ativas (dispara o sync de reserved_stock). Sem
  -- RETURNING INTO — o UPDATE pode afetar N linhas sem erro.
  UPDATE public.material_reservations
     SET status = 'cancelled', updated_at = now()
   WHERE product_id = p_product_id
     AND status IN ('reserved', 'partially_consumed');

  WITH d AS (DELETE FROM public.sheet_materials WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_sheet_materials_count FROM d;

  WITH d AS (DELETE FROM public.material_reservations WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_reservations_count FROM d;

  WITH d AS (DELETE FROM public.purchase_order_items WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_purchase_items_count FROM d;

  WITH d AS (DELETE FROM public.stock_movements WHERE product_id = p_product_id RETURNING 1)
  SELECT COUNT(*) INTO v_stock_movements_count FROM d;

  -- NOVO: tira o produto de direct_components das fichas. jsonb, nao FK —
  -- por isso precisa ser explicito aqui. Reconstroi o array sem os elementos
  -- que apontam pro produto; ficha que fica sem nenhum componente vira '[]'.
  WITH alvo AS (
    SELECT ts.id
      FROM public.technical_sheets ts
     WHERE ts.direct_components IS NOT NULL
       AND jsonb_typeof(ts.direct_components) = 'array'
       AND ts.direct_components @> jsonb_build_array(
             jsonb_build_object('product_id', p_product_id::text))
  ), novos AS (
    SELECT a.id,
           COALESCE(
             (SELECT jsonb_agg(dc)
                FROM jsonb_array_elements(ts.direct_components) dc
               WHERE dc ->> 'product_id' IS DISTINCT FROM p_product_id::text),
             '[]'::jsonb) AS lista
      FROM alvo a JOIN public.technical_sheets ts ON ts.id = a.id
  ), upd AS (
    UPDATE public.technical_sheets ts
       SET direct_components = n.lista, updated_at = now()
      FROM novos n WHERE ts.id = n.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_direct_components_count FROM upd;

  DELETE FROM public.products WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'product_id',            p_product_id,
    'product_name',          v_product_name,
    'sheet_materials_count', v_sheet_materials_count,
    'reservations_count',    v_reservations_count,
    'reservations_released_qty', v_reservations_released_qty,
    'purchase_items_count',  v_purchase_items_count,
    'stock_movements_count', v_stock_movements_count,
    'direct_components_count', v_direct_components_count,
    'deleted_at',            now()
  );
END;
$function$;

COMMENT ON FUNCTION public.force_delete_product(uuid) IS
  'Exclusao forcada de produto: apaga BOMs, reservas, itens de OC, movimentacoes '
  'E remove o produto de technical_sheets.direct_components (jsonb, sem FK — '
  'esquecer isso deixava a ficha apontando pro nada em silencio, bug de 31/07/2026).';
