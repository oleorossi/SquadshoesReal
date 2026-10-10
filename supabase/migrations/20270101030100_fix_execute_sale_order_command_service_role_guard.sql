-- Continuação da 30000: o claim do worker passou a autenticar com
-- is_service_role_request_128(), mas execute_sale_order_command e os
-- helpers can_execute_* ainda usavam o guard JWT legado. Com sb_secret_*
-- o GUC request.jwt.claim.role vem vazio → "Papel sem permissão para
-- executar o comando promote" e o job falha depois do claim.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helpers pequenos: REPLACE completo
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_execute_sale_order_command(
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_has_granular boolean := false;
BEGIN
  IF public.is_service_role_request_128() THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role::text = 'admin'
  ) THEN
    RETURN true;
  END IF;
  IF v_action NOT IN ('create', 'edit') THEN
    RETURN false;
  END IF;

  -- Espelha isActionAllowed: somente grants positivos de visualização ativam
  -- a allow-list. Sem granular, o caller preserva o RBAC legado por papel.
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND (
         -- Grant legado por módulo continua concedendo a ação inteira.
         up.module = 'vendas'
         OR (
           up.module = '/sales'
           AND CASE WHEN v_action = 'create'
             THEN up.can_create
             ELSE up.can_edit
           END
         )
       )
  );
END;
$$;

-- Owner-only: chamado só de dentro de execute_sale_order_command (DEFINER).
REVOKE ALL ON FUNCTION public.can_execute_sale_order_command(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_execute_sale_order_finance_command()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_granular boolean;
BEGIN
  IF public.is_service_role_request_128() THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND up.can_edit
       AND up.module IN ('financeiro', '/financeiro', '/finance')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_sale_order_finance_command()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. execute_sale_order_command: patch cirúrgico dos 4 guards JWT legados
-- ---------------------------------------------------------------------------

DO $patch_execute_sale_order_command_service_role$
DECLARE
  v_oid oid;
  v_definition text;
  v_patched text;
  v_jwt_hits integer;
  v_legacy_neq text :=
    E'COALESCE(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''';
  v_legacy_neq_multiline text :=
    E'COALESCE(\n'
    || E'               current_setting(''request.jwt.claim.role'', true),\n'
    || E'               ''''\n'
    || E'             ) <> ''service_role''';
  v_replacement text := 'NOT public.is_service_role_request_128()';
BEGIN
  v_oid := 'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'execute_sale_order_command ausente';
  END IF;

  v_definition := pg_get_functiondef(v_oid);
  v_jwt_hits := (
    length(v_definition)
    - length(replace(v_definition, 'request.jwt.claim.role', ''))
  ) / length('request.jwt.claim.role');
  IF v_jwt_hits < 1 THEN
    RAISE NOTICE 'execute_sale_order_command já sem guard JWT legado (% hits)', v_jwt_hits;
    RETURN;
  END IF;

  v_patched := replace(v_definition, v_legacy_neq_multiline, v_replacement);
  v_patched := replace(v_patched, v_legacy_neq, v_replacement);

  IF position('request.jwt.claim.role' IN v_patched) > 0 THEN
    RAISE EXCEPTION
      'execute_sale_order_command ainda tem request.jwt.claim.role após patch (formato divergiu)';
  END IF;
  IF position('is_service_role_request_128()' IN v_patched) = 0 THEN
    RAISE EXCEPTION 'patch de execute_sale_order_command não inseriu o helper';
  END IF;

  EXECUTE v_patched;
END;
$patch_execute_sale_order_command_service_role$;

-- Libera o job do PV-00196 (e qualquer failed ainda com tentativas) para
-- retry imediato — available_at estava no futuro por causa do backoff.
UPDATE public.sale_order_materialization_jobs
   SET available_at = now(),
       updated_at = now()
 WHERE status = 'failed'
   AND attempts < max_attempts
   AND available_at > now();

COMMIT;
