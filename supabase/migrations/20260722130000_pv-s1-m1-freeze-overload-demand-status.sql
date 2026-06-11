-- AUDITORIA PV 2026-06-10 (S1 + M1):
-- S1: dois overloads vivos de freeze_technical_sheet — chamada com 6 args
-- ambígua (42725). A 7-arg (p_grade DEFAULT NULL) é a canônica.
DROP FUNCTION IF EXISTS public.freeze_technical_sheet(uuid, uuid, uuid, text, numeric, integer);

-- M1: fn_projected_demand não excluía 'Expedido' e 'Concluído' — PVs já
-- faturados voltariam a puxar demanda no MRP. Patch idempotente.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='fn_projected_demand' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'fn_projected_demand não encontrada'; RETURN; END IF;
  IF v_src LIKE '%''Expedido''%' THEN RETURN; END IF;
  IF position($s$('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado')$s$ IN v_src) = 0 THEN
    RAISE WARNING 'fn_projected_demand: lista de status não encontrada — patch NÃO aplicado';
    RETURN;
  END IF;
  v_src := replace(v_src,
    $s$('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado')$s$,
    $s$('Cancelado','Entregue','Finalizado','Finalizado s/ NF','Faturado','Expedido','Concluído')$s$);
  EXECUTE v_src;
END
$patch$;
