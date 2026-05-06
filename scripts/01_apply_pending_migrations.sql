-- =================================================================
-- 01_apply_pending_migrations.sql
--
-- Aplica em sequência todas as 7 migrations pendentes (Grupos 9, 10, 11
-- do CLAUDE.md). Pode ser colado inteiro no Supabase SQL Editor.
--
-- ORDEM (não alterar):
--   1) 20260504120000 — calculate_order_cost com packaging + grade   [Grupo 9]
--   2) 20260504130000 — debit_packaging_for_order_atomic (RPC)       [Grupo 10]
--   3) 20260504140000 — clients.endereco_manual_override + trigger    [Grupo 10]
--   4) 20260504150000 — fn_projected_demand status case-insensitive   [Grupo 10]
--   5) 20260504160000 — sale_orders.total trigger + backfill          [Grupo 10]
--   6) 20260504180000 — resync_queue + RPC atômica + triggers         [Grupo 11]
--   7) 20260504170000 — backfill order_costs (POR ÚLTIMO, depende de #1) [Grupo 10]
--
-- TEMPO ESTIMADO: 5-15 minutos dependendo do tamanho de sale_order_items
-- e order_costs. As migrations #5 e #7 fazem backfill em DO blocks.
--
-- IDEMPOTÊNCIA: todas usam CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS /
-- DROP TRIGGER IF EXISTS, podem ser re-executadas com segurança.
--
-- ROLLBACK: ver scripts/04_rollback_pending_migrations.sql
-- =================================================================

-- ---------------------------------------------------------------
-- 20260504120000_fix-order-cost-packaging-and-grade.sql
--
-- Fixes two impactful bugs in `calculate_order_cost()`:
--
-- 1. PACKAGING COST OMITTED FROM TOTAL
--    `cost_policies.packaging_cost_per_pair` exists since 20260314 but was
--    never read/added. Every order's total_cost was understated by
--    `packaging_cost_per_pair * quantity`. This silently inflated apparent
--    margin (selling price stays the same; reported cost is lower than real).
--
-- 2. CONSUMPTION CALCULATED WITHOUT GRADE
--    The function called `calculate_order_consumption(ref, qty, color, NULL)`
--    even when the order item has a size grade (e.g. {"35":20, "37":50}).
--    Per-size consumption (smaller sizes use less leather) was averaged out.
--    Now uses `calculate_order_consumption_by_grade(ref, color, grade)` when
--    the item carries a non-empty grade JSON.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_order_cost(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_ref uuid;
  v_color text;
  v_qty numeric;
  v_unit_price numeric;
  v_grade jsonb;
  v_cons jsonb;
  v_line jsonb;
  v_material numeric := 0;
  v_labor numeric := 0;
  v_overhead_pct numeric;
  v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0;
  v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric;
  v_margin numeric;
  v_margin_pct numeric;
  v_op record;
  v_prod record;
  v_out jsonb;
BEGIN
  SELECT value INTO v_overhead_pct FROM public.cost_parameters WHERE key = 'overhead_pct';
  v_overhead_pct := COALESCE(v_overhead_pct, 0);

  -- Load packaging cost per pair from active cost policy. Defaults to 0 if
  -- no policy exists, preserving prior behaviour for new installations.
  SELECT COALESCE(packaging_cost_per_pair, 0)
    INTO v_packaging_per_pair
    FROM public.cost_policies
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  SELECT soi.id, soi.reference_id, soi.color, soi.quantity, soi.unit_price, soi.grade
    INTO v_item
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR soi.id = p_sale_order_item_id)
   ORDER BY soi.created_at
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do pedido não encontrado (order=%, item=%)',
      p_sale_order_id, p_sale_order_item_id;
  END IF;

  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := v_item.unit_price;
  v_grade := v_item.grade;

  -- Consumo (snapshot > cálculo vivo). When the item has a grade, prefer
  -- per-size accuracy via calculate_order_consumption_by_grade.
  SELECT consumption_snapshot INTO v_cons
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = p_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(v_ref, COALESCE(v_color, ''), v_grade);
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL) c;
    END IF;
  END IF;

  -- Custo de materiais
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name INTO v_prod
      FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_material := v_material + COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', (v_line ->> 'required')::numeric,
      'unit_price', COALESCE(v_prod.unit_price,0),
      'subtotal', COALESCE(v_prod.unit_price,0) * (v_line ->> 'required')::numeric
    );
  END LOOP;

  -- Custo de MOD
  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty
    );
  END LOOP;

  v_overhead := v_overhead_pct * (v_material + v_labor);
  v_packaging := v_packaging_per_pair * v_qty;
  v_total := v_material + v_labor + v_overhead + v_packaging;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'material_cost', v_material,
    'labor_cost', v_labor,
    'overhead_cost', v_overhead,
    'packaging_cost', v_packaging,
    'total_cost', v_total,
    'revenue', v_revenue,
    'margin', v_margin,
    'margin_pct', v_margin_pct,
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_pct', v_overhead_pct,
      'packaging_per_pair', v_packaging_per_pair,
      'used_grade', v_grade IS NOT NULL AND v_grade <> '{}'::jsonb
    )
  );

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      p_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown'
    )
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost    = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      total_cost    = EXCLUDED.total_cost,
      revenue       = EXCLUDED.revenue,
      margin        = EXCLUDED.margin,
      margin_pct    = EXCLUDED.margin_pct,
      breakdown     = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_order_cost(uuid, uuid, boolean) TO authenticated;
