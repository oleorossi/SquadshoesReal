-- ════════════════════════════════════════════════════════════════════════════
-- Fix BAIXO (auditoria 2026-06-11) — frete não recalculava ao mudar nº de pares
-- ════════════════════════════════════════════════════════════════════════════
-- O trigger de frete (trg_sale_order_creates_shipping_expense) dispara em
-- AFTER UPDATE OF shipping_rate_per_pair, order_number. O resync de itens
-- (tg_resync_shipping_on_items_change) só fazia UPDATE ... SET updated_at, que
-- NÃO está no UPDATE OF do frete → ao mudar a quantidade de itens, o amount do
-- frete (= taxa × Σpares) ficava defasado enquanto a entry estava pendente.
--
-- Correção: o resync agora também toca shipping_rate_per_pair (auto-atribuição,
-- valor inalterado). Postgres dispara AFTER UPDATE OF quando a coluna está no
-- SET (mesmo sem mudança de valor) → o trigger de frete refaz o cálculo lendo
-- o novo SUM(quantity). Sem recursão (o frete só mexe em financial_entries).

CREATE OR REPLACE FUNCTION public.tg_resync_shipping_on_items_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Toca shipping_rate_per_pair (no-op) p/ disparar o trigger de frete, que
  -- recalcula amount = taxa × SUM(quantity) com a nova quantidade de pares.
  UPDATE public.sale_orders
     SET shipping_rate_per_pair = shipping_rate_per_pair,
         updated_at = now()
   WHERE id = v_so_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tg_resync_shipping_on_items_change() TO authenticated;
