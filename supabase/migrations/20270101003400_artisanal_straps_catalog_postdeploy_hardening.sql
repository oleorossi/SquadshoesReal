-- =============================================================================
-- Tiras artesanais: hardening pos-deploy do catalogo e disponibilidade por fonte
-- Spec: specs/tiras-artesanais-unificacao.md (Reqs. 25, 73, 101, 118, 122-129)
--
-- 03000 ja foi publicada antes destes guards. Esta migration e deliberadamente
-- aditiva: nao recria tabelas/seeds, nao reescreve snapshots/compromissos e
-- reaplica somente funcoes, triggers e correcoes de permissao deterministicas.
-- =============================================================================

-- Req129: o deploy antigo copiou o grant granular amplo /terceirizados. Como as
-- rotas legadas especificas foram apagadas pela propria 03000, sua proveniencia
-- nao e recuperavel com seguranca. Aplicamos menor privilegio: removemos apenas
-- o grant do hub de usuario nao-admin que ainda tem /terceirizados e nao possui
-- capability explicita do dominio. Nenhuma permissao de terceiros e apagada.
DELETE FROM public.user_permissions target
 WHERE target.module = '/tiras-artesanais'
   AND EXISTS (
     SELECT 1
       FROM public.user_permissions broad
      WHERE broad.user_id = target.user_id
        AND broad.module = '/terceirizados'
        AND broad.can_view
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.user_roles ur
      WHERE ur.user_id = target.user_id
        AND ur.role = 'admin'::public.app_role
   )
   AND NOT EXISTS (
     SELECT 1
       FROM public.artisanal_strap_user_capabilities cap
      WHERE cap.user_id = target.user_id
   );

-- Se uma rota especifica ainda existir (ambiente parcialmente migrado), migra
-- apenas essa concessao explicita. Nunca consulta /terceirizados nem role/RBAC.
WITH explicit_legacy AS (
  SELECT
    user_id,
    bool_or(can_view) AS can_view,
    bool_or(can_create) AS can_create,
    bool_or(can_edit) AS can_edit,
    bool_or(can_delete) AS can_delete
  FROM public.user_permissions
  WHERE module IN (
    '/calculadora-tiras',
    '/artisanal-recipes',
    '/terceirizados?tab=recipes'
  )
    AND can_view
  GROUP BY user_id
)
INSERT INTO public.user_permissions (
  user_id, module, can_view, can_create, can_edit, can_delete
)
SELECT
  user_id, '/tiras-artesanais', can_view, can_create, can_edit, can_delete
FROM explicit_legacy
ON CONFLICT (user_id, module) DO UPDATE
SET can_view = public.user_permissions.can_view OR EXCLUDED.can_view,
    can_create = public.user_permissions.can_create OR EXCLUDED.can_create,
    can_edit = public.user_permissions.can_edit OR EXCLUDED.can_edit,
    can_delete = public.user_permissions.can_delete OR EXCLUDED.can_delete;

DELETE FROM public.user_permissions
 WHERE module IN (
   '/calculadora-tiras',
   '/artisanal-recipes',
   '/terceirizados?tab=recipes'
 );

-- Override: resolve_artisanal_strap_source_availability
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

  v_finished_allowed := v_variant.status = 'active'
    AND v_finished.id IS NOT NULL AND v_finished.active AND v_finished.unit = 'm';
  v_internal_allowed := v_finished_allowed
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
    'administratively_active', v_variant.status = 'active',
    'finished_stock_consumption_allowed', v_finished_allowed,
    'finished_available_m', CASE WHEN v_finished_allowed THEN
      greatest(coalesce(v_finished.quantity, 0) - coalesce(v_finished.reserved_stock, 0), 0)
      ELSE 0 END,
    'internal_production_allowed', v_internal_allowed,
    'buy_ready_purchase_allowed', v_buy_allowed,
    'internal_block_reason', v_internal_reason,
    'buy_ready_block_reason', v_buy_reason,
    'base_product_id', v_official.official_product_id,
    'recipe_id', v_recipe.id
  );
END;
$$;

-- Override: assert_artisanal_strap_variant_activation
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

-- Override: validate_artisanal_strap_variant
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
BEGIN
  SELECT * INTO v_variant FROM public.artisanal_strap_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;

  SELECT * INTO v_product FROM public.products WHERE id = v_variant.finished_product_id;
  IF NOT FOUND OR v_product.unit <> 'm' THEN
    RAISE EXCEPTION 'Produto acabado da variante deve possuir unidade-base m';
  END IF;

  IF v_variant.purchase_enabled THEN
    IF v_product.purchase_price IS NULL OR v_product.purchase_price <= 0
       OR nullif(btrim(coalesce(v_product.purchase_unit, '')), '') IS NULL
       OR v_product.conversion_rate IS NULL OR v_product.conversion_rate <= 0
       OR (v_product.purchase_unit = v_product.unit AND v_product.conversion_rate <> 1)
       OR v_product.min_order_quantity IS NULL OR v_product.min_order_quantity <= 0
       OR v_product.purchase_multiple IS NULL OR v_product.purchase_multiple <= 0
       OR v_product.material_preparation_days < 0 THEN
      RAISE EXCEPTION 'Compra pronta habilitada exige preco, unidade/conversao, MOQ, multiplo e preparo validos';
    END IF;
  END IF;

  IF v_variant.status = 'active' THEN
    IF v_variant.min_stock_m IS NULL OR v_variant.min_stock_replenishment_mode IS NULL THEN
      RAISE EXCEPTION 'Variante ativa exige estoque minimo e origem de reposicao do piso confirmados';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures m
        JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
       WHERE m.id = v_variant.measure_id AND m.active AND t.active
    ) THEN
      RAISE EXCEPTION 'Variante ativa exige familia e medida ativas';
    END IF;
  END IF;
END;
$$;