-- ---------------------------------------------------------------
-- 20260504130000_atomic-packaging-debit-rpc.sql
--
-- Substitui o padrão SELECT → calcula → UPDATE → INSERT do
-- src/hooks/useOrders.ts (linhas 109-134) por uma RPC atômica.
--
-- O fluxo anterior era 3 roundtrips sem lock:
--   1) SELECT products.quantity
--   2) UPDATE products.quantity = old - debit
--   3) INSERT stock_movements
-- Sob concorrência, duas OPs criadas no mesmo segundo podiam ler
-- o mesmo `quantity` e ambas debitar o full amount, deixando o
-- estoque negativo invisível. Esta RPC trava a linha do produto
-- com SELECT FOR UPDATE e faz tudo em transação única.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.debit_packaging_for_order_atomic(
  p_order_id uuid,
  p_packaging_product_id uuid,
  p_quantity numeric,
  p_packaging_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_stock numeric;
  v_new_stock  numeric;
  v_movement_id uuid;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de embalagem inválida (%)', p_quantity;
  END IF;
  IF p_packaging_product_id IS NULL THEN
    RAISE EXCEPTION 'packaging_product_id é obrigatório';
  END IF;

  -- Lock the product row to prevent concurrent debits from racing.
  SELECT quantity
    INTO v_prev_stock
    FROM public.products
   WHERE id = p_packaging_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto de embalagem não encontrado (%)', p_packaging_product_id;
  END IF;

  v_new_stock := v_prev_stock - p_quantity;

  -- Block accidental negative stock — caller can check stock first.
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente: disponível % unidade(s), tentado debitar %',
      v_prev_stock, p_quantity;
  END IF;

  UPDATE public.products
     SET quantity = v_new_stock,
         updated_at = now()
   WHERE id = p_packaging_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
  ) VALUES (
    p_packaging_product_id,
    'out',
    p_quantity,
    v_prev_stock,
    v_new_stock,
    COALESCE('Embalagem OP - ' || p_packaging_type, 'Embalagem OP'),
    p_order_id
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'product_id', p_packaging_product_id,
    'movement_id', v_movement_id,
    'previous_stock', v_prev_stock,
    'new_stock', v_new_stock,
    'debited', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text)
  TO authenticated;
