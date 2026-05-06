CREATE OR REPLACE FUNCTION public.is_admin_or_gerente(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'gerente')
  )
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_or_gerente()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: autenticação requerida' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_or_gerente(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: requer perfil admin ou gerente' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_admin_or_gerente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_admin_or_gerente() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_gerente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_gerente(uuid) TO authenticated;