-- =============================================================================
-- FIX: production_sectors em technical_sheets — legacy + setores faltantes
-- =============================================================================
-- Auditoria revelou:
--   - 1 ficha com "Corte" legado (devia ser "Corte Palmilha" + "Corte Forração")
--   - 1 ficha com "Forração" legado (devia ser "Corte Forração")
--   - 18 de 22 fichas SEM "Expedição" (todas deveriam ter)
--   - 19 de 22 fichas SEM "Solagem" (calçados com solado precisam)
--
-- Fluxo canônico (10 setores ordenados):
--   1. Corte Palmilha     ┐
--   2. Corte Forração     ├─ paralelos (prep)
--   3. Aviamento          ┘
--   4. Costura
--   5. Silk
--   6. Colagem
--   7. Montagem
--   8. Solagem
--   9. Acabamento
--  10. Expedição
--
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- Pós-fix: 22/22 fichas com Solagem + Expedição. 20/22 com Corte Palmilha
-- (2 são insole_ready_made — corretamente sem corte).
-- =============================================================================

DO $$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Aviamento','Costura',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_ts record;
  v_clean jsonb;
  v_normalized text[];
  v_had_corte boolean;
BEGIN
  FOR v_ts IN
    SELECT id, production_sectors
    FROM public.technical_sheets
    WHERE production_sectors IS NOT NULL
      AND jsonb_typeof(production_sectors) = 'array'
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_ts.production_sectors) WHERE value = 'Corte'
    ) INTO v_had_corte;

    SELECT array_agg(DISTINCT
      CASE
        WHEN x.value = 'Corte' THEN 'Corte Palmilha'
        WHEN x.value = 'Forração' THEN 'Corte Forração'
        WHEN x.value = 'Mesa' THEN 'Aviamento'
        ELSE x.value
      END
    )
    INTO v_normalized
    FROM jsonb_array_elements_text(v_ts.production_sectors) x;

    IF v_had_corte THEN
      v_normalized := v_normalized || ARRAY['Corte Forração'];
    END IF;

    IF NOT ('Solagem' = ANY(v_normalized)) THEN
      v_normalized := v_normalized || ARRAY['Solagem'];
    END IF;
    IF NOT ('Expedição' = ANY(v_normalized)) THEN
      v_normalized := v_normalized || ARRAY['Expedição'];
    END IF;

    SELECT jsonb_agg(s.value)
    INTO v_clean
    FROM (
      SELECT c.value, c.ord
      FROM unnest(v_canonical) WITH ORDINALITY AS c(value, ord)
      WHERE c.value = ANY(v_normalized)
      ORDER BY c.ord
    ) s;

    UPDATE public.technical_sheets
    SET production_sectors = COALESCE(v_clean, '[]'::jsonb), updated_at = now()
    WHERE id = v_ts.id;
  END LOOP;
END $$;

-- Trigger pra evitar regressão: normaliza production_sectors em INSERT/UPDATE
DROP FUNCTION IF EXISTS public.tg_normalize_production_sectors() CASCADE;
CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Aviamento','Costura',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_input text[];
  v_normalized text[];
  v_clean jsonb;
  v_had_corte boolean := false;
BEGIN
  IF NEW.production_sectors IS NULL OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(value) INTO v_input
  FROM jsonb_array_elements_text(NEW.production_sectors);

  IF v_input IS NULL THEN RETURN NEW; END IF;

  v_had_corte := 'Corte' = ANY(v_input);

  SELECT array_agg(DISTINCT
    CASE
      WHEN x = 'Corte' THEN 'Corte Palmilha'
      WHEN x = 'Forração' THEN 'Corte Forração'
      WHEN x = 'Mesa' THEN 'Aviamento'
      ELSE x
    END
  )
  INTO v_normalized
  FROM unnest(v_input) x;

  IF v_had_corte THEN
    v_normalized := v_normalized || ARRAY['Corte Forração'];
  END IF;

  SELECT jsonb_agg(s.value)
  INTO v_clean
  FROM (
    SELECT c.value, c.ord
    FROM unnest(v_canonical) WITH ORDINALITY AS c(value, ord)
    WHERE c.value = ANY(v_normalized)
    ORDER BY c.ord
  ) s;

  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tg_normalize_production_sectors() TO authenticated;
COMMENT ON FUNCTION public.tg_normalize_production_sectors() IS
  'Normaliza production_sectors em INSERT/UPDATE: substitui legacy '
  '(Corte, Forração, Mesa) por canonical (Corte Palmilha, Corte Forração, '
  'Aviamento), deduplica e reordena na sequência canônica de fluxo.';

DROP TRIGGER IF EXISTS trg_normalize_production_sectors ON public.technical_sheets;
CREATE TRIGGER trg_normalize_production_sectors
  BEFORE INSERT OR UPDATE OF production_sectors ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_production_sectors();
