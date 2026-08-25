BEGIN;

-- PostgREST usa SET LOCAL ROLE para mapear tanto a chave JWT legada quanto a
-- sb_secret_* ao papel service_role. Dentro de SECURITY DEFINER, current_user
-- vira o owner postgres, mas o setting `role` preserva o caller original.
-- Assim mantemos uma segunda defesa dentro dos corpos sem depender de JWT.
CREATE OR REPLACE FUNCTION public.is_service_role_request_128()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(
           pg_catalog.current_setting('request.jwt.claim.role', true), ''
         ) = 'service_role'
      OR COALESCE(
           pg_catalog.current_setting('role', true), ''
         ) = 'service_role';
$function$;

ALTER FUNCTION public.is_service_role_request_128() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_service_role_request_128()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_service_role_request_128()
  TO service_role;

-- As chaves modernas sb_secret_* nao sao JWTs e, portanto, nao preenchem o
-- GUC legado request.jwt.claim.role. O Data API ainda as converte para o papel
-- PostgreSQL service_role antes de verificar EXECUTE. Como esta funcao precisa
-- ser SECURITY DEFINER para ler o Vault, a fronteira de autorizacao correta e
-- a ACL da propria funcao, fechada abaixo para service_role (alem do owner).
CREATE OR REPLACE FUNCTION public.get_nfe_sync_cron_secret()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $function$
DECLARE
  v_secret text;
BEGIN
  IF NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'get_nfe_sync_cron_secret exige service_role'
      USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'nfe_sync_cron_secret'
   LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nfe_sync_cron_secret não encontrado no vault';
  END IF;

  RETURN v_secret;
END;
$function$;

ALTER FUNCTION public.get_nfe_sync_cron_secret() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_nfe_sync_cron_secret()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_nfe_sync_cron_secret()
  TO service_role;

