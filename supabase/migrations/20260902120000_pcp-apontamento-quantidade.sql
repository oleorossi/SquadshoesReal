-- ============================================================================
-- PCP — Apontamento de quantidade setor-a-setor (auditoria 2026-07-01)
--
-- Problemas fechados por esta migration:
--  1. finalize_production_sector deixou de preencher quantity_processed nas
--     recriações 20260617130000/20260620170000 (regressão vs 20260508140000) —
--     1.053 estágios concluídos ficaram com quantidade 0.
--  2. Não existia ledger de apontamentos: quantity_processed era um único
--     acumulador sobrescritível, sem quem/quanto/quando.
--  3. O caminho que grava quantidade (dialog, UPDATE direto) não move a OP;
--     o caminho que move (RPC finalize) ignora quantidade e operário.
--  4. Sem CHECK: processed podia ser negativo ou exceder o total.
--  5. Grafia dupla 'Mesa'/'Aviamento': resync_op_atomic ainda gravava 'Mesa'
--     (e o fallback nem tinha 'Costura'); telas filtram literal 'Aviamento'.
--  6. Guard de início exigia pré-requisito 100% concluído — agora libera fluxo
--     parcial: basta o pré-requisito ter produção apontada (>0 pares).
--  7. production_wave_stages.produced_quantity nunca era preenchida (0/124).
--
-- Contrato novo:
--  • production_pointings = ledger imutável (append-only) de apontamentos.
--  • apontar_producao_setor(order, setor, qtd, operário?, nota?, finalizar?)
--    = RPC canônica: incrementa quantidade, inicia o setor se pendente
--    (respeitando o DAG do guard), grava ledger e — se finalizar — delega à
--    finalize_production_sector (que resolve o próximo setor).
--  • finalize_production_sector ganha p_quantity_processed/p_operator:
--    NULL → assume OP inteira quando ninguém apontou (comportamento
--    pré-regressão do bulk); valor explícito → respeita parcial.
-- ============================================================================

-- 1) Ledger de apontamentos ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_pointings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_stage_id       uuid NOT NULL REFERENCES public.order_stages(id) ON DELETE CASCADE,
  stage_name           text NOT NULL,
  -- Positivo = produção; negativo = correção/estorno (sempre via RPC).
  quantity             integer NOT NULL CHECK (quantity <> 0),
  operator_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  note                 text,
  created_by           uuid DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_pointings_order   ON public.production_pointings(order_id);
CREATE INDEX IF NOT EXISTS idx_production_pointings_stage   ON public.production_pointings(order_stage_id);
CREATE INDEX IF NOT EXISTS idx_production_pointings_created ON public.production_pointings(created_at DESC);

ALTER TABLE public.production_pointings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_production_pointings ON public.production_pointings;
CREATE POLICY approved_select_production_pointings
  ON public.production_pointings FOR SELECT
  USING (public.is_approved_user());
-- Sem policy de INSERT/UPDATE/DELETE: escrita só via RPC (SECURITY DEFINER),
-- mantendo o ledger append-only do ponto de vista do cliente.

-- 2) Higiene de grafia: Mesa → Aviamento (0 rows hoje; trava reincidência) ---
UPDATE public.order_stages
   SET stage_name = 'Aviamento', updated_at = now()
 WHERE stage_name = 'Mesa';

-- 3) Backfill da regressão: concluído sem quantidade = OP inteira ------------
UPDATE public.order_stages
   SET quantity_processed = quantity_total, updated_at = now()
 WHERE status = 'concluido'
   AND COALESCE(quantity_processed, 0) = 0
   AND quantity_total > 0;

