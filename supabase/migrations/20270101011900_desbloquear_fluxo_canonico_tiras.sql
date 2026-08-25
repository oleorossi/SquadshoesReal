-- Desbloqueia o fluxo canônico de Tiras sem fabricar rendimento, SKU ou cor.
--
-- 1. Calendário/capacidade ausentes ficam diagnosticados para cadastro na
--    tela canônica; esta migration não cria nem infere valores operacionais.
-- 2. Itens de OC e jobs em dead-letter só são reparados quando a identidade
--    estrutural é unívoca pelas contribuições canônicas.
-- 3. Reviews cadastrais, larguras invertidas e furos físicos viram uma fila
--    acionável. Nenhum dado ambíguo é corrigido automaticamente.
-- 4. OS históricas de PV faturado permanecem abertas até reconciliação manual.
-- 5. Receita/rendimento continua por medida + família de material-base, sem cor.

BEGIN;

-- ---------------------------------------------------------------------------
-- Capacidade/calendário ausentes permanecem cadastro acionável. Esta migration
-- não cria nem infere calendário, jornada ou capacidade operacional.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Identidade exata da OC e reenvio seguro de dead-letter.
-- ---------------------------------------------------------------------------

-- Um produto acabado buy-ready nunca perde a variante: o SKU comprado e a
-- variante precisam ser o mesmo par exato. A única identidade nullable é a
-- napa-base consolidada pelo writer canônico, pois um mesmo produto-base pode
-- cobrir várias variantes da mesma família/cor. Nesse caso a constraint
-- diferida abaixo prova cada contribuição antes do COMMIT.
CREATE OR REPLACE FUNCTION public.strap_purchase_item_identity_is_valid(
  p_product_id uuid,
  p_strap_variant_id uuid,
  p_allow_consolidated_base boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_product_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
        FROM public.artisanal_strap_variants v
       WHERE v.id = p_strap_variant_id
         AND v.status = 'active'
         AND v.purchase_enabled
         AND v.finished_product_id = p_product_id
    )
    OR (
      -- Produto que também aparece como acabado é ambíguo e não pode usar a
      -- exceção de consolidação da napa-base.
      NOT EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants finished_variant
         WHERE finished_variant.finished_product_id = p_product_id
      )
      AND (p_strap_variant_id IS NOT NULL
        OR coalesce(p_allow_consolidated_base, false))
      AND EXISTS (
        SELECT 1
          FROM public.artisanal_strap_variants v
          JOIN public.base_material_color_official_products op
            ON op.base_group_id = v.base_group_id
           AND op.color_id = v.color_id
           AND op.official_product_id = p_product_id
           AND op.status = 'active'
         WHERE v.status = 'active'
           AND (p_strap_variant_id IS NULL OR v.id = p_strap_variant_id)
           AND EXISTS (
             SELECT 1
               FROM public.artisanal_strap_recipes r
              WHERE r.measure_id = v.measure_id
                AND r.base_group_id = v.base_group_id
                AND r.status = 'approved'
                AND r.valid_from <= now()
                AND (r.valid_to IS NULL OR r.valid_to > now())
           )
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.strap_purchase_item_has_canonical_origin(
  p_purchase_order_item_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.purchase_order_items%ROWTYPE;
  v_source_type text;
  v_is_finished_product boolean;
BEGIN
  SELECT i.*
    INTO v_item
    FROM public.purchase_order_items i
   WHERE i.id = p_purchase_order_item_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT po.source_type
    INTO v_source_type
    FROM public.purchase_orders po
   WHERE po.id = v_item.purchase_order_id;
  IF NOT FOUND OR v_source_type IS DISTINCT FROM 'strap_demand' THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_id = v_item.purchase_order_id
       AND c.purchase_order_item_id = v_item.id
       AND c.status NOT IN ('cancelled', 'superseded')
  ) THEN
    RETURN false;
  END IF;

  -- Toda contribuição viva precisa estar completa, apontar este mesmo item e
  -- provar individualmente o par produto/variante.
  IF EXISTS (
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id = v_item.id
       AND c.status NOT IN ('cancelled', 'superseded')
       AND (
         c.purchase_order_id IS DISTINCT FROM v_item.purchase_order_id
         OR c.purchase_product_id IS DISTINCT FROM v_item.product_id
         OR c.strap_variant_id IS NULL
         OR NOT public.strap_purchase_item_identity_is_valid(
           v_item.product_id,
           c.strap_variant_id,
           false
         )
       )
  ) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id = v_item.product_id
  ) INTO v_is_finished_product;

  IF v_is_finished_product THEN
    -- Buy-ready: produto acabado e variante exatos, sem consolidação.
    IF v_item.strap_variant_id IS NULL OR EXISTS (
      SELECT 1
        FROM public.purchase_demand_contributions c
       WHERE c.purchase_order_item_id = v_item.id
         AND c.status NOT IN ('cancelled', 'superseded')
         AND c.strap_variant_id IS DISTINCT FROM v_item.strap_variant_id
    ) THEN
      RETURN false;
    END IF;
  ELSIF v_item.strap_variant_id IS NOT NULL AND EXISTS (
    -- Napa-base com uma variante pode manter UUID exato. Se houver mais de uma,
    -- o item consolidado precisa ficar NULL e cada contribuição carrega seu UUID.
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id = v_item.id
       AND c.status NOT IN ('cancelled', 'superseded')
       AND c.strap_variant_id IS DISTINCT FROM v_item.strap_variant_id
  ) THEN
    RETURN false;
  END IF;

  RETURN public.strap_purchase_item_identity_is_valid(
    v_item.product_id,
    v_item.strap_variant_id,
    NOT v_is_finished_product
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_strap_purchase_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_locked timestamptz;
  v_new_locked timestamptz;
  v_old_source text;
  v_new_source text;
  v_old_strap_product boolean := false;
  v_new_strap_product boolean := false;
  v_allow_consolidated_base boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT po.snapshot_locked_at, po.source_type
      INTO v_old_locked, v_old_source
      FROM public.purchase_orders po
     WHERE po.id = OLD.purchase_order_id;
    SELECT coalesce(p.is_artisanal, false)
           OR coalesce(pg.is_artisanal_strap, false)
           OR EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.finished_product_id = p.id
           )
           OR public.is_legacy_strap_migration_controlled_product(p.id)
      INTO v_old_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.id = OLD.product_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT po.snapshot_locked_at, po.source_type
      INTO v_new_locked, v_new_source
      FROM public.purchase_orders po
     WHERE po.id = NEW.purchase_order_id;
    SELECT coalesce(p.is_artisanal, false)
           OR coalesce(pg.is_artisanal_strap, false)
           OR EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.finished_product_id = p.id
           )
           OR public.is_legacy_strap_migration_controlled_product(p.id)
      INTO v_new_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.id = NEW.product_id;

    IF coalesce(v_new_strap_product, false)
       AND v_new_source IS DISTINCT FROM 'strap_demand' THEN
      RAISE EXCEPTION 'Produto legado/canonico de tira so pode entrar pela OC strap_demand; inbound generico bloqueado';
    END IF;

    v_allow_consolidated_base :=
      current_setting('app.strap_po_engine', true) = '1'
      AND v_new_source = 'strap_demand'
      AND v_new_locked IS NULL;
    IF v_new_source = 'strap_demand'
       AND NOT public.strap_purchase_item_identity_is_valid(
         NEW.product_id,
         NEW.strap_variant_id,
         v_allow_consolidated_base
       ) THEN
      RAISE EXCEPTION 'Item de OC de tira exige strap_variant_id e produto exatos';
    END IF;
  END IF;

  IF coalesce(v_old_source, '') <> 'strap_demand'
     AND coalesce(v_new_source, '') <> 'strap_demand' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('app.strap_po_engine', true) = '1'
     AND v_old_locked IS NULL AND v_new_locked IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND current_setting('app.strap_po_receipt', true) = '1'
     AND OLD.purchase_order_id = NEW.purchase_order_id
     AND v_old_source = 'strap_demand'
     AND v_new_source = 'strap_demand'
     AND (to_jsonb(NEW) - 'received_quantity' - 'received_at')
       = (to_jsonb(OLD) - 'received_quantity' - 'received_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Itens e snapshots de OC aprovada sao imutaveis';
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_validate_purchase_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_unit text;
  v_purchase_unit text;
  v_is_artisanal boolean;
  v_group_is_strap boolean;
  v_is_strap_product boolean;
  v_is_buyable_strap boolean;
  v_is_migration_strap boolean;
  v_open_strap_po boolean := false;
  v_po_source text;
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(nullif(btrim(p.unit), ''), 'un'),
         coalesce(nullif(btrim(p.purchase_unit), ''),
                  nullif(btrim(p.unit), ''), 'un'),
         coalesce(p.is_artisanal, false),
         coalesce(pg.is_artisanal_strap, false),
         EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id = p.id
         ),
         EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id = p.id
              AND v.status = 'active'
              AND v.purchase_enabled
         ),
         public.is_legacy_strap_migration_controlled_product(p.id)
    INTO v_stock_unit, v_purchase_unit, v_is_artisanal, v_group_is_strap,
         v_is_strap_product, v_is_buyable_strap, v_is_migration_strap
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
   WHERE p.id = NEW.product_id;
  IF v_stock_unit IS NULL THEN
    RAISE EXCEPTION 'Produto da linha de OC nao encontrado';
  END IF;

  SELECT po.source_type,
         po.source_type = 'strap_demand'
           AND po.snapshot_locked_at IS NULL
           AND po.status IN ('draft', 'pending', 'Pendente')
    INTO v_po_source, v_open_strap_po
    FROM public.purchase_orders po
   WHERE po.id = NEW.purchase_order_id;

  v_is_strap_product := coalesce(v_is_strap_product, false)
    OR coalesce(v_group_is_strap, false)
    OR coalesce(v_is_artisanal, false)
    OR coalesce(v_is_migration_strap, false);
  IF v_is_strap_product AND v_po_source IS DISTINCT FROM 'strap_demand' THEN
    RAISE EXCEPTION 'Produto legado/canonico de tira nao pode ser comprado/recebido por OC generica';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id = NEW.product_id
  ) AND NOT v_is_buyable_strap THEN
    RAISE EXCEPTION 'Material artesanal nao compravel: produza por lote/OS';
  END IF;
  IF v_po_source = 'strap_demand'
     AND NOT public.strap_purchase_item_identity_is_valid(
       NEW.product_id,
       NEW.strap_variant_id,
       current_setting('app.strap_po_engine', true) = '1'
         AND v_open_strap_po
     ) THEN
    RAISE EXCEPTION 'OC canonica exige variante e produto estruturalmente compativeis';
  END IF;
  IF public.po_norm_unit(coalesce(NEW.unit, '')) NOT IN (
    public.po_norm_unit(v_stock_unit),
    public.po_norm_unit(v_purchase_unit)
  ) THEN
    RAISE EXCEPTION 'Unidade de OC invalida; compra %, estoque %',
      v_purchase_unit, v_stock_unit;
  END IF;
  IF NOT v_open_strap_po
     AND (coalesce(NEW.quantity, 0) <= 0
       OR coalesce(NEW.unit_price, 0) <= 0) THEN
    RAISE EXCEPTION 'Quantidade e preco da linha de OC devem ser positivos';
  END IF;
  IF v_open_strap_po
     AND (coalesce(NEW.quantity, 0) < 0
       OR coalesce(NEW.unit_price, 0) < 0) THEN
    RAISE EXCEPTION 'Quantidade/preco bloqueado nao pode ser negativo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_assert_strap_purchase_order_item_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.purchase_orders po
     WHERE po.id = NEW.purchase_order_id
       AND po.source_type = 'strap_demand'
  ) AND NOT public.strap_purchase_item_has_canonical_origin(NEW.id) THEN
    RAISE EXCEPTION 'Item de OC de tira sem contribuicao canonica estrutural';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_strap_purchase_order_item
  ON public.purchase_order_items;
