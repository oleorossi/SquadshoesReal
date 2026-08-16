-- =============================================================================
-- TIRAS ARTESANAIS — APLICACAO TRANSACIONAL DO LEGADO (REQS. 122–130)
-- =============================================================================
--
-- O dry-run de 20270101003000 continua sendo a fonte do inventario anterior.
-- Esta migration adiciona a fase deliberadamente separada de resolucao/aplicacao:
--   * nenhum nome, cor textual, saldo maior ou LIMIT 1 prova identidade;
--   * split de saldo exige alocacoes explicitas e conservacao exata;
--   * somente documentos abertos nominalmente atribuidos sao remapeados;
--   * fatos finalizados e movimentos historicos nunca sao reescritos;
--   * o cutover guarda snapshots e so permite rollback antes de fatos posteriores.
--
-- Toda RPC desta migration exige a capability resolve_strap_migration, que no
-- catalogo canonico e exclusiva do Administrador (ou service_role).

-- ----------------------------------------------------------------------------
-- 1. Estado explicito de migracao nos registros operacionais
-- ----------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS strap_migration_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS strap_migration_reason text,
  ADD COLUMN IF NOT EXISTS strap_migration_cutover_id uuid;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_strap_migration_status_ck;
ALTER TABLE public.products
  ADD CONSTRAINT products_strap_migration_status_ck CHECK (
    strap_migration_status IN ('not_applicable','review_required','resolved','migrated','rolled_back')
  );

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS strap_migration_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS strap_migration_reason text,
  ADD COLUMN IF NOT EXISTS strap_migration_cutover_id uuid;

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_strap_migration_status_ck;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_strap_migration_status_ck CHECK (
    strap_migration_status IN ('not_applicable','review_required','resolved','migrated','rolled_back')
  );

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS canonical_strap_recipe_id uuid
    REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS strap_migration_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS strap_migration_reason text,
  ADD COLUMN IF NOT EXISTS strap_migration_previous_status text,
  ADD COLUMN IF NOT EXISTS strap_migration_cutover_id uuid;

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_strap_migration_status_ck;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_strap_migration_status_ck CHECK (
    strap_migration_status IN ('not_applicable','review_required','resolved','migrated','rolled_back')
  );

-- ----------------------------------------------------------------------------
-- 2. Mapas normalizados, manifesto, snapshots e transferencias
-- ----------------------------------------------------------------------------

-- Evidencia nominal e imutavel de que o produto participou do inventario do
-- dry-run. A classificacao estrutural apenas confirma a evidencia; nunca a
-- substitui. O trigger definido abaixo captura esta linha quando o dry-run
-- grava a pendencia legacy_product.
CREATE TABLE public.artisanal_strap_migration_product_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_runs(id) ON DELETE RESTRICT,
  legacy_product_id uuid NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  review_item_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_review_items(id) ON DELETE RESTRICT,
  dry_run_checksum text NOT NULL,
  review_snapshot jsonb NOT NULL,
  product_snapshot jsonb NOT NULL,
  provenance_checksum text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_product_provenance_run_product_uq
    UNIQUE (migration_run_id,legacy_product_id),
  CONSTRAINT artisanal_strap_product_provenance_composite_uq
    UNIQUE (id,migration_run_id,legacy_product_id),
  CONSTRAINT artisanal_strap_product_provenance_checksum_ck CHECK (
    dry_run_checksum ~ '^[0-9a-f]{32}$'
    AND provenance_checksum ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT artisanal_strap_product_provenance_json_ck CHECK (
    jsonb_typeof(review_snapshot)='object'
    AND jsonb_typeof(product_snapshot)='object'
  )
);

CREATE TABLE public.legacy_strap_product_migration_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_product_id uuid NOT NULL UNIQUE
    REFERENCES public.products(id) ON DELETE RESTRICT,
  migration_run_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_runs(id) ON DELETE RESTRICT,
  product_provenance_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'review_required',
  replenishment_mode text,
  allocation_checksum text,
  resolution_reason text NOT NULL,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  applied_cutover_id uuid,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_strap_product_maps_status_ck CHECK (
    status IN ('review_required','resolved','applied','rolled_back')
  ),
  CONSTRAINT legacy_strap_product_maps_mode_ck CHECK (
    replenishment_mode IS NULL OR replenishment_mode IN ('internal','buy_ready')
  ),
  CONSTRAINT legacy_strap_product_maps_checksum_ck CHECK (
    allocation_checksum IS NULL OR allocation_checksum ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT legacy_strap_product_maps_resolution_ck CHECK (
    (status='review_required')
    OR (replenishment_mode IS NOT NULL AND allocation_checksum IS NOT NULL
      AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT legacy_strap_product_maps_provenance_fk
    FOREIGN KEY (product_provenance_id,migration_run_id,legacy_product_id)
    REFERENCES public.artisanal_strap_migration_product_provenance(
      id,migration_run_id,legacy_product_id
    ) ON DELETE RESTRICT
);

CREATE TABLE public.legacy_strap_product_migration_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL
    REFERENCES public.legacy_strap_product_migration_maps(id) ON DELETE CASCADE,
  strap_variant_id uuid NOT NULL
    REFERENCES public.artisanal_strap_variants(id) ON DELETE RESTRICT,
  target_product_id uuid NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(24,9) NOT NULL,
  reserved_stock numeric(24,9) NOT NULL,
  reservation_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  purchase_order_item_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  service_order_item_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_strap_product_allocations_nonnegative_ck CHECK (
    quantity >= 0 AND reserved_stock >= 0
  ),
  CONSTRAINT legacy_strap_product_allocations_variant_uq
    UNIQUE (mapping_id, strap_variant_id),
  CONSTRAINT legacy_strap_product_allocations_target_uq
    UNIQUE (mapping_id, target_product_id)
);

CREATE TABLE public.artisanal_strap_migration_cutovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_runs(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'applying',
  dry_run_checksum text NOT NULL,
  pre_state_checksum text NOT NULL,
  post_state_checksum text,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_manifest jsonb,
  reason text NOT NULL,
  correlation_id uuid NOT NULL UNIQUE,
  applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at timestamptz,
  rolled_back_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_migration_cutovers_status_ck CHECK (
    status IN ('applying','applied','applied_with_review','rolled_back')
  ),
  CONSTRAINT artisanal_strap_migration_cutovers_dry_checksum_ck CHECK (
    dry_run_checksum ~ '^[0-9a-f]{32}$'
  ),
  CONSTRAINT artisanal_strap_migration_cutovers_state_checksum_ck CHECK (
    pre_state_checksum ~ '^[0-9a-f]{64}$'
    AND (post_state_checksum IS NULL OR post_state_checksum ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT artisanal_strap_migration_cutovers_manifest_ck CHECK (
    jsonb_typeof(manifest)='object'
    AND (rollback_manifest IS NULL OR jsonb_typeof(rollback_manifest)='object')
  )
);

CREATE UNIQUE INDEX artisanal_strap_migration_one_active_cutover_uq
  ON public.artisanal_strap_migration_cutovers ((true))
  WHERE status IN ('applying','applied','applied_with_review');

CREATE TABLE public.artisanal_strap_migration_entity_snapshots (
  cutover_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cutover_id, entity_type, entity_id),
  CONSTRAINT artisanal_strap_migration_snapshot_type_ck CHECK (
    entity_type IN ('product','strap_variant','product_mapping','material_reservation',
      'purchase_order_item','service_order','service_order_item','sale_order_item',
      'sale_order_strap_demand')
  ),
  CONSTRAINT artisanal_strap_migration_snapshot_json_ck CHECK (
    jsonb_typeof(before_data)='object'
    AND (after_data IS NULL OR jsonb_typeof(after_data)='object')
  )
);

CREATE TABLE public.legacy_strap_stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutover_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT,
  mapping_id uuid NOT NULL
    REFERENCES public.legacy_strap_product_migration_maps(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL
    REFERENCES public.legacy_strap_product_migration_allocations(id) ON DELETE RESTRICT,
  source_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  target_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(24,9) NOT NULL,
  reserved_stock numeric(24,9) NOT NULL,
  source_previous_quantity numeric(24,9) NOT NULL,
  source_new_quantity numeric(24,9) NOT NULL,
  target_previous_quantity numeric(24,9) NOT NULL,
  target_new_quantity numeric(24,9) NOT NULL,
  source_previous_current_stock numeric(24,9) NOT NULL,
  source_new_current_stock numeric(24,9) NOT NULL,
  target_previous_current_stock numeric(24,9) NOT NULL,
  target_new_current_stock numeric(24,9) NOT NULL,
  out_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  in_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  reversed_out_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversed_in_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_strap_stock_transfers_nonnegative_ck CHECK (
    quantity >= 0 AND reserved_stock >= 0
  ),
  CONSTRAINT legacy_strap_stock_transfers_pair_uq UNIQUE (cutover_id, allocation_id),
  CONSTRAINT legacy_strap_stock_transfers_distinct_ck CHECK (
    source_product_id <> target_product_id
  )
);

-- Cada mapa resolvido depois do cutover e aplicado isoladamente. O registro
-- guarda o contrato idempotente e os snapshots completos do escopo; os
-- snapshots por entidade acima continuam sendo a fonte do rollback global.
CREATE TABLE public.artisanal_strap_migration_incremental_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutover_id uuid NOT NULL
    REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT,
  mapping_id uuid NOT NULL
    REFERENCES public.legacy_strap_product_migration_maps(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'applying',
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  expected_scope_checksum text NOT NULL,
  scope_checksum_before text NOT NULL,
  scope_checksum_after text,
  scope_before jsonb NOT NULL,
  scope_after jsonb,
  result jsonb,
  reason text NOT NULL,
  correlation_id uuid NOT NULL,
  applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at timestamptz,
  rolled_back_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_migration_incremental_status_ck CHECK (
    status IN ('applying','applied','rolled_back')
  ),
  CONSTRAINT artisanal_strap_migration_incremental_key_ck CHECK (
    nullif(btrim(idempotency_key),'') IS NOT NULL
  ),
  CONSTRAINT artisanal_strap_migration_incremental_hashes_ck CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
    AND expected_scope_checksum ~ '^[0-9a-f]{64}$'
    AND scope_checksum_before ~ '^[0-9a-f]{64}$'
    AND (scope_checksum_after IS NULL OR scope_checksum_after ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT artisanal_strap_migration_incremental_json_ck CHECK (
    jsonb_typeof(scope_before)='object'
    AND (scope_after IS NULL OR jsonb_typeof(scope_after)='object')
    AND (result IS NULL OR jsonb_typeof(result)='object')
  ),
  CONSTRAINT artisanal_strap_migration_incremental_applied_ck CHECK (
    status='applying'
    OR (scope_checksum_after IS NOT NULL AND scope_after IS NOT NULL
      AND result IS NOT NULL AND applied_at IS NOT NULL)
  ),
  CONSTRAINT artisanal_strap_migration_incremental_idempotency_uq
    UNIQUE (cutover_id,idempotency_key),
  CONSTRAINT artisanal_strap_migration_incremental_mapping_uq
    UNIQUE (cutover_id,mapping_id)
);

ALTER TABLE public.legacy_strap_product_migration_maps
  ADD CONSTRAINT legacy_strap_product_maps_cutover_fk
  FOREIGN KEY (applied_cutover_id)
  REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT;

ALTER TABLE public.products
  ADD CONSTRAINT products_strap_migration_cutover_fk
  FOREIGN KEY (strap_migration_cutover_id)
  REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_strap_migration_cutover_fk
  FOREIGN KEY (strap_migration_cutover_id)
  REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_strap_migration_cutover_fk
  FOREIGN KEY (strap_migration_cutover_id)
  REFERENCES public.artisanal_strap_migration_cutovers(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 3. Helpers fechados: status aberto, auditoria, snapshot e checksum
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_open_legacy_strap_sale_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_strap_catalog_text(coalesce(p_status,'')) NOT IN (
    'cancelado','cancelada','cancelled','faturado','faturada','finalizado',
    'finalizada','concluido','concluida','completed','delivered','entregue'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_open_legacy_strap_purchase_order_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_strap_catalog_text(coalesce(p_status,'')) NOT IN (
    'cancelado','cancelada','cancelled','received','recebido','recebida',
    'completed','concluido','concluida','closed','fechado','fechada'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_open_legacy_strap_service_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_strap_catalog_text(coalesce(p_status,'')) NOT IN (
    'cancelado','cancelada','cancelled','entregue','delivered','completed',
    'concluido','concluida','finalizado','finalizada','closed','fechado','fechada'
  );
$$;

-- Captura a prova produzida pelo dry-run. Uma flag is_artisanal ou um grupo de
-- tira sem esta pendencia nominal nao e suficiente para autorizar migracao.
CREATE OR REPLACE FUNCTION public.capture_artisanal_strap_product_provenance(
  p_review_item_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_run public.artisanal_strap_migration_runs%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_product_selection record;
  v_existing public.artisanal_strap_migration_product_provenance%ROWTYPE;
  v_product_id uuid;
  v_group_is_strap boolean;
  v_review_snapshot jsonb;
  v_product_snapshot jsonb;
  v_checksum text;
BEGIN
  SELECT * INTO v_review
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.id=p_review_item_id FOR SHARE;
  IF NOT FOUND OR v_review.entity_type<>'legacy_product'
     OR v_review.migration_run_id IS NULL
     OR v_review.status NOT IN ('review_required','resolved') THEN
    RAISE EXCEPTION 'Pendencia nominal legacy_product de dry-run obrigatoria';
  END IF;
  IF v_review.legacy_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_review.candidates->>'product_id' IS DISTINCT FROM lower(v_review.legacy_id)
     OR jsonb_typeof(v_review.candidates->'quantity_snapshot') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_review.candidates->'reserved_stock_snapshot') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Pendencia legacy_product nao contem snapshot nominal valido';
  END IF;
  v_product_id:=v_review.legacy_id::uuid;
  SELECT * INTO v_run FROM public.artisanal_strap_migration_runs r
   WHERE r.id=v_review.migration_run_id;
  IF NOT FOUND OR v_run.status='failed'
     OR v_run.overall_checksum !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Dry-run de proveniencia inexistente/invalido';
  END IF;
  SELECT to_jsonb(p) AS product_json,
         coalesce(pg.is_artisanal_strap,false) AS group_is_strap
    INTO v_product_selection
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
   WHERE p.id=v_product_id FOR SHARE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto nao possui classificacao estrutural de tira artesanal';
  END IF;
  v_product:=jsonb_populate_record(
    NULL::public.products,v_product_selection.product_json);
  v_group_is_strap:=v_product_selection.group_is_strap;
  IF NOT (coalesce(v_product.is_artisanal,false) OR v_group_is_strap) THEN
    RAISE EXCEPTION 'Produto nao possui classificacao estrutural de tira artesanal';
  END IF;
  IF v_review.candidates->>'group_id' IS DISTINCT FROM v_product.group_id::text THEN
    RAISE EXCEPTION 'Grupo atual diverge do candidato nominal do dry-run';
  END IF;

  v_review_snapshot:=jsonb_build_object(
    'review_item_id',v_review.id,
    'migration_run_id',v_review.migration_run_id,
    'entity_type',v_review.entity_type,
    'legacy_id',v_review.legacy_id,
    'status_at_capture',v_review.status,
    'reason',v_review.reason,
    'candidates',v_review.candidates,
    'review_created_at',v_review.created_at
  );
  v_product_snapshot:=to_jsonb(v_product)||jsonb_build_object(
    'group_is_artisanal_strap',v_group_is_strap
  );
  v_checksum:=public.strap_payload_hash(jsonb_build_object(
    'migration_run_id',v_run.id,
    'dry_run_checksum',v_run.overall_checksum,
    'review_snapshot',v_review_snapshot,
    'product_snapshot',v_product_snapshot
  ));
  INSERT INTO public.artisanal_strap_migration_product_provenance(
    migration_run_id,legacy_product_id,review_item_id,dry_run_checksum,
    review_snapshot,product_snapshot,provenance_checksum
  ) VALUES (
    v_run.id,v_product.id,v_review.id,v_run.overall_checksum,
    v_review_snapshot,v_product_snapshot,v_checksum
  )
  ON CONFLICT (migration_run_id,legacy_product_id) DO NOTHING;

  SELECT * INTO v_existing
    FROM public.artisanal_strap_migration_product_provenance p
   WHERE p.migration_run_id=v_run.id AND p.legacy_product_id=v_product.id;
  IF NOT FOUND OR v_existing.provenance_checksum IS DISTINCT FROM v_checksum
     OR v_existing.review_item_id IS DISTINCT FROM v_review.id THEN
    RAISE EXCEPTION 'Proveniencia do produto ja foi congelada com payload divergente';
  END IF;
  RETURN v_existing.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_capture_artisanal_strap_product_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entity_type='legacy_product' AND NEW.migration_run_id IS NOT NULL THEN
    PERFORM public.capture_artisanal_strap_product_provenance(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- Um novo dry-run nao pode reaproveitar a linha parcial-unica de uma review
-- pertencente ao cutover ativo. O UPSERT de 03400 continua livre antes do
-- cutover, mas falha de forma atomica se tentasse reparentear a prova nominal.
CREATE OR REPLACE FUNCTION public.tg_guard_active_strap_migration_review_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status='review_required'
     AND EXISTS (
       SELECT 1
         FROM public.artisanal_strap_migration_cutovers c
        WHERE c.migration_run_id=OLD.migration_run_id
          AND c.status IN ('applying','applied','applied_with_review')
     ) THEN
    IF NEW.migration_run_id IS DISTINCT FROM OLD.migration_run_id THEN
      RAISE EXCEPTION 'Dry-run bloqueado: pendencia pertence ao cutover ativo %/%',
        OLD.entity_type,OLD.legacy_id
        USING ERRCODE='55000',
          HINT='Conclua as resolucoes incrementais ou reverta o cutover antes de executar outro dry-run.';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.review_item_id=OLD.id
    ) AND (
      NEW.entity_type IS DISTINCT FROM OLD.entity_type
      OR NEW.legacy_id IS DISTINCT FROM OLD.legacy_id
      OR NEW.reason IS DISTINCT FROM OLD.reason
      OR NEW.candidates IS DISTINCT FROM OLD.candidates
    ) THEN
      RAISE EXCEPTION 'Proveniencia nominal do produto esta congelada pelo cutover ativo'
        USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_strap_migration_review_provenance
  ON public.artisanal_strap_migration_review_items;
CREATE TRIGGER trg_guard_active_strap_migration_review_provenance
BEFORE UPDATE OF migration_run_id,entity_type,legacy_id,reason,candidates
ON public.artisanal_strap_migration_review_items
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_active_strap_migration_review_provenance();

CREATE OR REPLACE FUNCTION public.tg_block_strap_migration_dry_run_during_cutover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_migration_cutovers c
     WHERE c.status IN ('applying','applied','applied_with_review')
  ) THEN
    RAISE EXCEPTION 'Novo dry-run bloqueado enquanto existe cutover ativo'
      USING ERRCODE='55000',
        HINT='Conclua as resolucoes incrementais ou reverta o cutover atual.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_strap_migration_dry_run_during_cutover
  ON public.artisanal_strap_migration_runs;
CREATE TRIGGER trg_block_strap_migration_dry_run_during_cutover
BEFORE INSERT ON public.artisanal_strap_migration_runs
FOR EACH ROW EXECUTE FUNCTION
  public.tg_block_strap_migration_dry_run_during_cutover();

-- 03050 contem o inventario read-only completo. Mantemos aquele corpo como
-- helper interno e fazemos desta migration (a ultima do conjunto) o portao
-- transacional final da RPC publica.
DO $$
BEGIN
  IF to_regprocedure(
       'public.run_artisanal_strap_catalog_migration_dry_run(text)') IS NOT NULL
     AND to_regprocedure(
       'public.run_artisanal_strap_catalog_migration_dry_run_unfenced_202701(text)') IS NULL THEN
    ALTER FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(text)
      RENAME TO run_artisanal_strap_catalog_migration_dry_run_unfenced_202701;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-legacy-cutover',0));
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_migration_cutovers c
     WHERE c.status IN ('applying','applied','applied_with_review')
  ) THEN
    RAISE EXCEPTION 'Novo dry-run bloqueado enquanto existe cutover ativo'
      USING ERRCODE='55000',
        HINT='Conclua as resolucoes incrementais ou reverta o cutover atual.';
  END IF;
  RETURN public.run_artisanal_strap_catalog_migration_dry_run_unfenced_202701(
    p_note);
END;
$$;

REVOKE ALL ON FUNCTION
  public.run_artisanal_strap_catalog_migration_dry_run_unfenced_202701(text)
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION
  public.run_artisanal_strap_catalog_migration_dry_run(text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.run_artisanal_strap_catalog_migration_dry_run(text)
TO authenticated;

DROP TRIGGER IF EXISTS trg_capture_artisanal_strap_product_provenance
  ON public.artisanal_strap_migration_review_items;
CREATE TRIGGER trg_capture_artisanal_strap_product_provenance
AFTER INSERT OR UPDATE OF migration_run_id,entity_type,legacy_id,reason,candidates
ON public.artisanal_strap_migration_review_items
FOR EACH ROW EXECUTE FUNCTION public.tg_capture_artisanal_strap_product_provenance();

-- Backfill conservador para dry-runs executados entre 030 e 033. Linhas cuja
-- classificacao foi retirada ficam sem prova e, portanto, bloqueadas/diagnosticadas.
DO $$
DECLARE v_review record;
BEGIN
  FOR v_review IN
    SELECT ri.id
      FROM public.artisanal_strap_migration_review_items ri
      JOIN public.products p ON p.id::text=ri.legacy_id
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE ri.entity_type='legacy_product' AND ri.migration_run_id IS NOT NULL
       AND ri.status IN ('review_required','resolved')
       AND ri.candidates->>'product_id'=p.id::text
       AND ri.candidates->>'group_id' IS NOT DISTINCT FROM p.group_id::text
       AND jsonb_typeof(ri.candidates->'quantity_snapshot')='number'
       AND jsonb_typeof(ri.candidates->'reserved_stock_snapshot')='number'
       AND (coalesce(p.is_artisanal,false) OR coalesce(pg.is_artisanal_strap,false))
     ORDER BY ri.id
  LOOP
    PERFORM public.capture_artisanal_strap_product_provenance(v_review.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_artisanal_strap_migration_event(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_correlation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id
  ) VALUES (
    p_entity_type,p_entity_id,p_action,p_before,p_after,
    public.require_strap_change_reason(p_reason),p_correlation_id,auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_artisanal_strap_migration_snapshot(
  p_cutover_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.artisanal_strap_migration_entity_snapshots(
    cutover_id,entity_type,entity_id,before_data
  ) VALUES (p_cutover_id,p_entity_type,p_entity_id,p_before)
  ON CONFLICT (cutover_id,entity_type,entity_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_artisanal_strap_migration_snapshot(
  p_cutover_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.artisanal_strap_migration_entity_snapshots
     SET after_data=p_after
   WHERE cutover_id=p_cutover_id
     AND entity_type=p_entity_type
     AND entity_id=p_entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snapshot ausente: %/%',p_entity_type,p_entity_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.artisanal_strap_legacy_state_checksum()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH affected_products AS (
    SELECT p.id
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.is_artisanal
        OR coalesce(pg.is_artisanal_strap,false)
        OR EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
                    WHERE v.finished_product_id=p.id)
        OR EXISTS (SELECT 1 FROM public.legacy_strap_product_migration_maps m
                    WHERE m.legacy_product_id=p.id)
        OR EXISTS (SELECT 1 FROM public.legacy_strap_product_migration_allocations a
                    WHERE a.target_product_id=p.id)
  ), state AS (
    SELECT jsonb_build_object(
      'products',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          p.id,p.quantity,p.current_stock,p.reserved_stock,p.strap_migration_status,
          p.strap_migration_reason,p.strap_migration_cutover_id
        ) ORDER BY p.id)
          FROM public.products p JOIN affected_products ap ON ap.id=p.id
      ),'[]'::jsonb),
      'variants',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          v.id,v.finished_product_id,v.status,v.review_reason,
          v.min_stock_replenishment_mode
        ) ORDER BY v.id)
          FROM public.artisanal_strap_variants v
         WHERE v.finished_product_id IN (SELECT id FROM affected_products)
      ),'[]'::jsonb),
      'product_maps',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          m.id,m.legacy_product_id,m.migration_run_id,m.product_provenance_id,
          m.status,m.replenishment_mode,m.allocation_checksum,m.applied_cutover_id
        ) ORDER BY m.id)
          FROM public.legacy_strap_product_migration_maps m
      ),'[]'::jsonb),
      'product_provenance',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          pp.id,pp.migration_run_id,pp.legacy_product_id,pp.review_item_id,
          pp.dry_run_checksum,pp.provenance_checksum,pp.captured_at
        ) ORDER BY pp.id)
          FROM public.artisanal_strap_migration_product_provenance pp
      ),'[]'::jsonb),
      'reservations',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          r.id,r.product_id,r.quantity_reserved,r.quantity_consumed,r.status,
          r.strap_variant_id,r.finished_product_id
        ) ORDER BY r.id)
          FROM public.material_reservations r
         WHERE r.product_id IN (SELECT id FROM affected_products)
      ),'[]'::jsonb),
      'stock_movements',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          sm.id,sm.product_id,sm.movement_type,sm.quantity,
          sm.previous_stock,sm.new_stock,sm.movement_reason,
          sm.strap_variant_id,sm.correlation_id,sm.created_at
        ) ORDER BY sm.id)
          FROM public.stock_movements sm
         WHERE sm.product_id IN (SELECT id FROM affected_products)
      ),'[]'::jsonb),
      'purchase_items',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          i.id,i.product_id,i.quantity,i.received_quantity,i.strap_variant_id,
          po.status,po.snapshot_locked_at
        ) ORDER BY i.id)
          FROM public.purchase_order_items i
          JOIN public.purchase_orders po ON po.id=i.purchase_order_id
         WHERE i.product_id IN (SELECT id FROM affected_products)
      ),'[]'::jsonb),
      'service_orders',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          so.id,so.artisanal_recipe_id,so.canonical_strap_recipe_id,so.status,
          so.strap_migration_status,so.strap_migration_cutover_id
        ) ORDER BY so.id)
          FROM public.service_orders so
         WHERE so.artisanal_recipe_id IS NOT NULL
            OR so.canonical_strap_recipe_id IS NOT NULL
      ),'[]'::jsonb),
      'service_items',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          i.id,i.finished_product_id,i.strap_variant_id,i.strap_recipe_id,
          i.line_status,i.suspended_from_status,i.suspension_reason
        ) ORDER BY i.id)
          FROM public.service_order_items i
         WHERE i.finished_product_id IN (SELECT id FROM affected_products)
            OR i.strap_variant_id IS NOT NULL
      ),'[]'::jsonb),
      'sale_items',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          i.id,md5(coalesce(i.strap_colors,'[]'::jsonb)::text),
          md5(coalesce(i.strap_sourcing,'{}'::jsonb)::text),
          i.strap_migration_status,i.strap_migration_cutover_id,so.status
        ) ORDER BY i.id)
          FROM public.sale_order_items i
          JOIN public.sale_orders so ON so.id=i.sale_order_id
         WHERE jsonb_typeof(i.strap_colors)='array'
           AND jsonb_array_length(i.strap_colors)>0
      ),'[]'::jsonb),
      'demands',coalesce((
        SELECT jsonb_agg(jsonb_build_array(
          d.id,d.sale_order_item_id,d.strap_variant_id,d.finished_product_id,
          d.status,d.is_current,d.fulfilled_m,d.cancelled_m
        ) ORDER BY d.id)
          FROM public.sale_order_strap_demands d
         WHERE d.strap_variant_id IN (
           SELECT v.id FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id IN (SELECT id FROM affected_products)
         )
      ),'[]'::jsonb)
    ) AS payload
  )
  SELECT public.strap_payload_hash(payload) FROM state;
$$;

