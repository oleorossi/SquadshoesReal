-- AUDITORIA PV 2026-06-10 (E1): update_sale_order_atomic descartava
-- informacoes_complementares_nf, brand, transporter_id e nfe_external —
-- editar o PV perdia silenciosamente o texto da NF-e e a marca.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='update_sale_order_atomic' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'update_sale_order_atomic não encontrada'; RETURN; END IF;
  IF v_src LIKE '%informacoes_complementares_nf = v_merged%' THEN RETURN; END IF;
  IF position('    nfe                = v_merged.nfe,' IN v_src) = 0 THEN
    RAISE WARNING 'update_sale_order_atomic: âncora não encontrada — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    '    nfe                = v_merged.nfe,',
    '    nfe                = v_merged.nfe,
    informacoes_complementares_nf = v_merged.informacoes_complementares_nf,
    brand              = v_merged.brand,
    transporter_id     = v_merged.transporter_id,
    nfe_external       = v_merged.nfe_external,');
  EXECUTE v_src;
END
$patch$;
