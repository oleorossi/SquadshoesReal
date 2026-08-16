-- =============================================================================
-- Tiras artesanais — hardening pós-deploy de helpers herdados
-- =============================================================================
-- O motor canônico não usa mais order_strap_needs no cliente, mas RPCs
-- internas antigas ainda podem chamá-la. Mantemos authenticated/service_role
-- por compatibilidade e retiramos o EXECUTE anônimo herdado do CREATE FUNCTION.
-- A função de trigger de capacidade nunca é uma RPC e não precisa de EXECUTE
-- direto para continuar sendo disparada pelo PostgreSQL.

DO $$
BEGIN
  IF to_regprocedure('public.order_strap_needs(jsonb,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'order_strap_needs(jsonb,numeric,jsonb) ausente no hardening';
  END IF;
  IF to_regprocedure('public.tg_validate_strap_daily_capacity()') IS NULL THEN
    RAISE EXCEPTION 'tg_validate_strap_daily_capacity() ausente no hardening';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.order_strap_needs(jsonb,numeric,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_strap_needs(jsonb,numeric,jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tg_validate_strap_daily_capacity()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege(
       'anon','public.order_strap_needs(jsonb,numeric,jsonb)','EXECUTE')
     OR NOT has_function_privilege(
       'authenticated','public.order_strap_needs(jsonb,numeric,jsonb)','EXECUTE')
     OR has_function_privilege(
       'anon','public.tg_validate_strap_daily_capacity()','EXECUTE')
     OR has_function_privilege(
       'authenticated','public.tg_validate_strap_daily_capacity()','EXECUTE') THEN
    RAISE EXCEPTION 'ACL pós-deploy de tiras divergente';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
     WHERE p.oid IN (
       'public.order_strap_needs(jsonb,numeric,jsonb)'::regprocedure,
       'public.tg_validate_strap_daily_capacity()'::regprocedure
     )
       AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC ainda executa helper SECURITY DEFINER de tiras';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger t
     WHERE t.tgname='trg_validate_strap_daily_capacity'
       AND t.tgrelid='public.strap_executor_daily_capacity_allocations'::regclass
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Trigger de capacidade diária ausente após hardening';
  END IF;
END;
$$;