-- ---------------------------------------------------------------
-- 20260504140000_clients-address-manual-override-tracking.sql
--
-- Adiciona controle de override manual em endereços de clientes
-- para a edge function `sync-cnpj-addresses` parar de sobrescrever
-- dados editados pelo usuário.
--
-- Cenário do bug atual:
--   1) Usuário cadastra cliente com CNPJ (sede em São Paulo)
--   2) Usuário edita endereço manualmente para a filial em Curitiba
--   3) `sync-cnpj-addresses` roda no cron noturno, busca CNPJ na API
--   4) API retorna endereço da SEDE (SP), sobrescreve a filial (PR)
--   5) Próxima NF-e sai com endereço errado → comprovante de entrega
--      vai pra cidade errada, ICMS interestadual recalculado.
--
-- Solução: rastrear `endereco_manual_override` como flag, mais
-- `endereco_updated_at` como timestamp da última edição manual.
-- A edge function consulta esses campos antes de aplicar update.
-- ---------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS endereco_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS endereco_updated_at timestamptz;

COMMENT ON COLUMN public.clients.endereco_manual_override IS
  'Quando true, sync-cnpj-addresses NÃO sobrescreve endereco/bairro/cidade/estado/cep. Usuário marcou como personalizado.';
COMMENT ON COLUMN public.clients.endereco_updated_at IS
  'Timestamp da última alteração de qualquer campo de endereço por usuário humano (não pelo sync automático).';

-- Trigger: quando qualquer campo de endereço é atualizado em UPDATE
-- sem que o sync explicitamente passe `endereco_updated_at`, considera
-- como edição humana e marca o override automaticamente.
CREATE OR REPLACE FUNCTION public.fn_track_client_address_manual_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.endereco IS DISTINCT FROM OLD.endereco
      OR NEW.bairro IS DISTINCT FROM OLD.bairro
      OR NEW.cidade IS DISTINCT FROM OLD.cidade
      OR NEW.estado IS DISTINCT FROM OLD.estado
      OR NEW.cep    IS DISTINCT FROM OLD.cep)
     -- Só marca como manual se o caller NÃO sinalizou que é o sync.
     -- A edge function sync-cnpj-addresses define endereco_updated_at
     -- explicitamente igual ao OLD para indicar "não foi humano".
     AND (NEW.endereco_updated_at IS NULL
          OR NEW.endereco_updated_at = OLD.endereco_updated_at) THEN
    NEW.endereco_updated_at := now();
    -- Não força override=true: o usuário precisa marcar explicitamente
    -- via UI para travar contra sync futuro. Isso evita fricção em
    -- correções pontuais (typo) que não querem bloquear sync.
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_client_address_manual_edit ON public.clients;
CREATE TRIGGER trg_track_client_address_manual_edit
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_track_client_address_manual_edit();

-- Backfill inicial: todos os clientes existentes com endereço preenchido
-- recebem timestamp atual (assume-se que estão "validados" pelo usuário).
UPDATE public.clients
   SET endereco_updated_at = COALESCE(endereco_updated_at, updated_at, created_at, now())
 WHERE endereco IS NOT NULL
   AND endereco_updated_at IS NULL;
-- ---------------------------------------------------------------
-- 20260504150000_normalize-mrp-status-filter.sql
--
-- Corrige `fn_projected_demand()` para filtrar status de pedido
-- de forma case-insensitive.
--
-- Bug:
--   WHERE so.status NOT IN ('Cancelado', 'Entregue', 'Finalizado', 'Faturado')
--
-- Se uma migração futura ou import de dados gravar status em
-- minúsculas (`'cancelado'`, `'entregue'`) ou em UPPERCASE, o
-- filtro NÃO exclui esses pedidos, e o MRP soma demanda de
-- pedidos já finalizados/cancelados na projeção. Resultado:
-- compra excessiva de matéria-prima.
--
-- Esta migration usa `LOWER()` em ambos os lados do IN para
-- absorver qualquer variação de capitalização.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_projected_demand()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_required numeric,
  earliest_deadline date,
  orders_count integer,
  order_ids uuid[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH items_with_cons AS (
    SELECT
      so.id AS sale_order_id,
      so.delivery_deadline,
      soi.id AS sale_order_item_id,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
         FROM public.calculate_order_consumption(
           soi.reference_id, soi.quantity, COALESCE(soi.color,''),
           (SELECT key::integer FROM jsonb_each_text(soi.grade)
              WHERE key ~ '^[0-9]+$' ORDER BY value::numeric DESC LIMIT 1)
         ) c) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
    WHERE LOWER(COALESCE(so.status, '')) NOT IN (
            'cancelado', 'cancelada', 'cancelled',
            'entregue', 'delivered',
            'finalizado', 'finalizada', 'finished', 'completed',
            'faturado', 'faturada', 'invoiced'
          )
      AND soi.reference_id IS NOT NULL
  ),
  exploded AS (
    SELECT
      sale_order_id,
      delivery_deadline,
      (line ->> 'product_id')::uuid AS product_id,
      (line ->> 'product_name')      AS product_name,
      (line ->> 'required')::numeric AS required
    FROM items_with_cons, jsonb_array_elements(cons) AS line
  )
  SELECT
    e.product_id,
    MAX(e.product_name) AS product_name,
    SUM(e.required)     AS total_required,
    MIN(e.delivery_deadline) AS earliest_deadline,
    COUNT(DISTINCT e.sale_order_id)::integer AS orders_count,
    array_agg(DISTINCT e.sale_order_id) AS order_ids
  FROM exploded e
  WHERE e.product_id IS NOT NULL
  GROUP BY e.product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_projected_demand() TO authenticated;
