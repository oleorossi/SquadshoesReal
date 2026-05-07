-- =============================================================================
-- AUDITORIA ESTRATÉGICA — ROUND 3
-- =============================================================================
-- Achados em 4 frentes (estoque/pedidos/triggers/índices):
--   #1 BUG: trigger duplicado em clients (auto_assign + generate, lógica conflitante)
--   #2 BUG: RLS overhead em sole_structures (policy "Enable all" duplicada com novas)
--   #3 BUG: 6 solados com stock_grade só com {_size_from, _size_to} sem keys reais
--   #4 PERF: sale_orders 96% seq_scan — adicionar índices compostos comuns
--   #5 OBS:  53 produtos com quantity > 0 mas zero stock_movements (legacy bulk
--            insert direto em UPDATE products) — função de reconciliação NÃO
--            destrutiva pra dar visibilidade. Criar função utilitária.
--   #6 OBS:  production_orders vazia (legacy/órfã) — comentário pra desambiguar
--
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- #1 BUG: trigger duplicado em clients
-- ----------------------------------------------------------------------------
-- auto_assign_client_number() gera '1','2','3'... (sequencial inteiro, MAX+1)
-- generate_client_number()    gera 'L001','L002',... (via nextval)
-- Como BEFORE INSERT executam alfabeticamente, auto_assign vence.
-- generate_client_number ainda dispara, mas vira no-op (NEW.client_number já
-- não é null/empty). Mas QUEIMA nextval da sequência em cada insert. Bug.
DROP TRIGGER IF EXISTS trg_generate_client_number ON public.clients;
DROP FUNCTION IF EXISTS public.generate_client_number() CASCADE;
DROP SEQUENCE IF EXISTS public.client_number_seq;

-- ----------------------------------------------------------------------------
-- #2 BUG: sole_structures policies RLS conflitantes
-- ----------------------------------------------------------------------------
-- "Enable all for authenticated users" (legacy) coexiste com 4 novas
-- "Approved users can ..." → todas permissive → custo 2× em cada query.
-- Drop legacy.
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.sole_structures;
DROP POLICY IF EXISTS "Allow authenticated users to view sole structures" ON public.sole_structures;

-- Garante que SELECT esteja contemplada
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='sole_structures'
      AND (policyname ILIKE '%view%' OR policyname ILIKE '%select%')
  ) THEN
    CREATE POLICY "Approved users can view sole structures"
      ON public.sole_structures FOR SELECT TO authenticated
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- #3 BUG: stock_grade com só metadados (_size_from, _size_to) sem keys reais
-- ----------------------------------------------------------------------------
-- 6 solados têm stock_grade = {"_size_from": 25, "_size_to": 36} → grade_total=0.
-- A UI lê e mostra "0 pares" mas o JSONB não-vazio confunde queries.
-- Não removemos os metadados (definem a faixa do solado), só não fazem mal.
-- Comentário: validar no frontend pra detectar grade vazia (já feito em
-- gradeTotal() que filtra '_*' keys). Sem ação SQL — apenas observação.

-- ----------------------------------------------------------------------------
-- #4 PERF: índices compostos em sale_orders
-- ----------------------------------------------------------------------------
-- 1842 seq_scan vs 72 idx_scan (96% seq). Queries comuns no frontend (visto
-- em src/pages/SalesOrders.tsx e useSaleOrders.ts):
--   - WHERE status IN (...) ORDER BY created_at DESC
--   - WHERE status = X AND delivery_month = Y
--   - WHERE client_id = X ORDER BY created_at DESC
-- idx_sale_orders_status sozinho não cobre ORDER BY → planner opta por seq.
CREATE INDEX IF NOT EXISTS idx_sale_orders_status_created
  ON public.sale_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_orders_status_delivery
  ON public.sale_orders (status, delivery_month, delivery_week)
  WHERE status NOT IN ('Faturado','Cancelado');
