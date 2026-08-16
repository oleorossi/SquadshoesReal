-- =============================================================================
-- Tiras compradas prontas: identidade independente da base da referencia
-- Spec: specs/identidade-variantes-e-tiras-compradas.md (Reqs. 15-21)
--
-- Esta migration e incremental. As migrations 03000-03300 ja podem estar
-- publicadas; por isso os contratos vivos sao substituidos aqui sem reescrever
-- seus arquivos ou os fatos historicos do motor operacional.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Capacidade de producao e base da identidade
-- -----------------------------------------------------------------------------

ALTER TABLE public.artisanal_strap_variants
  ADD COLUMN identity_basis text NOT NULL DEFAULT 'reference_base',
  ADD COLUMN internal_production_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.artisanal_strap_variants.identity_basis IS
  'reference_base: base_group_id e a napa/material representado pela referencia; finished_product_group: base_group_id e o grupo proprio do componente acabado comprado.';
COMMENT ON COLUMN public.artisanal_strap_variants.internal_production_enabled IS
  'Capacidade explicita de fabricar a tira. false impede receita, lote, OS e reserva de napa.';

-- IDs decididos, nunca nomes. O helper centraliza o gate nominal para impedir
-- que qualquer writer legado recrie STRASS como tira artesanal.
CREATE OR REPLACE FUNCTION public.is_buy_ready_strass_identity(
  p_finished_product_id uuid,
  p_group_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(p_finished_product_id IN (
      '9962fc0e-e95c-4e0a-8162-1a21c79f64dc'::uuid,
      'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5'::uuid,
      '9028a544-5de5-4798-a37b-edc3b51e82f3'::uuid,
      '4a60b9c5-eacd-4cd8-82de-b8176ee217b2'::uuid,
      'e7056d1b-28a3-462a-b3af-f28d298194b8'::uuid,
      '6e958e62-fc9d-4bdd-be01-43561adc5b36'::uuid,
      'd47aaf48-644c-473d-b903-8f289270555b'::uuid
    ), false)
    OR coalesce(p_group_id IN (
      'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
      '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
    ), false);
$$;

-- Os UUIDs abaixo sao contrato de negocio, nao uma heuristica. A migration
-- para antes de qualquer backfill se o catalogo real nao contiver exatamente
-- os sete produtos nos dois grupos decididos.
DO $$
DECLARE
  v_group_count integer;
  v_product_count integer;
BEGIN
  SELECT count(*) INTO v_group_count
    FROM public.product_groups g
   WHERE g.id IN (
     'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
     '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
   );
  IF v_group_count <> 2 THEN
    RAISE EXCEPTION
      'Gate STRASS incompleto: esperados 2 grupos UUID explicitos, encontrados %',
      v_group_count;
  END IF;

  SELECT count(*) INTO v_product_count
    FROM public.products p
   WHERE p.id IN (
     '9962fc0e-e95c-4e0a-8162-1a21c79f64dc'::uuid,
     'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5'::uuid,
     '9028a544-5de5-4798-a37b-edc3b51e82f3'::uuid,
     '4a60b9c5-eacd-4cd8-82de-b8176ee217b2'::uuid,
     'e7056d1b-28a3-462a-b3af-f28d298194b8'::uuid,
     '6e958e62-fc9d-4bdd-be01-43561adc5b36'::uuid,
     'd47aaf48-644c-473d-b903-8f289270555b'::uuid
   )
   AND p.group_id IN (
     'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
     '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
   );
  IF v_product_count <> 7 THEN
    RAISE EXCEPTION
      'Gate STRASS incompleto: os 7 produtos UUID explicitos devem existir e pertencer aos 2 grupos decididos; encontrados %',
      v_product_count;
  END IF;
END;
$$;

-- O JSON das fichas antigas usa group_id como diagnostico. Somente os dois
-- grupos decididos pelo dono sao promovidos a identidade operacional; nenhum
-- nome de produto/grupo participa do backfill.
UPDATE public.technical_sheets ts
   SET strap_colors = (
    SELECT jsonb_agg(
      CASE
        WHEN e.value ->> 'group_id' IN (
          'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
          '6e43bbda-0f1f-412c-8d4a-ec009114530d'
        ) THEN e.value || jsonb_build_object(
          'identity_basis', 'finished_product_group',
          'identity_group_id', e.value ->> 'group_id'
        )
        ELSE e.value
      END
      ORDER BY e.ordinality
    )
      FROM jsonb_array_elements(ts.strap_colors) WITH ORDINALITY AS e(value, ordinality)
  )
 WHERE jsonb_typeof(ts.strap_colors) = 'array'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(ts.strap_colors) AS line(value)
      WHERE line.value ->> 'group_id' IN (
        'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
        '6e43bbda-0f1f-412c-8d4a-ec009114530d'
      )
   );

-- -----------------------------------------------------------------------------
-- 2. Validacao, disponibilidade por origem e sincronismo do produto
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_source_availability(
  p_variant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_official public.base_material_color_official_products%ROWTYPE;
  v_base public.products%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_measure_active boolean := false;
  v_color_active boolean := false;
  v_finished_allowed boolean := false;
  v_internal_allowed boolean := false;
  v_buy_allowed boolean := false;
  v_base_width_mm numeric;
  v_internal_reason text;
  v_buy_reason text;
BEGIN
  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants
   WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;

  SELECT * INTO v_finished FROM public.products WHERE id = v_variant.finished_product_id;
  SELECT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.id = v_variant.measure_id AND m.active AND t.active
  ) INTO v_measure_active;
  SELECT EXISTS (
    SELECT 1 FROM public.canonical_colors c
     WHERE c.id = v_variant.color_id AND c.active
  ) INTO v_color_active;

  IF v_variant.identity_basis = 'reference_base'
     AND v_variant.internal_production_enabled THEN
    SELECT * INTO v_official
      FROM public.base_material_color_official_products op
     WHERE op.base_group_id = v_variant.base_group_id
       AND op.color_id = v_variant.color_id
       AND op.status = 'active';
    IF v_official.id IS NOT NULL THEN
      SELECT * INTO v_base FROM public.products WHERE id = v_official.official_product_id;
      v_base_width_mm := public.strap_material_product_width_mm(v_official.official_product_id);
    END IF;
    SELECT * INTO v_recipe
      FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_variant.measure_id
       AND r.base_group_id = v_variant.base_group_id
       AND r.status = 'approved'
       AND r.valid_from <= now()
       AND (r.valid_to IS NULL OR r.valid_to > now());
  END IF;

  v_finished_allowed := v_variant.status = 'active'
    AND v_finished.id IS NOT NULL AND v_finished.active AND v_finished.unit = 'm';
  v_internal_allowed := v_finished_allowed
    AND v_variant.internal_production_enabled
    AND v_variant.identity_basis = 'reference_base'
    AND v_measure_active AND v_color_active
    AND v_official.id IS NOT NULL
    AND v_base.id IS NOT NULL AND v_base.active
    AND v_base.group_id IS NOT DISTINCT FROM v_variant.base_group_id
    AND v_base_width_mm IS NOT NULL
    AND v_recipe.id IS NOT NULL
    AND abs(v_base_width_mm - v_recipe.usable_base_width_mm_snapshot) <= 0.000001;
  v_buy_allowed := v_finished_allowed
    AND v_variant.purchase_enabled
    AND coalesce(v_finished.purchase_price > 0, false)
    AND nullif(btrim(coalesce(v_finished.purchase_unit, '')), '') IS NOT NULL
    AND coalesce(v_finished.conversion_rate > 0, false)
    AND (v_finished.purchase_unit <> v_finished.unit OR v_finished.conversion_rate = 1)
    AND coalesce(v_finished.min_order_quantity > 0, false)
    AND coalesce(v_finished.purchase_multiple > 0, false)
    AND coalesce(v_finished.material_preparation_days >= 0, false);

  v_internal_reason := CASE
    WHEN v_variant.status <> 'active' THEN 'variant_administratively_blocked'
    WHEN NOT v_finished_allowed THEN 'finished_product_inactive_or_invalid'
    WHEN NOT v_variant.internal_production_enabled
      OR v_variant.identity_basis = 'finished_product_group'
      THEN 'internal_production_disabled'
    WHEN NOT v_measure_active THEN 'type_or_measure_inactive'
    WHEN NOT v_color_active THEN 'canonical_color_discontinued'
    WHEN v_official.id IS NULL OR v_base.id IS NULL OR NOT coalesce(v_base.active, false)
      THEN 'official_base_color_discontinued'
    WHEN v_recipe.id IS NULL THEN 'approved_current_recipe_missing'
    WHEN v_base_width_mm IS NULL
      OR abs(v_base_width_mm - v_recipe.usable_base_width_mm_snapshot) > 0.000001
      THEN 'official_base_width_invalid'
    ELSE NULL END;
  v_buy_reason := CASE
    WHEN v_variant.status <> 'active' THEN 'variant_administratively_blocked'
    WHEN NOT v_finished_allowed THEN 'finished_product_inactive_or_invalid'
    WHEN NOT v_variant.purchase_enabled THEN 'buy_ready_not_enabled'
    WHEN NOT v_buy_allowed THEN 'commercial_data_inactive_or_invalid'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'variant_status', v_variant.status,
    'identity_basis', v_variant.identity_basis,
    'identity_group_id', CASE WHEN v_variant.identity_basis = 'finished_product_group'
      THEN v_variant.base_group_id ELSE NULL END,
    'internal_production_enabled', v_variant.internal_production_enabled,
    'administratively_active', v_variant.status = 'active',
    'finished_stock_consumption_allowed', v_finished_allowed,
    'finished_available_m', CASE WHEN v_finished_allowed THEN
      greatest(coalesce(v_finished.quantity, 0) - coalesce(v_finished.reserved_stock, 0), 0)
      ELSE 0 END,
    'internal_production_allowed', v_internal_allowed,
    'buy_ready_purchase_allowed', v_buy_allowed,
    'internal_block_reason', v_internal_reason,
    'buy_ready_block_reason', v_buy_reason,
    'base_product_id', CASE WHEN v_variant.identity_basis = 'reference_base'
      THEN v_official.official_product_id ELSE NULL END,
    'recipe_id', CASE WHEN v_variant.identity_basis = 'reference_base'
      THEN v_recipe.id ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_artisanal_strap_variant_activation(p_variant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_availability jsonb;
BEGIN
  SELECT * INTO v_variant FROM public.artisanal_strap_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;
  IF v_variant.status <> 'active' THEN RETURN; END IF;

  v_availability := public.resolve_artisanal_strap_source_availability(p_variant_id);
  IF v_variant.min_stock_replenishment_mode = 'internal'
     AND NOT coalesce((v_availability ->> 'internal_production_allowed')::boolean, false) THEN
    RAISE EXCEPTION 'Ativacao com reposicao interna exige base/cor/receita vigentes: %',
      v_availability ->> 'internal_block_reason';
  END IF;
  IF v_variant.min_stock_replenishment_mode = 'buy_ready'
     AND NOT coalesce((v_availability ->> 'buy_ready_purchase_allowed')::boolean, false) THEN
    RAISE EXCEPTION 'Ativacao com reposicao buy_ready exige cadastro comercial valido: %',
      v_availability ->> 'buy_ready_block_reason';
  END IF;
END;
$$;

-- Uma unica prova de compromisso aberto e compartilhada pelos gates de
-- ativacao, transicao administrativa e pelos writers operacionais. Estados
-- terminais continuam sendo evidencia historica e nao bloqueiam o catalogo.
CREATE OR REPLACE FUNCTION public.artisanal_strap_variant_has_open_commitments(
  p_variant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sale_order_strap_demands d
     WHERE d.strap_variant_id = p_variant_id
       AND d.is_current
       AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
  ) OR EXISTS (
    SELECT 1 FROM public.strap_stock_floor_contributions f
     WHERE f.strap_variant_id = p_variant_id
       AND f.is_current
       AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
  ) OR EXISTS (
    SELECT 1 FROM public.strap_production_batch_items bi
     WHERE bi.strap_variant_id = p_variant_id
       AND bi.status NOT IN ('completed', 'cancelled')
  ) OR EXISTS (
    SELECT 1 FROM public.purchase_demand_contributions c
     WHERE c.strap_variant_id = p_variant_id
       AND c.status NOT IN ('received', 'cancelled', 'superseded')
  );
$$;

CREATE OR REPLACE FUNCTION public.validate_artisanal_strap_variant(p_variant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_product_color_ids uuid[];
BEGIN
  SELECT * INTO v_variant FROM public.artisanal_strap_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_variant.finished_product_id;
  IF NOT FOUND OR v_product.unit <> 'm' THEN
    RAISE EXCEPTION 'Produto acabado da variante deve possuir unidade-base m';
  END IF;

  IF public.is_buy_ready_strass_identity(v_product.id, v_product.group_id)
     OR public.is_buy_ready_strass_identity(NULL, v_variant.base_group_id) THEN
    -- O unico reference_base tolerado e o vinculo legado ambiguo colocado em
    -- quarentena pelo backfill. Novos INSERTs sao fechados no trigger abaixo.
    IF v_variant.identity_basis <> 'finished_product_group' AND (
      v_variant.internal_production_enabled
      OR NOT v_variant.purchase_enabled
      OR v_variant.min_stock_replenishment_mode IS DISTINCT FROM 'buy_ready'
      OR v_variant.status NOT IN ('review_required', 'suspended', 'archived')
      OR nullif(btrim(coalesce(v_variant.review_reason, '')), '') IS NULL
    ) THEN
      RAISE EXCEPTION 'STRASS por UUID explicito exige finished_product_group e internal_production_enabled=false';
    END IF;
  END IF;

  IF v_variant.identity_basis = 'finished_product_group' THEN
    IF v_variant.internal_production_enabled
       OR NOT v_variant.purchase_enabled
       OR v_variant.min_stock_replenishment_mode IS DISTINCT FROM 'buy_ready' THEN
      RAISE EXCEPTION 'Tira de grupo acabado exige compra pronta, piso buy_ready e producao interna desabilitada';
    END IF;
    IF v_product.group_id IS DISTINCT FROM v_variant.base_group_id THEN
      RAISE EXCEPTION 'Produto da tira comprada pronta deve pertencer ao identity_group_id exato';
    END IF;
    SELECT array_agg(DISTINCT resolved.color_id ORDER BY resolved.color_id)
      INTO v_product_color_ids
      FROM (
        SELECT c.id AS color_id
          FROM public.canonical_colors c
         WHERE c.name_norm = public.normalize_strap_catalog_text(v_product.color)
        UNION ALL
        SELECT a.canonical_color_id
          FROM public.color_aliases a
          JOIN public.canonical_colors c ON c.id = a.canonical_color_id
         WHERE a.status = 'approved'
           AND a.alias_norm = public.normalize_strap_catalog_text(v_product.color)
      ) resolved;
    IF coalesce(array_length(v_product_color_ids, 1), 0) <> 1
       OR v_product_color_ids[1] IS DISTINCT FROM v_variant.color_id THEN
      RAISE EXCEPTION 'Cor canonica da variante deve corresponder ao produto acabado exato';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.artisanal_strap_recipes r
       WHERE r.measure_id = v_variant.measure_id
         AND r.base_group_id = v_variant.base_group_id
         AND r.status NOT IN ('superseded', 'suspended', 'archived')
    ) THEN
      RAISE EXCEPTION 'Tira comprada pronta nao aceita receita interna';
    END IF;
  END IF;

  IF v_variant.status = 'active' THEN
    -- O backfill conserva compromissos e abre uma review nominal. Enquanto
    -- essa review existir, ativar nao pode contornar o bloqueio apenas porque
    -- internal_production_enabled ja estava false no estado anterior.
    IF v_variant.identity_basis = 'finished_product_group'
       AND EXISTS (
         SELECT 1
           FROM public.artisanal_strap_migration_review_items ri
          WHERE ri.entity_type = 'buy_ready_strap_product'
            AND ri.legacy_id = v_variant.finished_product_id::text
            AND ri.status = 'review_required'
            AND ri.candidates ->> 'product_id' = v_variant.finished_product_id::text
            AND ri.candidates ->> 'product_group_id' = v_variant.base_group_id::text
            AND (
              nullif(ri.candidates ->> 'variant_id', '') IS NULL
              OR ri.candidates ->> 'variant_id' = v_variant.id::text
            )
       )
       AND public.artisanal_strap_variant_has_open_commitments(v_variant.id) THEN
      RAISE EXCEPTION
        'Variante STRASS nao pode ser ativada enquanto a review possui compromissos operacionais abertos';
    END IF;
    IF v_variant.min_stock_m IS NULL OR v_variant.min_stock_replenishment_mode IS NULL THEN
      RAISE EXCEPTION 'Variante ativa exige estoque minimo e origem de reposicao do piso confirmados';
    END IF;
    IF NOT v_variant.internal_production_enabled AND NOT v_variant.purchase_enabled THEN
      RAISE EXCEPTION 'Variante ativa exige ao menos uma origem de reposicao habilitada';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures m
        JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
       WHERE m.id = v_variant.measure_id AND m.active AND t.active
    ) THEN
      RAISE EXCEPTION 'Variante ativa exige familia e medida ativas';
    END IF;
    IF v_variant.purchase_enabled AND (
      v_product.purchase_price IS NULL OR v_product.purchase_price <= 0
      OR nullif(btrim(coalesce(v_product.purchase_unit, '')), '') IS NULL
      OR v_product.conversion_rate IS NULL OR v_product.conversion_rate <= 0
      OR (v_product.purchase_unit = v_product.unit AND v_product.conversion_rate <> 1)
      OR v_product.min_order_quantity IS NULL OR v_product.min_order_quantity <= 0
      OR v_product.purchase_multiple IS NULL OR v_product.purchase_multiple <= 0
      OR v_product.material_preparation_days < 0
    ) THEN
      RAISE EXCEPTION 'Compra pronta habilitada exige preco, unidade/conversao, MOQ, multiplo e preparo validos';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_artisanal_strap_finished_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
  IF TG_OP = 'UPDATE' AND OLD.finished_product_id <> NEW.finished_product_id THEN
    UPDATE public.products SET active = false, min_stock = 0
     WHERE id = OLD.finished_product_id;
  END IF;
  UPDATE public.products
     SET active = (NEW.status = 'active'),
         min_stock = 0,
         is_artisanal = NEW.internal_production_enabled,
         unit = 'm'
   WHERE id = NEW.finished_product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_artisanal_strap_finished_product
  ON public.artisanal_strap_variants;
