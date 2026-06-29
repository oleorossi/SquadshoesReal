-- ════════════════════════════════════════════════════════════════════════════
-- Guard de plausibilidade de consumo (anti-"CF 09")  — auditoria compras 2026-06-29
-- ════════════════════════════════════════════════════════════════════════════
-- Bloqueia INSERT/UPDATE em technical_sheets quando algum consumo de ÁREA
-- (cabedal/forro/palmilha/forro-palmilha/fachete, escalar OU per-size) passa de
-- 50 dm²/par. Consumo real fica entre ~4 e 23 dm²/par (mediana 4,5; maior
-- legítimo medido = 22,83). Pega erros de digitação/unidade tipo "CF 09" que
-- tinha upper_consumption=2000 (200×) e inflaria OC/MRP/custeio.
-- NÃO cobre sole_consumption (é contagem por par ~1, regida por outra regra).

CREATE OR REPLACE FUNCTION public.tg_guard_implausible_consumption()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_max   constant numeric := 50;  -- teto dm²/par (2,2× o maior legítimo)
  v_field text := NULL;
  v_val   numeric := NULL;
BEGIN
  -- Escalares (dm²/par)
  IF    COALESCE(NEW.upper_consumption,0)          > v_max THEN v_field := 'upper_consumption';          v_val := NEW.upper_consumption;
  ELSIF COALESCE(NEW.lining_consumption,0)         > v_max THEN v_field := 'lining_consumption';         v_val := NEW.lining_consumption;
  ELSIF COALESCE(NEW.insole_consumption,0)         > v_max THEN v_field := 'insole_consumption';         v_val := NEW.insole_consumption;
  ELSIF COALESCE(NEW.insole_lining_consumption,0)  > v_max THEN v_field := 'insole_lining_consumption';  v_val := NEW.insole_lining_consumption;
  ELSIF COALESCE(NEW.fachete_consumption,0)        > v_max THEN v_field := 'fachete_consumption';        v_val := NEW.fachete_consumption;
  END IF;

  -- Per-size (JSONB) — maior valor numérico de qualquer mapa por tamanho
  IF v_field IS NULL THEN
    SELECT col, mx INTO v_field, v_val
    FROM (
      SELECT col, max((value)::numeric) AS mx
      FROM (
        SELECT 'upper_consumption_per_size'          AS col, value FROM jsonb_each_text(COALESCE(NEW.upper_consumption_per_size,'{}'::jsonb))
        UNION ALL SELECT 'lining_consumption_per_size',          value FROM jsonb_each_text(COALESCE(NEW.lining_consumption_per_size,'{}'::jsonb))
        UNION ALL SELECT 'insole_consumption_per_size',          value FROM jsonb_each_text(COALESCE(NEW.insole_consumption_per_size,'{}'::jsonb))
        UNION ALL SELECT 'insole_lining_consumption_per_size',   value FROM jsonb_each_text(COALESCE(NEW.insole_lining_consumption_per_size,'{}'::jsonb))
        UNION ALL SELECT 'fachete_consumption_per_size',         value FROM jsonb_each_text(COALESCE(NEW.fachete_consumption_per_size,'{}'::jsonb))
      ) e
      WHERE value ~ '^[0-9]+(\.[0-9]+)?$'
      GROUP BY col
    ) g
    WHERE mx > v_max
    ORDER BY mx DESC
    LIMIT 1;
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION
      'Consumo implausível: %.% = % dm²/par excede o teto de % dm²/par. Consumo real de cabedal/forro/palmilha fica ~4 a 23 dm²/par — confira a unidade e a digitação.',
      TG_TABLE_NAME, v_field, v_val, v_max
      USING ERRCODE = 'check_violation',
            HINT = 'Se for realmente intencional, ajuste o teto em tg_guard_implausible_consumption.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_implausible_consumption ON public.technical_sheets;
CREATE TRIGGER trg_guard_implausible_consumption
  BEFORE INSERT OR UPDATE ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_implausible_consumption();
