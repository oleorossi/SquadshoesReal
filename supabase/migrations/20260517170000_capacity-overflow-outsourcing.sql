-- Sistema de transbordo de capacidade pra terceiros.
--
-- Quando demanda da onda excede capacidade do setor (utilization > 100%),
-- operador escolhe quais OPs joga pra cada terceirizado. Sistema cria
-- service_orders + marca as OPs como terceirizadas pra que o setor interno
-- saiba não processar (filtro no Kanban).
--
-- Decisões de design alinhadas com user (16/05/2026):
--  - TODOS os setores (não só cabedal/palmilha/costura)
--  - Threshold 100% (só quando estoura)
--  - Auto-detecta na criação da onda
--  - Operador SELECIONA item por item qual vai pra qual terceiro
--
-- Setores cobertos nesta versão: costura, mesa, corte_palmilha,
-- corte_forracao — os 4 que a view v_sector_bottlenecks já calcula.
-- Pra expandir (silk/colagem/montagem/solagem/acabamento) precisaria
-- adicionar capacity_per_day em technical_sheets pra cada um.

-- ── 1. Colunas em orders ──
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS outsourced_to_contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outsourced_sector text,
  ADD COLUMN IF NOT EXISTS outsourced_at timestamptz;

COMMENT ON COLUMN public.orders.outsourced_to_contractor_id IS
  'Terceiro pra quem essa OP foi transferida quando capacidade do setor estourou. Setor interno não processa OPs com esse campo preenchido (filtro no Kanban).';
COMMENT ON COLUMN public.orders.outsourced_sector IS
  'Qual setor foi terceirizado (costura/mesa/corte_palmilha/corte_forracao). OP segue na produção interna nos demais setores.';

CREATE INDEX IF NOT EXISTS idx_orders_outsourced_contractor
  ON public.orders(outsourced_to_contractor_id)
  WHERE outsourced_to_contractor_id IS NOT NULL;

-- ── 2. RPC: detectar OPs em setor estourado ──
-- Recebe lista de order_ids (OPs recém-criadas da onda) e retorna quais
-- estão em (setor, semana) onde utilization > 100%, ordenadas por setor.
DROP FUNCTION IF EXISTS public.detect_wave_capacity_overflow(uuid[]) CASCADE;
CREATE OR REPLACE FUNCTION public.detect_wave_capacity_overflow(
  p_order_ids uuid[]
) RETURNS TABLE(
  order_id uuid,
  order_number text,
  sale_order_id uuid,
  sheet_id uuid,
  sheet_name text,
  color text,
  quantity integer,
  sector text,
  week_start date,
  total_pairs_planned integer,
  total_capacity_week integer,
  utilization_pct integer,
  severity text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH overflowed_buckets AS (
    SELECT sector, week_start, total_pairs_planned, total_capacity_week,
           utilization_pct, severity
      FROM public.v_sector_bottlenecks
     WHERE utilization_pct > 100
  )
  SELECT
    sl.order_id,
    sl.order_number,
    sl.sale_order_id,
    sl.sheet_id,
    sl.sheet_name,
    sl.color,
    sl.quantity::integer,
    sl.sector,
    sl.week_start,
    ob.total_pairs_planned,
    ob.total_capacity_week,
    ob.utilization_pct,
    ob.severity
    FROM public.v_sector_weekly_load sl
    JOIN overflowed_buckets ob
      ON ob.sector = sl.sector
     AND ob.week_start = sl.week_start
   WHERE sl.order_id = ANY(p_order_ids)
     -- OPs já terceirizadas nesse setor não contam (evita re-oferecer)
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.id = sl.order_id
          AND o.outsourced_to_contractor_id IS NOT NULL
          AND o.outsourced_sector = sl.sector
     )
   ORDER BY sl.sector, ob.utilization_pct DESC, sl.quantity DESC;
$$;

GRANT EXECUTE ON FUNCTION public.detect_wave_capacity_overflow(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.detect_wave_capacity_overflow(uuid[]) IS
  'Lista OPs (do conjunto p_order_ids) que estão em (setor, semana) com utilization > 100%. Usado pelo WaveBuilder pra abrir o CapacityOverflowDialog após criar onda.';

-- ── 3. RPC: marcar OPs como terceirizadas em batch ──
-- Recebe array de tuplas (order_id, sector, contractor_id) e:
--   1. Atualiza orders.outsourced_to_contractor_id/_sector/_at
--   2. Cria 1 service_orders por entrada com setor + qty da OP no description
--   3. Retorna ids das service_orders criadas pro frontend invalidar caches
DROP FUNCTION IF EXISTS public.commit_capacity_overflow_outsourcing(jsonb) CASCADE;
CREATE OR REPLACE FUNCTION public.commit_capacity_overflow_outsourcing(
  p_assignments jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_order_id uuid;
  v_sector text;
  v_contractor_id uuid;
  v_order RECORD;
  v_contractor RECORD;
  v_os_id uuid;
  v_created_ids uuid[] := '{}';
  v_skipped text[] := '{}';
  v_processed integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'p_assignments deve ser array de {order_id, sector, contractor_id}';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_assignments) LOOP
    v_order_id := (v_item ->> 'order_id')::uuid;
    v_sector := v_item ->> 'sector';
    v_contractor_id := (v_item ->> 'contractor_id')::uuid;

    -- Pula entradas com contractor_id NULL (operador escolheu "manter interno")
    IF v_contractor_id IS NULL THEN CONTINUE; END IF;

    -- Lock e validação da OP
    SELECT id, order_number, reference_id, color, quantity, sale_order_id
      INTO v_order
      FROM public.orders
     WHERE id = v_order_id
       FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped := v_skipped || ('OP ' || v_order_id::text || ' não encontrada');
      CONTINUE;
    END IF;

    -- Valida contractor
    SELECT id, name INTO v_contractor
      FROM public.contractors WHERE id = v_contractor_id AND active = true;
    IF NOT FOUND THEN
      v_skipped := v_skipped || ('Contractor ' || v_contractor_id::text || ' inativo/inexistente');
      CONTINUE;
    END IF;

    -- Atualiza OP
    UPDATE public.orders
       SET outsourced_to_contractor_id = v_contractor_id,
           outsourced_sector = v_sector,
           outsourced_at = now()
     WHERE id = v_order_id;

    -- Cria service_order
    INSERT INTO public.service_orders (
      contractor_id, description, service_date, quantity, unit_price,
      total_value, status
    ) VALUES (
      v_contractor_id,
      format('Transbordo de capacidade — %s — OP %s (%s pares) ref/cor: %s',
             v_sector,
             v_order.order_number,
             v_order.quantity::text,
             COALESCE(v_order.color, '—')),
      CURRENT_DATE,
      v_order.quantity,
      0,
      0,
      'Pendente'
    )
    RETURNING id INTO v_os_id;

    v_created_ids := v_created_ids || v_os_id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'processed_count', v_processed,
    'created_service_order_ids', v_created_ids,
    'skipped', v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb) TO authenticated;

COMMENT ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb) IS
  'Aplica seleção do CapacityOverflowDialog: marca OPs como terceirizadas (outsourced_*) e cria service_orders correspondentes.';
