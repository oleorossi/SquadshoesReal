-- Tiras é um módulo vertical próprio. As OS especializadas continuam usando
-- service_orders/service_order_items como infraestrutura, mas deixam de
-- contaminar listas, KPIs, histórico e financeiro de Terceirizados.

-- O contêiner histórico aceitava linhas de qualquer domínio. Filtrar somente o
-- cabeçalho faria uma OS mista desaparecer por inteiro de Terceirizados, levando
-- junto serviços comuns legítimos. A fronteira passa a ser explícita e imutável:
-- uma OS nasce `generic` ou `strap` e nunca recebe linha do outro domínio.
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS service_order_domain text DEFAULT 'generic';

DO $service_order_domain_backfill$
DECLARE
  v_mixed_service_order_id uuid;
  v_previous_strap_engine_write text := pg_catalog.current_setting(
    'app.strap_engine_write',
    true
  );
  v_updated_at_trigger_state "char";
BEGIN
  SELECT so.id
    INTO v_mixed_service_order_id
    FROM public.service_orders so
    JOIN public.service_order_items soi ON soi.service_order_id = so.id
   GROUP BY so.id
  HAVING bool_or(num_nonnulls(
         soi.strap_variant_id,
         soi.strap_recipe_id,
           soi.strap_batch_item_id,
           soi.sale_order_strap_demand_id,
           soi.strap_stock_floor_contribution_id
         ) > 0)
     AND bool_or(num_nonnulls(
         soi.strap_variant_id,
         soi.strap_recipe_id,
           soi.strap_batch_item_id,
           soi.sale_order_strap_demand_id,
           soi.strap_stock_floor_contribution_id
         ) = 0)
   LIMIT 1;

  IF v_mixed_service_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'OS % mistura linhas de Tiras e Terceirizados; separe o contêiner antes do cutover',
      v_mixed_service_order_id;
  END IF;

  -- Um cabeçalho legado de tira com uma linha comum também seria misto, mesmo
  -- quando não existe nenhuma linha canônica para o primeiro HAVING detectar.
  SELECT so.id
    INTO v_mixed_service_order_id
    FROM public.service_orders so
   WHERE (
       so.artisanal_recipe_id IS NOT NULL
       OR so.canonical_strap_recipe_id IS NOT NULL
       OR nullif(btrim(coalesce(so.artisanal_output_name, '')), '') IS NOT NULL
       OR nullif(btrim(coalesce(so.artisanal_output_color, '')), '') IS NOT NULL
       OR coalesce(so.artisanal_output_meters, 0) <> 0
       OR coalesce(so.artisanal_for_order_meters, 0) <> 0
       OR coalesce(so.artisanal_for_stock_meters, 0) <> 0
       OR nullif(btrim(coalesce(so.artisanal_base_color, '')), '') IS NOT NULL
       OR coalesce(so.artisanal_stock_entry_done, false)
     )
     AND EXISTS (
       SELECT 1
         FROM public.service_order_items soi
        WHERE soi.service_order_id = so.id
          AND num_nonnulls(
            soi.strap_variant_id,
            soi.strap_recipe_id,
            soi.strap_batch_item_id,
            soi.sale_order_strap_demand_id,
            soi.strap_stock_floor_contribution_id
          ) = 0
     )
   LIMIT 1;

  IF v_mixed_service_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'OS % mistura cabeçalho de Tiras e linhas de Terceirizados; separe o contêiner antes do cutover',
      v_mixed_service_order_id;
  END IF;

  -- O guard canônico vivo bloqueia qualquer UPDATE de uma OS de tira fora das
  -- RPCs do motor. Autoriza somente este backfill e restaura o valor antes de
  -- sair do bloco para não ampliar a janela de escrita da migration.
  PERFORM pg_catalog.set_config('app.strap_engine_write', '1', true);

  -- A classificação não é uma alteração operacional. O trigger genérico
  -- regrava updated_at em qualquer UPDATE, então preservamos seu estado exato
  -- e o desativamos somente durante estes UPDATEs de backfill.
  SELECT t.tgenabled
    INTO v_updated_at_trigger_state
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.service_orders'::regclass
     AND t.tgname = 'set_service_orders_updated_at'
     AND NOT t.tgisinternal;

  IF v_updated_at_trigger_state IS NOT NULL
     AND v_updated_at_trigger_state <> 'D' THEN
    EXECUTE 'ALTER TABLE public.service_orders DISABLE TRIGGER set_service_orders_updated_at';
  END IF;

  UPDATE public.service_orders so
     SET service_order_domain = 'strap'
   WHERE so.service_order_domain IS DISTINCT FROM 'strap'
     AND (
       so.artisanal_recipe_id IS NOT NULL
       OR so.canonical_strap_recipe_id IS NOT NULL
       OR nullif(btrim(coalesce(so.artisanal_output_name, '')), '') IS NOT NULL
       OR nullif(btrim(coalesce(so.artisanal_output_color, '')), '') IS NOT NULL
       OR coalesce(so.artisanal_output_meters, 0) <> 0
       OR coalesce(so.artisanal_for_order_meters, 0) <> 0
       OR coalesce(so.artisanal_for_stock_meters, 0) <> 0
       OR nullif(btrim(coalesce(so.artisanal_base_color, '')), '') IS NOT NULL
       OR coalesce(so.artisanal_stock_entry_done, false)
       OR EXISTS (
         SELECT 1
           FROM public.service_order_items soi
          WHERE soi.service_order_id = so.id
            AND num_nonnulls(
              soi.strap_variant_id,
              soi.strap_recipe_id,
              soi.strap_batch_item_id,
              soi.sale_order_strap_demand_id,
              soi.strap_stock_floor_contribution_id
            ) > 0
       )
     );

  UPDATE public.service_orders
     SET service_order_domain = 'generic'
   WHERE service_order_domain IS NULL;

  IF v_updated_at_trigger_state = 'O' THEN
    EXECUTE 'ALTER TABLE public.service_orders ENABLE TRIGGER set_service_orders_updated_at';
  ELSIF v_updated_at_trigger_state = 'R' THEN
    EXECUTE 'ALTER TABLE public.service_orders ENABLE REPLICA TRIGGER set_service_orders_updated_at';
  ELSIF v_updated_at_trigger_state = 'A' THEN
    EXECUTE 'ALTER TABLE public.service_orders ENABLE ALWAYS TRIGGER set_service_orders_updated_at';
  END IF;

  -- Validação final também cobre restauração parcial/rerun: toda linha precisa
  -- ter a mesma classificação dos cinco campos canônicos que seu cabeçalho.
  SELECT so.id
    INTO v_mixed_service_order_id
    FROM public.service_orders so
    JOIN public.service_order_items soi ON soi.service_order_id = so.id
   WHERE (so.service_order_domain = 'strap') IS DISTINCT FROM (
     num_nonnulls(
       soi.strap_variant_id,
       soi.strap_recipe_id,
       soi.strap_batch_item_id,
       soi.sale_order_strap_demand_id,
       soi.strap_stock_floor_contribution_id
     ) > 0
   )
   LIMIT 1;

  IF v_mixed_service_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'OS % mistura domínio do cabeçalho e linha de outro domínio; separe o contêiner antes do cutover',
      v_mixed_service_order_id;
  END IF;

  PERFORM pg_catalog.set_config(
    'app.strap_engine_write',
    coalesce(v_previous_strap_engine_write, ''),
    true
  );