CREATE TRIGGER trg_guard_strap_purchase_order_item
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_purchase_order_item();

DROP TRIGGER IF EXISTS trg_validate_purchase_order_item
  ON public.purchase_order_items;
CREATE TRIGGER trg_validate_purchase_order_item
  BEFORE INSERT OR UPDATE OF product_id, unit, quantity, unit_price
  ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_purchase_order_item();

DROP TRIGGER IF EXISTS trg_assert_strap_purchase_order_item_origin
  ON public.purchase_order_items;
CREATE CONSTRAINT TRIGGER trg_assert_strap_purchase_order_item_origin
  AFTER INSERT OR UPDATE OF purchase_order_id, product_id, strap_variant_id
  ON public.purchase_order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_assert_strap_purchase_order_item_origin();

-- A prova também precisa reagir pelo lado das contribuições. Sem este trigger,
-- UPDATE/DELETE/supersede poderia deixar um item aberto órfão ou divergente sem
-- tocar purchase_order_items. OLD e NEW são checados no COMMIT; por isso o
-- materializador pode inserir primeiro o item e vincular a contribuição depois
-- na mesma transação.
CREATE OR REPLACE FUNCTION public.tg_assert_strap_purchase_contribution_origins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_item_id uuid;
  v_new_item_id uuid;
  v_item_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_item_id := OLD.purchase_order_item_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_item_id := NEW.purchase_order_item_id;
  END IF;

  FOR v_item_id IN
    SELECT DISTINCT candidate.item_id
      FROM unnest(ARRAY[v_old_item_id, v_new_item_id]::uuid[])
        AS candidate(item_id)
     WHERE candidate.item_id IS NOT NULL
     ORDER BY candidate.item_id
  LOOP
    -- Fatos bloqueados/fechados são históricos e não são reprovados por uma
    -- checagem retroativa. A invariável vale para o documento ainda editável.
    IF EXISTS (
      SELECT 1
        FROM public.purchase_order_items i
        JOIN public.purchase_orders po ON po.id = i.purchase_order_id
       WHERE i.id = v_item_id
         AND po.source_type = 'strap_demand'
         AND po.snapshot_locked_at IS NULL
         AND po.status IN ('draft', 'pending', 'Pendente')
    ) AND NOT public.strap_purchase_item_has_canonical_origin(v_item_id) THEN
      RAISE EXCEPTION
        'Contribuicao deixou item aberto de OC de tira sem origem canonica estrutural: %',
        v_item_id;
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_strap_purchase_contribution_origins
  ON public.purchase_demand_contributions;
