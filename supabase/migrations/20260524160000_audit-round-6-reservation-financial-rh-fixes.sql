-- =============================================================================
-- AUDIT ROUND 6 — 4 bugs críticos em reserva, financeiro e RH
-- =============================================================================
-- 4 fixes nesta migration:
--
-- 🔴 BUG #1 — release_order_reservations não devolve products.reserved_stock
--    A função (20260521120000) só marca material_reservations.status='cancelled'
--    e DELETA reservation_batches. NÃO faz UPDATE em products.reserved_stock.
--    Resultado: cada OP cancelada vaza reserved_stock indefinidamente. Frontend
--    (8+ pontos: OrderMatrixForm, MrpUnifiedContent, PurchasePlanningWizard,
--    OrderReservationForm, ExplosionPanel, useMaterialExplosion, soleAvailability,
--    purchaseRequisition) lê reserved_stock pra calcular "disponível" → mostra
--    cada vez menos disponível (false negativo).
--
-- 🔴 BUG #2 — try_reserve_materials não atualiza products.reserved_stock
--    A função MRP que reserva materiais ao criar OP insere em
--    material_reservations MAS nunca faz UPDATE em products.reserved_stock.
--    Resultado: reserved_stock fica subestimado (geralmente 0). Frontend mostra
--    disponível ARTIFICIALMENTE ALTO. Vendas prometem o que não há, MRP atrasa
--    compras. (Ela usa SUM de material_reservations internamente pra decidir,
--    mas a coluna reserved_stock — usada por todo o frontend — fica errada.)
--
-- 🔴 BUG #3 — financial_entries permite duplicata por race condition em "Faturar"
--    syncFinancialRecords (useSaleOrders.ts:189) faz check-then-insert em
--    financial_entries(reference_id, reference_type) sem unique constraint.
--    Double-click ou retry de mutation cria 2 entries → receita duplicada
--    nos relatórios e KPIs de faturamento.
--
-- 🟡 BUG #4 — VIEW bank_hours_balance ignora derivado de timesheet
--    A view (20260607120000:207) só soma bank_hours_movements; ignora o
--    cálculo de horas extras/déficit derivado de time_records×work_schedules.
--    A função RPC calculate_employee_bank_balance retorna saldo incluindo
--    timesheet, então RH/Hub mostra saldo divergente entre listagem
--    (errado) e detalhe individual (correto).
-- =============================================================================

-- ─── FIX BUG #1 + #2 — sincronizar reserved_stock ───────────────────────────

