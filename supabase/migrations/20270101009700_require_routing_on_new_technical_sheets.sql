-- Ativa o portão de roteamento somente para fichas criadas após esta migration.
-- Fichas existentes continuam com consumption_routing_required=false e não são
-- reescritas. Esta migration NÃO cria ledger, reserva ou baixa por setor.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.technical_sheets') IS NULL
     OR to_regclass('public.sheet_materials') IS NULL THEN
    RAISE EXCEPTION 'Preflight: tabelas de ficha técnica ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'technical_sheets'
       AND column_name = 'consumption_routing_required'
  ) OR NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'technical_sheets'
       AND column_name = 'component_consumption_sectors'
  ) OR NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sheet_materials'
       AND column_name = 'consumption_sector'
  ) THEN
    RAISE EXCEPTION 'Preflight: schema de roteamento incompleto';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.tg_new_sheet_starts_as_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.status_ficha := 'rascunho';
  NEW.consumption_routing_required := true;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_new_sheet_starts_as_draft
  ON public.technical_sheets;
CREATE TRIGGER trg_new_sheet_starts_as_draft
  BEFORE INSERT ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_new_sheet_starts_as_draft();

CREATE OR REPLACE FUNCTION public.tg_enforce_new_sheet_consumption_routing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_missing integer;
  v_allowed CONSTANT text[] := ARRAY[
    'Corte Fibra',
    'Corte Forração',
    'Corte Cabedal',
    'Costura Palmilha',
    'Costura Cabedal',
    'Aviamento',
    'Silk',
    'Colagem',
    'Montagem',
    'Solagem',
    'Acabamento'
  ];
BEGIN
  -- A flag é sistêmica: depois de ligada, não pode ser desligada para contornar
  -- o portão. As fichas legadas permanecem false e saem logo abaixo.
  IF OLD.consumption_routing_required
     AND NEW.consumption_routing_required IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'O roteamento obrigatório desta ficha não pode ser desativado.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Serializa a liberação da ficha com alterações concorrentes no BOM. Assim,
  -- uma transação não publica enquanto outra remove o setor ainda enxergando
  -- o status antigo de rascunho.
  IF OLD.consumption_routing_required
     OR NEW.consumption_routing_required THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('technical_sheet_routing:' || NEW.id::text, 0)
    );
  END IF;

  IF NEW.consumption_routing_required IS DISTINCT FROM true
     OR NEW.status_ficha NOT IN ('validada', 'publicada') THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.component_consumption_sectors)
     IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: o roteamento dos componentes está inválido.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)
    INTO v_missing
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = NEW.id
     AND nullif(btrim(sm.consumption_sector), '') IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: % item(ns) do BOM estão sem setor de consumo.',
      v_missing
      USING ERRCODE = 'check_violation';
  END IF;

  IF nullif(btrim(NEW.insole_material), '') IS NOT NULL
     AND NOT (
       btrim(coalesce(
         NEW.component_consumption_sectors ->> 'fibra',
         ''
       )) = ANY(v_allowed)
     ) THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: informe o setor de consumo da fibra.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF nullif(btrim(NEW.lining_material), '') IS NOT NULL
     AND NOT (
       btrim(coalesce(
         NEW.component_consumption_sectors ->> 'forracao_palmilha',
         ''
       )) = ANY(v_allowed)
     ) THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: informe o setor da forração.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF nullif(btrim(NEW.upper_material), '') IS NOT NULL
     AND NOT (
       btrim(coalesce(
         NEW.component_consumption_sectors ->> 'cabedal',
         ''
       )) = ANY(v_allowed)
     ) THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: informe o setor de consumo do cabedal.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF nullif(btrim(NEW.sole_material), '') IS NOT NULL
     AND NOT (
       btrim(coalesce(
         NEW.component_consumption_sectors ->> 'solado',
         ''
       )) = ANY(v_allowed)
     ) THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: informe o setor de consumo do solado.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_typeof(coalesce(NEW.direct_components, '[]'::jsonb))
     IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: componentes diretos inválidos.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        coalesce(NEW.direct_components, '[]'::jsonb)
      ) component
     WHERE nullif(component ->> 'product_id', '') IS NOT NULL
       AND NOT (
         btrim(coalesce(component ->> 'consumption_sector', ''))
         = ANY(v_allowed)
       )
  ) THEN
    RAISE EXCEPTION
      'Não é possível liberar a ficha: há componente direto sem setor de consumo válido.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_new_sheet_consumption_routing
  ON public.technical_sheets;
CREATE TRIGGER trg_enforce_new_sheet_consumption_routing
  BEFORE UPDATE OF
    status_ficha,
    consumption_routing_required,
    component_consumption_sectors,
    direct_components,
    insole_material,
    lining_material,
    upper_material,
    sole_material
  ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_new_sheet_consumption_routing();

CREATE OR REPLACE FUNCTION public.tg_enforce_released_sheet_material_routing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Usa a mesma trava do guard da ficha para fechar a corrida entre publicar
  -- e inserir/alterar um item do BOM sem roteamento.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('technical_sheet_routing:' || NEW.sheet_id::text, 0)
  );

  IF nullif(btrim(NEW.consumption_sector), '') IS NULL
     AND EXISTS (
       SELECT 1
         FROM public.technical_sheets ts
        WHERE ts.id = NEW.sheet_id
          AND ts.consumption_routing_required
          AND ts.status_ficha IN ('validada', 'publicada')
     ) THEN
    RAISE EXCEPTION
      'Informe o setor de consumo antes de adicionar o material a uma ficha liberada.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_released_sheet_material_routing
  ON public.sheet_materials;
CREATE TRIGGER trg_enforce_released_sheet_material_routing
  BEFORE INSERT OR UPDATE OF sheet_id, consumption_sector
  ON public.sheet_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_released_sheet_material_routing();

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.technical_sheets'::regclass
       AND tgname = 'trg_new_sheet_starts_as_draft'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.technical_sheets'::regclass
       AND tgname = 'trg_enforce_new_sheet_consumption_routing'
       AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.sheet_materials'::regclass
       AND tgname = 'trg_enforce_released_sheet_material_routing'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Verify: triggers de roteamento incompletos';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