CREATE CONSTRAINT TRIGGER trg_assert_strap_purchase_contribution_origins
  AFTER INSERT OR DELETE OR UPDATE OF
    purchase_order_id,
    purchase_order_item_id,
    purchase_product_id,
    strap_variant_id,
    status
  ON public.purchase_demand_contributions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_assert_strap_purchase_contribution_origins();

DO $strap_purchase_contribution_origin_contract$
DECLARE
  v_trigger_definition text;
  v_trigger_type integer;
  v_deferrable boolean;
  v_initially_deferred boolean;
BEGIN
  SELECT pg_get_triggerdef(t.oid),
         t.tgtype::integer,
         t.tgdeferrable,
         t.tginitdeferred
    INTO v_trigger_definition,
         v_trigger_type,
         v_deferrable,
         v_initially_deferred
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.purchase_demand_contributions'::regclass
     AND t.tgname = 'trg_assert_strap_purchase_contribution_origins'
     AND NOT t.tgisinternal;

  IF v_trigger_definition IS NULL
     OR NOT coalesce(v_deferrable, false)
     OR NOT coalesce(v_initially_deferred, false)
     OR (coalesce(v_trigger_type, 0) & 1) <> 1
     OR (coalesce(v_trigger_type, 0) & 28) <> 28
     OR (coalesce(v_trigger_type, 0) & 66) <> 0
     OR v_trigger_definition NOT ILIKE '%purchase_order_item_id%'
     OR v_trigger_definition NOT ILIKE '%purchase_product_id%'
     OR v_trigger_definition NOT ILIKE '%strap_variant_id%'
     OR v_trigger_definition NOT ILIKE '%status%' THEN
    RAISE EXCEPTION
      'Constraint de contribuicao nao revalida item aberto de OC de tira no COMMIT';
  END IF;
END;
$strap_purchase_contribution_origin_contract$;