CREATE TRIGGER trg_sync_artisanal_strap_finished_product
  AFTER INSERT OR UPDATE OF
    finished_product_id, status, internal_production_enabled
  ON public.artisanal_strap_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_artisanal_strap_finished_product();

CREATE OR REPLACE FUNCTION public.tg_enforce_buy_ready_strass_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_buy_ready_strass_identity(NEW.id, NEW.group_id)
     AND coalesce(NEW.is_artisanal, false) THEN
    RAISE EXCEPTION 'Produto STRASS por UUID explicito deve permanecer is_artisanal=false';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_variants v
      JOIN public.canonical_colors c ON c.id = v.color_id
     WHERE v.finished_product_id = NEW.id
       AND v.identity_basis = 'finished_product_group'
       AND (
         NEW.group_id IS DISTINCT FROM v.base_group_id
         OR coalesce(NEW.is_artisanal, false)
         OR public.normalize_strap_catalog_text(NEW.color) IS DISTINCT FROM c.name_norm
       )
  ) THEN
    RAISE EXCEPTION
      'Produto vinculado a tira comprada pronta deve conservar grupo, cor canonica e is_artisanal=false';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_buy_ready_strass_product ON public.products;
CREATE TRIGGER trg_enforce_buy_ready_strass_product
  BEFORE INSERT OR UPDATE OF group_id, color, is_artisanal
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_buy_ready_strass_product();

-- Inclui as duas novas dimensoes comerciais no mesmo audit trail seletivo ja
-- usado pelo catalogo. O WHEN impede evento novo em replay sem mudanca; reason,
-- correlation e actor permitem reconstruir a operacao do bundle.
CREATE OR REPLACE FUNCTION public.tg_audit_artisanal_strap_finished_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := coalesce(
    nullif(current_setting('app.strap_change_reason', true), ''),
    'Alteracao de produto acabado vinculado a tira'
  );
  v_correlation_id text := nullif(
    current_setting('app.strap_change_correlation_id', true), '');
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id = NEW.id
  ) THEN
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, old_data, new_data, success, created_at
    ) VALUES (
      auth.uid(), 'strap_catalog_update', 'products', NEW.id::text,
      jsonb_build_object(
        'row', to_jsonb(OLD), 'reason', v_reason,
        'correlation_id', v_correlation_id, 'actor_id', auth.uid()),
      jsonb_build_object(
        'row', to_jsonb(NEW), 'reason', v_reason,
        'correlation_id', v_correlation_id, 'actor_id', auth.uid()),
      true, now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_artisanal_strap_finished_product
  ON public.products;
CREATE TRIGGER trg_audit_artisanal_strap_finished_product
  AFTER UPDATE OF
    name, sku, category, group_id, color, active, unit, is_artisanal, min_stock,
    supplier_id, supplier_color_code, purchase_unit, purchase_order_unit,
    conversion_rate, purchase_price, min_order_quantity, purchase_multiple,
    material_preparation_days
  ON public.products
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.tg_audit_artisanal_strap_finished_product();

-- products.color e a representacao textual derivada da cor canonica para
-- identidades finished_product_group. Renome inclusive apenas de caixa deve
-- propagar o novo rotulo; products normaliza cor com UPPER/TRIM, portanto o
-- invariante compara as formas normalizadas em vez do texto cru. O UPDATE usa o mesmo
-- writer/audit trail do catalogo e nao altera fornecedor nem seu codigo de cor.
CREATE OR REPLACE FUNCTION public.tg_sync_finished_product_canonical_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
  IF nullif(current_setting('app.strap_change_reason', true), '') IS NULL THEN
    PERFORM set_config(
      'app.strap_change_reason',
      'Propagacao de nome da cor canonica para tira comprada pronta',
      true
    );
  END IF;
  IF nullif(current_setting('app.strap_change_correlation_id', true), '') IS NULL THEN
    PERFORM set_config(
      'app.strap_change_correlation_id', gen_random_uuid()::text, true);
  END IF;
  UPDATE public.products p
     SET color = NEW.name
   WHERE p.color IS DISTINCT FROM NEW.name
     AND EXISTS (
       SELECT 1
         FROM public.artisanal_strap_variants v
        WHERE v.finished_product_id = p.id
          AND v.color_id = NEW.id
          AND v.identity_basis = 'finished_product_group'
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_finished_product_canonical_color
  ON public.canonical_colors;
CREATE TRIGGER trg_sync_finished_product_canonical_color
  AFTER UPDATE OF name
  ON public.canonical_colors
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_finished_product_canonical_color();

CREATE OR REPLACE FUNCTION public.tg_reject_finished_group_strap_recipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-recipe-identity:' || NEW.measure_id::text || ':' || NEW.base_group_id::text,
    0
  ));
  IF (
    public.is_buy_ready_strass_identity(NULL, NEW.base_group_id)
    OR EXISTS (
      SELECT 1
        FROM public.artisanal_strap_variants v
       WHERE v.measure_id = NEW.measure_id
         AND v.base_group_id = NEW.base_group_id
         AND v.identity_basis = 'finished_product_group'
    )
  ) AND (
    TG_OP = 'INSERT'
    OR NEW.status NOT IN ('superseded', 'suspended', 'archived')
  ) THEN
    RAISE EXCEPTION 'Tira comprada pronta nao aceita receita interna';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_finished_group_strap_recipe
  ON public.artisanal_strap_recipes;
CREATE TRIGGER trg_reject_finished_group_strap_recipe
  BEFORE INSERT OR UPDATE
  ON public.artisanal_strap_recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_reject_finished_group_strap_recipe();

CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_basis text;
  v_group_id uuid;
  v_legacy_group_id uuid;
BEGIN
  IF NEW.strap_colors IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array JSON';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_group_id := NULL;
    v_legacy_group_id := NULL;
    v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');
    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
    END IF;
    IF v_basis = 'finished_product_group' THEN
      BEGIN
        v_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta possui identity_group_id invalido';
      END;
      IF v_group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_groups g WHERE g.id = v_group_id
      ) THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta exige identity_group_id existente';
      END IF;
    END IF;
    BEGIN
      v_legacy_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_group_id := NULL;
    END;
    IF public.is_buy_ready_strass_identity(NULL, v_legacy_group_id)
       AND (
         v_basis <> 'finished_product_group'
         OR v_group_id IS DISTINCT FROM v_legacy_group_id
       ) THEN
      RAISE EXCEPTION 'Linha STRASS por UUID explicito exige finished_product_group e identity_group_id exato';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_technical_strap_identity
  ON public.technical_sheets;
CREATE TRIGGER trg_validate_technical_strap_identity
  BEFORE INSERT OR UPDATE OF strap_colors
  ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_technical_strap_identity();

-- Projecao estritamente administrativa para uma review nominal que pode ser
-- salva pelo bundle especializado. Ela nao altera a linha persistida nem a
-- disponibilidade operacional: serve apenas para o editor enviar o grupo
-- acabado alvo mantendo medida, cor, produto e UUID da variante originais.
CREATE OR REPLACE FUNCTION public.buy_ready_strap_review_projection(
  p_variant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_color public.canonical_colors%ROWTYPE;
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_product_color_ids uuid[];
BEGIN
  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants v
   WHERE v.id = p_variant_id;
  IF NOT FOUND
     OR v_variant.status <> 'review_required'
     OR v_variant.internal_production_enabled
     OR NOT v_variant.purchase_enabled
     OR v_variant.min_stock_replenishment_mode IS DISTINCT FROM 'buy_ready'
     OR v_variant.identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_product
    FROM public.products p
   WHERE p.id = v_variant.finished_product_id;
  SELECT * INTO v_color
    FROM public.canonical_colors c
   WHERE c.id = v_variant.color_id;
  IF v_product.id IS NULL
     OR v_color.id IS NULL
     OR NOT v_color.active
     OR v_product.group_id IS NULL
     OR NOT public.is_buy_ready_strass_identity(v_product.id, v_product.group_id)
     OR coalesce(v_product.is_artisanal, false) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(DISTINCT resolved.color_id ORDER BY resolved.color_id)
    INTO v_product_color_ids
    FROM (
      SELECT c.id AS color_id
        FROM public.canonical_colors c
       WHERE c.name_norm = public.normalize_strap_catalog_text(v_product.color)
      UNION ALL
      SELECT a.canonical_color_id
        FROM public.color_aliases a
       WHERE a.status = 'approved'
         AND a.alias_norm = public.normalize_strap_catalog_text(v_product.color)
    ) resolved;
  IF v_product_color_ids IS DISTINCT FROM ARRAY[v_variant.color_id] THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_review
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.entity_type = 'buy_ready_strap_product'
     AND ri.legacy_id = v_product.id::text
     AND ri.status = 'review_required'
     AND ri.candidates ->> 'product_id' = v_product.id::text
     AND ri.candidates ->> 'product_group_id' = v_product.group_id::text
     AND (
       nullif(ri.candidates ->> 'variant_id', '') IS NULL
       OR ri.candidates ->> 'variant_id' = v_variant.id::text
     )
     AND (
       nullif(ri.candidates ->> 'variant_base_group_id', '') IS NULL
       OR ri.candidates ->> 'variant_base_group_id' = v_variant.base_group_id::text
     )
   ORDER BY ri.created_at DESC, ri.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_variant.identity_basis = 'finished_product_group'
     AND v_variant.base_group_id IS DISTINCT FROM v_product.group_id THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_variant.measure_id
       AND r.base_group_id = v_product.group_id
       AND r.status NOT IN ('superseded', 'suspended', 'archived')
  ) THEN
    RETURN NULL;
  END IF;
  -- A projecao so pode anunciar uma acao que o mesmo bundle consiga concluir.
  -- O gate vale tambem para a variante que ja e finished_product_group: o
  -- editor de review ativa a linha e essa ativacao e corretamente recusada
  -- enquanto houver fatos/compromissos abertos.
  IF public.artisanal_strap_variant_has_open_commitments(v_variant.id) THEN
    RETURN NULL;
  END IF;
  IF v_variant.identity_basis = 'reference_base' AND EXISTS (
      SELECT 1 FROM public.artisanal_strap_variants other
       WHERE other.id <> v_variant.id
         AND other.measure_id = v_variant.measure_id
         AND other.base_group_id = v_product.group_id
         AND other.color_id = v_variant.color_id
    ) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'administrative_projection', true,
    'identity_resolution_pending', true,
    'identity_basis', 'finished_product_group',
    'base_group_id', v_product.group_id,
    'identity_group_id', v_product.group_id,
    'persisted_identity_basis', v_variant.identity_basis,
    'persisted_base_group_id', v_variant.base_group_id,
    'persisted_product_color', v_product.color,
    'persisted_product_active', v_product.active,
    'projected_product_color', v_color.name,
    'projected_product_active', true,
    'buy_ready_review_item_id', v_review.id,
    'buy_ready_review_target', jsonb_build_object(
      'review_id', v_review.id,
      'resolution_operation', 'save_artisanal_strap_catalog_bundle',
      'variant_id', v_variant.id,
      'measure_id', v_variant.measure_id,
      'color_id', v_variant.color_id,
      'finished_product_id', v_product.id,
      'identity_basis', 'finished_product_group',
      'identity_group_id', v_product.group_id
    )
  );
END;
$$;

