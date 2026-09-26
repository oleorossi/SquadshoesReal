-- Renomeia exibição Corte Fibra / Corte Forração → Palmilha · Fibra / Palmilha · Forração.
-- Spec: specs/ficha-palmilha-unificada.md (Q4, Q13, Q17).
--
-- Mantém enums internos (corte_palmilha / corte_forracao) e capacidades em 2 linhas.
-- Backfill de order_stages: só OPs NÃO Finalizado/Cancelada (Q13=A).

-- ── 1. Funções canônicas ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.canonical_stage_name(p_stage_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(COALESCE(p_stage_name, '')))
    WHEN 'corte palmilha'         THEN 'Palmilha · Fibra'
    WHEN 'corte fibra'            THEN 'Palmilha · Fibra'
    WHEN 'palmilha · fibra'       THEN 'Palmilha · Fibra'
    WHEN 'palmilha fibra'         THEN 'Palmilha · Fibra'
    WHEN 'corte forracao'         THEN 'Palmilha · Forração'
    WHEN 'corte forração'         THEN 'Palmilha · Forração'
    WHEN 'palmilha · forracao'    THEN 'Palmilha · Forração'
    WHEN 'palmilha · forração'    THEN 'Palmilha · Forração'
    WHEN 'palmilha forracao'      THEN 'Palmilha · Forração'
    WHEN 'palmilha forração'      THEN 'Palmilha · Forração'
    WHEN 'forração'               THEN 'Palmilha · Forração'
    WHEN 'forracao'               THEN 'Palmilha · Forração'
    WHEN 'corte cabedal'          THEN 'Corte Cabedal'
    WHEN 'costura'                THEN 'Acabamento Palmilha'
    WHEN 'costura palmilha'       THEN 'Acabamento Palmilha'
    WHEN 'acabamento palmilha'    THEN 'Acabamento Palmilha'
    WHEN 'costura cabedal'        THEN 'Costura Cabedal'
    WHEN 'mesa'                   THEN 'Aviamento'
    WHEN 'aviamento'              THEN 'Aviamento'
    WHEN 'silk'                   THEN 'Silk'
    WHEN 'colagem'                THEN 'Colagem'
    WHEN 'montagem'               THEN 'Montagem'
    WHEN 'solagem'                THEN 'Solagem'
    WHEN 'acabamento'             THEN 'Acabamento'
    WHEN 'expedição'              THEN 'Expedição'
    WHEN 'expedicao'              THEN 'Expedição'
    ELSE trim(COALESCE(p_stage_name, ''))
  END;
$function$;

