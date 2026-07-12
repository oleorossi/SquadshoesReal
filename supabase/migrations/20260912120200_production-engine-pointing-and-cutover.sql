-- =============================================================================
-- REMODELAGEM PRODUÇÃO — PARTE 3/3: APONTAMENTO COM AVISOS CONFIRMÁVEIS + CUTOVER
--
-- 1) apontar_producao_setor v2 (R6.3): as regras de transição NUNCA travam —
--    avisam e exigem confirmação explícita, gravada com autoria no ledger.
--    Protocolo: chamada sem confirmação → se houver avisos, retorna
--    {success:false, needs_confirmation:true, warnings:[...]} SEM gravar; a UI
--    mostra o diálogo e re-chama com p_confirmed_warnings=['codigo',...].
--    Avisos:
--      • limite_setor_anterior — apontar mais do que o nível anterior do fluxo
--        entregou (toggle sector_settings.check_prev_sector_limit)
--      • material_nao_reservado — OP sem reserva ativa de material
--        (toggle sector_settings.check_material_reserved)
--      • acima_do_total — apontar além do total da OP (sempre avisa; ao
--        confirmar, o estágio é CLAMPADO no total e o ledger guarda o real)
--
-- 2) Cutover (R9): backfill de order_stages nas OPs abertas sem estágio,
--    popular production_queue com TODAS as OPs abertas (due_date da semana de
--    faturamento), desligar os gatilhos que criavam/gerenciavam ONDAS (fim de
--    escrita nova em production_waves — tabelas ficam como histórico), e
--    disparar o primeiro recálculo do motor.
-- =============================================================================