-- Os demais handlers internos chegaram ao mesmo papel service_role, mas ainda
-- repetiam dentro do corpo a leitura do claim JWT legado. Reconstituir cada
-- definicao a partir do catalogo evita copiar milhares de linhas de logica
-- fiscal/outbox: a migration exige exatamente um guard conhecido, troca
-- somente sua condicao pelo helper compatível e falha fechada se o contrato
-- tiver divergido. Assinaturas, defaults, config, volatilidade e corpo restante
-- sao preservados pelo pg_get_functiondef.
DO $patch_service_role_secret_key_rpcs$
DECLARE
  v_target record;
  v_oid oid;
  v_source text;
  v_patched_source text;
  v_definition text;
  v_guard_count integer;
  v_guard_marker text;
  v_simple_guard text :=
    E'  IF COALESCE(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' THEN\n';
  v_catalog_guard text :=
    E'  IF COALESCE(\n       pg_catalog.current_setting(''request.jwt.claim.role'', true), ''''\n     ) <> ''service_role'' THEN\n';
  v_replacement_guard text :=
    E'  IF NOT public.is_service_role_request_128() THEN\n';
BEGIN
  FOR v_target IN
    SELECT *
      FROM (VALUES
        -- RPCs chamados diretamente por Edge Functions com sb_secret_*.
        ('public.abort_nfe_devolucao_before_provider(uuid,text)', true),
        ('public.begin_nfe_cancellation_command(uuid,text)', true),
        ('public.begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)', true),
        ('public.bind_standalone_nfe_stock_hold(uuid,uuid)', true),
        ('public.claim_nfe_devolucao_provider_submission(uuid,jsonb)', true),
        ('public.claim_sale_order_outbox(text,integer,integer)', true),
        ('public.commit_standalone_nfe_stock_hold(uuid,uuid)', true),
        ('public.complete_nfe_devolucao_command(uuid)', true),
        ('public.complete_sale_order_outbox(uuid,text,uuid,jsonb)', true),
        ('public.fail_sale_order_outbox(uuid,text,uuid,text,integer)', true),
        ('public.mark_nfe_devolucao_reconciliation_required(uuid,text)', true),
        ('public.mark_standalone_nfe_stock_hold_reconciliation(uuid,text)', true),
        ('public.observe_nfe_provider_status_126(uuid,text,jsonb,text)', true),
        ('public.process_sale_order_purchase_shortages(uuid)', true),
        ('public.record_nfe_devolucao_provider_creation(uuid,text,jsonb)', true),
        ('public.record_nfe_devolucao_provider_result(uuid,text,text,text,text,text,text,timestamptz,text,jsonb)', true),
        ('public.record_sale_order_outbox_run(text,integer,integer,integer,integer,integer,jsonb,text)', true),
        ('public.release_stale_standalone_nfe_stock_holds(timestamptz)', true),
        ('public.release_standalone_nfe_stock_hold(uuid,text)', true),

        -- Dependencias transitivas dos caminhos acima.
        ('public.emit_sale_order_purchase_attention(uuid,bigint,text,jsonb)', true),
        ('public.reverse_standalone_nfe_stock_for_cancel(uuid)', true),

        -- Implementacoes privadas chamadas apenas pelos wrappers DEFINER da
        -- migration 126. Continuam owner-only; service_role nao ganha EXECUTE.
        ('public.begin_nfe_cancellation_command_impl_126(uuid,text)', false),
        ('public.abort_nfe_cancellation_command_impl_126(uuid,text)', false),
        ('public.complete_nfe_cancellation_command_impl_126(uuid,text,text)', false)
      ) AS target(signature, grant_service_role)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'RPC esperado nao existe: %', v_target.signature;
    END IF;

    SELECT proc.prosrc, pg_catalog.pg_get_functiondef(proc.oid)
      INTO v_source, v_definition
      FROM pg_catalog.pg_proc proc
     WHERE proc.oid = v_oid
       AND proc.prosecdef
       AND proc.proowner = (
         SELECT role.oid
           FROM pg_catalog.pg_roles role
          WHERE role.rolname = 'postgres'
       );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RPC % nao e SECURITY DEFINER owner postgres',
        v_target.signature;
    END IF;

    v_guard_count := (
      pg_catalog.length(v_source)
      - pg_catalog.length(pg_catalog.replace(
          v_source, 'request.jwt.claim.role', ''
        ))
    ) / pg_catalog.length('request.jwt.claim.role');
    IF v_guard_count <> 1 THEN
      RAISE EXCEPTION 'RPC % deveria ter exatamente 1 guard JWT legado; achou %',
        v_target.signature, v_guard_count;
    END IF;

    v_guard_marker := v_simple_guard;
    IF pg_catalog.strpos(v_source, v_guard_marker) = 0 THEN
      v_guard_marker := v_catalog_guard;
    END IF;
    IF pg_catalog.strpos(v_source, v_guard_marker) = 0 THEN
      RAISE EXCEPTION 'Formato do guard JWT divergiu em %', v_target.signature;
    END IF;

    v_patched_source := pg_catalog.replace(
      v_source, v_guard_marker, v_replacement_guard
    );
    IF pg_catalog.strpos(
      v_patched_source, 'request.jwt.claim.role'
    ) <> 0 THEN
      RAISE EXCEPTION 'Guard JWT sobreviveu ao patch de %', v_target.signature;
    END IF;
    IF pg_catalog.strpos(
      v_patched_source, 'public.is_service_role_request_128()'
    ) = 0 THEN
      RAISE EXCEPTION 'Helper service_role nao entrou em %', v_target.signature;
    END IF;
    IF pg_catalog.strpos(v_definition, v_source) = 0 THEN
      RAISE EXCEPTION 'pg_get_functiondef nao contem prosrc de %',
        v_target.signature;
    END IF;

    v_definition := pg_catalog.replace(
      v_definition, v_source, v_patched_source
    );
    EXECUTE v_definition;
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s OWNER TO postgres', v_target.signature
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_target.signature
    );
    IF v_target.grant_service_role THEN
      EXECUTE pg_catalog.format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role', v_target.signature
      );
    END IF;
  END LOOP;
END;
$patch_service_role_secret_key_rpcs$;

-- Este trigger nao e invocado por ACL: ele roda em toda mudanca de status da
-- NF-e avulsa. Por isso nao podemos simplesmente remover sua defesa interna.
-- O helper distingue service_role de authenticated pelo setting `role`, mesmo
-- sob SECURITY DEFINER, e preserva os dois ramos originais do trigger.
DO $patch_standalone_nfe_status_trigger$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.tg_settle_standalone_nfe_stock()'
  );
  v_source text;
  v_patched_source text;
  v_definition text;
  v_guard_count integer;
  v_deny_guard text :=
    E'  IF COALESCE(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' THEN\n';
  v_allow_guard text :=
    E'  IF COALESCE(current_setting(''request.jwt.claim.role'', true), '''') = ''service_role'' THEN\n';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Trigger function tg_settle_standalone_nfe_stock ausente';
  END IF;
  SELECT proc.prosrc, pg_catalog.pg_get_functiondef(proc.oid)
    INTO v_source, v_definition
    FROM pg_catalog.pg_proc proc
   WHERE proc.oid = v_oid
     AND proc.prosecdef
     AND proc.proowner = (
       SELECT role.oid FROM pg_catalog.pg_roles role
        WHERE role.rolname = 'postgres'
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tg_settle_standalone_nfe_stock nao e DEFINER owner postgres';
  END IF;
  v_guard_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(
        v_source, 'request.jwt.claim.role', ''
      ))
  ) / pg_catalog.length('request.jwt.claim.role');
  IF v_guard_count <> 2
     OR pg_catalog.strpos(v_source, v_deny_guard) = 0
     OR pg_catalog.strpos(v_source, v_allow_guard) = 0 THEN
    RAISE EXCEPTION 'Guards do trigger fiscal divergiram do contrato 107';
  END IF;

  v_patched_source := pg_catalog.replace(
    pg_catalog.replace(
      v_source,
      v_deny_guard,
      E'  IF NOT public.is_service_role_request_128() THEN\n'
    ),
    v_allow_guard,
    E'  IF public.is_service_role_request_128() THEN\n'
  );
  IF pg_catalog.strpos(
    v_patched_source, 'request.jwt.claim.role'
  ) <> 0 THEN
    RAISE EXCEPTION 'Guard JWT sobreviveu no trigger fiscal';
  END IF;
  IF pg_catalog.strpos(v_definition, v_source) = 0 THEN
    RAISE EXCEPTION 'pg_get_functiondef nao contem prosrc do trigger fiscal';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_source, v_patched_source);
  ALTER FUNCTION public.tg_settle_standalone_nfe_stock() OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.tg_settle_standalone_nfe_stock()
    FROM PUBLIC, anon, authenticated, service_role;
