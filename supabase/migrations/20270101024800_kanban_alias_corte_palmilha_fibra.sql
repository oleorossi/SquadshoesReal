-- Corte Palmilha continua em 305 order_stages / 45 fichas / 748 linhas de
-- agenda, mas sector_settings só tem a coluna "Corte Fibra". No Kanban o card
-- caía numa coluna fantasma (flow_order 999, depois da Expedição) e o nível
-- paralelo do corte não casava — apontar o primeiro setor virava pulo até
-- Expedição. O cliente agora aliasa a grafia; aqui alinhamos o dado e o lookup
-- da RPC pra o mesmo contrato de canonical_stage_name.
--
-- order_stages tem a trava `tg_enforce_order_stage_command_boundary`.
-- Fichas aposentadas são imutáveis. production_schedule enfileira tira.
-- O backfill só troca grafia (Palmilha→Fibra); replica role nesta
-- transação evita os gatilhos de comando/imutalidade/fila.

SELECT set_config('app.order_stage_command_internal', '1', true);
SET LOCAL session_replication_role = replica;

UPDATE public.order_stages os
   SET stage_name = 'Corte Fibra',
       updated_at = now()
 WHERE os.stage_name = 'Corte Palmilha'
   AND NOT EXISTS (
     SELECT 1
       FROM public.order_stages other
      WHERE other.order_id = os.order_id
        AND other.stage_name = 'Corte Fibra'
   );

UPDATE public.production_pointings
   SET stage_name = 'Corte Fibra'
 WHERE stage_name = 'Corte Palmilha';

UPDATE public.production_schedule
   SET sector = 'Corte Fibra'
 WHERE sector = 'Corte Palmilha';

UPDATE public.technical_sheets ts
   SET production_sectors = (
         SELECT jsonb_agg(
                  CASE WHEN elem = 'Corte Palmilha' THEN 'Corte Fibra' ELSE elem END
                  ORDER BY ordinality
                )
           FROM jsonb_array_elements_text(ts.production_sectors)
                WITH ORDINALITY AS t(elem, ordinality)
       ),
       updated_at = now()
 WHERE ts.production_sectors IS NOT NULL
   AND ts.production_sectors::text LIKE '%Corte Palmilha%';