-- 1) apontar_producao_setor v2 ------------------------------------------------
DROP FUNCTION IF EXISTS public.apontar_producao_setor(uuid, text, integer, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.apontar_producao_setor(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_finalize boolean DEFAULT false,
  p_confirmed_warnings text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stage record;
  v_settings record;
  v_new_processed integer;
  v_stage_processed integer;
  v_finalize_result jsonb := NULL;
  v_warnings jsonb := '[]'::jsonb;
  v_unconfirmed text[] := '{}';
  v_raised text[] := '{}';
  v_prev_delivered integer;
  v_has_reservation boolean;
  v_w jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

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

  SELECT check_prev_sector_limit, check_material_reserved, parallel_group, flow_order
    INTO v_settings
    FROM public.sector_settings
   WHERE sector = CASE WHEN v_stage.stage_name = 'Mesa' THEN 'Aviamento' ELSE v_stage.stage_name END;

  -- ── Aviso: limite do setor anterior (só pra apontamento positivo) ──────────
  IF COALESCE(p_quantity, 0) > 0 AND COALESCE(v_settings.check_prev_sector_limit, true) THEN
    -- Entregue pelo NÍVEL anterior do fluxo desta OP (grupos paralelos = mesmo
    -- nível; estágio concluído conta como entrega total — setor pulado não trava).
    WITH op_stages AS (
      SELECT CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END AS sector,
             os.quantity_processed, os.quantity_total, os.status
      FROM order_stages os WHERE os.order_id = p_order_id
    ),
    leveled AS (
      SELECT s.*,
             dense_rank() OVER (ORDER BY COALESCE(g.grp_order, ss.flow_order)) AS level
      FROM op_stages s
      JOIN sector_settings ss ON ss.sector = s.sector
      LEFT JOIN (SELECT parallel_group, MIN(flow_order) AS grp_order
                   FROM sector_settings WHERE parallel_group IS NOT NULL GROUP BY 1) g
             ON g.parallel_group = ss.parallel_group
    ),
    me AS (
      SELECT level FROM leveled
      WHERE sector = CASE WHEN v_stage.stage_name = 'Mesa' THEN 'Aviamento' ELSE v_stage.stage_name END
      LIMIT 1
    )
    SELECT MIN(CASE WHEN l.status = 'concluido' THEN l.quantity_total
                    ELSE COALESCE(l.quantity_processed, 0) END)
      INTO v_prev_delivered
      FROM leveled l, me
     WHERE l.level = (SELECT MAX(l2.level) FROM leveled l2, me WHERE l2.level < me.level);

    IF v_prev_delivered IS NOT NULL AND v_new_processed > v_prev_delivered THEN
      v_raised := array_append(v_raised, 'limite_setor_anterior');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'limite_setor_anterior',
        'message', format('O setor anterior entregou só %s de %s pares — você está apontando %s no acumulado.',
                          v_prev_delivered, v_stage.quantity_total, v_new_processed),
        'delivered', v_prev_delivered);
    END IF;
  END IF;

  -- ── Aviso: material não reservado/debitado ─────────────────────────────────
  IF COALESCE(p_quantity, 0) > 0 AND COALESCE(v_settings.check_material_reserved, true) THEN
    SELECT EXISTS (
      SELECT 1 FROM material_reservations
      WHERE order_id = p_order_id AND status IN ('reserved','consumed','converted')
    ) INTO v_has_reservation;
    IF NOT v_has_reservation THEN
      v_raised := array_append(v_raised, 'material_nao_reservado');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'material_nao_reservado',
        'message', 'Esta OP não tem reserva ativa de material no estoque.');
    END IF;
  END IF;

  -- ── Aviso: acima do total da OP ────────────────────────────────────────────
  IF v_new_processed > v_stage.quantity_total THEN
    v_raised := array_append(v_raised, 'acima_do_total');
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'acima_do_total',
      'message', format('Apontamento excede o total da OP: %s já apontados + %s agora > %s pares. O estágio será limitado ao total; o ledger guarda o valor real.',
                        v_stage.quantity_processed, p_quantity, v_stage.quantity_total));
  END IF;

  -- ── Protocolo avisar+confirmar (R6.3): nada grava sem OK explícito ─────────
  SELECT COALESCE(array_agg(w), '{}') INTO v_unconfirmed
    FROM unnest(v_raised) w
   WHERE NOT (w = ANY (COALESCE(p_confirmed_warnings, '{}')));

  IF array_length(v_unconfirmed, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'needs_confirmation', true,
      'warnings', v_warnings,
      'stage_name', v_stage.stage_name,
      'quantity_processed', v_stage.quantity_processed,
      'quantity_total', v_stage.quantity_total
    );
  END IF;

  -- Estágio clampado no total (CHECK do banco); ledger guarda a quantidade real.
  v_stage_processed := LEAST(v_new_processed, v_stage.quantity_total);

  IF COALESCE(p_quantity, 0) <> 0 THEN
    INSERT INTO public.production_pointings
      (order_id, order_stage_id, stage_name, quantity, operator_employee_id, note, confirmed_warnings)
    VALUES
      (p_order_id, v_stage.id, v_stage.stage_name, p_quantity, p_operator_employee_id,
       NULLIF(trim(p_note), ''),
       CASE WHEN array_length(v_raised, 1) > 0 THEN v_raised ELSE NULL END);
  END IF;

  UPDATE public.order_stages
     SET quantity_processed = v_stage_processed,
         operator_employee_id = COALESCE(p_operator_employee_id, operator_employee_id),
         status = CASE WHEN status = 'pendente' THEN 'em_andamento' ELSE status END,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE id = v_stage.id;

  IF p_finalize THEN
    v_finalize_result := public.finalize_production_sector(
      p_order_id, v_stage.stage_name, v_stage_processed, p_operator_employee_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'stage_name', v_stage.stage_name,
    'quantity_processed', v_stage_processed,
    'quantity_total', v_stage.quantity_total,
    'finalized', p_finalize,
    'confirmed_warnings', CASE WHEN array_length(v_raised, 1) > 0 THEN to_jsonb(v_raised) ELSE NULL END,
    'finalize_result', v_finalize_result
  );
END;
$$;

