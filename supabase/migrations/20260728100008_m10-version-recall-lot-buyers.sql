-- ============================================================================
-- M10 (auditoria 2026-07-28) — recall_lot_buyers existia só no banco vivo.
--
-- O hook useRecallLot (src/hooks/useStockQuality.ts) chama a RPC
-- recall_lot_buyers, mas nenhuma migration a criava — foi aplicada por fora
-- (MCP/SQL Editor) e nunca retro-portada. Ambiente reconstruído das migrations
-- (branch DB, CI, disaster recovery) nascia sem a função e a aba Recall de
-- Lote quebrava em runtime.
--
-- Esta migration só VERSIONA a definição viva (capturada via
-- pg_get_functiondef em 2026-07-28, project ssvxfoybzmjlypnipqzn), corpo
-- idêntico — no banco de produção é no-op. GRANTs espelham o ACL vivo
-- ({postgres, authenticated, service_role} — sem PUBLIC/anon).
-- Idempotente (CREATE OR REPLACE + REVOKE/GRANT).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recall_lot_buyers(p_lot_id uuid)
 RETURNS TABLE(sale_order_id uuid, sale_order_number text, client_name text, client_cnpj text, pairs_received integer, nfe_number text, delivery_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    so.id, so.order_number, so.client_name, so.client_cnpj,
    SUM(la.pairs_allocated)::integer AS pairs_received,
    so.nfe, so.delivery_deadline
  FROM public.sale_order_lot_allocations la
  JOIN public.sale_order_items soi ON soi.id = la.sale_order_item_id
  JOIN public.sale_orders so ON so.id = soi.sale_order_id
  WHERE la.production_lot_id = p_lot_id
  GROUP BY so.id, so.order_number, so.client_name, so.client_cnpj, so.nfe, so.delivery_deadline
  ORDER BY so.delivery_deadline DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.recall_lot_buyers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recall_lot_buyers(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.recall_lot_buyers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recall_lot_buyers(uuid) TO service_role;