-- ----------------------------------------------------------------------------
-- 4. Resolucao de linha tecnica: grava a ficha e propaga somente snapshot exato
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_technical_strap_line_migration(
  p_map_id uuid,
  p_measure_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.technical_strap_line_identity_map%ROWTYPE;
  v_measure public.artisanal_strap_measures%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_correlation_id uuid:=gen_random_uuid();
  v_lines jsonb;
  v_line jsonb;
  v_enriched jsonb;
  v_item record;
  v_item_line jsonb;
  v_item_lines jsonb;
  v_before jsonb;
  v_after jsonb;
  v_all_resolved boolean;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  SELECT * INTO v_map
    FROM public.technical_strap_line_identity_map
   WHERE id=p_map_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha tecnica mapeada inexistente'; END IF;

  SELECT * INTO v_measure
    FROM public.artisanal_strap_measures
   WHERE id=p_measure_id AND active;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_types t
     WHERE t.id=v_measure.strap_type_id AND t.active
  ) THEN
    RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets
   WHERE id=v_map.technical_sheet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ficha tecnica do mapa inexistente'; END IF;
  v_lines:=CASE WHEN jsonb_typeof(v_sheet.strap_colors)='array'
    THEN v_sheet.strap_colors ELSE '[]'::jsonb END;
  v_line:=v_lines->v_map.legacy_ordinal;

  -- O caminho/ordinal so pode ser reaproveitado se o conteudo original ainda
  -- for o mesmo ou se a propria identidade estavel ja estiver persistida.
  IF v_line IS NULL OR (
    md5(v_line::text) IS DISTINCT FROM v_map.content_hash
    AND nullif(v_line->>'technical_strap_line_id','')
      IS DISTINCT FROM v_map.technical_strap_line_id::text
  ) THEN
    -- Nunca devolve UUID como se a vinculacao tivesse sido aplicada. Reusar o
    -- ordinal depois de drift seria inferencia; o Administrador deve congelar
    -- uma nova proveniencia em outro dry-run (quando nao houver cutover ativo).
    RAISE EXCEPTION 'Conteudo/caminho da linha tecnica mudou desde o dry-run; vinculacao nao aplicada'
      USING ERRCODE='40001',
        DETAIL=jsonb_build_object(
          'code','technical_line_content_mismatch',
          'map_id',v_map.id,
          'technical_sheet_id',v_map.technical_sheet_id,
          'legacy_ordinal',v_map.legacy_ordinal,
          'expected_hash',v_map.content_hash,
          'current_hash',CASE WHEN v_line IS NULL THEN NULL ELSE md5(v_line::text) END,
          'technical_strap_line_id',v_map.technical_strap_line_id
        )::text,
        HINT='Reverta/conclua o cutover ativo e execute novo dry-run para recapturar o conteudo atual; nenhum mapa foi alterado.';
  END IF;

  v_enriched:=v_line||jsonb_build_object(
    'technical_strap_line_id',v_map.technical_strap_line_id,
    'measure_id',p_measure_id,
    'strap_type_id',v_measure.strap_type_id
  );
  v_before:=jsonb_build_object('map',to_jsonb(v_map),'technical_line',v_line);
  v_lines:=jsonb_set(v_lines,ARRAY[v_map.legacy_ordinal::text],v_enriched,false);

  PERFORM set_config('app.strap_change_reason',v_reason,true);
  UPDATE public.technical_sheets
     SET strap_colors=v_lines,updated_at=now()
   WHERE id=v_sheet.id;
  UPDATE public.technical_strap_line_identity_map
     SET measure_id=p_measure_id,status='resolved',resolution_reason=v_reason,
         resolved_by=auth.uid(),resolved_at=now()
   WHERE id=v_map.id;
  -- Fecha somente a pendencia original desta identidade. Pendencias de
  -- divergencia de PV/ficha usam entity_type proprio e permanecem abertas.
  UPDATE public.artisanal_strap_migration_review_items
     SET status='resolved',
         resolution=jsonb_build_object('map_id',v_map.id,
           'technical_strap_line_id',v_map.technical_strap_line_id,
           'measure_id',p_measure_id,'reason',v_reason),
         resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE status='review_required'
     AND entity_type IN ('technical_line','legacy_technical_line','technical_strap_line')
     AND legacy_id IN (v_map.id::text,v_map.technical_strap_line_id::text);

  -- sale_order_items.reference_id aponta para technical_sheets.id. Somente PV
  -- aberto, mesmo ordinal e mesmo hash/UUID recebe a identidade nova.
  FOR v_item IN
    SELECT i.*,so.status AS sale_order_status
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id=i.sale_order_id
     WHERE i.reference_id=v_map.technical_sheet_id
       AND public.is_open_legacy_strap_sale_order_status(so.status)
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    v_item_lines:=CASE WHEN jsonb_typeof(v_item.strap_colors)='array'
      THEN v_item.strap_colors ELSE '[]'::jsonb END;
    v_item_line:=v_item_lines->v_map.legacy_ordinal;
    IF v_item_line IS NULL OR (
      md5(v_item_line::text) IS DISTINCT FROM v_map.content_hash
      AND nullif(v_item_line->>'technical_strap_line_id','')
        IS DISTINCT FROM v_map.technical_strap_line_id::text
    ) THEN
      v_before:=to_jsonb(v_item);
      UPDATE public.sale_order_items
         SET strap_migration_status='review_required',
             strap_migration_reason='Linha de tira do PV divergiu da ficha/dry-run; escolha explicita obrigatoria'
       WHERE id=v_item.id;
      INSERT INTO public.artisanal_strap_migration_review_items(
        entity_type,legacy_id,status,reason,candidates
      ) VALUES (
        'open_sale_order_item_technical_line',
        v_item.id::text||':'||v_map.technical_strap_line_id::text,
        'review_required','Snapshot do PV nao casa exatamente com ficha/caminho/hash',
        jsonb_build_object('sale_order_id',v_item.sale_order_id,
          'sale_order_item_id',v_item.id,'map_id',v_map.id,
          'technical_strap_line_id',v_map.technical_strap_line_id,
          'legacy_ordinal',v_map.legacy_ordinal)
      )
      ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
      DO UPDATE SET reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
      PERFORM public.log_artisanal_strap_migration_event(
        'sale_order_item',v_item.id,'update',v_before,
        (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id=v_item.id),
        v_reason,v_correlation_id);
      CONTINUE;
    END IF;

    v_before:=to_jsonb(v_item);
    v_item_lines:=jsonb_set(
      v_item_lines,ARRAY[v_map.legacy_ordinal::text],
      v_item_line||jsonb_build_object(
        'technical_strap_line_id',v_map.technical_strap_line_id,
        'measure_id',p_measure_id,
        'strap_type_id',v_measure.strap_type_id
      ),false
    );
    SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_item_lines) e
       WHERE nullif(e->>'technical_strap_line_id','') IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.technical_strap_line_identity_map m
             WHERE m.technical_strap_line_id::text=e->>'technical_strap_line_id'
               AND m.status='resolved'
          )
    ) INTO v_all_resolved;
    UPDATE public.sale_order_items
       SET strap_colors=v_item_lines,
           strap_migration_status=CASE WHEN v_all_resolved THEN 'resolved'
             ELSE strap_migration_status END,
           strap_migration_reason=CASE WHEN v_all_resolved
             THEN 'Todas as linhas tecnicas possuem UUID canonico persistido'
             ELSE strap_migration_reason END
     WHERE id=v_item.id;
    PERFORM public.log_artisanal_strap_migration_event(
      'sale_order_item',v_item.id,'update',v_before,
      (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id=v_item.id),
      v_reason,v_correlation_id);
  END LOOP;

  v_after:=jsonb_build_object(
    'map',(SELECT to_jsonb(m) FROM public.technical_strap_line_identity_map m WHERE m.id=v_map.id),
    'technical_line',v_enriched
  );
  PERFORM public.log_artisanal_strap_migration_event(
    'technical_strap_line',v_map.id,'update',
    jsonb_build_object('map',to_jsonb(v_map),'technical_line',v_line),
    v_after,v_reason,v_correlation_id);
  RETURN v_map.technical_strap_line_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Receita legada: preserva FK e adiciona ponte canonica sem reescrever fato
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_legacy_artisanal_recipe_migration(
  p_legacy_recipe_id uuid,
  p_canonical_recipe_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map_before jsonb;
  v_map public.legacy_artisanal_recipe_map%ROWTYPE;
  v_map_exists boolean:=false;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_order record;
  v_item record;
  v_before jsonb;
  v_item_before jsonb;
  v_open_order_review_id uuid;
  v_order_cutover_id uuid;
  v_order_snapshot_before jsonb;
  v_order_snapshot_after jsonb;
  v_item_snapshot_before jsonb;
  v_item_snapshot_after jsonb;
  v_item_compatible boolean;
  v_item_can_restore boolean;
  v_item_mismatch_review_id uuid;
  v_order_has_unresolved_line boolean;
  v_order_technical_suspension boolean;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_correlation_id uuid:=gen_random_uuid();
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-legacy-cutover',0));
  PERFORM 1 FROM public.artisanal_recipes
   WHERE id=p_legacy_recipe_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receita legada inexistente';
  END IF;
  SELECT * INTO v_recipe FROM public.artisanal_strap_recipes
   WHERE id=p_canonical_recipe_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receita canonica inexistente'; END IF;

  SELECT * INTO v_map
    FROM public.legacy_artisanal_recipe_map m
   WHERE m.legacy_recipe_id=p_legacy_recipe_id FOR UPDATE;
  v_map_exists:=FOUND;
  v_map_before:=CASE WHEN v_map_exists THEN to_jsonb(v_map) ELSE NULL END;

  -- A primeira resolucao congela L->C. Repetir exatamente L->C e replay
  -- idempotente; trocar C reinterpretaria OS/snapshots historicos e nunca e
  -- uma correcao in-place (crie uma nova versao prospectiva da receita).
  IF v_map_exists AND v_map.canonical_recipe_id IS NOT NULL THEN
    IF v_map.canonical_recipe_id=p_canonical_recipe_id
       AND v_map.status='resolved' THEN
      RETURN to_jsonb(v_map)||jsonb_build_object(
        'replayed',true,'immutable_mapping',true,
        'correlation_id',v_correlation_id);
    END IF;
    RAISE EXCEPTION 'Mapa de receita legada e imutavel: % ja aponta para %',
      p_legacy_recipe_id,v_map.canonical_recipe_id
      USING ERRCODE='55000',
        DETAIL=jsonb_build_object(
          'code','legacy_recipe_mapping_immutable',
          'legacy_recipe_id',p_legacy_recipe_id,
          'existing_canonical_recipe_id',v_map.canonical_recipe_id,
          'requested_canonical_recipe_id',p_canonical_recipe_id,
          'mapping_status',v_map.status
        )::text,
        HINT='Crie uma nova versao canonica para uso prospectivo; documentos e mapa existentes nao sao reescritos.';
  END IF;

  -- Ordem deterministica compartilhada com apply/rollback: linha -> cabecalho.
  -- Depois destes locks, toda validacao abaixo e repetida sobre o estado que
  -- sera efetivamente gravado.
  PERFORM 1
    FROM public.service_order_items i
    JOIN public.service_orders so ON so.id=i.service_order_id
   WHERE so.artisanal_recipe_id=p_legacy_recipe_id
   ORDER BY i.id FOR UPDATE OF i;
  PERFORM 1 FROM public.service_orders so
   WHERE so.artisanal_recipe_id=p_legacy_recipe_id
   ORDER BY so.id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.service_orders so
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND so.canonical_strap_recipe_id IS NOT NULL
       AND so.canonical_strap_recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.service_order_items i
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND i.strap_recipe_id IS NOT NULL
       AND i.strap_recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.artisanal_strap_migration_entity_snapshots s
     WHERE s.entity_type='service_order'
       AND s.entity_id IN (
         SELECT so.id FROM public.service_orders so
          WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       )
       AND (
         (nullif(s.before_data->>'canonical_strap_recipe_id','') IS NOT NULL
           AND (s.before_data->>'canonical_strap_recipe_id')::uuid
             <>p_canonical_recipe_id)
         OR (nullif(s.after_data->>'canonical_strap_recipe_id','') IS NOT NULL
           AND (s.after_data->>'canonical_strap_recipe_id')::uuid
             <>p_canonical_recipe_id)
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.artisanal_strap_migration_entity_snapshots s
     WHERE s.entity_type='service_order_item'
       AND s.entity_id IN (
         SELECT i.id
           FROM public.service_order_items i
           JOIN public.service_orders so ON so.id=i.service_order_id
          WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       )
       AND (
         (nullif(s.before_data->>'strap_recipe_id','') IS NOT NULL
           AND (s.before_data->>'strap_recipe_id')::uuid<>p_canonical_recipe_id)
         OR (nullif(s.after_data->>'strap_recipe_id','') IS NOT NULL
           AND (s.after_data->>'strap_recipe_id')::uuid<>p_canonical_recipe_id)
       )
  ) OR EXISTS (
    SELECT 1
      FROM public.strap_production_batch_items bi
      JOIN public.service_order_items i ON i.strap_batch_item_id=bi.id
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND bi.recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.strap_production_receipts pr
      JOIN public.service_order_items i
        ON i.id=pr.service_order_item_id OR i.strap_batch_item_id=pr.batch_item_id
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND pr.recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
      JOIN public.service_order_items i ON i.sale_order_strap_demand_id=d.id
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND d.recipe_id IS NOT NULL AND d.recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.stock_movements sm
      JOIN public.service_order_items i
        ON i.id=sm.service_order_item_id OR i.strap_batch_item_id=sm.strap_batch_item_id
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND sm.strap_recipe_id IS NOT NULL
       AND sm.strap_recipe_id<>p_canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.artisanal_strap_operational_audit_log a
     WHERE (
       a.entity_type='service_order'
       AND a.entity_id IN (
         SELECT so.id FROM public.service_orders so
          WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       )
       AND (
         (coalesce(a.before_data->>'canonical_strap_recipe_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND (a.before_data->>'canonical_strap_recipe_id')::uuid
             <>p_canonical_recipe_id)
         OR (coalesce(a.after_data->>'canonical_strap_recipe_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND (a.after_data->>'canonical_strap_recipe_id')::uuid
             <>p_canonical_recipe_id)
       )
     ) OR (
       a.entity_type='service_order_item'
       AND a.entity_id IN (
         SELECT i.id
           FROM public.service_order_items i
           JOIN public.service_orders so ON so.id=i.service_order_id
          WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       )
       AND (
         (coalesce(a.before_data->>'strap_recipe_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND (a.before_data->>'strap_recipe_id')::uuid<>p_canonical_recipe_id)
         OR (coalesce(a.after_data->>'strap_recipe_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND (a.after_data->>'strap_recipe_id')::uuid<>p_canonical_recipe_id)
       )
     )
  ) THEN
    RAISE EXCEPTION 'Receita legada possui documento/snapshot/fato com referencia canonica diferente; re-resolucao bloqueada'
      USING ERRCODE='55000',
        DETAIL=jsonb_build_object(
          'code','legacy_recipe_fact_conflict',
          'legacy_recipe_id',p_legacy_recipe_id,
          'requested_canonical_recipe_id',p_canonical_recipe_id,
          'conflicting_order_ids',coalesce((
            SELECT jsonb_agg(so.id ORDER BY so.id)
              FROM public.service_orders so
             WHERE so.artisanal_recipe_id=p_legacy_recipe_id
               AND so.canonical_strap_recipe_id IS NOT NULL
               AND so.canonical_strap_recipe_id<>p_canonical_recipe_id
          ),'[]'::jsonb),
          'conflicting_item_ids',coalesce((
            SELECT jsonb_agg(i.id ORDER BY i.id)
              FROM public.service_order_items i
              JOIN public.service_orders so ON so.id=i.service_order_id
             WHERE so.artisanal_recipe_id=p_legacy_recipe_id
               AND i.strap_recipe_id IS NOT NULL
               AND i.strap_recipe_id<>p_canonical_recipe_id
          ),'[]'::jsonb)
        )::text,
        HINT='Preserve o historico e cadastre uma nova versao prospectiva.';
  END IF;

  PERFORM set_config('app.strap_change_reason',v_reason,true);
  IF v_map_exists THEN
    UPDATE public.legacy_artisanal_recipe_map SET
      canonical_recipe_id=p_canonical_recipe_id,status='resolved',
      resolution_reason=v_reason,resolved_by=auth.uid(),resolved_at=now(),
      updated_at=now()
     WHERE legacy_recipe_id=p_legacy_recipe_id
       AND canonical_recipe_id IS NULL
       AND status IN ('review_required','rejected')
    RETURNING * INTO v_map;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mapa de receita mudou durante a resolucao'
        USING ERRCODE='40001';
    END IF;
  ELSE
    INSERT INTO public.legacy_artisanal_recipe_map(
      legacy_recipe_id,canonical_recipe_id,status,resolution_reason,
      resolved_by,resolved_at
    ) VALUES (
      p_legacy_recipe_id,p_canonical_recipe_id,'resolved',v_reason,auth.uid(),now()
    ) RETURNING * INTO v_map;
  END IF;
  UPDATE public.artisanal_strap_migration_review_items
     SET status='resolved',
         resolution=jsonb_build_object('legacy_recipe_id',p_legacy_recipe_id,
           'canonical_recipe_id',p_canonical_recipe_id,'reason',v_reason),
         resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE entity_type='legacy_recipe'
     AND legacy_id=p_legacy_recipe_id::text
     AND status='review_required';

  -- Se a OS ficou terminal enquanto aguardava a escolha, a ponte vive somente
  -- no mapa. O documento e suas linhas permanecem byte-a-byte historicos.
  UPDATE public.artisanal_strap_migration_review_items ri SET
    status='resolved',
    resolution=jsonb_build_object(
      'legacy_recipe_id',p_legacy_recipe_id,
      'canonical_recipe_id',p_canonical_recipe_id,
      'service_order_id',ri.legacy_id,
      'historical_document_preserved',true,
      'reason',v_reason,
      'correlation_id',v_correlation_id),
    resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE ri.entity_type='open_service_order_legacy_recipe'
     AND ri.status='review_required'
     AND ri.candidates->>'legacy_recipe_id'=p_legacy_recipe_id::text
     AND ri.candidates->>'service_order_id'=ri.legacy_id
     AND EXISTS (
       SELECT 1 FROM public.service_orders so
        WHERE so.id::text=ri.legacy_id
          AND so.artisanal_recipe_id=p_legacy_recipe_id
          AND NOT public.is_open_legacy_strap_service_status(so.status)
     );

  PERFORM set_config('app.strap_engine_write','1',true);
  FOR v_order IN
    SELECT so.* FROM public.service_orders so
     WHERE so.artisanal_recipe_id=p_legacy_recipe_id
       AND public.is_open_legacy_strap_service_status(so.status)
     ORDER BY so.id FOR UPDATE
  LOOP
    v_open_order_review_id:=NULL;
    v_order_cutover_id:=NULL;
    v_order_snapshot_before:=NULL;
    v_order_snapshot_after:=NULL;
    SELECT ri.id,c.id,s.before_data,s.after_data
      INTO v_open_order_review_id,v_order_cutover_id,
        v_order_snapshot_before,v_order_snapshot_after
      FROM public.artisanal_strap_migration_review_items ri
      JOIN public.artisanal_strap_migration_cutovers c
        ON c.migration_run_id=ri.migration_run_id
       AND c.status IN ('applied','applied_with_review')
      JOIN public.artisanal_strap_migration_entity_snapshots s
        ON s.cutover_id=c.id AND s.entity_type='service_order'
       AND s.entity_id=v_order.id
     WHERE ri.entity_type='open_service_order_legacy_recipe'
       AND ri.legacy_id=v_order.id::text
       AND ri.status='review_required'
       AND ri.candidates->>'service_order_id'=v_order.id::text
       AND ri.candidates->>'legacy_recipe_id'=p_legacy_recipe_id::text
       AND c.id=v_order.strap_migration_cutover_id
     FOR UPDATE OF ri;
    v_order_technical_suspension:=v_open_order_review_id IS NOT NULL
      AND v_order.status='Suspensa'
      AND v_order.strap_migration_status='review_required'
      AND v_order.strap_migration_reason='Receita legada ambigua/nao resolvida'
      AND v_order.strap_migration_cutover_id=v_order_cutover_id
      AND v_order_snapshot_after->>'status'='Suspensa'
      AND v_order_snapshot_after->>'strap_migration_status'='review_required'
      AND v_order_snapshot_after->>'strap_migration_reason'=
        'Receita legada ambigua/nao resolvida'
      AND v_order_snapshot_after->>'strap_migration_cutover_id'=
        v_order_cutover_id::text;
    v_before:=to_jsonb(v_order);
    UPDATE public.service_orders
       SET canonical_strap_recipe_id=CASE
             WHEN canonical_strap_recipe_id IS NULL THEN p_canonical_recipe_id
             ELSE canonical_strap_recipe_id END,
           strap_migration_status=CASE WHEN v_open_order_review_id IS NULL
             THEN 'resolved' ELSE strap_migration_status END,
           strap_migration_reason=CASE WHEN v_open_order_review_id IS NULL
             THEN v_reason ELSE strap_migration_reason END
     WHERE id=v_order.id
       AND public.is_open_legacy_strap_service_status(status)
       AND (canonical_strap_recipe_id IS NULL
         OR canonical_strap_recipe_id=p_canonical_recipe_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OS aberta % mudou durante a resolucao',v_order.id
        USING ERRCODE='40001';
    END IF;

    -- Linha ja identificada por variante recebe a receita somente quando as FKs
    -- de medida/base conferem. Incompatibilidade aberta fica suspensa; nunca se
    -- escolhe receita pelo nome do material.
    FOR v_item IN
      SELECT i.* FROM public.service_order_items i
       WHERE i.service_order_id=v_order.id AND i.strap_variant_id IS NOT NULL
         AND public.is_open_legacy_strap_service_status(i.line_status)
       ORDER BY i.id FOR UPDATE
    LOOP
      v_item_before:=to_jsonb(v_item);
      v_item_mismatch_review_id:=NULL;
      SELECT ri.id INTO v_item_mismatch_review_id
        FROM public.artisanal_strap_migration_review_items ri
       WHERE ri.entity_type='open_service_order_recipe_mismatch'
         AND ri.legacy_id=v_item.id::text
         AND ri.status='review_required'
         AND ri.candidates->>'service_order_id'=v_order.id::text
         AND ri.candidates->>'service_order_item_id'=v_item.id::text
         AND ri.candidates->>'legacy_recipe_id'=p_legacy_recipe_id::text
       FOR UPDATE;
      SELECT EXISTS (
        SELECT 1 FROM public.artisanal_strap_variants v
         WHERE v.id=v_item.strap_variant_id
           AND v.measure_id=v_recipe.measure_id
           AND v.base_group_id=v_recipe.base_group_id
      ) INTO v_item_compatible;
      IF v_item_compatible THEN
        v_item_snapshot_before:=NULL;
        v_item_snapshot_after:=NULL;
        IF v_order_technical_suspension THEN
          SELECT s.before_data,s.after_data
            INTO v_item_snapshot_before,v_item_snapshot_after
            FROM public.artisanal_strap_migration_entity_snapshots s
           WHERE s.cutover_id=v_order_cutover_id
             AND s.entity_type='service_order_item'
             AND s.entity_id=v_item.id;
        END IF;
        v_item_can_restore:=v_order_technical_suspension
          AND v_item.line_status='Suspensa'
          AND (
            v_item.suspension_reason='Receita legada requer resolucao'
            OR (
              v_item.suspension_reason=
                'Receita legada nao compativel com variante canonica'
              AND v_item_mismatch_review_id IS NOT NULL
            )
          )
          AND v_item_snapshot_after->>'line_status'='Suspensa'
          AND v_item_snapshot_after->>'suspension_reason'=
            'Receita legada requer resolucao'
          AND v_item_snapshot_before->>'line_status'=
            v_item.suspended_from_status;
        UPDATE public.service_order_items
           SET strap_recipe_id=CASE WHEN strap_recipe_id IS NULL
                 THEN p_canonical_recipe_id ELSE strap_recipe_id END,
               -- Restaura exatamente a suspensao anterior (inclusive uma
               -- suspensao administrativa), nunca um status inferido.
               line_status=CASE WHEN v_item_can_restore
                 THEN v_item_snapshot_before->>'line_status'
                 ELSE line_status END,
               suspended_from_status=CASE WHEN v_item_can_restore
                 THEN v_item_snapshot_before->>'suspended_from_status'
                 ELSE suspended_from_status END,
               suspension_reason=CASE WHEN v_item_can_restore
                 THEN v_item_snapshot_before->>'suspension_reason'
                 ELSE suspension_reason END,
               suspended_by=CASE WHEN v_item_can_restore
                 THEN nullif(v_item_snapshot_before->>'suspended_by','')::uuid
                 ELSE suspended_by END,
               suspended_at=CASE WHEN v_item_can_restore
                 THEN nullif(v_item_snapshot_before->>'suspended_at','')::timestamptz
                 ELSE suspended_at END
         WHERE id=v_item.id
           AND public.is_open_legacy_strap_service_status(line_status)
           AND (strap_recipe_id IS NULL OR strap_recipe_id=p_canonical_recipe_id);
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Linha aberta de OS % mudou durante a resolucao',v_item.id
            USING ERRCODE='40001';
        END IF;
        IF v_item_mismatch_review_id IS NOT NULL
           AND (v_item.line_status<>'Suspensa' OR v_item_can_restore) THEN
          UPDATE public.artisanal_strap_migration_review_items ri SET
            status='resolved',
            resolution=jsonb_build_object(
              'legacy_recipe_id',p_legacy_recipe_id,
              'canonical_recipe_id',p_canonical_recipe_id,
              'service_order_id',v_order.id,
              'service_order_item_id',v_item.id,
              'reason',v_reason,
              'correlation_id',v_correlation_id),
            resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
           WHERE ri.id=v_item_mismatch_review_id
             AND ri.status='review_required';
        END IF;
      ELSIF public.is_open_legacy_strap_service_status(v_item.line_status) THEN
        UPDATE public.service_order_items
           SET suspended_from_status=coalesce(suspended_from_status,line_status),
               line_status='Suspensa',
               suspension_reason='Receita legada nao compativel com variante canonica',
               suspended_by=auth.uid(),suspended_at=now()
         WHERE id=v_item.id;
        INSERT INTO public.artisanal_strap_migration_review_items(
          entity_type,legacy_id,status,reason,candidates
        ) VALUES (
          'open_service_order_recipe_mismatch',v_item.id::text,'review_required',
          'Receita canonica resolvida nao pertence a medida/base da variante da linha',
          jsonb_build_object('service_order_id',v_order.id,
            'service_order_item_id',v_item.id,'legacy_recipe_id',p_legacy_recipe_id,
            'canonical_recipe_id',p_canonical_recipe_id,
            'strap_variant_id',v_item.strap_variant_id)
        )
        ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
        DO UPDATE SET reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
      END IF;
      PERFORM public.log_artisanal_strap_migration_event(
        'service_order_item',v_item.id,
        CASE WHEN public.is_open_legacy_strap_service_status(v_item.line_status)
          AND NOT EXISTS (
            SELECT 1 FROM public.artisanal_strap_variants v
             WHERE v.id=v_item.strap_variant_id
               AND v.measure_id=v_recipe.measure_id
               AND v.base_group_id=v_recipe.base_group_id
          ) THEN 'suspend' ELSE 'update' END,
        v_item_before,
        (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_item.id),
        v_reason,v_correlation_id);
    END LOOP;

    -- Fecha/reata apenas a suspensao tecnica criada por ESTE cutover. Uma OS
    -- com linha ainda sem identidade/receita compativel continua Suspensa e a
    -- review permanece aberta e acionavel.
    SELECT EXISTS (
      SELECT 1
        FROM public.service_order_items i
       WHERE i.service_order_id=v_order.id
         AND public.is_open_legacy_strap_service_status(i.line_status)
         AND (
           i.strap_variant_id IS NULL
           OR i.strap_recipe_id IS DISTINCT FROM p_canonical_recipe_id
           OR NOT EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.id=i.strap_variant_id
                AND v.measure_id=v_recipe.measure_id
                AND v.base_group_id=v_recipe.base_group_id
           )
           OR EXISTS (
             SELECT 1
               FROM public.artisanal_strap_migration_review_items ri
              WHERE ri.entity_type='open_service_order_recipe_mismatch'
                AND ri.legacy_id=i.id::text
                AND ri.status='review_required'
           )
         )
    ) INTO v_order_has_unresolved_line;
    IF v_order_technical_suspension AND NOT v_order_has_unresolved_line THEN
      UPDATE public.service_orders SET
        status=v_order_snapshot_before->>'status',
        strap_migration_status='resolved',
        strap_migration_reason=v_reason,
        strap_migration_previous_status=
          v_order_snapshot_before->>'strap_migration_previous_status'
       WHERE id=v_order.id
         AND status='Suspensa'
         AND strap_migration_status='review_required'
         AND strap_migration_reason='Receita legada ambigua/nao resolvida'
         AND strap_migration_cutover_id=v_order_cutover_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'OS % mudou durante a resolucao da receita',v_order.id
          USING ERRCODE='40001';
      END IF;
      UPDATE public.artisanal_strap_migration_review_items ri SET
        status='resolved',
        resolution=jsonb_build_object(
          'legacy_recipe_id',p_legacy_recipe_id,
          'canonical_recipe_id',p_canonical_recipe_id,
          'service_order_id',v_order.id,
          'cutover_id',v_order_cutover_id,
          'reason',v_reason,
          'correlation_id',v_correlation_id),
        resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
       WHERE ri.id=v_open_order_review_id
         AND ri.status='review_required';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pendencia da OS % mudou durante a resolucao',v_order.id
          USING ERRCODE='40001';
      END IF;
    END IF;
    PERFORM public.log_artisanal_strap_migration_event(
      'service_order',v_order.id,
      CASE WHEN v_order_technical_suspension AND NOT v_order_has_unresolved_line
        THEN 'resume' ELSE 'update' END,v_before,
      (SELECT to_jsonb(so) FROM public.service_orders so WHERE so.id=v_order.id),
      v_reason,v_correlation_id);
  END LOOP;

  PERFORM public.log_artisanal_strap_migration_event(
    'legacy_artisanal_recipe_map',p_legacy_recipe_id,'update',v_map_before,
    to_jsonb(v_map),v_reason,v_correlation_id);
  RETURN to_jsonb(v_map)||jsonb_build_object('correlation_id',v_correlation_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Produto legado -> variantes: split explicito e conservacao verificavel
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.legacy_strap_product_mapping_blockers(
  p_mapping_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.legacy_strap_product_migration_maps%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_provenance public.artisanal_strap_migration_product_provenance%ROWTYPE;
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_run public.artisanal_strap_migration_runs%ROWTYPE;
  v_reservation_ids uuid[]:=ARRAY[]::uuid[];
  v_purchase_ids uuid[]:=ARRAY[]::uuid[];
  v_service_ids uuid[]:=ARRAY[]::uuid[];
  v_blockers jsonb:='[]'::jsonb;
  v_count bigint;
  v_distinct bigint;
  v_qty numeric;
  v_reserved numeric;
  v_group_is_strap boolean:=false;
  v_provenance_checksum text;
BEGIN
  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_array(jsonb_build_object('code','mapping_not_found'));
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id=v_map.legacy_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_array(jsonb_build_object('code','legacy_product_not_found'));
  END IF;
  SELECT coalesce(pg.is_artisanal_strap,false) INTO v_group_is_strap
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
   WHERE p.id=v_product.id;
  IF NOT (coalesce(v_product.is_artisanal,false) OR v_group_is_strap) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','legacy_product_not_structurally_artisanal_strap',
      'legacy_product_id',v_product.id));
  END IF;

  SELECT * INTO v_provenance
    FROM public.artisanal_strap_migration_product_provenance pp
   WHERE pp.id=v_map.product_provenance_id;
  IF NOT FOUND THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','legacy_product_dry_run_provenance_missing',
      'migration_run_id',v_map.migration_run_id,
      'product_provenance_id',v_map.product_provenance_id));
  ELSE
    SELECT * INTO v_run FROM public.artisanal_strap_migration_runs r
     WHERE r.id=v_provenance.migration_run_id;
    SELECT * INTO v_review FROM public.artisanal_strap_migration_review_items ri
     WHERE ri.id=v_provenance.review_item_id;
    v_provenance_checksum:=public.strap_payload_hash(jsonb_build_object(
      'migration_run_id',v_provenance.migration_run_id,
      'dry_run_checksum',v_provenance.dry_run_checksum,
      'review_snapshot',v_provenance.review_snapshot,
      'product_snapshot',v_provenance.product_snapshot
    ));
    IF v_provenance.migration_run_id IS DISTINCT FROM v_map.migration_run_id
       OR v_provenance.legacy_product_id IS DISTINCT FROM v_map.legacy_product_id
       OR v_run.id IS NULL
       OR v_run.status='failed'
       OR v_run.overall_checksum IS DISTINCT FROM v_provenance.dry_run_checksum
       OR v_review.id IS NULL
       OR v_review.entity_type IS DISTINCT FROM 'legacy_product'
       OR v_review.legacy_id IS DISTINCT FROM v_map.legacy_product_id::text
       OR v_provenance.review_snapshot->>'review_item_id'
            IS DISTINCT FROM v_review.id::text
       OR v_provenance.review_snapshot->>'migration_run_id'
            IS DISTINCT FROM v_run.id::text
       OR v_provenance.review_snapshot->>'entity_type'
            IS DISTINCT FROM 'legacy_product'
       OR v_provenance.review_snapshot->>'legacy_id'
            IS DISTINCT FROM v_map.legacy_product_id::text
       OR v_provenance.review_snapshot->'candidates'->>'product_id'
            IS DISTINCT FROM v_map.legacy_product_id::text
       OR v_provenance.review_snapshot->'candidates'->>'group_id'
            IS DISTINCT FROM v_product.group_id::text
       OR v_provenance.product_snapshot->>'id'
            IS DISTINCT FROM v_map.legacy_product_id::text
       OR (
         coalesce(v_provenance.product_snapshot->>'is_artisanal','false')<>'true'
         AND coalesce(v_provenance.product_snapshot->>'group_is_artisanal_strap','false')<>'true'
       )
       OR v_provenance.provenance_checksum IS DISTINCT FROM v_provenance_checksum THEN
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','legacy_product_dry_run_provenance_invalid',
        'migration_run_id',v_map.migration_run_id,
        'product_provenance_id',v_map.product_provenance_id,
        'review_item_id',v_provenance.review_item_id,
        'stored_checksum',v_provenance.provenance_checksum,
        'calculated_checksum',v_provenance_checksum));
    END IF;
  END IF;

  SELECT coalesce(sum(quantity),0),coalesce(sum(reserved_stock),0)
    INTO v_qty,v_reserved
    FROM public.legacy_strap_product_migration_allocations
   WHERE mapping_id=p_mapping_id;
  SELECT coalesce(array_agg(x),ARRAY[]::uuid[]) INTO v_reservation_ids
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.reservation_ids) x
   WHERE a.mapping_id=p_mapping_id;
  SELECT coalesce(array_agg(x),ARRAY[]::uuid[]) INTO v_purchase_ids
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.purchase_order_item_ids) x
   WHERE a.mapping_id=p_mapping_id;
  SELECT coalesce(array_agg(x),ARRAY[]::uuid[]) INTO v_service_ids
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.service_order_item_ids) x
   WHERE a.mapping_id=p_mapping_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations
     WHERE mapping_id=p_mapping_id
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','allocations_empty'));
  END IF;
  IF v_qty IS DISTINCT FROM coalesce(v_product.quantity,0)
     OR v_reserved IS DISTINCT FROM coalesce(v_product.reserved_stock,0) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','balance_conservation_mismatch',
      'product_quantity',coalesce(v_product.quantity,0),'allocated_quantity',v_qty,
      'product_reserved_stock',coalesce(v_product.reserved_stock,0),
      'allocated_reserved_stock',v_reserved));
  END IF;
  IF coalesce(v_product.current_stock,0)
       IS DISTINCT FROM coalesce(v_product.quantity,0) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','current_stock_quantity_mismatch',
      'product_quantity',coalesce(v_product.quantity,0),
      'product_current_stock',coalesce(v_product.current_stock,0)));
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.products target ON target.id=a.target_product_id
     WHERE a.mapping_id=p_mapping_id
       AND coalesce(target.current_stock,0)
         IS DISTINCT FROM coalesce(target.quantity,0)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','target_current_stock_quantity_mismatch'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations a
    LEFT JOIN public.artisanal_strap_variants v ON v.id=a.strap_variant_id
     WHERE a.mapping_id=p_mapping_id
       AND (v.id IS NULL OR v.finished_product_id<>a.target_product_id)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','variant_target_mismatch'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id=v_map.legacy_product_id
       AND v.status<>'archived'
       AND NOT EXISTS (
         SELECT 1 FROM public.legacy_strap_product_migration_allocations a
          WHERE a.mapping_id=p_mapping_id AND a.strap_variant_id=v.id
       )
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','non_archived_variant_using_legacy_product_not_allocated',
      'variant_ids',coalesce((
        SELECT jsonb_agg(v.id ORDER BY v.id)
          FROM public.artisanal_strap_variants v
         WHERE v.finished_product_id=v_map.legacy_product_id
           AND v.status<>'archived'
           AND NOT EXISTS (
             SELECT 1 FROM public.legacy_strap_product_migration_allocations a
              WHERE a.mapping_id=p_mapping_id AND a.strap_variant_id=v.id
           )
      ),'[]'::jsonb)));
  END IF;
  -- Disponibilidade de fonte nao define o status administrativo da variante.
  -- Receita/base/comercial indisponiveis sao derivados no apply pelo resolver
  -- canonico e viram revisao da fonte, sem impedir consumo do estoque acabado.
  IF EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations a
    JOIN public.legacy_strap_product_migration_maps other_map
      ON other_map.legacy_product_id=a.target_product_id
     AND other_map.id<>p_mapping_id
     AND other_map.status IN ('resolved','applied')
     WHERE a.mapping_id=p_mapping_id
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','target_is_another_legacy_source'));
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.legacy_strap_product_migration_allocations other_a
        ON other_a.strap_variant_id=a.strap_variant_id
       AND other_a.mapping_id<>a.mapping_id
      JOIN public.legacy_strap_product_migration_maps other_map
        ON other_map.id=other_a.mapping_id
       AND other_map.status IN ('resolved','applied')
     WHERE a.mapping_id=p_mapping_id
       AND other_map.replenishment_mode IS DISTINCT FROM v_map.replenishment_mode
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','conflicting_replenishment_mode_for_same_variant'));
  END IF;

  SELECT count(*),count(DISTINCT x) INTO v_count,v_distinct
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.reservation_ids) x
   WHERE a.mapping_id=p_mapping_id;
  IF v_count<>v_distinct THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','duplicate_reservation_assignment'));
  END IF;
  SELECT count(*),count(DISTINCT x) INTO v_count,v_distinct
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.purchase_order_item_ids) x
   WHERE a.mapping_id=p_mapping_id;
  IF v_count<>v_distinct THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','duplicate_purchase_item_assignment'));
  END IF;
  SELECT count(*),count(DISTINCT x) INTO v_count,v_distinct
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.service_order_item_ids) x
   WHERE a.mapping_id=p_mapping_id;
  IF v_count<>v_distinct THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','duplicate_service_item_assignment'));
  END IF;

  -- Toda reserva aberta do produto compartilhado deve estar nominalmente em uma
  -- alocacao. Uma reserva terminal permanece historica com o product_id antigo.
  IF EXISTS (
    SELECT 1 FROM public.material_reservations r
     WHERE r.product_id=v_map.legacy_product_id
       AND r.status IN ('reserved','partially_consumed')
       AND NOT (r.id=ANY(v_reservation_ids))
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','open_reservation_not_assigned'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_reservation_ids) x
    LEFT JOIN public.material_reservations r ON r.id=x
     WHERE r.id IS NULL OR r.product_id<>v_map.legacy_product_id
        OR r.status NOT IN ('reserved','partially_consumed')
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','invalid_reservation_assignment'));
  END IF;
  -- reserved_stock nao e um bolo livre: cada parcela precisa ser sustentada
  -- exatamente pelas reservas abertas nominalmente atribuidas a ela. Isso
  -- detecta tanto distribuicao errada entre targets quanto reservado legado
  -- sem linha material_reservations correspondente.
  IF EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations a
     WHERE a.mapping_id=p_mapping_id
       AND a.reserved_stock IS DISTINCT FROM coalesce((
         SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
           FROM public.material_reservations r
          WHERE r.id=ANY(a.reservation_ids)
            AND r.status IN ('reserved','partially_consumed')
       ),0)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','allocation_reserved_assignment_mismatch',
      'allocations',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'allocation_id',a.id,
          'strap_variant_id',a.strap_variant_id,
          'target_product_id',a.target_product_id,
          'declared_reserved_stock',a.reserved_stock,
          'assigned_reservation_balance',coalesce((
            SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
              FROM public.material_reservations r
             WHERE r.id=ANY(a.reservation_ids)
               AND r.status IN ('reserved','partially_consumed')
          ),0),
          'reservation_ids',a.reservation_ids
        ) ORDER BY a.strap_variant_id),'[]'::jsonb)
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=p_mapping_id
           AND a.reserved_stock IS DISTINCT FROM coalesce((
             SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
               FROM public.material_reservations r
              WHERE r.id=ANY(a.reservation_ids)
                AND r.status IN ('reserved','partially_consumed')
           ),0)
      )
    ));
  END IF;
  IF coalesce(v_product.reserved_stock,0) IS DISTINCT FROM coalesce((
    SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
      FROM public.material_reservations r
     WHERE r.product_id=v_map.legacy_product_id
       AND r.status IN ('reserved','partially_consumed')
  ),0) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','legacy_reserved_stock_without_exact_reservation_rows'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations a
    JOIN public.products target ON target.id=a.target_product_id
     WHERE a.mapping_id=p_mapping_id
       AND a.target_product_id<>v_map.legacy_product_id
       AND coalesce(target.reserved_stock,0) IS DISTINCT FROM coalesce((
         SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
           FROM public.material_reservations r
          WHERE r.product_id=target.id
            AND r.status IN ('reserved','partially_consumed')
       ),0)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','target_reserved_stock_without_exact_reservation_rows'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchase_order_items i
    JOIN public.purchase_orders po ON po.id=i.purchase_order_id
     WHERE i.product_id=v_map.legacy_product_id
       AND public.is_open_legacy_strap_purchase_order_status(po.status)
       AND po.snapshot_locked_at IS NULL
       AND NOT (i.id=ANY(v_purchase_ids))
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','open_purchase_item_not_assigned'));
  END IF;
  -- Item de OC aprovado/congelado e fato imutavel. Sem bridge nominal no
  -- snapshot, um split nao pode decidir qual target recebera a entrega futura;
  -- somente o mapa self-target unico e seguro. Qualquer outro mapa aguarda o
  -- encerramento da OC (inclusive apos parcial/ajuste) em vez de reescrever o
  -- PDF ou presumir que nao havera correcao de recebimento.
  IF EXISTS (
    SELECT 1 FROM public.purchase_order_items i
    JOIN public.purchase_orders po ON po.id=i.purchase_order_id
     WHERE i.product_id=v_map.legacy_product_id
       AND public.is_open_legacy_strap_purchase_order_status(po.status)
       AND (
         po.snapshot_locked_at IS NOT NULL
         OR public.normalize_strap_catalog_text(po.status) IN (
           'approved','aprovado','aprovada','sent','enviado','enviada',
           'partial','parcial'
         )
       )
       AND NOT (
         SELECT count(*)=1
                AND bool_and(a.target_product_id=v_map.legacy_product_id)
           FROM public.legacy_strap_product_migration_allocations a
          WHERE a.mapping_id=p_mapping_id
       )
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','frozen_purchase_item_receipt_pending',
      'purchase_order_items',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'purchase_order_item_id',i.id,'purchase_order_id',po.id,
          'status',po.status,'snapshot_locked_at',po.snapshot_locked_at,
          'remaining_quantity',greatest(
            coalesce(i.quantity,0)-coalesce(i.received_quantity,0),0)
        ) ORDER BY po.id,i.id)
          FROM public.purchase_order_items i
          JOIN public.purchase_orders po ON po.id=i.purchase_order_id
         WHERE i.product_id=v_map.legacy_product_id
           AND public.is_open_legacy_strap_purchase_order_status(po.status)
           AND (po.snapshot_locked_at IS NOT NULL
                OR public.normalize_strap_catalog_text(po.status) IN (
                  'approved','aprovado','aprovada','sent','enviado','enviada',
                  'partial','parcial'
                ))
      ),'[]'::jsonb)));
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_purchase_ids) x
    LEFT JOIN public.purchase_order_items i ON i.id=x
    LEFT JOIN public.purchase_orders po ON po.id=i.purchase_order_id
     WHERE i.id IS NULL OR i.product_id<>v_map.legacy_product_id
        OR NOT public.is_open_legacy_strap_purchase_order_status(po.status)
        OR po.snapshot_locked_at IS NOT NULL
        OR public.normalize_strap_catalog_text(po.status) IN (
          'approved','aprovado','aprovada','sent','enviado','enviada',
          'partial','parcial'
        )
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','invalid_purchase_item_assignment'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_order_items i
    JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE i.finished_product_id=v_map.legacy_product_id
       AND public.is_open_legacy_strap_service_status(i.line_status)
       AND public.is_open_legacy_strap_service_status(so.status)
       AND NOT (i.id=ANY(v_service_ids))
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','open_service_item_not_assigned'));
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_service_ids) x
    LEFT JOIN public.service_order_items i ON i.id=x
    LEFT JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE i.id IS NULL OR i.finished_product_id<>v_map.legacy_product_id
        OR NOT public.is_open_legacy_strap_service_status(i.line_status)
        OR NOT public.is_open_legacy_strap_service_status(so.status)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','invalid_service_item_assignment'));
  END IF;

  -- Demanda canonica aberta pode ser reconciliada sem payload adicional porque
  -- ja carrega a FK exata strap_variant_id. Se a variante nao esta na alocacao,
  -- o documento permanece ambiguo e bloqueia somente este mapa.
  IF EXISTS (
    SELECT 1 FROM public.sale_order_strap_demands d
     WHERE d.finished_product_id=v_map.legacy_product_id
       AND d.is_current
       AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
       AND NOT EXISTS (
         SELECT 1 FROM public.legacy_strap_product_migration_allocations a
          WHERE a.mapping_id=p_mapping_id AND a.strap_variant_id=d.strap_variant_id
       )
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','open_demand_variant_not_allocated'));
  END IF;
  RETURN v_blockers;
END;
$$;

-- Acrescenta ao contrato conservativo a ligacao exata mapa -> dry-run do
-- cutover. A pendencia que provou a identidade deve ter sido capturada antes
-- da abertura do corte; uma resolucao administrativa posterior pode apenas
-- escolher a alocacao, nunca criar retroativamente um candidato.
CREATE OR REPLACE FUNCTION public.legacy_strap_product_mapping_cutover_blockers(
  p_mapping_id uuid,
  p_cutover_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.legacy_strap_product_migration_maps%ROWTYPE;
  v_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_provenance public.artisanal_strap_migration_product_provenance%ROWTYPE;
  v_blockers jsonb:=public.legacy_strap_product_mapping_blockers(p_mapping_id);
BEGIN
  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id;
  SELECT * INTO v_cutover FROM public.artisanal_strap_migration_cutovers
   WHERE id=p_cutover_id;
  IF v_map.id IS NULL OR v_cutover.id IS NULL THEN
    RETURN v_blockers||jsonb_build_array(jsonb_build_object(
      'code','mapping_cutover_not_found','mapping_id',p_mapping_id,
      'cutover_id',p_cutover_id));
  END IF;
  SELECT * INTO v_provenance
    FROM public.artisanal_strap_migration_product_provenance pp
   WHERE pp.id=v_map.product_provenance_id;
  IF v_map.migration_run_id IS DISTINCT FROM v_cutover.migration_run_id
     OR v_provenance.id IS NULL
     OR v_provenance.migration_run_id IS DISTINCT FROM v_cutover.migration_run_id
     OR v_provenance.legacy_product_id IS DISTINCT FROM v_map.legacy_product_id
     OR v_provenance.dry_run_checksum IS DISTINCT FROM v_cutover.dry_run_checksum
     OR v_provenance.captured_at>v_cutover.created_at THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','mapping_not_proven_in_cutover_dry_run',
      'mapping_run_id',v_map.migration_run_id,
      'cutover_run_id',v_cutover.migration_run_id,
      'product_provenance_id',v_map.product_provenance_id,
      'provenance_captured_at',v_provenance.captured_at,
      'cutover_created_at',v_cutover.created_at));
  END IF;
  RETURN v_blockers;
END;
$$;