-- O override final de 03050 montava products campo a campo. Reapresentamos a
-- mesma assinatura e o mesmo shape, acrescentando o codigo nao financeiro que
-- o editor precisa carregar sem apagar o valor existente ao salvar.
CREATE OR REPLACE FUNCTION public.list_artisanal_strap_catalog(
  p_include_archived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_financial boolean;
  v_result jsonb;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  v_can_financial := public.can_see_strap_financial_values();

  SELECT jsonb_build_object(
    'types', coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name_norm, t.id)
        FROM public.artisanal_strap_types t
       WHERE p_include_archived OR t.active
    ), '[]'::jsonb),
    'measures', coalesce((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.strap_type_id, m.finished_width_mm, m.id)
        FROM public.artisanal_strap_measures m
       WHERE p_include_archived OR m.active
    ), '[]'::jsonb),
    'colors', coalesce((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name_norm, c.id)
        FROM public.canonical_colors c
       WHERE p_include_archived OR c.active OR EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.color_id = c.id AND v.status = 'active'
            AND (
              coalesce((public.resolve_artisanal_strap_source_availability(v.id)
                ->> 'finished_available_m')::numeric, 0) > 0
              OR coalesce((public.resolve_artisanal_strap_source_availability(v.id)
                ->> 'buy_ready_purchase_allowed')::boolean, false)
            )
       )
    ), '[]'::jsonb),
    'aliases', coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.alias_norm, a.id)
        FROM public.color_aliases a
       WHERE p_include_archived OR a.status <> 'archived'
    ), '[]'::jsonb),
    'width_profiles', coalesce((
      SELECT jsonb_agg(to_jsonb(w) ORDER BY w.base_group_id, w.version DESC, w.id)
        FROM public.base_material_width_profiles w
       WHERE p_include_archived OR w.status <> 'archived'
    ), '[]'::jsonb),
    'official_products', coalesce((
      SELECT jsonb_agg(to_jsonb(o) ORDER BY o.base_group_id, o.color_id, o.created_at, o.id)
        FROM public.base_material_color_official_products o
       WHERE p_include_archived OR o.status <> 'archived'
    ), '[]'::jsonb),
    'variants', coalesce((
      SELECT jsonb_agg(
        to_jsonb(v)
        || coalesce(projection.data, '{}'::jsonb)
        || jsonb_build_object(
          'source_availability', public.resolve_artisanal_strap_source_availability(v.id)
        ) ORDER BY v.measure_id, v.base_group_id, v.color_id, v.id
      )
        FROM public.artisanal_strap_variants v
        LEFT JOIN LATERAL (
          SELECT public.buy_ready_strap_review_projection(v.id) AS data
        ) projection ON true
       WHERE p_include_archived OR v.status <> 'archived'
    ), '[]'::jsonb),
    'recipes', coalesce((
      SELECT jsonb_agg(
        CASE WHEN v_can_financial THEN to_jsonb(r)
             ELSE to_jsonb(r) || jsonb_build_object('transformation_cost_per_m', NULL)
        END
        ORDER BY r.measure_id, r.base_group_id, r.version DESC, r.id
      )
        FROM public.artisanal_strap_recipes r
       WHERE p_include_archived OR r.status <> 'archived'
    ), '[]'::jsonb),
    'products', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'sku', p.sku,
          'group_id', p.group_id,
          'color', CASE WHEN projection.data IS NOT NULL
            THEN projection.data ->> 'projected_product_color' ELSE p.color END,
          'quantity', p.quantity,
          'unit', p.unit,
          'unit_price', CASE WHEN v_can_financial THEN p.unit_price ELSE NULL END,
          'supplier_id', p.supplier_id,
          'supplier_color_code', p.supplier_color_code,
          'purchase_unit', p.purchase_unit,
          'conversion_rate', p.conversion_rate,
          'purchase_price', CASE WHEN v_can_financial THEN p.purchase_price ELSE NULL END,
          'min_order_quantity', p.min_order_quantity,
          'purchase_multiple', p.purchase_multiple,
          'material_preparation_days', p.material_preparation_days,
          'active', CASE WHEN projection.data IS NOT NULL THEN true ELSE p.active END
        ) || CASE WHEN projection.data IS NOT NULL THEN jsonb_build_object(
          'administrative_projection', true,
          'persisted_color', p.color,
          'persisted_active', p.active,
          'buy_ready_review_target', projection.data -> 'buy_ready_review_target'
        ) ELSE '{}'::jsonb END
        ORDER BY p.name, p.id
      )
        FROM public.products p
        LEFT JOIN LATERAL (
          SELECT candidate.data
            FROM (
              SELECT public.buy_ready_strap_review_projection(v.id) AS data
                FROM public.artisanal_strap_variants v
               WHERE v.finished_product_id = p.id
               ORDER BY v.id
            ) candidate
           WHERE candidate.data IS NOT NULL
           LIMIT 1
        ) projection ON true
       WHERE (
         p.unit = 'm'
         OR p.is_artisanal
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id = p.id
         )
         OR EXISTS (
           SELECT 1 FROM public.base_material_color_official_products o
            WHERE o.official_product_id = p.id
         )
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_migration_review_items ri
            WHERE ri.entity_type = 'buy_ready_strap_product'
              AND ri.status = 'review_required'
              AND ri.legacy_id = p.id::text
              AND ri.candidates ->> 'product_id' = p.id::text
              AND ri.candidates ->> 'product_group_id' = p.group_id::text
              AND public.is_buy_ready_strass_identity(p.id, p.group_id)
         )
       )
       AND (
         p_include_archived
         OR p.active
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id = p.id AND v.status <> 'archived'
         )
         OR EXISTS (
           SELECT 1 FROM public.base_material_color_official_products o
            WHERE o.official_product_id = p.id AND o.status <> 'archived'
         )
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_migration_review_items ri
            WHERE ri.entity_type = 'buy_ready_strap_product'
              AND ri.status = 'review_required'
              AND ri.legacy_id = p.id::text
              AND ri.candidates ->> 'product_id' = p.id::text
              AND ri.candidates ->> 'product_group_id' = p.group_id::text
              AND public.is_buy_ready_strass_identity(p.id, p.group_id)
         )
       )
    ), '[]'::jsonb),
    'groups', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'sector', g.sector,
          'is_artisanal_strap', g.is_artisanal_strap
        ) ORDER BY g.name, g.id
      )
        FROM public.product_groups g
    ), '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'manage_strap_catalog', public.has_artisanal_strap_capability('manage_strap_catalog'),
      'approve_strap_recipe', public.has_artisanal_strap_capability('approve_strap_recipe'),
      'execute_strap_batch', public.has_artisanal_strap_capability('execute_strap_batch'),
      'resolve_strap_migration', public.has_artisanal_strap_capability('resolve_strap_migration'),
      'administer_strap_operations', coalesce(auth.role() = 'service_role', false)
        OR public.user_has_any_role(ARRAY['admin']),
      'can_see_financial_values', v_can_financial
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Writer de variante: sobrecarga nova e wrapper legado compativel
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_variant(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_color_id uuid,
  p_finished_product_id uuid,
  p_min_stock_m numeric,
  p_min_stock_replenishment_mode text,
  p_purchase_enabled boolean,
  p_identity_basis text,
  p_internal_production_enabled boolean,
  p_status text,
  p_review_reason text,
  p_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_product_group_id uuid;
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de variante de tira');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF p_id IS NOT NULL THEN
    -- Serializa writers do catalogo com o worker que materializa payloads de
    -- demanda ja congelados. O lock vem antes de qualquer FOR UPDATE da linha.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant-capability:' || p_id::text, 0));
  END IF;
  IF p_status NOT IN ('active', 'review_required', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Status de variante invalido';
  END IF;
  IF p_identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
    RAISE EXCEPTION 'identity_basis invalido';
  END IF;
  IF public.is_buy_ready_strass_identity(NULL, p_base_group_id)
     AND p_identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'STRASS por UUID explicito exige identity_basis=finished_product_group';
  END IF;
  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = p_finished_product_id;
  IF (
    public.is_buy_ready_strass_identity(p_finished_product_id, p_base_group_id)
    OR public.is_buy_ready_strass_identity(NULL, v_product_group_id)
  ) AND (
    p_identity_basis <> 'finished_product_group'
    OR coalesce(p_internal_production_enabled, true)
  ) THEN
    RAISE EXCEPTION 'STRASS por UUID explicito exige finished_product_group e internal_production_enabled=false';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-variant:' || p_measure_id::text || ':' || p_base_group_id::text || ':' || p_color_id::text,
    0
  ));
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  IF p_id IS NULL THEN
    INSERT INTO public.artisanal_strap_variants (
      measure_id, base_group_id, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      identity_basis, internal_production_enabled, status, review_reason
    ) VALUES (
      p_measure_id, p_base_group_id, p_color_id, p_finished_product_id,
      p_min_stock_m, p_min_stock_replenishment_mode, coalesce(p_purchase_enabled, false),
      p_identity_basis, coalesce(p_internal_production_enabled, true), p_status,
      CASE WHEN p_status = 'active' THEN NULL ELSE coalesce(p_review_reason, v_reason) END
    ) RETURNING id INTO v_id;
  ELSE
    PERFORM 1 FROM public.artisanal_strap_variants WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;
    UPDATE public.artisanal_strap_variants
       SET measure_id = p_measure_id,
           base_group_id = p_base_group_id,
           color_id = p_color_id,
           finished_product_id = p_finished_product_id,
           min_stock_m = p_min_stock_m,
           min_stock_replenishment_mode = p_min_stock_replenishment_mode,
           purchase_enabled = coalesce(p_purchase_enabled, false),
           identity_basis = p_identity_basis,
           internal_production_enabled = coalesce(p_internal_production_enabled, true),
           status = p_status,
           review_reason = CASE WHEN p_status = 'active'
             THEN NULL ELSE coalesce(p_review_reason, v_reason) END
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  PERFORM public.validate_artisanal_strap_variant(v_id);
  IF p_status = 'active' THEN
    PERFORM public.assert_artisanal_strap_variant_activation(v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_variant(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_color_id uuid,
  p_finished_product_id uuid,
  p_min_stock_m numeric,
  p_min_stock_replenishment_mode text,
  p_purchase_enabled boolean,
  p_status text DEFAULT 'review_required',
  p_review_reason text DEFAULT NULL,
  p_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity_basis text := 'reference_base';
  v_internal_production_enabled boolean := true;
BEGIN
  IF p_id IS NOT NULL THEN
    SELECT identity_basis, internal_production_enabled
      INTO v_identity_basis, v_internal_production_enabled
      FROM public.artisanal_strap_variants
     WHERE id = p_id;
  END IF;
  RETURN public.save_artisanal_strap_variant(
    p_measure_id, p_base_group_id, p_color_id, p_finished_product_id,
    p_min_stock_m, p_min_stock_replenishment_mode, p_purchase_enabled,
    coalesce(v_identity_basis, 'reference_base'),
    coalesce(v_internal_production_enabled, true),
    p_status, p_review_reason, p_id, p_reason
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Resolver de catalogo: 5 argumentos + wrapper legado reference_base
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_catalog(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_color_id uuid,
  p_source_mode text,
  p_identity_basis text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_official public.base_material_color_official_products%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_base public.products%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_can_financial boolean;
  v_internal_available boolean;
  v_buy_available boolean;
  v_source_availability jsonb;
  v_effective_source text := p_source_mode;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
    RAISE EXCEPTION 'identity_basis invalido';
  END IF;
  IF public.is_buy_ready_strass_identity(NULL, p_base_group_id)
     AND p_identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'STRASS por UUID explicito exige identity_basis=finished_product_group';
  END IF;
  IF p_source_mode IS NOT NULL AND p_source_mode NOT IN ('internal', 'buy_ready') THEN
    RAISE EXCEPTION 'Origem invalida; use internal ou buy_ready';
  END IF;
  IF p_identity_basis = 'finished_product_group' THEN
    IF p_source_mode = 'internal' THEN
      RAISE EXCEPTION 'Origem interna bloqueada: internal_production_disabled';
    END IF;
    v_effective_source := 'buy_ready';
  END IF;

  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants
   WHERE measure_id = p_measure_id
     AND base_group_id = p_base_group_id
     AND color_id = p_color_id
     AND identity_basis = p_identity_basis
     AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante exata ativa nao encontrada'; END IF;

  SELECT * INTO v_measure FROM public.artisanal_strap_measures WHERE id = v_variant.measure_id;
  IF NOT FOUND OR NOT v_measure.active OR NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_types t
     WHERE t.id = v_measure.strap_type_id AND t.active
  ) THEN
    RAISE EXCEPTION 'Familia/medida da variante esta inativa';
  END IF;
  IF v_variant.min_stock_m IS NULL OR v_variant.min_stock_replenishment_mode IS NULL THEN
    RAISE EXCEPTION 'Variante ativa sem estoque minimo/origem do piso confirmados';
  END IF;

  SELECT * INTO v_finished FROM public.products WHERE id = v_variant.finished_product_id;
  IF NOT FOUND OR NOT v_finished.active OR v_finished.unit <> 'm' THEN
    RAISE EXCEPTION 'Produto acabado da variante deve estar ativo e possuir unidade-base m';
  END IF;
  IF public.is_buy_ready_strass_identity(v_finished.id, v_finished.group_id)
     AND p_identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'Produto STRASS por UUID explicito nao pode resolver como reference_base';
  END IF;

  IF v_variant.identity_basis = 'reference_base' THEN
    SELECT * INTO v_official
      FROM public.base_material_color_official_products
     WHERE base_group_id = p_base_group_id
       AND color_id = p_color_id
       AND status = 'active';
    IF v_official.id IS NOT NULL THEN
      SELECT * INTO v_base FROM public.products WHERE id = v_official.official_product_id;
    END IF;
    SELECT * INTO v_recipe
      FROM public.artisanal_strap_recipes
     WHERE measure_id = p_measure_id
       AND base_group_id = p_base_group_id
       AND status = 'approved'
       AND valid_from <= now()
       AND (valid_to IS NULL OR valid_to > now());
  END IF;

  v_source_availability := public.resolve_artisanal_strap_source_availability(v_variant.id);
  v_internal_available := coalesce(
    (v_source_availability ->> 'internal_production_allowed')::boolean, false);
  v_buy_available := coalesce(
    (v_source_availability ->> 'buy_ready_purchase_allowed')::boolean, false);

  IF v_effective_source = 'internal' AND NOT v_internal_available THEN
    RAISE EXCEPTION 'Origem interna bloqueada: %',
      v_source_availability ->> 'internal_block_reason';
  ELSIF v_effective_source = 'buy_ready' AND NOT v_buy_available THEN
    RAISE EXCEPTION 'Compra pronta bloqueada: %',
      v_source_availability ->> 'buy_ready_block_reason';
  END IF;

  v_can_financial := public.can_see_strap_financial_values();
  RETURN jsonb_build_object(
    'ok', true,
    'strap_type_id', v_measure.strap_type_id,
    'measure_id', v_measure.id,
    'base_group_id', v_variant.base_group_id,
    'identity_basis', v_variant.identity_basis,
    'identity_group_id', CASE WHEN v_variant.identity_basis = 'finished_product_group'
      THEN v_variant.base_group_id ELSE NULL END,
    'internal_production_enabled', v_variant.internal_production_enabled,
    'source_mode', v_effective_source,
    'color_id', v_variant.color_id,
    'variant_id', v_variant.id,
    'finished_product_id', v_finished.id,
    'base_product_id', CASE WHEN v_effective_source = 'buy_ready' THEN NULL ELSE v_base.id END,
    'recipe_id', CASE WHEN v_effective_source = 'buy_ready' THEN NULL ELSE v_recipe.id END,
    'recipe_version', CASE WHEN v_effective_source = 'buy_ready' THEN NULL ELSE v_recipe.version END,
    'confirmed_yield_m_per_m', CASE WHEN v_effective_source = 'buy_ready'
      THEN NULL ELSE v_recipe.confirmed_yield_m_per_m END,
    'finished_available_m', greatest(
      coalesce(v_finished.quantity, 0) - coalesce(v_finished.reserved_stock, 0), 0),
    'base_available_m', CASE WHEN v_effective_source = 'buy_ready' THEN NULL
      ELSE greatest(coalesce(v_base.quantity, 0) - coalesce(v_base.reserved_stock, 0), 0) END,
    'internal_available', v_internal_available,
    'buy_ready_available', v_buy_available,
    'finished_stock_consumption_allowed',
      (v_source_availability ->> 'finished_stock_consumption_allowed')::boolean,
    'source_availability', v_source_availability,
    'min_stock_m', v_variant.min_stock_m,
    'min_stock_replenishment_mode', v_variant.min_stock_replenishment_mode,
    'supplier_id', v_finished.supplier_id,
    'purchase_price', CASE WHEN v_can_financial THEN v_finished.purchase_price ELSE NULL END,
    'transformation_cost_per_m', CASE
      WHEN v_can_financial AND v_effective_source IS DISTINCT FROM 'buy_ready'
      THEN v_recipe.transformation_cost_per_m ELSE NULL END,
    'base_unit_cost', CASE
      WHEN v_can_financial AND v_effective_source IS DISTINCT FROM 'buy_ready'
      THEN v_base.unit_price ELSE NULL END,
    'internal_unit_cost', CASE
      WHEN v_can_financial
       AND v_effective_source IS DISTINCT FROM 'buy_ready'
       AND v_internal_available
      THEN (v_base.unit_price / v_recipe.confirmed_yield_m_per_m)
        + v_recipe.transformation_cost_per_m
      ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_catalog(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_color_id uuid,
  p_source_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.resolve_artisanal_strap_catalog(
    p_measure_id, p_base_group_id, p_color_id, p_source_mode, 'reference_base'
  );
$$;

-- -----------------------------------------------------------------------------
-- 5. Bundle: caminho legado intacto e writer especializado para compra pronta
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.save_artisanal_strap_catalog_bundle(jsonb, text)
  RENAME TO save_artisanal_strap_catalog_bundle_reference_base_legacy;

REVOKE ALL ON FUNCTION
  public.save_artisanal_strap_catalog_bundle_reference_base_legacy(jsonb, text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_catalog_bundle(
  p_payload jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_payload jsonb := coalesce(p_payload -> 'type', '{}'::jsonb);
  v_measure_payload jsonb := coalesce(p_payload -> 'measure', '{}'::jsonb);
  v_variant_payload jsonb := coalesce(p_payload -> 'variant', '{}'::jsonb);
  v_product_payload jsonb := coalesce(p_payload -> 'product', '{}'::jsonb);
  v_recipe_payload jsonb := nullif(p_payload -> 'recipe', 'null'::jsonb);
  v_identity_basis text := coalesce(
    nullif(p_payload -> 'variant' ->> 'identity_basis', ''), 'reference_base');
  v_type public.artisanal_strap_types%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_legacy_result jsonb;
  v_old_product jsonb;
  v_type_id uuid;
  v_measure_id uuid;
  v_variant_id uuid;
  v_product_id uuid;
  v_identity_group_id uuid;
  v_color_id uuid;
  v_requested_variant_id uuid;
  v_requested_product_id uuid;
  v_requested_base_group_id uuid;
  v_requested_identity_group_id uuid;
  v_requested_product_group_id uuid;
  v_is_nominal_strass boolean := false;
  v_requires_identity_transition boolean := false;
  v_canonical_color_name text;
  v_desired_status text;
  v_variant_before_transition jsonb;
  v_variant_after_transition jsonb;
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_review_after public.artisanal_strap_migration_review_items%ROWTYPE;
  v_stale_job public.strap_demand_jobs%ROWTYPE;
  v_stale_job_after public.strap_demand_jobs%ROWTYPE;
  v_stale_source_id uuid;
  v_stale_source_ids uuid[] := ARRAY[]::uuid[];
  v_replacement_job_id uuid;
  v_sale_order_status text;
  v_requeue_event text;
  v_correlation_id uuid := gen_random_uuid();
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(v_type_payload) <> 'object'
     OR jsonb_typeof(v_measure_payload) <> 'object'
     OR jsonb_typeof(v_variant_payload) <> 'object'
     OR jsonb_typeof(v_product_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload do bundle invalido';
  END IF;
  BEGIN
    v_requested_variant_id := nullif(v_variant_payload ->> 'id', '')::uuid;
    v_requested_product_id := coalesce(
      nullif(v_variant_payload ->> 'finished_product_id', '')::uuid,
      nullif(v_product_payload ->> 'id', '')::uuid
    );
    v_requested_base_group_id := nullif(v_variant_payload ->> 'base_group_id', '')::uuid;
    v_requested_identity_group_id := nullif(
      v_variant_payload ->> 'identity_group_id', '')::uuid;
    v_requested_product_group_id := nullif(v_product_payload ->> 'group_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'UUID invalido no payload do bundle de tira';
  END;
  IF v_requested_variant_id IS NOT NULL THEN
    -- Deve preceder os locks de variante/produto: o worker usa a mesma chave
    -- antes de persistir uma origem congelada e assim nao ha inversao de locks.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant-capability:' || v_requested_variant_id::text, 0));
  END IF;
  v_is_nominal_strass :=
    public.is_buy_ready_strass_identity(
      v_requested_product_id, v_requested_base_group_id)
    OR public.is_buy_ready_strass_identity(NULL, v_requested_identity_group_id)
    OR public.is_buy_ready_strass_identity(NULL, v_requested_product_group_id)
    OR EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = v_requested_product_id
         AND public.is_buy_ready_strass_identity(p.id, p.group_id)
    )
    OR EXISTS (
      SELECT 1
        FROM public.artisanal_strap_variants av
        JOIN public.products p ON p.id = av.finished_product_id
       WHERE av.id = v_requested_variant_id
         AND (
           public.is_buy_ready_strass_identity(p.id, p.group_id)
           OR public.is_buy_ready_strass_identity(NULL, av.base_group_id)
         )
    );
  IF v_is_nominal_strass AND v_identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'STRASS por UUID explicito exige identity_basis=finished_product_group e nao aceita writer legado/receita';
  END IF;
  IF v_identity_basis = 'reference_base' THEN
    PERFORM set_config('app.strap_change_reason', v_reason, true);
    PERFORM set_config(
      'app.strap_change_correlation_id', v_correlation_id::text, true);
    PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
    v_legacy_result := public.save_artisanal_strap_catalog_bundle_reference_base_legacy(
      p_payload, p_reason
    );
    -- O writer legado continua responsavel pelo restante do bundle. Esta
    -- adaptacao incremental persiste apenas o campo introduzido em 043.
    IF v_product_payload ? 'supplier_color_code' THEN
      v_product_id := nullif(v_legacy_result ->> 'finished_product_id', '')::uuid;
      UPDATE public.products
         SET supplier_color_code = nullif(
           btrim(coalesce(v_product_payload ->> 'supplier_color_code', '')), '')
       WHERE id = v_product_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto acabado retornado pelo bundle legado nao existe';
      END IF;
    END IF;
    RETURN v_legacy_result;
  END IF;
  IF v_identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'identity_basis invalido';
  END IF;
  IF v_product_payload ? 'purchase_order_unit' THEN
    RAISE EXCEPTION 'Campo legado purchase_order_unit nao e aceito; use purchase_unit';
  END IF;
  IF v_recipe_payload IS NOT NULL THEN
    RAISE EXCEPTION 'Tira comprada pronta nao aceita receita interna';
  END IF;
  IF coalesce((v_variant_payload ->> 'internal_production_enabled')::boolean, false) THEN
    RAISE EXCEPTION 'finished_product_group exige internal_production_enabled=false';
  END IF;
  IF NOT coalesce((v_variant_payload ->> 'purchase_enabled')::boolean, true) THEN
    RAISE EXCEPTION 'finished_product_group exige purchase_enabled=true';
  END IF;
  IF coalesce(nullif(v_variant_payload ->> 'min_stock_replenishment_mode', ''), 'buy_ready')
     <> 'buy_ready' THEN
    RAISE EXCEPTION 'finished_product_group exige reposicao do piso buy_ready';
  END IF;

  BEGIN
    v_identity_group_id := nullif(v_variant_payload ->> 'identity_group_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'identity_group_id invalido';
  END;
  IF v_identity_group_id IS NULL THEN
    RAISE EXCEPTION 'finished_product_group exige identity_group_id';
  END IF;
  IF nullif(v_variant_payload ->> 'base_group_id', '') IS NOT NULL
     AND (v_variant_payload ->> 'base_group_id')::uuid <> v_identity_group_id THEN
    RAISE EXCEPTION 'base_group_id e identity_group_id divergem';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_groups g WHERE g.id = v_identity_group_id) THEN
    RAISE EXCEPTION 'identity_group_id inexistente';
  END IF;
  BEGIN
    v_color_id := nullif(v_variant_payload ->> 'color_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'color_id invalido';
  END;
  IF v_color_id IS NULL THEN
    RAISE EXCEPTION 'Variante exige color_id';
  END IF;
  SELECT c.name INTO v_canonical_color_name
    FROM public.canonical_colors c
   WHERE c.id = v_color_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'color_id canonico inexistente';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config(
    'app.strap_change_correlation_id', v_correlation_id::text, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  -- Familia: mesma semantica do bundle legado.
  IF nullif(v_type_payload ->> 'id', '') IS NOT NULL THEN
    v_type_id := (v_type_payload ->> 'id')::uuid;
    SELECT * INTO v_type FROM public.artisanal_strap_types
     WHERE id = v_type_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Familia informada nao existe'; END IF;
    IF v_type_payload ? 'name' OR v_type_payload ? 'active' THEN
      v_type_id := public.save_artisanal_strap_type(
        coalesce(nullif(v_type_payload ->> 'name', ''), v_type.name),
        v_type.id,
        CASE WHEN v_type_payload ? 'active'
          THEN (v_type_payload ->> 'active')::boolean ELSE v_type.active END,
        v_reason
      );
    END IF;
  ELSE
    v_type_id := public.save_artisanal_strap_type(
      v_type_payload ->> 'name', NULL,
      coalesce((v_type_payload ->> 'active')::boolean, true), v_reason
    );
  END IF;

  -- Medida: continua pertencendo a familia canonica; identidade independente
  -- da napa nao significa medida/familia inferida pelo nome do produto.
  IF nullif(v_measure_payload ->> 'id', '') IS NOT NULL THEN
    v_measure_id := (v_measure_payload ->> 'id')::uuid;
    SELECT * INTO v_measure FROM public.artisanal_strap_measures
     WHERE id = v_measure_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida informada nao existe'; END IF;
    IF v_measure.strap_type_id <> v_type_id THEN
      RAISE EXCEPTION 'Medida nao pertence a familia informada';
    END IF;
    IF v_measure_payload ? 'display_name'
       OR v_measure_payload ? 'finished_width_mm'
       OR v_measure_payload ? 'active' THEN
      v_measure_id := public.save_artisanal_strap_measure(
        v_type_id,
        coalesce(nullif(v_measure_payload ->> 'display_name', ''), v_measure.display_name),
        CASE WHEN v_measure_payload ? 'finished_width_mm'
          THEN (v_measure_payload ->> 'finished_width_mm')::numeric
          ELSE v_measure.finished_width_mm END,
        v_measure.id,
        CASE WHEN v_measure_payload ? 'active'
          THEN (v_measure_payload ->> 'active')::boolean ELSE v_measure.active END,
        v_reason
      );
    END IF;
  ELSE
    v_measure_id := public.save_artisanal_strap_measure(
      v_type_id,
      v_measure_payload ->> 'display_name',
      (v_measure_payload ->> 'finished_width_mm')::numeric,
      NULL,
      coalesce((v_measure_payload ->> 'active')::boolean, true),
      v_reason
    );
  END IF;

  IF nullif(v_variant_payload ->> 'id', '') IS NOT NULL THEN
    SELECT * INTO v_variant
      FROM public.artisanal_strap_variants
     WHERE id = (v_variant_payload ->> 'id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variante informada nao existe'; END IF;
    IF v_variant.identity_basis = 'finished_product_group'
       AND v_variant.base_group_id = v_identity_group_id THEN
      NULL;
    ELSIF v_is_nominal_strass
       AND v_variant.identity_basis = 'reference_base'
       AND v_variant.status = 'review_required'
       AND NOT v_variant.internal_production_enabled THEN
      -- Unica excecao administrativa: resolve a quarentena criada por este
      -- backfill. A verificacao completa (review, UUIDs, uniques e fatos
      -- abertos) ocorre depois de travar o produto exato.
      v_requires_identity_transition := true;
    ELSE
      RAISE EXCEPTION 'Identidade da variante e imutavel; crie uma nova variante';
    END IF;
  END IF;

  v_product_id := coalesce(
    nullif(v_variant_payload ->> 'finished_product_id', '')::uuid,
    nullif(v_product_payload ->> 'id', '')::uuid,
    v_variant.finished_product_id
  );
  IF v_product_id IS NULL THEN
    IF nullif(btrim(v_product_payload ->> 'name'), '') IS NULL
       OR nullif(btrim(v_product_payload ->> 'sku'), '') IS NULL THEN
      RAISE EXCEPTION 'Produto novo exige name e sku';
    END IF;
    IF (v_product_payload ? 'purchase_price' OR v_product_payload ? 'unit_price')
       AND auth.role() <> 'service_role'
       AND NOT public.can_see_strap_financial_values() THEN
      RAISE EXCEPTION 'Permission denied: preco/custo exige gate financeiro';
    END IF;
    INSERT INTO public.products (
      name, sku, category, group_id, color, quantity, min_stock, unit, unit_price,
      location, active, is_artisanal, supplier_id, supplier_color_code, purchase_unit,
      conversion_rate, purchase_price, min_order_quantity, purchase_multiple,
      material_preparation_days
    ) VALUES (
      v_product_payload ->> 'name',
      v_product_payload ->> 'sku',
      coalesce(nullif(v_product_payload ->> 'category', ''), 'Tiras'),
      v_identity_group_id,
      v_canonical_color_name,
      0, 0, 'm', coalesce((v_product_payload ->> 'unit_price')::numeric, 0),
      '', false, false,
      nullif(v_product_payload ->> 'supplier_id', '')::uuid,
      nullif(btrim(coalesce(v_product_payload ->> 'supplier_color_code', '')), ''),
      v_product_payload ->> 'purchase_unit',
      (v_product_payload ->> 'conversion_rate')::numeric,
      (v_product_payload ->> 'purchase_price')::numeric,
      (v_product_payload ->> 'min_order_quantity')::numeric,
      (v_product_payload ->> 'purchase_multiple')::numeric,
      coalesce((v_product_payload ->> 'material_preparation_days')::integer, 2)
    ) RETURNING * INTO v_product;
    v_product_id := v_product.id;
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, new_data, success, created_at
    ) VALUES (
      auth.uid(), 'strap_catalog_insert', 'products', v_product_id::text,
      jsonb_build_object(
        'row', to_jsonb(v_product), 'reason', v_reason,
        'correlation_id', v_correlation_id, 'actor_id', auth.uid()),
      true, now()
    );
  ELSE
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto acabado informado nao existe'; END IF;
    IF v_product.group_id IS DISTINCT FROM v_identity_group_id THEN
      RAISE EXCEPTION 'Produto da tira comprada pronta deve pertencer ao identity_group_id exato';
    END IF;
    IF (v_product_payload ? 'purchase_price' OR v_product_payload ? 'unit_price')
       AND auth.role() <> 'service_role'
       AND NOT public.can_see_strap_financial_values() THEN
      RAISE EXCEPTION 'Permission denied: preco/custo exige gate financeiro';
    END IF;
    v_old_product := to_jsonb(v_product);
    IF v_product_payload ? 'supplier_color_code' THEN
      UPDATE public.products
         SET name = CASE WHEN v_product_payload ? 'name'
                THEN v_product_payload ->> 'name' ELSE name END,
             sku = CASE WHEN v_product_payload ? 'sku'
                THEN v_product_payload ->> 'sku' ELSE sku END,
             category = CASE WHEN v_product_payload ? 'category'
                THEN v_product_payload ->> 'category' ELSE category END,
             color = v_canonical_color_name,
             supplier_id = CASE WHEN v_product_payload ? 'supplier_id'
                THEN nullif(v_product_payload ->> 'supplier_id', '')::uuid ELSE supplier_id END,
             supplier_color_code = nullif(
               btrim(coalesce(v_product_payload ->> 'supplier_color_code', '')), ''),
             purchase_unit = CASE WHEN v_product_payload ? 'purchase_unit'
                THEN v_product_payload ->> 'purchase_unit' ELSE purchase_unit END,
             conversion_rate = CASE WHEN v_product_payload ? 'conversion_rate'
                THEN (v_product_payload ->> 'conversion_rate')::numeric ELSE conversion_rate END,
             purchase_price = CASE WHEN v_product_payload ? 'purchase_price'
                THEN (v_product_payload ->> 'purchase_price')::numeric ELSE purchase_price END,
             min_order_quantity = CASE WHEN v_product_payload ? 'min_order_quantity'
                THEN (v_product_payload ->> 'min_order_quantity')::numeric ELSE min_order_quantity END,
             purchase_multiple = CASE WHEN v_product_payload ? 'purchase_multiple'
                THEN (v_product_payload ->> 'purchase_multiple')::numeric ELSE purchase_multiple END,
             material_preparation_days = CASE
                WHEN v_product_payload ? 'material_preparation_days'
                THEN (v_product_payload ->> 'material_preparation_days')::integer
                ELSE material_preparation_days END,
             is_artisanal = false,
             unit = 'm'
       WHERE id = v_product_id
      RETURNING * INTO v_product;
    ELSE
      -- Sem a chave, supplier_color_code nao aparece no target-list. O trigger
      -- de 043 preserva no mesmo fornecedor e limpa ao trocar fornecedor.
      UPDATE public.products
         SET name = CASE WHEN v_product_payload ? 'name'
                THEN v_product_payload ->> 'name' ELSE name END,
             sku = CASE WHEN v_product_payload ? 'sku'
                THEN v_product_payload ->> 'sku' ELSE sku END,
             category = CASE WHEN v_product_payload ? 'category'
                THEN v_product_payload ->> 'category' ELSE category END,
             color = v_canonical_color_name,
             supplier_id = CASE WHEN v_product_payload ? 'supplier_id'
                THEN nullif(v_product_payload ->> 'supplier_id', '')::uuid ELSE supplier_id END,
             purchase_unit = CASE WHEN v_product_payload ? 'purchase_unit'
                THEN v_product_payload ->> 'purchase_unit' ELSE purchase_unit END,
             conversion_rate = CASE WHEN v_product_payload ? 'conversion_rate'
                THEN (v_product_payload ->> 'conversion_rate')::numeric ELSE conversion_rate END,
             purchase_price = CASE WHEN v_product_payload ? 'purchase_price'
                THEN (v_product_payload ->> 'purchase_price')::numeric ELSE purchase_price END,
             min_order_quantity = CASE WHEN v_product_payload ? 'min_order_quantity'
                THEN (v_product_payload ->> 'min_order_quantity')::numeric ELSE min_order_quantity END,
             purchase_multiple = CASE WHEN v_product_payload ? 'purchase_multiple'
                THEN (v_product_payload ->> 'purchase_multiple')::numeric ELSE purchase_multiple END,
             material_preparation_days = CASE
                WHEN v_product_payload ? 'material_preparation_days'
                THEN (v_product_payload ->> 'material_preparation_days')::integer
                ELSE material_preparation_days END,
             is_artisanal = false,
             unit = 'm'
       WHERE id = v_product_id
      RETURNING * INTO v_product;
    END IF;
    IF to_jsonb(v_product) <> v_old_product
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants av
          WHERE av.finished_product_id = v_product_id
       ) THEN
      INSERT INTO public.audit_logs (
        user_id, action, resource, resource_id, old_data, new_data, success, created_at
      ) VALUES (
        auth.uid(), 'strap_catalog_update', 'products', v_product_id::text,
        jsonb_build_object(
          'row', v_old_product, 'reason', v_reason,
          'correlation_id', v_correlation_id, 'actor_id', auth.uid()),
        jsonb_build_object(
          'row', to_jsonb(v_product), 'reason', v_reason,
          'correlation_id', v_correlation_id, 'actor_id', auth.uid()),
        true, now()
      );
    END IF;
  END IF;

  v_desired_status := CASE
    WHEN v_variant_payload ? 'status' THEN v_variant_payload ->> 'status'
    WHEN v_variant.id IS NOT NULL THEN v_variant.status
    ELSE 'review_required'
  END;

  -- Um payload internal pode ter sido congelado antes desta review. Ao ativar
  -- a identidade comprada pronta, jobs ainda nao executados sao cancelados
  -- nominalmente e suas origens serao reenfileiradas depois do save, quando o
  -- preview ja resolver buy_ready. Job processing fica fail-closed: NOWAIT
  -- evita inversao com o worker, que detem a linha do job durante o processo.
  IF v_variant.id IS NOT NULL AND v_desired_status = 'active' THEN
    BEGIN
      FOR v_stale_job IN
        SELECT j.*
          FROM public.strap_demand_jobs j
         WHERE j.source_type = 'sale_order'
           AND j.event_type <> 'cancelled'
           AND j.status IN ('queued', 'retry', 'processing', 'dead_letter')
           AND jsonb_typeof(j.payload -> 'lines') = 'array'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
              WHERE line.value ->> 'strap_variant_id' = v_variant.id::text
                AND line.value ->> 'source_mode' = 'internal'
           )
         ORDER BY j.id
         FOR UPDATE NOWAIT
      LOOP
        IF v_stale_job.status = 'processing' THEN
          RAISE EXCEPTION
            'Transicao STRASS aguarda job interno em processamento: %', v_stale_job.id
            USING ERRCODE = '55006';
        END IF;
        UPDATE public.strap_demand_jobs j
               SET status = 'cancelled',
                   locked_at = NULL,
                   locked_by = NULL,
                   completed_at = now(),
                   result = coalesce(j.result, '{}'::jsonb) || jsonb_build_object(
                     'cancelled_reason', 'buy_ready_identity_transition',
                     'stale_variant_id', v_variant.id,
                     'cancelled_from_status', v_stale_job.status,
                     'cancelled_last_error', v_stale_job.last_error,
                     'cancelled_by_bundle', true,
                 'replacement_enqueued', false,
                 'replacement_variant_ids', '[]'::jsonb
               ),
               updated_at = now()
         WHERE j.id = v_stale_job.id
             AND j.status IN ('queued', 'retry', 'dead_letter')
        RETURNING * INTO v_stale_job_after;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Job interno mudou antes do cancelamento'
            USING ERRCODE = '40001';
        END IF;
        v_stale_source_ids := array_append(v_stale_source_ids, v_stale_job.source_id);
        PERFORM public.log_artisanal_strap_migration_event(
          'strap_demand_job', v_stale_job.id, 'cancel',
          to_jsonb(v_stale_job), to_jsonb(v_stale_job_after),
          v_reason, v_correlation_id
        );
      END LOOP;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION
        'Transicao STRASS aguarda job interno em processamento; tente novamente'
        USING ERRCODE = '55006';
    END;

    SELECT coalesce(
      array_agg(DISTINCT j.source_id ORDER BY j.source_id), ARRAY[]::uuid[])
      INTO v_stale_source_ids
      FROM public.strap_demand_jobs j
     WHERE j.source_type = 'sale_order'
       AND j.status = 'cancelled'
       AND j.result ->> 'cancelled_reason' = 'buy_ready_identity_transition'
       AND NOT (
         coalesce(j.result -> 'replacement_variant_ids', '[]'::jsonb)
         @> jsonb_build_array(v_variant.id::text)
       )
       AND jsonb_typeof(j.payload -> 'lines') = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
          WHERE line.value ->> 'strap_variant_id' = v_variant.id::text
            AND line.value ->> 'source_mode' = 'internal'
       );
  END IF;

  IF v_requires_identity_transition THEN
    IF v_product_id IS DISTINCT FROM v_variant.finished_product_id
       OR v_measure_id IS DISTINCT FROM v_variant.measure_id
       OR v_color_id IS DISTINCT FROM v_variant.color_id
       OR v_product.group_id IS DISTINCT FROM v_identity_group_id
       OR NOT public.is_buy_ready_strass_identity(v_product.id, v_product.group_id) THEN
      RAISE EXCEPTION
        'Transicao da review STRASS exige o mesmo produto, medida e cor e o grupo UUID explicito do produto';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.artisanal_strap_variants other
       WHERE other.id <> v_variant.id
         AND other.measure_id = v_measure_id
         AND other.base_group_id = v_identity_group_id
         AND other.color_id = v_color_id
    ) THEN
      RAISE EXCEPTION
        'Transicao da review STRASS conflita com variante canonica ja existente';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.artisanal_strap_recipes r
       WHERE r.measure_id = v_measure_id
         AND r.base_group_id = v_identity_group_id
         AND r.status NOT IN ('superseded', 'suspended', 'archived')
    ) THEN
      RAISE EXCEPTION
        'Transicao da review STRASS bloqueada por receita operacional';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.sale_order_strap_demands d
       WHERE d.strap_variant_id = v_variant.id AND d.is_current
         AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
    ) OR EXISTS (
      SELECT 1 FROM public.strap_stock_floor_contributions f
       WHERE f.strap_variant_id = v_variant.id AND f.is_current
         AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
    ) OR EXISTS (
      SELECT 1 FROM public.strap_production_batch_items bi
       WHERE bi.strap_variant_id = v_variant.id
         AND bi.status NOT IN ('completed', 'cancelled')
    ) OR EXISTS (
      SELECT 1 FROM public.purchase_demand_contributions c
       WHERE c.strap_variant_id = v_variant.id
         AND c.status NOT IN ('received', 'cancelled', 'superseded')
    ) THEN
      RAISE EXCEPTION
        'Transicao da review STRASS bloqueada por compromisso operacional aberto';
    END IF;

    SELECT * INTO v_review
      FROM public.artisanal_strap_migration_review_items ri
     WHERE ri.entity_type = 'buy_ready_strap_product'
       AND ri.legacy_id = v_product_id::text
       AND ri.status = 'review_required'
       AND ri.candidates ->> 'product_id' = v_product_id::text
       AND ri.candidates ->> 'product_group_id' = v_identity_group_id::text
       AND (
         nullif(ri.candidates ->> 'variant_id', '') IS NULL
         OR ri.candidates ->> 'variant_id' = v_variant.id::text
       )
       AND (
         nullif(ri.candidates ->> 'variant_base_group_id', '') IS NULL
         OR ri.candidates ->> 'variant_base_group_id' = v_variant.base_group_id::text
       )
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Transicao da review STRASS exige pendencia buy_ready_strap_product correspondente';
    END IF;
    PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Transicao da review STRASS exige ator autenticado';
    END IF;

    v_variant_before_transition := to_jsonb(v_variant);
    PERFORM set_config(
      'app.buy_ready_strap_identity_transition', v_variant.id::text, true);
    UPDATE public.artisanal_strap_variants
       SET base_group_id = v_identity_group_id,
           identity_basis = 'finished_product_group',
           internal_production_enabled = false,
           purchase_enabled = true,
           min_stock_replenishment_mode = 'buy_ready',
           updated_at = now()
     WHERE id = v_variant.id
    RETURNING * INTO v_variant;
    v_variant_after_transition := to_jsonb(v_variant);
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_variant', v_variant.id, 'update',
      v_variant_before_transition, v_variant_after_transition,
      v_reason, v_correlation_id
    );
  END IF;

  v_variant_id := public.save_artisanal_strap_variant(
    v_measure_id,
    v_identity_group_id,
    v_color_id,
    v_product_id,
    CASE WHEN v_variant_payload ? 'min_stock_m'
      THEN (v_variant_payload ->> 'min_stock_m')::numeric ELSE v_variant.min_stock_m END,
    'buy_ready',
    true,
    'finished_product_group',
    false,
    v_desired_status,
    CASE WHEN v_variant_payload ? 'review_reason'
      THEN v_variant_payload ->> 'review_reason' ELSE v_variant.review_reason END,
    v_variant.id,
    v_reason
  );

  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants
   WHERE id = v_variant_id
   FOR UPDATE;
  PERFORM public.validate_artisanal_strap_variant(v_variant_id);
  IF v_variant.status = 'active' THEN
    -- Nao basta o shape estrutural: a review so pode fechar depois que a
    -- disponibilidade comercial/operacional exigida para ativacao foi provada.
    PERFORM public.assert_artisanal_strap_variant_activation(v_variant_id);

    -- Reconstroi cada origem a partir do preview atual. O job substituto nao
    -- reutiliza recipe/base/yield do payload cancelado; o trigger de jobs logo
    -- abaixo tambem rejeita atomicamente qualquer linha que ainda venha
    -- congelada como internal para esta identidade.
    FOREACH v_stale_source_id IN ARRAY v_stale_source_ids
    LOOP
      SELECT so.status INTO v_sale_order_status
        FROM public.sale_orders so
       WHERE so.id = v_stale_source_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PV de job STRASS cancelado nao existe: %', v_stale_source_id;
      END IF;
      v_requeue_event := CASE
        WHEN v_sale_order_status IN ('Cancelado', 'Cancelada') THEN 'cancelled'
        ELSE 'buy_ready_identity_resolved'
      END;
      v_replacement_job_id := public.enqueue_sale_order_strap_demands(
        v_stale_source_id, v_requeue_event, v_correlation_id);

      FOR v_stale_job IN
        SELECT j.*
          FROM public.strap_demand_jobs j
         WHERE j.source_type = 'sale_order'
           AND j.source_id = v_stale_source_id
           AND j.status = 'cancelled'
           AND j.result ->> 'cancelled_reason' = 'buy_ready_identity_transition'
           AND NOT (
             coalesce(j.result -> 'replacement_variant_ids', '[]'::jsonb)
             @> jsonb_build_array(v_variant.id::text)
           )
           AND jsonb_typeof(j.payload -> 'lines') = 'array'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
              WHERE line.value ->> 'strap_variant_id' = v_variant.id::text
                AND line.value ->> 'source_mode' = 'internal'
           )
         ORDER BY j.id
         FOR UPDATE
      LOOP
        UPDATE public.strap_demand_jobs j
           SET result = coalesce(j.result, '{}'::jsonb) || jsonb_build_object(
                 'replacement_enqueued', true,
                 'replacement_job_id', v_replacement_job_id,
                 'replacement_variant_ids',
                   coalesce(j.result -> 'replacement_variant_ids', '[]'::jsonb)
                   || jsonb_build_array(v_variant.id::text),
                 'replacement_jobs',
                   coalesce(j.result -> 'replacement_jobs', '{}'::jsonb)
                   || jsonb_build_object(v_variant.id::text, v_replacement_job_id),
                 'replacement_event_type', v_requeue_event,
                 'replacement_correlation_id', v_correlation_id
               ),
               updated_at = now()
         WHERE j.id = v_stale_job.id
        RETURNING * INTO v_stale_job_after;
        PERFORM public.log_artisanal_strap_migration_event(
          'strap_demand_job', v_stale_job.id, 'reconcile',
          to_jsonb(v_stale_job), to_jsonb(v_stale_job_after),
          v_reason, v_correlation_id
        );
      END LOOP;
    END LOOP;
  END IF;

  -- A operacao concreta de catalogo fecha somente a pendencia do mesmo
  -- produto cujos UUIDs candidatos ainda correspondem ao vinculo efetivamente
  -- salvo. Repetir o bundle e idempotente porque apenas reviews abertas entram.
  FOR v_review IN
    SELECT ri.*
      FROM public.artisanal_strap_migration_review_items ri
     WHERE ri.entity_type = 'buy_ready_strap_product'
       AND ri.legacy_id = v_product_id::text
       AND ri.status = 'review_required'
       AND ri.candidates ->> 'product_id' = v_product_id::text
       AND ri.candidates ->> 'product_group_id' = v_identity_group_id::text
       AND (
         nullif(ri.candidates ->> 'variant_id', '') IS NULL
         OR ri.candidates ->> 'variant_id' = v_variant_id::text
       )
       AND v_variant.finished_product_id = v_product_id
       AND v_variant.measure_id = v_measure_id
       AND v_variant.color_id = v_color_id
       AND v_variant.base_group_id = v_identity_group_id
       AND v_variant.identity_basis = 'finished_product_group'
       AND v_variant.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_recipes r
          WHERE r.measure_id = v_variant.measure_id
            AND r.base_group_id = v_variant.base_group_id
            AND r.status NOT IN ('superseded', 'suspended', 'archived')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.sale_order_strap_demands d
          WHERE d.strap_variant_id = v_variant.id AND d.is_current
            AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.strap_stock_floor_contributions f
          WHERE f.strap_variant_id = v_variant.id AND f.is_current
            AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.strap_production_batch_items bi
          WHERE bi.strap_variant_id = v_variant.id
            AND bi.status NOT IN ('completed', 'cancelled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_demand_contributions c
          WHERE c.strap_variant_id = v_variant.id
            AND c.status NOT IN ('received', 'cancelled', 'superseded')
       )
     FOR UPDATE
  LOOP
    PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Fechamento da review STRASS exige ator autenticado';
    END IF;
    UPDATE public.artisanal_strap_migration_review_items ri
       SET status = 'resolved',
           resolution = jsonb_build_object(
             'reason', v_reason,
             'product_id', v_product_id,
             'strap_variant_id', v_variant_id,
             'measure_id', v_measure_id,
             'color_id', v_color_id,
             'identity_basis', 'finished_product_group',
             'identity_group_id', v_identity_group_id,
             'correlation_id', v_correlation_id
           ),
           resolved_by = auth.uid(),
           resolved_at = now(),
           updated_at = now()
     WHERE ri.id = v_review.id
       AND ri.status = 'review_required'
    RETURNING * INTO v_review_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pendencia STRASS mudou antes do fechamento'
        USING ERRCODE = '40001';
    END IF;
    PERFORM public.log_artisanal_strap_migration_event(
      'buy_ready_strap_product_review', v_review.id, 'reconcile',
      to_jsonb(v_review), to_jsonb(v_review_after),
      v_reason, v_correlation_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'type_id', v_type_id,
    'measure_id', v_measure_id,
    'variant_id', v_variant_id,
    'recipe_id', NULL,
    'finished_product_id', v_product_id,
    'identity_basis', 'finished_product_group',
    'identity_group_id', v_identity_group_id,
    'internal_production_enabled', false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Preview do PV: identidade da ficha e origem fixa para compra pronta
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(p_item jsonb)
RETURNS TABLE(
  line_ordinal integer,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_sheet_line jsonb;
  v_sheet_line_count integer;
  v_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_selection jsonb;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_identity_group_id uuid;
  v_identity_basis text;
  v_item_identity_basis text;
  v_item_identity_group_id uuid;
  v_color_id uuid;
  v_selected_variant_id uuid;
  v_catalog jsonb;
  v_reasons jsonb;
  v_line_id uuid;
  v_source text;
  v_gross numeric;
  v_main_start date;
  v_schedule_revision integer := 0;
  v_schedule_source text;
  v_billing_week text;
  v_year integer;
  v_month integer;
  v_week integer;
  v_first date;
  v_can_financial boolean := public.can_see_strap_financial_values();
  v_idx integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN
    RAISE EXCEPTION 'p_item deve ser objeto JSON';
  END IF;
  IF jsonb_typeof(coalesce(p_item -> 'strap_colors', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array';
  END IF;

  BEGIN v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_reference_id := NULL; END;
  BEGIN v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_material_variant_id := NULL; END;
  BEGIN v_sale_order_id := nullif(p_item ->> 'sale_order_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_id := NULL; END;
  BEGIN v_sale_order_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN v_sale_order_item_id := NULL; END;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(coalesce(p_item -> 'strap_colors', '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_reasons := '[]'::jsonb;
    v_catalog := '{}'::jsonb;
    v_sheet_line := NULL;
    v_sheet_line_count := 0;
    v_line_id := NULL;
    v_measure_id := NULL;
    v_base_group_id := NULL;
    v_identity_group_id := NULL;
    v_identity_basis := 'reference_base';
    v_item_identity_basis := NULL;
    v_item_identity_group_id := NULL;
    v_color_id := NULL;
    v_selected_variant_id := NULL;
    strap_variant_id := NULL;
    recipe_id := NULL;
    base_product_id := NULL;
    finished_product_id := NULL;

    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_line_missing', 'field', 'technical_strap_line_id',
        'message', 'Linha de tira sem UUID tecnico estavel; corrija a ficha tecnica.'));
    END IF;

    IF v_reference_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_reference_id
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'reference_unresolved', 'field', 'reference_id',
        'message', 'Referencia sem UUID persistido ou inexistente.'));
    ELSIF v_line_id IS NOT NULL THEN
      SELECT count(*), (jsonb_agg(e.value ORDER BY e.ordinality) -> 0)
        INTO v_sheet_line_count, v_sheet_line
        FROM public.technical_sheets ts
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
            THEN ts.strap_colors ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS e(value, ordinality)
       WHERE ts.id = v_reference_id
         AND e.value ->> 'technical_strap_line_id' = v_line_id::text;
      IF v_sheet_line_count <> 1 THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_line_identity_invalid', 'field', 'technical_strap_line_id',
          'message', 'UUID da linha deve existir uma unica vez na ficha tecnica vigente.'));
      END IF;
    END IF;

    v_identity_basis := coalesce(
      nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');
    IF v_identity_basis NOT IN ('reference_base', 'finished_product_group') THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'identity_basis_invalid', 'field', 'identity_basis',
        'message', 'Linha tecnica possui base de identidade invalida.'));
    END IF;
    IF v_identity_basis = 'finished_product_group' THEN
      BEGIN
        v_identity_group_id := nullif(v_sheet_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_identity_group_id := NULL; END;
      IF v_identity_group_id IS NULL THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'identity_group_missing', 'field', 'identity_group_id',
          'message', 'Tira comprada pronta exige grupo proprio do componente acabado.'));
      END IF;
    END IF;

    -- Campos presentes no item sao snapshot, nunca autoridade. Ausencia legada
    -- e aceita; divergencia explicita e bloqueada para nao trocar a identidade.
    v_item_identity_basis := nullif(v_line ->> 'identity_basis', '');
    IF v_item_identity_basis IS NOT NULL
       AND v_item_identity_basis IS DISTINCT FROM v_identity_basis THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'technical_identity_snapshot_stale', 'field', 'identity_basis',
        'message', 'Identidade congelada no item diverge da linha tecnica vigente.'));
    END IF;
    IF v_line ? 'identity_group_id' THEN
      BEGIN v_item_identity_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_item_identity_group_id := NULL; END;
      IF v_item_identity_group_id IS DISTINCT FROM v_identity_group_id THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'technical_identity_snapshot_stale', 'field', 'identity_group_id',
          'message', 'Grupo congelado no item diverge da linha tecnica vigente.'));
      END IF;
    END IF;

    BEGIN
      v_measure_id := nullif(coalesce(
        v_sheet_line ->> 'measure_id', v_line ->> 'measure_id'
      ), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_measure_id := NULL; END;
    IF v_measure_id IS NULL AND v_line_id IS NOT NULL THEN
      SELECT m.measure_id INTO v_measure_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id AND m.status = 'resolved';
    END IF;
    IF v_measure_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'measure_missing', 'field', 'measure_id',
        'message', 'Linha tecnica sem medida canonica resolvida.'));
    END IF;

    IF v_line_id IS NOT NULL THEN
      v_selection := v_sourcing -> v_line_id::text;
    ELSE
      v_selection := NULL;
    END IF;
    BEGIN v_selected_variant_id := nullif(v_selection ->> 'strap_variant_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_selected_variant_id := NULL; END;
    v_source := v_selection ->> 'source_mode';
    IF v_identity_basis = 'finished_product_group' THEN
      IF v_source = 'internal' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'internal_production_disabled', 'field', 'source_mode',
          'message', 'Esta tira e comprada pronta e nao pode ser produzida internamente.'));
      ELSIF v_source IS NOT NULL AND v_source <> 'buy_ready' THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'source_mode_invalid', 'field', 'source_mode',
          'message', 'Tira comprada pronta aceita somente Comprar pronta.'));
      END IF;
      -- A origem e propriedade do catalogo, nao uma escolha livre do item.
      v_source := 'buy_ready';
    ELSIF v_source NOT IN ('internal', 'buy_ready') THEN
      v_source := NULL;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'source_mode_required', 'field', 'source_mode',
        'message', 'Escolha Produzir com napa propria ou Comprar tira pronta.'));
    END IF;

    v_main_start := NULL;
    v_schedule_source := NULL;
    BEGIN
      v_main_start := nullif(coalesce(
        v_selection ->> 'main_production_start', p_item ->> 'main_production_start'
      ), '')::date;
    EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    BEGIN
      v_schedule_revision := coalesce(
        nullif(v_selection ->> 'schedule_revision', '')::integer,
        nullif(p_item ->> 'schedule_revision', '')::integer,
        0
      );
    EXCEPTION WHEN OTHERS THEN v_schedule_revision := 0; END;
    IF v_main_start IS NULL AND v_sale_order_id IS NOT NULL THEN
      SELECT s.main_production_start, s.schedule_revision, s.resolution_source
        INTO v_main_start, v_schedule_revision, v_schedule_source
        FROM public.resolve_sale_order_main_production_start(
          v_sale_order_id, v_sale_order_item_id
        ) s;
    END IF;
    IF v_main_start IS NULL THEN
      BEGIN
        v_main_start := nullif(coalesce(
          p_item ->> 'billing_anchor', p_item ->> 'required_at'
        ), '')::date;
        v_schedule_source := 'draft_billing_anchor';
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_billing_week := nullif(p_item ->> 'billing_week', '');
      BEGIN
        IF v_billing_week ~ '^\d{4}-W\d{1,2}$' THEN
          v_main_start := date_trunc(
            'week', public.parse_iso_billing_week(v_billing_week))::date;
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
          v_year := split_part(v_billing_week, '-', 1)::integer;
          v_month := split_part(v_billing_week, '-', 2)::integer;
          v_week := substring(split_part(v_billing_week, '-', 3) FROM 2)::integer;
          v_first := make_date(v_year, v_month, 1);
          v_main_start := greatest(
            v_first,
            v_first - (extract(isodow FROM v_first)::integer - 1) + ((v_week - 1) * 7)
          );
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-\d{2}$' THEN
          v_main_start := date_trunc('week', v_billing_week::date)::date;
        END IF;
        IF v_main_start IS NOT NULL THEN
          v_schedule_source := 'draft_billing_week_first_day';
        END IF;
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'main_production_start_missing', 'field', 'main_production_start',
        'message', 'Cronograma global ainda nao definiu o inicio produtivo deste item.'));
    END IF;

    IF v_material_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reference_material_variants rmv
       WHERE rmv.id = v_material_variant_id
         AND rmv.reference_id = v_reference_id
         AND coalesce(rmv.active, true)
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'material_variant_mismatch', 'field', 'material_variant_id',
        'message', 'Variante de material nao pertence a referencia ou esta inativa.'));
    END IF;
    IF v_identity_basis = 'finished_product_group' THEN
      v_base_group_id := v_identity_group_id;
    ELSE
      v_base_group_id := public.resolve_strap_base_group_id(
        v_reference_id, v_material_variant_id);
    END IF;
    IF v_base_group_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'base_group_unresolved', 'field', CASE
          WHEN v_identity_basis = 'finished_product_group'
            THEN 'identity_group_id' ELSE 'material_variant_id' END,
        'message', 'A identidade da tira nao possui grupo canonico resolvido por UUID.'));
    END IF;

    BEGIN v_color_id := nullif(v_line ->> 'color_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    IF v_color_id IS NULL THEN
      BEGIN v_color_id := nullif(v_selection ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    END IF;
    IF v_color_id IS NULL AND v_selected_variant_id IS NOT NULL THEN
      SELECT v.color_id INTO v_color_id
        FROM public.artisanal_strap_variants v
       WHERE v.id = v_selected_variant_id;
    END IF;
    IF v_color_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id
    ) THEN
      v_color_id := NULL;
    END IF;
    IF v_color_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'color_id_missing', 'field', 'color_id',
        'message', 'Cor sem UUID canonico persistido; texto/alias nao identifica estoque.'));
    END IF;

    v_gross := public.calculate_strap_line_required_m(
      v_line,
      coalesce(nullif(p_item ->> 'quantity', '')::numeric, 0),
      coalesce(p_item -> 'grade', '{}'::jsonb)
    );
    IF (
      jsonb_typeof(coalesce(p_item -> 'grade', '{}'::jsonb)) = 'object'
      AND EXISTS (
        SELECT 1
          FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
           AND coalesce(
             nullif(v_line -> 'consumption_per_size' ->> g.key, '')::numeric,
             nullif(v_line ->> 'consumption', '')::numeric,
             0
           ) <= 0
      )
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
      )
      AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'consumption_missing', 'field', 'consumption_per_size',
        'message', 'Consumo da tira ausente ou zero para uma numeracao demandada.'));
    END IF;
    IF v_gross <= 0 THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'gross_required_invalid', 'field', 'quantity',
        'message', 'Consumo bruto calculado deve ser maior que zero.'));
    END IF;

    IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
      BEGIN
        v_catalog := public.resolve_artisanal_strap_catalog(
          v_measure_id, v_base_group_id, v_color_id, v_source, v_identity_basis
        );
        strap_variant_id := (v_catalog ->> 'variant_id')::uuid;
        recipe_id := nullif(v_catalog ->> 'recipe_id', '')::uuid;
        base_product_id := nullif(v_catalog ->> 'base_product_id', '')::uuid;
        finished_product_id := (v_catalog ->> 'finished_product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code', 'catalog_resolution_blocked', 'field', 'strap_variant_id',
          'message', SQLERRM));
      END;
    END IF;

    IF v_identity_basis = 'reference_base'
       AND v_source IS NOT NULL AND v_selected_variant_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_identity_not_persisted', 'field', 'strap_variant_id',
        'message', 'A escolha de origem deve persistir o UUID exato da variante resolvida.'));
    ELSIF v_selected_variant_id IS NOT NULL
       AND v_selected_variant_id IS DISTINCT FROM strap_variant_id THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code', 'variant_snapshot_stale', 'field', 'strap_variant_id',
        'message', 'Variante escolhida nao corresponde mais a identidade tecnica atual.'));
    END IF;

    line_ordinal := v_idx;
    technical_strap_line_id := v_line_id;
    source_mode := v_source;
    gross_required_m := v_gross;
    blocking_reasons := v_reasons;
    resolved := jsonb_build_object(
      'base_group_id', v_base_group_id,
      'identity_basis', v_identity_basis,
      'identity_group_id', CASE WHEN v_identity_basis = 'finished_product_group'
        THEN v_identity_group_id ELSE NULL END,
      'internal_production_enabled', CASE
        WHEN v_identity_basis = 'finished_product_group' THEN false
        ELSE coalesce((v_catalog ->> 'internal_production_enabled')::boolean, true)
      END,
      'color_id', v_color_id,
      'strap_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = finished_product_id),
      'strap_color_name', (
        SELECT c.name FROM public.canonical_colors c WHERE c.id = v_color_id),
      'base_product_name', (
        SELECT p.name FROM public.products p WHERE p.id = base_product_id),
      'measure_name', (
        SELECT m.display_name FROM public.artisanal_strap_measures m WHERE m.id = v_measure_id),
      'cut_band_width_mm', (
        SELECT r.cut_band_width_mm FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'usable_base_width_mm_snapshot', (
        SELECT r.usable_base_width_mm_snapshot
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'theoretical_yield_m_per_m', (
        SELECT r.theoretical_yield_m_per_m
          FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'confirmed_yield_m_per_m', v_catalog -> 'confirmed_yield_m_per_m',
      'base_required_m', CASE WHEN v_source = 'internal'
        THEN v_gross / nullif((v_catalog ->> 'confirmed_yield_m_per_m')::numeric, 0)
        ELSE 0 END,
      'purchase_price', CASE WHEN v_can_financial
        THEN v_catalog -> 'purchase_price' ELSE 'null'::jsonb END,
      'purchase_conversion_rate', CASE WHEN v_can_financial THEN
        to_jsonb((SELECT p.conversion_rate FROM public.products p WHERE p.id = finished_product_id))
        ELSE 'null'::jsonb END,
      'purchase_unit_cost_stock', CASE WHEN v_can_financial THEN to_jsonb((
        SELECT p.purchase_price / nullif(p.conversion_rate, 0)
          FROM public.products p WHERE p.id = finished_product_id
      )) ELSE 'null'::jsonb END,
      'internal_unit_cost', CASE WHEN v_can_financial
        THEN v_catalog -> 'internal_unit_cost' ELSE 'null'::jsonb END,
      'can_internal', coalesce((v_catalog ->> 'internal_available')::boolean, false),
      'can_buy_ready', coalesce((v_catalog ->> 'buy_ready_available')::boolean, false),
      'source_mode', v_source,
      'required_at', coalesce(v_selection ->> 'required_at', p_item ->> 'required_at'),
      'main_production_start', v_main_start,
      'schedule_revision', v_schedule_revision,
      'schedule_source', coalesce(v_schedule_source, 'draft_supplied'),
      'catalog', v_catalog
    );
    RETURN NEXT;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Backfill conservador dos produtos STRASS explicitamente decididos
-- -----------------------------------------------------------------------------

-- Quando produto/grupo/variante/cor resolvem univocamente pelos UUIDs, a cor
-- textual deixa de ser alias e passa a carregar o nome canonico. Isso prepara
-- o mesmo invariante que o bundle aplica a INSERT/UPDATE sem inventar cor.
DO $$
DECLARE
  v_previous_catalog_write text := current_setting(
    'app.artisanal_strap_catalog_write', true);
BEGIN
  -- O guard publicado em 03050 bloqueia mutacao direta de produto ja ligado.
  -- O contexto fica restrito a este backfill e o valor anterior e restaurado.
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
WITH exact_strass_color AS (
  SELECT p.id AS product_id, c.name AS canonical_color_name
    FROM public.artisanal_strap_variants v
    JOIN public.products p ON p.id = v.finished_product_id
    JOIN public.canonical_colors c ON c.id = v.color_id
   WHERE p.id IN (
     '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
     'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
     '9028a544-5de5-4798-a37b-edc3b51e82f3',
     '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
     'e7056d1b-28a3-462a-b3af-f28d298194b8',
     '6e958e62-fc9d-4bdd-be01-43561adc5b36',
     'd47aaf48-644c-473d-b903-8f289270555b'
   )
     AND p.group_id = v.base_group_id
     AND p.group_id IN (
       'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
       '6e43bbda-0f1f-412c-8d4a-ec009114530d'
     )
     AND (
       SELECT array_agg(DISTINCT resolved.color_id ORDER BY resolved.color_id)
         FROM (
           SELECT canonical.id AS color_id
             FROM public.canonical_colors canonical
            WHERE canonical.name_norm = public.normalize_strap_catalog_text(p.color)
           UNION ALL
           SELECT a.canonical_color_id
             FROM public.color_aliases a
             JOIN public.canonical_colors canonical
               ON canonical.id = a.canonical_color_id
            WHERE a.status = 'approved'
              AND a.alias_norm = public.normalize_strap_catalog_text(p.color)
         ) resolved
     ) = ARRAY[v.color_id]
)
UPDATE public.products p
   SET color = exact.canonical_color_name,
       is_artisanal = false
  FROM exact_strass_color exact
 WHERE p.id = exact.product_id
   AND (
     p.color IS DISTINCT FROM exact.canonical_color_name
     OR coalesce(p.is_artisanal, false)
   );
  PERFORM set_config(
    'app.artisanal_strap_catalog_write', coalesce(v_previous_catalog_write, ''), true);
END;
$$;

-- Receita que ja estava cadastrada nesses grupos deixa de ser operacional, mas
-- permanece como evidencia historica. Estados terminais podem coexistir com a
-- identidade comprada pronta; somente receita operacional continua proibida.
UPDATE public.artisanal_strap_recipes
   SET status = 'suspended',
       valid_to = CASE WHEN status = 'approved' THEN now() ELSE valid_to END,
       review_reason = 'Grupo STRASS por UUID explicito nao admite receita interna'
 WHERE base_group_id IN (
   'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
   '6e43bbda-0f1f-412c-8d4a-ec009114530d'
 )
   AND status IN ('draft', 'pending_approval', 'approved');

-- Variantes que ja possuem a identidade estrutural inequivoca sao convertidas.
-- Compromisso operacional aberto impede mantê-las ativas: a linha vai para
-- review_required, preservando fatos e impedindo nova producao interna.
UPDATE public.artisanal_strap_variants v
   SET identity_basis = 'finished_product_group',
       internal_production_enabled = false,
       purchase_enabled = true,
       min_stock_replenishment_mode = 'buy_ready',
       status = CASE
         WHEN v.status = 'archived' THEN 'archived'
         WHEN v.status = 'active'
          AND v.min_stock_m IS NOT NULL
          AND p.unit = 'm'
          AND p.purchase_price > 0
          AND nullif(btrim(coalesce(p.purchase_unit, '')), '') IS NOT NULL
          AND p.conversion_rate > 0
          AND (p.purchase_unit <> p.unit OR p.conversion_rate = 1)
          AND p.min_order_quantity > 0
          AND p.purchase_multiple > 0
          AND p.material_preparation_days >= 0
          AND EXISTS (
            SELECT 1
              FROM public.artisanal_strap_measures m
              JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
             WHERE m.id = v.measure_id AND m.active AND t.active
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_order_strap_demands d
             WHERE d.strap_variant_id = v.id AND d.is_current
               AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_stock_floor_contributions f
             WHERE f.strap_variant_id = v.id AND f.is_current
               AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_production_batch_items bi
             WHERE bi.strap_variant_id = v.id
               AND bi.status NOT IN ('completed', 'cancelled')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.purchase_demand_contributions c
             WHERE c.strap_variant_id = v.id
               AND c.status NOT IN ('received', 'cancelled', 'superseded')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_demand_jobs j
             WHERE j.source_type = 'sale_order'
               AND j.event_type <> 'cancelled'
               AND j.status IN ('queued', 'retry', 'processing', 'dead_letter')
               AND jsonb_typeof(j.payload -> 'lines') = 'array'
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
                  WHERE line.value ->> 'strap_variant_id' = v.id::text
                    AND line.value ->> 'source_mode' = 'internal'
               )
          )
         THEN 'active'
         ELSE 'review_required'
       END,
       review_reason = CASE
         WHEN v.status = 'archived' THEN v.review_reason
         WHEN v.status = 'active'
          AND v.min_stock_m IS NOT NULL
          AND p.unit = 'm'
          AND p.purchase_price > 0
          AND nullif(btrim(coalesce(p.purchase_unit, '')), '') IS NOT NULL
          AND p.conversion_rate > 0
          AND (p.purchase_unit <> p.unit OR p.conversion_rate = 1)
          AND p.min_order_quantity > 0
          AND p.purchase_multiple > 0
          AND p.material_preparation_days >= 0
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_order_strap_demands d
             WHERE d.strap_variant_id = v.id AND d.is_current
               AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_stock_floor_contributions f
             WHERE f.strap_variant_id = v.id AND f.is_current
               AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_production_batch_items bi
             WHERE bi.strap_variant_id = v.id
               AND bi.status NOT IN ('completed', 'cancelled')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.purchase_demand_contributions c
             WHERE c.strap_variant_id = v.id
               AND c.status NOT IN ('received', 'cancelled', 'superseded')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.strap_demand_jobs j
             WHERE j.source_type = 'sale_order'
               AND j.event_type <> 'cancelled'
               AND j.status IN ('queued', 'retry', 'processing', 'dead_letter')
               AND jsonb_typeof(j.payload -> 'lines') = 'array'
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
                  WHERE line.value ->> 'strap_variant_id' = v.id::text
                    AND line.value ->> 'source_mode' = 'internal'
               )
          )
         THEN NULL
         ELSE 'STRASS comprado pronto: revisar cadastro comercial ou compromisso operacional aberto'
       END
  FROM public.products p
 WHERE p.id = v.finished_product_id
   AND p.id IN (
     '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
     'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
     '9028a544-5de5-4798-a37b-edc3b51e82f3',
     '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
     'e7056d1b-28a3-462a-b3af-f28d298194b8',
     '6e958e62-fc9d-4bdd-be01-43561adc5b36',
     'd47aaf48-644c-473d-b903-8f289270555b'
   )
   AND p.group_id = v.base_group_id
   AND p.group_id IN (
     'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
     '6e43bbda-0f1f-412c-8d4a-ec009114530d'
   )
   AND (
     SELECT array_agg(DISTINCT resolved.color_id ORDER BY resolved.color_id)
       FROM (
         SELECT c.id AS color_id
           FROM public.canonical_colors c
          WHERE c.name_norm = public.normalize_strap_catalog_text(p.color)
         UNION ALL
         SELECT a.canonical_color_id
           FROM public.color_aliases a
           JOIN public.canonical_colors c ON c.id = a.canonical_color_id
          WHERE a.status = 'approved'
            AND a.alias_norm = public.normalize_strap_catalog_text(p.color)
       ) resolved
   ) = ARRAY[v.color_id]
   AND NOT EXISTS (
     SELECT 1
       FROM public.artisanal_strap_recipes r
      WHERE r.measure_id = v.measure_id
        AND r.base_group_id = v.base_group_id
        AND r.status NOT IN ('superseded', 'suspended', 'archived')
   );