-- ---------------------------------------------------------------
-- 20260504160000_sale-order-total-integrity-trigger.sql
--
-- Mantém `sale_orders.total` automaticamente sincronizado com
-- a soma de `sale_order_items` (qty × unit_price), e adiciona
-- função RPC para recalcular sob demanda.
--
-- Motivação:
-- A edge function `emit-nfe` foi corrigida em 20260504 para validar
-- `|sumItems - order.total| > 0,01`. Mas na origem, hoje, é
-- possível alterar/remover itens sem que o total seja atualizado.
-- Esse trigger evita o problema na raiz: qualquer INSERT/UPDATE/
-- DELETE em sale_order_items recalcula o total do pedido pai.
--
-- Performance: pedidos têm tipicamente <50 itens; a recalculação
-- por trigger é O(n) e roda em transação. Vale o custo.
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalc_sale_order_total(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0)), 0)
    INTO v_total
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;

  -- Round to centavos to avoid float drift across many items.
  v_total := round(v_total::numeric, 2);

  UPDATE public.sale_orders
     SET total = v_total,
         updated_at = now()
   WHERE id = p_sale_order_id
     AND COALESCE(total, 0) IS DISTINCT FROM v_total;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_sale_order_total(uuid) TO authenticated;

-- Trigger function: dispara recálculo após qualquer mudança em itens.
CREATE OR REPLACE FUNCTION public.fn_sync_sale_order_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  -- Em DELETE, OLD; em INSERT/UPDATE, NEW. Em UPDATE de sale_order_id
  -- (movendo um item entre pedidos) recalcula AMBOS os pedidos.
  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.sale_order_id;
    PERFORM public.recalc_sale_order_total(v_target_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.recalc_sale_order_total(OLD.sale_order_id);
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_sale_order_total();

-- Backfill: alinha todos os pedidos existentes que estão com total
-- divergente da soma dos itens. Roda apenas uma vez na aplicação.
DO $$
DECLARE
  v_fixed integer := 0;
  v_so_id uuid;
BEGIN
  FOR v_so_id IN
    SELECT DISTINCT so.id
      FROM public.sale_orders so
      LEFT JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     GROUP BY so.id, so.total
    HAVING ABS(COALESCE(so.total, 0) - COALESCE(SUM(COALESCE(soi.quantity, 0) * COALESCE(soi.unit_price, 0)), 0)) > 0.01
  LOOP
    PERFORM public.recalc_sale_order_total(v_so_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: % pedidos tiveram total reajustado.', v_fixed;
END;
$$;
-- ---------------------------------------------------------------
-- 20260504180000_atomic-resync-ops-and-trigger-coverage.sql
--
-- Corrige cenários onde alteração de dados técnicos em referências
-- com OPs ATIVAS (Reservado / Em Produção) deixava o estoque dessincronizado
-- com a nova ficha:
--
-- BUG #1 — Triggers ausentes
--   Resync automático só roda quando se altera technical_sheets ou
--   sheet_materials. Mas essas outras mudanças TAMBÉM impactam consumo
--   e NÃO disparavam resync:
--     - sole_size_conjugations (conjugação 23/24) → débito de solado
--     - technical_sheet_palmilha_colors → débito de palmilha quando
--       insole_has_lining=false
--     - artisanal_recipes (yield_per_meter, labor_cost) → consumo de
--       MP base em OSs artesanais
--   Solução: triggers AFTER UPDATE/INSERT/DELETE nessas tabelas
--   marcam as OPs/OSs afetadas em uma fila (`resync_queue`) que o
--   frontend consulta periodicamente.
--
-- BUG #2 — Resync não-atômico no TS
--   src/lib/resyncOPs.ts faz 7 passos sem transação. Crash entre passo 1
--   (estorno) e passo 4 (re-débito) deixa estoque devolvido sem novo
--   débito. Solução: RPC `resync_op_atomic(op_id)` que faz tudo numa
--   única transação SQL. Lock na linha da OP previne concorrência.
--
-- BUG #3 — production_consumptions deletado
--   Resync deletava production_consumptions, perdendo histórico de quem
--   consumiu. Solução: marca como `superseded_at = now()` em vez de
--   DELETE, preservando auditoria.
-- ---------------------------------------------------------------

-- =====================================================================
-- 1) Fila de resync — OPs/OSs marcadas para resync pelo trigger
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.resync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  artisanal_order_id uuid,
  reason text NOT NULL,
  triggered_by text NOT NULL,         -- ex: 'sole_size_conjugations.update'
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_result jsonb,
  CHECK (order_id IS NOT NULL OR artisanal_order_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_resync_queue_pending
  ON public.resync_queue (enqueued_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resync_queue_order
  ON public.resync_queue (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.resync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resync_queue_select ON public.resync_queue;
CREATE POLICY resync_queue_select ON public.resync_queue
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_insert ON public.resync_queue;
CREATE POLICY resync_queue_insert ON public.resync_queue
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS resync_queue_update ON public.resync_queue;
CREATE POLICY resync_queue_update ON public.resync_queue
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================================
-- 2) production_consumptions: campo superseded_at (preserva auditoria)
-- =====================================================================
ALTER TABLE public.production_consumptions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

CREATE INDEX IF NOT EXISTS idx_prod_cons_active
  ON public.production_consumptions (order_id)
  WHERE superseded_at IS NULL;

-- =====================================================================
-- 3) Triggers que enfileiram resync quando dados técnicos mudam
-- =====================================================================

-- 3a) sole_size_conjugations — afeta débito de solado por grade
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_sole_conjugation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sole_group_id uuid;
BEGIN
  v_sole_group_id := COALESCE(NEW.sole_group_id, OLD.sole_group_id);

  -- Find OPs whose sole product belongs to this group AND are still active.
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Conjugação de solado alterada',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products sole_p ON sole_p.id = ts.sole_id
   WHERE sole_p.group_id = v_sole_group_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_sole_conjugation ON public.sole_size_conjugations;
CREATE TRIGGER trg_resync_for_sole_conjugation
  AFTER INSERT OR UPDATE OR DELETE ON public.sole_size_conjugations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_sole_conjugation();

-- 3b) technical_sheet_palmilha_colors — afeta débito de palmilha quando insole_has_lining=false
CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_palmilha_colors()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sheet_id uuid;
BEGIN
  v_sheet_id := COALESCE(NEW.sheet_id, OLD.sheet_id);
  INSERT INTO public.resync_queue (order_id, reason, triggered_by)
  SELECT DISTINCT o.id,
         'Mapeamento cabedal × palmilha alterado',
         TG_TABLE_NAME || '.' || TG_OP
    FROM public.orders o
   WHERE o.reference_id = v_sheet_id
     AND LOWER(COALESCE(o.status, '')) IN ('reservado', 'em produção');
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_resync_for_palmilha_colors ON public.technical_sheet_palmilha_colors;
CREATE TRIGGER trg_resync_for_palmilha_colors
  AFTER INSERT OR UPDATE OR DELETE ON public.technical_sheet_palmilha_colors
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enqueue_resync_for_palmilha_colors();

