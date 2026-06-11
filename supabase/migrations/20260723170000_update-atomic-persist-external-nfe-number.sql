-- AUDITORIA 2026-06-11 (complemento do E1): update_sale_order_atomic passou a
-- persistir nfe_external (migration 20260722140000) mas esqueceu o par
-- external_nfe_number — o número da NF emitida por outra empresa não round-trip
-- na edição (o frontend já carrega o campo desde o fix que carrega nfe_external/
-- external_nfe_number ao editar PV; faltava o SET no RPC). Patch idempotente,
-- ancorado na linha que o E1 adicionou.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='update_sale_order_atomic' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'update_sale_order_atomic não encontrada'; RETURN; END IF;
  IF v_src LIKE '%external_nfe_number = v_merged%' THEN RETURN; END IF;
  IF position('    nfe_external       = v_merged.nfe_external,' IN v_src) = 0 THEN
    RAISE WARNING 'update_sale_order_atomic: âncora nfe_external não encontrada (E1 aplicado?) — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    '    nfe_external       = v_merged.nfe_external,',
    '    nfe_external       = v_merged.nfe_external,
    external_nfe_number = v_merged.external_nfe_number,');
  EXECUTE v_src;
END
$patch$;
