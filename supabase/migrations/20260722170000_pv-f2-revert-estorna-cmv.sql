-- AUDITORIA PV 2026-06-10 (F2): revert_invoiced_sale_order estornava só a
-- receita (reference_type='sale_order') — o CMV automático
-- ('sale_order_cmv') ficava de pé na DRE após reverter o faturamento.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='revert_invoiced_sale_order' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'revert_invoiced_sale_order não encontrada'; RETURN; END IF;
  IF v_src LIKE '%sale_order_cmv%' THEN RETURN; END IF;
  IF position($a$WHERE reference_type='sale_order' AND reference_id=p_sale_order_id::text$a$ IN v_src) = 0 THEN
    RAISE WARNING 'revert_invoiced_sale_order: âncora não encontrada — patch F2 NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    $a$WHERE reference_type='sale_order' AND reference_id=p_sale_order_id::text$a$,
    $a$WHERE reference_type IN ('sale_order','sale_order_cmv') AND reference_id=p_sale_order_id::text$a$);
  EXECUTE v_src;
END
$patch$;