-- 4) Backfill de orders.production_step (234/238 paradas em 'Pendente') ------
-- Regra: setor em andamento mais cedo; se tudo concluído, o último setor.
-- OPs com estágios mas nada iniciado mantêm 'Pendente' (semântica correta).
UPDATE public.orders o
   SET production_step = sub.step, updated_at = now()
  FROM (
    SELECT o2.id,
           COALESCE(
             (SELECT s.stage_name FROM public.order_stages s
               WHERE s.order_id = o2.id AND s.status = 'em_andamento'
               ORDER BY s.stage_order LIMIT 1),
             CASE WHEN NOT EXISTS (SELECT 1 FROM public.order_stages s
                                    WHERE s.order_id = o2.id AND s.status <> 'concluido')
                  THEN (SELECT s.stage_name FROM public.order_stages s
                         WHERE s.order_id = o2.id
                         ORDER BY s.stage_order DESC LIMIT 1) END
           ) AS step
      FROM public.orders o2
     WHERE EXISTS (SELECT 1 FROM public.order_stages s WHERE s.order_id = o2.id)
  ) sub
 WHERE o.id = sub.id
   AND sub.step IS NOT NULL
   AND o.production_step IS DISTINCT FROM sub.step;

-- 5) Integridade: 0 ≤ processed ≤ total (dados já limpos — 0 violações) ------
ALTER TABLE public.order_stages DROP CONSTRAINT IF EXISTS chk_order_stages_qty_bounds;
ALTER TABLE public.order_stages
  ADD CONSTRAINT chk_order_stages_qty_bounds
  CHECK (quantity_processed >= 0 AND quantity_processed <= quantity_total);

-- 6) Guard de início: libera fluxo PARCIAL ------------------------------------
-- Pré-requisito satisfeito se concluído OU se já apontou produção (>0 pares).
-- Reflete a fábrica real: Colagem pode começar nos pares que a Costura já
-- entregou, sem esperar a OP inteira.
CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_required text[];
  v_blocking text;
  v_blocking_status text;
BEGIN
  -- Só interessa pendente → em_andamento.
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  -- DAG de pré-requisitos por NOME de setor (alinhado ao fluxo industrial real).
  v_required := CASE NEW.stage_name
    -- Setores prep — paralelos, podem iniciar em qualquer ordem.
    WHEN 'Corte Palmilha' THEN ARRAY[]::text[]
    WHEN 'Corte Forração' THEN ARRAY[]::text[]
    WHEN 'Aviamento'      THEN ARRAY[]::text[]
    WHEN 'Mesa'           THEN ARRAY[]::text[]   -- legacy = Aviamento
    WHEN 'Silk'           THEN ARRAY[]::text[]
    WHEN 'Costura'        THEN ARRAY[]::text[]
    -- Setores sequenciais.
    WHEN 'Colagem'        THEN ARRAY['Corte Palmilha','Costura']
    WHEN 'Montagem'       THEN ARRAY['Colagem']
    WHEN 'Solagem'        THEN ARRAY['Montagem']
    WHEN 'Acabamento'     THEN ARRAY['Solagem']
    WHEN 'Expedição'      THEN ARRAY['Acabamento']
    -- Setor desconhecido (legacy não mapeado): libera.
    ELSE NULL
  END;

  IF v_required IS NULL OR cardinality(v_required) = 0 THEN
    RETURN NEW;
  END IF;

  -- Bloqueia só se o pré-requisito não concluiu E não apontou nenhum par.
  SELECT stage_name, status
    INTO v_blocking, v_blocking_status
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_name = ANY(v_required)
    AND status <> 'concluido'
    AND COALESCE(quantity_processed, 0) = 0
  LIMIT 1;

  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor pré-requisito "%" ainda não produziu nenhum par (status atual: %).',
      NEW.stage_name, v_blocking, v_blocking_status;
  END IF;

  RETURN NEW;
END;
$function$;

-- 7) finalize_production_sector v3: volta a preencher quantidade + operário --
-- DROP obrigatório: adicionar params com DEFAULT criaria um segundo overload
-- e o PostgREST falharia com "ambiguous function".
DROP FUNCTION IF EXISTS public.finalize_production_sector(uuid, text);

CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id uuid,
  p_current_sector text,
  p_quantity_processed integer DEFAULT NULL,
  p_operator_employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF p_quantity_processed IS NOT NULL AND p_quantity_processed < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida: % (deve ser ≥ 0)', p_quantity_processed;
  END IF;

  UPDATE public.order_stages
     SET status = 'concluido',
         -- Regra de quantidade na conclusão:
         --   valor explícito → respeita (apontamento parcial consciente);
         --   ninguém apontou (0) → assume OP inteira (pré-regressão);
         --   já havia apontamento → mantém o acumulado.
         quantity_processed = CASE
           WHEN p_quantity_processed IS NOT NULL THEN LEAST(p_quantity_processed, quantity_total)
           WHEN COALESCE(quantity_processed, 0) = 0 THEN quantity_total
           ELSE quantity_processed
         END,
         operator_employee_id = COALESCE(p_operator_employee_id, operator_employee_id),
         completed_by = COALESCE(completed_by, auth.uid()),
         started_at = COALESCE(started_at, now()),
         completed_at = now(),
         updated_at = now()
   WHERE order_id = p_order_id AND stage_name = p_current_sector AND status <> 'concluido';

  IF v_is_prep THEN
    SELECT array_agg(stage_name) INTO v_pending_prep FROM public.order_stages
     WHERE order_id = p_order_id AND stage_name = ANY(v_prep_sectors) AND status <> 'concluido';

    v_all_prep_done := (v_pending_prep IS NULL OR array_length(v_pending_prep, 1) IS NULL);

    IF v_all_prep_done THEN
      v_next_sectors := ARRAY[(
        SELECT stage_name FROM public.order_stages
         WHERE order_id = p_order_id AND status = 'pendente'
           AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE)
         ORDER BY stage_order ASC LIMIT 1
      )];
    ELSE
      v_next_sectors := ARRAY[]::text[];
    END IF;
  ELSE
    SELECT array_agg(stage_name) INTO v_next_sectors FROM (
      SELECT stage_name FROM public.order_stages
       WHERE order_id = p_order_id AND status = 'pendente'
         AND (blocked_until IS NULL OR blocked_until <= CURRENT_DATE)
       ORDER BY stage_order ASC LIMIT 1
    ) s;
  END IF;

  IF v_next_sectors IS NOT NULL AND array_length(v_next_sectors, 1) > 0 THEN
    UPDATE public.order_stages
       SET status = 'em_andamento', started_at = COALESCE(started_at, now()), updated_at = now()
     WHERE order_id = p_order_id AND stage_name = ANY(v_next_sectors) AND status = 'pendente';
  END IF;

  UPDATE public.orders o
     SET production_step = COALESCE((SELECT s.stage_name FROM public.order_stages s
           WHERE s.order_id = o.id AND s.status = 'em_andamento'
           ORDER BY s.stage_order ASC LIMIT 1), o.production_step),
         last_sector_finished_at = now(),
         status = CASE WHEN NOT EXISTS (SELECT 1 FROM public.order_stages s
           WHERE s.order_id = o.id AND s.status <> 'concluido')
           THEN 'Finalizado' ELSE o.status END,
         updated_at = now()
   WHERE o.id = p_order_id;

  v_result := jsonb_build_object('success', true, 'closed_sector', p_current_sector,
    'next_sectors', COALESCE(to_jsonb(v_next_sectors), '[]'::jsonb), 'all_prep_done', v_all_prep_done);
  RETURN v_result;
END;
$function$;