-- Vínculo canônico existente, mas incompatível com grupo/receita, não e
-- remapeado. Desabilita-se somente a capacidade artesanal e exige-se revisão.
UPDATE public.artisanal_strap_variants v
   SET internal_production_enabled = false,
       purchase_enabled = true,
       min_stock_replenishment_mode = 'buy_ready',
       status = CASE WHEN v.status = 'archived'
         THEN 'archived' ELSE 'review_required' END,
       review_reason = CASE WHEN v.status = 'archived'
         THEN v.review_reason
         ELSE 'STRASS por UUID explicito com identidade canonica ambigua; nenhum remapeamento foi inferido'
       END
 WHERE v.identity_basis <> 'finished_product_group'
   AND (
     v.finished_product_id IN (
       '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
       'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
       '9028a544-5de5-4798-a37b-edc3b51e82f3',
       '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
       'e7056d1b-28a3-462a-b3af-f28d298194b8',
       '6e958e62-fc9d-4bdd-be01-43561adc5b36',
       'd47aaf48-644c-473d-b903-8f289270555b'
     )
     OR v.base_group_id IN (
       'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
       '6e43bbda-0f1f-412c-8d4a-ec009114530d'
     )
     OR EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = v.finished_product_id
          AND p.group_id IN (
            'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
            '6e43bbda-0f1f-412c-8d4a-ec009114530d'
          )
     )
   );

