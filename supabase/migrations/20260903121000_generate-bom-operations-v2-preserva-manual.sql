-- P0.1 / M2 — generate_bom_operations v2: regeneração NÃO destrutiva.
--
-- A v1 (20260628181500) fazia `DELETE FROM bom_operations` sem WHERE — re-rodar
-- apagava edições manuais da UI (OperationsTab) e resultados de cronoanálise
-- (apply_time_study_to_bom). Com o seed de sector_minutes_default (migration
-- seguinte) re-rodando o generator via trigger, isso viraria perda de dado real.
--
-- Regras da v2, por (ficha, setor de production_sectors):
--   • existe linha 'manual'/'cronoanalise' no setor → PRESERVA (não toca; se não
--     houver também uma linha gerada, não insere — senão duplicaria o labor);
--   • existe linha gerada ('capacidade'/'default'/'pendente') → UPDATE recalculado;
--   • não existe linha → INSERT.
-- DELETE apenas cirúrgico: linhas GERADAS cujo (ficha, setor) saiu de
-- production_sectors. Linhas manual/cronoanalise nunca são deletadas.
--
-- Cada UPDATE/INSERT dispara trg_mark_so_costs_dirty_from_bom_ops (M1) → PVs
-- ativos re-entram no cron de recálculo sozinhos.

CREATE INDEX IF NOT EXISTS idx_bom_operations_sheet_stage
  ON public.bom_operations (sheet_id, stage);

-- retorno ganha coluna 'preservadas' → precisa de DROP (sem callers no frontend).
DROP FUNCTION IF EXISTS public.generate_bom_operations();

CREATE FUNCTION public.generate_bom_operations()
RETURNS TABLE(fichas integer, operacoes integer, com_tempo integer, pendentes integer, preservadas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_journey numeric; v_sheet RECORD; v_sector text; v_key text;
  v_rate numeric; v_cap numeric; v_minutes numeric; v_note text; v_active boolean; v_ord integer;
  v_source text; v_gen_id uuid; v_has_kept boolean;
  v_fichas integer := 0; v_ops integer := 0; v_com_tempo integer := 0;
  v_pend integer := 0; v_kept integer := 0;
BEGIN
  SELECT extract(epoch from (exit_time - entry_time - coalesce(lunch_end - lunch_start, interval '0')))/60
    INTO v_journey FROM work_schedules WHERE is_default ORDER BY created_at LIMIT 1;
  v_journey := COALESCE(NULLIF(v_journey, 0), 540);

  -- DELETE cirúrgico: só linhas geradas cujo setor saiu da ficha (ou cuja ficha
  -- perdeu production_sectors). Nunca toca manual/cronoanalise.
  DELETE FROM public.bom_operations b
   WHERE b.time_source IN ('capacidade','default','pendente')
     AND NOT EXISTS (
       SELECT 1
         FROM technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements_text(ts.production_sectors) s
        WHERE ts.id = b.sheet_id
          AND jsonb_typeof(ts.production_sectors) = 'array'
          AND trim(s) = b.stage
     );

  FOR v_sheet IN
    SELECT * FROM technical_sheets
     WHERE jsonb_typeof(production_sectors)='array' AND jsonb_array_length(production_sectors) > 0
  LOOP
    v_fichas := v_fichas + 1; v_ord := 0;
    FOR v_sector IN SELECT trim(s) FROM jsonb_array_elements_text(v_sheet.production_sectors) s LOOP
      v_ord := v_ord + 1;

      -- setor coberto por linha manual/cronoanálise? (preserva; conta e segue)
      SELECT EXISTS (
        SELECT 1 FROM public.bom_operations
         WHERE sheet_id = v_sheet.id AND stage = v_sector
           AND time_source IN ('manual','cronoanalise')
      ) INTO v_has_kept;

      -- linha gerada existente deste setor (v1 garantia no máx. 1)
      SELECT id INTO v_gen_id FROM public.bom_operations
       WHERE sheet_id = v_sheet.id AND stage = v_sector
         AND time_source IN ('capacidade','default','pendente')
       ORDER BY created_at LIMIT 1;

      IF v_has_kept THEN
        v_kept := v_kept + 1;
        -- linha gerada redundante ao lado de uma manual/cronoanálise do mesmo
        -- setor duplicaria o labor no custeio → remove a gerada.
        IF v_gen_id IS NOT NULL THEN
          DELETE FROM public.bom_operations WHERE id = v_gen_id;
        END IF;
        CONTINUE;
      END IF;

      v_key := lower(translate(replace(v_sector, ' ', '_'),
        'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'aaaaeeiooouucAAAAEEIOOOUUC'));

      SELECT hourly_rate INTO v_rate FROM sector_labor_rates
       WHERE sector_key = CASE WHEN v_key = 'aviamento' THEN 'mesa' ELSE v_key END;
      v_rate := COALESCE(v_rate, 0);

      v_cap := CASE v_key
        WHEN 'corte_palmilha' THEN v_sheet.cutting_capacity_per_day
        WHEN 'corte_forracao' THEN v_sheet.cutting_capacity_per_day
        WHEN 'corte_cabedal'  THEN v_sheet.cutting_capacity_per_day
        WHEN 'costura'        THEN COALESCE(NULLIF(v_sheet.costura_capacity_per_day, 0), v_sheet.sewing_capacity_per_day)
        WHEN 'silk'           THEN v_sheet.silk_capacity_per_day
        WHEN 'colagem'        THEN v_sheet.gluing_capacity_per_day
        WHEN 'montagem'       THEN v_sheet.assembly_capacity_per_day
        WHEN 'solagem'        THEN v_sheet.soling_capacity_per_day
        WHEN 'acabamento'     THEN v_sheet.finishing_capacity_per_day
        WHEN 'expedicao'      THEN v_sheet.expedition_capacity_per_day
        WHEN 'aviamento'      THEN v_sheet.mesa_daily_capacity
        ELSE NULL END;

      IF COALESCE(v_cap, 0) > 0 THEN
        v_minutes := round(v_journey / v_cap, 4);
        v_note := 'fonte_capacidade'; v_source := 'capacidade'; v_active := true;
      ELSE
        SELECT minutes_per_pair INTO v_minutes FROM sector_minutes_default
         WHERE shoe_category = COALESCE(v_sheet.shoe_category, '') AND sector = v_sector;
        IF COALESCE(v_minutes, 0) > 0 THEN
          v_note := 'fonte_default'; v_source := 'default'; v_active := true;
        ELSE
          v_minutes := 0; v_note := 'tempo_pendente'; v_source := 'pendente'; v_active := false;
        END IF;
      END IF;

      IF v_gen_id IS NOT NULL THEN
        UPDATE public.bom_operations
           SET operation_name = v_sector,
               standard_time_minutes = COALESCE(v_minutes, 0),
               cost_per_hour = v_rate,
               sort_order = v_ord,
               active = v_active,
               notes = v_note,
               time_source = v_source,
               updated_at = now()
         WHERE id = v_gen_id;
      ELSE
        INSERT INTO public.bom_operations
          (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour,
           sort_order, active, notes, time_source)
        VALUES
          (v_sheet.id, v_sector, v_sector, COALESCE(v_minutes, 0), v_rate,
           v_ord, v_active, v_note, v_source);
      END IF;

      v_ops := v_ops + 1;
      IF v_active THEN v_com_tempo := v_com_tempo + 1; ELSE v_pend := v_pend + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_fichas, v_ops, v_com_tempo, v_pend, v_kept;
END;
$function$;