CREATE OR REPLACE FUNCTION public.canonical_stage_order(p_stage_name text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE public.canonical_stage_name(p_stage_name)
    WHEN 'Palmilha · Fibra'      THEN 1
    WHEN 'Palmilha · Forração'   THEN 2
    WHEN 'Corte Cabedal'         THEN 2
    WHEN 'Acabamento Palmilha'   THEN 3
    WHEN 'Costura Cabedal'       THEN 4
    WHEN 'Aviamento'             THEN 5
    WHEN 'Silk'                  THEN 6
    WHEN 'Colagem'               THEN 7
    WHEN 'Montagem'              THEN 8
    WHEN 'Solagem'               THEN 9
    WHEN 'Acabamento'            THEN 10
    WHEN 'Expedição'             THEN 11
    ELSE 99
  END;
$function$;

CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
RETURNS public.production_stage_enum
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE public.canonical_stage_name(p_name)
    WHEN 'Palmilha · Fibra'      THEN 'corte_palmilha'::public.production_stage_enum
    WHEN 'Palmilha · Forração'   THEN 'corte_forracao'::public.production_stage_enum
    WHEN 'Corte Cabedal'         THEN 'corte_cabedal'::public.production_stage_enum
    WHEN 'Acabamento Palmilha'   THEN 'costura'::public.production_stage_enum
    WHEN 'Costura Cabedal'       THEN 'costura'::public.production_stage_enum
    WHEN 'Aviamento'             THEN 'mesa'::public.production_stage_enum
    WHEN 'Silk'                  THEN 'silk'::public.production_stage_enum
    WHEN 'Colagem'               THEN 'colagem'::public.production_stage_enum
    WHEN 'Montagem'              THEN 'montagem'::public.production_stage_enum
    WHEN 'Solagem'               THEN 'solagem'::public.production_stage_enum
    WHEN 'Acabamento'            THEN 'acabamento'::public.production_stage_enum
    WHEN 'Expedição'             THEN 'expedicao'::public.production_stage_enum
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text[] := ARRAY[
    'Palmilha · Fibra', 'Palmilha · Forração', 'Corte Cabedal',
    'Acabamento Palmilha', 'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem',
    'Montagem', 'Solagem', 'Acabamento', 'Expedição'
  ];
  v_input text[];
  v_normalized text[];
  v_clean jsonb;
BEGIN
  IF NEW.production_sectors IS NULL
     OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(value)
    INTO v_input
    FROM jsonb_array_elements_text(NEW.production_sectors);

  IF v_input IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(c ORDER BY array_position(v_canonical, c))
    INTO v_normalized
    FROM (
      SELECT DISTINCT CASE
        WHEN x IN ('Corte', 'Corte Palmilha', 'Corte Fibra', 'Palmilha · Fibra') THEN 'Palmilha · Fibra'
        WHEN x IN ('Forração', 'Corte Forracao', 'Corte Forração', 'Palmilha · Forração') THEN 'Palmilha · Forração'
        WHEN x = 'Mesa' THEN 'Aviamento'
        WHEN x IN ('Costura', 'Costura Palmilha') THEN 'Acabamento Palmilha'
        ELSE public.canonical_stage_name(x)
      END AS c
      FROM unnest(v_input) AS x
    ) sub
   WHERE c = ANY (v_canonical);

  -- Expedição obrigatória no fim (exceto rota vazia)
  IF v_normalized IS NOT NULL AND array_length(v_normalized, 1) > 0
     AND NOT ('Expedição' = ANY (v_normalized)) THEN
    v_normalized := v_normalized || ARRAY['Expedição'];
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    INTO v_clean
    FROM unnest(COALESCE(v_normalized, ARRAY[]::text[])) AS s;

  NEW.production_sectors := v_clean;
  RETURN NEW;
END;
$function$;

-- ── 2–4. Backfill ───────────────────────────────────────────────────────────
-- order_stages tem trava de command boundary; fichas aposentadas são imutáveis;
-- production_schedule enfileira tira. O backfill só troca grafia — replica role
-- nesta transação evita gatilhos de comando/imutabilidade/fila (padrão
-- 20270101024800 / 20270101026400).

SELECT set_config('app.order_stage_command_internal', '1', true);
SET LOCAL session_replication_role = replica;

UPDATE public.sector_settings
SET sector = 'Palmilha · Fibra',
    updated_at = now()
WHERE sector IN ('Corte Fibra', 'Corte Palmilha')
  AND NOT EXISTS (
    SELECT 1 FROM public.sector_settings e WHERE e.sector = 'Palmilha · Fibra'
  );

UPDATE public.sector_settings
SET sector = 'Palmilha · Forração',
    updated_at = now()
WHERE sector IN ('Corte Forração', 'Forração')
  AND NOT EXISTS (
    SELECT 1 FROM public.sector_settings e WHERE e.sector = 'Palmilha · Forração'
  );

UPDATE public.technical_sheets ts
SET production_sectors = (
  SELECT COALESCE(jsonb_agg(to_jsonb(public.canonical_stage_name(x)) ORDER BY ordinality), '[]'::jsonb)
  FROM jsonb_array_elements_text(ts.production_sectors) WITH ORDINALITY AS t(x, ordinality)
),
updated_at = now()
WHERE ts.production_sectors IS NOT NULL
  AND jsonb_typeof(ts.production_sectors) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(ts.production_sectors) e(v)
    WHERE lower(trim(v)) IN (
      'corte fibra', 'corte palmilha', 'corte forração', 'corte forracao', 'forração', 'forracao'
    )
  );

UPDATE public.order_stages os
SET stage_name = public.canonical_stage_name(os.stage_name),
    updated_at = now()
FROM public.orders o
WHERE o.id = os.order_id
  AND o.status IS DISTINCT FROM 'Finalizado'
  AND o.status IS DISTINCT FROM 'Cancelada'
  AND os.stage_name IN (
    'Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Forração'
  );

UPDATE public.production_schedule
SET sector = public.canonical_stage_name(sector)
WHERE sector IN ('Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Forração');

UPDATE public.production_pointings
SET stage_name = public.canonical_stage_name(stage_name)
WHERE stage_name IN ('Corte Fibra', 'Corte Palmilha', 'Corte Forração', 'Forração');

SET LOCAL session_replication_role = DEFAULT;