-- Ate este ponto o constraint trigger publicado pela 03000 conserva seu corpo
-- validate-only: cada UPDATE acima ja e validado pela nova funcao estrutural,
-- mas a conversao bootstrap pode trocar a identidade de forma atomica. Somente
-- depois do backfill instala-se a imutabilidade usada em operacao normal.
CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_controlled_review_transition boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-recipe-identity:' || NEW.measure_id::text || ':' || NEW.base_group_id::text,
    0
  ));
  IF TG_OP = 'INSERT'
     AND (
       public.is_buy_ready_strass_identity(NEW.finished_product_id, NEW.base_group_id)
       OR EXISTS (
         SELECT 1 FROM public.products p
          WHERE p.id = NEW.finished_product_id
            AND public.is_buy_ready_strass_identity(p.id, p.group_id)
       )
     )
     AND NEW.identity_basis <> 'finished_product_group' THEN
    RAISE EXCEPTION 'Nova variante STRASS por UUID explicito exige finished_product_group';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_controlled_review_transition := coalesce(
      current_setting('app.buy_ready_strap_identity_transition', true) = NEW.id::text,
      false
    )
      AND public.has_artisanal_strap_capability('resolve_strap_migration')
      AND OLD.identity_basis = 'reference_base'
      AND NEW.identity_basis = 'finished_product_group'
      AND OLD.status = 'review_required'
      AND NEW.status = 'review_required'
      AND NOT OLD.internal_production_enabled
      AND NOT NEW.internal_production_enabled
      AND NEW.purchase_enabled
      AND NEW.min_stock_replenishment_mode = 'buy_ready'
      AND NEW.measure_id = OLD.measure_id
      AND NEW.color_id = OLD.color_id
      AND NEW.finished_product_id = OLD.finished_product_id
      AND EXISTS (
        SELECT 1
          FROM public.products p
          JOIN public.canonical_colors c ON c.id = NEW.color_id
         WHERE p.id = NEW.finished_product_id
           AND p.group_id = NEW.base_group_id
           AND public.normalize_strap_catalog_text(p.color) = c.name_norm
           AND NOT coalesce(p.is_artisanal, false)
           AND public.is_buy_ready_strass_identity(p.id, p.group_id)
      )
      AND EXISTS (
        SELECT 1
          FROM public.artisanal_strap_migration_review_items ri
         WHERE ri.entity_type = 'buy_ready_strap_product'
           AND ri.legacy_id = NEW.finished_product_id::text
           AND ri.status = 'review_required'
           AND ri.candidates ->> 'product_id' = NEW.finished_product_id::text
           AND ri.candidates ->> 'product_group_id' = NEW.base_group_id::text
           AND (
             nullif(ri.candidates ->> 'variant_id', '') IS NULL
             OR ri.candidates ->> 'variant_id' = NEW.id::text
           )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.artisanal_strap_recipes r
         WHERE r.measure_id = NEW.measure_id
           AND r.base_group_id = NEW.base_group_id
           AND r.status NOT IN ('superseded', 'suspended', 'archived')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_order_strap_demands d
         WHERE d.strap_variant_id = OLD.id AND d.is_current
           AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.strap_stock_floor_contributions f
         WHERE f.strap_variant_id = OLD.id AND f.is_current
           AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.strap_production_batch_items bi
         WHERE bi.strap_variant_id = OLD.id
           AND bi.status NOT IN ('completed', 'cancelled')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.purchase_demand_contributions c
         WHERE c.strap_variant_id = OLD.id
           AND c.status NOT IN ('received', 'cancelled', 'superseded')
      );
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.measure_id IS DISTINCT FROM OLD.measure_id
    OR NEW.base_group_id IS DISTINCT FROM OLD.base_group_id
    OR NEW.color_id IS DISTINCT FROM OLD.color_id
    OR NEW.finished_product_id IS DISTINCT FROM OLD.finished_product_id
    OR NEW.identity_basis IS DISTINCT FROM OLD.identity_basis
  ) AND NOT v_controlled_review_transition THEN
    RAISE EXCEPTION 'Identidade da variante e imutavel; crie uma nova variante e arquive a anterior';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.internal_production_enabled IS DISTINCT FROM OLD.internal_production_enabled
     -- Desabilitar e mandar para revisao e a unica transicao conservadora com
     -- compromisso aberto: fatos ficam intactos e nenhuma producao nova nasce.
     AND NOT (
       OLD.internal_production_enabled
       AND NOT NEW.internal_production_enabled
       AND NEW.status = 'review_required'
     )
     AND (
       EXISTS (
         SELECT 1 FROM public.sale_order_strap_demands d
          WHERE d.strap_variant_id = OLD.id
            AND d.is_current
            AND d.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
       )
       OR EXISTS (
         SELECT 1 FROM public.strap_stock_floor_contributions f
          WHERE f.strap_variant_id = OLD.id
            AND f.is_current
            AND f.status NOT IN ('fulfilled', 'superseded', 'cancelled', 'error')
       )
       OR EXISTS (
         SELECT 1
           FROM public.strap_production_batch_items bi
          WHERE bi.strap_variant_id = OLD.id
            AND bi.status NOT IN ('completed', 'cancelled')
       )
       OR EXISTS (
         SELECT 1
           FROM public.purchase_demand_contributions c
          WHERE c.strap_variant_id = OLD.id
            AND c.status NOT IN ('received', 'cancelled', 'superseded')
       )
     ) THEN
    RAISE EXCEPTION 'Capacidade produtiva nao pode mudar com compromissos operacionais abertos';
  END IF;

  PERFORM public.validate_artisanal_strap_variant(NEW.id);
  IF NEW.status = 'active' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.canonical_colors c WHERE c.id = NEW.color_id AND c.active
      ) THEN
        RAISE EXCEPTION 'Variante nova exige cor canonica ativa';
      END IF;
      IF NEW.identity_basis = 'reference_base' AND NOT EXISTS (
        SELECT 1 FROM public.base_material_color_official_products op
         WHERE op.base_group_id = NEW.base_group_id
           AND op.color_id = NEW.color_id
           AND op.status = 'active'
      ) THEN
        RAISE EXCEPTION 'Variante reference_base nova exige produto-base oficial ativo';
      END IF;
      PERFORM public.assert_artisanal_strap_variant_activation(NEW.id);
    ELSIF OLD.status IS DISTINCT FROM 'active'
       OR NEW.min_stock_replenishment_mode IS DISTINCT FROM OLD.min_stock_replenishment_mode
       OR NEW.purchase_enabled IS DISTINCT FROM OLD.purchase_enabled
       OR NEW.internal_production_enabled IS DISTINCT FROM OLD.internal_production_enabled THEN
      PERFORM public.assert_artisanal_strap_variant_activation(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Defesa final contra job congelado antes da troca de identidade. O worker da
-- 032 materializa source_mode do payload; qualquer INSERT/UPDATE operacional
-- passa por esta trava, serializada com save_artisanal_strap_variant/bundle.
-- Transicoes para estados terminais continuam liberadas para encerrar fatos
-- antigos sem reescrever seu source_mode historico.
CREATE OR REPLACE FUNCTION public.tg_enforce_strap_internal_source_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
BEGIN
  IF NEW.source_mode IS DISTINCT FROM 'internal'
     OR NOT NEW.is_current
     OR NEW.status IN ('fulfilled', 'superseded', 'cancelled', 'error', 'suspended') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-variant-capability:' || NEW.strap_variant_id::text, 0));
  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants v
   WHERE v.id = NEW.strap_variant_id
   FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variante da demanda de tira inexistente';
  END IF;
  IF NOT v_variant.internal_production_enabled
     OR v_variant.identity_basis <> 'reference_base' THEN
    RAISE EXCEPTION
      'Payload interno de tira ficou obsoleto: variante nao admite mais producao interna'
      USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_strap_internal_source_capability
  ON public.sale_order_strap_demands;
CREATE TRIGGER trg_enforce_strap_internal_source_capability
  BEFORE INSERT OR UPDATE
  ON public.sale_order_strap_demands
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_strap_internal_source_capability();

DROP TRIGGER IF EXISTS trg_enforce_strap_internal_source_capability
  ON public.strap_stock_floor_contributions;
CREATE TRIGGER trg_enforce_strap_internal_source_capability
  BEFORE INSERT OR UPDATE
  ON public.strap_stock_floor_contributions
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_strap_internal_source_capability();

-- Fecha tambem a janela entre preview/enqueue e claim: job novo que tente
-- congelar internal depois da desativacao nem entra na fila. UPDATE de status
-- do worker nao dispara esta trava, portanto nao transforma job legado em loop.
CREATE OR REPLACE FUNCTION public.tg_enforce_strap_job_source_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant_id uuid;
  v_variant public.artisanal_strap_variants%ROWTYPE;
BEGIN
  IF jsonb_typeof(NEW.payload -> 'lines') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  FOR v_variant_id IN
    SELECT DISTINCT (line.value ->> 'strap_variant_id')::uuid
      FROM jsonb_array_elements(NEW.payload -> 'lines') line(value)
     WHERE line.value ->> 'source_mode' = 'internal'
       AND nullif(line.value ->> 'strap_variant_id', '') IS NOT NULL
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant-capability:' || v_variant_id::text, 0));
    SELECT * INTO v_variant
      FROM public.artisanal_strap_variants v
     WHERE v.id = v_variant_id
     FOR KEY SHARE;
    IF NOT FOUND
       OR NOT v_variant.internal_production_enabled
       OR v_variant.identity_basis <> 'reference_base' THEN
      RAISE EXCEPTION
        'Payload de job interno ficou obsoleto: variante nao admite mais producao interna'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_strap_job_source_capability
  ON public.strap_demand_jobs;
CREATE TRIGGER trg_enforce_strap_job_source_capability
  BEFORE INSERT OR UPDATE OF payload
  ON public.strap_demand_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_strap_job_source_capability();

-- Um worker da versao anterior pode ja ter colocado a linha em processing e
-- ficar bloqueado pela migration. Quando retomar, o gate de demanda acima
-- rejeita o payload internal e o handler antigo tenta publicar retry/dead_letter.
-- Reescrevemos somente essa falha stale nominal para cancelled: assim nao ha
-- loop e o bundle encontra a origem para reenfileirar pelo preview atual.
CREATE OR REPLACE FUNCTION public.tg_cancel_stale_internal_strap_job_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale_variant_ids uuid[];
  v_attempted_status text := NEW.status;
  v_attempted_error text := coalesce(NEW.last_error, OLD.last_error);
BEGIN
  IF NOT (
    (OLD.status = 'processing' AND NEW.status IN ('retry', 'dead_letter'))
    OR (OLD.status = 'dead_letter' AND NEW.status = 'retry')
  ) OR jsonb_typeof(OLD.payload -> 'lines') IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(DISTINCT v.id ORDER BY v.id), ARRAY[]::uuid[])
    INTO v_stale_variant_ids
    FROM jsonb_array_elements(OLD.payload -> 'lines') line(value)
    JOIN public.artisanal_strap_variants v
      ON line.value ->> 'strap_variant_id' = v.id::text
    JOIN public.products p ON p.id = v.finished_product_id
   WHERE line.value ->> 'source_mode' = 'internal'
     AND (
       NOT v.internal_production_enabled
       OR v.identity_basis <> 'reference_base'
     )
     AND (
       public.is_buy_ready_strass_identity(p.id, p.group_id)
       OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
     );
  IF cardinality(v_stale_variant_ids) = 0 THEN
    RETURN NEW;
  END IF;

  NEW.status := 'cancelled';
  NEW.locked_at := NULL;
  NEW.locked_by := NULL;
  NEW.last_error := v_attempted_error;
  NEW.completed_at := now();
  NEW.updated_at := now();
  NEW.result := coalesce(OLD.result, NEW.result, '{}'::jsonb)
    || jsonb_build_object(
      'cancelled_reason', 'buy_ready_identity_transition',
      'cancelled_from_status', OLD.status,
      'attempted_failure_status', v_attempted_status,
      'cancelled_last_error', v_attempted_error,
      'cancelled_by_worker_guard', true,
      'stale_variant_ids', to_jsonb(v_stale_variant_ids),
      'replacement_enqueued', false,
      'replacement_variant_ids', '[]'::jsonb
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_stale_internal_strap_job_failure
  ON public.strap_demand_jobs;
CREATE TRIGGER trg_cancel_stale_internal_strap_job_failure
  BEFORE UPDATE OF status
  ON public.strap_demand_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_cancel_stale_internal_strap_job_failure();

CREATE OR REPLACE FUNCTION public.tg_audit_stale_internal_strap_job_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND NEW.result ->> 'cancelled_by_worker_guard' = 'true'
     AND (
       OLD.status = 'processing'
       OR OLD.status = 'dead_letter'
     ) THEN
    INSERT INTO public.artisanal_strap_operational_audit_log (
      entity_type, entity_id, action, before_data, after_data, reason,
      correlation_id, actor_id
    ) VALUES (
      'strap_demand_job', NEW.id, 'cancel', to_jsonb(OLD), to_jsonb(NEW),
      'Falha internal obsoleta neutralizada pela transicao nominal para compra pronta',
      NEW.correlation_id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_stale_internal_strap_job_cancellation
  ON public.strap_demand_jobs;
CREATE TRIGGER trg_audit_stale_internal_strap_job_cancellation
  AFTER UPDATE OF status
  ON public.strap_demand_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_stale_internal_strap_job_cancellation();

-- O handler legado insere o audit retry/dead_letter depois do UPDATE. A linha
-- ja foi cancelada e auditada acima; impedir esse segundo registro evita uma
-- trilha contraditoria sem apagar nenhuma evidencia historica existente.
CREATE OR REPLACE FUNCTION public.tg_suppress_stale_strap_job_retry_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type = 'strap_demand_job'
     AND NEW.action IN ('retry', 'dead_letter')
     AND EXISTS (
       SELECT 1 FROM public.strap_demand_jobs j
        WHERE j.id = NEW.entity_id
          AND j.status = 'cancelled'
          AND j.result ->> 'cancelled_by_worker_guard' = 'true'
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppress_stale_strap_job_retry_audit
  ON public.artisanal_strap_operational_audit_log;
CREATE TRIGGER trg_suppress_stale_strap_job_retry_audit
  BEFORE INSERT
  ON public.artisanal_strap_operational_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppress_stale_strap_job_retry_audit();

-- Job processing pode deter sua propria linha e aguardar os locks DDL desta
-- migration; nao o tocamos (evita inversao/deadlock), mas sua variante fica em
-- review antes do commit. O bundle so permite ativacao depois que o worker
-- terminar e os fatos eventualmente produzidos forem reconciliados.
UPDATE public.artisanal_strap_variants v
   SET status = 'review_required',
       review_reason = 'STRASS comprado pronto: aguardar job internal em processamento e reconciliar',
       updated_at = now()
 WHERE v.status = 'active'
   AND EXISTS (
     SELECT 1
       FROM public.strap_demand_jobs j
      WHERE j.source_type = 'sale_order'
        AND j.event_type <> 'cancelled'
        AND j.status = 'processing'
        AND jsonb_typeof(j.payload -> 'lines') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
           WHERE line.value ->> 'strap_variant_id' = v.id::text
             AND line.value ->> 'source_mode' = 'internal'
        )
   )
   AND EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.id = v.finished_product_id
        AND (
          public.is_buy_ready_strass_identity(p.id, p.group_id)
          OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
        )
   );

-- queued/retry/dead_letter e processing sem lock anterior ao trigger nao podem
-- ficar em loop nem perder sua origem. SKIP LOCKED neutraliza processing
-- abandonado sem esperar/inverter o lock de um worker vivo; este ultimo sera
-- convertido pelo trigger de falha quando retomar depois do commit.
WITH stale_jobs AS MATERIALIZED (
  SELECT j.id, j.status AS previous_status, j.last_error AS previous_last_error,
         to_jsonb(j) AS before_data
    FROM public.strap_demand_jobs j
   WHERE j.source_type = 'sale_order'
     AND j.event_type <> 'cancelled'
     AND j.status IN ('queued', 'retry', 'processing', 'dead_letter')
     AND jsonb_typeof(j.payload -> 'lines') = 'array'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(j.payload -> 'lines') line(value)
         JOIN public.artisanal_strap_variants v
           ON line.value ->> 'strap_variant_id' = v.id::text
         JOIN public.products p ON p.id = v.finished_product_id
        WHERE line.value ->> 'source_mode' = 'internal'
          AND NOT v.internal_production_enabled
          AND (
            public.is_buy_ready_strass_identity(p.id, p.group_id)
            OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
          )
     )
   ORDER BY j.id
   FOR UPDATE SKIP LOCKED
), cancelled_jobs AS (
  UPDATE public.strap_demand_jobs j
     SET status = 'cancelled',
         locked_at = NULL,
         locked_by = NULL,
         completed_at = now(),
         result = coalesce(j.result, '{}'::jsonb) || jsonb_build_object(
           'cancelled_reason', 'buy_ready_identity_transition',
           'cancelled_from_status', stale.previous_status,
           'cancelled_last_error', stale.previous_last_error,
           'cancelled_by_migration', true,
           'replacement_enqueued', false,
           'replacement_variant_ids', '[]'::jsonb
         ),
         updated_at = now()
    FROM stale_jobs stale
   WHERE j.id = stale.id
     AND j.status IN ('queued', 'retry', 'processing', 'dead_letter')
  RETURNING j.id, j.correlation_id, stale.before_data, to_jsonb(j) AS after_data
)
INSERT INTO public.artisanal_strap_operational_audit_log (
  entity_type, entity_id, action, before_data, after_data, reason,
  correlation_id, actor_id
)
SELECT 'strap_demand_job', cancelled.id, 'cancel',
  cancelled.before_data, cancelled.after_data,
  'Payload internal cancelado pela transicao nominal para compra pronta',
  cancelled.correlation_id, auth.uid()
