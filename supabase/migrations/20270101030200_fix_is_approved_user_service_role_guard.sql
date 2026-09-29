-- is_approved_user() e user_has_any_role() ainda usavam só
-- request.jwt.claim.role = 'service_role'. Com sb_secret_* esse GUC vem
-- vazio, então o worker de materialização (e qualquer Edge com a chave
-- moderna) falhava em "Permission denied: usuário não aprovado" mesmo
-- depois de claim/execute terem sido corrigidos (30000/30100).
--
-- Estes dois helpers são a fonte da maioria dos guards do ERP — alinhar
-- ao is_service_role_request_128() restaura o bypass de service_role
-- que o código sempre pretendeu.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_service_role_request_128()
      OR EXISTS (
        SELECT 1
          FROM public.profiles p
         WHERE p.id = auth.uid()
           AND p.approved = true
      );
$$;

CREATE OR REPLACE FUNCTION public.user_has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_service_role_request_128()
      OR (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid() AND p.approved = true
        )
        AND EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.role::text = ANY(roles)
        )
      );
$$;

-- preflight / build_sale_order_material_plan também checam o GUC legado
-- diretamente (além de is_approved_user). Patch cirúrgico dos guards
-- remanescentes nessas duas, que estão no caminho hot do promote.
DO $patch_promote_path_guards$
DECLARE
  v_sig text;
  v_oid oid;
  v_definition text;
  v_patched text;
  v_legacy_neq text :=
    E'COALESCE(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role''';
  v_replacement text := 'NOT public.is_service_role_request_128()';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.preflight_sale_order_command(uuid,text,bigint,uuid)',
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)',
    'public.build_sale_order_material_plan(uuid)'
  ]
  LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      -- Assinatura pode ter mudado; tenta achar por nome.
      SELECT p.oid INTO v_oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = split_part(split_part(v_sig, '(', 1), '.', 2)
       ORDER BY p.oid
       LIMIT 1;
    END IF;
    IF v_oid IS NULL THEN
      RAISE NOTICE 'RPC % ausente — pulando', v_sig;
      CONTINUE;
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    IF position('request.jwt.claim.role' IN v_definition) = 0 THEN
      RAISE NOTICE '% já sem guard JWT legado', v_sig;
      CONTINUE;
    END IF;

    v_patched := replace(v_definition, v_legacy_neq, v_replacement);
    IF position('request.jwt.claim.role' IN v_patched) > 0 THEN
      -- Tenta formato com COALESCE multilinha simples (espaços variáveis).
      v_patched := regexp_replace(
        v_definition,
        'COALESCE\(\s*current_setting\(''request\.jwt\.claim\.role'',\s*true\),\s*''''\s*\)\s*<>\s*''service_role''',
        v_replacement,
        'g'
      );
    END IF;
    IF position('request.jwt.claim.role' IN v_patched) > 0 THEN
      RAISE EXCEPTION '% ainda tem request.jwt.claim.role após patch', v_sig;
    END IF;
    EXECUTE v_patched;
  END LOOP;
END;
$patch_promote_path_guards$;

-- Reabre o job do PV-00196 com NOVA idempotency_key — reusar a chave
-- antiga devolve o receipt failed ("usuário não aprovado") verbatim sem
-- reexecutar o promote (contrato de execute_sale_order_command).
UPDATE public.sale_order_materialization_jobs j
   SET status = 'pending',
       attempts = 0,
       last_error = NULL,
       available_at = now(),
       completed_at = NULL,
       locked_at = NULL,
       locked_by = NULL,
       lock_token = NULL,
       idempotency_key = j.idempotency_key || ':retry:' || gen_random_uuid()::text,
       updated_at = now()
  FROM public.sale_orders so
 WHERE so.id = j.sale_order_id
   AND so.order_number = 'PV-00196'
   AND j.status IN ('failed', 'dead_letter', 'pending');

UPDATE public.sale_orders so
   SET command_phase = 'processing',
       command_error = NULL,
       command_target_status = COALESCE(so.command_target_status, 'Em Produção'),
       command_job_id = j.id,
       command_started_at = COALESCE(so.command_started_at, now()),
       updated_at = now()
  FROM public.sale_order_materialization_jobs j
 WHERE j.sale_order_id = so.id
   AND so.order_number = 'PV-00196'
   AND j.status = 'pending';

COMMIT;