-- 3c) artisanal_recipes — afeta consumo de MP base em OSs artesanais
-- Apenas dispara se a tabela artisanal_orders existir (pode não existir
-- em ambientes que não têm o módulo artesanal habilitado).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'artisanal_orders') THEN

    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.fn_enqueue_resync_for_artisanal_recipe()
      RETURNS trigger LANGUAGE plpgsql AS $g$
      DECLARE
        v_recipe_id uuid;
      BEGIN
        v_recipe_id := COALESCE(NEW.id, OLD.id);
        INSERT INTO public.resync_queue (artisanal_order_id, reason, triggered_by)
        SELECT DISTINCT ao.id,
               'Receita artesanal alterada (yield/custo)',
               TG_TABLE_NAME || '.' || TG_OP
          FROM public.artisanal_orders ao
         WHERE ao.recipe_id = v_recipe_id
           AND LOWER(COALESCE(ao.status, '')) NOT IN
               ('finalizado','finalizada','cancelado','cancelada','entregue');
        RETURN COALESCE(NEW, OLD);
      END;
      $g$;
    $f$;

    EXECUTE $f$
      DROP TRIGGER IF EXISTS trg_resync_for_artisanal_recipe ON public.artisanal_recipes;
      CREATE TRIGGER trg_resync_for_artisanal_recipe
        AFTER UPDATE ON public.artisanal_recipes
        FOR EACH ROW
        WHEN (
          NEW.yield_per_meter IS DISTINCT FROM OLD.yield_per_meter OR
          NEW.labor_cost_per_meter IS DISTINCT FROM OLD.labor_cost_per_meter OR
          NEW.base_time_minutes IS DISTINCT FROM OLD.base_time_minutes
        )
        EXECUTE FUNCTION public.fn_enqueue_resync_for_artisanal_recipe();
    $f$;
  END IF;