FROM cancelled_jobs cancelled;

UPDATE public.artisanal_strap_variants v
   SET status = 'review_required',
       review_reason = 'STRASS comprado pronto: job internal cancelado exige reenfileiramento pelo preview atual',
       updated_at = now()
 WHERE v.status = 'active'
   AND EXISTS (
     SELECT 1
       FROM public.products p
      WHERE p.id = v.finished_product_id
        AND (
          public.is_buy_ready_strass_identity(p.id, p.group_id)
          OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
        )
   )
   AND EXISTS (
     SELECT 1
       FROM public.strap_demand_jobs j
      WHERE j.source_type = 'sale_order'
        AND j.status = 'cancelled'
        AND j.result ->> 'cancelled_reason' = 'buy_ready_identity_transition'
        AND NOT (
          coalesce(j.result -> 'replacement_variant_ids', '[]'::jsonb)
          @> jsonb_build_array(v.id::text)
        )
        AND jsonb_typeof(j.payload -> 'lines') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(j.payload -> 'lines') line(value)
           WHERE line.value ->> 'strap_variant_id' = v.id::text
             AND line.value ->> 'source_mode' = 'internal'
        )
   );

-- Releitura final depois de neutralizar queued/retry e marcar processing: se
-- algum compromisso ja estava visivel, a variante fica em review e
-- nunca permanece ativa por causa do snapshot anterior do primeiro UPDATE.
UPDATE public.artisanal_strap_variants v
   SET status = 'review_required',
       review_reason = 'STRASS comprado pronto: compromisso operacional aberto exige reconciliacao',
       updated_at = now()
 WHERE v.status = 'active'
   AND v.identity_basis = 'finished_product_group'
   AND public.artisanal_strap_variant_has_open_commitments(v.id)
   AND EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.id = v.finished_product_id
        AND public.is_buy_ready_strass_identity(p.id, p.group_id)
   );