END;
$patch_standalone_nfe_status_trigger$;

-- O guard de mutacao do PV possui um bypass fiscal estreito (somente
-- nfe/updated_at/order_version) enquanto existe hold ativo. Ele tambem precisa
-- reconhecer sb_secret para que o settlement autorizado nao seja bloqueado.
DO $patch_standalone_nfe_hold_guard_trigger$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.tg_guard_standalone_nfe_active_hold_mutation()'
  );
  v_source text;
  v_patched_source text;
  v_definition text;
  v_legacy_expression text :=
    E'COALESCE(current_setting(''request.jwt.claim.role'', true), '''') = ''service_role''';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Trigger function de hold standalone ausente';
  END IF;
  SELECT proc.prosrc, pg_catalog.pg_get_functiondef(proc.oid)
    INTO v_source, v_definition
    FROM pg_catalog.pg_proc proc
   WHERE proc.oid = v_oid
     AND proc.prosecdef
     AND proc.proowner = (
       SELECT role.oid FROM pg_catalog.pg_roles role
        WHERE role.rolname = 'postgres'
     );
  IF NOT FOUND
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(pg_catalog.replace(
           v_source, 'request.jwt.claim.role', ''
         ))
     ) / pg_catalog.length('request.jwt.claim.role') <> 1
     OR pg_catalog.strpos(v_source, v_legacy_expression) = 0 THEN
    RAISE EXCEPTION 'Guard do hold standalone divergiu do contrato 107';
  END IF;

  v_patched_source := pg_catalog.replace(
    v_source,
    v_legacy_expression,
    'public.is_service_role_request_128()'
  );
  IF pg_catalog.strpos(
    v_patched_source, 'request.jwt.claim.role'
  ) <> 0 THEN
    RAISE EXCEPTION 'Guard JWT sobreviveu no trigger de hold standalone';
  END IF;
  IF pg_catalog.strpos(v_definition, v_source) = 0 THEN
    RAISE EXCEPTION 'pg_get_functiondef nao contem prosrc do trigger de hold';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_source, v_patched_source);
  ALTER FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation()
    OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.tg_guard_standalone_nfe_active_hold_mutation()
    FROM PUBLIC, anon, authenticated, service_role;
END;
$patch_standalone_nfe_hold_guard_trigger$;

