-- Ateliê v2: o débito do corte do lote gravava stock_movements.movement_reason =
-- 'atelier_prep', que o CHECK stock_movements_movement_reason_check NÃO aceita
-- (consumo_op, ajuste, compra, devolucao, estorno) → "Confirmar corte" abortava
-- sempre que havia estoque a debitar. Achado no teste de ponta a ponta de
-- 10/10/2026, antes de qualquer lote real. O corte é consumo de produção.
DO $fix$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_confirm_lot_cut(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, '''consumo_op''') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, $o$'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component, 'atelier_prep'$o$) = 0 THEN
    RAISE EXCEPTION 'atelier_confirm_lot_cut: âncora de movement_reason não encontrada';
  END IF;
  EXECUTE replace(v_def,
    $o$'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component, 'atelier_prep'$o$,
    $n$'Ateliê · corte ' || v_lot.lot_number || ' · ' || v_line.component, 'consumo_op'$n$);
END
$fix$;