-- Snapshot deterministico e estritamente escopado ao mapa. Nao inclui o
-- checksum/manifesto global do cutover, portanto fatos de outras variantes nao
-- invalidam a resolucao; inclui, porem, todos os saldos e fatos explicitamente
-- atribuiveis que a aplicacao pode ler ou alterar.
CREATE OR REPLACE FUNCTION public.artisanal_strap_product_mapping_scope_snapshot(
  p_cutover_id uuid,
  p_mapping_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mapping AS (
    SELECT m.* FROM public.legacy_strap_product_migration_maps m
     WHERE m.id=p_mapping_id
  ), allocations AS (
    SELECT a.* FROM public.legacy_strap_product_migration_allocations a
     WHERE a.mapping_id=p_mapping_id
  ), affected_products AS (
    SELECT m.legacy_product_id AS id FROM mapping m
    UNION
    SELECT a.target_product_id FROM allocations a
  ), affected_variants AS (
    SELECT a.strap_variant_id AS id FROM allocations a
  ), assigned_reservations AS (
    SELECT DISTINCT unnest(a.reservation_ids) AS id FROM allocations a
  ), assigned_purchase_items AS (
    SELECT DISTINCT unnest(a.purchase_order_item_ids) AS id FROM allocations a
    UNION
    SELECT i.id
      FROM public.purchase_order_items i
      JOIN public.purchase_orders po ON po.id=i.purchase_order_id
      JOIN mapping m ON m.legacy_product_id=i.product_id
     WHERE public.is_open_legacy_strap_purchase_order_status(po.status)
  ), assigned_service_items AS (
    SELECT DISTINCT unnest(a.service_order_item_ids) AS id FROM allocations a
    UNION
    SELECT i.id
      FROM public.service_order_items i
      JOIN public.service_orders so ON so.id=i.service_order_id
      JOIN mapping m ON m.legacy_product_id=i.finished_product_id
     WHERE public.is_open_legacy_strap_service_status(i.line_status)
       AND public.is_open_legacy_strap_service_status(so.status)
  ), purchase_scope AS (
    SELECT i.id,to_jsonb(i) AS item,
      jsonb_build_object('id',po.id,'status',po.status,
        'snapshot_locked_at',po.snapshot_locked_at,'updated_at',po.updated_at) AS purchase_order
      FROM assigned_purchase_items x
      LEFT JOIN public.purchase_order_items i ON i.id=x.id
      LEFT JOIN public.purchase_orders po ON po.id=i.purchase_order_id
  ), service_scope AS (
    SELECT i.id,to_jsonb(i) AS item,
      jsonb_build_object('id',so.id,'status',so.status,
        'updated_at',so.updated_at) AS service_order
      FROM assigned_service_items x
      LEFT JOIN public.service_order_items i ON i.id=x.id
      LEFT JOIN public.service_orders so ON so.id=i.service_order_id
  ), relevant_reviews AS (
    SELECT ri.* FROM public.artisanal_strap_migration_review_items ri
     WHERE (ri.entity_type='legacy_product' AND ri.legacy_id=(
              SELECT m.legacy_product_id::text FROM mapping m))
        OR (ri.entity_type='legacy_product_mapping_drift'
              AND ri.legacy_id=p_mapping_id::text)
        OR (ri.entity_type='legacy_replenishment_mode' AND ri.legacy_id IN (
              SELECT v.id::text FROM affected_variants v))
        OR (ri.entity_type='legacy_replenishment_source_unavailable'
              AND ri.legacy_id IN (
                SELECT v.id::text FROM affected_variants v))
  )
  SELECT jsonb_build_object(
    'cutover',coalesce((SELECT jsonb_build_object(
      'id',c.id,'migration_run_id',c.migration_run_id)
      FROM public.artisanal_strap_migration_cutovers c
      WHERE c.id=p_cutover_id),'null'::jsonb),
    'mapping',coalesce((SELECT to_jsonb(m) FROM mapping m),'null'::jsonb),
    'product_provenance',coalesce((
      SELECT to_jsonb(pp)
        FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.id=(SELECT m.product_provenance_id FROM mapping m)
    ),'null'::jsonb),
    'allocations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
      FROM allocations a),'[]'::jsonb),
    'products',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
      FROM public.products p WHERE p.id IN (SELECT id FROM affected_products)),'[]'::jsonb),
    'variants',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)
      FROM public.artisanal_strap_variants v
      WHERE v.id IN (SELECT id FROM affected_variants)),'[]'::jsonb),
    'reservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
      FROM public.material_reservations r
      WHERE r.product_id IN (SELECT id FROM affected_products)
         OR r.id IN (SELECT id FROM assigned_reservations)),'[]'::jsonb),
    'purchase_order_items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'item',p.item,'purchase_order',p.purchase_order) ORDER BY p.id)
      FROM purchase_scope p),'[]'::jsonb),
    'service_order_items',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'item',s.item,'service_order',s.service_order) ORDER BY s.id)
      FROM service_scope s),'[]'::jsonb),
    'demands',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id)
      FROM public.sale_order_strap_demands d
      WHERE d.strap_variant_id IN (SELECT id FROM affected_variants)
        AND d.is_current),'[]'::jsonb),
    'stock_movements',coalesce((SELECT jsonb_agg(to_jsonb(sm) ORDER BY sm.id)
      FROM public.stock_movements sm
      WHERE sm.product_id IN (SELECT id FROM affected_products)),'[]'::jsonb),
    'stock_transfers',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)
      FROM public.legacy_strap_stock_transfers t
      WHERE t.mapping_id=p_mapping_id),'[]'::jsonb),
    'review_items',coalesce((SELECT jsonb_agg(to_jsonb(ri) ORDER BY ri.id)
      FROM relevant_reviews ri),'[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.artisanal_strap_product_mapping_scope_checksum(
  p_cutover_id uuid,
  p_mapping_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.strap_payload_hash(
    public.artisanal_strap_product_mapping_scope_snapshot(p_cutover_id,p_mapping_id)
  );
$$;

-- Blockers adicionais da fase incremental. Os blockers conservativos do mapa
-- continuam sendo a fonte primaria; aqui sao fechadas somente as garantias do
-- cutover ativo, replay, fatos terminais e restauracao exata de status.
CREATE OR REPLACE FUNCTION public.artisanal_strap_incremental_mapping_blockers(
  p_cutover_id uuid,
  p_mapping_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_map public.legacy_strap_product_migration_maps%ROWTYPE;
  v_blockers jsonb:=public.legacy_strap_product_mapping_cutover_blockers(
    p_mapping_id,p_cutover_id);
  v_allocation_checksum text;
BEGIN
  SELECT * INTO v_cutover FROM public.artisanal_strap_migration_cutovers
   WHERE id=p_cutover_id;
  IF NOT FOUND OR v_cutover.status NOT IN ('applied','applied_with_review') THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','active_cutover_required','cutover_id',p_cutover_id,
      'status',CASE WHEN v_cutover.id IS NULL THEN NULL ELSE v_cutover.status END));
  END IF;

  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id;
  IF NOT FOUND THEN
    RETURN v_blockers;
  END IF;
  IF v_map.status<>'resolved' OR v_map.applied_cutover_id IS NOT NULL
     OR v_map.applied_at IS NOT NULL THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','mapping_not_resolved_unapplied','status',v_map.status,
      'applied_cutover_id',v_map.applied_cutover_id));
  END IF;
  IF EXISTS (SELECT 1 FROM public.legacy_strap_stock_transfers t
              WHERE t.mapping_id=p_mapping_id) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','mapping_stock_transfer_already_exists'));
  END IF;
  SELECT public.strap_payload_hash(coalesce(jsonb_agg(jsonb_build_object(
      'strap_variant_id',a.strap_variant_id,'target_product_id',a.target_product_id,
      'quantity',a.quantity,'reserved_stock',a.reserved_stock,
      'reservation_ids',a.reservation_ids,
      'purchase_order_item_ids',a.purchase_order_item_ids,
      'service_order_item_ids',a.service_order_item_ids
    ) ORDER BY a.strap_variant_id),'[]'::jsonb))
    INTO v_allocation_checksum
    FROM public.legacy_strap_product_migration_allocations a
   WHERE a.mapping_id=p_mapping_id;
  IF v_map.allocation_checksum IS DISTINCT FROM v_allocation_checksum THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','allocation_checksum_mismatch','expected',v_map.allocation_checksum,
      'current',v_allocation_checksum));
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.artisanal_strap_variants v ON v.id=a.strap_variant_id
      LEFT JOIN public.artisanal_strap_migration_entity_snapshots s
        ON s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
       AND s.entity_id=v.id
     WHERE a.mapping_id=p_mapping_id
       AND v.status='review_required' AND s.entity_id IS NULL
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','variant_pre_cutover_snapshot_missing'));
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.artisanal_strap_variants v ON v.id=a.strap_variant_id
      JOIN public.artisanal_strap_migration_entity_snapshots s
        ON s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
       AND s.entity_id=v.id
     WHERE a.mapping_id=p_mapping_id
       AND v.status='review_required'
       AND coalesce(s.before_data->>'status','')<>'review_required'
       AND coalesce(v.review_reason,'') NOT IN (
         'Produto acabado legado exige alocacao/split explicito',
         'Origem de reposicao do estoque minimo exige confirmacao administrativa'
       )
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','variant_has_unrelated_review'));
  END IF;

  -- Status administrativo e disponibilidade de fonte sao eixos distintos
  -- (Req. 25). O mapa exige somente identidade de produto acabado em metros;
  -- base/cor/receita/comercial sao avaliados por fonte durante o apply.
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.artisanal_strap_variants v ON v.id=a.strap_variant_id
      JOIN public.products p ON p.id=v.finished_product_id
     WHERE a.mapping_id=p_mapping_id
       AND (p.unit<>'m' OR v_map.replenishment_mode IS NULL)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','variant_finished_product_identity_invalid'));
  END IF;

  -- A linha aberta pode ser atribuida, mas uma OS terminal nunca e reescrita,
  -- mesmo que seu line_status legado ainda pareca aberto.
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      CROSS JOIN LATERAL unnest(a.service_order_item_ids) x(id)
      JOIN public.service_order_items i ON i.id=x.id
      JOIN public.service_orders so ON so.id=i.service_order_id
     WHERE a.mapping_id=p_mapping_id
       AND NOT public.is_open_legacy_strap_service_status(so.status)
  ) THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','assigned_service_order_is_terminal'));
  END IF;
  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_legacy_strap_product_migration(
  p_legacy_product_id uuid,
  p_allocations jsonb,
  p_replenishment_mode text,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_mapping public.legacy_strap_product_migration_maps%ROWTYPE;
  v_existing public.legacy_strap_product_migration_maps%ROWTYPE;
  v_provenance public.artisanal_strap_migration_product_provenance%ROWTYPE;
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_active_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_allocation jsonb;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_mapping_id uuid;
  v_checksum text;
  v_blockers jsonb;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_before jsonb;
  v_reservation_ids uuid[];
  v_purchase_ids uuid[];
  v_service_ids uuid[];
  v_group_is_strap boolean:=false;
  v_variant_lock_id uuid;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'correlation_id obrigatorio'; END IF;
  IF p_replenishment_mode NOT IN ('internal','buy_ready') THEN
    RAISE EXCEPTION 'Origem de reposicao do piso deve ser internal ou buy_ready';
  END IF;
  IF jsonb_typeof(p_allocations)<>'array' OR jsonb_array_length(p_allocations)=0 THEN
    RAISE EXCEPTION 'Alocacoes explicitas obrigatorias';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('artisanal-strap-legacy-cutover',0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-product-map:'||p_legacy_product_id::text,0));
  -- reconcile_strap_variant_local_202701 usa variante -> produto. Reserve
  -- todas as variantes do payload na mesma ordem antes de travar o produto.
  BEGIN
    FOR v_variant_lock_id IN
      SELECT DISTINCT nullif(e.value->>'strap_variant_id','')::uuid AS id
        FROM jsonb_array_elements(p_allocations) e(value)
       WHERE nullif(e.value->>'strap_variant_id','') IS NOT NULL
       ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'strap-variant:'||v_variant_lock_id::text,0));
    END LOOP;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'strap_variant_id invalido nas alocacoes';
  END;
  SELECT * INTO v_product FROM public.products
   WHERE id=p_legacy_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto legado inexistente'; END IF;
  SELECT coalesce(pg.is_artisanal_strap,false) INTO v_group_is_strap
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
   WHERE p.id=p_legacy_product_id;
  IF NOT (coalesce(v_product.is_artisanal,false) OR v_group_is_strap) THEN
    RAISE EXCEPTION 'Produto nao e tira artesanal pela classificacao estrutural';
  END IF;

  SELECT * INTO v_existing
    FROM public.legacy_strap_product_migration_maps
   WHERE legacy_product_id=p_legacy_product_id FOR UPDATE;
  IF FOUND AND v_existing.status='applied' THEN
    RAISE EXCEPTION 'Mapa ja aplicado; use rollback seguro antes de alterar';
  END IF;

  -- Com cutover ativo, somente o candidato nominal congelado no dry-run desse
  -- proprio corte e aceito. Antes do corte, uma pendencia aberta de dry-run
  -- pode criar/revincular a prova; sem ela, um products.id arbitrario falha.
  SELECT * INTO v_active_cutover
    FROM public.artisanal_strap_migration_cutovers c
   WHERE c.status IN ('applied','applied_with_review');
  IF FOUND THEN
    SELECT * INTO v_provenance
      FROM public.artisanal_strap_migration_product_provenance pp
     WHERE pp.migration_run_id=v_active_cutover.migration_run_id
       AND pp.legacy_product_id=p_legacy_product_id FOR SHARE;
    IF NOT FOUND OR v_provenance.captured_at>v_active_cutover.created_at
       OR v_provenance.dry_run_checksum IS DISTINCT FROM v_active_cutover.dry_run_checksum THEN
      RAISE EXCEPTION 'Produto nao foi candidato nominal do dry-run deste cutover';
    END IF;
  ELSE
    SELECT * INTO v_review
      FROM public.artisanal_strap_migration_review_items ri
     WHERE ri.entity_type='legacy_product'
       AND ri.legacy_id=p_legacy_product_id::text
       AND ri.status='review_required' FOR UPDATE;
    IF FOUND THEN
      PERFORM public.capture_artisanal_strap_product_provenance(v_review.id);
      SELECT * INTO v_provenance
        FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.migration_run_id=v_review.migration_run_id
         AND pp.legacy_product_id=p_legacy_product_id FOR SHARE;
    ELSIF v_existing.id IS NOT NULL THEN
      SELECT * INTO v_provenance
        FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.id=v_existing.product_provenance_id FOR SHARE;
    END IF;
    IF v_provenance.id IS NULL THEN
      RAISE EXCEPTION 'Produto nao possui proveniencia nominal congelada por dry-run';
    END IF;
  END IF;
  SELECT * INTO v_review
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.id=v_provenance.review_item_id FOR UPDATE;
  IF NOT FOUND OR v_review.entity_type<>'legacy_product'
     OR v_review.legacy_id IS DISTINCT FROM p_legacy_product_id::text THEN
    RAISE EXCEPTION 'Proveniencia nominal do produto divergiu do snapshot congelado';
  END IF;

  v_before:=CASE WHEN v_existing.id IS NULL THEN NULL ELSE to_jsonb(v_existing) END;
  IF v_existing.id IS NULL THEN
    INSERT INTO public.legacy_strap_product_migration_maps(
      legacy_product_id,migration_run_id,product_provenance_id,status,resolution_reason
    ) VALUES (
      p_legacy_product_id,v_provenance.migration_run_id,v_provenance.id,
      'review_required',v_reason
    )
    RETURNING id INTO v_mapping_id;
  ELSE
    v_mapping_id:=v_existing.id;
    UPDATE public.legacy_strap_product_migration_maps SET
      migration_run_id=v_provenance.migration_run_id,
      product_provenance_id=v_provenance.id,
      updated_at=now()
     WHERE id=v_mapping_id;
    DELETE FROM public.legacy_strap_product_migration_allocations
     WHERE mapping_id=v_mapping_id;
  END IF;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    IF jsonb_typeof(v_allocation)<>'object'
       OR nullif(v_allocation->>'strap_variant_id','') IS NULL
       OR nullif(v_allocation->>'quantity','') IS NULL
       OR nullif(v_allocation->>'reserved_stock','') IS NULL THEN
      RAISE EXCEPTION 'Cada alocacao exige strap_variant_id, quantity e reserved_stock';
    END IF;
    IF jsonb_typeof(coalesce(v_allocation->'reservation_ids','[]'::jsonb))<>'array'
       OR jsonb_typeof(coalesce(v_allocation->'purchase_order_item_ids','[]'::jsonb))<>'array'
       OR jsonb_typeof(coalesce(v_allocation->'service_order_item_ids','[]'::jsonb))<>'array' THEN
      RAISE EXCEPTION 'Listas de documentos atribuidos devem ser arrays de UUID';
    END IF;
    BEGIN
      SELECT * INTO v_variant FROM public.artisanal_strap_variants
       WHERE id=(v_allocation->>'strap_variant_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Variante inexistente'; END IF;
      SELECT coalesce(array_agg(x::uuid),ARRAY[]::uuid[])
        INTO v_reservation_ids
        FROM jsonb_array_elements_text(coalesce(v_allocation->'reservation_ids','[]'::jsonb)) x;
      SELECT coalesce(array_agg(x::uuid),ARRAY[]::uuid[])
        INTO v_purchase_ids
        FROM jsonb_array_elements_text(coalesce(v_allocation->'purchase_order_item_ids','[]'::jsonb)) x;
      SELECT coalesce(array_agg(x::uuid),ARRAY[]::uuid[])
        INTO v_service_ids
        FROM jsonb_array_elements_text(coalesce(v_allocation->'service_order_item_ids','[]'::jsonb)) x;
      IF (v_allocation->>'quantity')::numeric<0
         OR (v_allocation->>'reserved_stock')::numeric<0 THEN
        RAISE EXCEPTION 'Quantidade e reservado nao podem ser negativos';
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'UUID/quantidade invalido na alocacao: %',v_allocation;
    END;

    INSERT INTO public.legacy_strap_product_migration_allocations(
      mapping_id,strap_variant_id,target_product_id,quantity,reserved_stock,
      reservation_ids,purchase_order_item_ids,service_order_item_ids
    ) VALUES (
      v_mapping_id,v_variant.id,v_variant.finished_product_id,
      (v_allocation->>'quantity')::numeric,
      (v_allocation->>'reserved_stock')::numeric,
      v_reservation_ids,v_purchase_ids,v_service_ids
    );
  END LOOP;

  SELECT public.strap_payload_hash(jsonb_agg(jsonb_build_object(
      'strap_variant_id',a.strap_variant_id,'target_product_id',a.target_product_id,
      'quantity',a.quantity,'reserved_stock',a.reserved_stock,
      'reservation_ids',a.reservation_ids,
      'purchase_order_item_ids',a.purchase_order_item_ids,
      'service_order_item_ids',a.service_order_item_ids
    ) ORDER BY a.strap_variant_id))
    INTO v_checksum
    FROM public.legacy_strap_product_migration_allocations a
   WHERE a.mapping_id=v_mapping_id;

  UPDATE public.legacy_strap_product_migration_maps
     SET status='resolved',replenishment_mode=p_replenishment_mode,
         allocation_checksum=v_checksum,resolution_reason=v_reason,
         resolved_by=auth.uid(),resolved_at=now(),
         applied_cutover_id=NULL,applied_at=NULL,updated_at=now()
   WHERE id=v_mapping_id RETURNING * INTO v_mapping;

  v_blockers:=public.legacy_strap_product_mapping_blockers(v_mapping_id);
  IF jsonb_array_length(v_blockers)>0 THEN
    RAISE EXCEPTION 'Mapa invalido/nao conservativo: %',v_blockers;
  END IF;

  -- Resolver o mapa nao ativa a variante nem dispara reconciliacao. A origem
  -- confirmada e aplicada somente dentro do cutover, junto do snapshot que a
  -- torna reversivel. Isso preserva a fase "mapear sem ativar" do Req. 129.
  PERFORM set_config('app.strap_change_reason',v_reason,true);
  UPDATE public.products
     SET strap_migration_status='resolved',strap_migration_reason=v_reason
   WHERE id=p_legacy_product_id;
  PERFORM public.log_artisanal_strap_migration_event(
    'product',p_legacy_product_id,'update',to_jsonb(v_product),
    (SELECT to_jsonb(p) FROM public.products p WHERE p.id=p_legacy_product_id),
    v_reason,p_correlation_id);
  UPDATE public.artisanal_strap_migration_review_items
     SET status='resolved',
         resolution=jsonb_build_object('mapping_id',v_mapping_id,
           'migration_run_id',v_mapping.migration_run_id,
           'product_provenance_id',v_mapping.product_provenance_id,
           'allocation_checksum',v_checksum,'reason',v_reason),
         resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE id=v_provenance.review_item_id
     AND migration_run_id=v_provenance.migration_run_id
     AND candidates IS NOT DISTINCT FROM v_provenance.review_snapshot->'candidates'
     AND status='review_required';

  PERFORM public.log_artisanal_strap_migration_event(
    'legacy_strap_product_mapping',v_mapping_id,'update',v_before,to_jsonb(v_mapping),
    v_reason,p_correlation_id);
  RETURN jsonb_build_object(
    'mapping_id',v_mapping_id,'legacy_product_id',p_legacy_product_id,
    'migration_run_id',v_mapping.migration_run_id,
    'product_provenance_id',v_mapping.product_provenance_id,
    'status','resolved','allocation_checksum',v_checksum,
    'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.strap_variant_id)
      FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_mapping_id),
    'correlation_id',p_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_resolved_legacy_strap_product_mapping(
  p_mapping_id uuid,
  p_cutover_id uuid,
  p_reason text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_map public.legacy_strap_product_migration_maps%ROWTYPE;
  v_source public.products%ROWTYPE;
  v_target public.products%ROWTYPE;
  v_allocation public.legacy_strap_product_migration_allocations%ROWTYPE;
  v_reservation public.material_reservations%ROWTYPE;
  v_purchase_item public.purchase_order_items%ROWTYPE;
  v_purchase_order public.purchase_orders%ROWTYPE;
  v_service_item public.service_order_items%ROWTYPE;
  v_service_order public.service_orders%ROWTYPE;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_blockers jsonb;
  v_source_availability jsonb;
  v_source_allowed boolean;
  v_source_block_reason text;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_source_previous numeric;
  v_source_new numeric;
  v_target_previous numeric;
  v_target_new numeric;
  v_source_current_previous numeric;
  v_source_current_new numeric;
  v_target_current_previous numeric;
  v_target_current_new numeric;
  v_out_movement_id uuid;
  v_in_movement_id uuid;
  v_before_total numeric;
  v_after_total numeric;
  v_before_reserved numeric;
  v_after_reserved numeric;
  v_before_current numeric;
  v_after_current numeric;
  v_expected_count integer;
  v_processed_count integer;
  v_variant_lock_id uuid;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  -- Chamadores publicos ja possuem o advisory global; a repeticao e
  -- reentrante e torna este helper seguro mesmo em execucao interna direta.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-legacy-cutover',0));
  FOR v_variant_lock_id IN
    SELECT DISTINCT a.strap_variant_id AS id
      FROM public.legacy_strap_product_migration_allocations a
     WHERE a.mapping_id=p_mapping_id
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:'||v_variant_lock_id::text,0));
  END LOOP;
  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id FOR UPDATE;
  IF NOT FOUND OR v_map.status<>'resolved' THEN
    RETURN jsonb_build_object('mapping_id',p_mapping_id,'applied',false,
      'reason','mapping_not_resolved');
  END IF;

  -- Lock operacional canonico: item -> cabecalho -> reserva -> produto ->
  -- variante/demanda. O recebimento usa item -> OC -> produto; portanto o
  -- cutover nunca segura produto enquanto espera uma OC e nunca valida um
  -- snapshot que possa congelar entre o precheck e o remapeamento.
  PERFORM 1
    FROM public.legacy_strap_product_migration_allocations a
   WHERE a.mapping_id=v_map.id
   ORDER BY a.id FOR UPDATE;
  PERFORM 1
    FROM public.purchase_order_items i
   WHERE i.product_id=v_map.legacy_product_id
      OR i.id IN (
        SELECT x.id
          FROM public.legacy_strap_product_migration_allocations a
          CROSS JOIN LATERAL unnest(a.purchase_order_item_ids) x(id)
         WHERE a.mapping_id=v_map.id
      )
   ORDER BY i.id FOR UPDATE;
  PERFORM 1
    FROM public.purchase_orders po
   WHERE po.id IN (
     SELECT i.purchase_order_id
       FROM public.purchase_order_items i
      WHERE i.product_id=v_map.legacy_product_id
         OR i.id IN (
           SELECT x.id
             FROM public.legacy_strap_product_migration_allocations a
             CROSS JOIN LATERAL unnest(a.purchase_order_item_ids) x(id)
            WHERE a.mapping_id=v_map.id
         )
   )
   ORDER BY po.id FOR UPDATE;
  PERFORM 1
    FROM public.service_order_items i
   WHERE i.finished_product_id=v_map.legacy_product_id
      OR i.id IN (
        SELECT x.id
          FROM public.legacy_strap_product_migration_allocations a
          CROSS JOIN LATERAL unnest(a.service_order_item_ids) x(id)
         WHERE a.mapping_id=v_map.id
      )
   ORDER BY i.id FOR UPDATE;
  PERFORM 1
    FROM public.service_orders so
   WHERE so.id IN (
     SELECT i.service_order_id
       FROM public.service_order_items i
      WHERE i.finished_product_id=v_map.legacy_product_id
         OR i.id IN (
           SELECT x.id
             FROM public.legacy_strap_product_migration_allocations a
             CROSS JOIN LATERAL unnest(a.service_order_item_ids) x(id)
            WHERE a.mapping_id=v_map.id
         )
   )
   ORDER BY so.id FOR UPDATE;
  PERFORM 1
    FROM public.material_reservations r
   WHERE r.product_id=v_map.legacy_product_id
      OR r.product_id IN (
        SELECT a.target_product_id
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=v_map.id
      )
      OR r.id IN (
        SELECT x.id
          FROM public.legacy_strap_product_migration_allocations a
          CROSS JOIN LATERAL unnest(a.reservation_ids) x(id)
         WHERE a.mapping_id=v_map.id
      )
   ORDER BY r.id FOR UPDATE;
  PERFORM 1 FROM public.products p
   WHERE p.id=v_map.legacy_product_id OR p.id IN (
     SELECT a.target_product_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   )
   ORDER BY p.id FOR UPDATE;
  PERFORM 1
    FROM public.artisanal_strap_variants v
   WHERE v.id IN (
     SELECT a.strap_variant_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   )
   ORDER BY v.id FOR UPDATE;
  PERFORM 1
    FROM public.sale_order_strap_demands d
   WHERE d.is_current AND d.strap_variant_id IN (
     SELECT a.strap_variant_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   )
   ORDER BY d.id FOR UPDATE;
  PERFORM 1
    FROM public.artisanal_strap_migration_review_items ri
   WHERE (ri.entity_type='legacy_product'
          AND ri.legacy_id=v_map.legacy_product_id::text)
      OR (ri.entity_type='legacy_product_mapping_drift'
          AND ri.legacy_id=v_map.id::text)
      OR (ri.entity_type IN (
            'legacy_replenishment_mode',
            'legacy_replenishment_source_unavailable'
          ) AND ri.legacy_id IN (
            SELECT a.strap_variant_id::text
              FROM public.legacy_strap_product_migration_allocations a
             WHERE a.mapping_id=v_map.id
          ))
   ORDER BY ri.id FOR UPDATE;
  PERFORM 1
    FROM public.stock_movements sm
   WHERE sm.product_id=v_map.legacy_product_id OR sm.product_id IN (
     SELECT a.target_product_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   )
   ORDER BY sm.id FOR UPDATE;

  -- Revalida somente depois de todos os fatos mutaveis estarem congelados.
  v_blockers:=public.legacy_strap_product_mapping_cutover_blockers(
    p_mapping_id,p_cutover_id);
  IF jsonb_array_length(v_blockers)>0 THEN
    SELECT * INTO v_source FROM public.products
     WHERE id=v_map.legacy_product_id FOR UPDATE;
    PERFORM public.record_artisanal_strap_migration_snapshot(
      p_cutover_id,'product_mapping',v_map.id,to_jsonb(v_map));
    PERFORM public.record_artisanal_strap_migration_snapshot(
      p_cutover_id,'product',v_source.id,to_jsonb(v_source));
    UPDATE public.legacy_strap_product_migration_maps
       SET status='review_required',
           resolution_reason='Drift entre resolucao e cutover: '||v_blockers::text,
           applied_cutover_id=NULL,applied_at=NULL,updated_at=now()
     WHERE id=v_map.id;
    UPDATE public.products
       SET strap_migration_status='review_required',
           strap_migration_reason='Mapa mudou desde a resolucao; revisar documentos/saldos',
           strap_migration_cutover_id=p_cutover_id
     WHERE id=v_map.legacy_product_id;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'product_mapping',v_map.id,
      (SELECT to_jsonb(m) FROM public.legacy_strap_product_migration_maps m WHERE m.id=v_map.id));
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'product',v_source.id,
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_source.id));
    INSERT INTO public.artisanal_strap_migration_review_items(
      entity_type,legacy_id,status,reason,candidates
    ) VALUES (
      'legacy_product_mapping_drift',v_map.id::text,'review_required',
      'Mapa resolvido deixou de ser conservativo antes do cutover',
      jsonb_build_object('mapping_id',v_map.id,'blockers',v_blockers)
    )
    ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
    DO UPDATE SET reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
    PERFORM public.log_artisanal_strap_migration_event(
      'legacy_strap_product_mapping',v_map.id,'suspend',to_jsonb(v_map),
      (SELECT to_jsonb(m) FROM public.legacy_strap_product_migration_maps m WHERE m.id=v_map.id),
      v_reason,p_correlation_id);
    PERFORM public.log_artisanal_strap_migration_event(
      'product',v_source.id,'suspend',to_jsonb(v_source),
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_source.id),
      v_reason,p_correlation_id);
    RETURN jsonb_build_object('mapping_id',p_mapping_id,'applied',false,
      'reason','mapping_drift','blockers',v_blockers);
  END IF;

  SELECT coalesce(sum(p.quantity),0),coalesce(sum(p.current_stock),0),
         coalesce(sum(p.reserved_stock),0)
    INTO v_before_total,v_before_current,v_before_reserved
    FROM public.products p
   WHERE p.id=v_map.legacy_product_id OR p.id IN (
     SELECT a.target_product_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   );

  FOR v_source IN
    SELECT p.* FROM public.products p
     WHERE p.id=v_map.legacy_product_id OR p.id IN (
       SELECT a.target_product_id
         FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id
     ) ORDER BY p.id
  LOOP
    PERFORM public.record_artisanal_strap_migration_snapshot(
      p_cutover_id,'product',v_source.id,to_jsonb(v_source));
  END LOOP;
  PERFORM public.record_artisanal_strap_migration_snapshot(
    p_cutover_id,'product_mapping',v_map.id,to_jsonb(v_map));

  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.artisanal_strap_catalog_write','1',true);
  PERFORM set_config('app.strap_change_reason',v_reason,true);

  -- Status administrativo e disponibilidade da fonte sao eixos independentes.
  -- O mapa nunca arquiva/suspende/reativa variante. Para variante ativa, a
  -- origem escolhida so substitui a atual quando o resolver canonico confirma
  -- aquela fonte; indisponibilidade vira revisao nominal e nao bloqueia estoque
  -- acabado nem outra origem que ja esteja funcional.
  FOR v_variant IN
    SELECT v.* FROM public.artisanal_strap_variants v
    JOIN public.legacy_strap_product_migration_allocations a
      ON a.strap_variant_id=v.id
     WHERE a.mapping_id=v_map.id
     ORDER BY v.id FOR UPDATE OF v
  LOOP
    PERFORM public.record_artisanal_strap_migration_snapshot(
      p_cutover_id,'strap_variant',v_variant.id,to_jsonb(v_variant));
    v_source_availability:=public.resolve_artisanal_strap_source_availability(
      v_variant.id);
    v_source_allowed:=CASE v_map.replenishment_mode
      WHEN 'internal' THEN coalesce(
        (v_source_availability->>'internal_production_allowed')::boolean,false)
      WHEN 'buy_ready' THEN coalesce(
        (v_source_availability->>'buy_ready_purchase_allowed')::boolean,false)
      ELSE false
    END;
    v_source_block_reason:=CASE v_map.replenishment_mode
      WHEN 'internal' THEN v_source_availability->>'internal_block_reason'
      WHEN 'buy_ready' THEN v_source_availability->>'buy_ready_block_reason'
      ELSE 'replenishment_mode_invalid'
    END;

    IF v_variant.status<>'active' OR v_source_allowed THEN
      IF v_variant.min_stock_replenishment_mode
           IS DISTINCT FROM v_map.replenishment_mode THEN
        UPDATE public.artisanal_strap_variants
           SET min_stock_replenishment_mode=v_map.replenishment_mode,updated_at=now()
         WHERE id=v_variant.id;
      END IF;
      UPDATE public.artisanal_strap_migration_review_items ri SET
        status='resolved',
        resolution=jsonb_build_object(
          'mapping_id',v_map.id,'strap_variant_id',v_variant.id,
          'selected_mode',v_map.replenishment_mode,
          'source_availability',v_source_availability,
          'reason',v_reason),
        resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
       WHERE ri.migration_run_id=v_map.migration_run_id
         AND ri.entity_type='legacy_replenishment_source_unavailable'
         AND ri.legacy_id=v_variant.id::text
         AND ri.status='review_required';
    ELSE
      INSERT INTO public.artisanal_strap_migration_review_items(
        migration_run_id,entity_type,legacy_id,status,reason,candidates
      ) VALUES (
        v_map.migration_run_id,
        'legacy_replenishment_source_unavailable',v_variant.id::text,
        'review_required',
        'Fonte escolhida no mapa esta indisponivel; status administrativo e estoque acabado foram preservados',
        jsonb_build_object(
          'mapping_id',v_map.id,'strap_variant_id',v_variant.id,
          'requested_mode',v_map.replenishment_mode,
          'preserved_mode',v_variant.min_stock_replenishment_mode,
          'block_reason',v_source_block_reason,
          'source_availability',v_source_availability
        )
      )
      ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
      DO UPDATE SET migration_run_id=EXCLUDED.migration_run_id,
        reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
    END IF;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'strap_variant',v_variant.id,
      (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_variant',v_variant.id,'reconcile',to_jsonb(v_variant),
      (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id),
      v_reason,p_correlation_id);
  END LOOP;

  FOR v_allocation IN
    SELECT a.* FROM public.legacy_strap_product_migration_allocations a
     WHERE a.mapping_id=v_map.id AND a.target_product_id<>v_map.legacy_product_id
     ORDER BY a.target_product_id
  LOOP
    SELECT * INTO v_source FROM public.products
     WHERE id=v_map.legacy_product_id FOR UPDATE;
    SELECT * INTO v_target FROM public.products
     WHERE id=v_allocation.target_product_id FOR UPDATE;
    v_source_previous:=coalesce(v_source.quantity,0);
    v_source_new:=v_source_previous-v_allocation.quantity;
    v_target_previous:=coalesce(v_target.quantity,0);
    v_target_new:=v_target_previous+v_allocation.quantity;
    v_source_current_previous:=coalesce(v_source.current_stock,0);
    v_source_current_new:=v_source_current_previous-v_allocation.quantity;
    v_target_current_previous:=coalesce(v_target.current_stock,0);
    v_target_current_new:=v_target_current_previous+v_allocation.quantity;
    IF v_source_new<0
       OR v_source_current_new<0
       OR coalesce(v_source.reserved_stock,0)-v_allocation.reserved_stock<0 THEN
      RAISE EXCEPTION 'Conservacao violada durante split do produto %',v_source.id;
    END IF;

    UPDATE public.products SET
      quantity=v_source_new,
      current_stock=v_source_current_new,
      reserved_stock=coalesce(reserved_stock,0)-v_allocation.reserved_stock,
      updated_at=now()
     WHERE id=v_source.id;
    UPDATE public.products SET
      quantity=v_target_new,
      current_stock=v_target_current_new,
      reserved_stock=coalesce(reserved_stock,0)+v_allocation.reserved_stock,
      updated_at=now()
     WHERE id=v_target.id;

    v_out_movement_id:=NULL;
    v_in_movement_id:=NULL;
    IF v_allocation.quantity>0 THEN
      INSERT INTO public.stock_movements(
        product_id,movement_type,quantity,previous_stock,new_stock,description,
        movement_reason,strap_variant_id,finished_product_id,correlation_id
      ) VALUES (
        v_source.id,'out',v_allocation.quantity,v_source_previous,v_source_new,
        'Transferencia auditada de saldo legado de tira (cutover)','ajuste',
        v_allocation.strap_variant_id,v_source.id,p_correlation_id
      ) RETURNING id INTO v_out_movement_id;
      INSERT INTO public.stock_movements(
        product_id,movement_type,quantity,previous_stock,new_stock,description,
        movement_reason,strap_variant_id,finished_product_id,correlation_id
      ) VALUES (
        v_target.id,'in',v_allocation.quantity,v_target_previous,v_target_new,
        'Transferencia auditada de saldo legado para variante canonica','ajuste',
        v_allocation.strap_variant_id,v_target.id,p_correlation_id
      ) RETURNING id INTO v_in_movement_id;
    END IF;
    INSERT INTO public.legacy_strap_stock_transfers(
      cutover_id,mapping_id,allocation_id,source_product_id,target_product_id,
      quantity,reserved_stock,source_previous_quantity,source_new_quantity,
      target_previous_quantity,target_new_quantity,
      source_previous_current_stock,source_new_current_stock,
      target_previous_current_stock,target_new_current_stock,
      out_movement_id,in_movement_id,
      correlation_id
    ) VALUES (
      p_cutover_id,v_map.id,v_allocation.id,v_source.id,v_target.id,
      v_allocation.quantity,v_allocation.reserved_stock,
      v_source_previous,v_source_new,v_target_previous,v_target_new,
      v_source_current_previous,v_source_current_new,
      v_target_current_previous,v_target_current_new,
      v_out_movement_id,v_in_movement_id,p_correlation_id
    );
  END LOOP;

  -- O saldo que permanece no proprio produto legado so e aceito quando ele e o
  -- finished_product_id de uma das variantes explicitamente alocadas.
  SELECT * INTO v_source FROM public.products
   WHERE id=v_map.legacy_product_id FOR UPDATE;
  IF coalesce(v_source.quantity,0) IS DISTINCT FROM coalesce((
       SELECT a.quantity FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id AND a.target_product_id=v_map.legacy_product_id
     ),0)
     OR coalesce(v_source.current_stock,0) IS DISTINCT FROM coalesce((
       SELECT a.quantity FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id AND a.target_product_id=v_map.legacy_product_id
     ),0)
     OR coalesce(v_source.reserved_stock,0) IS DISTINCT FROM coalesce((
       SELECT a.reserved_stock FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id AND a.target_product_id=v_map.legacy_product_id
     ),0) THEN
    RAISE EXCEPTION 'Saldo residual nao confere com alocacao explicita do produto origem';
  END IF;

  -- Reservas, OCs e OS: apenas IDs fornecidos pelo Administrador. Nenhuma
  -- consulta por nome/cor tenta preencher lacunas.
  FOR v_allocation IN
    SELECT * FROM public.legacy_strap_product_migration_allocations
     WHERE mapping_id=v_map.id ORDER BY strap_variant_id
  LOOP
    v_expected_count:=cardinality(v_allocation.reservation_ids);
    v_processed_count:=0;
    FOR v_reservation IN
      SELECT r.* FROM public.material_reservations r
       WHERE r.id=ANY(v_allocation.reservation_ids)
       ORDER BY r.id FOR UPDATE
    LOOP
      IF v_reservation.product_id IS DISTINCT FROM v_map.legacy_product_id
         OR v_reservation.status NOT IN ('reserved','partially_consumed') THEN
        RAISE EXCEPTION 'Reserva atribuida % mudou de produto/status depois da resolucao',
          v_reservation.id USING ERRCODE='40001';
      END IF;
      PERFORM public.record_artisanal_strap_migration_snapshot(
        p_cutover_id,'material_reservation',v_reservation.id,to_jsonb(v_reservation));
      UPDATE public.material_reservations
         SET product_id=v_allocation.target_product_id,
             strap_variant_id=v_allocation.strap_variant_id,
             finished_product_id=v_allocation.target_product_id,
             correlation_id=p_correlation_id,updated_at=now()
       WHERE id=v_reservation.id;
      v_processed_count:=v_processed_count+1;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        p_cutover_id,'material_reservation',v_reservation.id,
        (SELECT to_jsonb(r) FROM public.material_reservations r WHERE r.id=v_reservation.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'material_reservation',v_reservation.id,'reconcile',to_jsonb(v_reservation),
        (SELECT to_jsonb(r) FROM public.material_reservations r WHERE r.id=v_reservation.id),
        v_reason,p_correlation_id);
    END LOOP;
    IF v_processed_count IS DISTINCT FROM v_expected_count THEN
      RAISE EXCEPTION 'Reservas atribuidas incompletas: esperado %, encontrado %',
        v_expected_count,v_processed_count USING ERRCODE='40001';
    END IF;

    PERFORM set_config('app.strap_po_engine','1',true);
    v_expected_count:=cardinality(v_allocation.purchase_order_item_ids);
    v_processed_count:=0;
    FOR v_purchase_item IN
      SELECT i.* FROM public.purchase_order_items i
       WHERE i.id=ANY(v_allocation.purchase_order_item_ids)
       ORDER BY i.id FOR UPDATE
    LOOP
      SELECT * INTO v_purchase_order FROM public.purchase_orders po
       WHERE po.id=v_purchase_item.purchase_order_id FOR UPDATE;
      IF v_purchase_item.product_id IS DISTINCT FROM v_map.legacy_product_id
         OR v_purchase_order.id IS NULL
         OR v_purchase_order.snapshot_locked_at IS NOT NULL
         OR public.normalize_strap_catalog_text(v_purchase_order.status) IN (
           'approved','aprovado','aprovada','sent','enviado','enviada',
           'partial','parcial'
         )
         OR NOT public.is_open_legacy_strap_purchase_order_status(
           v_purchase_order.status) THEN
        RAISE EXCEPTION 'Item de OC atribuido % mudou, fechou ou foi congelado',
          v_purchase_item.id USING ERRCODE='40001';
      END IF;
      PERFORM public.record_artisanal_strap_migration_snapshot(
        p_cutover_id,'purchase_order_item',v_purchase_item.id,to_jsonb(v_purchase_item));
      UPDATE public.purchase_order_items
         SET product_id=v_allocation.target_product_id,
             strap_variant_id=v_allocation.strap_variant_id
       WHERE id=v_purchase_item.id;
      v_processed_count:=v_processed_count+1;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        p_cutover_id,'purchase_order_item',v_purchase_item.id,
        (SELECT to_jsonb(i) FROM public.purchase_order_items i WHERE i.id=v_purchase_item.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'purchase_order_item',v_purchase_item.id,'reconcile',to_jsonb(v_purchase_item),
        (SELECT to_jsonb(i) FROM public.purchase_order_items i WHERE i.id=v_purchase_item.id),
        v_reason,p_correlation_id);
    END LOOP;
    IF v_processed_count IS DISTINCT FROM v_expected_count THEN
      RAISE EXCEPTION 'Itens de OC atribuidos incompletos: esperado %, encontrado %',
        v_expected_count,v_processed_count USING ERRCODE='40001';
    END IF;

    v_expected_count:=cardinality(v_allocation.service_order_item_ids);
    v_processed_count:=0;
    FOR v_service_item IN
      SELECT i.* FROM public.service_order_items i
       WHERE i.id=ANY(v_allocation.service_order_item_ids)
       ORDER BY i.id FOR UPDATE
    LOOP
      SELECT * INTO v_service_order FROM public.service_orders so
       WHERE so.id=v_service_item.service_order_id FOR UPDATE;
      IF v_service_item.finished_product_id IS DISTINCT FROM v_map.legacy_product_id
         OR v_service_order.id IS NULL
         OR NOT public.is_open_legacy_strap_service_status(
           v_service_item.line_status)
         OR NOT public.is_open_legacy_strap_service_status(
           v_service_order.status) THEN
        RAISE EXCEPTION 'Item de OS atribuido % mudou ou pertence a OS terminal',
          v_service_item.id USING ERRCODE='40001';
      END IF;
      PERFORM public.record_artisanal_strap_migration_snapshot(
        p_cutover_id,'service_order_item',v_service_item.id,to_jsonb(v_service_item));
      UPDATE public.service_order_items
         SET finished_product_id=v_allocation.target_product_id,
             strap_variant_id=v_allocation.strap_variant_id
       WHERE id=v_service_item.id;
      v_processed_count:=v_processed_count+1;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        p_cutover_id,'service_order_item',v_service_item.id,
        (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'service_order_item',v_service_item.id,'reconcile',to_jsonb(v_service_item),
        (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id),
        v_reason,p_correlation_id);
    END LOOP;
    IF v_processed_count IS DISTINCT FROM v_expected_count THEN
      RAISE EXCEPTION 'Itens de OS atribuidos incompletos: esperado %, encontrado %',
        v_expected_count,v_processed_count USING ERRCODE='40001';
    END IF;

    FOR v_demand IN
      SELECT d.* FROM public.sale_order_strap_demands d
       WHERE d.finished_product_id=v_map.legacy_product_id
         AND d.strap_variant_id=v_allocation.strap_variant_id
         AND d.is_current
         AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
       ORDER BY d.id FOR UPDATE
    LOOP
      PERFORM public.record_artisanal_strap_migration_snapshot(
        p_cutover_id,'sale_order_strap_demand',v_demand.id,to_jsonb(v_demand));
      UPDATE public.sale_order_strap_demands
         SET finished_product_id=v_allocation.target_product_id,
             correlation_id=p_correlation_id,updated_at=now()
       WHERE id=v_demand.id;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        p_cutover_id,'sale_order_strap_demand',v_demand.id,
        (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'sale_order_strap_demand',v_demand.id,'reconcile',to_jsonb(v_demand),
        (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id),
        v_reason,p_correlation_id);
    END LOOP;
  END LOOP;

  UPDATE public.products p
     SET strap_migration_status='migrated',strap_migration_reason=v_reason,
         strap_migration_cutover_id=p_cutover_id
   WHERE p.id=v_map.legacy_product_id OR p.id IN (
     SELECT a.target_product_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   );
  UPDATE public.legacy_strap_product_migration_maps
     SET status='applied',applied_cutover_id=p_cutover_id,applied_at=now(),updated_at=now()
   WHERE id=v_map.id;

  SELECT coalesce(sum(p.quantity),0),coalesce(sum(p.current_stock),0),
         coalesce(sum(p.reserved_stock),0)
    INTO v_after_total,v_after_current,v_after_reserved
    FROM public.products p
   WHERE p.id=v_map.legacy_product_id OR p.id IN (
     SELECT a.target_product_id
       FROM public.legacy_strap_product_migration_allocations a
      WHERE a.mapping_id=v_map.id
   );
  IF v_before_total IS DISTINCT FROM v_after_total
     OR v_before_current IS DISTINCT FROM v_after_current
     OR v_before_reserved IS DISTINCT FROM v_after_reserved THEN
    RAISE EXCEPTION 'Conservacao global falhou: quantidade % -> %, saldo atual % -> %, reservado % -> %',
      v_before_total,v_after_total,v_before_current,v_after_current,
      v_before_reserved,v_after_reserved;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.products p
     WHERE (p.id=v_map.legacy_product_id OR p.id IN (
       SELECT a.target_product_id
         FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id
     ))
       AND coalesce(p.reserved_stock,0) IS DISTINCT FROM coalesce((
         SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
           FROM public.material_reservations r
          WHERE r.product_id=p.id
            AND r.status IN ('reserved','partially_consumed')
       ),0)
  ) THEN
    RAISE EXCEPTION 'reserved_stock por target nao confere com reservas remapeadas';
  END IF;

  FOR v_source IN
    SELECT p.* FROM public.products p
     WHERE p.id=v_map.legacy_product_id OR p.id IN (
       SELECT a.target_product_id
         FROM public.legacy_strap_product_migration_allocations a
        WHERE a.mapping_id=v_map.id
     ) ORDER BY p.id
  LOOP
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'product',v_source.id,to_jsonb(v_source));
    PERFORM public.log_artisanal_strap_migration_event(
      'product',v_source.id,'reconcile',
      (SELECT s.before_data FROM public.artisanal_strap_migration_entity_snapshots s
        WHERE s.cutover_id=p_cutover_id AND s.entity_type='product'
          AND s.entity_id=v_source.id),
      to_jsonb(v_source),v_reason,p_correlation_id);
  END LOOP;
  PERFORM public.finish_artisanal_strap_migration_snapshot(
    p_cutover_id,'product_mapping',v_map.id,
    (SELECT to_jsonb(m) FROM public.legacy_strap_product_migration_maps m WHERE m.id=v_map.id));
  PERFORM public.log_artisanal_strap_migration_event(
    'legacy_strap_product_mapping',v_map.id,'reconcile',to_jsonb(v_map),
    (SELECT to_jsonb(m) FROM public.legacy_strap_product_migration_maps m WHERE m.id=v_map.id),
    v_reason,p_correlation_id);
  RETURN jsonb_build_object(
    'mapping_id',v_map.id,'legacy_product_id',v_map.legacy_product_id,
    'applied',true,'quantity_before',v_before_total,'quantity_after',v_after_total,
    'current_stock_before',v_before_current,'current_stock_after',v_after_current,
    'reserved_before',v_before_reserved,'reserved_after',v_after_reserved
  );
