-- Regressão da 20270101042500: recreou atelier_confirm_lot_cut com
-- movement_reason = 'atelier_prep', que o CHECK stock_movements_movement_reason_check
-- NÃO aceita (só consumo_op|ajuste|compra|devolucao|estorno).
-- Sintoma: OK · Cortar no Relatório → toast com violação do check.
-- Decisão canônica (mig 33100): o corte é consumo de produção → 'consumo_op'.
-- 'atelier_prep' continua válido só em material_reservations.metadata.kind.
--
-- Âncora = o VALUES do INSERT em stock_movements (pg_get_functiondef preserva
-- a quebra de linha entre description e movement_reason da 42500).

DO $fix$
DECLARE
  v_def text;
  v_old text := $o$'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'atelier_prep'$o$;
  v_new text := $n$'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component,
          'consumo_op'$n$;
BEGIN
  SELECT pg_get_functiondef('public.atelier_confirm_lot_cut(uuid)'::regprocedure)
    INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'atelier_confirm_lot_cut(uuid) não encontrada';
  END IF;

  -- Já corrigido.
  IF strpos(v_def, v_old) = 0 AND strpos(v_def, v_new) > 0 THEN
    RETURN;
  END IF;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION
      'atelier_confirm_lot_cut: âncora de movement_reason não encontrada (esperava atelier_prep no INSERT)';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;
