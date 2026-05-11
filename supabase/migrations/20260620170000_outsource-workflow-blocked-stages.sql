-- =============================================================================
-- Centro de Controle de Produção — fluxo de terceirização com bloqueio de stage
-- =============================================================================
-- Quando uma OP entra em gargalo num setor (Costura, Aviamento, Corte) e a
-- decisão é terceirizar, criamos uma OS de terceirização vinculada à OP.
-- Enquanto a OS estiver pendente/em_andamento, o setor SEGUINTE da OP fica
-- bloqueado até a `service_date` (prazo dado pela costureira/terceirizado).
--
-- Mudanças:
--  1. service_orders.related_order_id   — FK pra orders (OP terceirizada)
--  2. service_orders.sector             — setor terceirizado (Costura/Aviamento/etc)
--  3. order_stages.blocked_until        — date; stage não inicia antes disso
--  4. order_stages.blocked_reason       — texto explicando o bloqueio (OS, etc)
--  5. Trigger AFTER UPDATE em service_orders:
--      - status='em_andamento' + service_date set → bloqueia próximo stage
--      - status='concluido' → libera bloqueio
--  6. finalize_production_sector: filtra stages com blocked_until > CURRENT_DATE
--     ao escolher próximo pendente (não inicia OP em stage bloqueada).
-- =============================================================================

-- ─── 1+2: Colunas em service_orders ─────────────────────────────────────────
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS related_order_id uuid
    REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sector text;

CREATE INDEX IF NOT EXISTS idx_service_orders_related_order_id
  ON public.service_orders (related_order_id);

COMMENT ON COLUMN public.service_orders.related_order_id IS
  'OP terceirizada (FK orders). Quando preenchido + sector + service_date, '
  'esta OS bloqueia o stage seguinte da OP via trigger.';
COMMENT ON COLUMN public.service_orders.sector IS
  'Setor terceirizado: Costura, Aviamento, Corte Palmilha, Corte Forração, etc.';

-- ─── 3+4: Colunas em order_stages ───────────────────────────────────────────
ALTER TABLE public.order_stages
  ADD COLUMN IF NOT EXISTS blocked_until date,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

CREATE INDEX IF NOT EXISTS idx_order_stages_blocked_until
  ON public.order_stages (blocked_until)
  WHERE blocked_until IS NOT NULL;

COMMENT ON COLUMN public.order_stages.blocked_until IS
  'Stage não pode ser iniciada antes desta data. Setado por trigger quando '
  'OS terceirizada (que cobre o setor anterior) está em_andamento com prazo.';

-- ─── 5: Trigger sincroniza bloqueio com OS terceirizada ─────────────────────
CREATE OR REPLACE FUNCTION public.tg_sync_op_block_on_outsource()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next_stage text;
  v_current_stage_order int;
