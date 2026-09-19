-- Renomeia o nome de EXIBIÇÃO "Costura Palmilha" → "Acabamento Palmilha".
--
-- Mantém intactos: chave interna costura_palmilha, coluna
-- costura_palmilha_capacity_per_day, slug de aba costura-palmilha, enum
-- production_stage_enum → costura.
--
-- Backfill operacional completo (padrão do split da Costura em 20261001120000).
-- Aliases de leitura cobrem residual ("Costura Palmilha" / "Costura" / "costura").

-- ── 1. Funções canônicas ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.canonical_stage_name(p_stage_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(COALESCE(p_stage_name, '')))
    WHEN 'corte palmilha'      THEN 'Corte Fibra'
    WHEN 'corte fibra'         THEN 'Corte Fibra'
    WHEN 'corte forracao'      THEN 'Corte Forração'
    WHEN 'corte forração'      THEN 'Corte Forração'
    WHEN 'corte cabedal'       THEN 'Corte Cabedal'
    WHEN 'costura'             THEN 'Acabamento Palmilha'
    WHEN 'costura palmilha'    THEN 'Acabamento Palmilha'
    WHEN 'acabamento palmilha' THEN 'Acabamento Palmilha'
    WHEN 'costura cabedal'     THEN 'Costura Cabedal'
    WHEN 'mesa'                THEN 'Aviamento'
    WHEN 'aviamento'           THEN 'Aviamento'
    WHEN 'silk'                THEN 'Silk'
    WHEN 'colagem'             THEN 'Colagem'
    WHEN 'montagem'            THEN 'Montagem'
    WHEN 'solagem'             THEN 'Solagem'
    WHEN 'acabamento'          THEN 'Acabamento'
    WHEN 'expedição'           THEN 'Expedição'
    WHEN 'expedicao'           THEN 'Expedição'
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
    WHEN 'Corte Fibra'         THEN 1
    WHEN 'Corte Forração'      THEN 2
    WHEN 'Corte Cabedal'       THEN 2
    WHEN 'Acabamento Palmilha' THEN 3
    WHEN 'Costura Cabedal'     THEN 4
    WHEN 'Aviamento'           THEN 5
    WHEN 'Silk'                THEN 6
    WHEN 'Colagem'             THEN 7
    WHEN 'Montagem'            THEN 8
    WHEN 'Solagem'             THEN 9
    WHEN 'Acabamento'          THEN 10
    WHEN 'Expedição'           THEN 11
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
    WHEN 'Corte Fibra'         THEN 'corte_palmilha'::public.production_stage_enum
    WHEN 'Corte Forração'      THEN 'corte_forracao'::public.production_stage_enum
    WHEN 'Corte Cabedal'       THEN 'corte_cabedal'::public.production_stage_enum
    WHEN 'Acabamento Palmilha' THEN 'costura'::public.production_stage_enum
    WHEN 'Costura Cabedal'     THEN 'costura'::public.production_stage_enum
    WHEN 'Aviamento'           THEN 'mesa'::public.production_stage_enum
    WHEN 'Silk'                THEN 'silk'::public.production_stage_enum
    WHEN 'Colagem'             THEN 'colagem'::public.production_stage_enum
    WHEN 'Montagem'            THEN 'montagem'::public.production_stage_enum
    WHEN 'Solagem'             THEN 'solagem'::public.production_stage_enum
    WHEN 'Acabamento'          THEN 'acabamento'::public.production_stage_enum
    WHEN 'Expedição'           THEN 'expedicao'::public.production_stage_enum
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
    'Corte Fibra', 'Corte Forração', 'Corte Cabedal',
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

  SELECT array_agg(DISTINCT CASE
    WHEN x IN ('Corte', 'Corte Palmilha') THEN 'Corte Fibra'
    WHEN x IN ('Forração', 'Corte Forracao') THEN 'Corte Forração'
    WHEN x = 'Mesa' THEN 'Aviamento'
    WHEN x IN ('Costura', 'Costura Palmilha') THEN 'Acabamento Palmilha'
    ELSE x
  END)
    INTO v_normalized
    FROM unnest(v_input) x;

  IF 'Corte' = ANY(v_input) THEN
    v_normalized := v_normalized || ARRAY['Corte Forração'];
  END IF;
  IF NOT ('Expedição' = ANY(v_normalized)) THEN
    v_normalized := v_normalized || ARRAY['Expedição'];
  END IF;

  SELECT jsonb_agg(canonical.value)
    INTO v_clean
    FROM (
      SELECT item.value, item.ord
        FROM unnest(v_canonical) WITH ORDINALITY item(value, ord)
       WHERE item.value = ANY(v_normalized)
       ORDER BY item.ord
    ) canonical;

  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_normalize_production_sectors() IS
  'Normaliza a rota da ficha no vocabulário operacional atual; Costura Palmilha permanece aceito apenas como alias histórico de Acabamento Palmilha.';