-- 8) RPC canônica de apontamento ----------------------------------------------
CREATE OR REPLACE FUNCTION public.apontar_producao_setor(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_finalize boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage record;
  v_new_processed integer;
  v_finalize_result jsonb := NULL;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Resolve a linha do estágio (com alias legacy Mesa ⇄ Aviamento) e trava.
  SELECT id, stage_name, status, quantity_processed, quantity_total
    INTO v_stage
    FROM public.order_stages
   WHERE order_id = p_order_id
     AND (stage_name = p_stage_name
          OR (p_stage_name = 'Aviamento' AND stage_name = 'Mesa')
          OR (p_stage_name = 'Mesa' AND stage_name = 'Aviamento'))
   ORDER BY (stage_name = p_stage_name) DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Setor "%" não existe nesta OP.', p_stage_name;
  END IF;

  IF v_stage.status = 'concluido' THEN
    RAISE EXCEPTION 'Setor "%" já está concluído — apontamento bloqueado.', v_stage.stage_name;
  END IF;

  v_new_processed := COALESCE(v_stage.quantity_processed, 0) + COALESCE(p_quantity, 0);

  IF v_new_processed < 0 THEN
    RAISE EXCEPTION 'Correção inválida: quantidade acumulada ficaria negativa (% pares).', v_new_processed;
  END IF;

  IF v_new_processed > v_stage.quantity_total THEN
    RAISE EXCEPTION 'Apontamento excede o total da OP: % já apontados + % agora > % pares.',
      v_stage.quantity_processed, p_quantity, v_stage.quantity_total;
  END IF;

  -- Ledger imutável (só quando há quantidade de fato).
  IF COALESCE(p_quantity, 0) <> 0 THEN
    INSERT INTO public.production_pointings
      (order_id, order_stage_id, stage_name, quantity, operator_employee_id, note)
    VALUES
      (p_order_id, v_stage.id, v_stage.stage_name, p_quantity, p_operator_employee_id, NULLIF(trim(p_note), ''));
  END IF;

  -- Atualiza acumulado; se pendente, inicia (o guard do DAG valida e pode abortar).
  UPDATE public.order_stages
     SET quantity_processed = v_new_processed,
         operator_employee_id = COALESCE(p_operator_employee_id, operator_employee_id),
         status = CASE WHEN status = 'pendente' THEN 'em_andamento' ELSE status END,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE id = v_stage.id;

  IF p_finalize THEN
    v_finalize_result := public.finalize_production_sector(
      p_order_id, v_stage.stage_name, v_new_processed, p_operator_employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'stage_name', v_stage.stage_name,
    'quantity_processed', v_new_processed,
    'quantity_total', v_stage.quantity_total,
    'finalized', p_finalize,
    'finalize_result', v_finalize_result
  );
END;
$function$;

-- 9) resync_op_atomic: fallback com grafia canônica (Mesa→Aviamento) + Costura
--    (recriação integral; único diff é o array de fallback dos setores)
CREATE OR REPLACE FUNCTION public.resync_op_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_op record;
  v_mov record;
  v_prev_stock numeric;
  v_new_stock numeric;
  v_grade jsonb;
  v_status text;
  v_errors text[] := '{}';
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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
    RETURN jsonb_build_object('skipped', true, 'reason', 'OP not active', 'status', v_op.status);
  END IF;

  v_grade := COALESCE(v_op.grade, '{}'::jsonb);

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

  UPDATE public.production_consumptions
     SET superseded_at = now(),
         superseded_reason = 'resync_op_atomic'
   WHERE order_id = p_order_id
     AND superseded_at IS NULL;

  DELETE FROM public.material_reservations WHERE order_id = p_order_id;
  DELETE FROM public.order_stages WHERE order_id = p_order_id;

  IF v_op.sale_order_id IS NOT NULL THEN
    DELETE FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_op.sale_order_id;
  END IF;

  UPDATE public.stock_movements
     SET order_id = NULL
   WHERE order_id = p_order_id
     AND movement_type = 'out';

  BEGIN
    PERFORM public.restore_sole_grade_for_order(p_order_id);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  PERFORM public.hybrid_debit_stock_for_order(
    v_op.reference_id,
    v_op.quantity,
    COALESCE(v_op.color, ''),
    p_order_id,
    CASE WHEN v_grade <> '{}'::jsonb THEN v_grade ELSE NULL END
  );

  IF v_grade <> '{}'::jsonb THEN
    BEGIN
      PERFORM public.debit_sole_stock_by_grade(
        v_op.reference_id, p_order_id, COALESCE(v_op.color, ''), v_grade
      );
    EXCEPTION WHEN undefined_function THEN
      NULL;
    END;
  END IF;

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
          ARRAY['Corte Palmilha','Corte Forração','Costura','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
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
$function$;

-- 10) sync_wave_from_kanban: passa a preencher produced_quantity --------------
--     (recriação integral; diff = UPDATE de produced_quantity por estágio)
CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec            RECORD;
  v_total_orders   int;
  v_done_orders    int;
  v_produced       int;
  v_new_current    production_stage_enum;
  v_now            timestamptz := now();
