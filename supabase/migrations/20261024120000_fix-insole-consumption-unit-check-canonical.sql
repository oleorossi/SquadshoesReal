-- ============================================================================
-- FIX (31/07/2026): salvar QUALQUER ficha técnica estava quebrado com
--   "new row for relation technical_sheets violates check constraint
--    chk_insole_consumption_unit"
--
-- Causa raiz: a mig 20260920140000 (F5-09) passou o trigger
-- tg_sync_insole_consumption_unit a gravar a grafia CANÔNICA 'dm²', mas o CHECK
-- criado lá atrás pela 20260620280000 continuou aceitando só ('dm2','un').
-- Como o trigger é BEFORE INSERT OR UPDATE OF sole_group_id, insole_ready_made
-- e o saveAll da tela manda o form inteiro (inclui sole_group_id), TODO save de
-- ficha com solado vinculado e palmilha NÃO-pronta reescrevia 'dm2'→'dm²' e
-- batia no CHECK. Nenhuma ficha salvava desde então (as 47 linhas vivas ainda
-- carregam 'dm2' — prova de que nenhum save passou).
--
-- Correção: alinhar o CHECK e o DEFAULT ao canônico, backfillar as linhas
-- legadas e fechar o furo do trigger (a normalização só rodava quando
-- sole_group_id IS NOT NULL — ficha sem solado com 'dm2' explícito violaria o
-- CHECK novo).
--
-- A coluna segue INERTE (nenhuma função SQL nem o frontend a lê além do próprio
-- trigger — verificado em pg_proc e em src/), então o backfill não mexe em
-- consumo/custeio; só uniformiza a grafia.
-- ============================================================================

-- 1) Solta o CHECK antigo pra poder normalizar os dados.
ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS chk_insole_consumption_unit;

-- 2) DEFAULT canônico. Sem isso, um INSERT que omite a coluna (ficha sem
--    sole_group_id, onde o trigger não normalizava) nasceria 'dm2' e violaria
--    o CHECK novo.
ALTER TABLE public.technical_sheets
  ALTER COLUMN insole_consumption_unit SET DEFAULT 'dm²';

-- 3) Trigger: normaliza SEMPRE pro canônico, antes de qualquer ramo.
CREATE OR REPLACE FUNCTION public.tg_sync_insole_consumption_unit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_class text;
BEGIN
  -- Grafia CANÔNICA ('dm²', nunca 'dm2'), inclusive quando não há solado
  -- vinculado — o CHECK chk_insole_consumption_unit só aceita 'dm²'/'un'.
  NEW.insole_consumption_unit := CASE lower(trim(COALESCE(NEW.insole_consumption_unit, '')))
    WHEN ''    THEN 'dm²'
    WHEN 'dm2' THEN 'dm²'
    WHEN 'dm²' THEN 'dm²'
    WHEN 'un'  THEN 'un'
    ELSE NEW.insole_consumption_unit
  END;

  IF NEW.insole_ready_made = true THEN
    NEW.insole_consumption_unit := 'un';
    RETURN NEW;
  END IF;

  IF NEW.sole_group_id IS NOT NULL THEN
    SELECT MAX(sole_classification::text) INTO v_sole_class
      FROM public.products
     WHERE category = 'Solado' AND group_id = NEW.sole_group_id;

    IF v_sole_class = 'palmilha_pronta' THEN
      NEW.insole_consumption_unit := 'un';
      IF NEW.insole_ready_made IS NULL OR NEW.insole_ready_made = false THEN
        NEW.insole_ready_made := true;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) Backfill das linhas legadas (47 com 'dm2' em 31/07/2026).
--    Só a coluna de unidade é tocada; os triggers de UPDATE OF <coluna> não
--    disparam. Os dois BEFORE UPDATE genéricos foram conferidos como inócuos
--    aqui (0 fichas acima do teto de consumo, 0 com direct_components inválido).
UPDATE public.technical_sheets
   SET insole_consumption_unit = 'dm²'
 WHERE lower(trim(COALESCE(insole_consumption_unit, ''))) IN ('', 'dm2');

-- 5) CHECK no canônico.
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT chk_insole_consumption_unit
  CHECK (insole_consumption_unit IN ('dm²', 'un'));

COMMENT ON COLUMN public.technical_sheets.insole_consumption_unit IS
  'Unidade de consumo da palmilha, na grafia CANÔNICA: dm² quando a palmilha é '
  'cortada (Tipo 1/3), un quando é palmilha pronta (Tipo 2).';

NOTIFY pgrst, 'reload schema';