END;
$$;

-- Aplica um unico mapa que foi resolvido depois do cutover. A RPC nao reabre o
-- dry-run nem examina pendencias alheias: somente UUIDs presentes no mapa sao
-- bloqueados, fotografados, reconciliados e reenfileirados.
CREATE OR REPLACE FUNCTION public.apply_resolved_legacy_strap_product_mapping_incremental(
  p_cutover_id uuid,
  p_mapping_id uuid,
  p_expected_scope_checksum text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_map public.legacy_strap_product_migration_maps%ROWTYPE;
  v_application public.artisanal_strap_migration_incremental_applications%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_request_hash text;
  v_scope_before jsonb;
  v_scope_after jsonb;
  v_scope_checksum_before text;
  v_scope_checksum_after text;
  v_blockers jsonb;
  v_apply_result jsonb;
  v_pre_cutover jsonb;
  v_before jsonb;
  v_application_id uuid:=gen_random_uuid();
  v_product_ids uuid[]:=ARRAY[]::uuid[];
  v_variant_ids uuid[]:=ARRAY[]::uuid[];
  v_reservation_ids uuid[]:=ARRAY[]::uuid[];
  v_purchase_item_ids uuid[]:=ARRAY[]::uuid[];
  v_service_item_ids uuid[]:=ARRAY[]::uuid[];
  v_job_id uuid;
  v_variant_lock_id uuid;
  v_incremental_job_ids jsonb:='[]'::jsonb;
  v_all_cutover_job_ids jsonb:='[]'::jsonb;
  v_affected_variant_ids jsonb:='[]'::jsonb;
  v_affected_sale_order_ids jsonb:='[]'::jsonb;
  v_target_conservation jsonb:='[]'::jsonb;
  v_review_count bigint;
  v_final_status text;
  v_global_checksum_before text;
  v_preexisting_global_drift boolean:=false;
  v_post_checksum text;
  v_post_conservation jsonb;
  v_manifest_entry jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'correlation_id obrigatorio'; END IF;
  IF nullif(btrim(coalesce(p_idempotency_key,'')),'') IS NULL THEN
    RAISE EXCEPTION 'idempotency_key obrigatoria';
  END IF;
  IF lower(coalesce(p_expected_scope_checksum,'')) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'expected_scope_checksum SHA-256 obrigatorio';
  END IF;
  PERFORM set_config('app.strap_change_reason',v_reason,true);
  v_request_hash:=public.strap_payload_hash(jsonb_build_object(
    'cutover_id',p_cutover_id,'mapping_id',p_mapping_id,
    'expected_scope_checksum',lower(p_expected_scope_checksum),'reason',v_reason));

  -- Mesma ordem usada por apply/rollback global. O lock de idempotencia vem
  -- depois para que nenhuma combinacao de replay crie ciclo de advisory locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('artisanal-strap-legacy-cutover',0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-incremental:'||p_cutover_id::text||':'||btrim(p_idempotency_key),0));

  SELECT * INTO v_cutover FROM public.artisanal_strap_migration_cutovers
   WHERE id=p_cutover_id FOR UPDATE;
  IF NOT FOUND OR v_cutover.status NOT IN ('applied','applied_with_review') THEN
    RAISE EXCEPTION 'Cutover ativo aplicado/aplicado-com-revisao obrigatorio';
  END IF;
  v_global_checksum_before:=public.artisanal_strap_legacy_state_checksum();
  v_preexisting_global_drift:=v_global_checksum_before
    IS DISTINCT FROM v_cutover.post_state_checksum;

  -- Replay e consultado antes do estado do mapa: depois da primeira execucao o
  -- mapa esta applied por definicao, mas a mesma chave ainda deve responder.
  SELECT * INTO v_application
    FROM public.artisanal_strap_migration_incremental_applications a
   WHERE a.cutover_id=p_cutover_id AND a.idempotency_key=btrim(p_idempotency_key)
   FOR UPDATE;
  IF FOUND THEN
    IF v_application.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'Replay idempotente com payload divergente para %',p_idempotency_key
        USING ERRCODE='22000';
    END IF;
    IF v_application.mapping_id IS DISTINCT FROM p_mapping_id THEN
      RAISE EXCEPTION 'Replay idempotente aponta para outro mapa' USING ERRCODE='22000';
    END IF;
    RETURN coalesce(v_application.result,'{}'::jsonb)||jsonb_build_object(
      'application_status',v_application.status,'idempotent_replay',true,
      'correlation_id',v_application.correlation_id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_migration_incremental_applications a
     WHERE a.cutover_id=p_cutover_id AND a.mapping_id=p_mapping_id
  ) THEN
    RAISE EXCEPTION 'Mapa ja possui aplicacao incremental com outra chave idempotente';
  END IF;

  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapa de produto legado inexistente';
  END IF;
  -- Congela o payload do mapa antes de obter locks operacionais. O resolver usa
  -- a mesma chave, mas recebimentos/picking nao dependem dela e continuam com
  -- sua ordem natural item -> cabecalho -> produto.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-product-map:'||v_map.legacy_product_id::text,0));
  SELECT * INTO v_map FROM public.legacy_strap_product_migration_maps
   WHERE id=p_mapping_id FOR UPDATE;
  IF v_map.status<>'resolved' OR v_map.applied_cutover_id IS NOT NULL
     OR v_map.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'Aplicacao incremental exige mapa resolved ainda unapplied';
  END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_product_ids
    FROM (
      SELECT v_map.legacy_product_id AS id
      UNION
      SELECT a.target_product_id FROM public.legacy_strap_product_migration_allocations a
       WHERE a.mapping_id=p_mapping_id
    ) x;
  SELECT coalesce(
      array_agg(DISTINCT a.strap_variant_id ORDER BY a.strap_variant_id),
      ARRAY[]::uuid[])
    INTO v_variant_ids
    FROM public.legacy_strap_product_migration_allocations a
   WHERE a.mapping_id=p_mapping_id;
  FOREACH v_variant_lock_id IN ARRAY v_variant_ids
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:'||v_variant_lock_id::text,0));
  END LOOP;
  SELECT coalesce(array_agg(DISTINCT x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_reservation_ids
    FROM public.legacy_strap_product_migration_allocations a
    CROSS JOIN LATERAL unnest(a.reservation_ids) x(id)
   WHERE a.mapping_id=p_mapping_id;
  SELECT coalesce(array_agg(DISTINCT scope.id ORDER BY scope.id),ARRAY[]::uuid[])
    INTO v_purchase_item_ids
    FROM (
      SELECT x.id
        FROM public.legacy_strap_product_migration_allocations a
        CROSS JOIN LATERAL unnest(a.purchase_order_item_ids) x(id)
       WHERE a.mapping_id=p_mapping_id
      UNION
      SELECT i.id
        FROM public.purchase_order_items i
        JOIN public.purchase_orders po ON po.id=i.purchase_order_id
       WHERE i.product_id=v_map.legacy_product_id
         AND public.is_open_legacy_strap_purchase_order_status(po.status)
    ) scope;
  SELECT coalesce(array_agg(DISTINCT scope.id ORDER BY scope.id),ARRAY[]::uuid[])
    INTO v_service_item_ids
    FROM (
      SELECT x.id
        FROM public.legacy_strap_product_migration_allocations a
        CROSS JOIN LATERAL unnest(a.service_order_item_ids) x(id)
       WHERE a.mapping_id=p_mapping_id
      UNION
      SELECT i.id
        FROM public.service_order_items i
        JOIN public.service_orders so ON so.id=i.service_order_id
       WHERE i.finished_product_id=v_map.legacy_product_id
         AND public.is_open_legacy_strap_service_status(i.line_status)
         AND public.is_open_legacy_strap_service_status(so.status)
    ) scope;

  -- Locks deterministas de todo e somente o escopo que o helper pode tocar.
  -- A ordem item -> cabecalho -> reserva -> produto acompanha recebimento,
  -- apontamento terceirizado e consumo. O advisory do mapa, obtido acima,
  -- impede que o resolver troque as atribuicoes enquanto estes locks esperam.
  PERFORM 1 FROM public.legacy_strap_product_migration_allocations a
   WHERE a.mapping_id=p_mapping_id ORDER BY a.id FOR UPDATE;
  PERFORM 1 FROM public.purchase_order_items i WHERE i.id=ANY(v_purchase_item_ids)
   ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.purchase_orders po
   WHERE po.id IN (SELECT i.purchase_order_id FROM public.purchase_order_items i
                    WHERE i.id=ANY(v_purchase_item_ids))
   ORDER BY po.id FOR UPDATE;
  PERFORM 1 FROM public.service_order_items i WHERE i.id=ANY(v_service_item_ids)
   ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.service_orders so
   WHERE so.id IN (SELECT i.service_order_id FROM public.service_order_items i
                    WHERE i.id=ANY(v_service_item_ids))
   ORDER BY so.id FOR UPDATE;
  PERFORM 1 FROM public.material_reservations r
   WHERE r.product_id=ANY(v_product_ids) OR r.id=ANY(v_reservation_ids)
   ORDER BY r.id FOR UPDATE;
  PERFORM 1 FROM public.products p WHERE p.id=ANY(v_product_ids)
   ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.artisanal_strap_variants v WHERE v.id=ANY(v_variant_ids)
   ORDER BY v.id FOR UPDATE;
  PERFORM 1 FROM public.sale_order_strap_demands d
   WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
   ORDER BY d.id FOR UPDATE;
  PERFORM 1 FROM public.artisanal_strap_migration_review_items ri
   WHERE (ri.entity_type='legacy_product'
          AND ri.legacy_id=v_map.legacy_product_id::text)
      OR (ri.entity_type='legacy_product_mapping_drift'
          AND ri.legacy_id=p_mapping_id::text)
      OR (ri.entity_type='legacy_replenishment_mode' AND ri.legacy_id IN (
        SELECT x.id::text FROM unnest(v_variant_ids) AS x(id)))
      OR (ri.entity_type='legacy_replenishment_source_unavailable'
          AND ri.legacy_id IN (
        SELECT x.id::text FROM unnest(v_variant_ids) AS x(id)))
   ORDER BY ri.id FOR UPDATE;
  PERFORM 1 FROM public.stock_movements sm WHERE sm.product_id=ANY(v_product_ids)
   ORDER BY sm.id FOR UPDATE;

  v_blockers:=public.artisanal_strap_incremental_mapping_blockers(
    p_cutover_id,p_mapping_id);
  IF jsonb_array_length(v_blockers)>0 THEN
    RAISE EXCEPTION 'Mapa incremental bloqueado: %',v_blockers;
  END IF;
  v_scope_before:=public.artisanal_strap_product_mapping_scope_snapshot(
    p_cutover_id,p_mapping_id);
  v_scope_checksum_before:=public.strap_payload_hash(v_scope_before);
  IF v_scope_checksum_before IS DISTINCT FROM lower(p_expected_scope_checksum) THEN
    RAISE EXCEPTION 'Checksum escopado stale; recarregue diagnostics (esperado %, atual %)',
      lower(p_expected_scope_checksum),v_scope_checksum_before USING ERRCODE='40001';
  END IF;

  INSERT INTO public.artisanal_strap_migration_incremental_applications(
    id,cutover_id,mapping_id,status,idempotency_key,request_hash,
    expected_scope_checksum,scope_checksum_before,scope_before,
    reason,correlation_id,applied_by
  ) VALUES (
    v_application_id,p_cutover_id,p_mapping_id,'applying',btrim(p_idempotency_key),
    v_request_hash,lower(p_expected_scope_checksum),v_scope_checksum_before,
    v_scope_before,v_reason,p_correlation_id,auth.uid()
  );
  SELECT * INTO v_application
    FROM public.artisanal_strap_migration_incremental_applications
   WHERE id=v_application_id;

  v_apply_result:=public.apply_resolved_legacy_strap_product_mapping(
    p_mapping_id,p_cutover_id,v_reason,p_correlation_id);
  IF NOT coalesce((v_apply_result->>'applied')::boolean,false) THEN
    RAISE EXCEPTION 'Helper conservativo recusou aplicacao incremental: %',v_apply_result;
  END IF;

  -- O cutover preserva status administrativo; a aplicacao incremental tambem.
  -- Nao reativa, arquiva ou valida novamente uma variante que pode ter perdido
  -- uma fonte depois de ter sido ativada. A disponibilidade atual foi derivada
  -- pelo helper e, quando necessario, gerou revisao somente da fonte.
  FOREACH v_job_id IN ARRAY v_variant_ids
  LOOP
    SELECT * INTO v_variant FROM public.artisanal_strap_variants
     WHERE id=v_job_id FOR UPDATE;
    SELECT s.before_data INTO v_pre_cutover
      FROM public.artisanal_strap_migration_entity_snapshots s
     WHERE s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
       AND s.entity_id=v_variant.id;
    v_before:=to_jsonb(v_variant);
    IF v_pre_cutover IS NOT NULL
       AND v_variant.status IS DISTINCT FROM v_pre_cutover->>'status'
       AND coalesce(v_variant.review_reason,'') IN (
         'Produto acabado legado exige alocacao/split explicito',
         'Origem de reposicao do estoque minimo exige confirmacao administrativa'
       ) THEN
      RAISE EXCEPTION 'Status administrativo da variante % foi alterado por cutover legado; ajuste administrativo explicito obrigatorio',
        v_variant.id USING ERRCODE='40001';
    END IF;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'strap_variant',v_variant.id,
      (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_variant',v_variant.id,'reconcile',
      v_before,(SELECT to_jsonb(v) FROM public.artisanal_strap_variants v
        WHERE v.id=v_variant.id),v_reason,p_correlation_id);
  END LOOP;

  -- Somente a suspensao nominal criada pela ambiguidade deste produto volta ao
  -- status fotografado; suspensoes tecnicas/financeiras continuam intactas.
  FOR v_demand IN
    SELECT d.* FROM public.sale_order_strap_demands d
     WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
       AND d.status='suspended'
       AND d.suspension_reason='Variante/produto legado requer revisao de migracao'
     ORDER BY d.id FOR UPDATE
  LOOP
    SELECT s.before_data INTO v_pre_cutover
      FROM public.artisanal_strap_migration_entity_snapshots s
     WHERE s.cutover_id=p_cutover_id AND s.entity_type='sale_order_strap_demand'
       AND s.entity_id=v_demand.id;
    IF v_pre_cutover IS NULL OR nullif(v_pre_cutover->>'status','') IS NULL THEN
      RAISE EXCEPTION 'Snapshot pre-cutover ausente para demanda %',v_demand.id;
    END IF;
    UPDATE public.sale_order_strap_demands SET
      status=v_pre_cutover->>'status',
      suspended_from_status=v_pre_cutover->>'suspended_from_status',
      suspension_reason=v_pre_cutover->>'suspension_reason',
      suspended_by=nullif(v_pre_cutover->>'suspended_by','')::uuid,
      suspended_at=nullif(v_pre_cutover->>'suspended_at','')::timestamptz,
      correlation_id=p_correlation_id,updated_at=now()
     WHERE id=v_demand.id;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      p_cutover_id,'sale_order_strap_demand',v_demand.id,
      (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'sale_order_strap_demand',v_demand.id,'resume',to_jsonb(v_demand),
      (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id),
      v_reason,p_correlation_id);
  END LOOP;

  UPDATE public.artisanal_strap_migration_review_items ri SET
    status='resolved',
    resolution=jsonb_build_object('mapping_id',p_mapping_id,
      'incremental_application_id',v_application_id,'reason',v_reason),
    resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE ri.status='review_required' AND (
     (ri.entity_type='legacy_product' AND ri.legacy_id=v_map.legacy_product_id::text)
     OR (ri.entity_type='legacy_product_mapping_drift'
       AND ri.legacy_id=p_mapping_id::text)
     OR (ri.entity_type='legacy_replenishment_mode'
       AND ri.legacy_id IN (
         SELECT x.id::text FROM unnest(v_variant_ids) AS x(id)))
   );

  -- O trigger de catalogo normalmente ja enfileira ao restaurar active. O
  -- fallback explicito garante um job por variante ativa sem duplicar o job da
  -- mesma transacao.
  FOREACH v_job_id IN ARRAY v_variant_ids
  LOOP
    IF EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
                WHERE v.id=v_job_id AND v.status='active')
       AND NOT EXISTS (
         SELECT 1 FROM public.strap_demand_jobs j
          WHERE j.xmin::text::bigint=txid_current()
            AND j.source_type='strap_variant' AND j.source_id=v_job_id
       ) THEN
      PERFORM public.enqueue_strap_demand_job(
        'strap_variant',v_job_id,0,0,'catalog_changed',
        jsonb_build_object('strap_variant_id',v_job_id,'mapping_id',p_mapping_id,
          'incremental_application_id',v_application_id,
          'reason','legacy_migration_resolution_applied'),
        format('strap-migration-incremental:%s:variant:%s',v_application_id,v_job_id),
        p_correlation_id);
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(j.id ORDER BY j.id),'[]'::jsonb)
    INTO v_incremental_job_ids
    FROM public.strap_demand_jobs j
   WHERE j.xmin::text::bigint=txid_current()
     AND (
       (j.source_type IN ('strap_variant','stock') AND j.source_id=ANY(v_variant_ids))
       OR (j.source_type='sale_order' AND j.source_id IN (
         SELECT DISTINCT d.sale_order_id FROM public.sale_order_strap_demands d
          WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
       ))
       OR (j.source_type='purchase_order' AND j.source_id IN (
         SELECT DISTINCT i.purchase_order_id FROM public.purchase_order_items i
          WHERE i.id=ANY(v_purchase_item_ids)
       ))
       OR (j.source_type IN ('service_order','custody') AND j.source_id IN (
         SELECT DISTINCT i.service_order_id FROM public.service_order_items i
          WHERE i.id=ANY(v_service_item_ids)
       ))
     );
  SELECT coalesce(jsonb_agg(x.id ORDER BY x.id),'[]'::jsonb)
    INTO v_all_cutover_job_ids
    FROM (
      SELECT value::uuid AS id
        FROM jsonb_array_elements_text(
          coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)) e(value)
      UNION
      SELECT j.id FROM public.strap_demand_jobs j
       WHERE j.xmin::text::bigint=txid_current()
         AND (
           (j.source_type IN ('strap_variant','stock') AND j.source_id=ANY(v_variant_ids))
           OR (j.source_type='sale_order' AND j.source_id IN (
             SELECT DISTINCT d.sale_order_id FROM public.sale_order_strap_demands d
              WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
           ))
           OR (j.source_type='purchase_order' AND j.source_id IN (
             SELECT DISTINCT i.purchase_order_id FROM public.purchase_order_items i
              WHERE i.id=ANY(v_purchase_item_ids)
           ))
           OR (j.source_type IN ('service_order','custody') AND j.source_id IN (
             SELECT DISTINCT i.service_order_id FROM public.service_order_items i
              WHERE i.id=ANY(v_service_item_ids)
           ))
         )
    ) x;

  SELECT coalesce(jsonb_agg(x.id ORDER BY x.id),'[]'::jsonb)
    INTO v_affected_variant_ids FROM unnest(v_variant_ids) x(id);
  SELECT coalesce(jsonb_agg(x.id ORDER BY x.id),'[]'::jsonb)
    INTO v_affected_sale_order_ids
    FROM (
      SELECT DISTINCT d.sale_order_id AS id
        FROM public.sale_order_strap_demands d
       WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
    ) x;

  v_scope_after:=public.artisanal_strap_product_mapping_scope_snapshot(
    p_cutover_id,p_mapping_id);
  v_scope_checksum_after:=public.strap_payload_hash(v_scope_after);

  -- Assertion por target, nao apenas soma global. O self-target deve terminar
  -- exatamente na alocacao; os demais preservam o saldo anterior e recebem a
  -- parcela declarada. current_stock acompanha quantity sem excecao.
  IF EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_allocations a
      JOIN public.products p ON p.id=a.target_product_id
      CROSS JOIN LATERAL (
        SELECT (x->>'quantity')::numeric AS quantity,
               (x->>'current_stock')::numeric AS current_stock,
               (x->>'reserved_stock')::numeric AS reserved_stock
          FROM jsonb_array_elements(v_scope_before->'products') x
         WHERE x->>'id'=a.target_product_id::text
      ) b
     WHERE a.mapping_id=p_mapping_id AND (
       coalesce(p.quantity,0) IS DISTINCT FROM CASE
         WHEN a.target_product_id=v_map.legacy_product_id THEN a.quantity
         ELSE coalesce(b.quantity,0)+a.quantity END
       OR coalesce(p.current_stock,0) IS DISTINCT FROM CASE
         WHEN a.target_product_id=v_map.legacy_product_id THEN a.quantity
         ELSE coalesce(b.current_stock,0)+a.quantity END
       OR coalesce(p.reserved_stock,0) IS DISTINCT FROM CASE
         WHEN a.target_product_id=v_map.legacy_product_id THEN a.reserved_stock
         ELSE coalesce(b.reserved_stock,0)+a.reserved_stock END
       OR coalesce(p.reserved_stock,0) IS DISTINCT FROM coalesce((
         SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
           FROM public.material_reservations r
          WHERE r.product_id=p.id
            AND r.status IN ('reserved','partially_consumed')
       ),0)
     )
  ) THEN
    RAISE EXCEPTION 'Conservacao incremental por target falhou';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'strap_variant_id',a.strap_variant_id,
      'target_product_id',a.target_product_id,
      'allocated_quantity',a.quantity,
      'allocated_reserved_stock',a.reserved_stock,
      'quantity_before',b.quantity,'quantity_after',p.quantity,
      'current_stock_before',b.current_stock,'current_stock_after',p.current_stock,
      'reserved_stock_before',b.reserved_stock,'reserved_stock_after',p.reserved_stock,
      'open_reservation_balance_after',coalesce((SELECT sum(greatest(
        r.quantity_reserved-r.quantity_consumed,0)) FROM public.material_reservations r
        WHERE r.product_id=p.id AND r.status IN ('reserved','partially_consumed')),0)
    ) ORDER BY a.strap_variant_id),'[]'::jsonb)
    INTO v_target_conservation
    FROM public.legacy_strap_product_migration_allocations a
    JOIN public.products p ON p.id=a.target_product_id
    CROSS JOIN LATERAL (
      SELECT (x->>'quantity')::numeric AS quantity,
             (x->>'current_stock')::numeric AS current_stock,
             (x->>'reserved_stock')::numeric AS reserved_stock
        FROM jsonb_array_elements(v_scope_before->'products') x
       WHERE x->>'id'=a.target_product_id::text
    ) b
   WHERE a.mapping_id=p_mapping_id;

  SELECT count(*) INTO v_review_count
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.status='review_required';
  v_final_status:=CASE WHEN v_review_count>0
    THEN 'applied_with_review' ELSE 'applied' END;
  v_post_checksum:=public.artisanal_strap_legacy_state_checksum();
  v_post_conservation:=public.artisanal_strap_legacy_conservation_report();
  v_result:=jsonb_build_object(
    'application_id',v_application_id,'cutover_id',p_cutover_id,
    'mapping_id',p_mapping_id,'status','applied',
    'cutover_status',v_final_status,
    'scope_checksum_before',v_scope_checksum_before,
    'scope_checksum_after',v_scope_checksum_after,
    'previous_post_state_checksum',v_cutover.post_state_checksum,
    'global_checksum_before',v_global_checksum_before,
    'preexisting_global_drift',v_preexisting_global_drift,
    'post_state_checksum',v_post_checksum,
    'affected_variant_ids',v_affected_variant_ids,
    'affected_sale_order_ids',v_affected_sale_order_ids,
    'enqueued_job_ids',v_incremental_job_ids,
    'target_conservation',v_target_conservation,
    'idempotent_replay',false,'correlation_id',p_correlation_id
  );
  UPDATE public.artisanal_strap_migration_incremental_applications SET
    status='applied',scope_checksum_after=v_scope_checksum_after,
    scope_after=v_scope_after,result=v_result,applied_at=now(),updated_at=now()
   WHERE id=v_application_id;

  v_manifest_entry:=jsonb_build_object(
    'application_id',v_application_id,'mapping_id',p_mapping_id,
    'scope_checksum_before',v_scope_checksum_before,
    'scope_checksum_after',v_scope_checksum_after,
    'previous_post_state_checksum',v_cutover.post_state_checksum,
    'global_checksum_before',v_global_checksum_before,
    'preexisting_global_drift',v_preexisting_global_drift,
    'affected_variant_ids',v_affected_variant_ids,
    'job_ids',v_incremental_job_ids,'applied_at',now(),
    'correlation_id',p_correlation_id);
  UPDATE public.artisanal_strap_migration_cutovers SET
    status=v_final_status,post_state_checksum=v_post_checksum,
    manifest=manifest||jsonb_build_object(
      'post_state_checksum',v_post_checksum,
      'post_conservation',v_post_conservation,
      'review_required_count',v_review_count,
      'snapshots',(SELECT count(*)
        FROM public.artisanal_strap_migration_entity_snapshots s
        WHERE s.cutover_id=p_cutover_id),
      'stock_transfers',(SELECT count(*) FROM public.legacy_strap_stock_transfers t
        WHERE t.cutover_id=p_cutover_id),
      'cutover_job_ids',v_all_cutover_job_ids,
      'cutover_job_count',jsonb_array_length(v_all_cutover_job_ids),
      'incremental_applications',coalesce(
        manifest->'incremental_applications','[]'::jsonb)
          ||jsonb_build_array(v_manifest_entry)
    ),updated_at=now()
   WHERE id=p_cutover_id;
  UPDATE public.artisanal_strap_migration_runs SET
    status=CASE WHEN v_review_count>0 THEN 'review_required' ELSE 'completed' END,
    report=report||jsonb_build_object(
      'incremental_applications',coalesce(
        report->'incremental_applications','[]'::jsonb)
          ||jsonb_build_array(v_manifest_entry))
   WHERE id=v_cutover.migration_run_id;

  PERFORM public.log_artisanal_strap_migration_event(
    'artisanal_strap_migration_incremental_application',v_application_id,
    'reconcile',to_jsonb(v_application),
    (SELECT to_jsonb(a) FROM public.artisanal_strap_migration_incremental_applications a
      WHERE a.id=v_application_id),v_reason,p_correlation_id);
  PERFORM public.log_artisanal_strap_migration_event(
    'artisanal_strap_migration_cutover',p_cutover_id,'reconcile',to_jsonb(v_cutover),
    (SELECT to_jsonb(c) FROM public.artisanal_strap_migration_cutovers c
      WHERE c.id=p_cutover_id),v_reason,p_correlation_id);
  RETURN v_result;
END;
$$;

-- A RPC generica de 03000 nao pode transformar uma escolha textual em falso
-- sucesso. Somente o piso de reposicao possui payload suficiente para executar
-- a operacao real nesta assinatura; os demais tipos encaminham o Administrador
-- para a RPC concreta que carrega suas FKs/UUIDs obrigatorias.
CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_migration_review_item(
  p_review_item_id uuid,
  p_resolution jsonb,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.artisanal_strap_migration_review_items%ROWTYPE;
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_availability jsonb;
  v_mode text;
  v_restore_status text;
  v_restore_review_reason text;
  v_source_allowed boolean:=false;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_correlation_id uuid:=gen_random_uuid();
  v_instruction text;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'artisanal-strap-legacy-cutover',0));
  IF jsonb_typeof(p_resolution)<>'object' OR p_resolution='{}'::jsonb THEN
    RAISE EXCEPTION 'Resolucao explicita e obrigatoria';
  END IF;

  -- Leitura sem lock apenas para escolher a raiz operacional. Para piso, a
  -- variante e travada antes da review, mesma ordem usada pelo apply.
  SELECT * INTO v_item
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.id=p_review_item_id;
  IF NOT FOUND OR v_item.status<>'review_required' THEN
    RAISE EXCEPTION 'Pendencia inexistente ou ja resolvida';
  END IF;

  IF v_item.entity_type NOT IN (
    'legacy_replenishment_mode','legacy_replenishment_source_unavailable'
  ) THEN
    SELECT * INTO v_item
      FROM public.artisanal_strap_migration_review_items ri
     WHERE ri.id=p_review_item_id FOR UPDATE;
    v_instruction:=CASE
      WHEN v_item.entity_type IN (
        'technical_line_ambiguous','technical_line_content_mismatch'
      ) THEN 'Use resolve_technical_strap_line_migration com measure_id canonico.'
      WHEN v_item.entity_type IN (
        'legacy_recipe','open_service_order_legacy_recipe',
        'open_service_order_recipe_mismatch'
      ) THEN 'Use resolve_legacy_artisanal_recipe_migration com canonical_recipe_id.'
      WHEN v_item.entity_type IN (
        'legacy_product','legacy_product_mapping_drift'
      ) THEN 'Use resolve_legacy_strap_product_migration e, apos cutover, o apply incremental escopado.'
      WHEN v_item.entity_type='open_sale_order_item_ambiguous'
        THEN 'Resolva a linha tecnica e a origem no item do PV; esta pendencia nao aceita baixa administrativa sem reconciliar o documento.'
      ELSE 'Use a operacao concreta do catalogo/documento; baixa generica de review foi bloqueada.'
    END;
    RAISE EXCEPTION 'Pendencia % exige operacao real; status nao foi alterado',
      v_item.entity_type USING ERRCODE='22023',HINT=v_instruction;
  END IF;

  BEGIN
    SELECT * INTO v_variant
      FROM public.artisanal_strap_variants v
     WHERE v.id=v_item.legacy_id::uuid FOR UPDATE;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Pendencia de piso possui legacy_id invalido';
  END;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante da pendencia nao existe'; END IF;

  SELECT * INTO v_item
    FROM public.artisanal_strap_migration_review_items ri
   WHERE ri.id=p_review_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.status<>'review_required'
     OR v_item.entity_type NOT IN (
       'legacy_replenishment_mode','legacy_replenishment_source_unavailable'
     )
     OR v_item.legacy_id IS DISTINCT FROM v_variant.id::text
     OR (
       nullif(v_item.candidates->>'strap_variant_id','') IS NOT NULL
       AND v_item.candidates->>'strap_variant_id' IS DISTINCT FROM v_variant.id::text
     ) THEN
    RAISE EXCEPTION 'Pendencia de piso mudou enquanto era resolvida'
      USING ERRCODE='40001';
  END IF;

  v_mode:=coalesce(
    nullif(p_resolution->>'min_stock_replenishment_mode',''),
    nullif(p_resolution->>'replenishment_mode',''),
    nullif(p_resolution->>'selected_mode',''),
    nullif(p_resolution->>'mode','')
  );
  IF v_mode NOT IN ('internal','buy_ready') THEN
    RAISE EXCEPTION 'Resolucao do piso exige min_stock_replenishment_mode internal ou buy_ready';
  END IF;

  v_before:=to_jsonb(v_variant);
  v_restore_status:=v_variant.status;
  v_restore_review_reason:=v_variant.review_reason;
  IF v_item.entity_type='legacy_replenishment_mode'
     AND v_variant.status='review_required'
     AND v_variant.review_reason=
       'Origem de reposicao do estoque minimo exige confirmacao administrativa' THEN
    SELECT s.before_data->>'status',s.before_data->>'review_reason'
      INTO v_restore_status,v_restore_review_reason
      FROM public.artisanal_strap_migration_entity_snapshots s
      JOIN public.artisanal_strap_migration_cutovers c ON c.id=s.cutover_id
     WHERE c.migration_run_id=v_item.migration_run_id
       AND s.entity_type='strap_variant' AND s.entity_id=v_variant.id
     ORDER BY c.created_at DESC LIMIT 1;
    IF v_restore_status IS NULL THEN
      RAISE EXCEPTION 'Snapshot administrativo pre-cutover ausente; nao e seguro reativar variante';
    END IF;
  END IF;

  v_availability:=public.resolve_artisanal_strap_source_availability(v_variant.id);
  v_source_allowed:=CASE v_mode
    WHEN 'internal' THEN coalesce(
      (v_availability->>'internal_production_allowed')::boolean,false)
    WHEN 'buy_ready' THEN coalesce(
      (v_availability->>'buy_ready_purchase_allowed')::boolean,false)
    ELSE false
  END;
  IF v_item.entity_type='legacy_replenishment_source_unavailable'
     AND (v_variant.status<>'active' OR NOT v_source_allowed) THEN
    RAISE EXCEPTION 'Fonte % continua indisponivel; pendencia permanece aberta: %',
      v_mode,v_availability USING ERRCODE='23514';
  END IF;

  PERFORM set_config('app.strap_change_reason',v_reason,true);
  PERFORM set_config('app.artisanal_strap_catalog_write','1',true);
  PERFORM set_config('app.strap_source_admin_override','1',true);
  UPDATE public.artisanal_strap_variants SET
    min_stock_replenishment_mode=v_mode,
    status=v_restore_status,
    review_reason=v_restore_review_reason,
    updated_at=now()
   WHERE id=v_variant.id;

  SELECT * INTO v_variant FROM public.artisanal_strap_variants
   WHERE id=v_variant.id FOR UPDATE;
  v_availability:=public.resolve_artisanal_strap_source_availability(v_variant.id);
  v_source_allowed:=CASE v_mode
    WHEN 'internal' THEN coalesce(
      (v_availability->>'internal_production_allowed')::boolean,false)
    WHEN 'buy_ready' THEN coalesce(
      (v_availability->>'buy_ready_purchase_allowed')::boolean,false)
    ELSE false
  END;
  IF v_variant.status='active' AND NOT v_source_allowed THEN
    RAISE EXCEPTION 'Fonte % nao ficou disponivel apos atualizacao; pendencia permanece aberta: %',
      v_mode,v_availability USING ERRCODE='23514';
  END IF;

  UPDATE public.artisanal_strap_migration_review_items ri SET
    status='resolved',
    resolution=p_resolution||jsonb_build_object(
      'reason',v_reason,'strap_variant_id',v_variant.id,
      'min_stock_replenishment_mode',v_mode,
      'source_availability',v_availability,
      'correlation_id',v_correlation_id),
    resolved_by=auth.uid(),resolved_at=now(),updated_at=now()
   WHERE ri.id=v_item.id AND ri.status='review_required'
  RETURNING * INTO v_item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendencia mudou antes do fechamento' USING ERRCODE='40001';
  END IF;

  v_after:=to_jsonb(v_variant);
  PERFORM public.log_artisanal_strap_migration_event(
    'strap_variant',v_variant.id,
    CASE WHEN v_before->>'status' IS DISTINCT FROM v_after->>'status'
      THEN 'resume' ELSE 'update' END,
    v_before,v_after,v_reason,v_correlation_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.strap_demand_jobs j
     WHERE j.xmin::text::bigint=txid_current()
       AND j.source_type='strap_variant' AND j.source_id=v_variant.id
  ) THEN
    PERFORM public.enqueue_strap_demand_job(
      'strap_variant',v_variant.id,0,0,'catalog_changed',
      jsonb_build_object('strap_variant_id',v_variant.id,
        'migration_review_item_id',v_item.id,
        'reason','legacy_replenishment_review_resolved'),
      format('strap-migration-review:%s',v_item.id),v_correlation_id);
  END IF;
  RETURN to_jsonb(v_item)||jsonb_build_object(
    'variant',v_after,'source_availability',v_availability,
    'correlation_id',v_correlation_id);