-- Cancelamento e devolucao fiscais atualizam sale_orders/sale_order_items sem o
-- marker de comando comercial. O boundary 115 ja permite service_role, mas
-- reconhecia apenas o claim JWT; trocar so essa igualdade preserva todos os
-- markers estreitos e impede que authenticated contorne o comando canonico.
DO $patch_sale_order_command_boundary_trigger$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure(
    'public.tg_enforce_sale_order_command_boundary()'
  );
  v_source text;
  v_patched_source text;
  v_definition text;
  v_legacy_expression text :=
    E'COALESCE(pg_catalog.current_setting(''request.jwt.claim.role'', true), '''') = ''service_role''';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Trigger function do command boundary ausente';
  END IF;
  SELECT proc.prosrc, pg_catalog.pg_get_functiondef(proc.oid)
    INTO v_source, v_definition
    FROM pg_catalog.pg_proc proc
   WHERE proc.oid = v_oid
     AND proc.prosecdef
     AND proc.proowner = (
       SELECT role.oid FROM pg_catalog.pg_roles role
        WHERE role.rolname = 'postgres'
     );
  IF NOT FOUND
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(pg_catalog.replace(
           v_source, 'request.jwt.claim.role', ''
         ))
     ) / pg_catalog.length('request.jwt.claim.role') <> 1
     OR pg_catalog.strpos(v_source, v_legacy_expression) = 0 THEN
    RAISE EXCEPTION 'Guard do command boundary divergiu do contrato 115';
  END IF;

  v_patched_source := pg_catalog.replace(
    v_source,
    v_legacy_expression,
    'public.is_service_role_request_128()'
  );
  IF pg_catalog.strpos(
    v_patched_source, 'request.jwt.claim.role'
  ) <> 0 THEN
    RAISE EXCEPTION 'Guard JWT sobreviveu no command boundary';
  END IF;
  IF pg_catalog.strpos(v_definition, v_source) = 0 THEN
    RAISE EXCEPTION 'pg_get_functiondef nao contem prosrc do command boundary';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_source, v_patched_source);
  ALTER FUNCTION public.tg_enforce_sale_order_command_boundary()
    OWNER TO postgres;
  REVOKE ALL ON FUNCTION public.tg_enforce_sale_order_command_boundary()
    FROM PUBLIC, anon, authenticated, service_role;
END;
$patch_sale_order_command_boundary_trigger$;

