-- Complemento do exato-por-quantidade da tira: order_strap_needs (MRP + custeio,
-- via required_m consumido por calculate_order_cost_item) também arredondava pra
-- ficha cheia. Aqui usa 'GREATEST(1, ceil(p_order_quantity / v_grade_total))'
-- (SEM ::numeric, por isso não entrou no patch anterior). Troca por fração exata.
-- (calculate_order_cost_item só menciona ceil num COMENTÁRIO — recebe required_m
--  já pronto de order_strap_needs, então não precisa de patch próprio.)
-- IDEMPOTENTE.
DO $mig$
DECLARE d text; n int := 0;
BEGIN
  FOR d IN
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'order_strap_needs'
  LOOP
    IF position('GREATEST(1, ceil(p_order_quantity / v_grade_total))' in d) > 0 THEN
      d := replace(d,
        'GREATEST(1, ceil(p_order_quantity / v_grade_total))',
        '(p_order_quantity::numeric / v_grade_total)');
      EXECUTE d;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'order_strap_needs exact-by-qty: % atualizada(s)', n;
END $mig$;
