-- Outbox de PV: process_sale_order_purchase_shortages quebrava com
--   "column p.is_artisanal_strap does not exist"
-- A migration 20270101047600 (OC semanal) trocou a exclusão do Ateliê por
-- `NOT COALESCE(p.is_artisanal_strap, false)`, mas `p` é public.products e a
-- flag de tira artesanal mora em public.product_groups (alias `pg`, já unido no
-- mesmo CTE material_rows). Todo evento de PV em Aprovado/Em Produção caía em
-- dead_letter e travava as versões seguintes do mesmo PV (financeiro incluso).
--
-- Correção mínima: ler a flag do grupo. Idempotente; sem efeito em dados.

DO $fix_artisanal_strap_alias$
DECLARE
  v_def text;
  v_old text := 'AND NOT COALESCE(p.is_artisanal_strap, false)';
  v_new text := 'AND NOT COALESCE(pg.is_artisanal_strap, false)';
BEGIN
  SELECT pg_get_functiondef('public.process_sale_order_purchase_shortages(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_sale_order_purchase_shortages ausente';
  END IF;

  IF strpos(v_def, v_new) > 0 AND strpos(v_def, v_old) = 0 THEN
    RAISE NOTICE 'process_sale_order_purchase_shortages já lê a flag do grupo';
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'âncora p.is_artisanal_strap não encontrada em process_sale_order_purchase_shortages';
  END IF;
  IF strpos(v_def, 'LEFT JOIN public.product_groups pg ON pg.id = p.group_id') = 0 THEN
    RAISE EXCEPTION 'join de product_groups (pg) não encontrado; correção abortada';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$fix_artisanal_strap_alias$;