-- Reescreve release_order_reservations: agora devolve reserved_stock também.
DROP FUNCTION IF EXISTS public.release_order_reservations(p_order_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_delta numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Pra cada reserva ativa que vai ser cancelada, devolve o saldo reservado em
  -- products.reserved_stock. Locka product pra evitar race com debits paralelos.
  FOR r IN
    SELECT product_id,
           COALESCE(SUM(quantity_reserved - quantity_consumed), 0) AS active_qty
      FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status IN ('reserved', 'partially_consumed')
     GROUP BY product_id
  LOOP
    v_delta := r.active_qty;
    IF v_delta > 0 THEN
      UPDATE public.products
         SET reserved_stock = GREATEST(0, COALESCE(reserved_stock, 0) - v_delta),
             updated_at     = now()
       WHERE id = r.product_id;
    END IF;
  END LOOP;

  UPDATE public.material_reservations
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = p_order_id
     AND status IN ('reserved', 'partially_consumed');

  DELETE FROM public.reservation_batches WHERE order_id = p_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_order_reservations(uuid) TO authenticated;


-- Trigger AFTER INSERT em material_reservations: incrementa reserved_stock.
-- Cobre try_reserve_materials e qualquer outro caller futuro.
-- Não cobre UPDATE/DELETE: as funções existentes (convert_reservation_to_out,
-- release_order_reservations atualizada acima, debits) já decrementam manualmente
-- ou via UPDATE de status — adicionar AFTER UPDATE causaria duplo decremento.
CREATE OR REPLACE FUNCTION public.tg_sync_reserved_stock_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta numeric;
BEGIN
  IF NEW.status NOT IN ('reserved', 'partially_consumed') THEN
    RETURN NULL;
  END IF;
  v_delta := COALESCE(NEW.quantity_reserved, 0) - COALESCE(NEW.quantity_consumed, 0);
  IF v_delta > 0 AND NEW.product_id IS NOT NULL THEN
    UPDATE public.products
       SET reserved_stock = COALESCE(reserved_stock, 0) + v_delta,
           updated_at     = now()
     WHERE id = NEW.product_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reserved_stock_on_insert ON public.material_reservations;
CREATE TRIGGER trg_sync_reserved_stock_on_insert
  AFTER INSERT ON public.material_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_reserved_stock_on_insert();


-- BACKFILL: ressincroniza reserved_stock com soma real de material_reservations.
-- Roda 1× ao aplicar a migration. Garante que produtos com reservas órfãs
-- (acumuladas pelos bugs #1 e #2) ficam coerentes.
WITH active_reservations AS (
  SELECT product_id,
         SUM(quantity_reserved - quantity_consumed) AS active_qty
    FROM public.material_reservations
   WHERE status IN ('reserved', 'partially_consumed')
     AND product_id IS NOT NULL
   GROUP BY product_id
)
UPDATE public.products p
   SET reserved_stock = GREATEST(0, COALESCE(ar.active_qty, 0)),
       updated_at     = now()
  FROM active_reservations ar
 WHERE p.id = ar.product_id
   AND COALESCE(p.reserved_stock, 0) <> COALESCE(ar.active_qty, 0);

-- Zera reserved_stock em produtos sem nenhuma reserva ativa (poderia estar
-- inflado por OPs canceladas no passado — bug #1).
UPDATE public.products
   SET reserved_stock = 0,
       updated_at     = now()
 WHERE COALESCE(reserved_stock, 0) > 0
   AND id NOT IN (
     SELECT DISTINCT product_id
       FROM public.material_reservations
      WHERE status IN ('reserved', 'partially_consumed')
        AND product_id IS NOT NULL
   );


-- ─── FIX BUG #3 — UNIQUE em financial_entries pra sale_order ────────────────
-- Constraint parcial: apenas pra reference_type='sale_order' E status ativos.
-- Não bloqueia múltiplos lançamentos manuais nem entries cancelados (estornos
-- legítimos podem ter mesmo reference_id). Bloqueia só duplicação acidental.

CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_sale_order_unique
  ON public.financial_entries (reference_id)
  WHERE reference_type = 'sale_order'
    AND reference_id IS NOT NULL
    AND reference_id <> ''
    AND status NOT IN ('cancelado', 'cancelled', 'estornado');


-- ─── FIX BUG #4 — bank_hours_balance VIEW inclui derivado de timesheet ──────
-- LATERAL JOIN com a função RPC calculate_employee_bank_balance(employee_id)
-- garante que a view bate com o que o detalhe individual do funcionário mostra.
-- Custo: chama a função 1× por employee ativo na consulta. Aceitável pra
-- dashboard que recarrega ~1×/min e tipicamente <200 funcionários.

DROP VIEW IF EXISTS public.bank_hours_balance CASCADE;
CREATE VIEW public.bank_hours_balance AS
SELECT
  e.id                                            AS employee_id,
  e.name                                          AS employee_name,
  e.department,
  e.role,
  0                                               AS initial_min,
  COALESCE((bal.payload ->> 'movements_min')::int, 0) AS movements_min,
  COALESCE((bal.payload ->> 'timesheet_min')::int, 0) AS timesheet_min,
  COALESCE((bal.payload ->> 'balance_min')::int, 0)   AS balance_min,
  (SELECT COUNT(*)::int FROM public.bank_hours_movements m WHERE m.employee_id = e.id) AS movement_count,
  (SELECT MAX(m.movement_date) FROM public.bank_hours_movements m WHERE m.employee_id = e.id) AS last_movement_date
FROM public.employees e
LEFT JOIN LATERAL (
  SELECT public.calculate_employee_bank_balance(e.id, NULL, NULL) AS payload
) bal ON true
WHERE e.active = true;

GRANT SELECT ON public.bank_hours_balance TO authenticated;

-- Reaplica views dependentes que foram dropadas pelo CASCADE acima.
CREATE OR REPLACE VIEW public.v_bank_hours_per_sector AS
SELECT
  COALESCE(e.department, 'Sem setor')                                AS department,
  COUNT(DISTINCT e.id)                                               AS employee_count,
  COALESCE(SUM(m.minutes), 0)::int                                   AS total_balance_min,
  COALESCE(SUM(m.minutes) FILTER (WHERE m.minutes > 0), 0)::int      AS total_credit_min,
  COALESCE(SUM(m.minutes) FILTER (WHERE m.minutes < 0), 0)::int      AS total_debit_min,
  COUNT(DISTINCT m.id)                                               AS movement_count
FROM public.employees e
LEFT JOIN public.bank_hours_movements m ON m.employee_id = e.id
WHERE e.active = true
GROUP BY e.department
ORDER BY total_balance_min DESC;
GRANT SELECT ON public.v_bank_hours_per_sector TO authenticated;

CREATE OR REPLACE VIEW public.v_bank_hours_summary AS
SELECT
  COUNT(DISTINCT e.id)                                                                    AS total_employees,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) > 0)                      AS employees_with_credit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) < 0)                      AS employees_with_debit,
  COUNT(DISTINCT e.id) FILTER (WHERE COALESCE(b.balance_min, 0) = 0)                      AS employees_balanced,
  COALESCE(SUM(b.balance_min), 0)::int                                                    AS total_balance_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min > 0), 0)::int                   AS total_credit_min,
  COALESCE(SUM(b.balance_min) FILTER (WHERE b.balance_min < 0), 0)::int                   AS total_debit_min,
  COUNT(DISTINCT e.department)                                                            AS sector_count
FROM public.employees e
LEFT JOIN public.bank_hours_balance b ON b.employee_id = e.id
WHERE e.active = true;
GRANT SELECT ON public.v_bank_hours_summary TO authenticated;
