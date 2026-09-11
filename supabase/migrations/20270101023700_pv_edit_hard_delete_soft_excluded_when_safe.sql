-- =============================================================================
-- NOTA DE CARIMBO (2026-09-11)
-- Este arquivo foi renomeado de 20270101023300 → 20270101023700 porque o
-- carimbo 23300 no banco já pertence a consumo_recipe_yield_fallback_presentation
-- (colisão entre worktrees). O SQL abaixo JÁ está aplicado em produção via a
-- cadeia 23300-histórica → 23400 → 23500 (marcadores vivos em finalize/guard/
-- release). A versão 20270101023700 está REGISTRADA em schema_migrations SEM
-- reexecutar o corpo — reaplicar regressaria o finalize da 23500.
-- =============================================================================

-- =============================================================================
-- PV edit: segunda remoção de item soft-excluded → hard-delete quando seguro
-- =============================================================================
-- Sintoma (PV-00169 /sales/edit/41ce3fd8-…, I702 OFF WHITE):
--   Item já "RETIRADO DA PRODUÇÃO" (production_excluded_at) com demandas
--   canceladas, contribuições canceladas e OPs Cancelada — mas a lixeira some
--   e finalize_removed SEMPRE re-preserva itens já excluídos. Soft-preserve
--   vira porta sem saída: a linha comercial morta não sai do editor.
--
-- Causa:
--   1) finalize classifica qualquer production_excluded_at em v_preserve e
--      CONTINUA (nunca hard-delete).
--   2) tg_guard_sale_order_item_production_exclusion barre DELETE de linha
--      soft-excluded sem GUC interno.
--   3) DELETE em finalize exige production_excluded_at IS NULL.
--   4) purchase_demand_contributions (mesmo cancelled) é ON DELETE RESTRICT —
--      hard-delete estoura FK sem limpar contribuições terminais.
--   5) UI esconde a lixeira e removeItem recusa item preservado.
--
-- Correção:
--   A) Guard de exclusão: DELETE liberado com GUC interno (writer).
--   B) BEFORE DELETE: apaga contribuições terminais (cancelled/superseded/rejected)
--      antes do RESTRICT.
--   C) finalize: item JÁ soft-excluded que sai do payload → hard-delete se
--      seguro (sem claim/OS return/compromisso externo/compra avançada);
--      senão mantém histórico. Soft-preserve da 1ª remoção permanece.
--   D) DELETE do finalize inclui soft-excluded (com GUC) e limpa contribs
--      terminais antes.
--
-- Marcador: pv_edit_hard_delete_soft_excluded_20270101023300
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_guard_sale_order_item_production_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal boolean := COALESCE(
    pg_catalog.current_setting(
      'app.sale_order_item_production_exclusion_internal',
      true
    ),
    ''
  ) = '1';
  v_changed boolean;
  v_production_identity_changed boolean := false;