BEGIN
  -- Total de OPs ativas na onda
  SELECT COUNT(DISTINCT o.id)
    INTO v_total_orders
    FROM production_wave_items pwi
    JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
    JOIN orders o ON o.sale_order_id = pwis.sale_order_id
   WHERE pwi.wave_id = p_wave_id
     AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado');

  IF v_total_orders = 0 THEN
    RETURN NULL;
  END IF;

  -- Percorre estágios ordenados por nível
  FOR v_rec IN
    SELECT pws.stage, stage_order(pws.stage) AS lvl, pws.status AS cur_status
      FROM production_wave_stages pws
     WHERE pws.wave_id = p_wave_id
     ORDER BY stage_order(pws.stage), pws.stage
  LOOP
    -- Conta OPs que possuem ALGUM setor do Kanban correspondente como 'concluido'
    SELECT COUNT(DISTINCT o.id)
      INTO v_done_orders
      FROM production_wave_items pwi
      JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN orders o ON o.sale_order_id = pwis.sale_order_id
     WHERE pwi.wave_id = p_wave_id
       AND o.status NOT IN ('Cancelada', 'cancelada', 'Finalizado', 'finalizado')
       AND EXISTS (
         SELECT 1
           FROM order_stages os
          WHERE os.order_id = o.id
            AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_rec.stage))
            AND os.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       );

    -- Pares realmente apontados nesse estágio (soma das OPs da onda)
    SELECT COALESCE(SUM(os.quantity_processed), 0)
      INTO v_produced
      FROM production_wave_items pwi
      JOIN production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN orders o ON o.sale_order_id = pwis.sale_order_id
      JOIN order_stages os ON os.order_id = o.id
     WHERE pwi.wave_id = p_wave_id
       AND o.status NOT IN ('Cancelada', 'cancelada')
       AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_rec.stage));

    UPDATE production_wave_stages
       SET produced_quantity = v_produced,
           updated_at = v_now
     WHERE wave_id = p_wave_id
       AND stage = v_rec.stage
       AND COALESCE(produced_quantity, -1) <> v_produced;

    IF v_done_orders >= v_total_orders THEN
      -- Todos concluídos → marca wave_stage como completed
      UPDATE production_wave_stages
         SET status      = 'completed',
             finished_at = COALESCE(finished_at, v_now),
             progress_pct = 100,
             updated_at  = v_now
       WHERE wave_id = p_wave_id
         AND stage = v_rec.stage
         AND status <> 'completed';
    ELSE
      -- Primeiro estágio não totalmente concluído → current
      IF v_new_current IS NULL THEN
        v_new_current := v_rec.stage;

        -- Calcula progresso parcial
        UPDATE production_wave_stages
           SET status      = 'in_progress',
               started_at  = COALESCE(started_at, v_now),
               progress_pct = CASE WHEN v_total_orders > 0
                                   THEN round((v_done_orders::numeric / v_total_orders) * 100)
                                   ELSE 0 END,
               updated_at  = v_now
         WHERE wave_id = p_wave_id
           AND stage = v_rec.stage
           AND status <> 'completed';  -- não regride estágio já concluído
      END IF;
    END IF;
  END LOOP;

  -- Atualiza current_stage na onda
  IF v_new_current IS NULL THEN
    -- Todos os estágios finalizados
    UPDATE production_waves
       SET status      = 'finished',
           current_stage = NULL,
           finished_at = COALESCE(finished_at, v_now)
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  ELSE
    UPDATE production_waves
       SET current_stage = v_new_current,
           status        = 'running'
     WHERE id = p_wave_id
       AND status NOT IN ('finished', 'cancelled');
  END IF;

  RETURN v_new_current;
END;
$function$;