-- Helpers de leitura usados pela emissao (admin) e pela ficha de etiquetas
-- (authenticated) herdaram EXECUTE de PUBLIC. Fechamos apenas a ACL; o corpo e
-- a disponibilidade ao usuario aprovado permanecem inalterados.
ALTER FUNCTION public.compute_sale_order_nfe_volumes(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.compute_sale_order_nfe_volumes(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_sale_order_nfe_volumes(uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.compute_sale_order_box_breakdown(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.compute_sale_order_box_breakdown(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_sale_order_box_breakdown(uuid)
  TO authenticated, service_role;

ALTER FUNCTION public.resolve_item_brand(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_item_brand(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_item_brand(uuid, text, uuid)
  TO authenticated, service_role;

-- Atualiza o contrato introduzido em 109: a protecao continua sendo
-- service-role-only, mas agora e comprovada pela ACL em vez de depender de um
-- claim que nao existe nas chaves secret modernas.
CREATE OR REPLACE FUNCTION public.run_sale_order_outbox_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $contract$
  SELECT 'outbox_worker_functions',
         to_regprocedure(
           'public.claim_sale_order_outbox(text,integer,integer)'
         ) IS NOT NULL
         AND to_regprocedure(
           'public.complete_sale_order_outbox(uuid,text,uuid,jsonb)'
         ) IS NOT NULL
         AND to_regprocedure(
           'public.fail_sale_order_outbox(uuid,text,uuid,text,integer)'
         ) IS NOT NULL,
         'claim/complete/fail finais precisam existir com lock_token'
  UNION ALL
  SELECT 'outbox_single_consumer_api',
         has_function_privilege(
           'service_role',
           'public.claim_sale_order_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.claim_sale_order_command_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.complete_sale_order_command_outbox(uuid,text,uuid)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'service_role',
           'public.fail_sale_order_command_outbox(uuid,text,uuid,text,integer,boolean)',
           'EXECUTE'
         ),
         'somente a API final pode consumir a fila'
  UNION ALL
  SELECT 'outbox_service_role_only',
         NOT has_function_privilege(
           'authenticated',
           'public.claim_sale_order_outbox(text,integer,integer)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.complete_sale_order_outbox(uuid,text,uuid,jsonb)',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.fail_sale_order_outbox(uuid,text,uuid,text,integer)',
           'EXECUTE'
         ),
         'authenticated nao pode controlar a fila'
  UNION ALL
  SELECT 'cron_secret_service_role_acl',
         NOT has_function_privilege(
           'authenticated',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND NOT has_function_privilege(
           'anon',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND has_function_privilege(
           'service_role',
           'public.get_nfe_sync_cron_secret()',
           'EXECUTE'
         )
         AND EXISTS (
           SELECT 1
             FROM pg_proc p
            WHERE p.oid = to_regprocedure(
              'public.get_nfe_sync_cron_secret()'
            )
              AND p.prosecdef
              AND p.proowner = (
                SELECT oid FROM pg_roles WHERE rolname = 'postgres'
              )
              AND p.prosrc NOT LIKE '%request.jwt.claim.role%'
              AND p.prosrc LIKE '%vault.decrypted_secrets%'
              AND NOT EXISTS (
                SELECT 1
                  FROM aclexplode(
                    COALESCE(p.proacl, acldefault('f', p.proowner))
                  ) acl
                 WHERE acl.privilege_type = 'EXECUTE'
                   AND (
                     acl.grantee = 0
                     OR acl.grantee NOT IN (
                       p.proowner,
                       (SELECT oid FROM pg_roles WHERE rolname = 'service_role')
                     )
                   )
              )
         ),
         'segredo so pode ser lido pelo owner e pelo papel service_role'
  UNION ALL
  SELECT 'purchase_shortage_versioned_effect',
         to_regclass('public.sale_order_purchase_shortage_effects') IS NOT NULL
         AND NOT has_table_privilege(
           'authenticated',
           'public.sale_order_purchase_shortage_effects',
           'SELECT'
         )
         AND NOT has_function_privilege(
           'authenticated',
           'public.process_sale_order_purchase_shortages(uuid)',
           'EXECUTE'
         ),
         'efeito de compra versionado precisa ser interno'
  UNION ALL
  SELECT 'purchase_digest_protects_human_state',
         EXISTS (
           SELECT 1
             FROM pg_proc p
            WHERE p.oid = to_regprocedure(
              'public.sale_order_outbox_purchase_order_digest(uuid)'
            )
              AND p.prosrc LIKE '%source_pv_ids%'
              AND p.prosrc LIKE '%linked_sale_order_ids%'
              AND p.prosrc LIKE '%approval_preflight_token%'
              AND p.prosrc LIKE '%approval_preflight_by%'
              AND p.prosrc LIKE '%approval_preflight_actor_name%'
              AND p.prosrc LIKE '%approval_preflight_at%'
              AND p.prosrc LIKE '%approval_preflight_revision%'
              AND p.prosrc LIKE '%approval_preflight_digest%'
         ),
         'digest precisa detectar vinculos e preflight antes de qualquer overwrite'
  UNION ALL
  SELECT 'outbox_cron_registered',
         NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
         OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sale-order-outbox'),
         'cron precisa disparar o worker quando pg_cron existe';
$contract$;

REVOKE ALL ON FUNCTION public.run_sale_order_outbox_contract_tests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_sale_order_outbox_contract_tests()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_service_role_secret_key_acl_contract_128()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $contract_128$
  WITH service_surface(signature) AS (
    VALUES
      ('public.abort_nfe_devolucao_before_provider(uuid,text)'),
      ('public.begin_nfe_cancellation_command(uuid,text)'),
      ('public.begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)'),
      ('public.bind_standalone_nfe_stock_hold(uuid,uuid)'),
      ('public.claim_nfe_devolucao_provider_submission(uuid,jsonb)'),
      ('public.claim_sale_order_outbox(text,integer,integer)'),
      ('public.commit_standalone_nfe_stock_hold(uuid,uuid)'),
      ('public.complete_nfe_devolucao_command(uuid)'),
      ('public.complete_sale_order_outbox(uuid,text,uuid,jsonb)'),
      ('public.emit_sale_order_purchase_attention(uuid,bigint,text,jsonb)'),
      ('public.fail_sale_order_outbox(uuid,text,uuid,text,integer)'),
      ('public.get_nfe_sync_cron_secret()'),
      ('public.mark_nfe_devolucao_reconciliation_required(uuid,text)'),
      ('public.mark_standalone_nfe_stock_hold_reconciliation(uuid,text)'),
      ('public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'),
      ('public.process_sale_order_purchase_shortages(uuid)'),
      ('public.record_nfe_devolucao_provider_creation(uuid,text,jsonb)'),
      ('public.record_nfe_devolucao_provider_result(uuid,text,text,text,text,text,text,timestamptz,text,jsonb)'),
      ('public.record_sale_order_outbox_run(text,integer,integer,integer,integer,integer,jsonb,text)'),
      ('public.release_stale_standalone_nfe_stock_holds(timestamptz)'),
      ('public.release_standalone_nfe_stock_hold(uuid,text)'),
      ('public.reverse_standalone_nfe_stock_for_cancel(uuid)')
  ),
  owner_surface(signature) AS (
    VALUES
      ('public.begin_nfe_cancellation_command_impl_126(uuid,text)'),
      ('public.abort_nfe_cancellation_command_impl_126(uuid,text)'),
      ('public.complete_nfe_cancellation_command_impl_126(uuid,text,text)')
  ),
  service_functions AS (
    SELECT surface.signature, proc.*
      FROM service_surface surface
      LEFT JOIN pg_catalog.pg_proc proc
        ON proc.oid = pg_catalog.to_regprocedure(surface.signature)
  ),
  owner_functions AS (
    SELECT surface.signature, proc.*
      FROM owner_surface surface
      LEFT JOIN pg_catalog.pg_proc proc
        ON proc.oid = pg_catalog.to_regprocedure(surface.signature)
  ),
  roles AS (
    SELECT
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres') AS postgres_oid,
      (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role') AS service_oid
  )
  SELECT 'service_role_rpc_surface',
         pg_catalog.count(*) = 22
         AND pg_catalog.bool_and(
           fn.oid IS NOT NULL
           AND fn.prosecdef
           AND fn.proowner = roles.postgres_oid
           AND pg_catalog.strpos(
             fn.prosrc, 'request.jwt.claim.role'
           ) = 0
           AND pg_catalog.strpos(
             fn.prosrc, 'public.is_service_role_request_128()'
           ) > 0
           AND pg_catalog.has_function_privilege(
             'service_role', fn.oid, 'EXECUTE'
           )
           AND NOT pg_catalog.has_function_privilege(
             'authenticated', fn.oid, 'EXECUTE'
           )
           AND NOT pg_catalog.has_function_privilege(
             'anon', fn.oid, 'EXECUTE'
           )
           AND NOT EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   fn.proacl,
                   pg_catalog.acldefault('f', fn.proowner)
                 )
               ) acl
              WHERE acl.privilege_type = 'EXECUTE'
                AND (
                  acl.grantee = 0
                  OR acl.grantee NOT IN (
                    roles.postgres_oid, roles.service_oid
                  )
                )
           )
         ),
         '22 RPCs/transitivas aceitam sb_secret apenas via helper e ACL service_role'
    FROM service_functions fn CROSS JOIN roles
  UNION ALL
  SELECT 'owner_only_implementation_surface',
         pg_catalog.count(*) = 3
         AND pg_catalog.bool_and(
           fn.oid IS NOT NULL
           AND fn.prosecdef
           AND fn.proowner = roles.postgres_oid
           AND pg_catalog.strpos(
             fn.prosrc, 'request.jwt.claim.role'
           ) = 0
           AND pg_catalog.strpos(
             fn.prosrc, 'public.is_service_role_request_128()'
           ) > 0
           AND NOT pg_catalog.has_function_privilege(
             'service_role', fn.oid, 'EXECUTE'
           )
           AND NOT pg_catalog.has_function_privilege(
             'authenticated', fn.oid, 'EXECUTE'
           )
           AND NOT pg_catalog.has_function_privilege(
             'anon', fn.oid, 'EXECUTE'
           )
           AND NOT EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   fn.proacl,
                   pg_catalog.acldefault('f', fn.proowner)
                 )
               ) acl
              WHERE acl.privilege_type = 'EXECUTE'
                AND (
                  acl.grantee = 0
                  OR acl.grantee <> roles.postgres_oid
                )
           )
         ),
         'implementacoes 126 continuam acessiveis somente pelo owner/wrapper'
    FROM owner_functions fn CROSS JOIN roles
  UNION ALL
  SELECT 'service_role_context_helper',
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc proc
            WHERE proc.oid = pg_catalog.to_regprocedure(
              'public.is_service_role_request_128()'
            )
              AND NOT proc.prosecdef
              AND proc.proowner = roles.postgres_oid
              AND pg_catalog.strpos(
                proc.prosrc, 'request.jwt.claim.role'
              ) > 0
              AND pg_catalog.strpos(
                proc.prosrc, 'current_setting(''role'', true)'
              ) > 0
              AND pg_catalog.has_function_privilege(
                'service_role', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'authenticated', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'anon', proc.oid, 'EXECUTE'
              )
         ),
         'helper aceita JWT legado ou SET LOCAL ROLE da chave secret'
    FROM roles
  UNION ALL
  SELECT 'standalone_status_trigger_context',
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc proc
            WHERE proc.oid = pg_catalog.to_regprocedure(
              'public.tg_settle_standalone_nfe_stock()'
            )
              AND proc.prosecdef
              AND proc.proowner = roles.postgres_oid
              AND pg_catalog.strpos(
                proc.prosrc, 'request.jwt.claim.role'
              ) = 0
              AND (
                pg_catalog.length(proc.prosrc)
                - pg_catalog.length(pg_catalog.replace(
                    proc.prosrc,
                    'public.is_service_role_request_128()',
                    ''
                  ))
              ) / pg_catalog.length(
                'public.is_service_role_request_128()'
              ) = 2
              AND NOT pg_catalog.has_function_privilege(
                'service_role', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'authenticated', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'anon', proc.oid, 'EXECUTE'
              )
         ),
         'trigger diferencia service_role/authenticated sem abrir EXECUTE'
    FROM roles
  UNION ALL
  SELECT 'standalone_active_hold_guard_context',
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc proc
            WHERE proc.oid = pg_catalog.to_regprocedure(
              'public.tg_guard_standalone_nfe_active_hold_mutation()'
            )
              AND proc.prosecdef
              AND proc.proowner = roles.postgres_oid
              AND pg_catalog.strpos(
                proc.prosrc, 'request.jwt.claim.role'
              ) = 0
              AND pg_catalog.strpos(
                proc.prosrc, 'public.is_service_role_request_128()'
              ) > 0
              AND NOT pg_catalog.has_function_privilege(
                'service_role', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'authenticated', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'anon', proc.oid, 'EXECUTE'
              )
         ),
         'bypass fiscal estreito do hold reconhece sb_secret sem abrir EXECUTE'
    FROM roles
  UNION ALL
  SELECT 'sale_order_command_boundary_context',
         EXISTS (
           SELECT 1
             FROM pg_catalog.pg_proc proc
            WHERE proc.oid = pg_catalog.to_regprocedure(
              'public.tg_enforce_sale_order_command_boundary()'
            )
              AND proc.prosecdef
              AND proc.proowner = roles.postgres_oid
              AND pg_catalog.strpos(
                proc.prosrc, 'request.jwt.claim.role'
              ) = 0
              AND pg_catalog.strpos(
                proc.prosrc, 'public.is_service_role_request_128()'
              ) > 0
              AND pg_catalog.strpos(
                proc.prosrc, 'app.sale_order_command_internal'
              ) > 0
              AND NOT pg_catalog.has_function_privilege(
                'service_role', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'authenticated', proc.oid, 'EXECUTE'
              )
              AND NOT pg_catalog.has_function_privilege(
                'anon', proc.oid, 'EXECUTE'
              )
         ),
         'boundary fiscal reconhece sb_secret e preserva marker de comando'
    FROM roles
  UNION ALL
  SELECT 'nfe_read_helpers_acl',
         pg_catalog.bool_and(
           proc.oid IS NOT NULL
           AND proc.proowner = roles.postgres_oid
           AND pg_catalog.has_function_privilege(
             'authenticated', proc.oid, 'EXECUTE'
           )
           AND pg_catalog.has_function_privilege(
             'service_role', proc.oid, 'EXECUTE'
           )
           AND NOT pg_catalog.has_function_privilege(
             'anon', proc.oid, 'EXECUTE'
           )
           AND NOT EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   proc.proacl,
                   pg_catalog.acldefault('f', proc.proowner)
                 )
               ) acl
              WHERE acl.privilege_type = 'EXECUTE'
                AND (
                  acl.grantee = 0
                  OR acl.grantee NOT IN (
                    roles.postgres_oid,
                    roles.service_oid,
                    (
                      SELECT oid FROM pg_catalog.pg_roles
                       WHERE rolname = 'authenticated'
                    )
                  )
                )
           )
         ),
         'helpers de leitura preservam authenticated/service_role e removem PUBLIC/anon'
    FROM (VALUES
      ('public.compute_sale_order_nfe_volumes(uuid)'),
      ('public.compute_sale_order_box_breakdown(uuid)'),
      ('public.resolve_item_brand(uuid,text,uuid)')
    ) helper(signature)
    LEFT JOIN pg_catalog.pg_proc proc
      ON proc.oid = pg_catalog.to_regprocedure(helper.signature)
    CROSS JOIN roles;