-- Override: tg_validate_artisanal_strap_variant
CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- O UUID da variante identifica permanentemente medida + base + cor +
  -- produto acabado. Trocar qualquer uma dessas colunas reutilizaria a mesma
  -- identidade para outro material e corromperia snapshots de PV, reservas e
  -- movimentos. Uma correção cadastral cria outra variante e arquiva a antiga.
  IF TG_OP = 'UPDATE' AND (
    NEW.measure_id IS DISTINCT FROM OLD.measure_id
    OR NEW.base_group_id IS DISTINCT FROM OLD.base_group_id
    OR NEW.color_id IS DISTINCT FROM OLD.color_id
    OR NEW.finished_product_id IS DISTINCT FROM OLD.finished_product_id
  ) THEN
    RAISE EXCEPTION 'Identidade da variante e imutavel; crie uma nova variante e arquive a anterior';
  END IF;

  -- Valida apos a linha existir para compartilhar exatamente a mesma regra com
  -- RPCs e diagnosticos. Erro reverte a instrucao/transacao inteira.
  PERFORM public.validate_artisanal_strap_variant(NEW.id);
  IF NEW.status = 'active' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.canonical_colors c WHERE c.id=NEW.color_id AND c.active
      ) OR NOT EXISTS (
        SELECT 1 FROM public.base_material_color_official_products op
         WHERE op.base_group_id=NEW.base_group_id AND op.color_id=NEW.color_id
           AND op.status='active'
      ) THEN
        RAISE EXCEPTION 'Variante nova exige cor e produto-base oficial ativos';
      END IF;
      PERFORM public.assert_artisanal_strap_variant_activation(NEW.id);
    ELSIF OLD.status IS DISTINCT FROM 'active'
       OR NEW.min_stock_replenishment_mode
          IS DISTINCT FROM OLD.min_stock_replenishment_mode THEN
      PERFORM public.assert_artisanal_strap_variant_activation(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Override: tg_guard_artisanal_strap_finished_product
CREATE OR REPLACE FUNCTION public.tg_guard_artisanal_strap_finished_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND current_setting('app.artisanal_strap_catalog_write', true) IS DISTINCT FROM '1'
     AND EXISTS (
       SELECT 1 FROM public.artisanal_strap_variants v
        WHERE v.finished_product_id = OLD.id
     )
     AND (
       NEW.name IS DISTINCT FROM OLD.name
       OR NEW.sku IS DISTINCT FROM OLD.sku
       OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.min_stock IS DISTINCT FROM OLD.min_stock
       OR NEW.unit IS DISTINCT FROM OLD.unit
       OR NEW.is_artisanal IS DISTINCT FROM OLD.is_artisanal
       OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
       OR NEW.purchase_unit IS DISTINCT FROM OLD.purchase_unit
       OR NEW.purchase_order_unit IS DISTINCT FROM OLD.purchase_order_unit
       OR NEW.conversion_rate IS DISTINCT FROM OLD.conversion_rate
       OR NEW.purchase_price IS DISTINCT FROM OLD.purchase_price
       OR NEW.min_order_quantity IS DISTINCT FROM OLD.min_order_quantity
       OR NEW.purchase_multiple IS DISTINCT FROM OLD.purchase_multiple
       OR NEW.material_preparation_days IS DISTINCT FROM OLD.material_preparation_days
     ) THEN
    RAISE EXCEPTION 'Produto acabado de tira deve ser alterado pela RPC canonica do catalogo';
  END IF;
  RETURN NEW;
END;
$$;

-- Override: save_canonical_color
CREATE OR REPLACE FUNCTION public.save_canonical_color(
  p_name text,
  p_id uuid DEFAULT NULL,
  p_active boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de cor canonica');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF p_id IS NULL THEN
    INSERT INTO public.canonical_colors (name, active)
    VALUES (p_name, coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.canonical_colors
       SET name = p_name,
           active = coalesce(p_active, active)
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Cor canonica inexistente'; END IF;
  END IF;

  IF NOT coalesce(p_active, true) THEN
    UPDATE public.base_material_color_official_products
       SET status = 'suspended', review_reason = v_reason
     WHERE color_id = v_id AND status = 'active';
  END IF;
  RETURN v_id;
END;
$$;

-- Override: approve_base_material_width_profile
CREATE OR REPLACE FUNCTION public.approve_base_material_width_profile(
  p_profile_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_effective_at timestamptz := now();
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');
  SELECT * INTO v_profile
    FROM public.base_material_width_profiles
   WHERE id = p_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil de largura inexistente'; END IF;
  IF v_profile.status = 'approved' AND v_profile.valid_to IS NULL THEN
    RETURN to_jsonb(v_profile);
  END IF;
  IF v_profile.status IN ('superseded', 'archived') THEN
    RAISE EXCEPTION 'Perfil historico nao pode ser reaprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-width:' || v_profile.base_group_id::text, 0));

  IF EXISTS (
    SELECT 1
      FROM public.base_material_color_official_products op
     WHERE op.base_group_id = v_profile.base_group_id
       AND op.status = 'active'
       AND (
         public.strap_material_product_width_mm(op.official_product_id) IS NULL
         OR abs(public.strap_material_product_width_mm(op.official_product_id) - v_profile.usable_width_mm) > 0.000001
       )
  ) THEN
    RAISE EXCEPTION 'Produto oficial da base possui largura ausente/divergente; saneie antes de aprovar';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  UPDATE public.base_material_width_profiles
     SET status = 'superseded',
         valid_to = v_effective_at,
         review_reason = v_reason
   WHERE base_group_id = v_profile.base_group_id
     AND status = 'approved'
     AND valid_to IS NULL
     AND id <> p_profile_id;

  -- Uma largura nova invalida geometricamente as receitas anteriores. Nada e
  -- escalado/herdado: cada medida precisa de uma nova receita aprovada.
  UPDATE public.artisanal_strap_recipes
     SET status = 'suspended',
         valid_to = v_effective_at,
         review_reason = 'Perfil de largura da base alterado: ' || v_reason
   WHERE base_group_id = v_profile.base_group_id
     AND status = 'approved';

  UPDATE public.base_material_width_profiles
     SET status = 'approved',
         valid_from = v_effective_at,
         valid_to = NULL,
         approved_by = auth.uid(),
         approved_at = v_effective_at,
         review_reason = v_reason
   WHERE id = p_profile_id
  RETURNING * INTO v_profile;
  RETURN to_jsonb(v_profile);
END;
$$;

-- Override: save_artisanal_strap_variant
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
  v_id uuid;
  v_previous_status text;
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de variante de tira');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF p_status NOT IN ('active', 'review_required', 'suspended', 'archived') THEN
    RAISE EXCEPTION 'Status de variante invalido';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'strap-variant:' || p_measure_id::text || ':' || p_base_group_id::text || ':' || p_color_id::text,
      0
    )
  );
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  IF p_id IS NULL THEN
    INSERT INTO public.artisanal_strap_variants (
      measure_id, base_group_id, color_id, finished_product_id,
      min_stock_m, min_stock_replenishment_mode, purchase_enabled,
      status, review_reason
    ) VALUES (
      p_measure_id, p_base_group_id, p_color_id, p_finished_product_id,
      p_min_stock_m, p_min_stock_replenishment_mode, coalesce(p_purchase_enabled, false),
      p_status, CASE WHEN p_status = 'active' THEN NULL ELSE coalesce(p_review_reason, v_reason) END
    ) RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_previous_status
      FROM public.artisanal_strap_variants
     WHERE id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;
    UPDATE public.artisanal_strap_variants
       SET measure_id = p_measure_id,
           base_group_id = p_base_group_id,
           color_id = p_color_id,
           finished_product_id = p_finished_product_id,
           min_stock_m = p_min_stock_m,
           min_stock_replenishment_mode = p_min_stock_replenishment_mode,
           purchase_enabled = coalesce(p_purchase_enabled, false),
           status = p_status,
           review_reason = CASE WHEN p_status = 'active' THEN NULL ELSE coalesce(p_review_reason, v_reason) END
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;
  END IF;
  -- Trigger diferivel executa a mesma validacao; esta chamada torna o erro
  -- imediato e a RPC nunca retorna um UUID ainda invalido.
  PERFORM public.validate_artisanal_strap_variant(v_id);
  IF p_status = 'active'
     AND (p_id IS NULL OR v_previous_status IS DISTINCT FROM 'active') THEN
    PERFORM public.assert_artisanal_strap_variant_activation(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- Override: set_artisanal_strap_record_status
CREATE OR REPLACE FUNCTION public.set_artisanal_strap_record_status(
  p_entity_type text,
  p_entity_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  CASE p_entity_type
    WHEN 'artisanal_strap_types' THEN
      IF p_status <> 'archived' THEN RAISE EXCEPTION 'Familia aceita somente archived nesta RPC'; END IF;
      UPDATE public.artisanal_strap_types SET active = false WHERE id = p_entity_id
      RETURNING to_jsonb(artisanal_strap_types.*) INTO v_result;
      UPDATE public.artisanal_strap_recipes r
         SET status = 'suspended', valid_to = coalesce(r.valid_to, now()), review_reason = v_reason
        FROM public.artisanal_strap_measures m
       WHERE m.strap_type_id = p_entity_id AND r.measure_id = m.id AND r.status = 'approved';
      UPDATE public.artisanal_strap_variants v
         SET status = 'suspended', review_reason = v_reason
        FROM public.artisanal_strap_measures m
       WHERE m.strap_type_id = p_entity_id AND v.measure_id = m.id AND v.status = 'active';
    WHEN 'artisanal_strap_measures' THEN
      IF p_status <> 'archived' THEN RAISE EXCEPTION 'Medida aceita somente archived nesta RPC'; END IF;
      UPDATE public.artisanal_strap_measures SET active = false WHERE id = p_entity_id
      RETURNING to_jsonb(artisanal_strap_measures.*) INTO v_result;
      UPDATE public.artisanal_strap_recipes
         SET status = 'suspended', valid_to = coalesce(valid_to, now()), review_reason = v_reason
       WHERE measure_id = p_entity_id AND status = 'approved';
      UPDATE public.artisanal_strap_variants
         SET status = 'suspended', review_reason = v_reason
       WHERE measure_id = p_entity_id AND status = 'active';
    WHEN 'canonical_colors' THEN
      IF p_status <> 'archived' THEN RAISE EXCEPTION 'Cor aceita somente archived nesta RPC'; END IF;
      UPDATE public.canonical_colors SET active = false WHERE id = p_entity_id
      RETURNING to_jsonb(canonical_colors.*) INTO v_result;
      UPDATE public.base_material_color_official_products
         SET status = 'suspended', review_reason = v_reason
       WHERE color_id = p_entity_id AND status = 'active';
    WHEN 'color_aliases' THEN
      PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
      IF p_status NOT IN ('rejected', 'archived') THEN RAISE EXCEPTION 'Status de alias invalido'; END IF;
      UPDATE public.color_aliases
         SET status = p_status, review_reason = v_reason,
             approved_by = NULL, approved_at = NULL
       WHERE id = p_entity_id
      RETURNING to_jsonb(color_aliases.*) INTO v_result;
    WHEN 'base_material_width_profiles' THEN
      IF p_status NOT IN ('suspended', 'archived') THEN RAISE EXCEPTION 'Status de perfil invalido'; END IF;
      UPDATE public.base_material_width_profiles
         SET status = p_status,
             valid_to = CASE WHEN status = 'approved' THEN coalesce(valid_to, now()) ELSE valid_to END,
             review_reason = v_reason
       WHERE id = p_entity_id AND status NOT IN ('superseded', 'archived')
      RETURNING to_jsonb(base_material_width_profiles.*) INTO v_result;
      UPDATE public.artisanal_strap_recipes
         SET status = 'suspended', valid_to = coalesce(valid_to, now()), review_reason = v_reason
       WHERE base_width_profile_id = p_entity_id AND status = 'approved';
    WHEN 'base_material_color_official_products' THEN
      PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
      IF p_status NOT IN ('suspended', 'archived') THEN RAISE EXCEPTION 'Status de produto oficial invalido'; END IF;
      UPDATE public.base_material_color_official_products
         SET status = p_status, review_reason = v_reason
       WHERE id = p_entity_id AND status <> 'superseded'
      RETURNING to_jsonb(base_material_color_official_products.*) INTO v_result;
    WHEN 'artisanal_strap_variants' THEN
      IF p_status NOT IN ('review_required', 'suspended', 'archived') THEN
        RAISE EXCEPTION 'Ativacao de variante exige save_artisanal_strap_variant';
      END IF;
      UPDATE public.artisanal_strap_variants
         SET status = p_status, review_reason = v_reason
       WHERE id = p_entity_id
      RETURNING to_jsonb(artisanal_strap_variants.*) INTO v_result;
    WHEN 'artisanal_strap_recipes' THEN
      IF p_status NOT IN ('suspended', 'archived') THEN RAISE EXCEPTION 'Status de receita invalido'; END IF;
      UPDATE public.artisanal_strap_recipes
         SET status = p_status,
             valid_to = CASE WHEN status = 'approved' THEN now() ELSE valid_to END,
             review_reason = v_reason
       WHERE id = p_entity_id AND status NOT IN ('superseded', 'archived')
      RETURNING to_jsonb(artisanal_strap_recipes.*) INTO v_result;
    ELSE
      RAISE EXCEPTION 'Entidade de catalogo invalida';
  END CASE;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Registro inexistente ou estado imutavel'; END IF;
  RETURN v_result;
END;
$$;

-- Override: list_artisanal_strap_catalog
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
          WHERE v.color_id=c.id AND v.status='active'
            AND (
              coalesce((public.resolve_artisanal_strap_source_availability(v.id)
                ->>'finished_available_m')::numeric,0)>0
              OR coalesce((public.resolve_artisanal_strap_source_availability(v.id)
                ->>'buy_ready_purchase_allowed')::boolean,false)
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
        to_jsonb(v) || jsonb_build_object(
          'source_availability', public.resolve_artisanal_strap_source_availability(v.id)
        ) ORDER BY v.measure_id, v.base_group_id, v.color_id, v.id
      )
        FROM public.artisanal_strap_variants v
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
          'color', p.color,
          'quantity', p.quantity,
          'unit', p.unit,
          'unit_price', CASE WHEN v_can_financial THEN p.unit_price ELSE NULL END,
          'supplier_id', p.supplier_id,
          'purchase_unit', p.purchase_unit,
          'conversion_rate', p.conversion_rate,
          'purchase_price', CASE WHEN v_can_financial THEN p.purchase_price ELSE NULL END,
          'min_order_quantity', p.min_order_quantity,
          'purchase_multiple', p.purchase_multiple,
          'material_preparation_days', p.material_preparation_days,
          'active', p.active
        ) ORDER BY p.name, p.id
      )
        FROM public.products p
       WHERE (
         p.unit = 'm'
         OR p.is_artisanal
         OR EXISTS (SELECT 1 FROM public.artisanal_strap_variants v WHERE v.finished_product_id = p.id)
         OR EXISTS (SELECT 1 FROM public.base_material_color_official_products o WHERE o.official_product_id = p.id)
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
      -- Gate derivado do papel, não delegável pela tabela de capabilities.
      -- A UI usa esta chave para não oferecer aprovação/suspensão/financeiro
      -- a quem possui apenas a edição de catálogo.
      'administer_strap_operations', coalesce(auth.role() = 'service_role', false)
        OR public.user_has_any_role(ARRAY['admin']),
      'can_see_financial_values', v_can_financial
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Override: resolve_artisanal_strap_catalog
CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_catalog(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_color_id uuid,
  p_source_mode text DEFAULT NULL
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
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_source_mode IS NOT NULL AND p_source_mode NOT IN ('internal', 'buy_ready') THEN
    RAISE EXCEPTION 'Origem invalida; use internal ou buy_ready';
  END IF;

  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants
   WHERE measure_id = p_measure_id
     AND base_group_id = p_base_group_id
     AND color_id = p_color_id
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

  -- A base oficial e a receita pertencem somente ao caminho internal. Uma
  -- compra pronta nao ganha base/receita artificiais no snapshot e pode seguir
  -- quando a base interna for descontinuada, desde que o cadastro comercial do
  -- produto acabado continue valido.
  SELECT * INTO v_official
    FROM public.base_material_color_official_products
   WHERE base_group_id = p_base_group_id AND color_id = p_color_id AND status = 'active';
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

  v_source_availability := public.resolve_artisanal_strap_source_availability(v_variant.id);
  v_internal_available := coalesce(
    (v_source_availability ->> 'internal_production_allowed')::boolean, false);
  v_buy_available := coalesce(
    (v_source_availability ->> 'buy_ready_purchase_allowed')::boolean, false);

  IF p_source_mode = 'internal' AND NOT v_internal_available THEN
    RAISE EXCEPTION 'Origem interna bloqueada: %',
      v_source_availability ->> 'internal_block_reason';
  ELSIF p_source_mode = 'buy_ready' AND NOT v_buy_available THEN
    RAISE EXCEPTION 'Compra pronta bloqueada: %',
      v_source_availability ->> 'buy_ready_block_reason';
  END IF;

  v_can_financial := public.can_see_strap_financial_values();
  RETURN jsonb_build_object(
    'ok', true,
    'strap_type_id', v_measure.strap_type_id,
    'measure_id', v_measure.id,
    'base_group_id', v_variant.base_group_id,
    'color_id', v_variant.color_id,
    'variant_id', v_variant.id,
    'finished_product_id', v_finished.id,
    'base_product_id', CASE WHEN p_source_mode = 'buy_ready' THEN NULL ELSE v_base.id END,
    'recipe_id', CASE WHEN p_source_mode = 'buy_ready' THEN NULL ELSE v_recipe.id END,
    'recipe_version', CASE WHEN p_source_mode = 'buy_ready' THEN NULL ELSE v_recipe.version END,
    'confirmed_yield_m_per_m', CASE
      WHEN p_source_mode = 'buy_ready' THEN NULL
      ELSE v_recipe.confirmed_yield_m_per_m
    END,
    'finished_available_m', greatest(coalesce(v_finished.quantity, 0) - coalesce(v_finished.reserved_stock, 0), 0),
    'base_available_m', CASE
      WHEN p_source_mode = 'buy_ready' THEN NULL
      ELSE greatest(coalesce(v_base.quantity, 0) - coalesce(v_base.reserved_stock, 0), 0)
    END,
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
      WHEN v_can_financial AND p_source_mode IS DISTINCT FROM 'buy_ready'
      THEN v_recipe.transformation_cost_per_m
      ELSE NULL
    END,
    'base_unit_cost', CASE
      WHEN v_can_financial AND p_source_mode IS DISTINCT FROM 'buy_ready'
      THEN v_base.unit_price
      ELSE NULL
    END,
    'internal_unit_cost', CASE
      WHEN v_can_financial
       AND p_source_mode IS DISTINCT FROM 'buy_ready'
       AND v_internal_available
      THEN (v_base.unit_price / v_recipe.confirmed_yield_m_per_m) + v_recipe.transformation_cost_per_m
      ELSE NULL
    END
  );
END;
$$;

-- Override: save_artisanal_strap_catalog_bundle
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
  v_recipe_payload jsonb := p_payload -> 'recipe';
  v_type public.artisanal_strap_types%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_old_product jsonb;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_type_id uuid;
  v_measure_id uuid;
  v_variant_id uuid;
  v_product_id uuid;
  v_recipe_id uuid;
  v_base_group_id uuid;
  v_color_id uuid;
  v_desired_status text;
  v_recipe_status text;
  v_reason text := public.require_strap_change_reason(p_reason);
  v_defer_activation boolean := false;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(v_type_payload) <> 'object'
     OR jsonb_typeof(v_measure_payload) <> 'object'
     OR jsonb_typeof(v_variant_payload) <> 'object'
     OR jsonb_typeof(v_product_payload) <> 'object'
     OR (v_recipe_payload IS NOT NULL AND jsonb_typeof(v_recipe_payload) <> 'object') THEN
    RAISE EXCEPTION 'Payload do bundle invalido';
  END IF;
  IF v_product_payload ? 'purchase_order_unit' THEN
    RAISE EXCEPTION 'Campo legado purchase_order_unit nao e aceito; use purchase_unit';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  -- Familia: referencia por id ou cadastro/edicao no mesmo bundle.
  IF nullif(v_type_payload ->> 'id', '') IS NOT NULL THEN
    v_type_id := (v_type_payload ->> 'id')::uuid;
    SELECT * INTO v_type FROM public.artisanal_strap_types WHERE id = v_type_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Familia informada nao existe'; END IF;
    IF v_type_payload ? 'name' OR v_type_payload ? 'active' THEN
      v_type_id := public.save_artisanal_strap_type(
        coalesce(nullif(v_type_payload ->> 'name', ''), v_type.name),
        v_type.id,
        CASE WHEN v_type_payload ? 'active' THEN (v_type_payload ->> 'active')::boolean ELSE v_type.active END,
        v_reason
      );
    END IF;
  ELSE
    v_type_id := public.save_artisanal_strap_type(
      v_type_payload ->> 'name', NULL,
      coalesce((v_type_payload ->> 'active')::boolean, true), v_reason
    );
  END IF;

  -- Medida: sempre pertence a familia resolvida acima.
  IF nullif(v_measure_payload ->> 'id', '') IS NOT NULL THEN
    v_measure_id := (v_measure_payload ->> 'id')::uuid;
    SELECT * INTO v_measure FROM public.artisanal_strap_measures WHERE id = v_measure_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida informada nao existe'; END IF;
    IF v_measure.strap_type_id <> v_type_id THEN RAISE EXCEPTION 'Medida nao pertence a familia informada'; END IF;
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

  v_base_group_id := (v_variant_payload ->> 'base_group_id')::uuid;
  v_color_id := (v_variant_payload ->> 'color_id')::uuid;
  IF v_base_group_id IS NULL OR v_color_id IS NULL THEN
    RAISE EXCEPTION 'Variante exige base_group_id e color_id';
  END IF;

  -- Produto existente pode vir da variante ou de product.id. Omissao preserva
  -- campos comerciais/custo ocultos; null explicito tenta limpar e passa pelas
  -- mesmas validacoes de purchase_enabled.
  v_product_id := coalesce(
    nullif(v_variant_payload ->> 'finished_product_id', '')::uuid,
    nullif(v_product_payload ->> 'id', '')::uuid
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
      name, sku, category, quantity, min_stock, unit, unit_price, location,
      active, is_artisanal, supplier_id, purchase_unit,
      conversion_rate, purchase_price, min_order_quantity, purchase_multiple,
      material_preparation_days
    ) VALUES (
      v_product_payload ->> 'name',
      v_product_payload ->> 'sku',
      coalesce(nullif(v_product_payload ->> 'category', ''), 'Tiras Artesanais'),
      0, 0, 'm', coalesce((v_product_payload ->> 'unit_price')::numeric, 0), '',
      false, true,
      nullif(v_product_payload ->> 'supplier_id', '')::uuid,
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
      jsonb_build_object('row', to_jsonb(v_product), 'reason', v_reason), true, now()
    );
  ELSE
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto acabado informado nao existe'; END IF;
    v_old_product := to_jsonb(v_product);

    IF (v_product_payload ? 'purchase_price' OR v_product_payload ? 'unit_price')
       AND auth.role() <> 'service_role'
       AND NOT public.can_see_strap_financial_values() THEN
      RAISE EXCEPTION 'Permission denied: preco/custo exige gate financeiro';
    END IF;

    UPDATE public.products
       SET name = CASE WHEN v_product_payload ? 'name' THEN v_product_payload ->> 'name' ELSE name END,
           sku = CASE WHEN v_product_payload ? 'sku' THEN v_product_payload ->> 'sku' ELSE sku END,
           category = CASE WHEN v_product_payload ? 'category' THEN v_product_payload ->> 'category' ELSE category END,
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
           material_preparation_days = CASE WHEN v_product_payload ? 'material_preparation_days'
                                            THEN (v_product_payload ->> 'material_preparation_days')::integer
                                            ELSE material_preparation_days END,
           is_artisanal = true
     WHERE id = v_product_id
    RETURNING * INTO v_product;

    -- Se ainda nao havia variante, o trigger seletivo de products nao enxerga
    -- esta edicao; registra aqui. Produto ja vinculado e auditado pelo trigger.
    IF to_jsonb(v_product) <> v_old_product
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants av
          WHERE av.finished_product_id = v_product_id
       ) THEN
      INSERT INTO public.audit_logs (
        user_id, action, resource, resource_id, old_data, new_data, success, created_at
      ) VALUES (
        auth.uid(), 'strap_catalog_update', 'products', v_product_id::text,
        jsonb_build_object('row', v_old_product, 'reason', v_reason),
        jsonb_build_object('row', to_jsonb(v_product), 'reason', v_reason), true, now()
      );
    END IF;
  END IF;

  IF nullif(v_variant_payload ->> 'id', '') IS NOT NULL THEN
    SELECT * INTO v_variant
      FROM public.artisanal_strap_variants
     WHERE id = (v_variant_payload ->> 'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Variante informada nao existe'; END IF;
  END IF;

  v_desired_status := CASE
    WHEN v_variant_payload ? 'status' THEN v_variant_payload ->> 'status'
    WHEN v_variant.id IS NOT NULL THEN v_variant.status
    ELSE 'review_required'
  END;
  v_recipe_status := coalesce(v_recipe_payload ->> 'status', 'draft');
  v_defer_activation := v_desired_status = 'active'
    AND coalesce(v_variant_payload ->> 'min_stock_replenishment_mode', v_variant.min_stock_replenishment_mode) = 'internal'
    AND v_recipe_payload IS NOT NULL
    AND v_recipe_status = 'approved';

  v_variant_id := public.save_artisanal_strap_variant(
    v_measure_id,
    v_base_group_id,
    v_color_id,
    v_product_id,
    CASE WHEN v_variant_payload ? 'min_stock_m'
         THEN (v_variant_payload ->> 'min_stock_m')::numeric ELSE v_variant.min_stock_m END,
    CASE WHEN v_variant_payload ? 'min_stock_replenishment_mode'
         THEN v_variant_payload ->> 'min_stock_replenishment_mode' ELSE v_variant.min_stock_replenishment_mode END,
    CASE WHEN v_variant_payload ? 'purchase_enabled'
         THEN (v_variant_payload ->> 'purchase_enabled')::boolean ELSE coalesce(v_variant.purchase_enabled, false) END,
    CASE WHEN v_defer_activation THEN 'review_required' ELSE v_desired_status END,
    CASE WHEN v_variant_payload ? 'review_reason'
         THEN v_variant_payload ->> 'review_reason' ELSE v_variant.review_reason END,
    v_variant.id,
    v_reason
  );

  IF v_recipe_payload IS NOT NULL THEN
    IF nullif(v_recipe_payload ->> 'id', '') IS NOT NULL THEN
      SELECT * INTO v_recipe
        FROM public.artisanal_strap_recipes
       WHERE id = (v_recipe_payload ->> 'id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Receita informada nao existe'; END IF;
    END IF;

    v_recipe_id := public.save_artisanal_strap_recipe(
      v_measure_id,
      v_base_group_id,
      CASE WHEN v_recipe_payload ? 'cut_band_width_mm'
           THEN (v_recipe_payload ->> 'cut_band_width_mm')::numeric ELSE v_recipe.cut_band_width_mm END,
      CASE WHEN v_recipe_payload ? 'confirmed_yield_m_per_m'
           THEN (v_recipe_payload ->> 'confirmed_yield_m_per_m')::numeric ELSE v_recipe.confirmed_yield_m_per_m END,
      CASE WHEN v_recipe_payload ? 'executor_type'
           THEN v_recipe_payload ->> 'executor_type' ELSE v_recipe.executor_type END,
      -- NULL por omissao e sentinela de "preservar" no UPDATE da RPC chamada;
      -- evita reenviar/expor custo oculto a quem nao possui gate financeiro.
      CASE WHEN v_recipe_payload ? 'transformation_cost_per_m'
           THEN (v_recipe_payload ->> 'transformation_cost_per_m')::numeric ELSE NULL END,
      CASE WHEN v_recipe_payload ? 'default_contractor_id'
           THEN nullif(v_recipe_payload ->> 'default_contractor_id', '')::uuid ELSE v_recipe.default_contractor_id END,
      CASE WHEN v_recipe_payload ? 'base_width_profile_id'
           THEN nullif(v_recipe_payload ->> 'base_width_profile_id', '')::uuid ELSE v_recipe.base_width_profile_id END,
      v_recipe.id,
      v_reason
    );

    IF v_recipe_status IN ('pending_approval', 'approved') THEN
      PERFORM public.submit_artisanal_strap_recipe(v_recipe_id, v_reason);
    END IF;
    IF v_recipe_status = 'approved' THEN
      PERFORM public.approve_artisanal_strap_recipe(v_recipe_id, v_reason, now());
    ELSIF v_recipe_status NOT IN ('draft', 'pending_approval') THEN
      RAISE EXCEPTION 'Bundle aceita receita nova/editada somente draft, pending_approval ou approved';
    END IF;
  END IF;

  IF v_defer_activation THEN
    SELECT * INTO v_variant FROM public.artisanal_strap_variants WHERE id = v_variant_id;
    v_variant_id := public.save_artisanal_strap_variant(
      v_variant.measure_id, v_variant.base_group_id, v_variant.color_id,
      v_variant.finished_product_id, v_variant.min_stock_m,
      v_variant.min_stock_replenishment_mode, v_variant.purchase_enabled,
      'active', NULL, v_variant.id, v_reason
    );
  END IF;

  RETURN jsonb_build_object(
    'type_id', v_type_id,
    'measure_id', v_measure_id,
    'variant_id', v_variant_id,
    'recipe_id', v_recipe_id,
    'finished_product_id', v_product_id
  );
END;
$$;

-- Override: preview_artisanal_strap_catalog_migration
CREATE OR REPLACE FUNCTION public.preview_artisanal_strap_catalog_migration()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  WITH affected_products AS (
    SELECT DISTINCT p.*
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.is_artisanal OR coalesce(pg.is_artisanal_strap, false)
  ),
  relevant_products AS (
    -- Produto ja usado como finished_product_id de uma variante canonica tem
    -- identidade estrutural inequivoca. Ele continua no checksum de
    -- conservacao, mas nao volta artificialmente para a fila de ambiguidades.
    SELECT p.*
      FROM affected_products p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.artisanal_strap_variants v
        WHERE v.finished_product_id = p.id
     )
  ),
  unmapped_recipes AS (
    SELECT ar.*
      FROM public.artisanal_recipes ar
     WHERE NOT EXISTS (
       SELECT 1 FROM public.legacy_artisanal_recipe_map rm
        WHERE rm.legacy_recipe_id = ar.id AND rm.status = 'resolved'
     )
  ),
  technical_lines AS (
    SELECT ts.id AS technical_sheet_id,
           e.ordinality - 1 AS legacy_ordinal,
           e.value AS content,
           coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id')
             AS persisted_line_id,
           e.value ->> 'measure_id' AS persisted_measure_id,
           (
             coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id', '')
               ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             AND coalesce(e.value ->> 'measure_id', '')
               ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
             AND EXISTS (
               SELECT 1 FROM public.artisanal_strap_measures m
                WHERE m.id::text = lower(e.value ->> 'measure_id')
             )
           ) AS has_canonical_identity
      FROM public.technical_sheets ts
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS e(value, ordinality)
  ),
  pv_lines AS (
    SELECT soi.id, soi.sale_order_id, soi.quantity, soi.strap_colors
      FROM public.sale_order_items soi
     WHERE jsonb_typeof(soi.strap_colors) = 'array'
       AND jsonb_array_length(soi.strap_colors) > 0
  ),
  reservation_rows AS (
    SELECT mr.* FROM public.material_reservations mr
     WHERE mr.product_id IN (SELECT id FROM affected_products)
  ),
  purchase_rows AS (
    SELECT poi.* FROM public.purchase_order_items poi
     WHERE poi.product_id IN (SELECT id FROM affected_products)
  ),
  service_rows AS (
    SELECT so.* FROM public.service_orders so
     WHERE so.artisanal_recipe_id IS NOT NULL
  ),
  duplicate_base_colors AS (
    SELECT p.group_id,
           public.normalize_strap_catalog_text(p.color) AS color_norm,
           count(*) AS product_count,
           array_agg(p.id ORDER BY p.id) AS product_ids
      FROM public.products p
     WHERE p.active AND p.group_id IS NOT NULL
       AND nullif(public.normalize_strap_catalog_text(p.color), '') IS NOT NULL
     GROUP BY p.group_id, public.normalize_strap_catalog_text(p.color)
    HAVING count(*) > 1
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'read_only', true,
    'automatic_links_created', 0,
    'automatic_links_available', (
      SELECT count(*) FROM affected_products p
       WHERE EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.finished_product_id = p.id
       )
    ),
    'policy', 'Nomes, maior saldo e primeira linha nunca provam identidade; ambiguos ficam review_required.',
    'checks', jsonb_build_array(
      jsonb_build_object(
        'name', 'legacy_products',
        'count', (SELECT count(*) FROM affected_products),
        'quantity_total', (SELECT coalesce(sum(quantity), 0) FROM affected_products),
        'reserved_total', (SELECT coalesce(sum(reserved_stock), 0) FROM affected_products),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || coalesce(quantity, 0)::text || ':' || coalesce(reserved_stock, 0)::text,
          '|' ORDER BY id
        ), '')) FROM affected_products)
      ),
      jsonb_build_object(
        'name', 'legacy_recipes',
        'count', (SELECT count(*) FROM public.artisanal_recipes),
        'yield_total', (SELECT coalesce(sum(yield_per_meter), 0) FROM public.artisanal_recipes),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || yield_per_meter::text || ':' || active::text,
          '|' ORDER BY id
        ), '')) FROM public.artisanal_recipes)
      ),
      jsonb_build_object(
        'name', 'technical_strap_lines',
        'count', (SELECT count(*) FROM technical_lines),
        'checksum', (SELECT md5(coalesce(string_agg(
          technical_sheet_id::text || ':' || legacy_ordinal::text || ':' || md5(content::text),
          '|' ORDER BY technical_sheet_id, legacy_ordinal
        ), '')) FROM technical_lines)
      ),
      jsonb_build_object(
        'name', 'affected_sale_order_items',
        'count', (SELECT count(*) FROM pv_lines),
        'pairs_total', (SELECT coalesce(sum(quantity), 0) FROM pv_lines),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || coalesce(quantity, 0)::text || ':' || md5(strap_colors::text),
          '|' ORDER BY id
        ), '')) FROM pv_lines)
      ),
      jsonb_build_object(
        'name', 'material_reservations',
        'count', (SELECT count(*) FROM reservation_rows),
        'quantity_reserved_total', (SELECT coalesce(sum(quantity_reserved), 0) FROM reservation_rows),
        'quantity_consumed_total', (SELECT coalesce(sum(quantity_consumed), 0) FROM reservation_rows),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || product_id::text || ':' || quantity_reserved::text || ':'
            || quantity_consumed::text || ':' || status,
          '|' ORDER BY id
        ), '')) FROM reservation_rows)
      ),
      jsonb_build_object(
        'name', 'purchase_inbounds',
        'count', (SELECT count(*) FROM purchase_rows),
        'quantity_total', (SELECT coalesce(sum(quantity), 0) FROM purchase_rows),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || product_id::text || ':' || quantity::text,
          '|' ORDER BY id
        ), '')) FROM purchase_rows)
      ),
      jsonb_build_object(
        'name', 'artisanal_service_orders',
        'count', (SELECT count(*) FROM service_rows),
        'output_m_total', (SELECT coalesce(sum(artisanal_output_meters), 0) FROM service_rows),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || artisanal_recipe_id::text || ':' || coalesce(artisanal_output_meters, 0)::text,
          '|' ORDER BY id
        ), '')) FROM service_rows)
      )
    ),
    'ambiguities', jsonb_build_object(
      'legacy_products_without_proven_identity', (SELECT count(*) FROM relevant_products),
      'legacy_recipes_name_only', (SELECT count(*) FROM unmapped_recipes),
      'technical_lines_without_measure_uuid', (
        SELECT count(*) FROM technical_lines WHERE NOT has_canonical_identity
      ),
      'duplicate_active_group_color_sets', (SELECT count(*) FROM duplicate_base_colors),
      'duplicate_sets', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'group_id', group_id,
          'color_norm', color_norm,
          'product_count', product_count,
          'product_ids', product_ids
        ) ORDER BY group_id, color_norm)
          FROM duplicate_base_colors
      ), '[]'::jsonb),
      'color_alias_suggestions', coalesce((
        SELECT jsonb_agg(jsonb_build_object('alias', color_norm, 'occurrences', occurrences) ORDER BY color_norm)
          FROM (
            SELECT public.normalize_strap_catalog_text(color) AS color_norm, count(*) AS occurrences
              FROM affected_products
             WHERE nullif(public.normalize_strap_catalog_text(color), '') IS NOT NULL
             GROUP BY public.normalize_strap_catalog_text(color)
          ) s
      ), '[]'::jsonb)
    )
  ) INTO v_report;
  RETURN v_report;
