-- Alinha o contrato de nomes da rota com a UI atual.
--
-- O banco vivo ainda tinha a versao que aceitava apenas "Corte Palmilha".
-- Ao salvar "Corte Fibra", o BEFORE trigger descartava o setor sem erro.
-- Mantemos o enum interno corte_palmilha para o historico, mas persistimos e
-- exibimos o nome operacional aprovado "Corte Fibra".

UPDATE public.sector_settings
   SET sector = 'Corte Fibra',
       updated_at = now()
 WHERE sector = 'Corte Palmilha'
   AND NOT EXISTS (
     SELECT 1
       FROM public.sector_settings existing
      WHERE existing.sector = 'Corte Fibra'
   );

CREATE OR REPLACE FUNCTION public.canonical_stage_name(p_stage_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(COALESCE(p_stage_name, '')))
    WHEN 'corte palmilha'   THEN 'Corte Fibra'
    WHEN 'corte fibra'      THEN 'Corte Fibra'
    WHEN 'corte forracao'   THEN 'Corte Forração'
    WHEN 'corte forração'   THEN 'Corte Forração'
    WHEN 'corte cabedal'    THEN 'Corte Cabedal'
    WHEN 'costura'          THEN 'Costura Palmilha'
    WHEN 'costura palmilha' THEN 'Costura Palmilha'
    WHEN 'costura cabedal'  THEN 'Costura Cabedal'
    WHEN 'mesa'             THEN 'Aviamento'
    WHEN 'aviamento'        THEN 'Aviamento'
    WHEN 'silk'             THEN 'Silk'
    WHEN 'colagem'          THEN 'Colagem'
    WHEN 'montagem'         THEN 'Montagem'
    WHEN 'solagem'          THEN 'Solagem'
    WHEN 'acabamento'       THEN 'Acabamento'
    WHEN 'expedição'        THEN 'Expedição'
    WHEN 'expedicao'        THEN 'Expedição'
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
    WHEN 'Corte Fibra'      THEN 1
    WHEN 'Corte Forração'   THEN 2
    WHEN 'Corte Cabedal'    THEN 2
    WHEN 'Costura Palmilha' THEN 3
    WHEN 'Costura Cabedal'  THEN 4
    WHEN 'Aviamento'        THEN 5
    WHEN 'Silk'             THEN 6
    WHEN 'Colagem'          THEN 7
    WHEN 'Montagem'         THEN 8
    WHEN 'Solagem'          THEN 9
    WHEN 'Acabamento'       THEN 10
    WHEN 'Expedição'        THEN 11
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
    WHEN 'Corte Fibra'      THEN 'corte_palmilha'::public.production_stage_enum
    WHEN 'Corte Forração'   THEN 'corte_forracao'::public.production_stage_enum
    WHEN 'Corte Cabedal'    THEN 'corte_cabedal'::public.production_stage_enum
    WHEN 'Costura Palmilha' THEN 'costura'::public.production_stage_enum
    WHEN 'Costura Cabedal'  THEN 'costura'::public.production_stage_enum
    WHEN 'Aviamento'        THEN 'mesa'::public.production_stage_enum
    WHEN 'Silk'             THEN 'silk'::public.production_stage_enum
    WHEN 'Colagem'          THEN 'colagem'::public.production_stage_enum
    WHEN 'Montagem'         THEN 'montagem'::public.production_stage_enum
    WHEN 'Solagem'          THEN 'solagem'::public.production_stage_enum
    WHEN 'Acabamento'       THEN 'acabamento'::public.production_stage_enum
    WHEN 'Expedição'        THEN 'expedicao'::public.production_stage_enum
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
    'Costura Palmilha', 'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem',
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
    WHEN x = 'Costura' THEN 'Costura Palmilha'
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
  'Normaliza a rota da ficha no vocabulário operacional atual; Corte Palmilha permanece aceito apenas como alias histórico de Corte Fibra.';
