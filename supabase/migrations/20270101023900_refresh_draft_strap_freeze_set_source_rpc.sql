-- =============================================================================
-- Refresh do freeze no confirm: autorizar UPDATE de strap_sourcing via GUC
-- =============================================================================
-- Sintoma (PV-00194 Aprovar após 23800):
--   "Atualizacao direta de strap_sourcing bloqueada; use a RPC com revisao esperada"
--
-- Causa: private.refresh_draft_strap_freeze_for_confirmation fazia UPDATE em
-- strap_sourcing sem setar app.strap_source_rpc='1'. O trigger
-- tg_version_and_guard_sale_order_item_strap_sourcing (03200) exige esse GUC
-- (mesmo padrão de update_sale_order_with_teardown / set_sale_order_item_strap_sourcing).
--
-- Esta migration:
--   1) CREATE OR REPLACE do helper com set_config antes do UPDATE
--   2) não grava strap_sourcing_revision à mão (o trigger incrementa/restaura)
--   3) se só cores mudarem, UPDATE só de strap_colors (evita coluna guardada)
-- Marcador: strap_refresh_source_rpc_20270101023900
-- =============================================================================

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
  v_colors_changed boolean;
  v_sourcing_changed boolean;
BEGIN
  -- strap_refresh_source_rpc_20270101023900
  -- (substitui o corpo de strap_refresh_on_confirm_20270101023800)
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

    v_colors_changed := v_next_colors IS DISTINCT FROM coalesce(v_item.strap_colors, '[]'::jsonb);
    v_sourcing_changed := v_next_sourcing IS DISTINCT FROM coalesce(v_item.strap_sourcing, '{}'::jsonb);

    IF NOT v_colors_changed AND NOT v_sourcing_changed THEN
      CONTINUE;
    END IF;

    IF v_sourcing_changed THEN
      -- Mesmo token dos writers canônicos (03200): libera o guard de UPDATE.
      PERFORM set_config('app.strap_source_rpc', '1', true);
      UPDATE public.sale_order_items
         SET strap_colors = v_next_colors,
             strap_sourcing = v_next_sourcing
       WHERE id = v_item.id;
      -- strap_sourcing_revision: o trigger incrementa; não gravar à mão.
    ELSE
      -- Só estrutura/consumo da ficha: não toca na coluna guardada.
      UPDATE public.sale_order_items
         SET strap_colors = v_next_colors
       WHERE id = v_item.id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.refresh_draft_strap_freeze_for_confirmation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.refresh_draft_strap_freeze_for_confirmation(uuid) IS
  'Antes do confirm/promote: re-roda prepare nos itens sem demanda corrente; '
  'grava strap_sourcing só com app.strap_source_rpc=1 (guard 03200).';

-- -----------------------------------------------------------------------------
-- Guards pós-condição
-- -----------------------------------------------------------------------------
DO $guards$
DECLARE
  v_helper text;
  v_atomic text;
  v_partial text;
BEGIN
  IF to_regprocedure(
       'private.refresh_draft_strap_freeze_for_confirmation(uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Guard: helper refresh_draft_strap_freeze_for_confirmation ausente';
  END IF;

  v_helper := pg_get_functiondef(
    'private.refresh_draft_strap_freeze_for_confirmation(uuid)'::regprocedure
  );
  v_atomic := pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  );
  v_partial := pg_get_functiondef(
    'public.promote_sale_order_partial_internal(uuid,text)'::regprocedure
  );

  IF position('strap_refresh_source_rpc_20270101023900' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper sem marcador 23900';
  END IF;
  IF position('app.strap_source_rpc' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper deve setar app.strap_source_rpc antes do UPDATE';
  END IF;
  IF position('set_config' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'Guard: helper deve usar set_config para o GUC';
  END IF;
  -- Não deve mais atribuir revision à mão no UPDATE.
  IF position('strap_sourcing_revision =' IN v_helper) > 0
     OR position('strap_sourcing_revision=' IN v_helper) > 0 THEN
    RAISE EXCEPTION 'Guard: helper nao deve gravar strap_sourcing_revision a mao';
  END IF;

  IF position(
       'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)'
       IN v_atomic
     ) = 0 THEN
    RAISE EXCEPTION 'Guard: promote atomic nao chama refresh';
  END IF;
  IF position(
       'private.refresh_draft_strap_freeze_for_confirmation(p_sale_order_id)'
       IN v_partial
     ) = 0 THEN
    RAISE EXCEPTION 'Guard: promote partial nao chama refresh';
  END IF;
END;
$guards$;