END;
$$;

-- Override: run_artisanal_strap_catalog_migration_dry_run
CREATE OR REPLACE FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report jsonb;
  v_run_id uuid;
  v_checksum text;
  v_review_count bigint;
  v_reason text := public.require_strap_change_reason(p_note, 'Dry-run do catalogo de tiras artesanais');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  v_report := public.preview_artisanal_strap_catalog_migration();
  v_checksum := md5((v_report -> 'checks')::text);
  v_review_count := coalesce((v_report #>> '{ambiguities,legacy_products_without_proven_identity}')::bigint, 0)
                  + coalesce((v_report #>> '{ambiguities,legacy_recipes_name_only}')::bigint, 0)
                  + coalesce((v_report #>> '{ambiguities,technical_lines_without_measure_uuid}')::bigint, 0);

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  INSERT INTO public.artisanal_strap_migration_runs (
    status, report, overall_checksum, note, run_by
  ) VALUES (
    CASE WHEN v_review_count > 0 THEN 'review_required' ELSE 'completed' END,
    v_report, v_checksum, p_note, auth.uid()
  ) RETURNING id INTO v_run_id;

  -- Persiste apenas identidades/pendencias novas. Nenhuma ficha, produto,
  -- saldo, reserva, OC, OS ou PV legado e alterado por este dry-run.
  INSERT INTO public.technical_strap_line_identity_map (
    technical_sheet_id, legacy_path, legacy_ordinal, content_hash,
    technical_strap_line_id, measure_id, status, resolution_reason,
    resolved_by, resolved_at
  )
  SELECT ts.id, 'strap_colors', e.ordinality - 1, md5(e.value::text),
         CASE
           WHEN coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id')::uuid
           ELSE gen_random_uuid()
         END,
         CASE
           WHEN coalesce(e.value ->> 'measure_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM public.artisanal_strap_measures m
              WHERE m.id::text = lower(e.value ->> 'measure_id'))
           THEN (e.value ->> 'measure_id')::uuid
           ELSE NULL
         END,
         CASE
           WHEN coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND coalesce(e.value ->> 'measure_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM public.artisanal_strap_measures m
              WHERE m.id::text = lower(e.value ->> 'measure_id'))
           THEN 'resolved' ELSE 'review_required'
         END,
         CASE
           WHEN coalesce(e.value ->> 'measure_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM public.artisanal_strap_measures m
              WHERE m.id::text = lower(e.value ->> 'measure_id'))
           THEN 'Identidade UUID e medida canonica ja persistidas na ficha'
           ELSE 'Familia/medida exigem revisao explicita'
         END,
         CASE
           WHEN coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND coalesce(e.value ->> 'measure_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM public.artisanal_strap_measures m
              WHERE m.id::text = lower(e.value ->> 'measure_id'))
           THEN auth.uid() ELSE NULL
         END,
         CASE
           WHEN coalesce(e.value ->> 'technical_strap_line_id', e.value ->> 'id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND coalesce(e.value ->> 'measure_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM public.artisanal_strap_measures m
              WHERE m.id::text = lower(e.value ->> 'measure_id'))
           THEN now() ELSE NULL
         END
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(value, ordinality)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.legacy_artisanal_recipe_map (
    legacy_recipe_id, status, resolution_reason
  )
  SELECT ar.id, 'review_required',
         'Receita legada possui apenas nomes; base e medida nao sao comprovadas por FK'
    FROM public.artisanal_recipes ar
  ON CONFLICT (legacy_recipe_id) DO NOTHING;

  INSERT INTO public.artisanal_strap_migration_review_items (
    migration_run_id, entity_type, legacy_id, status, reason, candidates
  )
  SELECT v_run_id, 'legacy_product', p.id::text, 'review_required',
         'Produto artesanal/grupo de tira sem identidade canonica completa comprovada',
         jsonb_build_object(
           'product_id', p.id,
           'group_id', p.group_id,
           'legacy_color', p.color,
           'quantity_snapshot', p.quantity,
           'reserved_stock_snapshot', p.reserved_stock,
           'active_reservation_ids', coalesce((
             SELECT jsonb_agg(mr.id ORDER BY mr.id)
               FROM public.material_reservations mr
              WHERE mr.product_id = p.id
                AND mr.status IN ('reserved', 'partially_consumed')
           ), '[]'::jsonb)
         )
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
   WHERE (p.is_artisanal OR coalesce(pg.is_artisanal_strap, false))
     AND NOT EXISTS (
       SELECT 1 FROM public.artisanal_strap_variants v
        WHERE v.finished_product_id = p.id
     )
  ON CONFLICT (entity_type, legacy_id) WHERE status = 'review_required'
  DO UPDATE SET migration_run_id = EXCLUDED.migration_run_id,
                reason = EXCLUDED.reason,
                candidates = EXCLUDED.candidates,
                updated_at = now();

  INSERT INTO public.artisanal_strap_migration_review_items (
    migration_run_id, entity_type, legacy_id, status, reason, candidates
  )
  SELECT v_run_id, 'legacy_recipe', ar.id::text, 'review_required',
         'Receita baseada em nomes; nao e permitido inferir familia/medida/base',
         jsonb_build_object(
           'legacy_recipe_id', ar.id,
           'artisanal_product_name', ar.artisanal_product_name,
           'base_product_name', ar.base_product_name,
           'yield_per_meter', ar.yield_per_meter
         )
    FROM public.artisanal_recipes ar
   WHERE NOT EXISTS (
     SELECT 1 FROM public.legacy_artisanal_recipe_map rm
      WHERE rm.legacy_recipe_id = ar.id AND rm.status = 'resolved'
   )
  ON CONFLICT (entity_type, legacy_id) WHERE status = 'review_required'
  DO UPDATE SET migration_run_id = EXCLUDED.migration_run_id,
                reason = EXCLUDED.reason,
                candidates = EXCLUDED.candidates,
                updated_at = now();

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'status', CASE WHEN v_review_count > 0 THEN 'review_required' ELSE 'completed' END,
    'overall_checksum', v_checksum,
    'review_required_count', v_review_count,
    'report', v_report
  );
END;
$$;

-- O gatilho ja existe nos ambientes que receberam 03000; somente sua lista de
-- colunas mudou. Recriacao e idempotente e preserva as linhas existentes.
DROP TRIGGER IF EXISTS trg_guard_artisanal_strap_finished_product
  ON public.products;
CREATE TRIGGER trg_guard_artisanal_strap_finished_product
  BEFORE UPDATE OF
    name, sku, category, group_id, active, min_stock, unit, is_artisanal,
    supplier_id, purchase_unit, purchase_order_unit, conversion_rate,
    purchase_price, min_order_quantity, purchase_multiple,
    material_preparation_days
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_artisanal_strap_finished_product();

-- Helpers internos nao ampliam a superficie RPC. CREATE OR REPLACE preserva as
-- ACLs das RPCs publicas existentes.
REVOKE ALL ON FUNCTION
  public.resolve_artisanal_strap_source_availability(uuid),
  public.assert_artisanal_strap_variant_activation(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.resolve_artisanal_strap_source_availability(uuid),
  public.assert_artisanal_strap_variant_activation(uuid)
TO service_role;

COMMENT ON FUNCTION public.resolve_artisanal_strap_source_availability(uuid) IS
  'Contrato interno Req25/73/118: estado administrativo, consumo de saldo acabado, producao interna e compra pronta sao gates independentes por IDs exatos.';
COMMENT ON FUNCTION public.assert_artisanal_strap_variant_activation(uuid) IS
  'Valida somente a origem configurada para reposicao do piso ao ativar/reativar ou trocar o modo de uma variante ativa.';

-- Assertions executaveis, sem criar fatos de negocio.
DO $$
DECLARE
  v_helper text;
  v_validator text;
  v_status_rpc text;
  v_guard text;
  v_catalog text;
  v_bundle text;
  v_preview text;
  v_dry_run text;
  v_branch text;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_artisanal_strap_source_availability(uuid)'::regprocedure
  ) INTO v_helper;
  IF v_helper !~ 'finished_stock_consumption_allowed'
     OR v_helper !~ 'internal_production_allowed'
     OR v_helper !~ 'buy_ready_purchase_allowed'
     OR v_helper !~ 'variant_administratively_blocked'
     OR v_helper !~ 'canonical_color_discontinued'
     OR v_helper !~ 'commercial_data_inactive_or_invalid' THEN
    RAISE EXCEPTION 'Req25/Req118: disponibilidade por origem nao esta separada do estado administrativo';
  END IF;

  SELECT pg_get_functiondef(
    'public.tg_validate_artisanal_strap_variant()'::regprocedure
  ) INTO v_validator;
  IF v_validator !~ 'assert_artisanal_strap_variant_activation'
     OR v_validator !~ 'OLD.status IS DISTINCT FROM ''active'''
     OR v_validator !~ 'NEW.min_stock_replenishment_mode'
     OR v_validator !~ 'Variante nova exige cor e produto-base oficial ativos' THEN
    RAISE EXCEPTION 'Req25/Req101: gate de fonte nao cobre ativacao, reativacao e troca de origem';
  END IF;

  SELECT pg_get_functiondef(
    'public.set_artisanal_strap_record_status(text,uuid,text,text)'::regprocedure
  ) INTO v_status_rpc;
  FOREACH v_branch IN ARRAY ARRAY[
    split_part(split_part(v_status_rpc, 'WHEN ''canonical_colors'' THEN', 2),
      'WHEN ''color_aliases'' THEN', 1),
    split_part(split_part(v_status_rpc, 'WHEN ''base_material_width_profiles'' THEN', 2),
      'WHEN ''base_material_color_official_products'' THEN', 1),
    split_part(split_part(v_status_rpc, 'WHEN ''base_material_color_official_products'' THEN', 2),
      'WHEN ''artisanal_strap_variants'' THEN', 1),
    split_part(split_part(v_status_rpc, 'WHEN ''artisanal_strap_recipes'' THEN', 2),
      'ELSE', 1)
  ] LOOP
    IF v_branch ~ 'UPDATE public\.artisanal_strap_variants' THEN
      RAISE EXCEPTION 'Req25: indisponibilidade de fonte nao pode suspender administrativamente a variante';
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.tg_guard_artisanal_strap_finished_product()'::regprocedure
  ) INTO v_guard;
  IF v_guard !~ 'NEW\.purchase_price IS DISTINCT FROM OLD\.purchase_price'
     OR v_guard !~ 'NEW\.active IS DISTINCT FROM OLD\.active'
     OR v_guard !~ 'NEW\.supplier_id IS DISTINCT FROM OLD\.supplier_id' THEN
    RAISE EXCEPTION 'Req101: produto acabado ainda possui writer cadastral lateral';
  END IF;

  SELECT pg_get_functiondef(
    'public.list_artisanal_strap_catalog(boolean)'::regprocedure
  ) INTO v_catalog;
  IF v_catalog !~ 'source_availability'
     OR v_catalog ~ '''purchase_order_unit''' THEN
    RAISE EXCEPTION 'Catalogo nao aplica hardening de origem/campo comercial canonico';
  END IF;

  SELECT pg_get_functiondef(
    'public.save_artisanal_strap_catalog_bundle(jsonb,text)'::regprocedure
  ) INTO v_bundle;
  IF v_bundle !~ 'purchase_order_unit.*nao pertence ao contrato canonico'
     OR v_bundle !~ 'administer_strap_operations' THEN
    RAISE EXCEPTION 'Bundle nao aplica hardening de payload/capability';
  END IF;

  SELECT pg_get_functiondef(
    'public.preview_artisanal_strap_catalog_migration()'::regprocedure
  ) INTO v_preview;
  IF v_preview !~ 'quantity_reserved'
     OR v_preview !~ 'quantity_consumed'
     OR v_preview !~ 'affected_products'
     OR v_preview !~ 'unmapped_recipes' THEN
    RAISE EXCEPTION 'Preview legado nao usa colunas/conjuntos conservativos corrigidos';
  END IF;

  SELECT pg_get_functiondef(
    'public.run_artisanal_strap_catalog_migration_dry_run(text)'::regprocedure
  ) INTO v_dry_run;
  IF v_dry_run !~ 'active_reservation_ids'
     OR v_dry_run !~ 'ON CONFLICT DO NOTHING'
     OR v_dry_run !~ 'technical_strap_line_id' THEN
    RAISE EXCEPTION 'Dry-run legado nao preserva identidade/snapshot corrigidos';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.resolve_artisanal_strap_source_availability(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.assert_artisanal_strap_variant_activation(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Helpers internos de disponibilidade ampliaram a superficie RPC';
  END IF;
END;
$$;