-- fn_guard_manual_stage_transition (vivo): predecessor simples, sem literais
-- "Costura Palmilha" — nada a renomear. A versão antiga de 20261231122000 com
-- pré-requisitos Fibra→palmilha / Colagem NÃO é restaurada de propósito.

-- ── 2. CHECK de sheet_materials.consumption_sector ──────────────────────────

ALTER TABLE public.sheet_materials
  DROP CONSTRAINT IF EXISTS sheet_materials_consumption_sector_check;

-- ── 3. Backfill de dados ────────────────────────────────────────────────────
-- order_stages tem trava de command boundary; fichas aposentadas são imutáveis;
-- production_schedule enfileira tira. O backfill só troca grafia — replica role
-- nesta transação evita gatilhos de comando/imutabilidade/fila (mesmo padrão
-- de 20270101024800).

SELECT set_config('app.order_stage_command_internal', '1', true);
SET LOCAL session_replication_role = replica;

UPDATE public.sheet_materials
   SET consumption_sector = 'Acabamento Palmilha'
 WHERE consumption_sector = 'Costura Palmilha';

UPDATE public.sector_settings
   SET sector = 'Acabamento Palmilha',
       updated_at = now()
 WHERE sector = 'Costura Palmilha'
   AND NOT EXISTS (
     SELECT 1 FROM public.sector_settings existing
      WHERE existing.sector = 'Acabamento Palmilha'
   );

UPDATE public.technical_sheets
   SET production_sectors = replace(
         production_sectors::text,
         '"Costura Palmilha"',
         '"Acabamento Palmilha"'
       )::jsonb,
       updated_at = now()
 WHERE production_sectors::text LIKE '%Costura Palmilha%';

UPDATE public.technical_sheets
   SET component_consumption_sectors = replace(
         component_consumption_sectors::text,
         '"Costura Palmilha"',
         '"Acabamento Palmilha"'
       )::jsonb,
       updated_at = now()
 WHERE component_consumption_sectors::text LIKE '%Costura Palmilha%';

UPDATE public.order_stages
   SET stage_name = 'Acabamento Palmilha'
 WHERE stage_name = 'Costura Palmilha';

UPDATE public.production_schedule
   SET sector = 'Acabamento Palmilha'
 WHERE sector = 'Costura Palmilha';

UPDATE public.production_pointings
   SET stage_name = 'Acabamento Palmilha'
 WHERE stage_name = 'Costura Palmilha';

UPDATE public.bom_operations
   SET stage = 'Acabamento Palmilha'
 WHERE stage = 'Costura Palmilha';

UPDATE public.sector_minutes_default
   SET sector = 'Acabamento Palmilha'
 WHERE sector = 'Costura Palmilha';

SET LOCAL session_replication_role = DEFAULT;

ALTER TABLE public.sheet_materials
  ADD CONSTRAINT sheet_materials_consumption_sector_check
  CHECK (consumption_sector IS NULL OR consumption_sector IN (
    'Corte Fibra', 'Corte Forração', 'Corte Cabedal', 'Acabamento Palmilha',
    'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem',
    'Acabamento'
  ));

-- ── 4. Fallbacks hardcoded em funções vivas ─────────────────────────────────
-- Troca cirúrgica do literal em todo corpo que ainda cita o nome antigo
-- (promote, resync, terceirização, capacidade, triggers de ficha, etc.).

DO $rename_fn$
DECLARE
  r record;
  v_def text;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) LIKE '%Costura Palmilha%'
       AND p.proname NOT IN (
         'canonical_stage_name',
         'canonical_stage_order',
         'sector_display_to_enum',
         'tg_normalize_production_sectors'
       )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'Costura Palmilha', 'Acabamento Palmilha');
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END;
$rename_fn$;