BEGIN
  -- pv_edit_hard_delete_soft_excluded_20270101023300
  IF TG_OP = 'DELETE' THEN
    -- Soft-excluded só apaga via writer (GUC). Sem GUC, preserve histórico.
    IF OLD.production_excluded_at IS NOT NULL AND NOT v_internal THEN
      RAISE EXCEPTION 'Item retirado da producao nao pode ser apagado; preserve a linha historica'
        USING ERRCODE = 'PZ240';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := NEW.production_excluded_at IS NOT NULL
      OR NEW.production_excluded_by IS NOT NULL
      OR NEW.production_exclusion_reason IS NOT NULL
      OR NEW.production_exclusion_request_id IS NOT NULL;
  ELSE
    v_changed := NEW.production_excluded_at IS DISTINCT FROM OLD.production_excluded_at
      OR NEW.production_excluded_by IS DISTINCT FROM OLD.production_excluded_by
      OR NEW.production_exclusion_reason IS DISTINCT FROM OLD.production_exclusion_reason
      OR NEW.production_exclusion_request_id IS DISTINCT FROM OLD.production_exclusion_request_id;

    IF OLD.production_excluded_at IS NOT NULL THEN
      v_production_identity_changed := (
        pg_catalog.to_jsonb(NEW) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      ) IS DISTINCT FROM (
        pg_catalog.to_jsonb(OLD) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      );
    END IF;
  END IF;

  IF v_production_identity_changed THEN
    RAISE EXCEPTION 'Item retirado da producao e imutavel; preserve a linha historica'
      USING ERRCODE = 'PZ240';
  END IF;

  IF v_changed AND NOT v_internal THEN
    RAISE EXCEPTION 'Retirada produtiva do item exige o comando administrativo da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF v_changed
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: retirada produtiva exige Administrador/Gerencia/Comercial'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_release_strap_demands_before_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_blocked uuid;
  v_variants uuid[] := '{}'::uuid[];
  v_variant uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  -- strap_demand_item_fk_set_null_20270101022100
  -- pv_edit_hard_delete_soft_excluded_20270101023300
  IF EXISTS (
    SELECT 1
      FROM public.nfe_devolucao_item_claims c
     WHERE c.sale_order_item_id = OLD.id
       AND c.status IS DISTINCT FROM 'released'
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha claim de devolucao NF-e vinculado'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.service_order_return_items r
     WHERE r.sale_order_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha retorno de OS vinculado'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT d.id INTO v_blocked
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id = OLD.id
     AND public.strap_demand_has_external_commitment(d.id)
   LIMIT 1;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: demanda de tira com compromisso externo (OS enviada/recibo/custodia)'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.sale_order_item_id = OLD.id
       AND c.status NOT IN ('cancelled', 'superseded', 'rejected')
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha contribuicao de compra de tira ativa. Use a retirada produtiva.'
      USING ERRCODE = 'P0001';
  END IF;

  -- RESTRICT em purchase_demand_contributions: contribuições terminais
  -- precisam sumir antes do DELETE do item (histórico de OC fica no
  -- superseded_purchase_order_*).
  DELETE FROM public.purchase_demand_contributions c
   WHERE c.sale_order_item_id = OLD.id
     AND c.status IN ('cancelled', 'superseded', 'rejected');

  SELECT coalesce(array_agg(DISTINCT d.strap_variant_id), '{}'::uuid[])
    INTO v_variants
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id = OLD.id
     AND d.is_current
     AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled');

  UPDATE public.sale_order_strap_demands d
     SET cancelled_m = greatest(0, d.gross_required_m - coalesce(d.fulfilled_m, 0)),
         status = 'cancelled',
         correlation_id = v_correlation,
         updated_at = now()
   WHERE d.sale_order_item_id = OLD.id
     AND d.is_current
     AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
     AND coalesce(d.fulfilled_m, 0) = 0
     AND NOT public.strap_demand_has_external_commitment(d.id);

  FOREACH v_variant IN ARRAY v_variants
  LOOP
    PERFORM public.reconcile_strap_variant(
      v_variant,
      v_correlation,
      'sale_order_item_deleted'
    );
  END LOOP;

  RETURN OLD;
END;
$function$;

-- finalize_removed_sale_order_items: NÃO recriar aqui.
-- A definição viva (com command boundary) está em
-- 20270101023500_pv_edit_hard_delete_sets_command_boundary.sql.
-- Reaplicar o corpo antigo desta migration regressaria a 23500.
-- Marcador histórico preservado nos comentários das migrations 234/235:
--   pv_edit_hard_delete_soft_excluded_20270101023300


REVOKE ALL ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  TO service_role;

DO $$
DECLARE
  v_finalize text;
  v_guard text;
  v_release text;
BEGIN
  v_finalize := pg_get_functiondef(
    'private.finalize_removed_sale_order_items(uuid,uuid[],uuid)'::regprocedure
  );
  IF position('pv_edit_hard_delete_soft_excluded_20270101023300' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize sem marcador 23300';
  END IF;
  IF position('v_already_excluded' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize nao classifica soft-excluded pra hard-delete';
  END IF;
  IF position('AND i.production_excluded_at IS NULL' IN v_finalize) > 0 THEN
    RAISE EXCEPTION 'Guard: DELETE do finalize ainda exige production_excluded_at IS NULL';
  END IF;

  v_guard := pg_get_functiondef(
    'public.tg_guard_sale_order_item_production_exclusion()'::regprocedure
  );
  IF position('pv_edit_hard_delete_soft_excluded_20270101023300' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Guard: tg_guard sem marcador 23300';
  END IF;
  IF position('AND NOT v_internal' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Guard: DELETE soft-excluded nao libera com GUC interno';
  END IF;

  v_release := pg_get_functiondef(
    'public.tg_release_strap_demands_before_item_delete()'::regprocedure
  );
  IF position('pv_edit_hard_delete_soft_excluded_20270101023300' IN v_release) = 0 THEN
    RAISE EXCEPTION 'Guard: tg_release sem marcador 23300';
  END IF;
  IF position('DELETE FROM public.purchase_demand_contributions' IN v_release) = 0 THEN
    RAISE EXCEPTION 'Guard: tg_release nao limpa contribuicoes terminais';
  END IF;
END;
$$;
