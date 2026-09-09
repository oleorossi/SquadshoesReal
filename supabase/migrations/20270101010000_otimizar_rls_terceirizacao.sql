-- Evita reavaliar identidade/permissão para cada linha das configurações de
-- terceirização. Os subselects não correlacionados viram init plans: o contrato
-- de acesso permanece idêntico, mas cada expressão é calculada uma vez por
-- statement.

ALTER POLICY reference_terceirizacoes_select_approved
  ON public.reference_terceirizacoes
  TO authenticated
  USING ((SELECT public.is_approved_user()));

ALTER POLICY reference_terceirizacoes_insert_privileged
  ON public.reference_terceirizacoes
  TO authenticated, service_role
  WITH CHECK (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(
      (SELECT pg_catalog.current_setting('request.jwt.claim.role', true)),
      ''
    ) = 'service_role'
    OR (
      (SELECT public.is_approved_user())
      AND (SELECT public.user_has_any_role(
        ARRAY['admin', 'gerente', 'producao']
      ))
    )
  );

ALTER POLICY reference_terceirizacoes_update_privileged
  ON public.reference_terceirizacoes
  TO authenticated, service_role
  USING (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(
      (SELECT pg_catalog.current_setting('request.jwt.claim.role', true)),
      ''
    ) = 'service_role'
    OR (
      (SELECT public.is_approved_user())
      AND (SELECT public.user_has_any_role(
        ARRAY['admin', 'gerente', 'producao']
      ))
    )
  )
  WITH CHECK (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(
      (SELECT pg_catalog.current_setting('request.jwt.claim.role', true)),
      ''
    ) = 'service_role'
    OR (
      (SELECT public.is_approved_user())
      AND (SELECT public.user_has_any_role(
        ARRAY['admin', 'gerente', 'producao']
      ))
    )
  );

ALTER POLICY reference_terceirizacoes_delete_privileged
  ON public.reference_terceirizacoes
  TO authenticated, service_role
  USING (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(
      (SELECT pg_catalog.current_setting('request.jwt.claim.role', true)),
      ''
    ) = 'service_role'
    OR (
      (SELECT public.is_approved_user())
      AND (SELECT public.user_has_any_role(
        ARRAY['admin', 'gerente', 'producao']
      ))
    )
  );