BEGIN
  -- Só age se OS está vinculada a uma OP e tem setor declarado
  IF NEW.related_order_id IS NULL OR NEW.sector IS NULL THEN
    RETURN NEW;
  END IF;

  -- Caso 1: OS passou pra em_andamento E tem prazo → bloqueia próximo stage
  IF NEW.status = 'em_andamento'
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.service_date IS DISTINCT FROM NEW.service_date)
     AND NEW.service_date IS NOT NULL THEN

    -- Encontra stage_order do setor terceirizado
    SELECT stage_order INTO v_current_stage_order
      FROM public.order_stages
     WHERE order_id = NEW.related_order_id
       AND stage_name = NEW.sector
     LIMIT 1;

    IF v_current_stage_order IS NOT NULL THEN
      -- Próximo stage pendente após o setor terceirizado
      SELECT stage_name INTO v_next_stage
        FROM public.order_stages
       WHERE order_id = NEW.related_order_id
         AND stage_order > v_current_stage_order
         AND status = 'pendente'
       ORDER BY stage_order ASC
       LIMIT 1;

      IF v_next_stage IS NOT NULL THEN
        UPDATE public.order_stages
           SET blocked_until = NEW.service_date,
               blocked_reason = format(
                 'Aguardando OS terceirizada %s (%s) — prazo %s',
                 COALESCE(NEW.order_number, NEW.id::text),
                 NEW.sector,
                 to_char(NEW.service_date, 'DD/MM/YYYY')
               ),
               updated_at = now()
         WHERE order_id = NEW.related_order_id
           AND stage_name = v_next_stage;
      END IF;
    END IF;
  END IF;

  -- Caso 2: OS concluída → libera qualquer bloqueio referente a ela
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    UPDATE public.order_stages
       SET blocked_until = NULL,
           blocked_reason = NULL,
           updated_at = now()
     WHERE order_id = NEW.related_order_id
       AND blocked_reason ILIKE format('Aguardando OS terceirizada %s%%',
             COALESCE(NEW.order_number, NEW.id::text));
  END IF;

  -- Caso 3: OS cancelada → também libera (operador decide reverter)
  IF NEW.status IN ('cancelado', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.order_stages
       SET blocked_until = NULL,
           blocked_reason = NULL,
           updated_at = now()
     WHERE order_id = NEW.related_order_id
       AND blocked_reason ILIKE format('Aguardando OS terceirizada %s%%',
             COALESCE(NEW.order_number, NEW.id::text));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_op_block_on_outsource ON public.service_orders;
CREATE TRIGGER trg_sync_op_block_on_outsource
  AFTER UPDATE ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_op_block_on_outsource();

GRANT EXECUTE ON FUNCTION public.tg_sync_op_block_on_outsource() TO authenticated;

-- ─── 6: finalize_production_sector respeita blocked_until ───────────────────
-- Idêntica à versão atual (round 20260617130000), mas com filtro
--   AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE)
-- ao escolher próximo stage pendente.
CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id uuid,
  p_current_sector text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prep_sectors text[] := ARRAY['Corte Palmilha','Corte Forração','Aviamento'];
  v_is_prep boolean := p_current_sector = ANY(v_prep_sectors);
  v_all_prep_done boolean;
  v_pending_prep text[];
  v_next_sectors text[];
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  UPDATE public.order_stages
     SET status = 'concluido',
         completed_at = now(),
         updated_at = now()
   WHERE order_id = p_order_id
     AND stage_name = p_current_sector
     AND status <> 'concluido';

  IF v_is_prep THEN
    SELECT array_agg(stage_name)
      INTO v_pending_prep
      FROM public.order_stages
     WHERE order_id = p_order_id
       AND stage_name = ANY(v_prep_sectors)
       AND status <> 'concluido';

    v_all_prep_done := (v_pending_prep IS NULL OR array_length(v_pending_prep, 1) IS NULL);

    IF v_all_prep_done THEN
      v_next_sectors := ARRAY[
        (SELECT stage_name FROM public.order_stages
          WHERE order_id = p_order_id
            AND status = 'pendente'
            AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE)
          ORDER BY stage_order ASC
          LIMIT 1)
      ];
    ELSE
      v_next_sectors := ARRAY[]::text[];
    END IF;
  ELSE
    SELECT array_agg(stage_name)
      INTO v_next_sectors
      FROM (
        SELECT stage_name
          FROM public.order_stages
         WHERE order_id = p_order_id
           AND status = 'pendente'
           AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE)
         ORDER BY stage_order ASC
         LIMIT 1
      ) s;
  END IF;

  IF v_next_sectors IS NOT NULL AND array_length(v_next_sectors, 1) > 0 THEN
    UPDATE public.order_stages
       SET status = 'em_andamento',
           started_at = COALESCE(started_at, now()),
           updated_at = now()
     WHERE order_id = p_order_id
       AND stage_name = ANY(v_next_sectors)
       AND status = 'pendente';
  END IF;

  UPDATE public.orders o
     SET production_step = COALESCE(
           (SELECT s.stage_name
              FROM public.order_stages s
             WHERE s.order_id = o.id
               AND s.status = 'em_andamento'
             ORDER BY s.stage_order ASC
             LIMIT 1),
           o.production_step
         ),
         last_sector_finished_at = now(),
         status = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM public.order_stages s
              WHERE s.order_id = o.id
                AND s.status <> 'concluido'
           ) THEN 'Finalizado'
           ELSE o.status
         END,
         updated_at = now()
   WHERE o.id = p_order_id;

  v_result := jsonb_build_object(
    'success', true,
    'closed_sector', p_current_sector,
    'next_sectors', COALESCE(to_jsonb(v_next_sectors), '[]'::jsonb),
    'all_prep_done', v_all_prep_done
  );
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_production_sector(uuid, text) TO authenticated;