$contract_128$;

ALTER FUNCTION public.run_service_role_secret_key_acl_contract_128()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.run_service_role_secret_key_acl_contract_128()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_service_role_secret_key_acl_contract_128()
  TO service_role;

-- Self-test sem SELECT do valor: simula exatamente uma secret key moderna,
-- isto e, papel service_role sem request.jwt.claim.role. PERFORM descarta o
-- segredo; a ausencia do segredo no ambiente de replay e aceita explicitamente.
SELECT pg_catalog.set_config('request.jwt.claim.role', '', true);
SET LOCAL ROLE service_role;
DO $service_role_self_test$
DECLARE
  v_failed text;
  v_result jsonb;
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'service_role'
     OR NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'helper 128 nao reconheceu SET LOCAL ROLE service_role';
  END IF;

  SELECT pg_catalog.string_agg(test.case_name || ': ' || test.detail, '; ')
    INTO v_failed
    FROM public.run_service_role_secret_key_acl_contract_128() test
   WHERE NOT test.ok;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Contrato service-role/sb_secret falhou: %', v_failed;
  END IF;

  BEGIN
    PERFORM public.get_nfe_sync_cron_secret();
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'nfe_sync_cron_secret não encontrado no vault' THEN
        RAISE;
      END IF;
  END;

  -- Entradas invalidas atingem validacoes de dominio antes de qualquer DML.
  -- Se algum guard JWT legado sobrevivesse, estes blocos receberiam 42501.
  BEGIN
    PERFORM public.claim_sale_order_outbox('', 1, 300);
    RAISE EXCEPTION 'claim aceitou worker_id vazio no self-test';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.process_sale_order_purchase_shortages(NULL);
    RAISE EXCEPTION 'process shortages aceitou PV nulo no self-test';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.record_sale_order_outbox_run(
      '', 0, 0, 0, 0, 0, '{}'::jsonb, NULL
    );
    RAISE EXCEPTION 'heartbeat aceitou worker_id vazio no self-test';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.observe_nfe_provider_status_126(
      NULL, 'processando', '{}'::jsonb, 'migration-128-self-test'
    );
    RAISE EXCEPTION 'observe aceitou nfe_id nulo no self-test';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  v_result := public.release_standalone_nfe_stock_hold(
    NULL, 'migration 128 self-test'
  );
  IF v_result ->> 'code' IS DISTINCT FROM 'hold_not_found' THEN
    RAISE EXCEPTION 'release nulo nao retornou hold_not_found: %', v_result;
  END IF;