CREATE INDEX IF NOT EXISTS idx_sale_orders_client_created
  ON public.sale_orders (client_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- #5 OBS: stock_movements drift report (não-destrutivo)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.audit_stock_drift_report() CASCADE;
CREATE OR REPLACE FUNCTION public.audit_stock_drift_report()
RETURNS TABLE (
  product_id uuid,
  name text,
  sku text,
  category text,
  db_quantity numeric,
  movements_total numeric,
  drift numeric,
  movement_count bigint,
  drift_severity text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mov_sum AS (
    SELECT product_id,
      SUM(CASE WHEN movement_type IN ('in','adjustment_in','return') THEN quantity
               WHEN movement_type IN ('out','adjustment_out','consumption','sale') THEN -quantity
               ELSE 0 END) AS calc_qty,
      COUNT(*) AS n
    FROM public.stock_movements
    GROUP BY product_id
  )
  SELECT
    p.id, p.name, p.sku, p.category,
    p.quantity::numeric,
    COALESCE(m.calc_qty, 0)::numeric,
    (p.quantity - COALESCE(m.calc_qty, 0))::numeric AS drift,
    COALESCE(m.n, 0)::bigint,
    CASE
      WHEN ABS(p.quantity - COALESCE(m.calc_qty, 0)) <= 0.001 THEN 'OK'
      WHEN COALESCE(m.n, 0) = 0 THEN 'sem_movimentos'
      WHEN ABS(p.quantity - COALESCE(m.calc_qty, 0)) > 100 THEN 'drift_alto'
      ELSE 'drift_baixo'
    END
  FROM public.products p
  LEFT JOIN mov_sum m ON m.product_id = p.id
  WHERE p.active = true
    AND ABS(p.quantity - COALESCE(m.calc_qty, 0)) > 0.001
  ORDER BY ABS(p.quantity - COALESCE(m.calc_qty, 0)) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.audit_stock_drift_report() TO authenticated;
COMMENT ON FUNCTION public.audit_stock_drift_report() IS
  'Lista produtos com divergência entre products.quantity e SUM(stock_movements). '
  'Aponta sem_movimentos (legacy bulk insert), drift_alto/baixo. NÃO altera dados — '
  'só relatório pra revisão humana antes de criar opening_balance retroativo.';

-- ----------------------------------------------------------------------------
-- #6 OBS: desambigua production_orders (vazia) vs orders (real)
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.production_orders IS
  'OBSOLETO/VAZIO. As ordens de produção reais ficam em public.orders '
  '(173 rows ativas em 2026-05). Esta tabela existe por dependência de '
  'features futuras (lot_tracking, wip_ledger). NÃO inserir aqui.';

COMMENT ON TABLE public.orders IS
  'Ordens de Produção (OPs). FK: sale_order_id → sale_orders.id. '
  'Status: Pendente → Em Produção → Finalizado/Cancelado. '
  'Ciclo de vida controlado por triggers em order_stages e sale_orders.';

-- ----------------------------------------------------------------------------
-- #7 BÔNUS: helper de auditoria para detectar future trigger duplication
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.audit_duplicate_triggers() CASCADE;
CREATE OR REPLACE FUNCTION public.audit_duplicate_triggers()
RETURNS TABLE (
  table_name text,
  timing text,
  event text,
  trigger_count bigint,
  trigger_names text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    c.relname::text,
    CASE WHEN tg.tgtype::int & 2 = 0 THEN 'AFTER' ELSE 'BEFORE' END,
    CASE
      WHEN (tg.tgtype::int & 4) > 0 THEN 'INSERT'
      WHEN (tg.tgtype::int & 8) > 0 THEN 'DELETE'
      WHEN (tg.tgtype::int & 16) > 0 THEN 'UPDATE'
    END,
    COUNT(*),
    array_agg(tg.tgname::text ORDER BY tg.tgname)
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  GROUP BY c.relname, tg.tgtype
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC, c.relname;
$$;
GRANT EXECUTE ON FUNCTION public.audit_duplicate_triggers() TO authenticated;
COMMENT ON FUNCTION public.audit_duplicate_triggers() IS
  'Lista tabelas com múltiplos triggers no mesmo timing+event (BEFORE INSERT etc). '
  'NEM SEMPRE é bug — alguns são intencionais (audit + business logic). '
  'Mas sempre vale revisar pra evitar conflitos como o caso clients/auto_assign vs generate.';
