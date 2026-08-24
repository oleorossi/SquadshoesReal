-- Protege a RPC canônica de apontamento no MESMO nível de `can_edit` das UIs.
--
-- Antes desta migration, `apontar_producao_setor` era SECURITY DEFINER e só
-- exigia `is_approved_user()`: ocultar botões para uma pessoa somente-leitura
-- não impedia que ela chamasse a RPC diretamente. A função pública agora é um
-- portão fino; a implementação operacional fica inacessível ao Data API.
--
-- O timestamp foi normalizado para depois de 20270101009200 porque o relógio
-- lógico das migrations deste repositório está adiantado em relação ao relógio
-- civil usado pelo `supabase migration new`.

CREATE OR REPLACE FUNCTION public.can_execute_production_pointing()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_granular boolean := false;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;

  -- Admin ignora allow-list granular, igual ao `isActionAllowed` do frontend.
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role::text = 'admin'
  ) THEN
    RETURN true;
  END IF;

  -- Só rows que CONCEDEM visualização ativam o modo granular. Rows negativas
  -- isoladas não desligam o RBAC legado no frontend e não desligam aqui.
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;

  IF v_has_granular THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.user_permissions up
       WHERE up.user_id = v_user_id
         AND up.can_view
         AND (
           -- Grant legado por módulo: a UI mantém ações liberadas por
           -- retrocompatibilidade, mesmo sem flags CRUD por path.
           up.module IN ('producao', 'ordens')
           OR (
             up.module IN (
               '/producao/kanban',
               '/producao/apontamento',
               '/producao/analises',
               '/orders'
             )
             AND up.can_edit
           )
         )
    );
  END IF;

  -- Sem allow-list: espelha ROLE_MODULES + a regra histórica "ver ⇒ agir".
  RETURN EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role::text IN ('gerente', 'producao', 'consulta')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_production_pointing()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.can_execute_production_pointing() IS
  'Autoriza a RPC compartilhada pelas telas de Kanban, apontamento, análises e ordens; uso interno do portão server-side.';

-- O apply_migration do MCP e o db push podem executar este SQL sob carimbos
-- diferentes neste projeto. O guard torna a troca repetível: na primeira
-- execução preserva a implementação existente; nas seguintes mantém o wrapper.
DO $migration$
BEGIN
  IF to_regprocedure(
    'public.apontar_producao_setor_impl(uuid,text,integer,uuid,text,boolean,text[])'
  ) IS NULL THEN
    ALTER FUNCTION public.apontar_producao_setor(
      uuid, text, integer, uuid, text, boolean, text[]
    ) RENAME TO apontar_producao_setor_impl;
  END IF;
END;
$migration$;

-- A implementação é privilegiada e não pode ser chamada pelo Data API.
REVOKE ALL ON FUNCTION public.apontar_producao_setor_impl(
  uuid, text, integer, uuid, text, boolean, text[]
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apontar_producao_setor_impl(
  uuid, text, integer, uuid, text, boolean, text[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.apontar_producao_setor(
  p_order_id uuid,
  p_stage_name text,
  p_quantity integer,
  p_operator_employee_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_finalize boolean DEFAULT false,
  p_confirmed_warnings text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_execute_production_pointing() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Permission denied: usuário sem permissão de edição para apontar produção';
  END IF;

  RETURN public.apontar_producao_setor_impl(
    p_order_id,
    p_stage_name,
    p_quantity,
    p_operator_employee_id,
    p_note,
    p_finalize,
    p_confirmed_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) TO authenticated, service_role;

COMMENT ON FUNCTION public.apontar_producao_setor(
  uuid, text, integer, uuid, text, boolean, text[]
) IS 'Portão autorizado de apontamento: exige usuário aprovado e permissão de edição no Kanban de Produção.';
