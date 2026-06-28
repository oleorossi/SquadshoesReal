-- Fase 2 (custeio): popula bom_operations (estava vazia → MO=R$0 em tudo). 1 operação por
-- setor de production_sectors. cost_per_hour da taxa do setor (Aviamento herda 'mesa' R$8,41 —
-- decisão do gate 2026-06-28). Tempo em cascata: A) capacidade da ficha (jornada efetiva ÷
-- capacidade/dia), B) sector_minutes_default por categoria, C) tempo_pendente (active=false).
-- Re-rodável (regenera do zero). Aplicada via Supabase MCP. cost_per_pair é coluna GERADA.
CREATE TABLE IF NOT EXISTS public.sector_minutes_default (
  shoe_category    text NOT NULL,
  sector           text NOT NULL,
  minutes_per_pair numeric NOT NULL CHECK (minutes_per_pair > 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shoe_category, sector)
);
COMMENT ON TABLE public.sector_minutes_default IS 'Fonte B do tempo de MO (Fase 2): minutos/par por (categoria de calçado, setor display). generate_bom_operations() usa quando não há capacidade na ficha (fonte A). Vazia = tudo cai em tempo_pendente onde não há capacidade.';

CREATE OR REPLACE FUNCTION public.generate_bom_operations()
RETURNS TABLE(fichas integer, operacoes integer, com_tempo integer, pendentes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_journey numeric; v_sheet RECORD; v_sector text; v_key text;
  v_rate numeric; v_cap numeric; v_minutes numeric; v_note text; v_active boolean; v_ord integer;
  v_fichas integer := 0; v_ops integer := 0; v_com_tempo integer := 0; v_pend integer := 0;
BEGIN
  SELECT extract(epoch from (exit_time - entry_time - coalesce(lunch_end - lunch_start, interval '0')))/60
    INTO v_journey FROM work_schedules WHERE is_default ORDER BY created_at LIMIT 1;
  v_journey := COALESCE(NULLIF(v_journey, 0), 540);

  DELETE FROM public.bom_operations;

  FOR v_sheet IN
    SELECT * FROM technical_sheets
     WHERE jsonb_typeof(production_sectors)='array' AND jsonb_array_length(production_sectors) > 0
  LOOP
    v_fichas := v_fichas + 1; v_ord := 0;
    FOR v_sector IN SELECT trim(s) FROM jsonb_array_elements_text(v_sheet.production_sectors) s LOOP
      v_ord := v_ord + 1;
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
        v_minutes := round(v_journey / v_cap, 4); v_note := 'fonte_capacidade'; v_active := true;
      ELSE
        SELECT minutes_per_pair INTO v_minutes FROM sector_minutes_default
         WHERE shoe_category = COALESCE(v_sheet.shoe_category, '') AND sector = v_sector;
        IF COALESCE(v_minutes, 0) > 0 THEN
          v_note := 'fonte_default'; v_active := true;
        ELSE
          v_minutes := 0; v_note := 'tempo_pendente'; v_active := false;
        END IF;
      END IF;

      INSERT INTO public.bom_operations
        (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour, sort_order, active, notes)
      VALUES
        (v_sheet.id, v_sector, v_sector, COALESCE(v_minutes, 0), v_rate, v_ord, v_active, v_note);

      v_ops := v_ops + 1;
      IF v_active THEN v_com_tempo := v_com_tempo + 1; ELSE v_pend := v_pend + 1; END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_fichas, v_ops, v_com_tempo, v_pend;
END;
$function$;

-- Geração inicial (idempotente; re-rodar após preencher sector_minutes_default / capacidades).
SELECT public.generate_bom_operations();
