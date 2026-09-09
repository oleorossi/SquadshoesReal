-- Custos de mão de obra e precificação são dados financeiros. Leitura exige
-- conta aprovada; escrita exige admin/gerente. A migration também remove
-- TRUNCATE/REFERENCES/TRIGGER de clientes comuns e fecha o bypass da RPC que
-- cria setor produtivo com custo-hora.

BEGIN;

DO $preflight$
DECLARE
  v_table text;
  v_policy text;
BEGIN
  IF to_regprocedure('public.is_approved_user()') IS NULL
     OR to_regprocedure('public.user_has_any_role(text[])') IS NULL
     OR to_regprocedure(
       'public.create_production_sector(text,text,boolean,numeric)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight: helpers de autorização obrigatórios ausentes';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'labor_cost_results',
    'sector_labor_rates',
    'reference_sector_pricing'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Preflight: tabela financeira ausente: public.%', v_table;
    END IF;

    FOR v_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = v_table
         AND policyname NOT IN (
           'Auth users can view ' || v_table,
           'Auth users can insert ' || v_table,
           'Auth users can update ' || v_table,
           'Auth users can delete ' || v_table,
           'cost_read_approved',
           'cost_write_admin_manager',
           'financial_cost_read_approved',
           'financial_cost_write_admin_manager',
           'financial_cost_insert_admin_manager',
           'financial_cost_update_admin_manager',
           'financial_cost_delete_admin_manager'
         )
    LOOP
      RAISE EXCEPTION
        'Preflight: policy financeira desconhecida em public.%: %',
        v_table,
        v_policy;
    END LOOP;
  END LOOP;
END
$preflight$;

DO $financial_rls$
DECLARE
  v_table text;
  v_policy text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'labor_cost_results',
    'sector_labor_rates',
    'reference_sector_pricing'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table
    );

    -- RLS não protege TRUNCATE. Primeiro zera o ACL e depois devolve só CRUD.
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I '
      || 'FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I '
      || 'TO authenticated',
      v_table
    );
    EXECUTE format(
      'GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',
      v_table
    );

    FOR v_policy IN
      SELECT policyname
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_policy, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY financial_cost_read_approved '
      || 'ON public.%I FOR SELECT TO authenticated '
      || 'USING ((SELECT public.is_approved_user()))',
      v_table
    );

    -- Uma policy por comando evita que FOR ALL se sobreponha à policy de
    -- leitura e gere múltiplas policies permissivas em cada SELECT.
    EXECUTE format(
      $policy$
      CREATE POLICY financial_cost_insert_admin_manager
        ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (
          (SELECT public.is_approved_user())
          AND (SELECT public.user_has_any_role(
            ARRAY['admin'::text, 'gerente'::text]
          ))
        )
      $policy$,
      v_table
    );

    EXECUTE format(
      $policy$
      CREATE POLICY financial_cost_update_admin_manager
        ON public.%I
        FOR UPDATE
        TO authenticated
        USING (
          (SELECT public.is_approved_user())
          AND (SELECT public.user_has_any_role(
            ARRAY['admin'::text, 'gerente'::text]
          ))
        )
        WITH CHECK (
          (SELECT public.is_approved_user())
          AND (SELECT public.user_has_any_role(
            ARRAY['admin'::text, 'gerente'::text]
          ))
        )
      $policy$,
      v_table
    );

    EXECUTE format(
      $policy$
      CREATE POLICY financial_cost_delete_admin_manager
        ON public.%I
        FOR DELETE
        TO authenticated
        USING (
          (SELECT public.is_approved_user())
          AND (SELECT public.user_has_any_role(
            ARRAY['admin'::text, 'gerente'::text]
          ))
        )
      $policy$,
      v_table
    );
  END LOOP;
END
$financial_rls$;

