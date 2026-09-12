-- =============================================================================
-- Reidrata freeze de tiras no confirm/promote de rascunho
-- =============================================================================
-- Sintoma (PV-00194 / NL03 → Em Produção):
--   "PV nao congelou exatamente as linhas de tira da ficha vigente…"
--
-- Causa: enqueue compara o snapshot do item com a ficha vigente, mas
-- confirm/promote de Rascunho NÃO re-roda prepare_sale_order_item_internal_straps.
-- O BEFORE só fecha locks; comentários de preview que falam em "rederiva" estão
-- desatualizados. Ficha editada depois do rascunho (consumo/medida/tipo) deixa
-- strap_colors stale e o promote da lista estoura no freeze.
--
-- Esta migration:
--   1) alinha o portão do prepare ao do BEFORE (service_role/postgres)
--   2) cria private.refresh_draft_strap_freeze_for_confirmation
--   3) injeta a chamada em promote_sale_order_atomic/partial_internal
--      DEPOIS do FOR UPDATE do PV e ANTES do UPDATE de status
-- Mantém o RAISE canônico do enqueue como rede de segurança.
-- Marcador: strap_refresh_on_confirm_20270101023800
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Prepare: permitir cadeia SECURITY DEFINER (postgres/service_role)
-- -----------------------------------------------------------------------------
DO $patch_prepare_gate$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;
$old$;
  v_new text := $new$
  -- strap_refresh_on_confirm_20270101023800
  -- Espelha tg_prepare_sale_order_straps_before_confirmation: a cadeia
  -- SECURITY DEFINER (promote → refresh → prepare) roda como postgres /
  -- service_role sem JWT de comercial, mas o EXECUTE público continua
  -- revogado — cliente autenticado não chama prepare direto.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode preparar as tiras do PV';
  END IF;
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.prepare_sale_order_item_internal_straps(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps(jsonb) ausente';
  END IF;

  v_def := pg_get_functiondef(v_fn);

  IF position('strap_refresh_on_confirm_20270101023800' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);

  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Portão do prepare não encontrado (hits=%); recuse aplicar 23800',
      coalesce(v_hits, 0);
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_prepare_gate$;

-- -----------------------------------------------------------------------------
-- 2. Helper: reidrata itens sem demanda corrente a partir da ficha vigente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.refresh_draft_strap_freeze_for_confirmation(
  p_sale_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_prepared jsonb;
  v_next_item jsonb;
  v_next_colors jsonb;
  v_next_sourcing jsonb;
  v_next_revision integer;
BEGIN
  -- strap_refresh_on_confirm_20270101023800
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatorio para refresh do freeze de tiras';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));

  FOR v_item IN
    SELECT i.*
      FROM public.sale_order_items i
     WHERE i.sale_order_id = p_sale_order_id
       AND i.production_excluded_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_strap_demands d
          WHERE d.sale_order_item_id = i.id
            AND d.is_current
       )
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    v_prepared := public.prepare_sale_order_item_internal_straps(
      jsonb_build_object(
        'id', v_item.id,
        'reference_id', v_item.reference_id,
        'material_variant_id', v_item.material_variant_id,
        'color', v_item.color,
        'strap_colors', coalesce(v_item.strap_colors, '[]'::jsonb),
        'strap_sourcing', coalesce(v_item.strap_sourcing, '{}'::jsonb)
      )
    );

    v_next_item := coalesce(v_prepared -> 'item', '{}'::jsonb);
    v_next_colors := coalesce(v_next_item -> 'strap_colors', '[]'::jsonb);
    v_next_sourcing := coalesce(v_next_item -> 'strap_sourcing', '{}'::jsonb);
    BEGIN
      v_next_revision := nullif(v_next_item ->> 'strap_sourcing_revision', '')::integer;
    EXCEPTION WHEN OTHERS THEN
      v_next_revision := v_item.strap_sourcing_revision;
    END;
    IF v_next_revision IS NULL THEN
      v_next_revision := v_item.strap_sourcing_revision;
    END IF;

    IF v_next_colors IS DISTINCT FROM coalesce(v_item.strap_colors, '[]'::jsonb)
       OR v_next_sourcing IS DISTINCT FROM coalesce(v_item.strap_sourcing, '{}'::jsonb)
       OR v_next_revision IS DISTINCT FROM v_item.strap_sourcing_revision THEN
      UPDATE public.sale_order_items
         SET strap_colors = v_next_colors,
             strap_sourcing = v_next_sourcing,
             strap_sourcing_revision = v_next_revision
       WHERE id = v_item.id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.refresh_draft_strap_freeze_for_confirmation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.refresh_draft_strap_freeze_for_confirmation(uuid) IS
  'Antes do confirm/promote: re-roda prepare nos itens sem demanda corrente para alinhar strap_colors à ficha vigente (evita falso bloqueio de freeze em rascunho stale).';

-- -----------------------------------------------------------------------------
-- 3. Injetar no promote atomic (confirm + promote all-or-nothing)
-- -----------------------------------------------------------------------------
DO $patch_promote_atomic$
DECLARE
  v_fn regprocedure := 'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure;
  v_def text;
  v_old text := $old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_already_target := v_so.status = p_target_status;
$old$;
  v_new text := $new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  -- strap_refresh_on_confirm_20270101023800
  -- Reidrata freeze enquanto o status ainda é Rascunho/Pendente.
  PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);

  v_already_target := v_so.status = p_target_status;
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.promote_sale_order_atomic_internal(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'promote_sale_order_atomic_internal(uuid,text) ausente';
  END IF;

  v_def := pg_get_functiondef(v_fn);

  IF position('strap_refresh_on_confirm_20270101023800' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);

  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Âncora do promote atomic não encontrada (hits=%); recuse aplicar 23800',
      coalesce(v_hits, 0);
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_promote_atomic$;

-- -----------------------------------------------------------------------------
-- 4. Injetar no promote partial (mesmo critério)
-- -----------------------------------------------------------------------------
DO $patch_promote_partial$
DECLARE
  v_fn regprocedure := 'public.promote_sale_order_partial_internal(uuid,text)'::regprocedure;
  v_def text;
  v_old text := $old$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  v_pkg_mode := COALESCE(v_so.packaging_mode, 'individual_amarrado');
$old$;
  v_new text := $new$
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  -- strap_refresh_on_confirm_20270101023800
  PERFORM private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id);

  v_pkg_mode := COALESCE(v_so.packaging_mode, 'individual_amarrado');
