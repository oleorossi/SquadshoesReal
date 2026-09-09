-- =============================================================================
-- Belt-and-suspenders: FK de demanda de tira não pode bloquear DELETE do item
-- =============================================================================
-- A 22000 soft-exclude no writer. Esta migration muda a FK residual pra
-- ON DELETE SET NULL (coluna passa a aceitar NULL): qualquer caminho legado
-- que ainda hard-delete o item solta a demanda sem apagar o fato histórico
-- (sale_order_id permanece). BEFORE DELETE cancela saldo reversível e barra
-- compromisso externo.
-- Marcador: strap_demand_item_fk_set_null_20270101022100
-- =============================================================================

ALTER TABLE public.sale_order_strap_demands
  ALTER COLUMN sale_order_item_id DROP NOT NULL;

ALTER TABLE public.sale_order_strap_demands
  DROP CONSTRAINT IF EXISTS sale_order_strap_demands_sale_order_item_id_fkey;

ALTER TABLE public.sale_order_strap_demands
  ADD CONSTRAINT sale_order_strap_demands_sale_order_item_id_fkey
  FOREIGN KEY (sale_order_item_id)
  REFERENCES public.sale_order_items(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.sale_order_strap_demands.sale_order_item_id IS
  'Item do PV que originou a demanda. NULL após remoção do item — o fato '
  'histórico permanece amarrado em sale_order_id. strap_demand_item_fk_set_null_20270101022100';

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

  -- purchase_demand_contributions exige sale_order_item_id NOT NULL no shape
  -- pv_automatico. Sem soft-exclude, um DELETE cru ainda estoura essa FK.
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

REVOKE ALL ON FUNCTION public.tg_release_strap_demands_before_item_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_aa_release_strap_demands_before_item_delete
  ON public.sale_order_items;
CREATE TRIGGER trg_aa_release_strap_demands_before_item_delete
  BEFORE DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_release_strap_demands_before_item_delete();

DO $$
DECLARE
  v_con text;
  v_nullable boolean;
  v_trg text;
BEGIN
  SELECT pg_get_constraintdef(c.oid),
         (SELECT NOT attnotnull
            FROM pg_attribute a
           WHERE a.attrelid = c.conrelid
             AND a.attname = 'sale_order_item_id')
    INTO v_con, v_nullable
    FROM pg_constraint c
   WHERE c.conrelid = 'public.sale_order_strap_demands'::regclass
     AND c.conname = 'sale_order_strap_demands_sale_order_item_id_fkey';

  IF v_con IS NULL OR position('ON DELETE SET NULL' IN v_con) = 0 THEN
    RAISE EXCEPTION 'Guard: FK sale_order_strap_demands.sale_order_item_id nao e ON DELETE SET NULL';
  END IF;
  IF NOT coalesce(v_nullable, false) THEN
    RAISE EXCEPTION 'Guard: sale_order_item_id ainda NOT NULL';
  END IF;

  v_trg := pg_get_functiondef(
    'public.tg_release_strap_demands_before_item_delete()'::regprocedure
  );
  IF position('strap_demand_item_fk_set_null_20270101022100' IN v_trg) = 0 THEN
    RAISE EXCEPTION 'Guard: trigger sem marcador 22100';
  END IF;
END;
$$;