-- O produto fisico e conhecido sem inferencia: sete UUIDs e os dois grupos sao
-- os mesmos da migration 20261204120000. Atividade/estoque/historico nao mudam.
DO $$
BEGIN
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);
  UPDATE public.products
     SET is_artisanal = false
   WHERE id IN (
     '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
     'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
     '9028a544-5de5-4798-a37b-edc3b51e82f3',
     '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
     'e7056d1b-28a3-462a-b3af-f28d298194b8',
     '6e958e62-fc9d-4bdd-be01-43561adc5b36',
     'd47aaf48-644c-473d-b903-8f289270555b'
   ) OR group_id IN (
     'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
     '6e43bbda-0f1f-412c-8d4a-ec009114530d'
   );
END;
$$;

-- Sem tipo/medida/cor/variante canônicos não se inventa vínculo. O item fica
-- acionável na fila de revisão e o preview bloqueia catalog_resolution_blocked.
INSERT INTO public.artisanal_strap_migration_review_items (
  entity_type, legacy_id, status, reason, candidates
)
SELECT
  'buy_ready_strap_product',
  p.id::text,
  'review_required',
  CASE
    WHEN v.id IS NULL
      THEN 'Produto STRASS explicito sem variante canonica; resolver tipo, medida e cor por UUID'
    WHEN v.identity_basis <> 'finished_product_group'
      THEN 'Variante STRASS possui base/grupo ou receita ambiguos; criar identidade canonica correta'
    ELSE 'Variante STRASS comprada pronta exige revisao comercial/operacional antes de ativar'
  END,
  jsonb_build_object(
    'product_id', p.id,
    'product_group_id', p.group_id,
    'product_color', p.color,
    'variant_id', v.id,
    'variant_identity_basis', v.identity_basis,
    'variant_base_group_id', v.base_group_id,
    'resolution_operation', 'save_artisanal_strap_catalog_bundle',
    'resolution_requires_capability', 'resolve_strap_migration',
    'required_identity_basis', 'finished_product_group',
    'required_identity_group_id', p.group_id,
    'required_finished_product_id', p.id,
    'safe_transition_supported', coalesce(
      v.status = 'review_required'
      AND v.identity_basis = 'reference_base'
      AND NOT v.internal_production_enabled,
      false
    )
  )
FROM public.products p
LEFT JOIN public.artisanal_strap_variants v ON v.finished_product_id = p.id
WHERE (p.id IN (
    '9962fc0e-e95c-4e0a-8162-1a21c79f64dc',
    'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5',
    '9028a544-5de5-4798-a37b-edc3b51e82f3',
    '4a60b9c5-eacd-4cd8-82de-b8176ee217b2',
    'e7056d1b-28a3-462a-b3af-f28d298194b8',
    '6e958e62-fc9d-4bdd-be01-43561adc5b36',
    'd47aaf48-644c-473d-b903-8f289270555b'
  ) OR p.group_id IN (
    'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
    '6e43bbda-0f1f-412c-8d4a-ec009114530d'
  ))
  AND (
    v.id IS NULL
    OR (
      v.status IS DISTINCT FROM 'archived'
      AND (
        v.identity_basis <> 'finished_product_group'
        OR v.status = 'review_required'
      )
    )
  )
ON CONFLICT (entity_type, legacy_id) WHERE status = 'review_required'
DO UPDATE SET
  reason = EXCLUDED.reason,
  candidates = EXCLUDED.candidates,
  updated_at = now();

