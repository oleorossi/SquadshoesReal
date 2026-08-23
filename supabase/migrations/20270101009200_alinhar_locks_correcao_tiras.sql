-- Complemento operacional da 091.
--
-- A 091 substituiu o retry infinito por conflitos HTTP e tornou o writer em
-- lote fail-fast. Esta migration também coloca o helper unitário público sob o
-- MESMO advisory lock antes de sua primeira trava de linha. Sem esse invólucro,
-- helper e batch ainda podiam adquirir mapa/ficha em ordem inversa e formar um
-- deadlock raro. O corpo auditado da 091 é preservado como implementação
-- privada; somente o wrapper serializado permanece executável pelos clientes.

BEGIN;

-- O apply_migration registra uma versão operacional própria. Se o CI reenviar
-- o arquivo versionado depois disso, a implementação privada já existe; nesse
-- caso preservamos o corpo e apenas reconstruímos o wrapper abaixo.
DO $preserve_impl$
BEGIN
  IF to_regprocedure(
       'public.resolve_technical_strap_line_migration_locked_impl_091(uuid,uuid,text)'
     ) IS NULL THEN
    ALTER FUNCTION public.resolve_technical_strap_line_migration(uuid, uuid, text)
      RENAME TO resolve_technical_strap_line_migration_locked_impl_091;
  END IF;
END;
$preserve_impl$;

REVOKE ALL ON FUNCTION
  public.resolve_technical_strap_line_migration_locked_impl_091(uuid, uuid, text)
FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION
  public.resolve_technical_strap_line_migration_locked_impl_091(uuid, uuid, text)
SET lock_timeout TO '1500ms';

CREATE OR REPLACE FUNCTION public.resolve_technical_strap_line_migration(
  p_map_id uuid,
  p_measure_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '1500ms'
AS $serialized_single_line$
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('strap-pv-auto-intent', 0)
  ) THEN
    RAISE SQLSTATE 'PGRST' USING
      MESSAGE = jsonb_build_object(
        'code', 'strap_pipeline_busy',
        'message', 'Outra alteracao de tiras ou pedido esta em andamento',
        'details', format('scope=global; map_id=%s', p_map_id),
        'hint', 'Aguarde a operacao atual terminar e tente novamente uma vez.'
      )::text,
      DETAIL = '{"status":409}';
  END IF;

  RETURN public.resolve_technical_strap_line_migration_locked_impl_091(
    p_map_id,
    p_measure_id,
    p_reason
  );
END;
$serialized_single_line$;

REVOKE ALL ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text)
TO authenticated, service_role;

ALTER FUNCTION public.resolve_technical_strap_context_from_sale_order(
  uuid, uuid, jsonb, text, timestamptz
)
SET lock_timeout TO '1500ms';

COMMENT ON FUNCTION
  public.resolve_technical_strap_line_migration(uuid, uuid, text) IS
  'Wrapper serializado do helper unitário: adquire o lock global antes de qualquer row lock e devolve HTTP 409 quando o pipeline está ocupado.';

COMMENT ON FUNCTION
  public.resolve_technical_strap_line_migration_locked_impl_091(uuid, uuid, text) IS
  'Implementação privada preservada da migration 091. Chamar somente pelo wrapper resolve_technical_strap_line_migration.';

DO $assert_lock_order$
DECLARE
  v_wrapper_def text;
  v_batch_config text[];
  v_wrapper_config text[];
BEGIN
  SELECT pg_get_functiondef(oid), proconfig
    INTO v_wrapper_def, v_wrapper_config
    FROM pg_proc
   WHERE oid =
     'public.resolve_technical_strap_line_migration(uuid,uuid,text)'::regprocedure;

  SELECT proconfig
    INTO v_batch_config
    FROM pg_proc
   WHERE oid =
     'public.resolve_technical_strap_context_from_sale_order(uuid,uuid,jsonb,text,timestamptz)'::regprocedure;

  IF position('pg_try_advisory_xact_lock' IN v_wrapper_def) = 0
     OR position('strap-pv-auto-intent' IN v_wrapper_def) = 0
     OR position('strap_pipeline_busy' IN v_wrapper_def) = 0
     OR position('''40001''' IN v_wrapper_def) > 0 THEN
    RAISE EXCEPTION 'Helper público perdeu o lock global fail-fast';
  END IF;

  IF NOT ('lock_timeout=1500ms' = ANY(coalesce(v_wrapper_config, ARRAY[]::text[])))
     OR NOT ('lock_timeout=1500ms' = ANY(coalesce(v_batch_config, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'RPCs de correção perderam o limite de espera por row lock';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.resolve_technical_strap_line_migration_locked_impl_091(uuid,uuid,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.resolve_technical_strap_line_migration_locked_impl_091(uuid,uuid,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Implementação sem serialização continua exposta';
  END IF;
END;
$assert_lock_order$;

COMMIT;