END;
$$;

-- =====================================================================
-- 4) RPC atômica que faz o resync de uma única OP em transação
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  -- Lock the order row to prevent concurrent resyncs of the same OP.
  SELECT id, reference_id, quantity, color, grade, sale_order_id, order_number, status
    INTO v_op
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada: %', p_order_id;
  END IF;

  v_status := LOWER(COALESCE(v_op.status, ''));
  IF v_status NOT IN ('reservado', 'em produção') THEN
    -- OPs finalizadas/canceladas ficam congeladas; resync não se aplica.
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

  -- 1) Estorno: para cada movement_type='out' anterior, cria um 'in' compensatório
  --    e atualiza products.quantity. Tudo dentro da mesma transação.
  FOR v_mov IN
    SELECT product_id, quantity
      FROM public.stock_movements
     WHERE order_id = p_order_id AND movement_type = 'out'
  LOOP
    SELECT quantity INTO v_prev_stock
      FROM public.products
     WHERE id = v_mov.product_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_errors := v_errors || ('Produto não encontrado: ' || v_mov.product_id::text);
      CONTINUE;
    END IF;

    v_new_stock := v_prev_stock + v_mov.quantity;
    UPDATE public.products SET quantity = v_new_stock, updated_at = now()
     WHERE id = v_mov.product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_mov.product_id, 'in', v_mov.quantity, v_prev_stock, v_new_stock,
      'Estorno automático - resync_op_atomic', p_order_id
    );
  END LOOP;

  -- 2) Marca production_consumptions como superseded (preserva auditoria)
  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  -- 3) Reservas e estágios são recriados — podem ser hard-deleted
  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  -- 4) Invalida snapshot da PV/item (força recálculo com ficha atual)
  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  -- 5) Detach old movements para que próximo débito não seja confundido
  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  -- 6) Restaura grade do solado se função existir (ambiente legado pode não ter)
  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  -- 7) Re-débito principal (cabedal/forração/etc)
  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  -- 8) Re-débito do solado por grade (se houver grade)
  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

  -- 9) Recria estágios de produção a partir da ficha técnica atual
  --    (mantém o comportamento antigo de DEFAULT_STAGES como fallback).
  INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
  SELECT p_order_id,
         stage_name,
         stage_order,
         'pendente',
         v_op.quantity,
         0
    FROM (
      SELECT
        COALESCE(
          (SELECT array_agg(value::text ORDER BY ordinality)
             FROM technical_sheets ts,
                  jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY
            WHERE ts.id = v_op.reference_id
              AND ts.production_sectors IS NOT NULL
              AND jsonb_array_length(ts.production_sectors) > 0),
          ARRAY['Corte','Forração','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento']
        ) AS names
    ) s,
    LATERAL (
      SELECT name AS stage_name, ord AS stage_order
        FROM unnest(s.names) WITH ORDINALITY AS u(name, ord)
    ) lat;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'order_number', v_op.order_number,
    'errors', v_errors,
    'resynced_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_op_atomic(uuid) TO authenticated;