-- O diagnostico legado publicava ri.id como entity_id. Para a review comprada
-- pronta isso impedia a UI de localizar a variante. Mantemos review_id em
-- details e projetamos o UUID da variante somente quando o helper prova que o
-- bundle especializado e acionavel. Sem variante, details instruem cadastro
-- manual (tipo/medida nunca sao inferidos) e conservam produto/grupo exatos.
CREATE OR REPLACE FUNCTION public.artisanal_strap_catalog_diagnostics()
RETURNS TABLE(issue_code text,entity_id uuid,details jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role()<>'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
  SELECT 'variant_product_status_divergence'::text,v.id,
    jsonb_build_object('variant_status',v.status,'product_id',p.id,'product_active',p.active)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE p.active IS DISTINCT FROM (v.status='active')
  UNION ALL
  SELECT 'purchase_enabled_invalid_commercial_data',v.id,
    jsonb_build_object('finished_product_id',p.id,'has_purchase_price',p.purchase_price>0,
      'has_purchase_unit',nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NOT NULL,
      'conversion_valid',p.conversion_rate>0 AND (p.purchase_unit<>p.unit OR p.conversion_rate=1),
      'moq_valid',p.min_order_quantity>0,'multiple_valid',p.purchase_multiple>0,
      'preparation_days_valid',p.material_preparation_days>=0,
      'supplier_missing_allowed_only_as_provisional_po',p.supplier_id IS NULL)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE v.purchase_enabled AND (p.purchase_price IS NULL OR p.purchase_price<=0
    OR nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NULL OR p.conversion_rate IS NULL
    OR p.conversion_rate<=0 OR (p.purchase_unit=p.unit AND p.conversion_rate<>1)
    OR p.min_order_quantity IS NULL OR p.min_order_quantity<=0
    OR p.purchase_multiple IS NULL OR p.purchase_multiple<=0 OR p.material_preparation_days<0)
  UNION ALL
  SELECT 'active_internal_variant_without_current_recipe',v.id,
    jsonb_build_object('measure_id',v.measure_id,'base_group_id',v.base_group_id)
  FROM public.artisanal_strap_variants v
  WHERE v.status='active' AND v.min_stock_replenishment_mode='internal'
    AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_recipes r
      WHERE r.measure_id=v.measure_id AND r.base_group_id=v.base_group_id
        AND r.status='approved' AND r.valid_from<=now()
        AND (r.valid_to IS NULL OR r.valid_to>now()))
  UNION ALL
  SELECT 'official_base_width_divergence',op.id,
    jsonb_build_object('base_group_id',op.base_group_id,'color_id',op.color_id,
      'official_product_id',op.official_product_id,
      'product_width_mm',public.strap_material_product_width_mm(op.official_product_id),
      'profile_width_mm',wp.usable_width_mm)
  FROM public.base_material_color_official_products op
  JOIN public.base_material_width_profiles wp ON wp.base_group_id=op.base_group_id
    AND wp.status='approved' AND wp.valid_to IS NULL
  WHERE op.status='active' AND (public.strap_material_product_width_mm(op.official_product_id) IS NULL
    OR abs(public.strap_material_product_width_mm(op.official_product_id)-wp.usable_width_mm)>0.000001)
  UNION ALL
  SELECT 'legacy_technical_line_review_required',m.id,
    jsonb_build_object('technical_sheet_id',m.technical_sheet_id,
      'technical_strap_line_id',m.technical_strap_line_id,'legacy_path',m.legacy_path,
      'legacy_ordinal',m.legacy_ordinal)
  FROM public.technical_strap_line_identity_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'legacy_recipe_map_review_required',m.legacy_recipe_id,
    jsonb_build_object('legacy_recipe_id',m.legacy_recipe_id,
      'resolution_reason',m.resolution_reason,
      'candidates',coalesce((SELECT ri.candidates
        FROM public.artisanal_strap_migration_review_items ri
        WHERE ri.status='review_required' AND ri.legacy_id=m.legacy_recipe_id::text
        ORDER BY ri.created_at DESC LIMIT 1),'[]'::jsonb))
  FROM public.legacy_artisanal_recipe_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'migration_review_item_required',
    CASE
      WHEN ri.entity_type='buy_ready_strap_product' AND projection.data IS NOT NULL
        THEN v.id
      ELSE ri.id
    END,
    jsonb_build_object(
      'review_id',ri.id,
      'entity_type',ri.entity_type,
      'legacy_id',ri.legacy_id,
      'candidates',ri.candidates,
      'reason',ri.reason
    ) || CASE WHEN ri.entity_type='buy_ready_strap_product' THEN jsonb_build_object(
      'variant_id',v.id,
      'action_required',CASE
        WHEN projection.data IS NOT NULL THEN 'review_existing_variant'
        WHEN v.id IS NULL THEN 'create_variant_with_bundle'
        ELSE 'clear_operational_blockers_before_review'
      END,
      'resolution_operation','save_artisanal_strap_catalog_bundle',
      'manual_creation_requires_explicit_type_and_measure',v.id IS NULL,
      'required_finished_product_id',ri.candidates->'product_id',
      'required_identity_group_id',ri.candidates->'product_group_id',
      'administrative_projection',projection.data
    ) ELSE '{}'::jsonb END
  FROM public.artisanal_strap_migration_review_items ri
  LEFT JOIN public.artisanal_strap_variants v
    ON ri.entity_type='buy_ready_strap_product'
   AND (
     ri.candidates->>'variant_id'=v.id::text
     OR (
       nullif(ri.candidates->>'variant_id','') IS NULL
       AND ri.legacy_id=v.finished_product_id::text
     )
   )
  LEFT JOIN LATERAL (
    SELECT public.buy_ready_strap_review_projection(v.id) AS data
  ) projection ON v.id IS NOT NULL
  WHERE ri.status='review_required';
END;
$$;

-- Nenhum UPDATE de sale_order_items: snapshots/demandas terminais permanecem
-- exatamente como foram confirmados.

ALTER TABLE public.artisanal_strap_variants
  ADD CONSTRAINT artisanal_strap_variants_identity_basis_ck
    CHECK (identity_basis IN ('reference_base', 'finished_product_group')),
  ADD CONSTRAINT artisanal_strap_variants_finished_group_shape_ck
    CHECK (
      identity_basis <> 'finished_product_group'
      OR (
        NOT internal_production_enabled
        AND purchase_enabled
        AND min_stock_replenishment_mode = 'buy_ready'
      )
    );

-- -----------------------------------------------------------------------------
-- 8. ACLs e assertions executaveis
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.save_artisanal_strap_variant(
    uuid, uuid, uuid, uuid, numeric, text, boolean, text, boolean,
    text, text, uuid, text
  ),
  public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text, text),
  public.save_artisanal_strap_catalog_bundle(jsonb, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.save_artisanal_strap_variant(
    uuid, uuid, uuid, uuid, numeric, text, boolean, text, boolean,
    text, text, uuid, text
  ),
  public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text, text),
  public.save_artisanal_strap_catalog_bundle(jsonb, text)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.is_buy_ready_strass_identity(uuid, uuid),
  public.resolve_artisanal_strap_source_availability(uuid),
  public.assert_artisanal_strap_variant_activation(uuid),
  public.artisanal_strap_variant_has_open_commitments(uuid),
  public.buy_ready_strap_review_projection(uuid),
  public.tg_enforce_buy_ready_strass_product(),
  public.tg_sync_finished_product_canonical_color(),
  public.tg_reject_finished_group_strap_recipe(),
  public.tg_validate_technical_strap_identity(),
  public.tg_enforce_strap_internal_source_capability(),
  public.tg_enforce_strap_job_source_capability(),
  public.tg_cancel_stale_internal_strap_job_failure(),
  public.tg_audit_stale_internal_strap_job_cancellation(),
  public.tg_suppress_stale_strap_job_retry_audit()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.resolve_artisanal_strap_source_availability(uuid),
  public.assert_artisanal_strap_variant_activation(uuid)
TO service_role;

COMMENT ON FUNCTION public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text, text) IS
  'Resolve medida + grupo de identidade + cor. finished_product_group fixa buy_ready e nunca devolve base/receita.';
COMMENT ON FUNCTION public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text) IS
  'Wrapper legado compativel; preserva a semantica reference_base.';

DO $$
DECLARE
  v_trigger_timing smallint;
  v_source text;
  v_catalog text;
  v_list text;
  v_preview text;
  v_bundle text;
  v_projection text;
  v_diagnostics text;
  v_internal_guard text;
  v_job_guard text;
  v_job_failure_guard text;
  v_job_retry_audit_guard text;
  v_color_sync text;
  v_validator text;
BEGIN
  SELECT t.tgtype INTO v_trigger_timing
    FROM pg_trigger t
   WHERE t.tgname = 'trg_validate_artisanal_strap_variant'
     AND t.tgrelid = 'public.artisanal_strap_variants'::regclass
     AND NOT t.tgisinternal;
  -- tgtype bit 2 = BEFORE. O validator consulta NEW.id e portanto precisa ser
  -- o constraint trigger AFTER publicado pela 03000.
  IF v_trigger_timing IS NULL OR (v_trigger_timing & 2) = 2 THEN
    RAISE EXCEPTION 'Validator de variante nao pode executar BEFORE INSERT';
  END IF;

  SELECT pg_get_functiondef(
    'public.resolve_artisanal_strap_source_availability(uuid)'::regprocedure
  ) INTO v_source;
  IF v_source !~ 'internal_production_disabled'
     OR v_source !~ 'internal_production_enabled'
     OR v_source !~ 'identity_group_id' THEN
    RAISE EXCEPTION 'Disponibilidade por origem nao aplica capacidade/identidade comprada pronta';
  END IF;

  SELECT pg_get_functiondef(
    'public.resolve_artisanal_strap_catalog(uuid,uuid,uuid,text,text)'::regprocedure
  ) INTO v_catalog;
  IF v_catalog !~ 'finished_product_group'
     OR v_catalog !~ 'v_effective_source := ''buy_ready'''
     OR v_catalog !~ 'internal_production_disabled' THEN
    RAISE EXCEPTION 'Resolver de catalogo nao fixa compra pronta nem rejeita internal';
  END IF;

  SELECT pg_get_functiondef(
    'public.list_artisanal_strap_catalog(boolean)'::regprocedure
  ) INTO v_list;
  IF v_list !~ 'supplier_color_code' THEN
    RAISE EXCEPTION 'Lista do catalogo omite codigo da cor do fornecedor';
  END IF;

  SELECT pg_get_functiondef(
    'public.buy_ready_strap_review_projection(uuid)'::regprocedure
  ) INTO v_projection;
  SELECT pg_get_functiondef(
    'public.artisanal_strap_catalog_diagnostics()'::regprocedure
  ) INTO v_diagnostics;
  IF v_projection !~ 'administrative_projection'
     OR v_projection !~ 'persisted_identity_basis'
     OR v_projection !~ 'buy_ready_review_target'
     OR v_diagnostics !~ 'review_existing_variant'
     OR v_diagnostics !~ 'create_variant_with_bundle' THEN
    RAISE EXCEPTION 'Review STRASS nao possui projecao/diagnostico administrativo acionavel';
  END IF;

  SELECT pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_preview;
  IF v_preview !~ 'technical_identity_snapshot_stale'
     OR v_preview !~ 'identity_group_id'
     OR v_preview !~ 'internal_production_disabled'
     OR v_preview !~ 'v_source := ''buy_ready''' THEN
    RAISE EXCEPTION 'Preview nao usa identidade da ficha/origem fixa buy_ready';
  END IF;

  SELECT pg_get_functiondef(
    'public.save_artisanal_strap_catalog_bundle(jsonb,text)'::regprocedure
  ) INTO v_bundle;
  IF v_bundle !~ 'finished_product_group'
     OR v_bundle !~ 'is_artisanal = false'
     OR v_bundle !~ 'nao aceita receita interna'
     OR v_bundle !~ 'v_canonical_color_name'
     OR v_bundle !~ 'supplier_color_code'
     OR v_bundle !~ 'buy_ready_strap_product' THEN
    RAISE EXCEPTION 'Bundle nao preserva produto comprado pronto fora da fabricacao artesanal';
  END IF;

  SELECT pg_get_functiondef(
    'public.tg_enforce_strap_internal_source_capability()'::regprocedure
  ) INTO v_internal_guard;
  SELECT pg_get_functiondef(
    'public.tg_enforce_strap_job_source_capability()'::regprocedure
  ) INTO v_job_guard;
  SELECT pg_get_functiondef(
    'public.tg_cancel_stale_internal_strap_job_failure()'::regprocedure
  ) INTO v_job_failure_guard;
  SELECT pg_get_functiondef(
    'public.tg_suppress_stale_strap_job_retry_audit()'::regprocedure
  ) INTO v_job_retry_audit_guard;
  SELECT pg_get_functiondef(
    'public.tg_sync_finished_product_canonical_color()'::regprocedure
  ) INTO v_color_sync;
  SELECT pg_get_functiondef(
    'public.validate_artisanal_strap_variant(uuid)'::regprocedure
  ) INTO v_validator;
  IF v_internal_guard !~ 'strap-variant-capability:'
     OR v_internal_guard !~ 'Payload interno de tira ficou obsoleto'
     OR v_job_guard !~ 'jsonb_array_elements'
     OR v_job_guard !~ 'strap-variant-capability:'
     OR v_job_guard !~ 'Payload de job interno ficou obsoleto'
     OR v_job_failure_guard !~ 'cancelled_by_worker_guard'
     OR v_job_failure_guard !~ 'attempted_failure_status'
     OR v_job_failure_guard !~ 'dead_letter'
     OR v_job_retry_audit_guard !~ 'RETURN NULL'
     OR v_color_sync !~ 'NEW.name IS NOT DISTINCT FROM OLD.name'
     OR v_color_sync !~ 'SET color = NEW.name'
     OR v_validator !~ 'artisanal_strap_variant_has_open_commitments' THEN
    RAISE EXCEPTION 'Gates concorrentes de origem/cor/ativacao STRASS incompletos';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
    JOIN public.products p ON p.id = v.finished_product_id
    JOIN public.canonical_colors c ON c.id = v.color_id
    WHERE v.identity_basis = 'finished_product_group'
      AND (
        v.internal_production_enabled
        OR NOT v.purchase_enabled
        OR v.min_stock_replenishment_mode IS DISTINCT FROM 'buy_ready'
        OR p.group_id IS DISTINCT FROM v.base_group_id
        OR public.normalize_strap_catalog_text(p.color) IS DISTINCT FROM c.name_norm
        OR p.is_artisanal
        OR EXISTS (
          SELECT 1 FROM public.artisanal_strap_recipes r
           WHERE r.measure_id = v.measure_id AND r.base_group_id = v.base_group_id
             AND r.status NOT IN ('superseded', 'suspended', 'archived')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Variante finished_product_group viola shape estrutural';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products p
     WHERE public.is_buy_ready_strass_identity(p.id, p.group_id)
       AND p.is_artisanal
  ) OR EXISTS (
    SELECT 1
      FROM public.artisanal_strap_variants v
      JOIN public.products p ON p.id = v.finished_product_id
     WHERE (
       public.is_buy_ready_strass_identity(p.id, p.group_id)
       OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
     ) AND (
       v.internal_production_enabled
       OR (v.status = 'active' AND v.identity_basis <> 'finished_product_group')
     )
  ) OR EXISTS (
    SELECT 1
      FROM public.artisanal_strap_recipes r
     WHERE public.is_buy_ready_strass_identity(NULL, r.base_group_id)
       AND r.status NOT IN ('superseded', 'suspended', 'archived')
  ) THEN
    RAISE EXCEPTION 'Gate nominal STRASS permite somente compra pronta sem receita/producao interna';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sale_order_strap_demands d
     WHERE d.source_mode = 'buy_ready'
       AND (d.recipe_id IS NOT NULL OR d.base_product_id IS NOT NULL
         OR d.confirmed_yield_snapshot IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Demanda buy_ready historica viola shape sem base/receita/rendimento';
  END IF;

  IF EXISTS (
    WITH inspectable_jobs AS MATERIALIZED (
      SELECT candidate.*
        FROM public.strap_demand_jobs candidate
       WHERE candidate.status IN ('queued', 'retry', 'dead_letter')
       ORDER BY candidate.id
       FOR UPDATE SKIP LOCKED
    )
    SELECT 1
      FROM inspectable_jobs j
     WHERE jsonb_typeof(j.payload -> 'lines') = 'array'
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(j.payload -> 'lines') line(value)
           JOIN public.artisanal_strap_variants v
             ON line.value ->> 'strap_variant_id' = v.id::text
           JOIN public.products p ON p.id = v.finished_product_id
          WHERE line.value ->> 'source_mode' = 'internal'
            AND (
              NOT v.internal_production_enabled
              OR v.identity_basis <> 'reference_base'
            )
            AND (
              public.is_buy_ready_strass_identity(p.id, p.group_id)
              OR public.is_buy_ready_strass_identity(NULL, v.base_group_id)
            )
       )
  ) THEN
    RAISE EXCEPTION 'Job internal obsoleto permaneceu em queued/retry/dead_letter e entraria em loop';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trg_enforce_strap_job_source_capability'
       AND t.tgrelid = 'public.strap_demand_jobs'::regclass
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Trigger de enqueue nao fecha payload internal obsoleto';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trg_cancel_stale_internal_strap_job_failure'
       AND t.tgrelid = 'public.strap_demand_jobs'::regclass
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trg_audit_stale_internal_strap_job_cancellation'
       AND t.tgrelid = 'public.strap_demand_jobs'::regclass
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trg_suppress_stale_strap_job_retry_audit'
       AND t.tgrelid = 'public.artisanal_strap_operational_audit_log'::regclass
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Triggers de neutralizacao do worker stale nao foram instalados';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.resolve_artisanal_strap_catalog(uuid,uuid,uuid,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.resolve_artisanal_strap_source_availability(uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_reject_finished_group_strap_recipe()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.is_buy_ready_strass_identity(uuid,uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_enforce_buy_ready_strass_product()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_validate_technical_strap_identity()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.buy_ready_strap_review_projection(uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_enforce_strap_internal_source_capability()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_enforce_strap_job_source_capability()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_cancel_stale_internal_strap_job_failure()',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.tg_suppress_stale_strap_job_retry_audit()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACL de helpers/RPCs de tira comprada pronta esta ampla demais';
  END IF;
END;
$$;