CREATE OR REPLACE FUNCTION public.repair_unambiguous_strap_purchase_item_identity(
  p_limit integer DEFAULT 100,
  p_reason text DEFAULT 'Reparo estrutural de identidade de OC de tira',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate record;
  v_item public.purchase_order_items%ROWTYPE;
  v_before jsonb;
  v_repaired integer := 0;
  v_previous_engine_setting text := current_setting(
    'app.strap_po_engine',
    true
  );
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode reparar identidade de OC';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Motivo e correlation_id sao obrigatorios';
  END IF;

  PERFORM set_config('app.strap_po_engine', '1', true);

  FOR v_candidate IN
    SELECT i.id AS item_id, candidates.variant_ids[1] AS variant_id
      FROM public.purchase_order_items i
      JOIN public.purchase_orders po ON po.id = i.purchase_order_id
      CROSS JOIN LATERAL (
        SELECT array_agg(DISTINCT c.strap_variant_id ORDER BY c.strap_variant_id)
          AS variant_ids
          FROM public.purchase_demand_contributions c
         WHERE c.purchase_order_item_id = i.id
           AND c.purchase_product_id = i.product_id
           AND c.strap_variant_id IS NOT NULL
           AND c.status NOT IN ('cancelled', 'superseded')
           AND public.strap_purchase_item_identity_is_valid(
             i.product_id,
             c.strap_variant_id,
             false
           )
      ) candidates
     WHERE po.source_type = 'strap_demand'
       AND po.snapshot_locked_at IS NULL
       AND po.status IN ('draft', 'pending', 'Pendente')
       AND cardinality(candidates.variant_ids) = 1
       AND NOT public.strap_purchase_item_identity_is_valid(
         i.product_id,
         i.strap_variant_id,
         false
       )
     ORDER BY i.id
     LIMIT greatest(1, least(coalesce(p_limit, 100), 1000))
  LOOP
    SELECT i.*
      INTO v_item
      FROM public.purchase_order_items i
      JOIN public.purchase_orders po ON po.id = i.purchase_order_id
     WHERE i.id = v_candidate.item_id
       AND po.snapshot_locked_at IS NULL
       AND po.source_type = 'strap_demand'
     FOR UPDATE OF i;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_before := to_jsonb(v_item);
    UPDATE public.purchase_order_items
       SET strap_variant_id = v_candidate.variant_id
     WHERE id = v_item.id
     RETURNING * INTO v_item;
    v_repaired := v_repaired + 1;

    INSERT INTO public.artisanal_strap_operational_audit_log (
      entity_type, entity_id, action, before_data, after_data, reason,
      correlation_id, actor_id
    ) VALUES (
      'purchase_order_item', v_item.id, 'reconcile', v_before,
      to_jsonb(v_item), btrim(p_reason), p_correlation_id, auth.uid()
    );
  END LOOP;

  PERFORM set_config(
    'app.strap_po_engine',
    coalesce(v_previous_engine_setting, ''),
    true
  );

  RETURN jsonb_build_object(
    'repaired_purchase_order_items', v_repaired,
    'identity_source', 'purchase_demand_contributions',
    'correlation_id', p_correlation_id
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'app.strap_po_engine',
    coalesce(v_previous_engine_setting, ''),
    true
  );
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.strap_dead_letter_identity_is_unambiguous(
  p_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.strap_demand_jobs%ROWTYPE;
BEGIN
  SELECT j.* INTO v_job
    FROM public.strap_demand_jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND
     OR v_job.status <> 'dead_letter'
     OR v_job.last_error NOT LIKE '%Item de OC de tira exige strap_variant_id e produto exatos%'
     OR jsonb_typeof(v_job.payload -> 'lines') <> 'array'
     OR jsonb_array_length(v_job.payload -> 'lines') = 0 THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_job.payload -> 'lines') line(value)
      LEFT JOIN public.artisanal_strap_variants v
        ON v.id = public.try_parse_uuid(line.value ->> 'strap_variant_id')
      LEFT JOIN public.artisanal_strap_recipes r
        ON r.id = public.try_parse_uuid(line.value ->> 'recipe_id')
     WHERE v.id IS NULL
        OR v.status <> 'active'
        OR v.finished_product_id IS DISTINCT FROM
           public.try_parse_uuid(line.value ->> 'finished_product_id')
        OR coalesce(line.value ->> 'source_mode', '') NOT IN ('internal', 'buy_ready')
        OR CASE
          WHEN line.value -> 'blocking_reasons' IS NULL THEN false
          WHEN jsonb_typeof(line.value -> 'blocking_reasons') = 'array'
            THEN jsonb_array_length(line.value -> 'blocking_reasons') > 0
          ELSE true
        END
        OR (
          line.value ->> 'source_mode' = 'internal'
          AND (
            r.id IS NULL
            -- A receita do job é snapshot imutável. Depois da aprovação do PV
            -- ela pode ter sido versionada; superseded continua legítima, mas
            -- nenhum outro estado é aceito para requeue automático.
            OR r.status NOT IN ('approved', 'superseded')
            OR r.measure_id IS DISTINCT FROM v.measure_id
            OR r.base_group_id IS DISTINCT FROM v.base_group_id
            OR r.id IS DISTINCT FROM public.try_parse_uuid(
              line.value -> 'resolved' -> 'catalog' ->> 'recipe_id'
            )
            OR v.id IS DISTINCT FROM public.try_parse_uuid(
              line.value -> 'resolved' -> 'catalog' ->> 'variant_id'
            )
            OR v.measure_id IS DISTINCT FROM public.try_parse_uuid(
              line.value -> 'resolved' -> 'catalog' ->> 'measure_id'
            )
            OR v.base_group_id IS DISTINCT FROM public.try_parse_uuid(
              line.value -> 'resolved' -> 'catalog' ->> 'base_group_id'
            )
            OR r.version IS DISTINCT FROM CASE
              WHEN jsonb_typeof(
                line.value -> 'resolved' -> 'catalog' -> 'recipe_version'
              ) = 'number'
               AND line.value -> 'resolved' -> 'catalog' ->> 'recipe_version'
                   ~ '^[1-9][0-9]*$'
                THEN (
                  line.value -> 'resolved' -> 'catalog' ->> 'recipe_version'
                )::integer
              ELSE NULL
            END
            OR r.confirmed_yield_m_per_m IS DISTINCT FROM CASE
              WHEN jsonb_typeof(
                line.value -> 'resolved' -> 'confirmed_yield_m_per_m'
              ) = 'number'
                THEN (
                  line.value -> 'resolved' ->> 'confirmed_yield_m_per_m'
                )::numeric
              ELSE NULL
            END
            OR r.usable_base_width_mm_snapshot IS DISTINCT FROM CASE
              WHEN jsonb_typeof(
                line.value -> 'resolved' -> 'usable_base_width_mm_snapshot'
              ) = 'number'
                THEN (
                  line.value -> 'resolved' ->> 'usable_base_width_mm_snapshot'
                )::numeric
              ELSE NULL
            END
            OR r.cut_band_width_mm IS DISTINCT FROM CASE
              WHEN jsonb_typeof(
                line.value -> 'resolved' -> 'cut_band_width_mm'
              ) = 'number'
                THEN (
                  line.value -> 'resolved' ->> 'cut_band_width_mm'
                )::numeric
              ELSE NULL
            END
            OR r.theoretical_yield_m_per_m IS DISTINCT FROM CASE
              WHEN jsonb_typeof(
                line.value -> 'resolved' -> 'theoretical_yield_m_per_m'
              ) = 'number'
                THEN (
                  line.value -> 'resolved' ->> 'theoretical_yield_m_per_m'
                )::numeric
              ELSE NULL
            END
            OR public.try_parse_uuid(line.value ->> 'base_product_id') IS NULL
            OR public.try_parse_uuid(line.value ->> 'base_product_id')
              IS DISTINCT FROM public.try_parse_uuid(
                line.value -> 'resolved' -> 'catalog' ->> 'base_product_id'
              )
            OR public.try_parse_uuid(line.value ->> 'finished_product_id')
              IS DISTINCT FROM public.try_parse_uuid(
                line.value -> 'resolved' -> 'catalog' ->> 'finished_product_id'
              )
            OR NOT EXISTS (
              SELECT 1
                FROM public.base_material_color_official_products op
               WHERE op.base_group_id = v.base_group_id
                 AND op.color_id = v.color_id
                 AND op.official_product_id =
                     public.try_parse_uuid(line.value ->> 'base_product_id')
                 AND op.status = 'active'
            )
          )
        )
        OR (
          line.value ->> 'source_mode' = 'buy_ready'
          AND (
            NOT v.purchase_enabled
            OR public.try_parse_uuid(line.value ->> 'base_product_id') IS NOT NULL
          )
        )
  ) THEN
    RETURN false;
  END IF;

  -- O reconcile pode recalcular OCs abertas da mesma napa. Só libera o retry
  -- quando todos os itens canônicos abertos já passam pelo vínculo UUID exato.
  IF EXISTS (
    SELECT 1
      FROM public.purchase_order_items i
      JOIN public.purchase_orders po ON po.id = i.purchase_order_id
     WHERE po.source_type = 'strap_demand'
       AND po.snapshot_locked_at IS NULL
       AND po.status IN ('draft', 'pending', 'Pendente')
       AND NOT public.strap_purchase_item_has_canonical_origin(i.id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.requeue_unambiguous_strap_identity_dead_letters(
  p_limit integer DEFAULT 100,
  p_reason text DEFAULT 'Reencaminhar dead-letter com identidade estrutural resolvida',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.strap_demand_jobs%ROWTYPE;
  v_requeued integer := 0;
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode reencaminhar dead-letter';
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Motivo e correlation_id sao obrigatorios';
  END IF;

  FOR v_job IN
    SELECT j.*
      FROM public.strap_demand_jobs j
     WHERE j.status = 'dead_letter'
       AND j.last_error LIKE
         '%Item de OC de tira exige strap_variant_id e produto exatos%'
     ORDER BY j.completed_at, j.created_at, j.id
     LIMIT greatest(1, least(coalesce(p_limit, 100), 1000))
     FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT public.strap_dead_letter_identity_is_unambiguous(v_job.id) THEN
      CONTINUE;
    END IF;

    UPDATE public.strap_demand_jobs
       SET status = 'retry',
           attempts = 0,
           next_attempt_at = now(),
           locked_at = NULL,
           locked_by = NULL,
           last_error = NULL,
           completed_at = NULL,
           correlation_id = p_correlation_id,
           updated_at = now()
     WHERE id = v_job.id;
    v_requeued := v_requeued + 1;

    INSERT INTO public.artisanal_strap_operational_audit_log (
      entity_type, entity_id, action, before_data, after_data, reason,
      correlation_id, actor_id
    ) VALUES (
      'strap_demand_job', v_job.id, 'retry', to_jsonb(v_job),
      jsonb_build_object(
        'status', 'retry',
        'attempts', 0,
        'identity_resolution', 'exact_uuid_and_contribution'
      ),
      btrim(p_reason), p_correlation_id, auth.uid()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'requeued_jobs', v_requeued,
    'processed_by_worker', false,
    'correlation_id', p_correlation_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Fila acionável e helper de integridade por PV.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_strap_canonical_action_queue()
RETURNS TABLE(
  issue_code text,
  severity text,
  entity_type text,
  entity_id uuid,
  sale_order_id uuid,
  action_required text,
  blocking_reason text,
  details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF session_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT
    'migration_review_required'::text,
    'high'::text,
    ri.entity_type,
    ri.id,
    NULL::uuid,
    CASE
      WHEN ri.entity_type = 'buy_ready_strap_product'
        THEN 'Revisar/criar a variante buy-ready pelo bundle canônico'
      ELSE 'Resolver manualmente o item de migração com os UUIDs confirmados'
    END,
    ri.reason,
    jsonb_build_object(
      'legacy_id', ri.legacy_id,
      'candidates', ri.candidates,
      'resolution_operation', 'resolve_artisanal_strap_migration_review_item'
    )
  FROM public.artisanal_strap_migration_review_items ri
  WHERE ri.status = 'review_required'

  UNION ALL

  SELECT
    'napa_width_inverted'::text,
    'high'::text,
    'product_group'::text,
    d.entity_id,
    NULL::uuid,
    'Confirmar largura física e corrigir dimensions_width; não usar GREATEST nem trocar comprimento automaticamente'::text,
    'Largura de napa diverge da ficha de componente'::text,
    d.details
  FROM public.artisanal_strap_catalog_diagnostics() d
  WHERE d.issue_code = 'napa_width_inverted'

  UNION ALL

  SELECT
    'executor_calendar_missing'::text,
    'critical'::text,
    'strap_executor'::text,
    coalesce(r.default_contractor_id, r.id),
    NULL::uuid,
    'Cadastrar o calendário real do executor na tela canônica de Planejamento de Tiras'::text,
    'Receita aprovada sem calendário operacional ativo'::text,
    jsonb_build_object(
      'executor_type', r.executor_type,
      'contractor_id', r.default_contractor_id,
      'sample_recipe_id', r.id,
      'save_operation', 'save_strap_operational_calendar'
    )
  FROM (
    SELECT DISTINCT ON (recipe.executor_type, recipe.default_contractor_id)
      recipe.id,
      recipe.executor_type,
      recipe.default_contractor_id
    FROM public.artisanal_strap_recipes recipe
    WHERE recipe.status = 'approved'
      AND recipe.valid_from <= now()
      AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
    ORDER BY recipe.executor_type, recipe.default_contractor_id,
      recipe.version DESC, recipe.id
  ) r
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.strap_operational_calendars calendar
     WHERE calendar.calendar_type = r.executor_type
       AND calendar.contractor_id IS NOT DISTINCT FROM r.default_contractor_id
       AND calendar.status = 'active'
  )

  UNION ALL

  SELECT
    'executor_capacity_missing'::text,
    'critical'::text,
    'strap_executor'::text,
    coalesce(r.default_contractor_id, r.id),
    NULL::uuid,
    'Cadastrar a capacidade real do executor na tela canônica de Planejamento de Tiras'::text,
    'Receita aprovada sem capacidade vigente'::text,
    jsonb_build_object(
      'executor_type', r.executor_type,
      'contractor_id', r.default_contractor_id,
      'sample_recipe_id', r.id,
      'save_operation', 'save_strap_executor_capacity'
    )
  FROM (
    SELECT DISTINCT ON (recipe.executor_type, recipe.default_contractor_id)
      recipe.id,
      recipe.executor_type,
      recipe.default_contractor_id
    FROM public.artisanal_strap_recipes recipe
    WHERE recipe.status = 'approved'
      AND recipe.valid_from <= now()
      AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
    ORDER BY recipe.executor_type, recipe.default_contractor_id,
      recipe.version DESC, recipe.id
  ) r
  WHERE NOT EXISTS (
      SELECT 1
        FROM public.strap_executor_capacities c
       WHERE c.executor_type = r.executor_type
         AND c.contractor_id IS NOT DISTINCT FROM r.default_contractor_id
         AND c.status = 'active'
         AND c.valid_from <= current_date
         AND (c.valid_to IS NULL OR c.valid_to >= current_date)
    )

  UNION ALL

  SELECT
    'strap_demand_capacity_suspended'::text,
    'critical'::text,
    'sale_order_strap_demand'::text,
    d.id,
    d.sale_order_id,
    'Reprocessar o planejamento após configurar a capacidade do executor'::text,
    coalesce(d.suspension_reason, 'Demanda suspensa')::text,
    jsonb_build_object(
      'strap_variant_id', d.strap_variant_id,
      'gross_required_m', d.gross_required_m,
      'status', d.status,
      'required_at', d.required_at
    )
  FROM public.sale_order_strap_demands d
  WHERE d.is_current
    AND d.status = 'suspended'
    AND d.suspension_reason = 'Capacidade diaria do executor nao cadastrada'

  UNION ALL

  SELECT
    'strap_identity_dead_letter'::text,
    'critical'::text,
    'strap_demand_job'::text,
    j.id,
    CASE WHEN j.source_type = 'sale_order' THEN j.source_id ELSE NULL END,
    CASE
      WHEN public.strap_dead_letter_identity_is_unambiguous(j.id)
        THEN 'Reencaminhar com requeue_unambiguous_strap_identity_dead_letters'
      ELSE 'Corrigir o vínculo estrutural de variante/produto antes do retry'
    END,
    coalesce(j.last_error, 'Job em dead-letter')::text,
    jsonb_build_object(
      'source_type', j.source_type,
      'source_id', j.source_id,
      'event_type', j.event_type,
      'attempts', j.attempts,
      'identity_unambiguous',
        public.strap_dead_letter_identity_is_unambiguous(j.id)
    )
  FROM public.strap_demand_jobs j
  WHERE j.status = 'dead_letter'

  UNION ALL

  SELECT
    'strap_batch_unscheduled_balance'::text,
    'high'::text,
    'strap_production_batch_item'::text,
    bi.id,
    sale_ids.sale_order_ids[1],
    'Cadastrar capacidade real e replanejar o lote antes de iniciar'::text,
    'Parte da metragem do lote não cabe na agenda vigente'::text,
    jsonb_build_object(
      'batch_id', bi.batch_id,
      'strap_variant_id', bi.strap_variant_id,
      'planned_finished_m', bi.planned_finished_m,
      'scheduled_m', bi.scheduled_m,
      'unscheduled_m', bi.unscheduled_m,
      'sale_order_ids', to_jsonb(coalesce(sale_ids.sale_order_ids, ARRAY[]::uuid[]))
    )
  FROM public.strap_production_batch_items bi
  CROSS JOIN LATERAL (
    SELECT array_agg(DISTINCT d.sale_order_id ORDER BY d.sale_order_id)
      AS sale_order_ids
      FROM public.strap_production_batch_contributions c
      JOIN public.sale_order_strap_demands d
        ON d.id = c.sale_order_strap_demand_id
     WHERE c.batch_item_id = bi.id
  ) sale_ids
  WHERE bi.status NOT IN ('completed', 'cancelled')
    AND bi.unscheduled_m > 0

  UNION ALL

  SELECT
    'legacy_billed_strap_service_order_open'::text,
    'medium'::text,
    'service_order'::text,
    so.id,
    linked.sale_order_ids[1],
    'Reconciliar manualmente a OS histórica; não fechar pelo status Faturado do PV'::text,
    'OS de tira histórica ligada a PV faturado continua aberta'::text,
    jsonb_build_object(
      'status', so.status,
      'sale_order_ids', to_jsonb(linked.sale_order_ids),
      'canonical_item_count', 0,
      'auto_close_allowed', false
    )
  FROM public.service_orders so
  CROSS JOIN LATERAL (
    SELECT array_agg(DISTINCT candidate.sale_order_id ORDER BY candidate.sale_order_id)
      AS sale_order_ids
      FROM (
        SELECT so.source_sale_order_id AS sale_order_id
        WHERE so.source_sale_order_id IS NOT NULL
        UNION
        SELECT so.sale_order_id
        WHERE so.sale_order_id IS NOT NULL
        UNION
        SELECT unnest(coalesce(so.linked_sale_order_ids, ARRAY[]::uuid[]))
        UNION
        SELECT coalesce(i.sale_order_id, o.sale_order_id)
          FROM public.service_order_items i
          LEFT JOIN public.orders o ON o.id = i.order_id
         WHERE i.service_order_id = so.id
      ) candidate
      JOIN public.sale_orders billed ON billed.id = candidate.sale_order_id
     WHERE billed.status = 'Faturado'
       AND billed.deleted_at IS NULL
  ) linked
  WHERE so.service_order_domain = 'strap'
    AND cardinality(linked.sale_order_ids) > 0
    AND lower(btrim(coalesce(so.status, ''))) NOT IN (
      'concluído', 'concluido', 'finalizado', 'received',
      'cancelado', 'cancelada', 'entregue'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.service_order_items i
       WHERE i.service_order_id = so.id
         AND i.strap_variant_id IS NOT NULL
    )

  UNION ALL

  SELECT
    'strap_production_receipt_stock_ledger_gap'::text,
    'critical'::text,
    'strap_production_receipt'::text,
    r.id,
    receipt_sales.sale_order_ids[1],
    'Reconciliar movimentos físicos do recebimento antes de encerrar lote/OS'::text,
    'Baixa da napa ou entrada da tira não fecha com o recebimento aprovado'::text,
    jsonb_build_object(
      'batch_item_id', r.batch_item_id,
      'base_product_id', r.base_product_id,
      'finished_product_id', r.finished_product_id,
      'base_consumed_m', r.base_consumed_m,
      'base_posted_m', physical.base_posted_m,
      'approved_m', r.approved_m,
      'finished_posted_m', physical.finished_posted_m,
      'has_base_deficit_reconciliation', physical.has_base_deficit_reconciliation,
      'sale_order_ids', to_jsonb(coalesce(receipt_sales.sale_order_ids, ARRAY[]::uuid[]))
    )
  FROM public.strap_production_receipts r
  CROSS JOIN LATERAL (
    SELECT
      coalesce(sum(m.quantity) FILTER (
        WHERE m.product_id = r.base_product_id AND m.movement_type = 'out'
      ), 0) AS base_posted_m,
      coalesce(sum(m.quantity) FILTER (
        WHERE m.product_id = r.finished_product_id AND m.movement_type = 'in'
      ), 0) AS finished_posted_m,
      EXISTS (
        SELECT 1
          FROM public.strap_pending_reconciliations pr
         WHERE pr.production_receipt_id = r.id
           AND pr.reconciliation_type = 'base_stock_deficit'
           AND pr.expected_quantity = r.base_consumed_m
      ) AS has_base_deficit_reconciliation
    FROM public.stock_movements m
    WHERE m.strap_production_receipt_id = r.id
  ) physical
  CROSS JOIN LATERAL (
    SELECT array_agg(DISTINCT d.sale_order_id ORDER BY d.sale_order_id)
      AS sale_order_ids
      FROM public.strap_production_receipt_allocations ra
      JOIN public.strap_production_batch_contributions c
        ON c.id = ra.batch_contribution_id
      JOIN public.sale_order_strap_demands d
        ON d.id = c.sale_order_strap_demand_id
     WHERE ra.production_receipt_id = r.id
  ) receipt_sales
  WHERE (
      abs(physical.base_posted_m - r.base_consumed_m) > 0.000001
      AND NOT physical.has_base_deficit_reconciliation
    )
    OR abs(physical.finished_posted_m - r.approved_m) > 0.000001;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_strap_flow_integrity_diagnostics(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  check_name text,
  category text,
  severity text,
  item_count bigint,
  sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(
         ARRAY['admin', 'gerente', 'producao']
       )
     ) THEN
    RAISE EXCEPTION
      'Diagnostico do fluxo de Tiras exige Administracao/Gerencia/Producao'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL
     AND coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION
      'Visao global do fluxo de Tiras exige Administracao/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH expected(check_name, category, issue_severity) AS (
    VALUES
      ('strap_migration_review_required'::text, 'strap_catalog'::text, 'error'::text),
      ('strap_napa_width_inverted', 'strap_catalog', 'error'),
      ('strap_executor_calendar_missing', 'strap_planning', 'critical'),
      ('strap_executor_capacity_missing', 'strap_planning', 'critical'),
      ('strap_demand_capacity_suspended', 'strap_planning', 'critical'),
      ('strap_identity_dead_letter', 'strap_purchase', 'critical'),
      ('strap_batch_unscheduled_balance', 'strap_production', 'error'),
      ('strap_legacy_billed_service_order_open', 'strap_production', 'warning'),
      ('strap_production_receipt_stock_ledger_gap', 'strap_stock', 'critical')
  ), scoped AS (
    SELECT q.*
      FROM public.list_strap_canonical_action_queue() q
     WHERE p_sale_order_id IS NULL
        OR q.sale_order_id = p_sale_order_id
        OR EXISTS (
          SELECT 1
            FROM jsonb_array_elements_text(
              coalesce(q.details -> 'sale_order_ids', '[]'::jsonb)
            ) sale_id(value)
           WHERE public.try_parse_uuid(sale_id.value) = p_sale_order_id
        )
  ), normalized AS (
    SELECT CASE s.issue_code
        WHEN 'migration_review_required' THEN 'strap_migration_review_required'
        WHEN 'napa_width_inverted' THEN 'strap_napa_width_inverted'
        WHEN 'executor_calendar_missing' THEN 'strap_executor_calendar_missing'
        WHEN 'executor_capacity_missing' THEN 'strap_executor_capacity_missing'
        WHEN 'strap_demand_capacity_suspended' THEN 'strap_demand_capacity_suspended'
        WHEN 'strap_identity_dead_letter' THEN 'strap_identity_dead_letter'
        WHEN 'strap_batch_unscheduled_balance' THEN 'strap_batch_unscheduled_balance'
        WHEN 'legacy_billed_strap_service_order_open'
          THEN 'strap_legacy_billed_service_order_open'
        WHEN 'strap_production_receipt_stock_ledger_gap'
          THEN 'strap_production_receipt_stock_ledger_gap'
      END AS check_name,
      s.entity_type,
      s.entity_id,
      s.action_required
    FROM scoped s
  ), aggregated AS (
    SELECT n.check_name,
           pg_catalog.count(*)::bigint AS item_count,
           (pg_catalog.array_agg(
             pg_catalog.concat(
               n.entity_type,
               ':',
               n.entity_id::text,
               ':',
               n.action_required
             ) ORDER BY n.entity_type, n.entity_id
           ))[1:5]::text AS sample
      FROM normalized n
     WHERE n.check_name IS NOT NULL
     GROUP BY n.check_name
  )
  SELECT e.check_name,
         e.category,
         CASE WHEN coalesce(a.item_count, 0) > 0
           THEN e.issue_severity ELSE 'ok' END::text,
         coalesce(a.item_count, 0)::bigint,
         a.sample
    FROM expected e
    LEFT JOIN aggregated a ON a.check_name = e.check_name
   ORDER BY e.check_name;
END;
$$;

COMMENT ON FUNCTION public.get_strap_flow_integrity_diagnostics(uuid) IS
  'CheckRows normalizados do fluxo de Tiras por PV para composicao sem redefinir get_sale_order_command_diagnostics.';

-- ---------------------------------------------------------------------------
-- ACL: a fila bruta atravessa tabelas admin-only e fica interna. O helper
-- normalizado aplica o gate operacional; mutações seguem com gate administrativo.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.strap_purchase_item_identity_is_valid(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.strap_purchase_item_has_canonical_origin(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_assert_strap_purchase_contribution_origins()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.repair_unambiguous_strap_purchase_item_identity(integer, text, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.strap_dead_letter_identity_is_unambiguous(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_unambiguous_strap_identity_dead_letters(integer, text, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_strap_canonical_action_queue()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_strap_flow_integrity_diagnostics(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.strap_purchase_item_identity_is_valid(uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.strap_purchase_item_has_canonical_origin(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_unambiguous_strap_purchase_item_identity(integer, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.strap_dead_letter_identity_is_unambiguous(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_unambiguous_strap_identity_dead_letters(integer, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_strap_canonical_action_queue()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_strap_flow_integrity_diagnostics(uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Contratos executáveis do fluxo físico e da independência de cor.
-- ---------------------------------------------------------------------------

DO $strap_flow_contract$
DECLARE
  v_writer text := pg_get_functiondef(
    'public.ensure_strap_production_contribution(uuid,uuid,numeric,uuid)'::regprocedure
  );
  v_receipt text := pg_get_functiondef(
    'public.register_strap_production_receipt(uuid,uuid,numeric,numeric,numeric,numeric,text,numeric,text,timestamptz,text,uuid,jsonb)'::regprocedure
  );
  v_close text := pg_get_functiondef(
    'public.reconcile_strap_service_order_completion(uuid,uuid,text)'::regprocedure
  );
  v_reconcile text := pg_get_functiondef(
    'public.reconcile_strap_variant_local_202701(uuid,uuid,text)'::regprocedure
  );
  v_identity_guard text := pg_get_functiondef(
    'public.strap_purchase_item_identity_is_valid(uuid,uuid,boolean)'::regprocedure
  );
BEGIN
  IF position('service_order_domain = ''strap''' IN v_writer) = 0
     OR position('strap_production_batch_contributions' IN v_writer) = 0
     OR position('schedule_strap_batch_item' IN v_writer) = 0 THEN
    RAISE EXCEPTION 'Fluxo demanda -> lote/OS de Tiras perdeu a fronteira canonica';
  END IF;

  IF position('strap_production_receipt_id' IN v_receipt) = 0
     OR position('Consumo de napa no recebimento de tira' IN v_receipt) = 0
     OR position('Entrada aprovada de producao de tira' IN v_receipt) = 0
     OR position('base_stock_deficit' IN v_receipt) = 0 THEN
    RAISE EXCEPTION 'Recebimento de tira nao garante OUT napa + IN tira + reconciliacao';
  END IF;

  IF position('v_line.strap_variant_id IS NULL' IN v_close) = 0
     OR position('''canonical'',false' IN replace(v_close, ' ', '')) = 0
     OR position('contractor_material_custody_movements' IN v_close) = 0
     OR position('strap_production_batch_contributions' IN v_close) = 0
     OR lower(v_close) LIKE '%faturado%'
     OR position('sale_orders' IN v_close) > 0 THEN
    RAISE EXCEPTION 'OS de tira historica pode ser fechada pelo status do PV';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'artisanal_strap_recipes'
          AND c.column_name IN ('color_id', 'canonical_color_id')
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_indexes i
        WHERE i.schemaname = 'public'
          AND i.indexname = 'artisanal_strap_recipes_current_approved_uq'
          AND i.indexdef LIKE '%(measure_id, base_group_id)%'
     ) THEN
    RAISE EXCEPTION 'Rendimento de tira deixou de pertencer a medida + familia, independente de cor';
  END IF;

  IF position('v_demand.finished_product_id' IN v_reconcile) = 0
     OR position('v_demand.base_product_id' IN v_reconcile) = 0
     OR position('p_allow_consolidated_base' IN v_identity_guard) = 0
     OR position('v.purchase_enabled' IN v_identity_guard) = 0 THEN
    RAISE EXCEPTION 'Compra de tira pronta/base perdeu a identidade canonica por modo de origem';
  END IF;
END;
$strap_flow_contract$;

-- ---------------------------------------------------------------------------
-- Backfill seguro de implantação. Enfileira; não drena worker nem fecha OS.
-- ---------------------------------------------------------------------------

DO $strap_flow_unlock_deploy$
DECLARE
  v_correlation_id uuid := gen_random_uuid();
BEGIN
  PERFORM public.repair_unambiguous_strap_purchase_item_identity(
    1000,
    'Reparo inicial de identidade exata de OC de tira',
    v_correlation_id
  );
  PERFORM public.requeue_unambiguous_strap_identity_dead_letters(
    1000,
    'Reencaminhamento inicial de dead-letter com identidade exata',
    v_correlation_id
  );
END;
$strap_flow_unlock_deploy$;

COMMIT;