END;
$$;

-- Fecha a pendencia do PV somente depois de o worker ter materializado uma
-- demanda corrente para CADA linha tecnica, exatamente conforme o sourcing
-- persistido. Tambem reata apenas demandas que o proprio cutover suspendeu;
-- qualquer suspensao administrativa ou drift deixa a review aberta.
CREATE OR REPLACE FUNCTION public.try_resolve_open_sale_order_item_strap_migration(
  p_sale_order_item_id uuid,
  p_correlation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_review public.artisanal_strap_migration_review_items%ROWTYPE;
  v_review_json jsonb;
  v_cutover_id uuid;
  v_actor_id uuid;
  v_line_count integer;
  v_preview_count integer;
  v_blocked_count integer;
  v_mismatch_count integer;
  v_current_count integer;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_snapshot_before jsonb;
  v_snapshot_after jsonb;
  v_item_before jsonb;
  v_reason constant text:='PV legado reconciliado por identidade, origem e demanda canonicas';
BEGIN
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'correlation_id obrigatorio para reconciliar PV legado';
  END IF;
  SELECT * INTO v_item FROM public.sale_order_items i
   WHERE i.id=p_sale_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT to_jsonb(ri),c.id,coalesce(
      auth.uid(),
      (
        SELECT DISTINCT (j.payload->>'requested_by')::uuid
          FROM public.strap_demand_jobs j
         WHERE j.correlation_id=p_correlation_id
           AND coalesce(j.payload->>'requested_by','')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ),c.applied_by,r.run_by
    )
    INTO v_review_json,v_cutover_id,v_actor_id
    FROM public.artisanal_strap_migration_review_items ri
    JOIN public.artisanal_strap_migration_cutovers c
      ON c.migration_run_id=ri.migration_run_id
     AND c.status IN ('applied','applied_with_review')
    JOIN public.artisanal_strap_migration_entity_snapshots s
      ON s.cutover_id=c.id AND s.entity_type='sale_order_item'
     AND s.entity_id=v_item.id
    JOIN public.artisanal_strap_migration_runs r ON r.id=ri.migration_run_id
   WHERE ri.entity_type='open_sale_order_item_ambiguous'
     AND ri.legacy_id=v_item.id::text
     AND ri.status='review_required'
     AND ri.candidates->>'sale_order_item_id'=v_item.id::text
     AND ri.candidates->>'sale_order_id'=v_item.sale_order_id::text
     AND c.id=v_item.strap_migration_cutover_id
   FOR UPDATE OF ri;
  IF NOT FOUND THEN RETURN false; END IF;
  v_review:=jsonb_populate_record(
    NULL::public.artisanal_strap_migration_review_items,v_review_json);
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autor nominal ausente para fechar pendencia do PV legado';
  END IF;

  IF jsonb_typeof(v_item.strap_colors)<>'array'
     OR jsonb_array_length(v_item.strap_colors)=0
     OR jsonb_typeof(v_item.strap_sourcing)<>'object' THEN
    RETURN false;
  END IF;
  v_line_count:=jsonb_array_length(v_item.strap_colors);
  IF jsonb_object_length(v_item.strap_sourcing)<>v_line_count
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_item.strap_colors)
           WITH ORDINALITY e(value,ordinality)
        WHERE coalesce(e.value->>'technical_strap_line_id','')
                !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR NOT (v_item.strap_sourcing ? (e.value->>'technical_strap_line_id'))
           OR jsonb_typeof(v_item.strap_sourcing->(e.value->>'technical_strap_line_id'))
                <>'object'
           OR v_item.strap_sourcing->(e.value->>'technical_strap_line_id')->>'source_mode'
                NOT IN ('internal','buy_ready')
           OR coalesce(v_item.strap_sourcing->(e.value->>'technical_strap_line_id')
                ->>'strap_variant_id','')
                !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR NOT EXISTS (
             SELECT 1
               FROM public.technical_strap_line_identity_map m
               JOIN public.artisanal_strap_measures measure ON measure.id=m.measure_id
              WHERE m.technical_sheet_id=v_item.reference_id
                AND m.legacy_path='strap_colors'
                AND m.legacy_ordinal=e.ordinality-1
                AND m.technical_strap_line_id::text=
                  e.value->>'technical_strap_line_id'
                AND m.measure_id::text=e.value->>'measure_id'
                AND measure.strap_type_id::text=e.value->>'strap_type_id'
                AND m.status='resolved'
           )
     ) OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(v_item.strap_sourcing) k(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_item.strap_colors) e(value)
           WHERE e.value->>'technical_strap_line_id'=k.key
        )
     ) THEN
    RETURN false;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE jsonb_array_length(p.blocking_reasons)>0),
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.sale_order_strap_demands d
            WHERE d.sale_order_item_id=v_item.id AND d.is_current
              AND d.technical_strap_line_id=p.technical_strap_line_id
              AND d.strap_variant_id=p.strap_variant_id
              AND d.source_mode=p.source_mode
              AND d.finished_product_id=p.finished_product_id
              AND d.recipe_id IS NOT DISTINCT FROM p.recipe_id
              AND d.base_product_id IS NOT DISTINCT FROM p.base_product_id
              AND d.gross_required_m=p.gross_required_m
         ))
    INTO v_preview_count,v_blocked_count,v_mismatch_count
    FROM public.preview_sale_order_strap_demand(v_item.sale_order_id) p
   WHERE p.sale_order_item_id=v_item.id;
  SELECT count(*) INTO v_current_count
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id=v_item.id AND d.is_current;
  IF v_preview_count<>v_line_count OR v_blocked_count<>0
     OR v_mismatch_count<>0 OR v_current_count<>v_preview_count THEN
    RETURN false;
  END IF;

  -- Preflight de TODAS as demandas antes da primeira escrita; uma suspensao
  -- administrativa entre as linhas nao pode causar retomada parcial.
  IF EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
      LEFT JOIN public.artisanal_strap_migration_entity_snapshots s
        ON s.cutover_id=v_cutover_id
       AND s.entity_type='sale_order_strap_demand' AND s.entity_id=d.id
     WHERE d.sale_order_item_id=v_item.id AND d.is_current
       AND (
         d.status IN ('error','cancelled','superseded')
         OR (
           d.status='suspended' AND (
             s.entity_id IS NULL
             OR d.suspension_reason<>
               'Linha tecnica do PV requer escolha explicita apos migracao'
             OR s.after_data->>'status'<>'suspended'
             OR s.after_data->>'suspension_reason'<>
               'Linha tecnica do PV requer escolha explicita apos migracao'
             OR s.before_data->>'status' IS DISTINCT FROM d.suspended_from_status
           )
         )
       )
  ) THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.strap_engine_write','1',true);
  FOR v_demand IN
    SELECT d.* FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id=v_item.id AND d.is_current
     ORDER BY d.id FOR UPDATE
  LOOP
    IF v_demand.status='suspended' THEN
      SELECT s.before_data,s.after_data
        INTO v_snapshot_before,v_snapshot_after
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=v_cutover_id
         AND s.entity_type='sale_order_strap_demand'
         AND s.entity_id=v_demand.id;
      IF NOT FOUND
         OR v_demand.suspension_reason<>
           'Linha tecnica do PV requer escolha explicita apos migracao'
         OR v_snapshot_after->>'status'<>'suspended'
         OR v_snapshot_after->>'suspension_reason'<>
           'Linha tecnica do PV requer escolha explicita apos migracao'
         OR v_snapshot_before->>'status' IS DISTINCT FROM
           v_demand.suspended_from_status THEN
        RETURN false;
      END IF;
      UPDATE public.sale_order_strap_demands SET
        status=v_snapshot_before->>'status',
        suspended_from_status=v_snapshot_before->>'suspended_from_status',
        suspension_reason=v_snapshot_before->>'suspension_reason',
        suspended_by=nullif(v_snapshot_before->>'suspended_by','')::uuid,
        suspended_at=nullif(v_snapshot_before->>'suspended_at','')::timestamptz,
        correlation_id=p_correlation_id,updated_at=now()
       WHERE id=v_demand.id;
      PERFORM public.log_artisanal_strap_migration_event(
        'sale_order_strap_demand',v_demand.id,'resume',to_jsonb(v_demand),
        (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d
          WHERE d.id=v_demand.id),v_reason,p_correlation_id);
    END IF;
  END LOOP;

  -- O worker ja reconciliou a versao corrente. Se uma demanda foi apenas
  -- reatada acima (payload identico), recalcula a variante na mesma transacao.
  PERFORM public.reconcile_strap_variant(x.strap_variant_id,p_correlation_id,
      'legacy_sale_order_review_resolved')
    FROM (
      SELECT DISTINCT d.strap_variant_id
        FROM public.sale_order_strap_demands d
       WHERE d.sale_order_item_id=v_item.id AND d.is_current
       ORDER BY d.strap_variant_id
    ) x;

  IF EXISTS (
    SELECT 1 FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id=v_item.id AND d.is_current
       AND d.status IN ('suspended','error','cancelled','superseded')
  ) THEN
    RAISE EXCEPTION 'Reconciliacao do PV legado deixou demanda suspensa/invalida'
      USING ERRCODE='55000';
  END IF;

  v_item_before:=to_jsonb(v_item);
  UPDATE public.sale_order_items SET
    strap_migration_status='migrated',
    strap_migration_reason=v_reason
   WHERE id=v_item.id;
  UPDATE public.artisanal_strap_migration_review_items ri SET
    status='resolved',
    resolution=jsonb_build_object(
      'sale_order_id',v_item.sale_order_id,
      'sale_order_item_id',v_item.id,
      'cutover_id',v_cutover_id,
      'strap_sourcing_revision',v_item.strap_sourcing_revision,
      'demand_count',v_current_count,
      'reason',v_reason,
      'correlation_id',p_correlation_id),
    resolved_by=v_actor_id,resolved_at=now(),updated_at=now()
   WHERE ri.id=v_review.id AND ri.status='review_required';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendencia do item de PV mudou durante reconciliacao'
      USING ERRCODE='40001';
  END IF;
  PERFORM public.log_artisanal_strap_migration_event(
    'sale_order_item',v_item.id,'reconcile',v_item_before,
    (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id=v_item.id),
    v_reason,p_correlation_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_resolve_open_sale_order_item_strap_migration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item_id uuid;
BEGIN
  IF NEW.source_type='sale_order' AND NEW.status='completed'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    FOR v_item_id IN
      SELECT i.id
        FROM public.sale_order_items i
       WHERE i.sale_order_id=NEW.source_id
         AND EXISTS (
           SELECT 1 FROM public.artisanal_strap_migration_review_items ri
            WHERE ri.entity_type='open_sale_order_item_ambiguous'
              AND ri.legacy_id=i.id::text AND ri.status='review_required'
         )
       ORDER BY i.id
    LOOP
      PERFORM public.try_resolve_open_sale_order_item_strap_migration(
        v_item_id,NEW.correlation_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_open_sale_order_item_strap_migration
  ON public.strap_demand_jobs;
CREATE TRIGGER trg_resolve_open_sale_order_item_strap_migration
AFTER UPDATE OF status ON public.strap_demand_jobs
FOR EACH ROW EXECUTE FUNCTION
  public.tg_resolve_open_sale_order_item_strap_migration();

CREATE OR REPLACE FUNCTION public.artisanal_strap_legacy_conservation_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH affected_products AS (
    SELECT p.id
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.is_artisanal OR coalesce(pg.is_artisanal_strap,false)
        OR EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
                    WHERE v.finished_product_id=p.id)
        OR EXISTS (SELECT 1 FROM public.legacy_strap_product_migration_maps m
                    WHERE m.legacy_product_id=p.id)
        OR EXISTS (SELECT 1 FROM public.legacy_strap_product_migration_allocations a
                    WHERE a.target_product_id=p.id)
  ), report AS (
    SELECT jsonb_build_object(
      'generated_at',now(),
      'products',jsonb_build_object(
        'count',(SELECT count(*) FROM affected_products),
        'quantity_total',(SELECT coalesce(sum(p.quantity),0) FROM public.products p
          WHERE p.id IN (SELECT id FROM affected_products)),
        'current_stock_total',(SELECT coalesce(sum(p.current_stock),0) FROM public.products p
          WHERE p.id IN (SELECT id FROM affected_products)),
        'reserved_stock_total',(SELECT coalesce(sum(p.reserved_stock),0) FROM public.products p
          WHERE p.id IN (SELECT id FROM affected_products)),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(p.id,p.quantity,p.current_stock,p.reserved_stock) ORDER BY p.id)
          FROM public.products p WHERE p.id IN (SELECT id FROM affected_products)),'[]'::jsonb))
      ),
      'reservations',jsonb_build_object(
        'count',(SELECT count(*) FROM public.material_reservations r
          WHERE r.product_id IN (SELECT id FROM affected_products)),
        'quantity_reserved_total',(SELECT coalesce(sum(r.quantity_reserved),0)
          FROM public.material_reservations r
          WHERE r.product_id IN (SELECT id FROM affected_products)),
        'quantity_consumed_total',(SELECT coalesce(sum(r.quantity_consumed),0)
          FROM public.material_reservations r
          WHERE r.product_id IN (SELECT id FROM affected_products)),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(r.id,r.product_id,r.quantity_reserved,r.quantity_consumed,r.status)
          ORDER BY r.id) FROM public.material_reservations r
          WHERE r.product_id IN (SELECT id FROM affected_products)),'[]'::jsonb))
      ),
      'purchase_inbounds',jsonb_build_object(
        'count',(SELECT count(*) FROM public.purchase_order_items i
          WHERE i.product_id IN (SELECT id FROM affected_products)),
        'quantity_total',(SELECT coalesce(sum(i.quantity),0) FROM public.purchase_order_items i
          WHERE i.product_id IN (SELECT id FROM affected_products)),
        'received_total',(SELECT coalesce(sum(i.received_quantity),0)
          FROM public.purchase_order_items i
          WHERE i.product_id IN (SELECT id FROM affected_products)),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(i.id,i.product_id,i.quantity,i.received_quantity,i.strap_variant_id)
          ORDER BY i.id) FROM public.purchase_order_items i
          WHERE i.product_id IN (SELECT id FROM affected_products)),'[]'::jsonb))
      ),
      'stock_movements',jsonb_build_object(
        'count',(SELECT count(*) FROM public.stock_movements sm
          WHERE sm.product_id IN (SELECT id FROM affected_products)),
        'in_total',(SELECT coalesce(sum(sm.quantity),0) FROM public.stock_movements sm
          WHERE sm.product_id IN (SELECT id FROM affected_products) AND sm.movement_type='in'),
        'out_total',(SELECT coalesce(sum(sm.quantity),0) FROM public.stock_movements sm
          WHERE sm.product_id IN (SELECT id FROM affected_products) AND sm.movement_type='out'),
        'signed_net',(SELECT coalesce(sum(CASE WHEN sm.movement_type='in' THEN sm.quantity
          WHEN sm.movement_type='out' THEN -sm.quantity ELSE 0 END),0)
          FROM public.stock_movements sm
          WHERE sm.product_id IN (SELECT id FROM affected_products)),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(sm.id,sm.product_id,sm.movement_type,sm.quantity,
            sm.previous_stock,sm.new_stock,sm.strap_variant_id,sm.correlation_id)
          ORDER BY sm.id) FROM public.stock_movements sm
          WHERE sm.product_id IN (SELECT id FROM affected_products)),'[]'::jsonb))
      ),
      'sale_order_items',jsonb_build_object(
        'count',(SELECT count(*) FROM public.sale_order_items i
          WHERE jsonb_typeof(i.strap_colors)='array' AND jsonb_array_length(i.strap_colors)>0),
        'pairs_total',(SELECT coalesce(sum(i.quantity),0) FROM public.sale_order_items i
          WHERE jsonb_typeof(i.strap_colors)='array' AND jsonb_array_length(i.strap_colors)>0),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(i.id,i.quantity,md5(i.strap_colors::text)) ORDER BY i.id)
          FROM public.sale_order_items i WHERE jsonb_typeof(i.strap_colors)='array'
          AND jsonb_array_length(i.strap_colors)>0),'[]'::jsonb))
      ),
      'service_orders',jsonb_build_object(
        'count',(SELECT count(*) FROM public.service_orders so
          WHERE so.artisanal_recipe_id IS NOT NULL OR so.canonical_strap_recipe_id IS NOT NULL),
        'output_m_total',(SELECT coalesce(sum(so.artisanal_output_meters),0)
          FROM public.service_orders so
          WHERE so.artisanal_recipe_id IS NOT NULL OR so.canonical_strap_recipe_id IS NOT NULL),
        'checksum',public.strap_payload_hash(coalesce((SELECT jsonb_agg(
          jsonb_build_array(so.id,so.artisanal_recipe_id,so.canonical_strap_recipe_id,
            so.artisanal_output_meters,so.status) ORDER BY so.id)
          FROM public.service_orders so WHERE so.artisanal_recipe_id IS NOT NULL
             OR so.canonical_strap_recipe_id IS NOT NULL),'[]'::jsonb))
      )
    ) payload
  )
  SELECT payload||jsonb_build_object('overall_checksum',
    public.strap_payload_hash(payload-'generated_at')) FROM report;
$$;

