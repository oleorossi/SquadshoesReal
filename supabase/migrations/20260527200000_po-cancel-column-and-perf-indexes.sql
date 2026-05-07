-- Suporte ao soft-cancel de purchase_orders + índices de performance.
--
-- 1) Adiciona coluna cancelled_at em purchase_orders. O hook
--    useDeletePurchaseOrder agora usa soft-cancel (status='cancelled'
--    + cancelled_at) em vez de DELETE, para preservar audit trail e
--    evitar accounts_payable órfão.
--
-- 2) Adiciona índices que faltavam em colunas de filtro/join muito
--    usadas. Sem esses índices, queries fazem sequential scan que
--    degrada linearmente conforme as tabelas crescem:
--
--      - mrp_suggestions(order_id):    usado pelo trigger de auto-cancel
--                                      e por queries de useSaleOrders
--      - mrp_suggestions(sale_order_id): idem para cancelamento de PV
--      - nfe_emitidas(sale_order_id, status):  shipment guard server-side
--                                              + duplicate check no emit
--      - notifications(sector):        Kanban filtra por sector
--      - bank_hours_movements(employee_id, movement_date DESC): listagem
--                                                              por funcionário

-- ============================================================
-- 1) cancelled_at em purchase_orders
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN public.purchase_orders.cancelled_at IS
  'Timestamp do soft-cancel. Quando preenchido, status deve ser ''cancelled''.';

-- ============================================================
-- 2) Índices de performance (CONCURRENTLY ausente: o transaction wrapper
--    do supabase migration runner não permite. CREATE INDEX dentro de
--    transaction adquire ACCESS EXCLUSIVE brevemente — tolerável fora
--    de horário de pico.)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_mrp_suggestions_order_id
  ON public.mrp_suggestions(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mrp_suggestions_sale_order_id
  ON public.mrp_suggestions(sale_order_id)
  WHERE sale_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nfe_emitidas_so_status
  ON public.nfe_emitidas(sale_order_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_sector
  ON public.notifications(sector);

-- bank_hours_movements pode não existir em ambientes muito antigos —
-- envolve em DO/EXCEPTION para que a migration não trave.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bank_hours_movements') THEN
    CREATE INDEX IF NOT EXISTS idx_bank_hours_employee_date
      ON public.bank_hours_movements(employee_id, movement_date DESC);
  END IF;
END $$;
