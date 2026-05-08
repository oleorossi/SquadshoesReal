-- =============================================================================
-- AUTO-RECÁLCULO DE CUSTOS DE PEDIDO
-- =============================================================================
-- User pediu: "Consegue deixar esse calcular custos de forma automática?"
--
-- Estratégia:
--   1. Coluna sale_orders.costs_dirty_at — marca quando algo muda que invalida
--      o snapshot em order_costs.
--   2. Triggers leves (apenas marcam dirty, não chamam o cálculo síncrono):
--      - sale_order_items INSERT/UPDATE/DELETE → marca o sale_order do item
--      - sale_orders UPDATE de total/status → marca o próprio
--      - technical_sheets UPDATE de campos de custo → marca todos os PVs ativos
--        que têm itens vinculados àquela ficha
--   3. Função process_dirty_order_costs() chama calculate_order_cost(persist=true)
--      pra cada PV dirty (em status que faz sentido — não pra Cancelado/Rascunho),
--      em batch. Defensiva contra erros: continua mesmo se um cálculo falha.
--   4. pg_cron job 'auto-cost-recalc' roda a cada minuto.
--
-- Sem loop: triggers só fazem UPDATE da flag (não chamam calculate_order_cost).
-- order_costs não tem trigger pro PV — sem feedback.
-- =============================================================================

-- ─── 1. Coluna costs_dirty_at em sale_orders ───────────────────────────────

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS costs_dirty_at timestamptz;

COMMENT ON COLUMN public.sale_orders.costs_dirty_at IS
  'Marca quando o cálculo de custo do PV ficou desatualizado. Populado por '
  'triggers em sale_order_items, sale_orders, technical_sheets. Limpado pela '
  'função process_dirty_order_costs após recálculo bem-sucedido.';

CREATE INDEX IF NOT EXISTS idx_sale_orders_costs_dirty
  ON public.sale_orders (costs_dirty_at)
  WHERE costs_dirty_at IS NOT NULL;

-- Backfill inicial: marca todos os PVs ativos como dirty pra que a primeira
-- rodada do cron preencha o cache pra todos.
UPDATE public.sale_orders
   SET costs_dirty_at = now()
 WHERE status NOT IN ('Cancelado', 'Cancelada', 'Rascunho')
   AND costs_dirty_at IS NULL;


-- ─── 2. Triggers que marcam dirty ──────────────────────────────────────────

-- 2a. sale_order_items: INSERT, UPDATE, DELETE
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so_id uuid;
BEGIN
  v_so_id := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  IF v_so_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.sale_orders
     SET costs_dirty_at = now()
   WHERE id = v_so_id
     AND status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_item ON public.sale_order_items;
CREATE TRIGGER trg_mark_so_costs_dirty_from_item
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_item();

-- 2b. sale_orders: UPDATE de total ou status (não dispara em UPDATE da própria
-- flag — checa via OLD/NEW pra evitar loop).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_self()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só marca se mudou algo que afeta cálculo: total, status (transição
  -- pra ativo), is_factoring, factoring_config_id.
  -- Importante: NÃO marca se a única mudança foi costs_dirty_at — evita
  -- recursão quando process_dirty_order_costs limpa a flag.
  IF NEW.status IN ('Cancelado', 'Cancelada', 'Rascunho') THEN
    -- PV cancelado/rascunho não recalcula
    RETURN NEW;
  END IF;
  IF (OLD.total IS DISTINCT FROM NEW.total)
     OR (OLD.status IS DISTINCT FROM NEW.status
         AND OLD.status IN ('Cancelado', 'Cancelada', 'Rascunho'))
     OR (OLD.is_factoring IS DISTINCT FROM NEW.is_factoring)
     OR (OLD.factoring_config_id IS DISTINCT FROM NEW.factoring_config_id) THEN
    NEW.costs_dirty_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_self ON public.sale_orders;
CREATE TRIGGER trg_mark_so_costs_dirty_self
  BEFORE UPDATE OF total, status, is_factoring, factoring_config_id
  ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_so_costs_dirty_self();

-- 2c. technical_sheets: UPDATE em campos relevantes pro custo
-- Marca todos os PVs ativos que têm sale_order_items.reference_id apontando
-- pra essa ficha. Trigger AFTER UPDATE — idempotente.
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Marca dirty todos os PVs ativos que usam esta ficha técnica.
  -- Não filtra campo a campo: qualquer UPDATE da ficha que chegue aqui
  -- (já filtrado pelos campos no CREATE TRIGGER) afeta o cálculo.
  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = NEW.id
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet ON public.technical_sheets;
CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
  AFTER UPDATE OF
    upper_material, upper_consumption, upper_consumption_per_size,
    lining_material, lining_consumption,
    insole_material, insole_consumption,
    sole_material, sole_consumption,
    components_accessories, lining_accessories, direct_components,
    custom_overhead, has_straps, strap_colors,
    assembly_time_minutes
  ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();


-- ─── 3. Processador em batch ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_dirty_order_costs(p_max_orders int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so RECORD;
  v_processed int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_started_at timestamptz := now();
BEGIN
  FOR v_so IN
    SELECT id, costs_dirty_at
      FROM public.sale_orders
     WHERE costs_dirty_at IS NOT NULL
       AND status NOT IN ('Cancelado', 'Cancelada', 'Rascunho')
     ORDER BY costs_dirty_at ASC
     LIMIT p_max_orders
  LOOP
    BEGIN
      -- Chama calculate_order_cost com persist=true (atualiza order_costs).
      -- p_sale_order_item_id NULL = recalcula PV inteiro.
      PERFORM public.calculate_order_cost(v_so.id, NULL, true);

      -- Limpa flag SE não foi remarcada por outro UPDATE durante o cálculo.
      -- Uso de costs_dirty_at = v_so.costs_dirty_at evita perder uma mudança
      -- que aconteceu no meio do recálculo.
      UPDATE public.sale_orders
         SET costs_dirty_at = NULL
       WHERE id = v_so.id
         AND costs_dirty_at = v_so.costs_dirty_at;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'sale_order_id', v_so.id,
        'error', SQLERRM
      );
      -- Não limpa a flag — vai re-tentar na próxima rodada do cron.
      -- Se ficar falhando indefinidamente, costs_dirty_at antigo serve
      -- de sinal pro operador investigar.
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'failed', v_failed,
    'failures', v_failures,
    'duration_ms', extract(epoch from (now() - v_started_at)) * 1000
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_dirty_order_costs(int) TO authenticated;


-- ─── 4. pg_cron job ────────────────────────────────────────────────────────

-- Remove job existente se houver (idempotência)
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'auto-cost-recalc';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END $$;

-- Schedule: a cada 1 minuto. Processa até 50 PVs por execução pra não
-- saturar o DB. Em caso de backlog, vai drenando.
SELECT cron.schedule(
  'auto-cost-recalc',
  '* * * * *',
  $cron$ SELECT public.process_dirty_order_costs(50); $cron$
);

COMMENT ON FUNCTION public.process_dirty_order_costs(int) IS
  'Processa fila de PVs com costs_dirty_at != NULL chamando calculate_order_cost. '
  'Roda automaticamente via pg_cron a cada minuto (job auto-cost-recalc). '
  'Pode ser invocada manualmente via RPC pra recálculo sob demanda.';