CREATE OR REPLACE FUNCTION public.apply_artisanal_strap_migration(
  p_run_id uuid,
  p_expected_checksum text,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.artisanal_strap_migration_runs%ROWTYPE;
  v_cutover_id uuid;
  v_fresh_report jsonb;
  v_fresh_checksum text;
  v_pre_checksum text;
  v_post_checksum text;
  v_pre_conservation jsonb;
  v_post_conservation jsonb;
  v_results jsonb:='[]'::jsonb;
  v_result jsonb;
  v_manifest jsonb;
  v_review_count bigint:=0;
  v_map record;
  v_product record;
  v_variant record;
  v_demand record;
  v_item record;
  v_order record;
  v_service_item record;
  v_recipe_map record;
  v_before jsonb;
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_invalid_identity boolean;
  v_final_status text;
  v_cutover_job_ids jsonb:='[]'::jsonb;
  v_variant_lock_id uuid;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'correlation_id obrigatorio'; END IF;
  IF coalesce(p_expected_checksum,'')!~'^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Checksum esperado do dry-run deve possuir 32 hexadecimais';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('artisanal-strap-legacy-cutover',0));
  -- O cutover global pode fotografar/reclassificar qualquer variante atual.
  -- Congele todo o conjunto em UUID crescente antes do primeiro row lock.
  FOR v_variant_lock_id IN
    SELECT v.id FROM public.artisanal_strap_variants v ORDER BY v.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:'||v_variant_lock_id::text,0));
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.artisanal_strap_migration_cutovers
    WHERE status IN ('applying','applied','applied_with_review')) THEN
    RAISE EXCEPTION 'Ja existe cutover ativo; valide ou reverta antes de outro';
  END IF;
  SELECT * INTO v_run FROM public.artisanal_strap_migration_runs
   WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dry-run inexistente'; END IF;

  -- O dry-run precisa ser repetido depois de qualquer resolucao que altere a
  -- ficha. Assim o checksum fornecido representa exatamente o estado travado.
  v_fresh_report:=public.preview_artisanal_strap_catalog_migration();
  v_fresh_checksum:=md5((v_fresh_report->'checks')::text);
  IF lower(v_run.overall_checksum)<>lower(p_expected_checksum)
     OR lower(v_fresh_checksum)<>lower(p_expected_checksum) THEN
    RAISE EXCEPTION 'Dry-run stale: informado %, persistido %, atual %',
      p_expected_checksum,v_run.overall_checksum,v_fresh_checksum;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.technical_strap_line_identity_map m
      JOIN public.technical_sheets ts ON ts.id=m.technical_sheet_id
      JOIN public.artisanal_strap_measures measure ON measure.id=m.measure_id
     WHERE m.status='resolved' AND (
       jsonb_typeof(ts.strap_colors) IS DISTINCT FROM 'array'
       OR ts.strap_colors->m.legacy_ordinal IS NULL
       OR ts.strap_colors->m.legacy_ordinal->>'technical_strap_line_id'
            IS DISTINCT FROM m.technical_strap_line_id::text
       OR ts.strap_colors->m.legacy_ordinal->>'measure_id'
            IS DISTINCT FROM m.measure_id::text
       OR ts.strap_colors->m.legacy_ordinal->>'strap_type_id'
            IS DISTINCT FROM measure.strap_type_id::text
     )
  ) THEN
    RAISE EXCEPTION 'Linha tecnica marcada resolved ainda nao foi persistida com UUID, medida e familia; execute resolve_technical_strap_line_migration e gere novo dry-run';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_migration_review_items ri
      LEFT JOIN public.artisanal_strap_migration_product_provenance pp
        ON pp.migration_run_id=ri.migration_run_id
       AND pp.legacy_product_id::text=ri.legacy_id
       AND pp.review_item_id=ri.id
     WHERE ri.migration_run_id=p_run_id
       AND ri.entity_type='legacy_product'
       AND pp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Dry-run possui produto legado sem proveniencia nominal congelada';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_migration_product_provenance pp
      JOIN public.products p ON p.id=pp.legacy_product_id
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE pp.migration_run_id=p_run_id
       AND (
         pp.dry_run_checksum IS DISTINCT FROM v_run.overall_checksum
         OR pp.review_snapshot->>'migration_run_id' IS DISTINCT FROM p_run_id::text
         OR pp.review_snapshot->>'entity_type' IS DISTINCT FROM 'legacy_product'
         OR pp.review_snapshot->>'legacy_id' IS DISTINCT FROM p.id::text
         OR pp.review_snapshot->'candidates'->>'product_id' IS DISTINCT FROM p.id::text
         OR pp.review_snapshot->'candidates'->>'group_id' IS DISTINCT FROM p.group_id::text
         OR pp.product_snapshot->>'id' IS DISTINCT FROM p.id::text
         OR pp.provenance_checksum IS DISTINCT FROM public.strap_payload_hash(
           jsonb_build_object(
             'migration_run_id',pp.migration_run_id,
             'dry_run_checksum',pp.dry_run_checksum,
             'review_snapshot',pp.review_snapshot,
             'product_snapshot',pp.product_snapshot
           )
         )
         OR NOT (coalesce(p.is_artisanal,false)
                 OR coalesce(pg.is_artisanal_strap,false))
       )
  ) THEN
    RAISE EXCEPTION 'Proveniencia nominal do dry-run divergiu antes do cutover';
  END IF;

  v_pre_checksum:=public.artisanal_strap_legacy_state_checksum();
  v_pre_conservation:=public.artisanal_strap_legacy_conservation_report();
  INSERT INTO public.artisanal_strap_migration_cutovers(
    migration_run_id,status,dry_run_checksum,pre_state_checksum,reason,
    correlation_id,applied_by
  ) VALUES (
    p_run_id,'applying',lower(p_expected_checksum),v_pre_checksum,v_reason,
    p_correlation_id,auth.uid()
  ) RETURNING id INTO v_cutover_id;

  PERFORM set_config('app.strap_change_reason',v_reason,true);
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.strap_source_admin_override','1',true);
  PERFORM set_config('app.strap_po_engine','1',true);
  PERFORM set_config('app.artisanal_strap_catalog_write','1',true);

  -- Produto acabado ja apontado por uma variante e inequivoco pela propria FK.
  -- Nao participa do fluxo automatico se a origem de reposicao do piso ainda
  -- estiver vazia; nesse caso somente a variante afetada entra em revisao.
  FOR v_variant IN
    SELECT v.*
      FROM public.artisanal_strap_variants v
      JOIN public.products p ON p.id=v.finished_product_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.legacy_strap_product_migration_allocations a
        WHERE a.target_product_id=v.finished_product_id
     )
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_migration_review_items ri
          WHERE ri.migration_run_id=p_run_id
            AND ri.entity_type='legacy_product'
            AND ri.legacy_id=p.id::text
            AND ri.status='review_required'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
          WHERE pp.migration_run_id=p_run_id
            AND pp.legacy_product_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.legacy_strap_product_migration_maps lm
          WHERE lm.legacy_product_id=p.id AND lm.status='review_required'
       )
     ORDER BY v.id FOR UPDATE OF v,p
  LOOP
    SELECT * INTO v_product FROM public.products
     WHERE id=v_variant.finished_product_id FOR UPDATE;
    PERFORM public.record_artisanal_strap_migration_snapshot(
      v_cutover_id,'product',v_product.id,to_jsonb(v_product));
    PERFORM public.record_artisanal_strap_migration_snapshot(
      v_cutover_id,'strap_variant',v_variant.id,to_jsonb(v_variant));
    IF v_variant.min_stock_replenishment_mode IS NULL THEN
      UPDATE public.artisanal_strap_variants
         SET status=CASE WHEN status='archived' THEN status ELSE 'review_required' END,
             review_reason='Origem de reposicao do estoque minimo exige confirmacao administrativa',
             updated_at=now()
       WHERE id=v_variant.id;
      UPDATE public.products SET
        strap_migration_status='review_required',
        strap_migration_reason='Variante canonica sem min_stock_replenishment_mode confirmado',
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_product.id;
      INSERT INTO public.artisanal_strap_migration_review_items(
        migration_run_id,entity_type,legacy_id,status,reason,candidates
      ) VALUES (
        p_run_id,'legacy_replenishment_mode',v_variant.id::text,'review_required',
        'Origem de reposicao nao pode ser inferida de is_artisanal/PV/ordem',
        jsonb_build_object('strap_variant_id',v_variant.id,
          'finished_product_id',v_variant.finished_product_id,
          'allowed_modes',jsonb_build_array('internal','buy_ready'))
      ) ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
      DO UPDATE SET migration_run_id=EXCLUDED.migration_run_id,
        reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
    ELSE
      UPDATE public.products SET
        strap_migration_status='migrated',
        strap_migration_reason='Produto acabado ja canonico por finished_product_id',
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_product.id;
    END IF;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      v_cutover_id,'product',v_product.id,
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_product.id));
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      v_cutover_id,'strap_variant',v_variant.id,
      (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'product',v_product.id,
      CASE WHEN v_variant.min_stock_replenishment_mode IS NULL THEN 'suspend' ELSE 'reconcile' END,
      to_jsonb(v_product),
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_product.id),
      v_reason,p_correlation_id);
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_variant',v_variant.id,
      CASE WHEN v_variant.min_stock_replenishment_mode IS NULL THEN 'suspend' ELSE 'reconcile' END,
      to_jsonb(v_variant),
      (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id),
      v_reason,p_correlation_id);
  END LOOP;

  FOR v_map IN
    SELECT m.id FROM public.legacy_strap_product_migration_maps m
     WHERE m.status='resolved' AND m.migration_run_id=p_run_id
     ORDER BY m.legacy_product_id
  LOOP
    v_result:=public.apply_resolved_legacy_strap_product_mapping(
      v_map.id,v_cutover_id,v_reason,p_correlation_id);
    v_results:=v_results||jsonb_build_array(v_result);
  END LOOP;

  -- Produto artesanal ainda sem mapa explicito fica acionavel, sem mover saldo.
  FOR v_product IN
    SELECT p.* FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE (p.is_artisanal OR coalesce(pg.is_artisanal_strap,false))
       AND EXISTS (
         SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
          WHERE pp.migration_run_id=p_run_id AND pp.legacy_product_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.legacy_strap_product_migration_maps m
          WHERE m.legacy_product_id=p.id AND m.migration_run_id=p_run_id
            AND m.status='applied'
       )
     ORDER BY p.id FOR UPDATE OF p
  LOOP
    PERFORM public.record_artisanal_strap_migration_snapshot(
      v_cutover_id,'product',v_product.id,to_jsonb(v_product));
    UPDATE public.products SET
      strap_migration_status='review_required',
      strap_migration_reason='Produto legado sem alocacao explicita conservativa',
      strap_migration_cutover_id=v_cutover_id
     WHERE id=v_product.id;
    FOR v_variant IN
      SELECT v.* FROM public.artisanal_strap_variants v
       WHERE v.finished_product_id=v_product.id
       ORDER BY v.id FOR UPDATE
    LOOP
      PERFORM public.record_artisanal_strap_migration_snapshot(
        v_cutover_id,'strap_variant',v_variant.id,to_jsonb(v_variant));
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        v_cutover_id,'strap_variant',v_variant.id,
        (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'strap_variant',v_variant.id,'reconcile',to_jsonb(v_variant),
        (SELECT to_jsonb(v) FROM public.artisanal_strap_variants v WHERE v.id=v_variant.id),
        v_reason,p_correlation_id);
    END LOOP;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      v_cutover_id,'product',v_product.id,
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_product.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'product',v_product.id,'suspend',to_jsonb(v_product),
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_product.id),
      v_reason,p_correlation_id);
  END LOOP;

  -- Linhas de demanda de variante afetada sao suspensas, mas fatos fisicos ja
  -- comprometidos continuam disponiveis para recebimento/estorno pelas RPCs.
  FOR v_demand IN
    SELECT d.* FROM public.sale_order_strap_demands d
    JOIN public.artisanal_strap_variants v ON v.id=d.strap_variant_id
    JOIN public.products p ON p.id=v.finished_product_id
     WHERE d.is_current
       AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended')
       AND (v.status='review_required' OR p.strap_migration_status='review_required')
     ORDER BY d.id FOR UPDATE OF d
  LOOP
    PERFORM public.record_artisanal_strap_migration_snapshot(
      v_cutover_id,'sale_order_strap_demand',v_demand.id,to_jsonb(v_demand));
    UPDATE public.sale_order_strap_demands SET
      suspended_from_status=status,status='suspended',
      suspension_reason='Variante/produto legado requer revisao de migracao',
      suspended_by=auth.uid(),suspended_at=now(),
      correlation_id=p_correlation_id,updated_at=now()
     WHERE id=v_demand.id;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      v_cutover_id,'sale_order_strap_demand',v_demand.id,
      (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'sale_order_strap_demand',v_demand.id,'suspend',to_jsonb(v_demand),
      (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id),
      v_reason,p_correlation_id);
  END LOOP;

  -- PV aberto: cada elemento deve possuir UUID estavel resolvido. Qualquer
  -- snapshot legado divergente volta a origem vazia e suspende sua demanda.
  FOR v_item IN
    SELECT i.*,so.status AS sale_order_status
      FROM public.sale_order_items i JOIN public.sale_orders so ON so.id=i.sale_order_id
     WHERE public.is_open_legacy_strap_sale_order_status(so.status)
       AND jsonb_typeof(i.strap_colors)='array'
       AND jsonb_array_length(i.strap_colors)>0
     ORDER BY i.id FOR UPDATE OF i
  LOOP
    SELECT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(v_item.strap_colors)
          WITH ORDINALITY AS e(value,ordinality)
       WHERE coalesce(e.value->>'technical_strap_line_id','')
               !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR NOT EXISTS (
            SELECT 1
              FROM public.technical_strap_line_identity_map m
              JOIN public.artisanal_strap_measures measure ON measure.id=m.measure_id
             WHERE m.technical_sheet_id=v_item.reference_id
               AND m.legacy_path='strap_colors'
               AND m.legacy_ordinal=e.ordinality-1
               AND m.technical_strap_line_id::text=e.value->>'technical_strap_line_id'
               AND m.measure_id::text=e.value->>'measure_id'
               AND measure.strap_type_id::text=e.value->>'strap_type_id'
               AND m.status='resolved'
          )
    ) INTO v_invalid_identity;
    PERFORM public.record_artisanal_strap_migration_snapshot(
      v_cutover_id,'sale_order_item',v_item.id,to_jsonb(v_item));
    IF v_invalid_identity THEN
      UPDATE public.sale_order_items SET
        strap_sourcing='{}'::jsonb,
        strap_migration_status='review_required',
        strap_migration_reason='Linha tecnica ambigua; origem deve ser escolhida novamente',
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_item.id;
      INSERT INTO public.artisanal_strap_migration_review_items(
        migration_run_id,entity_type,legacy_id,status,reason,candidates
      ) VALUES (
        p_run_id,'open_sale_order_item_ambiguous',v_item.id::text,'review_required',
        'PV aberto possui linha tecnica sem UUID resolvido; nenhum default foi aplicado',
        jsonb_build_object('sale_order_id',v_item.sale_order_id,
          'sale_order_item_id',v_item.id,'reference_id',v_item.reference_id)
      ) ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
      DO UPDATE SET migration_run_id=EXCLUDED.migration_run_id,
        reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
      FOR v_demand IN
        SELECT d.* FROM public.sale_order_strap_demands d
         WHERE d.sale_order_item_id=v_item.id AND d.is_current
           AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended')
         ORDER BY d.id FOR UPDATE
      LOOP
        PERFORM public.record_artisanal_strap_migration_snapshot(
          v_cutover_id,'sale_order_strap_demand',v_demand.id,to_jsonb(v_demand));
        UPDATE public.sale_order_strap_demands SET
          suspended_from_status=status,status='suspended',
          suspension_reason='Linha tecnica do PV requer escolha explicita apos migracao',
          suspended_by=auth.uid(),suspended_at=now(),
          correlation_id=p_correlation_id,updated_at=now()
         WHERE id=v_demand.id;
        PERFORM public.finish_artisanal_strap_migration_snapshot(
          v_cutover_id,'sale_order_strap_demand',v_demand.id,
          (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id));
        PERFORM public.log_artisanal_strap_migration_event(
          'sale_order_strap_demand',v_demand.id,'suspend',to_jsonb(v_demand),
          (SELECT to_jsonb(d) FROM public.sale_order_strap_demands d WHERE d.id=v_demand.id),
          v_reason,p_correlation_id);
      END LOOP;
    ELSE
      UPDATE public.sale_order_items SET
        strap_migration_status='migrated',
        strap_migration_reason='Linhas tecnicas UUID reconciliadas no cutover',
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_item.id;
    END IF;
    PERFORM public.finish_artisanal_strap_migration_snapshot(
      v_cutover_id,'sale_order_item',v_item.id,
      (SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id=v_item.id));
    PERFORM public.log_artisanal_strap_migration_event(
      'sale_order_item',v_item.id,CASE WHEN v_invalid_identity THEN 'suspend' ELSE 'reconcile' END,
      to_jsonb(v_item),(SELECT to_jsonb(i) FROM public.sale_order_items i WHERE i.id=v_item.id),
      v_reason,p_correlation_id);
  END LOOP;

  -- Ponte de receita para todas as OS por FK legada. Aberta e ambigua suspende;
  -- finalizada ambigua permanece intocada e continua visivel na view historica.
  FOR v_order IN
    SELECT so.* FROM public.service_orders so
     WHERE so.artisanal_recipe_id IS NOT NULL ORDER BY so.id FOR UPDATE
  LOOP
    SELECT m.* INTO v_recipe_map FROM public.legacy_artisanal_recipe_map m
     WHERE m.legacy_recipe_id=v_order.artisanal_recipe_id AND m.status='resolved';
    IF FOUND THEN
      PERFORM public.record_artisanal_strap_migration_snapshot(
        v_cutover_id,'service_order',v_order.id,to_jsonb(v_order));
      UPDATE public.service_orders SET
        canonical_strap_recipe_id=v_recipe_map.canonical_recipe_id,
        strap_migration_status='migrated',strap_migration_reason=v_reason,
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_order.id;
      FOR v_service_item IN
        SELECT i.* FROM public.service_order_items i
         WHERE i.service_order_id=v_order.id AND i.strap_variant_id IS NOT NULL
         ORDER BY i.id FOR UPDATE
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.artisanal_strap_variants v
          JOIN public.artisanal_strap_recipes r
            ON r.id=v_recipe_map.canonical_recipe_id
           AND r.measure_id=v.measure_id AND r.base_group_id=v.base_group_id
           WHERE v.id=v_service_item.strap_variant_id
        ) THEN
          PERFORM public.record_artisanal_strap_migration_snapshot(
            v_cutover_id,'service_order_item',v_service_item.id,to_jsonb(v_service_item));
          UPDATE public.service_order_items
             SET strap_recipe_id=v_recipe_map.canonical_recipe_id
           WHERE id=v_service_item.id;
          PERFORM public.finish_artisanal_strap_migration_snapshot(
            v_cutover_id,'service_order_item',v_service_item.id,
            (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id));
          PERFORM public.log_artisanal_strap_migration_event(
            'service_order_item',v_service_item.id,'reconcile',to_jsonb(v_service_item),
            (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id),
            v_reason,p_correlation_id);
        ELSIF public.is_open_legacy_strap_service_status(v_service_item.line_status) THEN
          PERFORM public.record_artisanal_strap_migration_snapshot(
            v_cutover_id,'service_order_item',v_service_item.id,to_jsonb(v_service_item));
          UPDATE public.service_order_items SET
            suspended_from_status=coalesce(suspended_from_status,line_status),
            line_status='Suspensa',suspension_reason='Receita canonica incompativel com variante',
            suspended_by=auth.uid(),suspended_at=now()
           WHERE id=v_service_item.id;
          PERFORM public.finish_artisanal_strap_migration_snapshot(
            v_cutover_id,'service_order_item',v_service_item.id,
            (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id));
          PERFORM public.log_artisanal_strap_migration_event(
            'service_order_item',v_service_item.id,'suspend',to_jsonb(v_service_item),
            (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id),
            v_reason,p_correlation_id);
        END IF;
      END LOOP;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        v_cutover_id,'service_order',v_order.id,
        (SELECT to_jsonb(so) FROM public.service_orders so WHERE so.id=v_order.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'service_order',v_order.id,'reconcile',to_jsonb(v_order),
        (SELECT to_jsonb(so) FROM public.service_orders so WHERE so.id=v_order.id),
        v_reason,p_correlation_id);
    ELSIF public.is_open_legacy_strap_service_status(v_order.status) THEN
      PERFORM public.record_artisanal_strap_migration_snapshot(
        v_cutover_id,'service_order',v_order.id,to_jsonb(v_order));
      UPDATE public.service_orders SET
        strap_migration_previous_status=coalesce(strap_migration_previous_status,status),
        status='Suspensa',strap_migration_status='review_required',
        strap_migration_reason='Receita legada ambigua/nao resolvida',
        strap_migration_cutover_id=v_cutover_id
       WHERE id=v_order.id;
      FOR v_service_item IN
        SELECT i.* FROM public.service_order_items i
         WHERE i.service_order_id=v_order.id
           AND public.is_open_legacy_strap_service_status(i.line_status)
         ORDER BY i.id FOR UPDATE
      LOOP
        PERFORM public.record_artisanal_strap_migration_snapshot(
          v_cutover_id,'service_order_item',v_service_item.id,to_jsonb(v_service_item));
        UPDATE public.service_order_items SET
          suspended_from_status=coalesce(suspended_from_status,line_status),
          line_status='Suspensa',suspension_reason='Receita legada requer resolucao',
          suspended_by=auth.uid(),suspended_at=now()
         WHERE id=v_service_item.id;
        PERFORM public.finish_artisanal_strap_migration_snapshot(
          v_cutover_id,'service_order_item',v_service_item.id,
          (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id));
        PERFORM public.log_artisanal_strap_migration_event(
          'service_order_item',v_service_item.id,'suspend',to_jsonb(v_service_item),
          (SELECT to_jsonb(i) FROM public.service_order_items i WHERE i.id=v_service_item.id),
          v_reason,p_correlation_id);
      END LOOP;
      PERFORM public.finish_artisanal_strap_migration_snapshot(
        v_cutover_id,'service_order',v_order.id,
        (SELECT to_jsonb(so) FROM public.service_orders so WHERE so.id=v_order.id));
      PERFORM public.log_artisanal_strap_migration_event(
        'service_order',v_order.id,'suspend',to_jsonb(v_order),
        (SELECT to_jsonb(so) FROM public.service_orders so WHERE so.id=v_order.id),
        v_reason,p_correlation_id);
      INSERT INTO public.artisanal_strap_migration_review_items(
        migration_run_id,entity_type,legacy_id,status,reason,candidates
      ) VALUES (
        p_run_id,'open_service_order_legacy_recipe',v_order.id::text,'review_required',
        'OS aberta possui receita legada sem mapa canonico resolvido',
        jsonb_build_object('service_order_id',v_order.id,
          'legacy_recipe_id',v_order.artisanal_recipe_id)
      ) ON CONFLICT (entity_type,legacy_id) WHERE status='review_required'
      DO UPDATE SET migration_run_id=EXCLUDED.migration_run_id,
        reason=EXCLUDED.reason,candidates=EXCLUDED.candidates,updated_at=now();
    END IF;
  END LOOP;

  -- O nome do trigger e load-bearing: mesmo que uma instalacao intermediaria o
  -- tenha recriado, a virada final remove nominalmente a baixa na criacao da OS.
  EXECUTE 'DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders';

  -- O trigger de item do PV e DEFERRABLE. Forca sua execucao antes de congelar
  -- o manifesto, para que nenhum job nasca depois do post-checksum. Os IDs
  -- criados nesta mesma transacao ficam registrados: rollback so e seguro se
  -- ainda estiverem intactos/nao processados e os cancela antes de restaurar.
  EXECUTE 'SET CONSTRAINTS trg_enqueue_strap_demands_on_item_change IMMEDIATE';
  SELECT coalesce(jsonb_agg(j.id ORDER BY j.id),'[]'::jsonb)
    INTO v_cutover_job_ids
    FROM public.strap_demand_jobs j
   WHERE j.xmin::text::bigint=txid_current();

  SELECT count(*) INTO v_review_count
    FROM public.artisanal_strap_migration_review_items
   WHERE status='review_required';
  v_final_status:=CASE WHEN v_review_count>0 THEN 'applied_with_review' ELSE 'applied' END;
  v_post_checksum:=public.artisanal_strap_legacy_state_checksum();
  v_post_conservation:=public.artisanal_strap_legacy_conservation_report();
  v_manifest:=jsonb_build_object(
    'cutover_id',v_cutover_id,'dry_run_id',p_run_id,
    'dry_run_checksum',p_expected_checksum,
    'pre_state_checksum',v_pre_checksum,'post_state_checksum',v_post_checksum,
    'pre_conservation',v_pre_conservation,'post_conservation',v_post_conservation,
    'product_mapping_results',v_results,
    'review_required_count',v_review_count,
    'snapshots',(SELECT count(*) FROM public.artisanal_strap_migration_entity_snapshots
      WHERE cutover_id=v_cutover_id),
    'stock_transfers',(SELECT count(*) FROM public.legacy_strap_stock_transfers
      WHERE cutover_id=v_cutover_id),
    'cutover_job_ids',v_cutover_job_ids,
    'cutover_job_count',jsonb_array_length(v_cutover_job_ids),
    'legacy_trigger_removed',NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid='public.service_orders'::regclass
        AND tgname='trg_debit_service_order_base' AND NOT tgisinternal),
    'rollback_available',true
  );
  UPDATE public.artisanal_strap_migration_cutovers SET
    status=v_final_status,post_state_checksum=v_post_checksum,
    manifest=v_manifest,applied_at=now(),updated_at=now()
   WHERE id=v_cutover_id;
  UPDATE public.artisanal_strap_migration_runs SET
    status=CASE WHEN v_review_count>0 THEN 'review_required' ELSE 'completed' END,
    report=report||jsonb_build_object('application',v_manifest)
   WHERE id=p_run_id;
  PERFORM public.log_artisanal_strap_migration_event(
    'artisanal_strap_migration_cutover',v_cutover_id,'reconcile',NULL,
    (SELECT to_jsonb(c) FROM public.artisanal_strap_migration_cutovers c WHERE c.id=v_cutover_id),
    v_reason,p_correlation_id);
  RETURN v_manifest||jsonb_build_object('status',v_final_status,
    'correlation_id',p_correlation_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Rollback: preflight obrigatorio e reversao por fatos compensatorios
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_artisanal_strap_migration_snapshot(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  CASE p_entity_type
    WHEN 'product' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.products x WHERE x.id=p_entity_id;
    WHEN 'strap_variant' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.artisanal_strap_variants x WHERE x.id=p_entity_id;
    WHEN 'product_mapping' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.legacy_strap_product_migration_maps x WHERE x.id=p_entity_id;
    WHEN 'material_reservation' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.material_reservations x WHERE x.id=p_entity_id;
    WHEN 'purchase_order_item' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.purchase_order_items x WHERE x.id=p_entity_id;
    WHEN 'service_order' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.service_orders x WHERE x.id=p_entity_id;
    WHEN 'service_order_item' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.service_order_items x WHERE x.id=p_entity_id;
    WHEN 'sale_order_item' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.sale_order_items x WHERE x.id=p_entity_id;
    WHEN 'sale_order_strap_demand' THEN
      SELECT to_jsonb(x) INTO v_result FROM public.sale_order_strap_demands x WHERE x.id=p_entity_id;
    ELSE
      RAISE EXCEPTION 'Tipo de snapshot desconhecido: %',p_entity_type;
  END CASE;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_artisanal_strap_migration_rollback(
  p_cutover_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_current_checksum text;
  v_snapshot_drift bigint;
  v_posterior_receipts bigint;
  v_posterior_batches bigint;
  v_posterior_service_lines bigint;
  v_cutover_job_drift bigint;
  v_missing_cutover_jobs bigint;
  v_posterior_jobs bigint;
  v_blockers jsonb:='[]'::jsonb;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  SELECT * INTO v_cutover FROM public.artisanal_strap_migration_cutovers
   WHERE id=p_cutover_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cutover inexistente'; END IF;
  IF v_cutover.status NOT IN ('applied','applied_with_review') THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','cutover_not_active','status',v_cutover.status));
  END IF;
  v_current_checksum:=public.artisanal_strap_legacy_state_checksum();
  IF v_cutover.post_state_checksum IS DISTINCT FROM v_current_checksum THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','post_state_checksum_changed','expected',v_cutover.post_state_checksum,
      'current',v_current_checksum));
  END IF;
  SELECT count(*) INTO v_snapshot_drift
    FROM public.artisanal_strap_migration_entity_snapshots s
   WHERE s.cutover_id=p_cutover_id
     AND (s.after_data IS NULL OR
       public.current_artisanal_strap_migration_snapshot(s.entity_type,s.entity_id)
         IS DISTINCT FROM s.after_data);
  IF v_snapshot_drift>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','snapshot_drift','count',v_snapshot_drift));
  END IF;

  SELECT count(*) INTO v_cutover_job_drift
    FROM public.strap_demand_jobs j
   WHERE j.id IN (
     SELECT value::uuid
       FROM jsonb_array_elements_text(
         coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
       ) x(value)
   )
     AND NOT (
       (j.status='queued' AND j.attempts=0 AND j.locked_at IS NULL
         AND j.locked_by IS NULL)
       OR j.status='cancelled'
     );
  SELECT jsonb_array_length(coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb))
         -count(*)
    INTO v_missing_cutover_jobs
    FROM public.strap_demand_jobs j
   WHERE j.id IN (
     SELECT value::uuid
       FROM jsonb_array_elements_text(
         coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
       ) x(value)
   );
  IF v_missing_cutover_jobs>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','cutover_job_missing','count',v_missing_cutover_jobs));
  END IF;
  IF v_cutover_job_drift>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','cutover_job_already_processed','count',v_cutover_job_drift));
  END IF;

  -- Um job externo criado/processado depois do corte pode ainda materializar
  -- fatos apos o rollback. Mesmo quando foi no-op, sua chave idempotente ja foi
  -- consumida; por isso ele bloqueia a reversao da mesma forma que um recibo.
  SELECT count(*) INTO v_posterior_jobs
    FROM public.strap_demand_jobs j
   WHERE greatest(j.created_at,j.updated_at)>v_cutover.applied_at
     AND j.status<>'cancelled'
     AND NOT (j.id IN (
       SELECT value::uuid
         FROM jsonb_array_elements_text(
           coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
         ) x(value)
     ))
     AND (
       (j.source_type IN ('strap_variant','stock') AND j.source_id IN (
         SELECT a.strap_variant_id
           FROM public.legacy_strap_product_migration_allocations a
           JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
          WHERE m.applied_cutover_id=p_cutover_id
         UNION
         SELECT s.entity_id
           FROM public.artisanal_strap_migration_entity_snapshots s
          WHERE s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
       ))
       OR (j.source_type='sale_order' AND j.source_id IN (
         SELECT (s.before_data->>'sale_order_id')::uuid
           FROM public.artisanal_strap_migration_entity_snapshots s
          WHERE s.cutover_id=p_cutover_id
            AND s.entity_type IN ('sale_order_item','sale_order_strap_demand')
            AND nullif(s.before_data->>'sale_order_id','') IS NOT NULL
       ))
       OR (j.source_type='purchase_order' AND j.source_id IN (
         SELECT (s.before_data->>'purchase_order_id')::uuid
           FROM public.artisanal_strap_migration_entity_snapshots s
          WHERE s.cutover_id=p_cutover_id AND s.entity_type='purchase_order_item'
       ))
       OR (j.source_type IN ('service_order','custody') AND j.source_id IN (
         SELECT s.entity_id
           FROM public.artisanal_strap_migration_entity_snapshots s
          WHERE s.cutover_id=p_cutover_id AND s.entity_type='service_order'
       ))
     );
  IF v_posterior_jobs>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','posterior_reconciliation_jobs','count',v_posterior_jobs));
  END IF;

  SELECT count(*) INTO v_posterior_receipts FROM (
    SELECT pr.id
      FROM public.purchase_receipts pr
      JOIN public.purchase_receipt_items pri ON pri.purchase_receipt_id=pr.id
      JOIN public.purchase_order_items poi ON poi.id=pri.purchase_order_item_id
     WHERE pr.created_at>v_cutover.applied_at
       AND pr.correlation_id<>v_cutover.correlation_id
       AND (
         poi.strap_variant_id IN (
           SELECT a.strap_variant_id
             FROM public.legacy_strap_product_migration_allocations a
             JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
            WHERE m.applied_cutover_id=p_cutover_id
           UNION
           SELECT v.id FROM public.artisanal_strap_variants v
            JOIN public.artisanal_strap_migration_entity_snapshots s
              ON s.entity_type='product' AND s.entity_id=v.finished_product_id
             AND s.cutover_id=p_cutover_id
         )
         OR poi.product_id IN (
           SELECT s.entity_id
             FROM public.artisanal_strap_migration_entity_snapshots s
            WHERE s.cutover_id=p_cutover_id AND s.entity_type='product'
           UNION
           SELECT t.source_product_id FROM public.legacy_strap_stock_transfers t
            WHERE t.cutover_id=p_cutover_id
           UNION
           SELECT t.target_product_id FROM public.legacy_strap_stock_transfers t
            WHERE t.cutover_id=p_cutover_id
         )
       )
    UNION
    SELECT r.id FROM public.strap_production_receipts r
     WHERE r.created_at>v_cutover.applied_at
       AND r.correlation_id<>v_cutover.correlation_id
       AND r.strap_variant_id IN (
         SELECT a.strap_variant_id
           FROM public.legacy_strap_product_migration_allocations a
           JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
          WHERE m.applied_cutover_id=p_cutover_id
         UNION
         SELECT v.id FROM public.artisanal_strap_variants v
          JOIN public.artisanal_strap_migration_entity_snapshots s
            ON s.entity_type='product' AND s.entity_id=v.finished_product_id
           AND s.cutover_id=p_cutover_id
       )
  ) facts;
  IF v_posterior_receipts>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','posterior_receipts','count',v_posterior_receipts));
  END IF;

  SELECT count(*) INTO v_posterior_batches
    FROM public.strap_production_batch_items bi
    JOIN public.strap_production_batches b ON b.id=bi.batch_id
   WHERE bi.created_at>v_cutover.applied_at
     AND b.correlation_id<>v_cutover.correlation_id
     AND bi.strap_variant_id IN (
       SELECT a.strap_variant_id
         FROM public.legacy_strap_product_migration_allocations a
         JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
        WHERE m.applied_cutover_id=p_cutover_id
       UNION
       SELECT v.id FROM public.artisanal_strap_variants v
        JOIN public.artisanal_strap_migration_entity_snapshots s
          ON s.entity_type='product' AND s.entity_id=v.finished_product_id
         AND s.cutover_id=p_cutover_id
     );
  IF v_posterior_batches>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','posterior_batches','count',v_posterior_batches));
  END IF;

  SELECT count(*) INTO v_posterior_service_lines
    FROM public.service_order_items i
   WHERE i.created_at>v_cutover.applied_at
     AND i.strap_variant_id IN (
       SELECT a.strap_variant_id
         FROM public.legacy_strap_product_migration_allocations a
         JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
        WHERE m.applied_cutover_id=p_cutover_id
       UNION
       SELECT v.id FROM public.artisanal_strap_variants v
        JOIN public.artisanal_strap_migration_entity_snapshots s
          ON s.entity_type='product' AND s.entity_id=v.finished_product_id
         AND s.cutover_id=p_cutover_id
     );
  IF v_posterior_service_lines>0 THEN
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','posterior_service_lines','count',v_posterior_service_lines));
  END IF;

  RETURN jsonb_build_object(
    'cutover_id',p_cutover_id,
    'can_rollback',jsonb_array_length(v_blockers)=0,
    'expected_post_checksum',v_cutover.post_state_checksum,
    'current_checksum',v_current_checksum,
    'snapshot_drift_count',v_snapshot_drift,
    'cutover_job_drift_count',v_cutover_job_drift,
    'missing_cutover_job_count',v_missing_cutover_jobs,
    'posterior_job_count',v_posterior_jobs,
    'blockers',v_blockers,
    'policy','Rollback bloqueado depois de qualquer fato operacional ou drift de snapshot.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_artisanal_strap_migration(
  p_cutover_id uuid,
  p_expected_post_checksum text,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutover public.artisanal_strap_migration_cutovers%ROWTYPE;
  v_preview jsonb;
  v_snapshot public.artisanal_strap_migration_entity_snapshots%ROWTYPE;
  v_transfer record;
  v_incremental_application public.artisanal_strap_migration_incremental_applications%ROWTYPE;
  v_source public.products%ROWTYPE;
  v_target public.products%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_out_id uuid;
  v_in_id uuid;
  v_job public.strap_demand_jobs%ROWTYPE;
  v_cancelled_cutover_job_ids jsonb:='[]'::jsonb;
  v_rollback_job_ids jsonb:='[]'::jsonb;
  v_rollback_checksum text;
  v_rollback_conservation jsonb;
  v_manifest jsonb;
  v_product_ids uuid[]:=ARRAY[]::uuid[];
  v_variant_ids uuid[]:=ARRAY[]::uuid[];
  v_purchase_item_ids uuid[]:=ARRAY[]::uuid[];
  v_service_item_ids uuid[]:=ARRAY[]::uuid[];
  v_reservation_ids uuid[]:=ARRAY[]::uuid[];
  v_sale_item_ids uuid[]:=ARRAY[]::uuid[];
  v_demand_ids uuid[]:=ARRAY[]::uuid[];
  v_reason text:=public.require_strap_change_reason(p_reason);
  v_variant_lock_id uuid;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'correlation_id obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('artisanal-strap-legacy-cutover',0));
  SELECT * INTO v_cutover FROM public.artisanal_strap_migration_cutovers
   WHERE id=p_cutover_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cutover inexistente'; END IF;
  IF lower(coalesce(p_expected_post_checksum,''))
       IS DISTINCT FROM lower(coalesce(v_cutover.post_state_checksum,'')) THEN
    RAISE EXCEPTION 'Checksum pos-cutover informado nao confere';
  END IF;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_variant_ids
    FROM (
      SELECT a.strap_variant_id AS id
        FROM public.legacy_strap_product_migration_allocations a
        JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
       WHERE m.applied_cutover_id=p_cutover_id
      UNION
      SELECT s.entity_id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
      UNION
      SELECT nullif(s.before_data->>'strap_variant_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.before_data->>'strap_variant_id','') IS NOT NULL
      UNION
      SELECT nullif(s.after_data->>'strap_variant_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.after_data->>'strap_variant_id','') IS NOT NULL
    ) x
   WHERE x.id IS NOT NULL;
  FOREACH v_variant_lock_id IN ARRAY v_variant_ids
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:'||v_variant_lock_id::text,0));
  END LOOP;

  -- Congela primeiro os jobs ja existentes que podem materializar o escopo.
  -- Worker que ja os reclamou termina antes de qualquer lock operacional; o
  -- preflight repetido abaixo passa a enxergar o resultado comprometido.
  PERFORM 1
    FROM public.strap_demand_jobs j
   WHERE j.id IN (
     SELECT value::uuid
       FROM jsonb_array_elements_text(
         coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
       ) x(value)
   )
      OR (
        j.status<>'cancelled' AND (
          (j.source_type IN ('strap_variant','stock') AND j.source_id IN (
            SELECT a.strap_variant_id
              FROM public.legacy_strap_product_migration_allocations a
              JOIN public.legacy_strap_product_migration_maps m
                ON m.id=a.mapping_id
             WHERE m.applied_cutover_id=p_cutover_id
            UNION
            SELECT s.entity_id
              FROM public.artisanal_strap_migration_entity_snapshots s
             WHERE s.cutover_id=p_cutover_id AND s.entity_type='strap_variant'
          ))
          OR (j.source_type='purchase_order' AND j.source_id IN (
            SELECT (s.before_data->>'purchase_order_id')::uuid
              FROM public.artisanal_strap_migration_entity_snapshots s
             WHERE s.cutover_id=p_cutover_id
               AND s.entity_type='purchase_order_item'
          ))
          OR (j.source_type IN ('service_order','custody') AND j.source_id IN (
            SELECT s.entity_id
              FROM public.artisanal_strap_migration_entity_snapshots s
             WHERE s.cutover_id=p_cutover_id AND s.entity_type='service_order'
          ))
        )
      )
   ORDER BY j.id FOR UPDATE;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_product_ids
    FROM (
      SELECT s.entity_id AS id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id AND s.entity_type='product'
      UNION
      SELECT t.source_product_id
        FROM public.legacy_strap_stock_transfers t
       WHERE t.cutover_id=p_cutover_id
      UNION
      SELECT t.target_product_id
        FROM public.legacy_strap_stock_transfers t
       WHERE t.cutover_id=p_cutover_id
      UNION
      SELECT m.legacy_product_id
        FROM public.legacy_strap_product_migration_maps m
       WHERE m.applied_cutover_id=p_cutover_id
      UNION
      SELECT a.target_product_id
        FROM public.legacy_strap_product_migration_allocations a
        JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
       WHERE m.applied_cutover_id=p_cutover_id
      UNION
      SELECT nullif(s.before_data->>'product_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.before_data->>'product_id','') IS NOT NULL
      UNION
      SELECT nullif(s.after_data->>'product_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.after_data->>'product_id','') IS NOT NULL
      UNION
      SELECT nullif(s.before_data->>'finished_product_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.before_data->>'finished_product_id','') IS NOT NULL
      UNION
      SELECT nullif(s.after_data->>'finished_product_id','')::uuid
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND nullif(s.after_data->>'finished_product_id','') IS NOT NULL
      UNION
      SELECT v.finished_product_id
        FROM public.artisanal_strap_variants v
       WHERE v.id=ANY(v_variant_ids)
    ) x
   WHERE x.id IS NOT NULL;

  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_purchase_item_ids
    FROM (
      SELECT s.entity_id AS id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id AND s.entity_type='purchase_order_item'
      UNION
      SELECT i.id FROM public.purchase_order_items i
       WHERE i.strap_variant_id=ANY(v_variant_ids)
          OR i.product_id=ANY(v_product_ids)
    ) x;
  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_service_item_ids
    FROM (
      SELECT s.entity_id AS id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id AND s.entity_type='service_order_item'
      UNION
      SELECT i.id FROM public.service_order_items i
       WHERE i.strap_variant_id=ANY(v_variant_ids)
          OR i.finished_product_id=ANY(v_product_ids)
    ) x;
  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_reservation_ids
    FROM (
      SELECT s.entity_id AS id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id AND s.entity_type='material_reservation'
      UNION
      SELECT r.id FROM public.material_reservations r
       WHERE r.strap_variant_id=ANY(v_variant_ids)
          OR r.product_id=ANY(v_product_ids)
    ) x;
  SELECT coalesce(array_agg(s.entity_id ORDER BY s.entity_id),ARRAY[]::uuid[])
    INTO v_sale_item_ids
    FROM public.artisanal_strap_migration_entity_snapshots s
   WHERE s.cutover_id=p_cutover_id AND s.entity_type='sale_order_item';
  SELECT coalesce(array_agg(x.id ORDER BY x.id),ARRAY[]::uuid[])
    INTO v_demand_ids
    FROM (
      SELECT s.entity_id AS id
        FROM public.artisanal_strap_migration_entity_snapshots s
       WHERE s.cutover_id=p_cutover_id
         AND s.entity_type='sale_order_strap_demand'
      UNION
      SELECT d.id FROM public.sale_order_strap_demands d
       WHERE d.strap_variant_id=ANY(v_variant_ids)
          OR d.finished_product_id=ANY(v_product_ids)
    ) x;

  -- Mesma ordem operacional do apply/recebimento: item -> cabecalho -> reserva
  -- -> produto -> variante/demanda. Inserts posteriores ficam serializados
  -- pelas FKs dos fatos para as linhas FOR UPDATE deste escopo.
  PERFORM 1 FROM public.purchase_order_items i
   WHERE i.id=ANY(v_purchase_item_ids) ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.purchase_orders po
   WHERE po.id IN (
     SELECT i.purchase_order_id FROM public.purchase_order_items i
      WHERE i.id=ANY(v_purchase_item_ids)
     UNION
     SELECT s.entity_id FROM public.artisanal_strap_migration_entity_snapshots s
      WHERE s.cutover_id=p_cutover_id AND s.entity_type='purchase_order'
   ) ORDER BY po.id FOR UPDATE;
  PERFORM 1 FROM public.service_order_items i
   WHERE i.id=ANY(v_service_item_ids) ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.service_orders so
   WHERE so.id IN (
     SELECT i.service_order_id FROM public.service_order_items i
      WHERE i.id=ANY(v_service_item_ids)
     UNION
     SELECT s.entity_id FROM public.artisanal_strap_migration_entity_snapshots s
      WHERE s.cutover_id=p_cutover_id AND s.entity_type='service_order'
   ) ORDER BY so.id FOR UPDATE;
  PERFORM 1 FROM public.sale_order_items i
   WHERE i.id=ANY(v_sale_item_ids) ORDER BY i.id FOR UPDATE;
  PERFORM 1 FROM public.sale_orders so
   WHERE so.id IN (
     SELECT i.sale_order_id FROM public.sale_order_items i
      WHERE i.id=ANY(v_sale_item_ids)
   ) ORDER BY so.id FOR UPDATE;
  PERFORM 1 FROM public.material_reservations r
   WHERE r.id=ANY(v_reservation_ids) ORDER BY r.id FOR UPDATE;
  PERFORM 1 FROM public.products p
   WHERE p.id=ANY(v_product_ids) ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.artisanal_strap_variants v
   WHERE v.id=ANY(v_variant_ids) ORDER BY v.id FOR UPDATE;
  PERFORM 1 FROM public.sale_order_strap_demands d
   WHERE d.id=ANY(v_demand_ids) ORDER BY d.id FOR UPDATE;
  PERFORM 1 FROM public.legacy_strap_product_migration_maps m
   WHERE m.applied_cutover_id=p_cutover_id
      OR m.id IN (
        SELECT s.entity_id FROM public.artisanal_strap_migration_entity_snapshots s
         WHERE s.cutover_id=p_cutover_id AND s.entity_type='product_mapping'
      )
   ORDER BY m.id FOR UPDATE;
  PERFORM 1 FROM public.legacy_strap_stock_transfers t
   WHERE t.cutover_id=p_cutover_id ORDER BY t.id FOR UPDATE;
  PERFORM 1 FROM public.artisanal_strap_migration_incremental_applications a
   WHERE a.cutover_id=p_cutover_id ORDER BY a.id FOR UPDATE;

  -- Jobs nao possuem FK de source_id. O lock de tabela fecha essa unica via
  -- de insert sem raiz; os demais fatos abaixo tambem sao congelados para que
  -- update/delete concorrente nao escape do segundo preflight.
  LOCK TABLE public.strap_demand_jobs IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.purchase_receipts IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.purchase_receipt_items IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.strap_production_batches IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.strap_production_batch_items IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.strap_production_receipts IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.stock_movements IN SHARE ROW EXCLUSIVE MODE;

  -- Este e o preflight decisivo. Ele roda depois de todo wait por writer e
  -- enquanto os locks acima continuam retidos ate COMMIT; qualquer receipt
  -- integralmente rejeitado, job ou drift que venceu a corrida aparece aqui.
  v_preview:=public.preview_artisanal_strap_migration_rollback(p_cutover_id);
  IF NOT (v_preview->>'can_rollback')::boolean THEN
    RAISE EXCEPTION 'Rollback bloqueado: %',v_preview->'blockers';
  END IF;
  IF lower(coalesce(v_preview->>'current_checksum',''))
       IS DISTINCT FROM lower(coalesce(p_expected_post_checksum,'')) THEN
    RAISE EXCEPTION 'Checksum mudou enquanto rollback aguardava locks'
      USING ERRCODE='40001';
  END IF;

  PERFORM set_config('app.strap_change_reason',v_reason,true);
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.strap_source_admin_override','1',true);
  PERFORM set_config('app.strap_po_engine','1',true);
  PERFORM set_config('app.artisanal_strap_catalog_write','1',true);

  -- Jobs nascidos no cutover ainda sem tentativa sao cancelados antes de
  -- restaurar o estado. Se algum ja foi reclamado/processado, o preflight
  -- acima bloqueia a transacao e nenhuma linha e tocada.
  FOR v_job IN
    SELECT j.*
      FROM public.strap_demand_jobs j
      JOIN jsonb_array_elements_text(
        coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
      ) x(value) ON j.id=x.value::uuid
     ORDER BY j.id FOR UPDATE OF j
  LOOP
    IF v_job.status='cancelled' THEN CONTINUE; END IF;
    IF v_job.status<>'queued' OR v_job.attempts<>0
       OR v_job.locked_at IS NOT NULL OR v_job.locked_by IS NOT NULL THEN
      RAISE EXCEPTION 'Job % do cutover deixou de ser reversivel',v_job.id;
    END IF;
    UPDATE public.strap_demand_jobs SET
      status='cancelled',locked_at=NULL,locked_by=NULL,
      last_error='Cancelado pelo rollback seguro do cutover '||p_cutover_id::text,
      result=jsonb_build_object('cancelled_by_rollback',true,
        'cutover_id',p_cutover_id,'correlation_id',p_correlation_id),
      completed_at=now(),updated_at=now()
     WHERE id=v_job.id;
    v_cancelled_cutover_job_ids:=v_cancelled_cutover_job_ids
      ||jsonb_build_array(v_job.id);
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_demand_job',v_job.id,'cancel',to_jsonb(v_job),
      (SELECT to_jsonb(j) FROM public.strap_demand_jobs j WHERE j.id=v_job.id),
      v_reason,p_correlation_id);
  END LOOP;

  -- Primeiro restaura FKs/status dos documentos. Produtos sao restaurados por
  -- transferencias compensatorias abaixo, preservando os movimentos originais.
  FOR v_snapshot IN
    SELECT * FROM public.artisanal_strap_migration_entity_snapshots
     WHERE cutover_id=p_cutover_id AND entity_type<>'product'
     ORDER BY CASE entity_type
       WHEN 'sale_order_strap_demand' THEN 1
       WHEN 'material_reservation' THEN 2
       WHEN 'purchase_order_item' THEN 3
       WHEN 'service_order_item' THEN 4
       WHEN 'service_order' THEN 5
       WHEN 'sale_order_item' THEN 6
       WHEN 'strap_variant' THEN 7
       WHEN 'product_mapping' THEN 8 ELSE 9 END,entity_id
  LOOP
    v_before:=public.current_artisanal_strap_migration_snapshot(
      v_snapshot.entity_type,v_snapshot.entity_id);
    CASE v_snapshot.entity_type
      WHEN 'strap_variant' THEN
        UPDATE public.artisanal_strap_variants SET
          status=v_snapshot.before_data->>'status',
          review_reason=v_snapshot.before_data->>'review_reason',
          min_stock_replenishment_mode=v_snapshot.before_data->>'min_stock_replenishment_mode',
          updated_at=now()
         WHERE id=v_snapshot.entity_id;
      WHEN 'product_mapping' THEN
        UPDATE public.legacy_strap_product_migration_maps SET
          status=v_snapshot.before_data->>'status',
          replenishment_mode=v_snapshot.before_data->>'replenishment_mode',
          allocation_checksum=v_snapshot.before_data->>'allocation_checksum',
          resolution_reason=v_snapshot.before_data->>'resolution_reason',
          resolved_by=nullif(v_snapshot.before_data->>'resolved_by','')::uuid,
          resolved_at=nullif(v_snapshot.before_data->>'resolved_at','')::timestamptz,
          applied_cutover_id=nullif(v_snapshot.before_data->>'applied_cutover_id','')::uuid,
          applied_at=nullif(v_snapshot.before_data->>'applied_at','')::timestamptz,
          updated_at=now()
         WHERE id=v_snapshot.entity_id;
      WHEN 'material_reservation' THEN
        UPDATE public.material_reservations SET
          product_id=(v_snapshot.before_data->>'product_id')::uuid,
          strap_variant_id=nullif(v_snapshot.before_data->>'strap_variant_id','')::uuid,
          finished_product_id=nullif(v_snapshot.before_data->>'finished_product_id','')::uuid,
          correlation_id=nullif(v_snapshot.before_data->>'correlation_id','')::uuid,
          updated_at=now()
         WHERE id=v_snapshot.entity_id;
      WHEN 'purchase_order_item' THEN
        UPDATE public.purchase_order_items SET
          product_id=(v_snapshot.before_data->>'product_id')::uuid,
          strap_variant_id=nullif(v_snapshot.before_data->>'strap_variant_id','')::uuid
         WHERE id=v_snapshot.entity_id;
      WHEN 'service_order' THEN
        UPDATE public.service_orders SET
          canonical_strap_recipe_id=nullif(v_snapshot.before_data->>'canonical_strap_recipe_id','')::uuid,
          status=v_snapshot.before_data->>'status',
          strap_migration_status=v_snapshot.before_data->>'strap_migration_status',
          strap_migration_reason=v_snapshot.before_data->>'strap_migration_reason',
          strap_migration_previous_status=v_snapshot.before_data->>'strap_migration_previous_status',
          strap_migration_cutover_id=nullif(v_snapshot.before_data->>'strap_migration_cutover_id','')::uuid
         WHERE id=v_snapshot.entity_id;
      WHEN 'service_order_item' THEN
        UPDATE public.service_order_items SET
          finished_product_id=nullif(v_snapshot.before_data->>'finished_product_id','')::uuid,
          strap_variant_id=nullif(v_snapshot.before_data->>'strap_variant_id','')::uuid,
          strap_recipe_id=nullif(v_snapshot.before_data->>'strap_recipe_id','')::uuid,
          line_status=v_snapshot.before_data->>'line_status',
          suspended_from_status=v_snapshot.before_data->>'suspended_from_status',
          suspension_reason=v_snapshot.before_data->>'suspension_reason',
          suspended_by=nullif(v_snapshot.before_data->>'suspended_by','')::uuid,
          suspended_at=nullif(v_snapshot.before_data->>'suspended_at','')::timestamptz
         WHERE id=v_snapshot.entity_id;
      WHEN 'sale_order_item' THEN
        UPDATE public.sale_order_items SET
          strap_colors=v_snapshot.before_data->'strap_colors',
          strap_sourcing=v_snapshot.before_data->'strap_sourcing',
          strap_migration_status=v_snapshot.before_data->>'strap_migration_status',
          strap_migration_reason=v_snapshot.before_data->>'strap_migration_reason',
          strap_migration_cutover_id=nullif(v_snapshot.before_data->>'strap_migration_cutover_id','')::uuid
         WHERE id=v_snapshot.entity_id;
      WHEN 'sale_order_strap_demand' THEN
        UPDATE public.sale_order_strap_demands SET
          finished_product_id=(v_snapshot.before_data->>'finished_product_id')::uuid,
          status=v_snapshot.before_data->>'status',
          suspended_from_status=v_snapshot.before_data->>'suspended_from_status',
          suspension_reason=v_snapshot.before_data->>'suspension_reason',
          suspended_by=nullif(v_snapshot.before_data->>'suspended_by','')::uuid,
          suspended_at=nullif(v_snapshot.before_data->>'suspended_at','')::timestamptz,
          correlation_id=(v_snapshot.before_data->>'correlation_id')::uuid,
          updated_at=now()
         WHERE id=v_snapshot.entity_id;
      ELSE
        RAISE EXCEPTION 'Snapshot nao restauravel: %',v_snapshot.entity_type;
    END CASE;
    v_after:=public.current_artisanal_strap_migration_snapshot(
      v_snapshot.entity_type,v_snapshot.entity_id);
    PERFORM public.log_artisanal_strap_migration_event(
      v_snapshot.entity_type,v_snapshot.entity_id,'update',v_before,v_after,
      v_reason,p_correlation_id);
  END LOOP;

  -- Reverte transferencias na ordem inversa, criando movimentos compensatorios
  -- em vez de apagar os movimentos do cutover.
  FOR v_transfer IN
    SELECT t.*,a.strap_variant_id
      FROM public.legacy_strap_stock_transfers t
      JOIN public.legacy_strap_product_migration_allocations a ON a.id=t.allocation_id
     WHERE t.cutover_id=p_cutover_id AND t.reversed_at IS NULL
     ORDER BY t.created_at DESC,t.id DESC
  LOOP
    SELECT * INTO v_source FROM public.products
     WHERE id=v_transfer.source_product_id FOR UPDATE;
    SELECT * INTO v_target FROM public.products
     WHERE id=v_transfer.target_product_id FOR UPDATE;
    IF coalesce(v_target.quantity,0)<v_transfer.quantity
       OR coalesce(v_target.current_stock,0)<v_transfer.quantity
       OR coalesce(v_target.reserved_stock,0)<v_transfer.reserved_stock THEN
      RAISE EXCEPTION 'Saldo alvo insuficiente para reversao da transferencia %',v_transfer.id;
    END IF;
    UPDATE public.products SET
      quantity=coalesce(quantity,0)-v_transfer.quantity,
      current_stock=coalesce(current_stock,0)-v_transfer.quantity,
      reserved_stock=coalesce(reserved_stock,0)-v_transfer.reserved_stock,
      updated_at=now()
     WHERE id=v_target.id;
    UPDATE public.products SET
      quantity=coalesce(quantity,0)+v_transfer.quantity,
      current_stock=coalesce(current_stock,0)+v_transfer.quantity,
      reserved_stock=coalesce(reserved_stock,0)+v_transfer.reserved_stock,
      updated_at=now()
     WHERE id=v_source.id;
    v_out_id:=NULL; v_in_id:=NULL;
    IF v_transfer.quantity>0 THEN
      INSERT INTO public.stock_movements(
        product_id,movement_type,quantity,previous_stock,new_stock,description,
        movement_reason,strap_variant_id,finished_product_id,correlation_id
      ) VALUES (
        v_target.id,'out',v_transfer.quantity,coalesce(v_target.quantity,0),
        coalesce(v_target.quantity,0)-v_transfer.quantity,
        'Reversao auditada de transferencia do cutover de tiras','estorno',
        v_transfer.strap_variant_id,v_target.id,p_correlation_id
      ) RETURNING id INTO v_out_id;
      INSERT INTO public.stock_movements(
        product_id,movement_type,quantity,previous_stock,new_stock,description,
        movement_reason,strap_variant_id,finished_product_id,correlation_id
      ) VALUES (
        v_source.id,'in',v_transfer.quantity,coalesce(v_source.quantity,0),
        coalesce(v_source.quantity,0)+v_transfer.quantity,
        'Estorno auditado do saldo para produto legado de tira','estorno',
        v_transfer.strap_variant_id,v_source.id,p_correlation_id
      ) RETURNING id INTO v_in_id;
    END IF;
    UPDATE public.legacy_strap_stock_transfers SET
      reversed_out_movement_id=v_out_id,reversed_in_movement_id=v_in_id,
      reversed_at=now()
     WHERE id=v_transfer.id;
  END LOOP;

  -- Confere o saldo reconstruido contra o snapshot anterior e restaura apenas
  -- os metadados de migracao. Divergencia aborta toda a transacao.
  FOR v_snapshot IN
    SELECT * FROM public.artisanal_strap_migration_entity_snapshots
     WHERE cutover_id=p_cutover_id AND entity_type='product'
     ORDER BY entity_id
  LOOP
    SELECT * INTO v_source FROM public.products
     WHERE id=v_snapshot.entity_id FOR UPDATE;
    IF coalesce(v_source.quantity,0)
         IS DISTINCT FROM coalesce((v_snapshot.before_data->>'quantity')::numeric,0)
       OR coalesce(v_source.current_stock,0)
         IS DISTINCT FROM coalesce((v_snapshot.before_data->>'current_stock')::numeric,0)
       OR coalesce(v_source.reserved_stock,0)
         IS DISTINCT FROM coalesce((v_snapshot.before_data->>'reserved_stock')::numeric,0) THEN
      RAISE EXCEPTION 'Reversao nao reconstruiu saldo do produto %',v_source.id;
    END IF;
    v_before:=to_jsonb(v_source);
    UPDATE public.products SET
      quantity=(v_snapshot.before_data->>'quantity')::numeric,
      current_stock=(v_snapshot.before_data->>'current_stock')::numeric,
      reserved_stock=(v_snapshot.before_data->>'reserved_stock')::numeric,
      strap_migration_status=v_snapshot.before_data->>'strap_migration_status',
      strap_migration_reason=v_snapshot.before_data->>'strap_migration_reason',
      strap_migration_cutover_id=nullif(v_snapshot.before_data->>'strap_migration_cutover_id','')::uuid,
      updated_at=now()
     WHERE id=v_source.id;
    PERFORM public.log_artisanal_strap_migration_event(
      'product',v_source.id,'update',v_before,
      (SELECT to_jsonb(p) FROM public.products p WHERE p.id=v_source.id),
      v_reason,p_correlation_id);
  END LOOP;

  UPDATE public.artisanal_strap_migration_review_items SET
    status='rejected',
    candidates=candidates||jsonb_build_object('rollback_cutover_id',p_cutover_id,
      'rollback_reason',v_reason),updated_at=now()
   WHERE migration_run_id=v_cutover.migration_run_id
     AND status='review_required'
     AND entity_type IN ('legacy_replenishment_mode',
       'legacy_replenishment_source_unavailable','legacy_product_mapping_drift',
       'open_sale_order_item_ambiguous','open_service_order_legacy_recipe');

  -- Atualizar produtos/variantes/PVs durante a reversao aciona os mesmos
  -- enfileiradores do runtime. Executa o trigger diferido agora e cancela
  -- somente jobs novos desta transacao; deixa intactos jobs anteriores ao corte.
  EXECUTE 'SET CONSTRAINTS trg_enqueue_strap_demands_on_item_change IMMEDIATE';
  FOR v_job IN
    SELECT j.* FROM public.strap_demand_jobs j
     WHERE j.xmin::text::bigint=txid_current()
       AND j.status='queued' AND j.attempts=0
       AND NOT (j.id IN (
         SELECT value::uuid
           FROM jsonb_array_elements_text(
             coalesce(v_cutover.manifest->'cutover_job_ids','[]'::jsonb)
           ) x(value)
       ))
     ORDER BY j.id FOR UPDATE
  LOOP
    UPDATE public.strap_demand_jobs SET
      status='cancelled',
      last_error='Cancelado: evento gerado apenas pela restauracao do cutover '
        ||p_cutover_id::text,
      result=jsonb_build_object('rollback_generated',true,
        'cutover_id',p_cutover_id,'correlation_id',p_correlation_id),
      completed_at=now(),updated_at=now()
     WHERE id=v_job.id;
    v_rollback_job_ids:=v_rollback_job_ids||jsonb_build_array(v_job.id);
    PERFORM public.log_artisanal_strap_migration_event(
      'strap_demand_job',v_job.id,'cancel',to_jsonb(v_job),
      (SELECT to_jsonb(j) FROM public.strap_demand_jobs j WHERE j.id=v_job.id),
      v_reason,p_correlation_id);
  END LOOP;

  FOR v_incremental_application IN
    SELECT a.*
      FROM public.artisanal_strap_migration_incremental_applications a
     WHERE a.cutover_id=p_cutover_id AND a.status='applied'
     ORDER BY a.id FOR UPDATE
  LOOP
    UPDATE public.artisanal_strap_migration_incremental_applications SET
      status='rolled_back',rolled_back_by=auth.uid(),rolled_back_at=now(),updated_at=now()
     WHERE id=v_incremental_application.id;
    PERFORM public.log_artisanal_strap_migration_event(
      'artisanal_strap_migration_incremental_application',
      v_incremental_application.id,'update',to_jsonb(v_incremental_application),
      (SELECT to_jsonb(a)
         FROM public.artisanal_strap_migration_incremental_applications a
        WHERE a.id=v_incremental_application.id),v_reason,p_correlation_id);
  END LOOP;

  v_rollback_checksum:=public.artisanal_strap_legacy_state_checksum();
  v_rollback_conservation:=public.artisanal_strap_legacy_conservation_report();
  v_manifest:=jsonb_build_object(
    'cutover_id',p_cutover_id,'rolled_back_at',now(),
    'expected_post_checksum',p_expected_post_checksum,
    'rollback_state_checksum',v_rollback_checksum,
    'pre_state_checksum',v_cutover.pre_state_checksum,
    'conservation_after_rollback',v_rollback_conservation,
    'snapshots_restored',(SELECT count(*)
      FROM public.artisanal_strap_migration_entity_snapshots WHERE cutover_id=p_cutover_id),
    'transfers_reversed',(SELECT count(*) FROM public.legacy_strap_stock_transfers
      WHERE cutover_id=p_cutover_id AND reversed_at IS NOT NULL),
    'incremental_applications_rolled_back',(SELECT count(*)
      FROM public.artisanal_strap_migration_incremental_applications
      WHERE cutover_id=p_cutover_id AND status='rolled_back'),
    'cutover_jobs_cancelled',v_cancelled_cutover_job_ids,
    'rollback_generated_jobs_cancelled',v_rollback_job_ids,
    'historical_movements_deleted',0,
    'note','Movimentos do cutover foram preservados e compensados por estornos.'
  );
  UPDATE public.artisanal_strap_migration_cutovers SET
    status='rolled_back',rollback_manifest=v_manifest,
    rolled_back_by=auth.uid(),rolled_back_at=now(),updated_at=now()
   WHERE id=p_cutover_id;
  PERFORM public.log_artisanal_strap_migration_event(
    'artisanal_strap_migration_cutover',p_cutover_id,'update',to_jsonb(v_cutover),
    (SELECT to_jsonb(c) FROM public.artisanal_strap_migration_cutovers c WHERE c.id=p_cutover_id),
    v_reason,p_correlation_id);
  RETURN v_manifest||jsonb_build_object('status','rolled_back',
    'correlation_id',p_correlation_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Diagnosticos e views historicas somente leitura
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_legacy_artisanal_strap_recipe_history
WITH (security_invoker=false)
AS
SELECT
  so.id AS service_order_id,
  so.order_number,
  so.status,
  so.artisanal_recipe_id AS legacy_recipe_id,
  lm.canonical_recipe_id,
  lm.status AS recipe_mapping_status,
  so.canonical_strap_recipe_id,
  so.artisanal_output_name,
  so.artisanal_output_color,
  so.artisanal_output_meters,
  so.strap_migration_status,
  so.strap_migration_reason,
  so.created_at,
  so.updated_at
FROM public.service_orders so
LEFT JOIN public.legacy_artisanal_recipe_map lm
  ON lm.legacy_recipe_id=so.artisanal_recipe_id
WHERE so.artisanal_recipe_id IS NOT NULL
  AND public.is_approved_user();

CREATE OR REPLACE VIEW public.v_artisanal_strap_legacy_migration_admin
WITH (security_invoker=false)
AS
SELECT
  c.id AS cutover_id,c.status,c.migration_run_id,c.dry_run_checksum,
  c.pre_state_checksum,c.post_state_checksum,c.manifest,c.rollback_manifest,
  c.reason,c.correlation_id,c.applied_by,c.applied_at,
  c.rolled_back_by,c.rolled_back_at,c.created_at,c.updated_at
FROM public.artisanal_strap_migration_cutovers c
WHERE public.has_artisanal_strap_capability('resolve_strap_migration');

CREATE OR REPLACE FUNCTION public.artisanal_strap_legacy_migration_diagnostics()
RETURNS TABLE(issue_code text,entity_id uuid,details jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');

  RETURN QUERY
  SELECT 'legacy_product_candidate_provenance_missing'::text,ri.id,
    jsonb_build_object(
      'review_item_id',ri.id,'migration_run_id',ri.migration_run_id,
      'legacy_product_id',ri.legacy_id,'reason',ri.reason,
      'candidate_snapshot',ri.candidates,
      'resolution','Execute novo dry-run apos corrigir a classificacao estrutural; nao e permitido criar mapa sem esta prova.'
    )
  FROM public.artisanal_strap_migration_review_items ri
  WHERE ri.entity_type='legacy_product' AND ri.migration_run_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.migration_run_id=ri.migration_run_id
         AND pp.legacy_product_id::text=ri.legacy_id
         AND pp.review_item_id=ri.id
    );

  -- Payload de apoio para a UI montar a alocacao sem inferencia. Cada fato
  -- aberto aparece com seu UUID e saldo restante; o Administrador decide em
  -- qual variante coloca-lo no payload de resolve_legacy_strap_product_migration.
  RETURN QUERY
  SELECT 'legacy_product_mapping_required'::text,p.id,
    jsonb_build_object(
      'legacy_product_id',p.id,
      'mapping_id',m.id,
      'mapping_status',coalesce(m.status,'unresolved'),
      'mapping_migration_run_id',m.migration_run_id,
      'product_provenance_id',m.product_provenance_id,
      'available_provenance',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',pp.id,'migration_run_id',pp.migration_run_id,
          'review_item_id',pp.review_item_id,
          'dry_run_checksum',pp.dry_run_checksum,
          'provenance_checksum',pp.provenance_checksum
        ) ORDER BY pp.migration_run_id,pp.id)
          FROM public.artisanal_strap_migration_product_provenance pp
         WHERE pp.legacy_product_id=p.id
      ),'[]'::jsonb),
      'product_name',p.name,
      'product_color',p.color,
      'quantity',coalesce(p.quantity,0),
      'current_stock',coalesce(p.current_stock,0),
      'reserved_stock',coalesce(p.reserved_stock,0),
      'open_reservations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',r.id,
          'status',r.status,
          'quantity_reserved',r.quantity_reserved,
          'quantity_consumed',r.quantity_consumed,
          'remaining_reserved',greatest(r.quantity_reserved-r.quantity_consumed,0),
          'order_id',r.order_id,
          'sale_order_strap_demand_id',r.sale_order_strap_demand_id,
          'strap_stock_floor_contribution_id',r.strap_stock_floor_contribution_id
        ) ORDER BY r.id)
          FROM public.material_reservations r
         WHERE r.product_id=p.id
           AND r.status IN ('reserved','partially_consumed')
      ),'[]'::jsonb),
      'open_purchase_order_items',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',i.id,
          'purchase_order_id',po.id,
          'order_number',po.order_number,
          'order_status',po.status,
          'snapshot_locked_at',po.snapshot_locked_at,
          'assignable',po.snapshot_locked_at IS NULL
            AND public.normalize_strap_catalog_text(po.status) NOT IN (
              'approved','aprovado','aprovada','sent','enviado','enviada',
              'partial','parcial'
            ),
          'blocking_reason',CASE
            WHEN po.snapshot_locked_at IS NOT NULL
              OR public.normalize_strap_catalog_text(po.status) IN (
                'approved','aprovado','aprovada','sent','enviado','enviada',
                'partial','parcial'
              )
              THEN 'OC comprometida possui snapshot/PDF imutavel; aguarde o recebimento ou encerramento'
            ELSE NULL END,
          'quantity',i.quantity,
          'received_quantity',coalesce(i.received_quantity,0),
          'remaining_quantity',greatest(i.quantity-coalesce(i.received_quantity,0),0),
          'strap_variant_id',i.strap_variant_id
        ) ORDER BY po.id,i.id)
          FROM public.purchase_order_items i
          JOIN public.purchase_orders po ON po.id=i.purchase_order_id
         WHERE i.product_id=p.id
           AND public.is_open_legacy_strap_purchase_order_status(po.status)
      ),'[]'::jsonb),
      'open_service_order_items',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',i.id,
          'service_order_id',so.id,
          'order_number',so.order_number,
          'order_status',so.status,
          'line_status',i.line_status,
          'assignable',public.is_open_legacy_strap_service_status(i.line_status)
            AND public.is_open_legacy_strap_service_status(so.status),
          'blocking_reason',CASE
            WHEN NOT public.is_open_legacy_strap_service_status(so.status)
              THEN 'OS terminal e historica; nao pode ser remapeada'
            ELSE NULL END,
          'meters',i.meters,
          'delivered_meters',coalesce(i.delivered_qty,0),
          'remaining_meters',greatest(coalesce(i.meters,0)-coalesce(i.delivered_qty,0),0),
          'strap_variant_id',i.strap_variant_id,
          'strap_recipe_id',i.strap_recipe_id
        ) ORDER BY so.id,i.id)
          FROM public.service_order_items i
          JOIN public.service_orders so ON so.id=i.service_order_id
         WHERE i.finished_product_id=p.id
           AND public.is_open_legacy_strap_service_status(i.line_status)
      ),'[]'::jsonb),
      'current_allocations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'allocation_id',a.id,
          'strap_variant_id',a.strap_variant_id,
          'target_product_id',a.target_product_id,
          'quantity',a.quantity,
          'reserved_stock',a.reserved_stock,
          'reservation_ids',a.reservation_ids,
          'purchase_order_item_ids',a.purchase_order_item_ids,
          'service_order_item_ids',a.service_order_item_ids
        ) ORDER BY a.strap_variant_id)
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=m.id
      ),'[]'::jsonb)
    )
  FROM public.products p
  LEFT JOIN public.product_groups pg ON pg.id=p.group_id
  LEFT JOIN public.legacy_strap_product_migration_maps m
    ON m.legacy_product_id=p.id
  WHERE (p.is_artisanal OR coalesce(pg.is_artisanal_strap,false))
    AND p.strap_migration_status<>'migrated'
    AND (m.id IS NULL OR m.status='review_required')
    AND EXISTS (
      SELECT 1
        FROM public.artisanal_strap_migration_product_provenance pp
       WHERE pp.legacy_product_id=p.id
         AND (
           NOT EXISTS (
             SELECT 1 FROM public.artisanal_strap_migration_cutovers ac
              WHERE ac.status IN ('applied','applied_with_review')
           )
           OR pp.migration_run_id IN (
             SELECT ac.migration_run_id
               FROM public.artisanal_strap_migration_cutovers ac
              WHERE ac.status IN ('applied','applied_with_review')
           )
         )
    )
  ORDER BY p.id;

  RETURN QUERY
  SELECT 'resolved_technical_line_not_persisted'::text,m.id,
    jsonb_build_object('technical_sheet_id',m.technical_sheet_id,
      'legacy_ordinal',m.legacy_ordinal,
      'technical_strap_line_id',m.technical_strap_line_id,
      'measure_id',m.measure_id)
  FROM public.technical_strap_line_identity_map m
  JOIN public.technical_sheets ts ON ts.id=m.technical_sheet_id
  JOIN public.artisanal_strap_measures measure ON measure.id=m.measure_id
  WHERE m.status='resolved' AND (
    jsonb_typeof(ts.strap_colors) IS DISTINCT FROM 'array'
    OR ts.strap_colors->m.legacy_ordinal IS NULL
    OR ts.strap_colors->m.legacy_ordinal->>'technical_strap_line_id'
         IS DISTINCT FROM m.technical_strap_line_id::text
    OR ts.strap_colors->m.legacy_ordinal->>'measure_id'
         IS DISTINCT FROM m.measure_id::text
    OR ts.strap_colors->m.legacy_ordinal->>'strap_type_id'
         IS DISTINCT FROM measure.strap_type_id::text
  );

  RETURN QUERY
  SELECT 'legacy_product_mapping_provenance_invalid'::text,m.id,
    jsonb_build_object(
      'mapping_id',m.id,
      'legacy_product_id',m.legacy_product_id,
      'migration_run_id',m.migration_run_id,
      'product_provenance_id',m.product_provenance_id,
      'blockers',b.blockers
    )
  FROM public.legacy_strap_product_migration_maps m
  CROSS JOIN LATERAL (
    SELECT public.legacy_strap_product_mapping_blockers(m.id) AS blockers
  ) b
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(b.blockers) e(value)
     WHERE e.value->>'code' IN (
       'legacy_product_not_structurally_artisanal_strap',
       'legacy_product_dry_run_provenance_missing',
       'legacy_product_dry_run_provenance_invalid'
     )
  );

  RETURN QUERY
  SELECT 'resolved_product_mapping_blocked'::text,m.id,
    jsonb_build_object(
      'legacy_product_id',p.id,
      'mapping_id',m.id,
      'mapping_status',m.status,
      'migration_run_id',m.migration_run_id,
      'product_provenance_id',m.product_provenance_id,
      'product_name',p.name,
      'product_color',p.color,
      'quantity',coalesce(p.quantity,0),
      'current_stock',coalesce(p.current_stock,0),
      'reserved_stock',coalesce(p.reserved_stock,0),
      'open_reservations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',r.id,
          'status',r.status,
          'quantity_reserved',r.quantity_reserved,
          'quantity_consumed',r.quantity_consumed,
          'remaining_reserved',greatest(r.quantity_reserved-r.quantity_consumed,0),
          'order_id',r.order_id,
          'sale_order_strap_demand_id',r.sale_order_strap_demand_id,
          'strap_stock_floor_contribution_id',r.strap_stock_floor_contribution_id
        ) ORDER BY r.id)
          FROM public.material_reservations r
         WHERE r.product_id=p.id
           AND r.status IN ('reserved','partially_consumed')
      ),'[]'::jsonb),
      'open_purchase_order_items',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',i.id,
          'purchase_order_id',po.id,
          'order_number',po.order_number,
          'order_status',po.status,
          'snapshot_locked_at',po.snapshot_locked_at,
          'assignable',po.snapshot_locked_at IS NULL
            AND public.normalize_strap_catalog_text(po.status) NOT IN (
              'approved','aprovado','aprovada','sent','enviado','enviada',
              'partial','parcial'
            ),
          'blocking_reason',CASE
            WHEN po.snapshot_locked_at IS NOT NULL
              OR public.normalize_strap_catalog_text(po.status) IN (
                'approved','aprovado','aprovada','sent','enviado','enviada',
                'partial','parcial'
              )
              THEN 'OC comprometida possui snapshot/PDF imutavel; aguarde o recebimento ou encerramento'
            ELSE NULL END,
          'quantity',i.quantity,
          'received_quantity',coalesce(i.received_quantity,0),
          'remaining_quantity',greatest(i.quantity-coalesce(i.received_quantity,0),0),
          'strap_variant_id',i.strap_variant_id
        ) ORDER BY po.id,i.id)
          FROM public.purchase_order_items i
          JOIN public.purchase_orders po ON po.id=i.purchase_order_id
         WHERE i.product_id=p.id
           AND public.is_open_legacy_strap_purchase_order_status(po.status)
      ),'[]'::jsonb),
      'open_service_order_items',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id',i.id,
          'service_order_id',so.id,
          'order_number',so.order_number,
          'order_status',so.status,
          'line_status',i.line_status,
          'assignable',public.is_open_legacy_strap_service_status(i.line_status)
            AND public.is_open_legacy_strap_service_status(so.status),
          'blocking_reason',CASE
            WHEN NOT public.is_open_legacy_strap_service_status(so.status)
              THEN 'OS terminal e historica; nao pode ser remapeada'
            ELSE NULL END,
          'meters',i.meters,
          'delivered_meters',coalesce(i.delivered_qty,0),
          'remaining_meters',greatest(coalesce(i.meters,0)-coalesce(i.delivered_qty,0),0),
          'strap_variant_id',i.strap_variant_id,
          'strap_recipe_id',i.strap_recipe_id
        ) ORDER BY so.id,i.id)
          FROM public.service_order_items i
          JOIN public.service_orders so ON so.id=i.service_order_id
         WHERE i.finished_product_id=p.id
           AND public.is_open_legacy_strap_service_status(i.line_status)
      ),'[]'::jsonb),
      'current_allocations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'allocation_id',a.id,
          'strap_variant_id',a.strap_variant_id,
          'target_product_id',a.target_product_id,
          'quantity',a.quantity,
          'reserved_stock',a.reserved_stock,
          'reservation_ids',a.reservation_ids,
          'purchase_order_item_ids',a.purchase_order_item_ids,
          'service_order_item_ids',a.service_order_item_ids
        ) ORDER BY a.strap_variant_id)
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=m.id
      ),'[]'::jsonb),
      'blockers',public.legacy_strap_product_mapping_blockers(m.id)
    )
  FROM public.legacy_strap_product_migration_maps m
  JOIN public.products p ON p.id=m.legacy_product_id
  WHERE m.status='resolved'
    AND jsonb_array_length(public.legacy_strap_product_mapping_blockers(m.id))>0;

  RETURN QUERY
  SELECT 'legacy_replenishment_source_unavailable'::text,v.id,
    jsonb_build_object(
      'review_item_id',ri.id,
      'migration_run_id',ri.migration_run_id,
      'strap_variant_id',v.id,
      'finished_product_id',v.finished_product_id,
      'variant_status',v.status,
      'preserved_replenishment_mode',v.min_stock_replenishment_mode,
      'review_reason',ri.reason,
      'resolution_payload',ri.candidates,
      'source_availability',public.resolve_artisanal_strap_source_availability(v.id)
    )
  FROM public.artisanal_strap_migration_review_items ri
  JOIN public.artisanal_strap_variants v ON v.id::text=ri.legacy_id
  WHERE ri.entity_type='legacy_replenishment_source_unavailable'
    AND ri.status='review_required';

  RETURN QUERY
  SELECT 'resolved_product_mapping_ready_to_apply'::text,m.id,
    jsonb_build_object(
      'cutover_id',c.id,
      'mapping_id',m.id,
      'legacy_product_id',m.legacy_product_id,
      'migration_run_id',m.migration_run_id,
      'product_provenance_id',m.product_provenance_id,
      'allocation_checksum',m.allocation_checksum,
      'scope_checksum',public.artisanal_strap_product_mapping_scope_checksum(c.id,m.id),
      'affected_variant_ids',coalesce((
        SELECT jsonb_agg(a.strap_variant_id ORDER BY a.strap_variant_id)
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=m.id
      ),'[]'::jsonb),
      'blockers','[]'::jsonb
    )
  FROM public.legacy_strap_product_migration_maps m
  JOIN public.artisanal_strap_migration_cutovers c
    ON c.status IN ('applied','applied_with_review')
  WHERE m.status='resolved' AND m.applied_cutover_id IS NULL
    AND m.applied_at IS NULL
    AND jsonb_array_length(public.artisanal_strap_incremental_mapping_blockers(
      c.id,m.id))=0;

  RETURN QUERY
  SELECT 'resolved_product_mapping_incremental_blocked'::text,m.id,
    jsonb_build_object(
      'cutover_id',c.id,
      'mapping_id',m.id,
      'legacy_product_id',m.legacy_product_id,
      'migration_run_id',m.migration_run_id,
      'product_provenance_id',m.product_provenance_id,
      'allocation_checksum',m.allocation_checksum,
      'scope_checksum',public.artisanal_strap_product_mapping_scope_checksum(c.id,m.id),
      'affected_variant_ids',coalesce((
        SELECT jsonb_agg(a.strap_variant_id ORDER BY a.strap_variant_id)
          FROM public.legacy_strap_product_migration_allocations a
         WHERE a.mapping_id=m.id
      ),'[]'::jsonb),
      'blockers',public.artisanal_strap_incremental_mapping_blockers(c.id,m.id)
    )
  FROM public.legacy_strap_product_migration_maps m
  JOIN public.artisanal_strap_migration_cutovers c
    ON c.status IN ('applied','applied_with_review')
  WHERE m.status='resolved' AND m.applied_cutover_id IS NULL
    AND m.applied_at IS NULL
    AND jsonb_array_length(public.artisanal_strap_incremental_mapping_blockers(
      c.id,m.id))>0;

  RETURN QUERY
  SELECT 'resolved_recipe_missing_on_service_order'::text,so.id,
    jsonb_build_object('legacy_recipe_id',so.artisanal_recipe_id,
      'expected_canonical_recipe_id',m.canonical_recipe_id,
      'actual_canonical_recipe_id',so.canonical_strap_recipe_id,
      'status',so.status)
  FROM public.service_orders so
  JOIN public.legacy_artisanal_recipe_map m
    ON m.legacy_recipe_id=so.artisanal_recipe_id AND m.status='resolved'
  WHERE so.canonical_strap_recipe_id IS DISTINCT FROM m.canonical_recipe_id;

  RETURN QUERY
  SELECT 'ambiguous_variant_demand_not_suspended'::text,d.id,
    jsonb_build_object('sale_order_id',d.sale_order_id,
      'sale_order_item_id',d.sale_order_item_id,'strap_variant_id',d.strap_variant_id,
      'demand_status',d.status,'variant_status',v.status,
      'product_migration_status',p.strap_migration_status)
  FROM public.sale_order_strap_demands d
  JOIN public.artisanal_strap_variants v ON v.id=d.strap_variant_id
  JOIN public.products p ON p.id=v.finished_product_id
  WHERE d.is_current AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended')
    AND (v.status='review_required' OR p.strap_migration_status='review_required');

  RETURN QUERY
  SELECT 'migrated_product_current_stock_mismatch'::text,p.id,
    jsonb_build_object('product_id',p.id,
      'quantity',coalesce(p.quantity,0),
      'current_stock',coalesce(p.current_stock,0),
      'migration_status',p.strap_migration_status)
  FROM public.products p
  WHERE p.strap_migration_status='migrated'
    AND coalesce(p.current_stock,0) IS DISTINCT FROM coalesce(p.quantity,0);

  RETURN QUERY
  SELECT 'migrated_product_reserved_stock_mismatch'::text,p.id,
    jsonb_build_object('product_id',p.id,
      'reserved_stock',coalesce(p.reserved_stock,0),
      'open_reservation_balance',coalesce((
        SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
          FROM public.material_reservations r
         WHERE r.product_id=p.id
           AND r.status IN ('reserved','partially_consumed')
      ),0),'migration_status',p.strap_migration_status)
  FROM public.products p
  WHERE p.strap_migration_status='migrated'
    AND coalesce(p.reserved_stock,0) IS DISTINCT FROM coalesce((
      SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
        FROM public.material_reservations r
       WHERE r.product_id=p.id
         AND r.status IN ('reserved','partially_consumed')
    ),0);

  RETURN QUERY
  SELECT 'cutover_state_checksum_drift'::text,c.id,
    jsonb_build_object('expected',c.post_state_checksum,
      'current',public.artisanal_strap_legacy_state_checksum(),
      'rollback_preflight_required',true)
  FROM public.artisanal_strap_migration_cutovers c
  WHERE c.status IN ('applied','applied_with_review')
    AND c.post_state_checksum IS DISTINCT FROM public.artisanal_strap_legacy_state_checksum();

  RETURN QUERY
  SELECT 'stock_transfer_movement_pair_missing'::text,t.id,
    jsonb_build_object('cutover_id',t.cutover_id,'mapping_id',t.mapping_id,
      'allocation_id',t.allocation_id,'quantity',t.quantity,
      'out_movement_id',t.out_movement_id,'in_movement_id',t.in_movement_id)
  FROM public.legacy_strap_stock_transfers t
  WHERE t.quantity>0 AND (t.out_movement_id IS NULL OR t.in_movement_id IS NULL);

  RETURN QUERY
  SELECT 'incremental_application_integrity_mismatch'::text,a.id,
    jsonb_build_object(
      'cutover_id',a.cutover_id,'mapping_id',a.mapping_id,
      'application_status',a.status,'mapping_status',m.status,
      'mapping_applied_cutover_id',m.applied_cutover_id,
      'stored_scope_checksum_after',a.scope_checksum_after,
      'calculated_scope_checksum_after',CASE WHEN a.scope_after IS NULL THEN NULL
        ELSE public.strap_payload_hash(a.scope_after) END,
      'jobs_missing_from_cutover_manifest',coalesce((
        SELECT jsonb_agg(job_id ORDER BY job_id)
          FROM (
            SELECT value::uuid AS job_id
              FROM jsonb_array_elements_text(
                coalesce(a.result->'enqueued_job_ids','[]'::jsonb)) r(value)
             WHERE NOT (value::uuid IN (
               SELECT manifest_value::uuid
                 FROM jsonb_array_elements_text(coalesce(
                   c.manifest->'cutover_job_ids','[]'::jsonb)) m(manifest_value)
             ))
          ) missing
      ),'[]'::jsonb)
    )
  FROM public.artisanal_strap_migration_incremental_applications a
  JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
  JOIN public.artisanal_strap_migration_cutovers c ON c.id=a.cutover_id
  WHERE a.status='applied' AND (
    m.status<>'applied' OR m.applied_cutover_id IS DISTINCT FROM a.cutover_id
    OR a.scope_after IS NULL
    OR a.scope_checksum_after IS DISTINCT FROM public.strap_payload_hash(a.scope_after)
    OR EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
          coalesce(a.result->'enqueued_job_ids','[]'::jsonb)) r(value)
       WHERE NOT (value::uuid IN (
         SELECT manifest_value::uuid
           FROM jsonb_array_elements_text(coalesce(
             c.manifest->'cutover_job_ids','[]'::jsonb)) m(manifest_value)
       ))
    )
  );

  RETURN QUERY
  SELECT 'legacy_base_debit_trigger_present'::text,NULL::uuid,
    jsonb_build_object('trigger_name',t.tgname,'table','service_orders')
  FROM pg_trigger t
  WHERE t.tgrelid='public.service_orders'::regclass
    AND t.tgname IN ('trg_debit_service_order_base','trg_revert_service_order_base_on_cancel')
    AND NOT t.tgisinternal;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. RLS, revogacoes do legado, grants minimos e assertions