SET LOCAL session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION public.apontar_producao_setor_impl(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_finalize boolean DEFAULT false,
  p_confirmed_warnings text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_reopening boolean := false;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT id, stage_name, status, quantity_processed, quantity_total
    INTO v_stage
    FROM public.order_stages
   WHERE order_id = p_order_id
     AND public.canonical_stage_name(stage_name) = public.canonical_stage_name(p_stage_name)
   ORDER BY (stage_name = p_stage_name) DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Setor "%" não existe nesta OP.', p_stage_name;
  END IF;

  -- (#13) Concluído bloqueia apontamento pra FRENTE; estorno negativo REABRE (R6.4)
  IF v_stage.status = 'concluido' AND COALESCE(p_quantity, 0) >= 0 THEN
    RAISE EXCEPTION 'Setor "%" já está concluído — apontamento bloqueado (estorno negativo é permitido).', v_stage.stage_name;
  END IF;
  v_reopening := (v_stage.status = 'concluido' AND COALESCE(p_quantity, 0) < 0);

  v_new_processed := COALESCE(v_stage.quantity_processed, 0) + COALESCE(p_quantity, 0);

  IF v_new_processed < 0 THEN
    RAISE EXCEPTION 'Correção inválida: quantidade acumulada ficaria negativa (% pares).', v_new_processed;
  END IF;

  SELECT check_prev_sector_limit, check_material_reserved
    INTO v_settings
    FROM public.sector_settings
   WHERE sector = public.canonical_stage_name(v_stage.stage_name);

  -- ── Aviso: limite do setor anterior (só pra apontamento positivo) ──────────
  IF COALESCE(p_quantity, 0) > 0 AND COALESCE(v_settings.check_prev_sector_limit, true) THEN
    WITH op_stages AS (
      SELECT public.canonical_stage_name(os.stage_name) AS sector,
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
      WHERE sector = public.canonical_stage_name(v_stage.stage_name)
      LIMIT 1
    )
    -- Pulo (concluído com 0) NÃO entrega quantity_total. Se o nível anterior
    -- foi pulado, olha o nível atrás dele — passthrough do inbound real.
    SELECT lo.delivered
      INTO v_prev_delivered
      FROM (
        SELECT l.level,
               MIN(CASE
                     WHEN l.status = 'concluido' AND COALESCE(l.quantity_processed, 0) = 0 THEN NULL
                     WHEN l.status = 'concluido' THEN l.quantity_total
                     ELSE COALESCE(l.quantity_processed, 0)
                   END) AS delivered
          FROM leveled l
         GROUP BY l.level
      ) lo, me
     WHERE lo.level < me.level
       AND lo.delivered IS NOT NULL
     ORDER BY lo.level DESC
     LIMIT 1;

    IF v_prev_delivered IS NOT NULL AND v_new_processed > v_prev_delivered THEN
      v_raised := array_append(v_raised, 'limite_setor_anterior');
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'limite_setor_anterior',
        'message', format('O setor anterior entregou só %s de %s pares — você está apontando %s no acumulado.',
                          v_prev_delivered, v_stage.quantity_total, v_new_processed),
        'delivered', v_prev_delivered);
    END IF;
  END IF;

  -- ── Aviso: material não reservado — também ao INICIAR o setor (#15/R6.3) ───
  IF (COALESCE(p_quantity, 0) > 0 OR v_stage.status = 'pendente')
     AND COALESCE(v_settings.check_material_reserved, true) THEN
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

  -- ── Aviso: acima do total da OP ────────────────────────────────────────
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

  -- (#2) 1º o ESTADO (order_stages), DEPOIS o ledger — qualquer gatilho do
  -- ledger já enxerga o estágio atualizado. (#13) estorno reabre o estágio.
  UPDATE public.order_stages
     SET quantity_processed = v_stage_processed,
         operator_employee_id = COALESCE(p_operator_employee_id, operator_employee_id),
         status = CASE
           WHEN v_reopening AND v_stage_processed < v_stage.quantity_total THEN 'em_andamento'
           WHEN status = 'pendente' THEN 'em_andamento'
           ELSE status END,
         completed_at = CASE WHEN v_reopening AND v_stage_processed < v_stage.quantity_total
                             THEN NULL ELSE completed_at END,
         completed_by = CASE WHEN v_reopening AND v_stage_processed < v_stage.quantity_total
                             THEN NULL ELSE completed_by END,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE id = v_stage.id;

  -- (#14) Ledger: qty≠0, OU aviso confirmado (autoria R6.3), OU pulo com nota (R5.5)
  IF COALESCE(p_quantity, 0) <> 0
     OR array_length(v_raised, 1) > 0
     OR (p_finalize AND NULLIF(trim(p_note), '') IS NOT NULL) THEN
    INSERT INTO public.production_pointings
      (order_id, order_stage_id, stage_name, quantity, operator_employee_id, note,
       confirmed_warnings, confirmed_warnings_detail)
    VALUES
      (p_order_id, v_stage.id, v_stage.stage_name, COALESCE(p_quantity, 0),
       p_operator_employee_id, NULLIF(trim(p_note), ''),
       CASE WHEN array_length(v_raised, 1) > 0 THEN v_raised
            WHEN COALESCE(array_length(p_confirmed_warnings, 1), 0) > 0 THEN p_confirmed_warnings
            ELSE NULL END,
       CASE WHEN array_length(v_raised, 1) > 0 THEN v_warnings ELSE NULL END);
  END IF;

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
$function$;

COMMENT ON FUNCTION public.apontar_producao_setor_impl(uuid, text, integer, uuid, text, boolean, text[])
  IS 'Apontamento canônico. Lookup de setor via canonical_stage_name (Mesa⇄Aviamento, Corte Palmilha⇄Corte Fibra).';
