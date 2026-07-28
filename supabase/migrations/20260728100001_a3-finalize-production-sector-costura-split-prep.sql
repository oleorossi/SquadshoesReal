-- ============================================================================
-- A3 (auditoria 2026-07-28) — finalize_production_sector com lista de preparo
-- obsoleta após o split da Costura.
--
-- A definição viva (20260909120000) fixava v_prep_sectors =
-- ['Corte Palmilha','Corte Forração','Aviamento','Costura'], mas a
-- 20261001120000 renomeou as etapas para 'Costura Palmilha'/'Costura Cabedal':
-- concluir uma costura caía no ramo não-prep (promovia Silk com preparo ainda
-- aberto) e concluir Aviamento devolvia all_prep_done=true ignorando costuras
-- pendentes.
--
-- Fix (forma robusta sugerida no relatório): o conjunto de preparo passa a ser
-- DERIVADO de sector_settings.parallel_group ('corte' + 'costura_aviamento' —
-- os dois blocos do split; 'preparacao' cobre o valor pré-split), com
-- 'Costura' mantida por compatibilidade com OP legada e fallback literal se a
-- consulta vier vazia. Resto do corpo idêntico à definição viva.
-- Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text, p_quantity_processed integer DEFAULT NULL::integer, p_operator_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prep_sectors text[];
  v_is_prep boolean;
  v_all_prep_done boolean;
  v_pending_prep text[];
  v_next_sectors text[];
  v_result jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- A3: preparo derivado dos grupos paralelos de sector_settings em vez de
  -- lista fixa de nomes — sobrevive a renomes futuros de setor. 'Costura'
  -- entra por compatibilidade com etapa legada que tenha escapado do rename
  -- da 20261001120000.
  v_prep_sectors := ARRAY(
    SELECT ss.sector FROM public.sector_settings ss
     WHERE ss.parallel_group IN ('corte', 'costura_aviamento', 'preparacao')
  ) || ARRAY['Costura'];
  IF COALESCE(array_length(v_prep_sectors, 1), 0) <= 1 THEN
    v_prep_sectors := ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal','Aviamento','Costura'];
  END IF;
  v_is_prep := p_current_sector = ANY(v_prep_sectors);

  IF p_quantity_processed IS NOT NULL AND p_quantity_processed < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida: % (deve ser >= 0)', p_quantity_processed;
  END IF;

  UPDATE public.order_stages
     SET status = 'concluido',
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