-- ----------------------------------------------------------------------------

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_migration_product_provenance',
    'legacy_strap_product_migration_maps',
    'legacy_strap_product_migration_allocations',
    'artisanal_strap_migration_cutovers',
    'artisanal_strap_migration_entity_snapshots',
    'legacy_strap_stock_transfers',
    'artisanal_strap_migration_incremental_applications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',v_table);
  END LOOP;
END;
$$;

CREATE POLICY artisanal_strap_product_provenance_admin_select
  ON public.artisanal_strap_migration_product_provenance FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY legacy_strap_product_maps_admin_select
  ON public.legacy_strap_product_migration_maps FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY legacy_strap_product_allocations_admin_select
  ON public.legacy_strap_product_migration_allocations FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY artisanal_strap_migration_cutovers_admin_select
  ON public.artisanal_strap_migration_cutovers FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY artisanal_strap_migration_snapshots_admin_select
  ON public.artisanal_strap_migration_entity_snapshots FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY legacy_strap_stock_transfers_admin_select
  ON public.legacy_strap_stock_transfers FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));
CREATE POLICY artisanal_strap_migration_incremental_admin_select
  ON public.artisanal_strap_migration_incremental_applications FOR SELECT TO authenticated
  USING ((SELECT public.has_artisanal_strap_capability('resolve_strap_migration')));

GRANT SELECT ON public.artisanal_strap_migration_product_provenance,
  public.legacy_strap_product_migration_maps,
  public.legacy_strap_product_migration_allocations,
  public.artisanal_strap_migration_cutovers,
  public.artisanal_strap_migration_entity_snapshots,
  public.legacy_strap_stock_transfers,
  public.artisanal_strap_migration_incremental_applications,
  public.v_legacy_artisanal_strap_recipe_history,
  public.v_artisanal_strap_legacy_migration_admin
TO authenticated;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_migration_product_provenance',
    'legacy_strap_product_migration_maps',
    'legacy_strap_product_migration_allocations',
    'artisanal_strap_migration_cutovers',
    'artisanal_strap_migration_incremental_applications'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',v_table
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_audit_artisanal_strap_catalog()',v_table
    );
  END LOOP;
END;
$$;

-- Retirada nominal dos escritores/fatos antigos. A funcao antiga permanece no
-- catalogo somente para leitura historica/diagnostico e nao recebe EXECUTE.
DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;
DROP TRIGGER IF EXISTS trg_revert_service_order_base_on_cancel ON public.service_orders;

-- A relacao de produto base oficial (por exemplo, NAPA por cor), sozinha, nao
-- o transforma em tira. O helper nominal cobre acabado/mapa/status; o trigger
-- abaixo acrescenta as flags estruturais da propria linha OLD/NEW para tambem
-- fechar INSERT e transicao de cadastro na mesma instrucao.
CREATE OR REPLACE FUNCTION public.is_legacy_strap_migration_controlled_product(
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.products p
     WHERE p.id=p_product_id
       AND (
         p.strap_migration_status IN ('review_required','resolved','migrated')
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_variants v
            WHERE v.finished_product_id=p.id
         )
         OR EXISTS (
           SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
            WHERE pp.legacy_product_id=p.id
         )
         OR EXISTS (
           SELECT 1 FROM public.legacy_strap_product_migration_maps m
            WHERE m.legacy_product_id=p.id
         )
         OR EXISTS (
           SELECT 1
             FROM public.legacy_strap_product_migration_allocations a
             JOIN public.legacy_strap_product_migration_maps m ON m.id=a.mapping_id
            WHERE a.target_product_id=p.id
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_legacy_artisanal_product_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_legacy boolean:=false;
  v_new_legacy boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN
    v_old_legacy:=coalesce(OLD.is_artisanal,false)
      OR EXISTS (
        SELECT 1 FROM public.product_groups pg
         WHERE pg.id=OLD.group_id
           AND coalesce(pg.is_artisanal_strap,false)
      ) OR coalesce(
        OLD.strap_migration_status IN ('review_required','resolved','migrated'),false
      ) OR public.is_legacy_strap_migration_controlled_product(OLD.id);
  END IF;
  IF TG_OP<>'DELETE' THEN
    v_new_legacy:=coalesce(NEW.is_artisanal,false)
      OR EXISTS (
        SELECT 1 FROM public.product_groups pg
         WHERE pg.id=NEW.group_id
           AND coalesce(pg.is_artisanal_strap,false)
      ) OR coalesce(
        NEW.strap_migration_status IN ('review_required','resolved','migrated'),false
      ) OR public.is_legacy_strap_migration_controlled_product(NEW.id);
  END IF;
  IF NOT (v_old_legacy OR v_new_legacy) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Produto de tira com historico nao pode ser excluido; arquive a variante';
  END IF;
  IF auth.role()='service_role'
     OR current_setting('app.artisanal_strap_catalog_write',true)='1'
     OR (current_setting('app.strap_legacy_migration_write',true)='1'
       AND public.has_artisanal_strap_capability('resolve_strap_migration')) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE'
     AND current_setting('app.strap_engine_write',true)='1'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.sku IS NOT DISTINCT FROM OLD.sku
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
     AND NEW.active IS NOT DISTINCT FROM OLD.active
     AND NEW.min_stock IS NOT DISTINCT FROM OLD.min_stock
     AND NEW.unit IS NOT DISTINCT FROM OLD.unit
     AND NEW.is_artisanal IS NOT DISTINCT FROM OLD.is_artisanal
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
     AND NEW.purchase_unit IS NOT DISTINCT FROM OLD.purchase_unit
     AND NEW.purchase_order_unit IS NOT DISTINCT FROM OLD.purchase_order_unit
     AND NEW.conversion_rate IS NOT DISTINCT FROM OLD.conversion_rate
     AND NEW.purchase_price IS NOT DISTINCT FROM OLD.purchase_price
     AND NEW.min_order_quantity IS NOT DISTINCT FROM OLD.min_order_quantity
     AND NEW.purchase_multiple IS NOT DISTINCT FROM OLD.purchase_multiple
     AND NEW.material_preparation_days IS NOT DISTINCT FROM OLD.material_preparation_days THEN
    -- Recebimentos, picking e baixa de producao podem alterar apenas o fato
    -- fisico/WAC com o token transacional do motor. Identidade e condicoes
    -- comerciais continuam protegidas pela RPC de catalogo.
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Escritor legado de produto de tira congelado; use o catalogo canonico';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_product_insert_delete
  ON public.products;
CREATE TRIGGER trg_guard_legacy_artisanal_product_insert_delete
  BEFORE INSERT OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_legacy_artisanal_product_writer();
DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_product_update
  ON public.products;
CREATE TRIGGER trg_guard_legacy_artisanal_product_update
  BEFORE UPDATE OF name,sku,category,group_id,active,min_stock,unit,is_artisanal,
    supplier_id,purchase_unit,purchase_order_unit,conversion_rate,purchase_price,
    min_order_quantity,purchase_multiple,material_preparation_days,
    quantity,current_stock,reserved_stock,unit_price,stock_grade
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_legacy_artisanal_product_writer();

-- O helper nominal ignora intencionalmente a NAPA-base oficial. Este guard
-- repete flag/grupo/finished da linha persistida para impedir que um item de
-- tira estrutural pre-dry-run seja recebido por OC generica.
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
  v_old_strap_product boolean:=false;
  v_new_strap_product boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT po.snapshot_locked_at,po.source_type INTO v_old_locked,v_old_source
      FROM public.purchase_orders po WHERE po.id=OLD.purchase_order_id;
    SELECT coalesce(p.is_artisanal,false)
           OR coalesce(pg.is_artisanal_strap,false)
           OR EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.finished_product_id=p.id
           )
           OR public.is_legacy_strap_migration_controlled_product(p.id)
      INTO v_old_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.id=OLD.product_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT po.snapshot_locked_at,po.source_type INTO v_new_locked,v_new_source
      FROM public.purchase_orders po WHERE po.id=NEW.purchase_order_id;
    SELECT coalesce(p.is_artisanal,false)
           OR coalesce(pg.is_artisanal_strap,false)
           OR EXISTS (
             SELECT 1 FROM public.artisanal_strap_variants v
              WHERE v.finished_product_id=p.id
           )
           OR public.is_legacy_strap_migration_controlled_product(p.id)
      INTO v_new_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.id=NEW.product_id;
    IF coalesce(v_new_strap_product,false)
       AND v_new_source IS DISTINCT FROM 'strap_demand' THEN
      RAISE EXCEPTION 'Produto legado/canonico de tira so pode entrar pela OC strap_demand; inbound generico bloqueado';
    END IF;
    IF v_new_source='strap_demand' AND (
      NEW.strap_variant_id IS NULL OR NOT EXISTS(
        SELECT 1
          FROM public.artisanal_strap_variants v
          LEFT JOIN public.base_material_color_official_products op
            ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
         WHERE v.id=NEW.strap_variant_id
           AND (v.finished_product_id=NEW.product_id
                OR op.official_product_id=NEW.product_id)
      )
    ) THEN
      RAISE EXCEPTION 'Item de OC de tira exige strap_variant_id e produto exatos';
    END IF;
  END IF;
  IF coalesce(v_old_source,'')<>'strap_demand'
     AND coalesce(v_new_source,'')<>'strap_demand' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('app.strap_po_engine',true)='1'
     AND v_old_locked IS NULL AND v_new_locked IS NULL THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='UPDATE' AND current_setting('app.strap_po_receipt',true)='1'
     AND OLD.purchase_order_id=NEW.purchase_order_id
     AND v_old_source='strap_demand' AND v_new_source='strap_demand'
     AND (to_jsonb(NEW)-'received_quantity'-'received_at')
       = (to_jsonb(OLD)-'received_quantity'-'received_at') THEN
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
  v_open_strap_po boolean:=false;
  v_po_source text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(nullif(btrim(p.unit),''),'un'),
         coalesce(nullif(btrim(p.purchase_unit),''),nullif(btrim(p.unit),''),'un'),
         coalesce(p.is_artisanal,false),
         coalesce(pg.is_artisanal_strap,false),
         EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
           WHERE v.finished_product_id=p.id),
         EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
           WHERE v.finished_product_id=p.id AND v.status='active'
             AND v.purchase_enabled),
         public.is_legacy_strap_migration_controlled_product(p.id)
    INTO v_stock_unit,v_purchase_unit,v_is_artisanal,v_group_is_strap,
         v_is_strap_product,v_is_buyable_strap,v_is_migration_strap
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
   WHERE p.id=NEW.product_id;
  IF v_stock_unit IS NULL THEN
    RAISE EXCEPTION 'Produto da linha de OC nao encontrado';
  END IF;
  SELECT po.source_type INTO v_po_source FROM public.purchase_orders po
   WHERE po.id=NEW.purchase_order_id;
  v_is_strap_product:=coalesce(v_is_strap_product,false)
    OR coalesce(v_group_is_strap,false) OR coalesce(v_is_artisanal,false)
    OR coalesce(v_is_migration_strap,false);
  IF v_is_strap_product AND v_po_source IS DISTINCT FROM 'strap_demand' THEN
    RAISE EXCEPTION 'Produto legado/canonico de tira nao pode ser comprado/recebido por OC generica';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id=NEW.product_id
  ) AND NOT v_is_buyable_strap THEN
    RAISE EXCEPTION 'Material artesanal nao compravel: produza por lote/OS';
  END IF;
  IF v_po_source='strap_demand' AND (
    NEW.strap_variant_id IS NULL OR NOT EXISTS(
      SELECT 1
        FROM public.artisanal_strap_variants v
        LEFT JOIN public.base_material_color_official_products op
          ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
       WHERE v.id=NEW.strap_variant_id
         AND (v.finished_product_id=NEW.product_id
              OR op.official_product_id=NEW.product_id)
    )
  ) THEN
    RAISE EXCEPTION 'OC canonica exige variante e produto estruturalmente compativeis';
  END IF;
  IF public.po_norm_unit(coalesce(NEW.unit,'')) NOT IN (
    public.po_norm_unit(v_stock_unit),public.po_norm_unit(v_purchase_unit)
  ) THEN
    RAISE EXCEPTION 'Unidade de OC invalida; compra %, estoque %',
      v_purchase_unit,v_stock_unit;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.purchase_orders po
     WHERE po.id=NEW.purchase_order_id AND po.source_type='strap_demand'
       AND po.snapshot_locked_at IS NULL
       AND po.status IN ('draft','pending','Pendente')
  ) INTO v_open_strap_po;
  IF NOT v_open_strap_po
     AND (coalesce(NEW.quantity,0)<=0 OR coalesce(NEW.unit_price,0)<=0) THEN
    RAISE EXCEPTION 'Quantidade e preco da linha de OC devem ser positivos';
  END IF;
  IF v_open_strap_po
     AND (coalesce(NEW.quantity,0)<0 OR coalesce(NEW.unit_price,0)<0) THEN
    RAISE EXCEPTION 'Quantidade/preco bloqueado nao pode ser negativo';
  END IF;
  RETURN NEW;