-- 2) CUTOVER (R9) --------------------------------------------------------------

-- 2a) Backfill: OPs abertas SEM nenhum order_stage ganham o fluxo da ficha
--     (production_sectors) ou, na falta, o fluxo global ativo.
DO $$
DECLARE
  v_op record;
  v_sector text;
BEGIN
  FOR v_op IN
    SELECT o.id, o.quantity,
           (SELECT ts.production_sectors
              FROM products p
              JOIN technical_sheets ts ON lower(trim(ts.name)) = lower(trim(p.name))
             WHERE p.id = o.reference_id
             ORDER BY ts.updated_at DESC LIMIT 1) AS ficha_sectors
    FROM orders o
    WHERE o.deleted_at IS NULL
      AND o.status NOT IN ('Cancelada','Cancelado','Finalizado','Concluída',
                           'Faturado','Finalizado s/ NF','Rascunho')
      AND NOT EXISTS (SELECT 1 FROM order_stages os WHERE os.order_id = o.id)
  LOOP
    FOR v_sector IN
      SELECT CASE WHEN x.s = 'Mesa' THEN 'Aviamento' ELSE x.s END
      FROM (
        SELECT jsonb_array_elements_text(v_op.ficha_sectors) AS s
        WHERE v_op.ficha_sectors IS NOT NULL AND jsonb_array_length(v_op.ficha_sectors) > 0
        UNION ALL
        SELECT ss.sector FROM sector_settings ss
        WHERE (v_op.ficha_sectors IS NULL OR jsonb_array_length(v_op.ficha_sectors) = 0)
          AND ss.enabled
      ) x
      ORDER BY public.canonical_stage_order(CASE WHEN x.s = 'Mesa' THEN 'Aviamento' ELSE x.s END)
    LOOP
      INSERT INTO order_stages
        (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
      VALUES
        (v_op.id, v_sector, public.canonical_stage_order(v_sector), 'pendente',
         COALESCE(v_op.quantity, 0), 0)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 2b) Popular a fila com TODAS as OPs abertas (idempotente).
INSERT INTO public.production_queue (order_id, due_date, status)
SELECT o.id,
       public.resolve_op_due_date(o.id),
       CASE WHEN o.status = 'Em Produção' THEN 'em_producao' ELSE 'na_fila' END
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.status NOT IN ('Cancelada','Cancelado','Finalizado','Concluída',
                       'Faturado','Finalizado s/ NF','Rascunho')
ON CONFLICT (order_id) DO UPDATE
  SET due_date = EXCLUDED.due_date, status = EXCLUDED.status, updated_at = now();

-- 2c) Aposentar as ONDAS: derruba os gatilhos que criavam/sincronizavam waves.
--     Tabelas production_waves/* ficam intactas como histórico (leitura).
DO $$
DECLARE
  v_trg record;
BEGIN
  FOR v_trg IN
    SELECT t.tgname, c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_proc  f ON f.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND f.proname IN (
        'tg_auto_wave_on_sale_order_in_production',
        'tg_sale_order_autostart_wave',
        'trg_auto_assign_wave_on_sale_order',
        'trg_sync_wave_on_sale_order_items',
        'tg_remove_pv_from_waves_on_status_change',
        'tg_recalc_waves_on_capacity_change',
        'tg_waves_flag_late_creation',
        'tg_auto_cancel_empty_planning_wave',
        'trg_fn_block_rascunho_wave_assignment',
        'check_sale_order_single_active_wave',
        'fn_sync_wave_on_stage_complete',
        'fn_guard_wave_stage_transition',
        'fn_compute_wave_item_sort'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trg.tgname, v_trg.relname);
    RAISE NOTICE 'Gatilho de onda removido: %.%', v_trg.relname, v_trg.tgname;
  END LOOP;
END $$;

-- 2d) Primeiro recálculo do motor com a fila migrada.
SELECT public.recompute_production_schedule('cutover');