END;
$service_order_domain_backfill$;

ALTER TABLE public.service_orders
  ALTER COLUMN service_order_domain SET DEFAULT 'generic',
  ALTER COLUMN service_order_domain SET NOT NULL;
ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_domain_ck;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_domain_ck
  CHECK (service_order_domain IN ('generic', 'strap'));

COMMENT ON COLUMN public.service_orders.service_order_domain IS
  'Fronteira imutável do contêiner: generic=Terceirizados; strap=Central de Tiras.';

-- A cascata genérica de cancelamento do PV, criada na migration anterior,
-- usava markers históricos para excluir Tiras. O domínio passa a ser a única
-- autoridade, inclusive para um cabeçalho strap legítimo ainda sem linhas.
CREATE OR REPLACE FUNCTION public.is_service_order_candidate_for_sale(
  p_service_order_id uuid,
  p_sale_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.service_orders service_order
     WHERE service_order.id = p_service_order_id
       AND service_order.service_order_domain = 'generic'
       AND (
         service_order.source_sale_order_id = p_sale_order_id
         OR (
           service_order.source_sale_order_id IS NULL
           AND service_order.sale_order_id = p_sale_order_id
         )
         OR p_sale_order_id = ANY(COALESCE(
              service_order.linked_sale_order_ids,
              ARRAY[]::uuid[]
            ))
         OR EXISTS (
           SELECT 1
             FROM public.service_order_items item
             LEFT JOIN public.orders child_order
               ON child_order.id = item.order_id
            WHERE item.service_order_id = service_order.id
              AND COALESCE(item.sale_order_id, child_order.sale_order_id)
                  = p_sale_order_id
         )
         OR EXISTS (
           SELECT 1
             FROM public.sale_order_items sale_item
            WHERE sale_item.id = service_order.source_sale_order_item_id
              AND sale_item.sale_order_id = p_sale_order_id
         )
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.unnest(COALESCE(
                    service_order.selected_sale_order_item_ids,
                    ARRAY[]::uuid[]
                  )) selected(item_id)
             JOIN public.sale_order_items sale_item
               ON sale_item.id = selected.item_id
            WHERE sale_item.sale_order_id = p_sale_order_id
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid) IS
  'Predicado da cascata genérica OS→PV; service_order_domain exclui Tiras antes de qualquer vínculo de header, array, item ou seleção.';

CREATE OR REPLACE FUNCTION public.tg_enforce_service_order_header_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.service_order_domain IS DISTINCT FROM OLD.service_order_domain THEN
    RAISE EXCEPTION 'O domínio da OS é imutável; crie outro contêiner';
  END IF;

  IF NEW.service_order_domain = 'generic'
     AND (
       NEW.artisanal_recipe_id IS NOT NULL
       OR NEW.canonical_strap_recipe_id IS NOT NULL
       OR nullif(btrim(coalesce(NEW.artisanal_output_name, '')), '') IS NOT NULL
       OR nullif(btrim(coalesce(NEW.artisanal_output_color, '')), '') IS NOT NULL
       OR coalesce(NEW.artisanal_output_meters, 0) <> 0
       OR coalesce(NEW.artisanal_for_order_meters, 0) <> 0
       OR coalesce(NEW.artisanal_for_stock_meters, 0) <> 0
       OR nullif(btrim(coalesce(NEW.artisanal_base_color, '')), '') IS NOT NULL
       OR coalesce(NEW.artisanal_stock_entry_done, false)
     ) THEN
    RAISE EXCEPTION 'Campos legados de tira exigem service_order_domain=strap';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_service_order_header_domain()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_service_order_header_domain
  ON public.service_orders;
CREATE TRIGGER trg_enforce_service_order_header_domain
BEFORE INSERT OR UPDATE OF
  service_order_domain,
  artisanal_recipe_id,
  canonical_strap_recipe_id,
  artisanal_output_name,
  artisanal_output_color,
  artisanal_output_meters,
  artisanal_for_order_meters,
  artisanal_for_stock_meters,
  artisanal_base_color,
  artisanal_stock_entry_done
ON public.service_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_service_order_header_domain();

CREATE OR REPLACE FUNCTION public.tg_enforce_service_order_item_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_header_domain text;
  v_line_domain text;
BEGIN
  SELECT so.service_order_domain
    INTO v_header_domain
    FROM public.service_orders so
   WHERE so.id = NEW.service_order_id
   FOR KEY SHARE;

  IF v_header_domain IS NULL THEN
    RAISE EXCEPTION 'Cabeçalho da OS não encontrado para validar o domínio';
  END IF;

  v_line_domain := CASE
    WHEN num_nonnulls(
      NEW.strap_variant_id,
      NEW.strap_recipe_id,
      NEW.strap_batch_item_id,
      NEW.sale_order_strap_demand_id,
      NEW.strap_stock_floor_contribution_id
    ) > 0 THEN 'strap'
    ELSE 'generic'
  END;

  IF v_header_domain IS DISTINCT FROM v_line_domain THEN
    RAISE EXCEPTION
      'OS do domínio % não aceita linha do domínio %',
      v_header_domain,
      v_line_domain;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_service_order_item_domain()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_service_order_item_domain
  ON public.service_order_items;
CREATE TRIGGER trg_enforce_service_order_item_domain
BEFORE INSERT OR UPDATE OF
  service_order_id,
  strap_variant_id,
  strap_recipe_id,
  strap_batch_item_id,
  sale_order_strap_demand_id,
  strap_stock_floor_contribution_id
ON public.service_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_enforce_service_order_item_domain();

-- O guard operacional anterior ao domínio conhecia só três vínculos. Os dois
-- vínculos de demanda/contribuição também são identidade canônica e jamais
-- podem ser escritos fora das RPCs que habilitam app.strap_engine_write.
CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_canonical boolean := false;
  v_new_canonical boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_canonical := num_nonnulls(
      OLD.strap_variant_id,
      OLD.strap_recipe_id,
      OLD.strap_batch_item_id,
      OLD.sale_order_strap_demand_id,
      OLD.strap_stock_floor_contribution_id
    ) > 0;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_canonical := num_nonnulls(
      NEW.strap_variant_id,
      NEW.strap_recipe_id,
      NEW.strap_batch_item_id,
      NEW.sale_order_strap_demand_id,
      NEW.strap_stock_floor_contribution_id
    ) > 0;
  END IF;

  IF (v_old_canonical OR v_new_canonical)
     AND pg_catalog.current_setting('app.strap_engine_write', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Linha canônica de OS de tira só pode ser alterada pelas RPCs operacionais';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_id uuid;
  v_new_id uuid;
  v_old_strap boolean := false;
  v_new_strap boolean := false;
  v_old_has_canonical_item boolean := false;
  v_new_has_canonical_item boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_id := OLD.id;
    v_old_strap := OLD.service_order_domain = 'strap'
      OR OLD.artisanal_recipe_id IS NOT NULL
      OR OLD.canonical_strap_recipe_id IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_name, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_color, '')), '') IS NOT NULL
      OR coalesce(OLD.artisanal_output_meters, 0) <> 0
      OR coalesce(OLD.artisanal_for_order_meters, 0) <> 0
      OR coalesce(OLD.artisanal_for_stock_meters, 0) <> 0
      OR nullif(btrim(coalesce(OLD.artisanal_base_color, '')), '') IS NOT NULL
      OR coalesce(OLD.artisanal_stock_entry_done, false);
    SELECT EXISTS (
      SELECT 1
        FROM public.service_order_items item
       WHERE item.service_order_id = v_old_id
         AND num_nonnulls(
           item.strap_variant_id,
           item.strap_recipe_id,
           item.strap_batch_item_id,
           item.sale_order_strap_demand_id,
           item.strap_stock_floor_contribution_id
         ) > 0
    ) INTO v_old_has_canonical_item;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_new_id := NEW.id;
    v_new_strap := NEW.service_order_domain = 'strap'
      OR NEW.artisanal_recipe_id IS NOT NULL
      OR NEW.canonical_strap_recipe_id IS NOT NULL
      OR nullif(btrim(coalesce(NEW.artisanal_output_name, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(NEW.artisanal_output_color, '')), '') IS NOT NULL
      OR coalesce(NEW.artisanal_output_meters, 0) <> 0
      OR coalesce(NEW.artisanal_for_order_meters, 0) <> 0
      OR coalesce(NEW.artisanal_for_stock_meters, 0) <> 0
      OR nullif(btrim(coalesce(NEW.artisanal_base_color, '')), '') IS NOT NULL
      OR coalesce(NEW.artisanal_stock_entry_done, false);
    SELECT EXISTS (
      SELECT 1
        FROM public.service_order_items item
       WHERE item.service_order_id = v_new_id
         AND num_nonnulls(
           item.strap_variant_id,
           item.strap_recipe_id,
           item.strap_batch_item_id,
           item.sale_order_strap_demand_id,
           item.strap_stock_floor_contribution_id
         ) > 0
    ) INTO v_new_has_canonical_item;
  END IF;

  IF (v_old_strap OR v_new_strap
      OR v_old_has_canonical_item OR v_new_has_canonical_item)
     AND pg_catalog.current_setting('app.strap_engine_write', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'OS de Tiras só pode ser alterada pelas RPCs operacionais';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Escritores comuns só reutilizam contêineres comuns. Inserts manuais também
-- recebem `generic` pelo DEFAULT da coluna.
CREATE OR REPLACE FUNCTION public.get_or_create_open_service_order(p_contractor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'contractor_id obrigatório';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('open_os:' || p_contractor_id::text));

  SELECT so.id
    INTO v_id
    FROM public.service_orders so
   WHERE so.contractor_id = p_contractor_id
     AND so.service_order_domain = 'generic'
     AND lower(btrim(so.status)) IN ('pendente', 'pending')
   ORDER BY so.created_at, so.id
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.service_orders (
      contractor_id,
      status,
      service_date,
      description,
      notes,
      service_order_domain
    ) VALUES (
      p_contractor_id,
      'Pendente',
      current_date,
      '',
      '',
      'generic'
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_open_service_order(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_open_service_order(uuid)
  TO authenticated;

-- O escritor canônico de Tiras passa a buscar/criar apenas cabeçalhos `strap`.
-- A alteração é cirúrgica para preservar toda a versão vigente da função.
DO $strap_service_order_writer$
DECLARE
  v_definition text;
  v_changed boolean := false;
BEGIN
  v_definition := pg_get_functiondef(
    'public.ensure_strap_production_contribution(uuid,uuid,numeric,uuid)'::regprocedure
  );

  IF position('AND so.service_order_domain = ''strap''' IN v_definition) = 0 THEN
    IF position(
      'AND lower(btrim(so.status)) IN (''pendente'',''pending'')'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Filtro de status esperado não encontrado no escritor de Tiras';
    END IF;
    v_definition := replace(
      v_definition,
      'AND lower(btrim(so.status)) IN (''pendente'',''pending'')',
      E'AND so.service_order_domain = ''strap''\n       AND lower(btrim(so.status)) IN (''pendente'',''pending'')'
    );
    v_changed := true;
  END IF;

  -- Não reutiliza uma das OS artesanais legadas pendentes. O contêiner novo
  -- pode ser reaproveitado somente se não carregar nenhum payload histórico.
  IF position('AND so.canonical_strap_recipe_id IS NULL' IN v_definition) = 0 THEN
    IF position('AND so.service_order_domain = ''strap''' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Filtro de domínio esperado não encontrado no escritor de Tiras';
    END IF;
    v_definition := replace(
      v_definition,
      'AND so.service_order_domain = ''strap''',
      E'AND so.service_order_domain = ''strap''\n       AND so.artisanal_recipe_id IS NULL\n       AND so.canonical_strap_recipe_id IS NULL\n       AND nullif(btrim(coalesce(so.artisanal_output_name, '''')), '''') IS NULL\n       AND nullif(btrim(coalesce(so.artisanal_output_color, '''')), '''') IS NULL\n       AND coalesce(so.artisanal_output_meters, 0) = 0\n       AND coalesce(so.artisanal_for_order_meters, 0) = 0\n       AND coalesce(so.artisanal_for_stock_meters, 0) = 0\n       AND nullif(btrim(coalesce(so.artisanal_base_color, '''')), '''') IS NULL\n       AND NOT coalesce(so.artisanal_stock_entry_done, false)'
    );
    v_changed := true;
  END IF;

  IF position('linked_sale_order_ids, is_avulsa, service_order_domain' IN v_definition) = 0 THEN
    IF position('linked_sale_order_ids, is_avulsa' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Lista de colunas esperada não encontrada no escritor de Tiras';
    END IF;
    v_definition := replace(
      v_definition,
      'linked_sale_order_ids, is_avulsa',
      'linked_sale_order_ids, is_avulsa, service_order_domain'
    );

    IF position(
      E'CASE WHEN v_sale_order_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_sale_order_id] END,\n        v_sale_order_id IS NULL\n      ) RETURNING id INTO v_existing_os;'
      IN v_definition
    ) = 0 THEN
      RAISE EXCEPTION 'Valores esperados não encontrados no escritor de Tiras';
    END IF;
    v_definition := replace(
      v_definition,
      E'CASE WHEN v_sale_order_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_sale_order_id] END,\n        v_sale_order_id IS NULL\n      ) RETURNING id INTO v_existing_os;',
      E'CASE WHEN v_sale_order_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_sale_order_id] END,\n        v_sale_order_id IS NULL, ''strap''\n      ) RETURNING id INTO v_existing_os;'
    );
    v_changed := true;
  END IF;

  IF v_changed THEN
    EXECUTE v_definition;
  END IF;
END;
$strap_service_order_writer$;

-- O gatilho de estoque mínimo continua sendo a autoridade para compras comuns,
-- mas o ramo artesanal dele foi aposentado pelo motor canônico de Tiras. Hoje
-- esse ramo já termina bloqueado pelo guard legado; retornar antes dele evita
-- que uma baixa de estoque artesanal aborte a transação inteira e, ao mesmo
-- tempo, não ressuscita um segundo escritor de OS de tira.
DO $retire_legacy_artisanal_auto_service_order$
DECLARE
  v_definition text;
  v_anchor text := E'BEGIN\n  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN';
BEGIN
  v_definition := pg_get_functiondef(
    'public.auto_create_purchase_order()'::regprocedure
  );

  IF position('IF COALESCE(NEW.is_artisanal, false) THEN' IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Prólogo esperado não encontrado em auto_create_purchase_order; ramo artesanal não foi neutralizado';
    END IF;

    v_definition := replace(
      v_definition,
      v_anchor,
      E'BEGIN\n  -- Tiras usa exclusivamente o motor canônico; o writer artesanal legado está aposentado.\n  IF COALESCE(NEW.is_artisanal, false) THEN\n    RETURN NEW;\n  END IF;\n\n  IF NEW.quantity <= NEW.min_stock AND NEW.min_stock > 0 AND (OLD.quantity > OLD.min_stock OR OLD.quantity IS NULL) THEN'
    );
    EXECUTE v_definition;
  END IF;
END;
$retire_legacy_artisanal_auto_service_order$;

-- O RPC agregado antigo também é um writer aposentado. Reitera o corte de
-- privilégios feito no cutover canônico para instalações restauradas/parciais.
REVOKE ALL ON FUNCTION public.upsert_open_service_order(
  uuid, uuid, text, text, text, numeric, numeric, numeric,
  text, numeric, uuid, numeric
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_strap_service_orders
WITH (security_invoker = true)
AS
SELECT so.*
FROM public.service_orders so
WHERE (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR public.is_approved_user()
  )
  AND so.service_order_domain = 'strap';

COMMENT ON VIEW public.v_strap_service_orders IS
  'OS pertencentes à Central de Tiras pelo domínio explícito e imutável do contêiner.';
REVOKE ALL ON public.v_strap_service_orders
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_strap_service_orders TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_non_strap_service_orders
WITH (security_invoker = true)
AS
SELECT so.*
FROM public.service_orders so
WHERE (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR public.is_approved_user()
  )
  AND so.service_order_domain = 'generic';

COMMENT ON VIEW public.v_non_strap_service_orders IS
  'OS comuns pertencentes a Terceirizados pelo domínio explícito e imutável do contêiner.';
REVOKE ALL ON public.v_non_strap_service_orders
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_non_strap_service_orders TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_non_strap_service_order_payables
WITH (security_invoker = true)
AS
SELECT payable.*
FROM public.v_service_order_payables payable
JOIN public.v_non_strap_service_orders so
  ON so.id = payable.service_order_id
WHERE (
  session_user::text IN ('postgres', 'supabase_admin', 'service_role')
  OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
  OR public.is_approved_user()
);

COMMENT ON VIEW public.v_non_strap_service_order_payables IS
  'Contas de OS comuns; pagamentos especializados de Tiras permanecem no Hub de Tiras.';
REVOKE ALL ON public.v_non_strap_service_order_payables
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_non_strap_service_order_payables TO authenticated, service_role;

-- Preserva as definições mais recentes dessas views (inclusive a migration
-- 09800) e troca somente a fonte. Assim não duplicamos centenas de linhas nem
-- apagamos colunas acrescentadas por uma migration anterior.
DO $views$
DECLARE
  v_name text;
  v_definition text;
  v_rewritten text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'v_contractor_metrics',
    'v_contractor_history_orders',
    'v_contractor_os_financials'
  ]
  LOOP
    SELECT pg_get_viewdef(format('public.%I', v_name)::regclass, true)
      INTO v_definition;

    v_rewritten := regexp_replace(
      v_definition,
      '\m(public\.)?service_orders\s+so\M',
      'public.v_non_strap_service_orders so',
      'g'
    );
    v_rewritten := regexp_replace(
      v_rewritten,
      '\m(public\.)?service_orders\s+so2\M',
      'public.v_non_strap_service_orders so2',
      'g'
    );
    v_rewritten := regexp_replace(
      v_rewritten,
      '\m(public\.)?v_service_order_payables\s+p\M',
      'public.v_non_strap_service_order_payables p',
      'g'
    );

    IF v_rewritten = v_definition
       AND (
         v_definition !~ '\m(public\.)?v_non_strap_service_orders\s+so\M'
         OR (
           v_name = 'v_contractor_metrics'
           AND v_definition !~ '\m(public\.)?v_non_strap_service_orders\s+so2\M'
         )
         OR (
           v_name IN ('v_contractor_metrics', 'v_contractor_os_financials')
           AND v_definition !~ '\m(public\.)?v_non_strap_service_order_payables\s+p\M'
         )
       ) THEN
      RAISE EXCEPTION
        'A view % não continha a fonte genérica nem todas as fontes non-straps esperadas',
        v_name;
    END IF;
    IF v_rewritten ~ '\mservice_orders\s+(so|so2)\M'
       OR v_rewritten ~ '\mv_service_order_payables\s+p\M' THEN
      RAISE EXCEPTION 'A view % manteve uma fonte genérica sem filtro', v_name;
    END IF;

    IF v_rewritten IS DISTINCT FROM v_definition THEN
      EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v_name, v_rewritten);
    END IF;
  END LOOP;
END;
$views$;

ALTER VIEW public.v_contractor_metrics SET (security_invoker = true);
ALTER VIEW public.v_contractor_history_orders SET (security_invoker = true);
ALTER VIEW public.v_contractor_os_financials SET (security_invoker = true);

REVOKE ALL ON public.v_contractor_metrics
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_contractor_history_orders
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.v_contractor_os_financials
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_contractor_metrics TO authenticated, service_role;
GRANT SELECT ON public.v_contractor_history_orders TO authenticated, service_role;
GRANT SELECT ON public.v_contractor_os_financials TO authenticated, service_role;

-- O worker ficou cadastrado porém invisível ao cache do pg_cron. O alter_job
-- sem mudança semântica invalida o cache de forma suportada. Na primeira
-- execução ele revelou dois max(uuid), agregação inexistente no Postgres; as
-- substituições abaixo preservam a função viva e corrigem apenas esses pontos.
DO $worker$
DECLARE
  v_definition text;
  v_job_id bigint;
BEGIN
  v_definition := pg_get_functiondef(
    'public.reconcile_strap_variant_local_202701(uuid,uuid,text)'::regprocedure
  );
  IF position('count(*)::integer,max(o.id)' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'count(*)::integer,max(o.id)',
      'count(*)::integer,(array_agg(o.id ORDER BY o.id))[1]'
    );
    EXECUTE v_definition;
  ELSIF position('(array_agg(o.id ORDER BY o.id))[1]' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trecho UUID esperado não encontrado em reconcile_strap_variant_local_202701';
  END IF;

  v_definition := pg_get_functiondef(
    'public.reconcile_strap_variant(uuid,uuid,text)'::regprocedure
  );
  IF position('SELECT max(u.id) INTO v_lock_ceiling' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      E'SELECT max(u.id) INTO v_lock_ceiling\n      FROM unnest(v_locked_base_ids) AS u(id);',
      E'SELECT u.id INTO v_lock_ceiling\n      FROM unnest(v_locked_base_ids) AS u(id)\n     ORDER BY u.id DESC\n     LIMIT 1;'
    );
    IF position('SELECT max(u.id) INTO v_lock_ceiling' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Substituição do teto UUID não foi aplicada';
    END IF;
    EXECUTE v_definition;
  ELSIF position('ORDER BY u.id DESC' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trecho UUID esperado não encontrado em reconcile_strap_variant';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
      FROM cron.job
     WHERE jobname = 'artisanal-strap-demand-worker';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.alter_job(v_job_id, active := true);
    END IF;

    SELECT jobid INTO v_job_id
      FROM cron.job
     WHERE jobname = 'artisanal-strap-purchase-order-notifications';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.alter_job(v_job_id, active := true);
    END IF;
  END IF;
END;
$worker$;

-- O primeiro processamento real também revelou drift entre o motor de OCs de
-- tiras e a constraint geral: o writer ainda emitia `pendente`, enquanto a
-- coluna aceita `pendente_aprovacao`. Corrige somente o valor de aprovação; o
-- status operacional da OC (`draft`/`pending`) continua inalterado.
DO $purchase_order_approval$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.materialize_strap_purchase_orders(integer,uuid)'::regprocedure
  );

  IF position('''pendente'', v_group.supplier_id' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      '''pendente'', v_group.supplier_id',
      '''pendente_aprovacao'', v_group.supplier_id'
    );
    EXECUTE v_definition;
  ELSIF position('''pendente_aprovacao'', v_group.supplier_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Valor de aprovação esperado não encontrado em materialize_strap_purchase_orders';
  END IF;

  -- A função retorna uma coluna chamada `purchase_order_id`; por isso toda
  -- coluna homônima lida dentro dela precisa de alias explícito. Sem isso o
  -- PL/pgSQL interrompe a primeira OC real com SQLSTATE 42702.
  v_definition := pg_get_functiondef(
    'public.materialize_strap_purchase_orders(integer,uuid)'::regprocedure
  );
  IF position('SELECT id INTO v_poi_id FROM public.purchase_order_items' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      E'SELECT id INTO v_poi_id FROM public.purchase_order_items\n       WHERE purchase_order_id = v_po.id AND product_id = v_line.purchase_product_id',
      E'SELECT poi.id INTO v_poi_id FROM public.purchase_order_items poi\n       WHERE poi.purchase_order_id = v_po.id AND poi.product_id = v_line.purchase_product_id'
    );
    IF position('WHERE purchase_order_id = v_po.id' IN v_definition) > 0 THEN
      RAISE EXCEPTION 'Qualificação de purchase_order_id não foi aplicada';
    END IF;
    EXECUTE v_definition;
  ELSIF position('WHERE poi.purchase_order_id = v_po.id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Leitura de item esperada não encontrada em materialize_strap_purchase_orders';
  END IF;
END;
$purchase_order_approval$;