END;
$$;

-- Os triggers de 03200 continuam anexados aos mesmos OIDs de funcao. A
-- constraint diferida de origem exige contribution exata antes do COMMIT.

-- O ajuste generico de estoque permanece disponivel para materiais comuns e
-- para a NAPA-base oficial. Produto acabado de tira ou legado nominal exige
-- identidade, custo, correlacao e auditoria do motor operacional.
DO $$
BEGIN
  IF to_regprocedure('public.adjust_stock_batch(jsonb,boolean)') IS NOT NULL
     AND to_regprocedure('public.adjust_stock_batch_legacy_non_strap_202701(jsonb,boolean)') IS NULL THEN
    ALTER FUNCTION public.adjust_stock_batch(jsonb,boolean)
      RENAME TO adjust_stock_batch_legacy_non_strap_202701;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_batch_legacy_non_strap_202701(jsonb,boolean)
FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.adjust_stock_batch(
  p_items jsonb,
  p_enforce_reserved boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Administrador/Almoxarifado pode ajustar estoque';
  END IF;
  IF jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'p_items deve ser array'; END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) x(value)
      JOIN public.products p ON p.id=nullif(x.value->>'product_id','')::uuid
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE coalesce(p.is_artisanal,false)
        OR coalesce(pg.is_artisanal_strap,false)
        OR public.is_legacy_strap_migration_controlled_product(p.id)
  ) THEN
    RAISE EXCEPTION 'Ajuste generico bloqueado para tira acabada/produto legado; use recebimento, picking ou conciliacao operacional de tiras';
  END IF;
  RETURN public.adjust_stock_batch_legacy_non_strap_202701(
    p_items,coalesce(p_enforce_reserved,false));
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_batch(jsonb,boolean)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock_batch(jsonb,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_guard_legacy_artisanal_recipe_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.strap_legacy_migration_write',true)='1'
     AND public.has_artisanal_strap_capability('resolve_strap_migration') THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Receita artesanal legada e historica; use artisanal_strap_recipes';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_recipe_writer
  ON public.artisanal_recipes;
CREATE TRIGGER trg_guard_legacy_artisanal_recipe_writer
  BEFORE INSERT OR UPDATE OR DELETE ON public.artisanal_recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_legacy_artisanal_recipe_writer();
REVOKE INSERT,UPDATE,DELETE ON public.artisanal_recipes
FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.tg_guard_legacy_artisanal_service_order_writer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_legacy_identity boolean:=NEW.artisanal_recipe_id IS NOT NULL
    OR nullif(btrim(coalesce(NEW.artisanal_output_name,'')),'') IS NOT NULL
    OR nullif(btrim(coalesce(NEW.artisanal_output_color,'')),'') IS NOT NULL
    OR coalesce(NEW.artisanal_output_meters,0)<>0
    OR coalesce(NEW.artisanal_for_order_meters,0)<>0
    OR coalesce(NEW.artisanal_for_stock_meters,0)<>0
    OR nullif(btrim(coalesce(NEW.artisanal_base_color,'')),'') IS NOT NULL
    OR coalesce(NEW.artisanal_stock_entry_done,false)
    OR (TG_OP='UPDATE' AND (
      OLD.artisanal_recipe_id IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_name,'')),'') IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_color,'')),'') IS NOT NULL
      OR coalesce(OLD.artisanal_output_meters,0)<>0
      OR coalesce(OLD.artisanal_for_order_meters,0)<>0
      OR coalesce(OLD.artisanal_for_stock_meters,0)<>0
      OR nullif(btrim(coalesce(OLD.artisanal_base_color,'')),'') IS NOT NULL
      OR coalesce(OLD.artisanal_stock_entry_done,false)
    ));
BEGIN
  IF NOT v_has_legacy_identity THEN RETURN NEW; END IF;
  IF current_setting('app.strap_engine_write',true)='1' THEN RETURN NEW; END IF;
  IF current_setting('app.strap_legacy_migration_write',true)='1'
     AND public.has_artisanal_strap_capability('resolve_strap_migration') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Escritor de OS artesanal legada congelado; use lote/linha canonica de tiras';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_service_order_insert
  ON public.service_orders;
CREATE TRIGGER trg_guard_legacy_artisanal_service_order_insert
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_legacy_artisanal_service_order_writer();
DROP TRIGGER IF EXISTS trg_guard_legacy_artisanal_service_order_update
  ON public.service_orders;
CREATE TRIGGER trg_guard_legacy_artisanal_service_order_update
  BEFORE UPDATE OF artisanal_recipe_id,artisanal_output_name,
    artisanal_output_color,artisanal_output_meters,artisanal_for_order_meters,
    artisanal_for_stock_meters,artisanal_base_color,artisanal_stock_entry_done
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_legacy_artisanal_service_order_writer();

DO $$
DECLARE v_proc record;
BEGIN
  FOR v_proc IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('create_artisanal_product_with_stock','upsert_open_service_order',
         'debit_service_order_base','tg_debit_service_order_base',
         'tg_revert_service_order_base_on_cancel')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',
      v_proc.signature);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION
  public.is_open_legacy_strap_sale_order_status(text),
  public.is_open_legacy_strap_purchase_order_status(text),
  public.is_open_legacy_strap_service_status(text),
  public.capture_artisanal_strap_product_provenance(uuid),
  public.log_artisanal_strap_migration_event(text,uuid,text,jsonb,jsonb,text,uuid),
  public.record_artisanal_strap_migration_snapshot(uuid,text,uuid,jsonb),
  public.finish_artisanal_strap_migration_snapshot(uuid,text,uuid,jsonb),
  public.artisanal_strap_legacy_state_checksum(),
  public.legacy_strap_product_mapping_blockers(uuid),
  public.legacy_strap_product_mapping_cutover_blockers(uuid,uuid),
  public.artisanal_strap_product_mapping_scope_snapshot(uuid,uuid),
  public.artisanal_strap_product_mapping_scope_checksum(uuid,uuid),
  public.artisanal_strap_incremental_mapping_blockers(uuid,uuid),
  public.apply_resolved_legacy_strap_product_mapping(uuid,uuid,text,uuid),
  public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid),
  public.is_legacy_strap_migration_controlled_product(uuid),
  public.artisanal_strap_legacy_conservation_report(),
  public.current_artisanal_strap_migration_snapshot(text,uuid)
FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION
  public.tg_capture_artisanal_strap_product_provenance(),
  public.tg_guard_active_strap_migration_review_provenance(),
  public.tg_block_strap_migration_dry_run_during_cutover(),
  public.tg_resolve_open_sale_order_item_strap_migration(),
  public.tg_guard_legacy_artisanal_product_writer(),
  public.tg_guard_legacy_artisanal_recipe_writer(),
  public.tg_guard_legacy_artisanal_service_order_writer(),
  public.tg_guard_strap_purchase_order_item(),
  public.tg_validate_purchase_order_item()
FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION
  public.resolve_artisanal_strap_migration_review_item(uuid,jsonb,text),
  public.resolve_technical_strap_line_migration(uuid,uuid,text),
  public.resolve_legacy_artisanal_recipe_migration(uuid,uuid,text),
  public.resolve_legacy_strap_product_migration(uuid,jsonb,text,text,uuid),
  public.apply_artisanal_strap_migration(uuid,text,text,uuid),
  public.apply_resolved_legacy_strap_product_mapping_incremental(uuid,uuid,text,text,text,uuid),
  public.preview_artisanal_strap_migration_rollback(uuid),
  public.rollback_artisanal_strap_migration(uuid,text,text,uuid),
  public.artisanal_strap_legacy_migration_diagnostics()
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
  public.resolve_artisanal_strap_migration_review_item(uuid,jsonb,text),
  public.resolve_technical_strap_line_migration(uuid,uuid,text),
  public.resolve_legacy_artisanal_recipe_migration(uuid,uuid,text),
  public.resolve_legacy_strap_product_migration(uuid,jsonb,text,text,uuid),
  public.apply_artisanal_strap_migration(uuid,text,text,uuid),
  public.apply_resolved_legacy_strap_product_mapping_incremental(uuid,uuid,text,text,text,uuid),
  public.preview_artisanal_strap_migration_rollback(uuid),
  public.rollback_artisanal_strap_migration(uuid,text,text,uuid),
  public.artisanal_strap_legacy_migration_diagnostics()
TO authenticated;

DO $$
DECLARE
  v_table text;
  v_blocker_definition text;
  v_product_resolver_definition text;
  v_helper_definition text;
  v_global_definition text;
  v_incremental_definition text;
  v_rollback_definition text;
  v_rollback_preview_definition text;
  v_review_resolver_definition text;
  v_technical_definition text;
  v_recipe_definition text;
  v_sale_review_definition text;
  v_review_guard_definition text;
  v_dry_run_guard_definition text;
  v_dry_run_definition text;
  v_po_classification_definition text;
  v_product_guard_definition text;
  v_adjust_stock_definition text;
  v_po_guard_definition text;
  v_po_validator_definition text;
  v_po_origin_trigger text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.service_orders'::regclass
       AND t.tgname IN ('trg_debit_service_order_base','trg_revert_service_order_base_on_cancel')
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Cutover incompleto: trigger legado de napa ainda ativo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.service_orders'::regclass
       AND t.tgname='trg_guard_legacy_artisanal_service_order_insert'
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.service_orders'::regclass
       AND t.tgname='trg_guard_legacy_artisanal_service_order_update'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Guard de escritor de OS artesanal legada ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.products'::regclass
       AND t.tgname='trg_guard_legacy_artisanal_product_insert_delete'
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.products'::regclass
       AND t.tgname='trg_guard_legacy_artisanal_product_update'
       AND NOT t.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.artisanal_recipes'::regclass
       AND t.tgname='trg_guard_legacy_artisanal_recipe_writer'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Guard de produto/receita artesanal legada ausente';
  END IF;
  IF has_table_privilege('authenticated','public.artisanal_recipes','INSERT')
     OR has_table_privilege('authenticated','public.artisanal_recipes','UPDATE')
     OR has_table_privilege('authenticated','public.artisanal_recipes','DELETE') THEN
    RAISE EXCEPTION 'Escrita direta indevida em artisanal_recipes';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.artisanal_strap_migration_review_items'::regclass
       AND t.tgname='trg_capture_artisanal_strap_product_provenance'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Captura nominal de proveniencia do dry-run ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.artisanal_strap_migration_review_items'::regclass
       AND t.tgname='trg_guard_active_strap_migration_review_provenance'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Guard de proveniencia contra novo dry-run ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.artisanal_strap_migration_runs'::regclass
       AND t.tgname='trg_block_strap_migration_dry_run_during_cutover'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Bloqueio de novo dry-run durante cutover ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.strap_demand_jobs'::regclass
       AND t.tgname='trg_resolve_open_sale_order_item_strap_migration'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Fechamento operacional da review de PV ausente';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_migration_product_provenance',
    'legacy_strap_product_migration_maps',
    'legacy_strap_product_migration_allocations',
    'artisanal_strap_migration_cutovers',
    'artisanal_strap_migration_entity_snapshots',
    'legacy_strap_stock_transfers',
    'artisanal_strap_migration_incremental_applications'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS ausente em %',v_table;
    END IF;
    IF has_table_privilege('authenticated','public.'||v_table,'INSERT')
       OR has_table_privilege('authenticated','public.'||v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_table,'DELETE') THEN
      RAISE EXCEPTION 'Escrita direta indevida em %',v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated',
       'public.apply_resolved_legacy_strap_product_mapping(uuid,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.capture_artisanal_strap_product_provenance(uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.legacy_strap_product_mapping_cutover_blockers(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.artisanal_strap_product_mapping_scope_snapshot(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.artisanal_strap_product_mapping_scope_checksum(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.artisanal_strap_incremental_mapping_blockers(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.is_legacy_strap_migration_controlled_product(uuid)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.tg_guard_active_strap_migration_review_provenance()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.tg_block_strap_migration_dry_run_during_cutover()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.tg_resolve_open_sale_order_item_strap_migration()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.tg_guard_strap_purchase_order_item()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.tg_validate_purchase_order_item()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.run_artisanal_strap_catalog_migration_dry_run_unfenced_202701(text)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.artisanal_strap_legacy_state_checksum()','EXECUTE') THEN
    RAISE EXCEPTION 'Helper interno de migracao exposto ao authenticated';
  END IF;
  -- Repro adversarial: produto comum (ex.: cola) nao pode possuir prova valida
  -- nem mapa. A FK composta impede trocar o product_id depois da captura e o
  -- resolver exige esta linha alem da classificacao estrutural.
  IF EXISTS (
    SELECT 1
      FROM public.artisanal_strap_migration_product_provenance pp
      JOIN public.products p ON p.id=pp.legacy_product_id
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE NOT (coalesce(p.is_artisanal,false)
                 OR coalesce(pg.is_artisanal_strap,false))
  ) OR EXISTS (
    SELECT 1
      FROM public.legacy_strap_product_migration_maps m
      LEFT JOIN public.artisanal_strap_migration_product_provenance pp
        ON pp.id=m.product_provenance_id
       AND pp.migration_run_id=m.migration_run_id
       AND pp.legacy_product_id=m.legacy_product_id
     WHERE pp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Produto nao candidato conseguiu proveniencia/mapa de tira';
  END IF;
  -- Repro do recebimento de NAPA: ser produto oficial de uma base/cor, sozinho,
  -- nao o torna produto acabado/legado congelado. Em contrapartida, todo
  -- acabado, provenanced, mapped ou status nominal precisa permanecer guardado.
  IF EXISTS (
    SELECT 1
      FROM public.base_material_color_official_products op
      JOIN public.products p ON p.id=op.official_product_id
     WHERE op.status='active'
       AND NOT coalesce(p.is_artisanal,false)
       AND NOT EXISTS (
         SELECT 1 FROM public.product_groups pg
          WHERE pg.id=p.group_id AND coalesce(pg.is_artisanal_strap,false)
       )
       AND coalesce(p.strap_migration_status,'not_applicable')
             NOT IN ('review_required','resolved','migrated')
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.finished_product_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
          WHERE pp.legacy_product_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.legacy_strap_product_migration_maps m
          WHERE m.legacy_product_id=p.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.legacy_strap_product_migration_allocations a
          WHERE a.target_product_id=p.id
       )
       AND public.is_legacy_strap_migration_controlled_product(p.id)
  ) THEN
    RAISE EXCEPTION 'Repro NAPA-base: produto oficial isolado foi congelado como tira';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id IS NOT NULL
       AND NOT public.is_legacy_strap_migration_controlled_product(
         v.finished_product_id)
  ) OR EXISTS (
    SELECT 1 FROM public.artisanal_strap_migration_product_provenance pp
     WHERE NOT public.is_legacy_strap_migration_controlled_product(
       pp.legacy_product_id)
  ) OR EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_maps m
     WHERE NOT public.is_legacy_strap_migration_controlled_product(
       m.legacy_product_id)
  ) OR EXISTS (
    SELECT 1 FROM public.legacy_strap_product_migration_allocations a
     WHERE NOT public.is_legacy_strap_migration_controlled_product(
       a.target_product_id)
  ) OR EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.strap_migration_status IN ('review_required','resolved','migrated')
       AND NOT public.is_legacy_strap_migration_controlled_product(p.id)
  ) THEN
    RAISE EXCEPTION 'Repro tira acabada/mapped: produto controlado escapou do guard';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.legacy_artisanal_recipe_map m
      JOIN public.service_orders so ON so.artisanal_recipe_id=m.legacy_recipe_id
     WHERE m.status='resolved'
       AND so.canonical_strap_recipe_id IS NOT NULL
       AND so.canonical_strap_recipe_id<>m.canonical_recipe_id
  ) OR EXISTS (
    SELECT 1
      FROM public.legacy_artisanal_recipe_map m
      JOIN public.service_orders so ON so.artisanal_recipe_id=m.legacy_recipe_id
      JOIN public.service_order_items i ON i.service_order_id=so.id
     WHERE m.status='resolved'
       AND i.strap_recipe_id IS NOT NULL
       AND i.strap_recipe_id<>m.canonical_recipe_id
  ) THEN
    RAISE EXCEPTION 'Diagnostico Req128: mapa de receita ja diverge de OS/linha historica';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.apply_resolved_legacy_strap_product_mapping_incremental(uuid,uuid,text,text,text,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'RPC incremental de migracao nao foi concedida ao authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.resolve_artisanal_strap_migration_review_item(uuid,jsonb,text)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'RPC concreta de review de piso nao foi concedida ao authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.run_artisanal_strap_catalog_migration_dry_run(text)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC protegida de dry-run nao foi concedida ao authenticated';
  END IF;

  -- Repros estruturais dos quatro cenarios adversariais fechados nesta camada.
  -- Nao cria fatos descartaveis: trava a propria implementacao que deve recusar
  -- OC congelada em split, OS terminal, race de lock e inferencia de fonte.
  v_blocker_definition:=pg_get_functiondef(
    'public.legacy_strap_product_mapping_blockers(uuid)'::regprocedure);
  v_product_resolver_definition:=pg_get_functiondef(
    'public.resolve_legacy_strap_product_migration(uuid,jsonb,text,text,uuid)'::regprocedure);
  v_helper_definition:=pg_get_functiondef(
    'public.apply_resolved_legacy_strap_product_mapping(uuid,uuid,text,uuid)'::regprocedure);
  v_global_definition:=pg_get_functiondef(
    'public.apply_artisanal_strap_migration(uuid,text,text,uuid)'::regprocedure);
  v_incremental_definition:=pg_get_functiondef(
    'public.apply_resolved_legacy_strap_product_mapping_incremental(uuid,uuid,text,text,text,uuid)'::regprocedure);
  v_rollback_definition:=pg_get_functiondef(
    'public.rollback_artisanal_strap_migration(uuid,text,text,uuid)'::regprocedure);
  v_rollback_preview_definition:=pg_get_functiondef(
    'public.preview_artisanal_strap_migration_rollback(uuid)'::regprocedure);
  v_review_resolver_definition:=pg_get_functiondef(
    'public.resolve_artisanal_strap_migration_review_item(uuid,jsonb,text)'::regprocedure);
  v_technical_definition:=pg_get_functiondef(
    'public.resolve_technical_strap_line_migration(uuid,uuid,text)'::regprocedure);
  v_recipe_definition:=pg_get_functiondef(
    'public.resolve_legacy_artisanal_recipe_migration(uuid,uuid,text)'::regprocedure);
  v_sale_review_definition:=pg_get_functiondef(
    'public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid)'::regprocedure);
  v_review_guard_definition:=pg_get_functiondef(
    'public.tg_guard_active_strap_migration_review_provenance()'::regprocedure);
  v_dry_run_guard_definition:=pg_get_functiondef(
    'public.tg_block_strap_migration_dry_run_during_cutover()'::regprocedure);
  v_dry_run_definition:=pg_get_functiondef(
    'public.run_artisanal_strap_catalog_migration_dry_run(text)'::regprocedure);
  v_po_classification_definition:=pg_get_functiondef(
    'public.is_legacy_strap_migration_controlled_product(uuid)'::regprocedure);
  v_product_guard_definition:=pg_get_functiondef(
    'public.tg_guard_legacy_artisanal_product_writer()'::regprocedure);
  v_adjust_stock_definition:=pg_get_functiondef(
    'public.adjust_stock_batch(jsonb,boolean)'::regprocedure);
  v_po_guard_definition:=pg_get_functiondef(
    'public.tg_guard_strap_purchase_order_item()'::regprocedure);
  v_po_validator_definition:=pg_get_functiondef(
    'public.tg_validate_purchase_order_item()'::regprocedure);
  SELECT pg_get_triggerdef(t.oid) INTO v_po_origin_trigger
    FROM pg_trigger t
   WHERE t.tgrelid='public.purchase_order_items'::regclass
     AND t.tgname='trg_assert_strap_purchase_order_item_origin'
     AND NOT t.tgisinternal;

  IF strpos(v_blocker_definition,'frozen_purchase_item_receipt_pending')=0
     OR strpos(v_blocker_definition,
       'bool_and(a.target_product_id=v_map.legacy_product_id)')=0 THEN
    RAISE EXCEPTION 'Repro OC congelada: split sem bridge deixou de ser bloqueado';
  END IF;
  IF strpos(v_blocker_definition,
       'is_open_legacy_strap_service_status(so.status)')=0
     OR strpos(v_helper_definition,'v_service_order.status')=0 THEN
    RAISE EXCEPTION 'Repro OS terminal: cabecalho deixou de proteger linha historica';
  END IF;
  IF strpos(v_helper_definition,'FROM public.purchase_order_items i')=0
     OR strpos(v_helper_definition,'FROM public.purchase_orders po')=0
     OR strpos(v_helper_definition,'FROM public.products p')=0
     OR strpos(v_helper_definition,'FROM public.purchase_order_items i')
          > strpos(v_helper_definition,'FROM public.products p')
     OR strpos(v_helper_definition,
       'v_processed_count IS DISTINCT FROM v_expected_count')=0 THEN
    RAISE EXCEPTION 'Repro race: ordem item->OC->produto/recontagem estrita ausente';
  END IF;
  -- Repro de deadlock: o reconciliador canonico segura strap-variant antes de
  -- qualquer produto. Resolver, helper, apply global/incremental e rollback
  -- devem reservar TODOS os UUIDs do proprio escopo na mesma ordem primeiro.
  IF strpos(v_product_resolver_definition,
       '''strap-variant:''||v_variant_lock_id::text')=0
     OR strpos(v_product_resolver_definition,
       'SELECT DISTINCT nullif(e.value->>''strap_variant_id'','''')::uuid AS id')=0
     OR strpos(v_product_resolver_definition,
       '''strap-variant:''||v_variant_lock_id::text')
          > strpos(v_product_resolver_definition,
            'WHERE id=p_legacy_product_id FOR UPDATE')
     OR strpos(v_helper_definition,
       '''strap-variant:''||v_variant_lock_id::text')=0
     OR strpos(v_helper_definition,
       'SELECT DISTINCT a.strap_variant_id AS id')=0
     OR strpos(v_helper_definition,
       '''strap-variant:''||v_variant_lock_id::text')
          > strpos(v_helper_definition,'WHERE id=p_mapping_id FOR UPDATE')
     OR strpos(v_global_definition,
       'SELECT v.id FROM public.artisanal_strap_variants v ORDER BY v.id')=0
     OR strpos(v_global_definition,
       '''strap-variant:''||v_variant_lock_id::text')=0
     OR strpos(v_global_definition,
       '''strap-variant:''||v_variant_lock_id::text')
          > strpos(v_global_definition,'WHERE id=p_run_id FOR UPDATE')
     OR strpos(v_incremental_definition,
       'DISTINCT a.strap_variant_id ORDER BY a.strap_variant_id')=0
     OR strpos(v_incremental_definition,
       'FOREACH v_variant_lock_id IN ARRAY v_variant_ids')=0
     OR strpos(v_incremental_definition,
       '''strap-variant:''||v_variant_lock_id::text')=0
     OR strpos(v_incremental_definition,
       '''strap-variant:''||v_variant_lock_id::text')
          > strpos(v_incremental_definition,
            'WHERE a.mapping_id=p_mapping_id ORDER BY a.id FOR UPDATE')
     OR strpos(v_rollback_definition,
       'FOREACH v_variant_lock_id IN ARRAY v_variant_ids')=0
     OR strpos(v_rollback_definition,
       '''strap-variant:''||v_variant_lock_id::text')=0
     OR strpos(v_rollback_definition,
       '''strap-variant:''||v_variant_lock_id::text')
          > strpos(v_rollback_definition,'ORDER BY j.id FOR UPDATE') THEN
    RAISE EXCEPTION 'Repro deadlock variante->produto: advisory UUID-first ausente/tardio';
  END IF;
  IF strpos(v_incremental_definition,
       'PERFORM 1 FROM public.purchase_order_items i WHERE i.id=ANY(v_purchase_item_ids)')=0
     OR strpos(v_incremental_definition,
       'PERFORM 1 FROM public.purchase_order_items i WHERE i.id=ANY(v_purchase_item_ids)')
          > strpos(v_incremental_definition,
            'PERFORM 1 FROM public.products p WHERE p.id=ANY(v_product_ids)')
     OR strpos(v_incremental_definition,
       'PERFORM 1 FROM public.products p WHERE p.id=ANY(v_product_ids)')
          > strpos(v_incremental_definition,
            'PERFORM 1 FROM public.artisanal_strap_variants v WHERE v.id=ANY(v_variant_ids)')
     OR strpos(v_rollback_definition,
       'PERFORM 1 FROM public.purchase_order_items i')
          > strpos(v_rollback_definition,
            'PERFORM 1 FROM public.products p')
     OR strpos(v_rollback_definition,
       'PERFORM 1 FROM public.products p')
          > strpos(v_rollback_definition,
            'PERFORM 1 FROM public.artisanal_strap_variants v') THEN
    RAISE EXCEPTION 'Ordem interna item->cabecalho->reserva->produto->variante regrediu';
  END IF;
  IF strpos(v_helper_definition,
       'resolve_artisanal_strap_source_availability')=0
     OR strpos(v_helper_definition,
       'legacy_replenishment_source_unavailable')=0
     OR strpos(v_global_definition,
       'review_reason=''Produto acabado legado exige alocacao/split explicito''')>0
     OR strpos(v_incremental_definition,
       'PERFORM public.validate_artisanal_strap_variant(v_variant.id)')>0 THEN
    RAISE EXCEPTION 'Repro Req25: status administrativo voltou a depender da fonte';
  END IF;
  IF strpos(v_rollback_definition,
       'LOCK TABLE public.purchase_receipts IN SHARE ROW EXCLUSIVE MODE')=0
     OR strpos(v_rollback_definition,
       'v_preview:=public.preview_artisanal_strap_migration_rollback')=0
     OR strpos(v_rollback_definition,
       'LOCK TABLE public.purchase_receipts IN SHARE ROW EXCLUSIVE MODE')
        > strpos(v_rollback_definition,
          'v_preview:=public.preview_artisanal_strap_migration_rollback')
     OR strpos(v_rollback_definition,
       'Checksum mudou enquanto rollback aguardava locks')=0
     OR strpos(v_rollback_preview_definition,'poi.product_id IN')=0
     OR strpos(v_rollback_preview_definition,
       'current_artisanal_strap_migration_snapshot')=0 THEN
    RAISE EXCEPTION 'Repro rollback concorrente: lock/preflight decisivo ausente';
  END IF;
  IF strpos(v_review_resolver_definition,
       'legacy_replenishment_source_unavailable')=0
     OR strpos(v_review_resolver_definition,
       'resolve_artisanal_strap_source_availability')=0
     OR strpos(v_review_resolver_definition,
       'Use resolve_technical_strap_line_migration')=0
     OR strpos(v_review_resolver_definition,
       'Use resolve_legacy_artisanal_recipe_migration')=0 THEN
    RAISE EXCEPTION 'Resolver generico voltou a fechar review sem operacao real';
  END IF;
  IF strpos(v_technical_definition,'technical_line_content_mismatch')=0
     OR strpos(v_technical_definition,
       'vinculacao nao aplicada')=0
     OR strpos(v_technical_definition,
       'Reverta/conclua o cutover ativo e execute novo dry-run')=0 THEN
    RAISE EXCEPTION 'Drift de linha tecnica voltou a aparentar sucesso';
  END IF;
  IF strpos(v_recipe_definition,'open_service_order_legacy_recipe')=0
     OR strpos(v_recipe_definition,
       'Receita legada requer resolucao')=0
     OR strpos(v_recipe_definition,
       'v_order_snapshot_before')=0
     OR strpos(v_recipe_definition,'THEN ''resume''')=0 THEN
    RAISE EXCEPTION 'Resolucao de receita nao reata a suspensao tecnica exata da OS';
  END IF;
  IF strpos(v_recipe_definition,'legacy_recipe_mapping_immutable')=0
     OR strpos(v_recipe_definition,'''replayed'',true')=0
     OR strpos(v_recipe_definition,'legacy_recipe_fact_conflict')=0
     OR strpos(v_recipe_definition,'strap_production_receipts')=0
     OR strpos(v_recipe_definition,'artisanal_strap_operational_audit_log')=0
     OR strpos(v_recipe_definition,
       'public.is_open_legacy_strap_service_status(so.status)')=0
     OR strpos(v_recipe_definition,
       'strap_recipe_id=CASE WHEN strap_recipe_id IS NULL')=0
     OR strpos(v_recipe_definition,
       'strap_recipe_id IS NULL OR strap_recipe_id=p_canonical_recipe_id')=0
     OR strpos(v_recipe_definition,'historical_document_preserved')=0
     OR strpos(v_recipe_definition,
       'ON CONFLICT (legacy_recipe_id) DO UPDATE')>0 THEN
    RAISE EXCEPTION 'Repro Req128: receita legada voltou a reescrever mapa/fato historico';
  END IF;
  IF strpos(v_sale_review_definition,
       'preview_sale_order_strap_demand')=0
     OR strpos(v_sale_review_definition,
       'sale_order_strap_demand')=0
     OR strpos(v_sale_review_definition,
       'Linha tecnica do PV requer escolha explicita apos migracao')=0
     OR strpos(v_sale_review_definition,
       'strap_migration_status=''migrated''')=0 THEN
    RAISE EXCEPTION 'Review ambigua de PV pode fechar sem demanda reconciliada';
  END IF;
  IF strpos(v_review_guard_definition,'Dry-run bloqueado')=0
     OR strpos(v_review_guard_definition,
       'c.status IN (''applying'',''applied'',''applied_with_review'')')=0 THEN
    RAISE EXCEPTION 'Novo dry-run pode reparentear review do cutover ativo';
  END IF;
  IF strpos(v_dry_run_guard_definition,
       'Novo dry-run bloqueado enquanto existe cutover ativo')=0
     OR strpos(v_dry_run_guard_definition,
       'c.status IN (''applying'',''applied'',''applied_with_review'')')=0 THEN
    RAISE EXCEPTION 'RPC de dry-run pode nascer durante cutover ativo';
  END IF;
  IF strpos(v_dry_run_definition,
       'run_artisanal_strap_catalog_migration_dry_run_unfenced_202701')=0
     OR strpos(v_dry_run_definition,
       'artisanal-strap-legacy-cutover')=0
     OR strpos(v_dry_run_definition,
       'Novo dry-run bloqueado enquanto existe cutover ativo')=0 THEN
    RAISE EXCEPTION 'Wrapper final da RPC de dry-run nao serializa o cutover';
  END IF;
  IF strpos(v_po_classification_definition,'strap_migration_status')=0
     OR strpos(v_po_classification_definition,
       'artisanal_strap_migration_product_provenance')=0
     OR strpos(v_po_classification_definition,
       'legacy_strap_product_migration_maps')=0
     OR strpos(v_po_classification_definition,
       'legacy_strap_product_migration_allocations')=0
     OR strpos(v_po_guard_definition,
       'is_legacy_strap_migration_controlled_product')=0
     OR strpos(v_po_guard_definition,'p.is_artisanal')=0
     OR strpos(v_po_guard_definition,'pg.is_artisanal_strap')=0
     OR strpos(v_po_guard_definition,'artisanal_strap_variants')=0
     OR strpos(v_po_guard_definition,'v.finished_product_id=p.id')=0
     OR v_po_guard_definition
          ~ 'op[.]official_product_id[[:space:]]*=[[:space:]]*p[.]id'
     OR strpos(v_po_validator_definition,
       'is_legacy_strap_migration_controlled_product')=0
     OR v_po_origin_trigger IS NULL
     OR v_po_origin_trigger NOT ILIKE '%DEFERRABLE INITIALLY DEFERRED%' THEN
    RAISE EXCEPTION 'Inbound generico de produto legado de tira deixou de ser bloqueado';
  END IF;
  IF strpos(v_po_classification_definition,
       'base_material_color_official_products')>0
     OR strpos(v_po_classification_definition,'p.is_artisanal')>0
     OR strpos(v_po_classification_definition,'is_artisanal_strap')>0
     OR strpos(v_product_guard_definition,
       'is_legacy_strap_migration_controlled_product')=0
     OR strpos(v_product_guard_definition,'OLD.is_artisanal')=0
     OR strpos(v_product_guard_definition,'NEW.is_artisanal')=0
     OR strpos(v_product_guard_definition,'pg.id=OLD.group_id')=0
     OR strpos(v_product_guard_definition,'pg.id=NEW.group_id')=0
     OR strpos(v_product_guard_definition,'pg.is_artisanal_strap')=0
     OR strpos(v_product_guard_definition,
       'base_material_color_official_products')>0
     OR strpos(v_adjust_stock_definition,
       'is_legacy_strap_migration_controlled_product')=0
     OR strpos(v_adjust_stock_definition,'p.is_artisanal')=0
     OR strpos(v_adjust_stock_definition,'pg.is_artisanal_strap')=0
     OR strpos(v_adjust_stock_definition,
       'base_material_color_official_products')>0 THEN
    RAISE EXCEPTION 'Repro INSERT/transicao/ajuste/NAPA-base: classificacao estrutural regrediu';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.resolve_legacy_strap_product_migration(uuid,jsonb,text,text,uuid) IS
  'Resolve produto legado por alocacoes explicitas; exige conservacao exata de quantity/current_stock/reserved_stock e IDs de documentos abertos.';
COMMENT ON FUNCTION public.resolve_legacy_artisanal_recipe_migration(uuid,uuid,text) IS
  'Congela uma unica ponte legado->canonica; replay identico e idempotente, troca de destino/fato conflitante falha e documentos terminais nunca sao reescritos.';
COMMENT ON FUNCTION public.apply_artisanal_strap_migration(uuid,text,text,uuid) IS
  'Aplica o dry-run fresco numa transacao, migra somente identidades inequivocas/resolvidas e salva manifesto/snapshots de rollback.';
COMMENT ON FUNCTION public.apply_resolved_legacy_strap_product_mapping_incremental(uuid,uuid,text,text,text,uuid) IS
  'Aplica apos o cutover somente um mapa resolved/unapplied com checksum escopado, UUIDs explicitos, conservacao por target e replay idempotente.';
COMMENT ON FUNCTION public.preview_artisanal_strap_migration_rollback(uuid) IS
  'Preflight read-only: rollback so e permitido sem checksum/snapshot divergente ou fato operacional posterior.';
COMMENT ON FUNCTION public.rollback_artisanal_strap_migration(uuid,text,text,uuid) IS
  'Restaura snapshots e compensa transferencias sem apagar movimentos historicos.';
COMMENT ON FUNCTION public.resolve_artisanal_strap_migration_review_item(uuid,jsonb,text) IS
  'Executa apenas a escolha real do piso de reposicao; demais reviews exigem sua RPC/documento concreto e nunca sao fechadas por texto.';
COMMENT ON FUNCTION public.try_resolve_open_sale_order_item_strap_migration(uuid,uuid) IS
  'Helper interno: fecha review de PV apenas apos linhas, sourcing e demandas correntes coincidirem estruturalmente.';
COMMENT ON FUNCTION public.is_legacy_strap_migration_controlled_product(uuid) IS
  'Classifica somente produto acabado de tira ou legado nominal por proveniencia/mapa/status; NAPA-base oficial isolada permanece material comum.';
COMMENT ON FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(text) IS
  'Executa o inventario sem mutar negocio, mas bloqueia e serializa enquanto existir cutover legado ativo.';