-- Preserva a definição viva da RPC e injeta somente o RBAC que faltava.
DO $create_sector_rbac$
DECLARE
  v_function regprocedure :=
    'public.create_production_sector(text,text,boolean,numeric)'::regprocedure;
  v_definition text;
  v_hardened text;
  v_anchor text := E'\nBEGIN\n  IF NOT public.is_approved_user() THEN';
BEGIN
  v_definition := pg_get_functiondef(v_function);

  IF position('[rbac:create_production_sector:v1]' IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Preflight: âncora de create_production_sector não encontrada';
    END IF;

    v_hardened := replace(
      v_definition,
      v_anchor,
      E'\nBEGIN\n'
      || E'  -- [rbac:create_production_sector:v1]\n'
      || E'  IF NOT COALESCE(public.user_has_any_role(\n'
      || E'       ARRAY[''admin''::text, ''gerente''::text]\n'
      || E'     ), false) THEN\n'
      || E'    RAISE EXCEPTION '
      || E'''Permission denied: somente admin ou gerente cria setor produtivo''\n'
      || E'      USING ERRCODE = ''42501'';\n'
      || E'  END IF;\n\n'
      || E'  IF NOT public.is_approved_user() THEN'
    );

    IF v_hardened = v_definition
       OR position(
         '[rbac:create_production_sector:v1]' IN v_hardened
       ) = 0 THEN
      RAISE EXCEPTION 'Não foi possível proteger create_production_sector';
    END IF;

    EXECUTE v_hardened;
  END IF;
END
$create_sector_rbac$;

REVOKE ALL ON FUNCTION
  public.create_production_sector(text,text,boolean,numeric)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.create_production_sector(text,text,boolean,numeric)
  TO authenticated;

DO $verify$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'labor_cost_results',
    'sector_labor_rates',
    'reference_sector_pricing'
  ]
  LOOP
    IF has_table_privilege(
      'anon', format('public.%I', v_table), 'SELECT'
    ) THEN
      RAISE EXCEPTION 'Verify: anon ainda acessa public.%', v_table;
    END IF;

    IF NOT has_table_privilege(
      'authenticated', format('public.%I', v_table), 'SELECT'
    ) OR NOT has_table_privilege(
      'authenticated', format('public.%I', v_table), 'INSERT'
    ) OR NOT has_table_privilege(
      'authenticated', format('public.%I', v_table), 'UPDATE'
    ) OR NOT has_table_privilege(
      'authenticated', format('public.%I', v_table), 'DELETE'
    ) THEN
      RAISE EXCEPTION 'Verify: CRUD autenticado incompleto em public.%', v_table;
    END IF;

    IF has_table_privilege(
      'authenticated', format('public.%I', v_table), 'TRUNCATE'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'REFERENCES'
    ) OR has_table_privilege(
      'authenticated', format('public.%I', v_table), 'TRIGGER'
    ) THEN
      RAISE EXCEPTION 'Verify: privilégio estrutural sobreviveu em public.%',
        v_table;
    END IF;

    IF (
      SELECT count(*)
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = v_table
    ) <> 4 OR (
      SELECT count(*)
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = v_table
         AND policyname IN (
           'financial_cost_read_approved',
           'financial_cost_insert_admin_manager',
           'financial_cost_update_admin_manager',
           'financial_cost_delete_admin_manager'
         )
    ) <> 4 THEN
      RAISE EXCEPTION 'Verify: policies canônicas incompletas em public.%',
        v_table;
    END IF;
  END LOOP;

  IF position(
    '[rbac:create_production_sector:v1]'
    IN pg_get_functiondef(
      'public.create_production_sector(text,text,boolean,numeric)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Verify: RBAC de create_production_sector ausente';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.create_production_sector(text,text,boolean,numeric)',
       'EXECUTE'
     ) OR has_function_privilege(
       'service_role',
       'public.create_production_sector(text,text,boolean,numeric)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated',
       'public.create_production_sector(text,text,boolean,numeric)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Verify: ACL de create_production_sector incorreto';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
