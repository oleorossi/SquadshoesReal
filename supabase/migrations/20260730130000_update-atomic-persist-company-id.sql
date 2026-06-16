-- BUG (PV-00140, 2026-06-16): update_sale_order_atomic descartava company_id —
-- ao editar o PV e escolher o CNPJ Emitente (ex.: LRMS), a seleção sumia ao
-- salvar (a coluna nunca entrava no UPDATE). Mesmo padrão de perda silenciosa
-- já corrigido para strap_colors / material_variant_id / brand / nfe_external /
-- external_nfe_number.
--
-- Patch idempotente, ancorado na linha `nfe = v_merged.nfe,` (presente em TODAS
-- as versões da função desde 20260607130000 e usada como âncora pelos patches
-- E1). Adiciona `company_id = v_merged.company_id,` logo após.
--
-- ⚠ Acompanha o fix de frontend que passa a CARREGAR company_id ao reabrir o PV
-- (SaleOrderForm.tsx) — sem ele o form reabria com company_id vazio e um novo
-- save sobrescreveria a coluna recém-corrigida.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='update_sale_order_atomic' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN
    RAISE WARNING 'update_sale_order_atomic não encontrada — patch NÃO aplicado';
    RETURN;
  END IF;
  -- Já aplicado?
  IF v_src LIKE '%company_id         = v_merged.company_id,%' THEN RETURN; END IF;
  -- Âncora obrigatória
  IF position('    nfe                = v_merged.nfe,' IN v_src) = 0 THEN
    RAISE WARNING 'update_sale_order_atomic: âncora nfe não encontrada — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    '    nfe                = v_merged.nfe,',
    '    nfe                = v_merged.nfe,
    company_id         = v_merged.company_id,');
  EXECUTE v_src;
END
$patch$;