END;
$service_role_self_test$;
RESET ROLE;

-- Clientes precisam ser barrados pela ACL antes que o corpo SECURITY DEFINER
-- possa tocar o Vault. Nenhum destes testes seleciona ou imprime o segredo.
SET LOCAL ROLE authenticated;
DO $authenticated_self_test$
DECLARE
  v_target record;
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'authenticated'
     OR COALESCE(
          pg_catalog.current_setting('request.jwt.claim.role', true), ''
        ) = 'service_role'
     OR COALESCE(
          pg_catalog.current_setting('role', true), ''
        ) = 'service_role' THEN
    RAISE EXCEPTION 'contexto authenticated foi classificado como service_role';
  END IF;

  BEGIN
    PERFORM public.is_service_role_request_128();
    RAISE EXCEPTION 'authenticated conseguiu executar helper 128';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_nfe_sync_cron_secret();
    RAISE EXCEPTION 'authenticated conseguiu executar get_nfe_sync_cron_secret';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.claim_sale_order_outbox(text,integer,integer)'),
      ('public.process_sale_order_purchase_shortages(uuid)'),
      ('public.release_stale_standalone_nfe_stock_holds(timestamptz)'),
      ('public.observe_nfe_provider_status_126(uuid,text,jsonb,text)'),
      ('public.begin_nfe_devolucao_command(uuid,uuid,jsonb,text,uuid)')
    ) AS target(signature)
  LOOP
    IF pg_catalog.has_function_privilege(
      'authenticated', v_target.signature, 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'authenticated reteve EXECUTE em %', v_target.signature;
    END IF;
  END LOOP;
END;
$authenticated_self_test$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $anon_self_test$
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'anon' THEN
    RAISE EXCEPTION 'SET LOCAL ROLE anon nao foi preservado';
  END IF;
  BEGIN
    PERFORM public.is_service_role_request_128();
    RAISE EXCEPTION 'anon conseguiu executar helper 128';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_nfe_sync_cron_secret();
    RAISE EXCEPTION 'anon conseguiu executar get_nfe_sync_cron_secret';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_self_test$;
RESET ROLE;

COMMIT;
