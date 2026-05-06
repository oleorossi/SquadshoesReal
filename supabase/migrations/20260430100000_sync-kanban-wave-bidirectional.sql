-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ SYNC BIDIRECIONAL — Kanban (order_stages) ↔ Ondas (production_wave_stages) ║
-- ║                                                                            ║
-- ║ Problema: os dois sistemas rastreavam estágio de forma independente.       ║
-- ║  · Kanban usa order_stages (por OP individual, nomes em PT)                ║
-- ║  · Ondas usa production_wave_stages (por onda, enum production_stage_enum) ║
-- ║                                                                            ║
-- ║ Esta migration adiciona:                                                   ║
-- ║  1. wave_stage_to_kanban_stages()  — mapeamento enum → array de nomes     ║
-- ║  2. kanban_stage_to_wave_stage()   — mapeamento nome → enum               ║
-- ║  3. sync_wave_from_kanban()        — re-deriva estágio da onda a partir    ║
-- ║     do progresso real das OPs no Kanban                                    ║
-- ║  4. fn_sync_wave_on_stage_complete() + trigger — ao concluir um setor no   ║
-- ║     Kanban, tenta auto-avançar a onda correspondente                       ║
-- ║  5. advance_wave_stage() atualizado — além de avançar a onda,             ║
-- ║     marca os order_stages correspondentes como concluido                   ║
-- ╚════════════════════════════════════════════════════════════════════════════╝

-- ── 1. Mapeamento: estágio da onda → nomes de setores no Kanban ──────────────
-- Nomes em lowercase para comparação case-insensitive.
CREATE OR REPLACE FUNCTION public.wave_stage_to_kanban_stages(s production_stage_enum)
RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN ARRAY['corte']
    WHEN 'palmilha'   THEN ARRAY['palmilha']
    WHEN 'costura'    THEN ARRAY['costura','forração','forro','forra','aviamento','silk','serigrafia','silkscreen']
    WHEN 'montagem'   THEN ARRAY['montagem','colagem']
    WHEN 'solagem'    THEN ARRAY['solagem']
    WHEN 'mesa'       THEN ARRAY['mesa']
    WHEN 'acabamento' THEN ARRAY['acabamento','expedição','expedicao']
    ELSE              ARRAY[]::text[]
  END;
$$;

GRANT EXECUTE ON FUNCTION public.wave_stage_to_kanban_stages(production_stage_enum) TO authenticated;

-- ── 2. Mapeamento: nome de setor do Kanban → estágio da onda ─────────────────
CREATE OR REPLACE FUNCTION public.kanban_stage_to_wave_stage(p_stage_name text)
RETURNS production_stage_enum
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(trim(p_stage_name))
    WHEN 'corte'       THEN 'corte'::production_stage_enum
    WHEN 'palmilha'    THEN 'palmilha'::production_stage_enum
    WHEN 'costura'     THEN 'costura'::production_stage_enum
    WHEN 'forração'    THEN 'costura'::production_stage_enum
    WHEN 'forro'       THEN 'costura'::production_stage_enum
    WHEN 'forra'       THEN 'costura'::production_stage_enum
    WHEN 'aviamento'   THEN 'costura'::production_stage_enum
    WHEN 'silk'        THEN 'costura'::production_stage_enum
    WHEN 'serigrafia'  THEN 'costura'::production_stage_enum
    WHEN 'silkscreen'  THEN 'costura'::production_stage_enum
    WHEN 'colagem'     THEN 'montagem'::production_stage_enum
    WHEN 'montagem'    THEN 'montagem'::production_stage_enum
    WHEN 'solagem'     THEN 'solagem'::production_stage_enum
    WHEN 'mesa'        THEN 'mesa'::production_stage_enum
    WHEN 'acabamento'  THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'   THEN 'acabamento'::production_stage_enum
    WHEN 'expedicao'   THEN 'acabamento'::production_stage_enum
    ELSE NULL
  END;
$$;

GRANT EXECUTE ON FUNCTION public.kanban_stage_to_wave_stage(text) TO authenticated;

