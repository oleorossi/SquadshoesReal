-- =============================================================================
-- Restaura public.v_employee_punch_pattern (Pendências de Ponto)
-- =============================================================================
-- Sintoma (19/10/2026): /rh?tab=ponto&subtab=pendencias →
--   relation "public.v_employee_punch_pattern" does not exist
--
-- Causa: a mig 20270101029600 moveu a view pra `private` porque a guarda
-- `pg_depend` não vê referência em corpo de FUNCTION. A
-- `suggest_punches_for_record` (e portanto `v_time_pendings.suggestion`)
-- ainda lê `public.v_employee_punch_pattern` — o SELECT da aba quebra.
--
-- Esta migration:
--   1. devolve a view a `public` (se ainda estiver só em private);
--   2. restaura GRANT SELECT pra authenticated/service_role;
--   3. endurece `_org_move_view_if_unreferenced` pra também varrer
--      `pg_proc.prosrc` — evita repetir a classe de bug;
--   4. pede reload do schema cache PostgREST.
--
-- Marcador: restore_v_employee_punch_pattern_public_20270101044100
-- =============================================================================

DO $restore$
DECLARE
  v_in_private boolean;
  v_in_public boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private'
      AND c.relname = 'v_employee_punch_pattern'
      AND c.relkind = 'v'
  ) INTO v_in_private;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'v_employee_punch_pattern'
      AND c.relkind = 'v'
  ) INTO v_in_public;

  IF v_in_private AND NOT v_in_public THEN
    ALTER VIEW private.v_employee_punch_pattern SET SCHEMA public;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'v_employee_punch_pattern'
      AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION
      'restore_v_employee_punch_pattern_public_20270101044100: public.v_employee_punch_pattern ausente após restore';
  END IF;
END;
$restore$;

REVOKE ALL ON TABLE public.v_employee_punch_pattern FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_employee_punch_pattern TO authenticated, service_role;

COMMENT ON VIEW public.v_employee_punch_pattern IS
  'Padrão de batidas por funcionário (medianas 60d + escala). Usada por '
  'suggest_punches_for_record → coluna suggestion de v_time_pendings. '
  'NÃO mover pra private: pg_depend não enxerga a referência no corpo da função '
  '(incidente 19/10/2026 / mig 29600).';

-- Guarda endurecida: além de pg_depend, bloquear se algum corpo de função em
-- public/private citar o nome da view (schema-qualified ou não).
CREATE OR REPLACE FUNCTION private._org_move_view_if_unreferenced(p_view text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_oid oid;
  v_deps int;
  v_body_refs int;
BEGIN
  SELECT c.oid INTO v_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = p_view
     AND c.relkind = 'v';

  IF v_oid IS NULL THEN
    RETURN false;
  END IF;

  SELECT count(*)::int INTO v_deps
    FROM pg_depend d
    JOIN pg_class dc ON dc.oid = d.objid
    JOIN pg_namespace dn ON dn.oid = dc.relnamespace
   WHERE d.refobjid = v_oid
     AND d.deptype IN ('n', 'a')
     AND dn.nspname = 'public'
     AND dc.oid <> v_oid;

  IF v_deps > 0 THEN
    RAISE NOTICE 'organize: skip view %.% — % dependentes public',
      'public', p_view, v_deps;
    RETURN false;
  END IF;

  -- Funções SQL/plpgsql guardam o nome como texto — pg_depend não registra.
  SELECT count(*)::int INTO v_body_refs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
     AND p.prosrc ~* ('\m' || p_view || '\M');

  IF v_body_refs > 0 THEN
    RAISE NOTICE 'organize: skip view %.% — % referências em prosrc',
      'public', p_view, v_body_refs;
    RETURN false;
  END IF;

  EXECUTE format('ALTER VIEW public.%I SET SCHEMA private', p_view);
  EXECUTE format(
    'REVOKE ALL ON TABLE private.%I FROM PUBLIC, anon, authenticated, service_role',
    p_view
  );
  RAISE NOTICE 'organize: moved view public.% → private.%', p_view, p_view;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION private._org_move_view_if_unreferenced(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Smoke: a view resolve e a coluna suggestion da fila não explode.
DO $smoke$
DECLARE
  v_n int;
BEGIN
  SELECT count(*)::int INTO v_n FROM public.v_employee_punch_pattern;
  PERFORM 1 FROM public.v_time_pendings LIMIT 1;
  RAISE NOTICE 'restore_v_employee_punch_pattern_public_20270101044100: ok (pattern rows=%)', v_n;
END;
$smoke$;

NOTIFY pgrst, 'reload schema';