-- =====================================================================
-- 5) RPC para processar a fila — batch processor
-- =====================================================================
CREATE OR REPLACE FUNCTION public.process_resync_queue(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_processed integer := 0;
  v_failed integer := 0;
  v_result jsonb;
BEGIN
  FOR v_row IN
    SELECT id, order_id, artisanal_order_id, reason
      FROM public.resync_queue
     WHERE processed_at IS NULL
       AND order_id IS NOT NULL  -- Artisanal handler not yet implemented in SQL
     ORDER BY enqueued_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.resync_op_atomic(v_row.order_id);
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = v_result
       WHERE id = v_row.id;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.resync_queue
         SET processed_at = now(),
             processed_result = jsonb_build_object('error', SQLERRM)
       WHERE id = v_row.id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'failed', v_failed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_resync_queue(integer) TO authenticated;
-- ---------------------------------------------------------------
-- 20260504170000_backfill-order-costs-with-packaging.sql
--
-- Recalcula `order_costs` históricos que foram persistidos pela
-- versão anterior de `calculate_order_cost()` (sem somar packaging
-- e sem usar grade). Garante que relatórios de margem retroativos
-- reflitam o custo real.
--
-- Pré-requisito: 20260504120000 já aplicado (versão corrigida da
-- função). Esta migration apenas dispara recalculação.
--
-- Estratégia:
--   - Para cada (sale_order_id, sale_order_item_id) com order_costs
--     existente, chama `calculate_order_cost(..., p_persist=true)`
--     que faz UPSERT (ON CONFLICT DO UPDATE) com os valores corretos.
--   - Pedidos cancelados são pulados (não fazem sentido recalcular).
-- ---------------------------------------------------------------

DO $$
DECLARE
  v_oc record;
  v_processed integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
BEGIN
  FOR v_oc IN
    SELECT oc.sale_order_id, oc.sale_order_item_id, so.status
      FROM public.order_costs oc
      JOIN public.sale_orders so ON so.id = oc.sale_order_id
     ORDER BY oc.calculated_at NULLS FIRST
  LOOP
    -- Pula pedidos finalizados — manter custo histórico congelado
    -- evita que mudanças no cost_policies retroajam relatórios
    -- de pedidos já entregues.
    IF LOWER(COALESCE(v_oc.status, '')) IN (
         'cancelado', 'cancelada', 'cancelled',
         'entregue', 'delivered',
         'finalizado', 'finalizada', 'finished', 'completed',
         'faturado', 'faturada', 'invoiced'
       ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.calculate_order_cost(
        v_oc.sale_order_id,
        v_oc.sale_order_item_id,
        true
      );
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Não aborta o backfill por causa de um pedido com dados
      -- inconsistentes (ficha técnica deletada, item órfão, etc).
      v_failed := v_failed + 1;
      RAISE WARNING 'Falhou ao recalcular order_cost para (%, %): %',
        v_oc.sale_order_id, v_oc.sale_order_item_id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill order_costs: % recalculados, % pulados (finalizados/cancelados), % falharam.',
    v_processed, v_skipped, v_failed;
END;
$$;