-- ── 3. sync_wave_from_kanban: re-deriva estágio da onda a partir de order_stages ──
-- Para cada estágio da onda (em ordem de nível), verifica se TODAS as OPs da onda
-- têm o(s) setor(es) correspondente(s) do Kanban como 'concluido'.
-- Se sim → marca o wave_stage como 'completed'.
-- Primeiro wave_stage não concluído → 'in_progress' e define current_stage.
-- Retorna o novo current_stage (NULL se onda finalizada).
CREATE OR REPLACE FUNCTION public.sync_wave_from_kanban(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec            RECORD;
  v_total_orders   int;
  v_done_orders    int;
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
$$;

GRANT EXECUTE ON FUNCTION public.sync_wave_from_kanban(uuid) TO authenticated;

-- ── 4. Trigger: quando um order_stage é concluído, tenta sincronizar a onda ──
CREATE OR REPLACE FUNCTION public.fn_sync_wave_on_stage_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
BEGIN
  -- Só dispara quando status muda PARA concluido
  IF NEW.status NOT IN ('concluido', 'concluído', 'completed', 'done', 'pronto') THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto') THEN
    RETURN NEW; -- sem mudança real
  END IF;

  -- Descobre se esta OP pertence a uma onda ativa
  SELECT DISTINCT pwi.wave_id
    INTO v_wave_id
    FROM orders o
    JOIN production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN production_wave_items pwi         ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw               ON pw.id = pwi.wave_id
   WHERE o.id = NEW.order_id
     AND pw.status = 'running'
   LIMIT 1;

  IF v_wave_id IS NOT NULL THEN
    PERFORM sync_wave_from_kanban(v_wave_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_wave_on_stage_complete ON public.order_stages;
CREATE TRIGGER trg_sync_wave_on_stage_complete
  AFTER UPDATE OF status ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_wave_on_stage_complete();

-- ── 5. advance_wave_stage: também atualiza order_stages ao avançar a onda ────
-- Aceita p_stage opcional para avançar um setor específico (ex.: mesa paralela).
-- Mantém compatibilidade retroativa com chamadas sem p_stage.
CREATE OR REPLACE FUNCTION public.advance_wave_stage(
  p_wave_id uuid,
  p_stage   production_stage_enum DEFAULT NULL
)
RETURNS production_stage_enum
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current   production_stage_enum;
  v_target    production_stage_enum;
  v_next      production_stage_enum;
  v_now       timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Lock pessimista na onda
  SELECT current_stage
    INTO v_current
    FROM production_waves
   WHERE id = p_wave_id
     FOR UPDATE;

  IF v_current IS NULL AND p_stage IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  -- Estágio a avançar: explícito ou atual
  v_target := COALESCE(p_stage, v_current);

  -- Marca o estágio da onda como concluído
  UPDATE production_wave_stages
     SET status      = 'completed',
         finished_at = COALESCE(finished_at, v_now),
         progress_pct = 100,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_target;

  -- Também marca os order_stages correspondentes do Kanban como concluido
  -- para todas as OPs desta onda (Wave → Kanban sync)
  UPDATE order_stages os
     SET status           = 'concluido',
         completed_at     = COALESCE(os.completed_at, v_now),
         quantity_processed = os.quantity_total
    FROM orders o
    JOIN production_wave_item_sources pwis ON pwis.sale_order_id = o.sale_order_id
    JOIN production_wave_items pwi         ON pwi.id = pwis.wave_item_id
   WHERE pwi.wave_id = p_wave_id
     AND os.order_id  = o.id
     AND lower(trim(os.stage_name)) = ANY(wave_stage_to_kanban_stages(v_target))
     AND os.status NOT IN ('concluido', 'concluído', 'completed', 'done');

  -- Determina próximo estágio (pelo nível: todos do nível atual precisam estar completos)
  -- Se o estágio avançado tem irmãos no mesmo nível ainda pendentes, não avança o current_stage
  IF EXISTS (
    SELECT 1
      FROM production_wave_stages
     WHERE wave_id = p_wave_id
       AND stage_order(stage) = stage_order(v_target)
       AND status <> 'completed'
       AND stage <> v_target
  ) THEN
    -- Há outros estágios no mesmo nível ainda em andamento; não muda current_stage
    RETURN v_current;
  END IF;

  -- Todos os estágios do nível atual concluídos → avança para o próximo nível
  SELECT pws.stage
    INTO v_next
    FROM production_wave_stages pws
   WHERE pws.wave_id = p_wave_id
     AND stage_order(pws.stage) = stage_order(v_target) + 1
     AND pws.status <> 'completed'
   ORDER BY pws.stage
   LIMIT 1;

  IF v_next IS NULL THEN
    -- Todos os níveis concluídos → finaliza a onda
    IF NOT EXISTS (
      SELECT 1
        FROM production_wave_stages
       WHERE wave_id = p_wave_id
         AND status <> 'completed'
    ) THEN
      UPDATE production_waves
         SET status      = 'finished',
             finished_at = v_now,
             current_stage = NULL
       WHERE id = p_wave_id;
      RETURN NULL;
    END IF;
    RETURN v_current;
  END IF;

  -- Inicia o próximo estágio
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = COALESCE(started_at, v_now),
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND stage   = v_next;

  UPDATE production_waves
     SET current_stage = v_next
   WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid, production_stage_enum) TO authenticated;
-- Mantém assinatura original (sem p_stage) para retrocompatibilidade
GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid) TO authenticated;