$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure('public.promote_sale_order_partial_internal(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'promote_sale_order_partial_internal(uuid,text) ausente';
  END IF;

  v_def := pg_get_functiondef(v_fn);

  IF position('strap_refresh_on_confirm_20270101023800' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0);

  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Âncora do promote partial não encontrada (hits=%); recuse aplicar 23800',
      coalesce(v_hits, 0);
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_promote_partial$;

-- -----------------------------------------------------------------------------
-- 5. Guards pós-condição
-- -----------------------------------------------------------------------------
DO $guards$
DECLARE
  v_helper text;
  v_prepare text;
  v_atomic text;
  v_partial text;
  v_enqueue text;
BEGIN
  IF to_regprocedure(
       'private.refresh_draft_strap_freeze_for_confirmation(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Guard: helper refresh_draft_strap_freeze_for_confirmation ausente';
  END IF;

  v_helper := pg_get_functiondef(
    'private.refresh_draft_strap_freeze_for_confirmation(uuid)'::regprocedure
  );
  v_prepare := pg_get_functiondef(
    'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure
  );
  v_atomic := pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  );
  v_partial := pg_get_functiondef(
    'public.promote_sale_order_partial_internal(uuid,text)'::regprocedure
  );
  v_enqueue := pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  );

  IF position('strap_refresh_on_confirm_20270101023800' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper sem marcador 23800';
  END IF;
  IF position('prepare_sale_order_item_internal_straps' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper deve chamar prepare';
  END IF;
  IF position('sale_order_strap_demands' IN v_helper) = 0
     OR position('is_current' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper deve pular itens com demanda corrente';
  END IF;

  IF position('strap_refresh_on_confirm_20270101023800' IN v_prepare) = 0 THEN
    RAISE EXCEPTION 'Guard: prepare sem portão 23800';
  END IF;

  IF position(
       'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)'
       IN v_atomic
     ) = 0
     OR position('strap_refresh_on_confirm_20270101023800' IN v_atomic) = 0 THEN
    RAISE EXCEPTION 'Guard: promote atomic nao chama refresh';
  END IF;

  IF position(
       'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)'
       IN v_partial
     ) = 0
     OR position('strap_refresh_on_confirm_20270101023800' IN v_partial) = 0 THEN
    RAISE EXCEPTION 'Guard: promote partial nao chama refresh';
  END IF;

  -- Freeze canônico permanece como rede de segurança.
  IF position(
       'PV nao congelou exatamente as linhas de tira da ficha vigente'
       IN v_enqueue
     ) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue perdeu o RAISE de freeze estrutural';
  END IF;
  IF position('private.canonical_strap_freeze_projection' IN v_enqueue) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue sem projecao canonica de freeze';
  END IF;
END;
$guards$;
