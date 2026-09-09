-- =============================================================================
-- product_group_layers: triggers do grupo não podem falhar por GRANT
-- =============================================================================
-- Salvar um grupo em /estoque (organização) disparava:
--
--   Erro ao salvar: permission denied for table product_group_layers
--
-- A tabela só concede SELECT a `authenticated`. INSERT/UPDATE/DELETE passam
-- pela RPC `save_product_group_layers` (SECURITY DEFINER). Mas dois triggers
-- em `product_groups` leem/escrevem `product_group_layers` como INVOKER:
--
--   1. trg_sync_upper_material_name_on_group_rename
--      AFTER UPDATE OF name → UPDATE component_label
--   2. trg_guard_referenced_group_stays_leaf
--      BEFORE INSERT/UPDATE OF parent_group_id → SELECT nas camadas
--
-- `UPDATE OF coluna` no PostgreSQL dispara só de a coluna estar no SET, mesmo
-- com valor igual. O save do diálogo manda `name` e `parent_group_id` sempre.
-- Se o nome mudou (ou o trigger tentou o UPDATE), o operador levava o 42501
-- e o grupo NÃO salvava — inclusive flags de "varia por cor" / "linha com
-- variantes", que nem tocam composição.
--
-- Correção:
--   * os dois triggers (e o validador da camada, encadeado no UPDATE do
--     rótulo) passam a SECURITY DEFINER, como a RPC já era;
--   * WHEN no trigger de rename: só roda se o nome mudou de verdade;
--   * reafirma GRANT SELECT only — cliente continua sem escrever na tabela.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_sync_upper_material_name_on_group_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.technical_sheets ts
       SET upper_material = NEW.name
     WHERE ts.upper_material_group_id = NEW.id
       AND ts.upper_material IS DISTINCT FROM NEW.name;

    UPDATE public.product_group_layers l
       SET component_label = NEW.name
     WHERE l.component_group_id = NEW.id
       AND l.component_label IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_sync_upper_material_name_on_group_rename
  ON public.product_groups;
CREATE TRIGGER trg_sync_upper_material_name_on_group_rename
  AFTER UPDATE OF name ON public.product_groups
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.fn_sync_upper_material_name_on_group_rename();

CREATE OR REPLACE FUNCTION public.fn_guard_referenced_group_stays_leaf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.parent_group_id IS NULL
     OR (
       TG_OP = 'UPDATE'
       AND NEW.parent_group_id IS NOT DISTINCT FROM OLD.parent_group_id
     ) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('group-leaf-reference:' || NEW.parent_group_id::text, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.technical_sheets ts
     WHERE ts.upper_material_group_id = NEW.parent_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.product_group_layers l
     WHERE l.composite_group_id = NEW.parent_group_id
        OR l.component_group_id = NEW.parent_group_id
  ) THEN
    RAISE EXCEPTION
      'A família de destino está referenciada como grupo-folha técnico e não pode receber subgrupos.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_validate_product_group_layer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text;
  v_lock_group_id uuid;
BEGIN
  IF TG_OP = 'INSERT'
     OR (
       TG_OP = 'UPDATE'
       AND (
         NEW.composite_group_id IS DISTINCT FROM OLD.composite_group_id
         OR NEW.component_group_id IS DISTINCT FROM OLD.component_group_id
       )
     ) THEN
    FOR v_lock_group_id IN
      SELECT DISTINCT u.group_id
        FROM unnest(ARRAY[NEW.composite_group_id, NEW.component_group_id]::uuid[]) AS u(group_id)
       WHERE u.group_id IS NOT NULL
       ORDER BY u.group_id
    LOOP
      PERFORM pg_advisory_xact_lock(
        hashtextextended('group-leaf-reference:' || v_lock_group_id::text, 0)
      );
    END LOOP;
  END IF;

  SELECT g.name INTO v_name
    FROM public.product_groups g
   WHERE g.id = NEW.composite_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo composto % não encontrado.', NEW.composite_group_id
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_groups c
     WHERE c.parent_group_id = NEW.composite_group_id
  ) THEN
    RAISE EXCEPTION 'O grupo composto % deve ser grupo-folha.', v_name
      USING ERRCODE = '23514';
  END IF;

  IF NEW.component_group_id IS NOT NULL THEN
    SELECT g.name INTO v_name
      FROM public.product_groups g
     WHERE g.id = NEW.component_group_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo constituinte % não encontrado.', NEW.component_group_id
        USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.product_groups c
       WHERE c.parent_group_id = NEW.component_group_id
    ) THEN
      RAISE EXCEPTION 'O grupo constituinte % deve ser grupo-folha.', v_name
        USING ERRCODE = '23514';
    END IF;
    NEW.component_label := v_name;
  ELSIF nullif(btrim(NEW.component_label), '') IS NULL THEN
    RAISE EXCEPTION 'Informe component_group_id ou component_label para a camada.'
      USING ERRCODE = '23514';
  ELSE
    NEW.component_label := btrim(NEW.component_label);
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON TABLE public.product_group_layers FROM anon;
REVOKE ALL ON TABLE public.product_group_layers FROM authenticated;
GRANT SELECT ON TABLE public.product_group_layers TO authenticated;
GRANT ALL ON TABLE public.product_group_layers TO service_role;

COMMIT;
