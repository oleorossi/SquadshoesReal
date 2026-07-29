-- ════════════════════════════════════════════════════════════════════════════
-- Gestão de OPs por setor — dois furos deixados pelo split da Costura
-- (migration 20261001120000). Auditoria 2026-07-29, verificada no banco vivo.
--
-- (A) `finalize_production_sector` decidia o gate de preparação por um ARRAY
--     LITERAL `['Corte Palmilha','Corte Forração','Aviamento','Costura']`:
--       • `'Costura'` NÃO EXISTE MAIS como stage_name (0 linhas em order_stages;
--         viraram 239 'Costura Palmilha'), então o item casava com nada;
--       • `'Costura Palmilha'`/`'Costura Cabedal'` ficaram DE FORA do gate, e
--         finalizar uma delas liberava o próximo setor na hora, sem esperar as
--         paralelas;
--       • o array juntava num bloco só dois níveis que hoje são separados
--         (`corte` e `costura_aviamento`), então Aviamento pendente segurava
--         indevidamente a saída dos Cortes.
--     Passa a derivar de `sector_settings.parallel_group` — a MESMA fonte que o
--     scheduler (`recompute_production_schedule`) já usa. Setor sem grupo segue
--     sequencial, como hoje.
--
-- (B) `tg_ficha_recompute` não observava `costura_palmilha_capacity_per_day` nem
--     `costura_cabedal_capacity_per_day`. O scheduler JÁ lê as duas colunas
--     (branches presentes na função viva), mas editar a capacidade dessas
--     costuras na ficha não disparava recálculo — o plano só mudava no próximo
--     evento qualquer. 45 das 52 fichas têm esses campos preenchidos.
--
-- NÃO faz parte desta migration: gravar ledger em `finalize_production_sector`.
-- `apontar_producao_setor` já CHAMA esta função ao finalizar; inserir aqui
-- duplicaria o lançamento. O caminho certo é o cliente usar a RPC canônica.
-- ════════════════════════════════════════════════════════════════════════════

-- ── (A) Gate de preparação pelo grupo paralelo ──────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id uuid,
  p_current_sector text,
  p_quantity_processed integer DEFAULT NULL::integer,
  p_operator_employee_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- 'Mesa' é a grafia legada de 'Aviamento' e ainda aparece em OPs antigas.
  v_sector text := CASE WHEN p_current_sector = 'Mesa' THEN 'Aviamento' ELSE p_current_sector END;
  v_group text;
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

  -- Grupo paralelo DESTE setor (NULL = sequencial).
  SELECT ss.parallel_group INTO v_group
    FROM public.sector_settings ss
   WHERE ss.sector = v_sector;

  IF v_group IS NOT NULL THEN
    -- Ainda falta alguma etapa do MESMO grupo nesta OP? Enquanto faltar, o
    -- próximo nível não arranca.
    SELECT array_agg(os.stage_name) INTO v_pending_prep
      FROM public.order_stages os
      JOIN public.sector_settings ss
        ON ss.sector = CASE WHEN os.stage_name = 'Mesa' THEN 'Aviamento' ELSE os.stage_name END
     WHERE os.order_id = p_order_id
       AND ss.parallel_group = v_group
       AND os.status <> 'concluido';

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

  -- ARRAY[NULL] quando não há próximo pendente: filtra pra não tentar iniciar
  -- um stage_name nulo.
  v_next_sectors := ARRAY(SELECT x FROM unnest(COALESCE(v_next_sectors, ARRAY[]::text[])) x WHERE x IS NOT NULL);

  IF array_length(v_next_sectors, 1) > 0 THEN
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
    'next_sectors', COALESCE(to_jsonb(v_next_sectors), '[]'::jsonb),
    -- Mantido no payload por compatibilidade; agora significa "grupo paralelo
    -- deste setor concluído" (NULL quando o setor é sequencial).
    'all_prep_done', v_all_prep_done,
    'parallel_group', v_group);
  RETURN v_result;
END;
$function$;

-- ── (B) Recompute ao editar a capacidade das duas Costuras na ficha ─────────
DROP TRIGGER IF EXISTS tg_ficha_recompute ON public.technical_sheets;

CREATE CONSTRAINT TRIGGER tg_ficha_recompute
AFTER UPDATE OF
  production_sectors,
  sewing_capacity_per_day, cutting_capacity_per_day,
  mesa_daily_capacity, costura_capacity_per_day,
  costura_palmilha_capacity_per_day, costura_cabedal_capacity_per_day,
  silk_capacity_per_day, gluing_capacity_per_day,
  assembly_capacity_per_day, soling_capacity_per_day,
  finishing_capacity_per_day, expedition_capacity_per_day
ON public.technical_sheets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_production_schedule('ficha_override');
