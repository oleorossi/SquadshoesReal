-- Spec origem-tira-pv-hub-os: OS de remessa 1 por PV (não contêiner cross-PV)
-- + preço MO/frete na linha da OS + helper de preço unitário.
-- Strass/SKU acabado continua no ramo buy_ready existente
-- (upsert_strap_purchase_contribution → materialize_strap_purchase_orders).

CREATE OR REPLACE FUNCTION public.strap_remessa_unit_price_per_m(
  p_recipe_id uuid,
  p_contractor_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT ROUND(
    coalesce(
      (
        SELECT m.preco_prestador_per_m
          FROM public.artisanal_strap_recipes r
          JOIN public.artisanal_strap_measures m ON m.id = r.measure_id
         WHERE r.id = p_recipe_id
      ),
      (
        SELECT r.transformation_cost_per_m
          FROM public.artisanal_strap_recipes r
         WHERE r.id = p_recipe_id
      ),
      0
    )
    + CASE
        WHEN c.strap_freight_amount IS NOT NULL
         AND c.strap_freight_per_meters IS NOT NULL
         AND c.strap_freight_per_meters > 0
        THEN c.strap_freight_amount / c.strap_freight_per_meters
        ELSE 0
      END
  , 6)
  FROM (SELECT 1) _
  LEFT JOIN public.contractors c ON c.id = p_contractor_id;
$fn$;

COMMENT ON FUNCTION public.strap_remessa_unit_price_per_m(uuid, uuid) IS
  'Custo unitário da tira na OS de remessa: MO/m do Hub (ou transformation_cost da receita) + frete/m do prestador. Napa não entra.';

REVOKE ALL ON FUNCTION public.strap_remessa_unit_price_per_m(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.strap_remessa_unit_price_per_m(uuid, uuid)
  TO authenticated, service_role;

-- Troca o contêiner open-por-contractor por OS amarrada ao PV (quando há sale_order_id).
DO $patch_os_per_pv$
DECLARE
  v_definition text;
  v_changed boolean := false;
  v_old_lock text := $$PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-open-os:' || v_recipe.default_contractor_id::text, 0));$$;
  v_new_lock text := $$PERFORM pg_advisory_xact_lock(hashtextextended(
      CASE WHEN v_sale_order_id IS NULL
        THEN 'strap-open-os:' || v_recipe.default_contractor_id::text
        ELSE 'strap-pv-remessa:' || v_sale_order_id::text || ':' || v_recipe.default_contractor_id::text
      END, 0));$$;
  v_old_where text;
  v_new_where text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.ensure_strap_production_contribution(uuid,uuid,numeric,uuid)'::regprocedure
  );

  IF position('strap-pv-remessa:' IN v_definition) = 0 THEN
    IF position('strap-open-os:' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Lock strap-open-os não encontrado em ensure_strap_production_contribution';
    END IF;
    -- Substitui só o trecho do lock (aceita formatação já patchada)
    IF position(v_old_lock IN v_definition) > 0 THEN
      v_definition := replace(v_definition, v_old_lock, v_new_lock);
    ELSE
      v_definition := replace(
        v_definition,
        $$'strap-open-os:' || v_recipe.default_contractor_id::text$$,
        $$CASE WHEN v_sale_order_id IS NULL
        THEN 'strap-open-os:' || v_recipe.default_contractor_id::text
        ELSE 'strap-pv-remessa:' || v_sale_order_id::text || ':' || v_recipe.default_contractor_id::text
      END$$
      );
    END IF;
    v_changed := true;
  END IF;

  -- Escopo da OS reutilizada: mesmo PV (quando conhecido)
  IF position('so.sale_order_id IS NOT DISTINCT FROM v_sale_order_id' IN v_definition) = 0 THEN
    v_old_where := $$WHERE so.contractor_id = v_recipe.default_contractor_id$$;
    IF position(v_old_where IN v_definition) = 0 THEN
      RAISE EXCEPTION 'WHERE contractor_id não encontrado no escritor de OS de tira';
    END IF;
    v_new_where := $$WHERE so.contractor_id = v_recipe.default_contractor_id
       AND so.sale_order_id IS NOT DISTINCT FROM v_sale_order_id$$;
    v_definition := replace(v_definition, v_old_where, v_new_where);
    v_changed := true;
  END IF;

  -- Notas da OS: deixa claro que é remessa do PV, não contêiner
  IF position('OS de remessa do PV' IN v_definition) = 0
     AND position('OS-contêiner gerada pelo motor canonico de tiras' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'OS-contêiner gerada pelo motor canonico de tiras',
      'OS de remessa do PV (1 OS por pedido; napa da empresa)'
    );
    v_changed := true;
  END IF;

  -- Preço da linha: MO + frete (em vez de 0/0)
  IF position('strap_remessa_unit_price_per_m' IN v_definition) = 0 THEN
    IF position(
      $$p_finished_m, 'm', p_finished_m, 0,
      0, 'Pendente',$$
      IN v_definition
    ) = 0 AND position(
      $$p_finished_m, 'm', p_finished_m, 0,
      0, 'Pendente'$$
      IN v_definition
    ) = 0 THEN
      -- tenta variante com espaços/newlines flexíveis via trecho curto
      IF position($$p_finished_m, 0,
      0, 'Pendente'$$ IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Valores unit_price/total 0 da linha de OS não encontrados para patch';
      END IF;
      v_definition := replace(
        v_definition,
        $$p_finished_m, 0,
      0, 'Pendente'$$,
        $$p_finished_m,
      public.strap_remessa_unit_price_per_m(v_recipe_id, v_recipe.default_contractor_id),
      public.strap_remessa_unit_price_per_m(v_recipe_id, v_recipe.default_contractor_id) * p_finished_m,
      'Pendente'$$
      );
    ELSE
      v_definition := replace(
        v_definition,
        $$p_finished_m, 'm', p_finished_m, 0,
      0, 'Pendente',$$,
        $$p_finished_m, 'm', p_finished_m,
      public.strap_remessa_unit_price_per_m(v_recipe_id, v_recipe.default_contractor_id),
      public.strap_remessa_unit_price_per_m(v_recipe_id, v_recipe.default_contractor_id) * p_finished_m,
      'Pendente',$$
      );
    END IF;
    v_changed := true;
  END IF;

  IF v_changed THEN
    EXECUTE v_definition;
  END IF;
END;
$patch_os_per_pv$;

-- API explícita: garante/retorna a OS de remessa do PV (idempotente).
CREATE OR REPLACE FUNCTION public.ensure_pv_strap_remessa_service_order(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_os_id uuid;
BEGIN
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatório para OS de remessa de tira';
  END IF;
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Preferir OS strap pendente já amarrada a este PV
  SELECT so.id INTO v_os_id
    FROM public.service_orders so
   WHERE so.sale_order_id = p_sale_order_id
     AND so.service_order_domain = 'strap'
     AND lower(btrim(so.status)) IN ('pendente', 'pending')
   ORDER BY so.created_at, so.id
   LIMIT 1;

  RETURN v_os_id;
END;
$fn$;

COMMENT ON FUNCTION public.ensure_pv_strap_remessa_service_order(uuid) IS
  'Retorna a OS strap pendente do PV (1 por pedido). A criação efetiva ocorre em ensure_strap_production_contribution.';

REVOKE ALL ON FUNCTION public.ensure_pv_strap_remessa_service_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_pv_strap_remessa_service_order(uuid)
  TO authenticated, service_role;
