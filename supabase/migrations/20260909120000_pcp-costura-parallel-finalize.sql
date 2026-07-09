-- ============================================================================
-- A1 — Costura paralela aos cortes: alinhar a EXECUÇÃO ao PLANEJAMENTO
-- ============================================================================
-- Avaliação dos motores (2026-07-08): o planejamento (`compute_wave_timeline`)
-- trata Costura como 4º setor de PREPARO PARALELO — GREATEST(palmilha, forração,
-- mesa/aviamento, costura) — enquanto a execução (`finalize_production_sector`)
-- fixava só 3 preps ['Corte Palmilha','Corte Forração','Aviamento'], tratando
-- Costura como sequencial. Resultado: o chão liberava a cadeia sequencial
-- (Silk→Colagem→Montagem→Solagem→Acabamento) por uma regra DIFERENTE das datas
-- impressas na onda.
--
-- O usuário confirmou (2026-07-08) que Costura roda EM PARALELO aos cortes.
-- Fix: incluir 'Costura' em `v_prep_sectors`, de modo que a cadeia sequencial
-- só seja liberada quando os 4 preparos terminarem. `order_stages.stage_name`
-- usa exatamente 'Costura' (verificado no banco: ord=3, paralelo a Aviamento;
-- cadeia sequencial começa em Silk ord=5). Nenhuma outra lógica muda.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_production_sector(p_order_id uuid, p_current_sector text, p_quantity_processed integer DEFAULT NULL::integer, p_operator_employee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prep_sectors text[] := ARRAY['Corte Palmilha','Corte Forração','Aviamento','Costura'];
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
