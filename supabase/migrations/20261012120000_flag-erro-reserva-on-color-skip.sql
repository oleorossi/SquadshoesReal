-- =============================================================================
-- Auditoria #5: cor não cadastrada não pode passar silenciosamente na reserva.
--
-- O débito continua parcial por desenho: os outros componentes seguem sendo
-- reservados/debitados. Somente a OP recebe o estado operacional de atenção e
-- uma nota orientando o cadastro da cor e a nova reserva via MRP.
-- =============================================================================

DO $migration$
DECLARE
  v_src text;
  v_anchor text := $anchor$
    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;
$anchor$;
  v_replacement text := $replacement$
    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      -- color-skip-erro-reserva-v1: não bloqueia o débito dos demais componentes.
      -- A nota é idempotente para uma nova tentativa sem nenhuma reserva criada.
      UPDATE public.orders
         SET material_status = 'erro_reserva',
             notes = COALESCE(NULLIF(notes, '') || E'\n', '')
               || '⚠ Reserva automática com erro — Cor "' || COALESCE(p_color, '')
               || '" não cadastrada no grupo ' || COALESCE(v_item ->> 'component', 'não identificado')
               || ' — componente não reservado; cadastre a cor e rode a reserva (MRP).'
       WHERE id = p_order_id
         AND (
           material_status IS DISTINCT FROM 'erro_reserva'
           OR COALESCE(notes, '') NOT LIKE '%Cor "' || COALESCE(p_color, '')
             || '" não cadastrada no grupo ' || COALESCE(v_item ->> 'component', 'não identificado')
             || ' — componente não reservado; cadastre a cor e rode a reserva (MRP).%'
         );

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    to_regprocedure('public.hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)')
  ) INTO v_src;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean) não encontrada';
  END IF;

  IF v_src LIKE '%color-skip-erro-reserva-v1%' THEN
    RETURN;
  END IF;

  IF strpos(v_src, v_anchor) = 0 THEN
    RAISE EXCEPTION 'Âncora do skip color_mismatch não encontrada; patch de erro_reserva não aplicado';
  END IF;

  v_src := replace(v_src, v_anchor, v_replacement);
  EXECUTE v_src;
END;
$migration$;
