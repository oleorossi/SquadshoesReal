-- Fundação incremental do command boundary de Pedido de Venda.
--
-- Esta migration não promove, cancela, ressincroniza nem repara nenhum PV
-- existente. Ela cria versionamento otimista, receipts, revisões imutáveis do
-- plano material, configuração reversível e o preflight server-side.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Versão otimista do agregado PV
-- ---------------------------------------------------------------------------

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS order_version bigint NOT NULL DEFAULT 1;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.sale_orders'::regclass
       AND conname = 'sale_orders_order_version_positive'
  ) THEN
    ALTER TABLE public.sale_orders
      ADD CONSTRAINT sale_orders_order_version_positive
      CHECK (order_version >= 1);
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.tg_bump_sale_order_order_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- O cliente nunca escolhe a versão. Toda escrita concorrente observável no
  -- cabeçalho avança monotonicamente o agregado.
  NEW.order_version := OLD.order_version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_sale_order_order_version
  ON public.sale_orders;
CREATE TRIGGER trg_bump_sale_order_order_version
BEFORE UPDATE ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_bump_sale_order_order_version();

CREATE OR REPLACE FUNCTION public.tg_touch_sale_order_version_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_order_id uuid := COALESCE(NEW.sale_order_id, OLD.sale_order_id);
  v_previous text;
BEGIN
  IF v_sale_order_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- O touch de versão não é um comando comercial autônomo. O marcador evita
  -- que o trigger passivo de receipts gere uma linha por item do writer.
  v_previous := current_setting('app.sale_order_version_touch', true);
  PERFORM set_config('app.sale_order_version_touch', '1', true);
  UPDATE public.sale_orders
     SET updated_at = GREATEST(updated_at, now())
   WHERE id = v_sale_order_id;
  PERFORM set_config(
    'app.sale_order_version_touch',
    COALESCE(v_previous, ''),
    true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_sale_order_version_from_item
  ON public.sale_order_items;
CREATE TRIGGER trg_touch_sale_order_version_from_item
AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
FOR EACH ROW
EXECUTE FUNCTION public.tg_touch_sale_order_version_from_item();

-- ---------------------------------------------------------------------------
-- 2. Configuração reversível das decisões ainda abertas
-- ---------------------------------------------------------------------------

CREATE TABLE public.sale_order_command_config (
  config_key text PRIMARY KEY DEFAULT 'default'
    CHECK (config_key = 'default'),
  promotion_atomicity_mode text NOT NULL DEFAULT 'all_or_nothing'
    CHECK (promotion_atomicity_mode IN ('all_or_nothing', 'partial')),
  partial_promotion_enabled boolean NOT NULL DEFAULT false,
  material_plan_commit_milestone text NOT NULL DEFAULT 'debit'
    CHECK (material_plan_commit_milestone IN ('picking', 'debit', 'op_start')),
  -- Canary desligado: falha ao capturar uma revisão jamais bloqueia um fato
  -- físico no rollout. O diagnóstico/outbox tornam a falha observável.
  material_fact_commit_strict boolean NOT NULL DEFAULT false,
  readiness_gate_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT sale_order_command_partial_requires_enable
    CHECK (promotion_atomicity_mode <> 'partial' OR partial_promotion_enabled)
);

INSERT INTO public.sale_order_command_config(config_key)
VALUES ('default')
ON CONFLICT (config_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Plano material versionado, override permanente e command receipts
-- ---------------------------------------------------------------------------

CREATE TABLE public.sale_order_material_plan_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  revision_no bigint NOT NULL CHECK (revision_no >= 1),
  order_version bigint NOT NULL CHECK (order_version >= 1),
  source_hash text NOT NULL CHECK (length(source_hash) = 32),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'committed', 'superseded')),
  revision_milestone text NOT NULL
    CHECK (revision_milestone IN (
      'confirmation', 'promotion', 'picking', 'debit', 'op_start'
    )),
  plan_json jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(plan_json) = 'array'),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(blockers) = 'array'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(warnings) = 'array'),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  committed_at timestamptz,
  UNIQUE (sale_order_id, revision_no),
  CONSTRAINT sale_order_material_plan_commit_state
    CHECK (
      (status = 'committed' AND committed_at IS NOT NULL)
      OR (status <> 'committed' AND committed_at IS NULL)
    )
);

CREATE UNIQUE INDEX sale_order_material_plan_one_current_uq
  ON public.sale_order_material_plan_revisions(sale_order_id)
  WHERE is_current;

CREATE INDEX sale_order_material_plan_order_created_idx
  ON public.sale_order_material_plan_revisions(sale_order_id, created_at DESC);

CREATE TABLE public.sale_order_readiness_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid NOT NULL
    REFERENCES public.sale_orders(id) ON DELETE RESTRICT,
  command_name text NOT NULL
    CHECK (command_name IN ('confirm', 'promote')),
  order_version bigint NOT NULL CHECK (order_version >= 1),
  justification text NOT NULL CHECK (length(btrim(justification)) >= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  CONSTRAINT sale_order_readiness_override_revoke_reason
    CHECK (revoked_at IS NULL OR length(btrim(COALESCE(revoke_reason, ''))) >= 10)
);

-- Não existe expires_at por decisão de produto. A alteração do próprio PV
-- invalida o override porque ele é ligado à order_version que foi justificada.
CREATE UNIQUE INDEX sale_order_readiness_override_active_uq
  ON public.sale_order_readiness_overrides(
    sale_order_id,
    command_name,
    order_version
  )
  WHERE revoked_at IS NULL;

CREATE TABLE public.sale_order_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid
    REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  client_request_id uuid,
  aggregate_key text NOT NULL CHECK (length(btrim(aggregate_key)) > 0),
  command_name text NOT NULL
    CHECK (command_name IN (
      'create', 'update', 'confirm', 'promote', 'resync', 'cancel', 'transition',
      'billing', 'factoring'
    )),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  expected_order_version bigint,
  order_version_before bigint,
  order_version_after bigint,
  material_plan_revision_id uuid
    REFERENCES public.sale_order_material_plan_revisions(id),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  response jsonb,
  error_code text,
  error_message text,
  actor_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (command_name, aggregate_key, idempotency_key),
  CONSTRAINT sale_order_command_receipt_completion
    CHECK (
      (status = 'in_progress' AND completed_at IS NULL)
      OR (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
    )
);

CREATE TABLE public.sale_order_command_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid
    REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  client_request_id uuid,
  aggregate_key text NOT NULL CHECK (length(btrim(aggregate_key)) > 0),
  command_receipt_id uuid
    REFERENCES public.sale_order_command_receipts(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type, aggregate_key, idempotency_key)
);

CREATE INDEX sale_order_command_outbox_pending_idx
  ON public.sale_order_command_outbox(available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX sale_order_command_receipts_order_started_idx
  ON public.sale_order_command_receipts(sale_order_id, started_at DESC);
CREATE INDEX sale_order_command_receipts_stale_idx
  ON public.sale_order_command_receipts(started_at)
  WHERE status = 'in_progress';
-- client_request_id/aggregate_key identifica a intenção de create; variar a
-- idempotency_key não pode publicar um segundo sale_order.created.
CREATE UNIQUE INDEX sale_order_command_receipts_create_intent_uq
  ON public.sale_order_command_receipts(command_name, aggregate_key)
  WHERE command_name = 'create';

-- Objetos em schema exposto ficam fechados por padrão. A API usa apenas RPCs.
ALTER TABLE public.sale_order_command_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_material_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_readiness_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_order_command_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sale_order_command_config
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_material_plan_revisions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_readiness_overrides
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_command_receipts
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sale_order_command_outbox
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.sale_order_command_config TO service_role;
GRANT ALL ON TABLE public.sale_order_material_plan_revisions TO service_role;
GRANT ALL ON TABLE public.sale_order_readiness_overrides TO service_role;
GRANT ALL ON TABLE public.sale_order_command_receipts TO service_role;
GRANT ALL ON TABLE public.sale_order_command_outbox TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Registro passivo incremental de create/update/cancel legados
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_record_passive_sale_order_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text;
  v_key text;
  v_hash text;
  v_receipt_id uuid;
BEGIN
  IF current_setting('app.sale_order_command_internal', true) = '1'
     OR current_setting('app.sale_order_version_touch', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_command := 'create';
  ELSIF NEW.status IN ('Cancelado', 'Cancelada', 'cancelado')
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_command := 'cancel';
  ELSIF NEW.status = 'Aprovado'
        AND OLD.status IN ('Rascunho', 'Pendente') THEN
    v_command := 'confirm';
  ELSIF NEW.status = 'Em Produção'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_command := 'promote';
  ELSE
    v_command := 'update';
  END IF;

  v_key := concat(
    'trigger:', txid_current()::text, ':', NEW.id::text, ':',
    NEW.order_version::text, ':', v_command
  );
  v_hash := md5((to_jsonb(NEW) - ARRAY['updated_at', 'search_norm'])::text);

  INSERT INTO public.sale_order_command_receipts(
    sale_order_id,
    aggregate_key,
    command_name,
    idempotency_key,
    request_hash,
    order_version_before,
    order_version_after,
    status,
    response,
    actor_id,
    completed_at
  ) VALUES (
    NEW.id,
    NEW.id::text,
    v_command,
    v_key,
    v_hash,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.order_version ELSE NULL END,
    NEW.order_version,
    'succeeded',
    jsonb_build_object(
      'passive', true,
      'operation', TG_OP,
      'status_before', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      'status_after', NEW.status
    ),
    auth.uid(),
    now()
  )
  ON CONFLICT (command_name, aggregate_key, idempotency_key) DO NOTHING;

  SELECT id
    INTO v_receipt_id
    FROM public.sale_order_command_receipts
   WHERE sale_order_id = NEW.id
     AND command_name = v_command
     AND aggregate_key = NEW.id::text
     AND idempotency_key = v_key;

  INSERT INTO public.sale_order_command_outbox(
    sale_order_id,
    aggregate_key,
    command_receipt_id,
    event_type,
    aggregate_version,
    idempotency_key,
    payload
  ) VALUES (
    NEW.id,
    NEW.id::text,
    v_receipt_id,
    'sale_order.' || CASE v_command
      WHEN 'create' THEN 'created'
      WHEN 'cancel' THEN 'cancelled'
      WHEN 'confirm' THEN 'confirmed'
      WHEN 'promote' THEN 'promoted'
      ELSE 'updated'
    END,
    NEW.order_version,
    v_key,
    jsonb_build_object(
      'sale_order_id', NEW.id,
      'command', v_command,
      'order_version', NEW.order_version,
      'status', NEW.status,
      'passive', true
    )
  )
  ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_passive_sale_order_command
  ON public.sale_orders;
CREATE TRIGGER trg_record_passive_sale_order_command
AFTER INSERT OR UPDATE ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_record_passive_sale_order_command();

-- ---------------------------------------------------------------------------
-- 5. Builder canônico do plano material atual
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_sale_order_material_plan(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_item record;
  v_sheet record;
  v_variant record;
  v_lines jsonb;
  v_effective_grade jsonb;
  v_items jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_audit jsonb;
  v_flag text;
  v_source_hash text;
  v_fichas integer;
  v_line jsonb;
  v_item_count integer := 0;
  v_sheet_version integer;
  v_hash_items jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT *
    INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id
     AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  FOR v_item IN
    SELECT soi.*
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
     ORDER BY soi.id
  LOOP
    v_item_count := v_item_count + 1;
    v_lines := '[]'::jsonb;
    v_effective_grade := NULL;
    v_audit := NULL;
    v_sheet_version := NULL;

    IF v_item.reference_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'item_without_reference',
        'scope', 'item',
        'message', 'Item sem referência técnica.',
        'item_id', v_item.id,
        'overridable', false
      ));
    END IF;

    IF COALESCE(v_item.quantity, 0) <= 0 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'item_quantity_invalid',
        'scope', 'item',
        'message', 'Quantidade do item deve ser positiva.',
        'item_id', v_item.id,
        'reference_id', v_item.reference_id,
        'overridable', false
      ));
    END IF;

    IF v_item.reference_id IS NOT NULL THEN
      SELECT ts.id, ts.name, ts.code, ts.version, ts.status_ficha
        INTO v_sheet
        FROM public.technical_sheets ts
       WHERE ts.id = v_item.reference_id;

      IF NOT FOUND THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'technical_sheet_missing',
          'scope', 'technical_sheet',
          'message', 'Ficha técnica não encontrada.',
          'item_id', v_item.id,
          'reference_id', v_item.reference_id,
          'overridable', false
        ));
      ELSE
        v_sheet_version := v_sheet.version;
        IF v_sheet.status_ficha IS DISTINCT FROM 'publicada' THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'technical_sheet_not_released',
            'scope', 'technical_sheet',
            'message', 'Ficha técnica precisa estar publicada.',
            'item_id', v_item.id,
            'reference_id', v_item.reference_id,
            'details', jsonb_build_object('status_ficha', v_sheet.status_ficha),
            'overridable', true
          ));
        END IF;

        SELECT to_jsonb(a)
          INTO v_audit
          FROM public.v_technical_sheets_audit a
         WHERE a.id = v_item.reference_id;

        IF v_audit IS NULL THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'technical_sheet_audit_missing',
            'scope', 'technical_sheet',
            'message', 'Auditoria industrial da ficha não retornou resultado.',
            'item_id', v_item.id,
            'reference_id', v_item.reference_id,
            'overridable', false
          ));
        ELSE
          FOREACH v_flag IN ARRAY ARRAY[
            'missing_upper_material',
            'missing_upper_consumption',
            'missing_lining_material',
            'missing_lining_consumption',
            'missing_insole_material',
            'missing_insole_consumption',
            'missing_sole_material',
            'missing_sole_consumption',
            'missing_sole_color_mapping',
            'sole_fachetado_sem_fachete',
            'sole_driven_but_specs_missing',
            'straps_without_colors',
            'straps_without_group',
            'upper_per_size_partial_no_fallback',
            'missing_production_sectors',
            'missing_primary_sole_id',
            'invalid_published_ncm',
            'unit_configuration_issue',
            'area_material_width_missing'
          ]
          LOOP
            IF COALESCE((v_audit ->> v_flag)::boolean, false) THEN
              v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
                'code', 'technical_sheet_' || v_flag,
                'scope', 'technical_sheet',
                'message', 'Ficha técnica reprovada na auditoria industrial: ' || v_flag,
                'item_id', v_item.id,
                'reference_id', v_item.reference_id,
                'overridable', true
              ));
            END IF;
          END LOOP;
        END IF;

        IF v_item.material_variant_id IS NULL THEN
          IF EXISTS (
               SELECT 1
                 FROM public.reference_material_variants rmv
                WHERE rmv.reference_id = v_item.reference_id
                  AND rmv.active
             )
             AND NOT public.sheet_material_is_selectable(v_item.reference_id) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_variant_required',
              'scope', 'item',
              'message', 'Selecione uma variante comercial ativa para o item.',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'overridable', true
            ));
          END IF;
        ELSE
          SELECT rmv.id, rmv.reference_id, rmv.active, rmv.sku
            INTO v_variant
            FROM public.reference_material_variants rmv
           WHERE rmv.id = v_item.material_variant_id;

          IF NOT FOUND
             OR v_variant.reference_id IS DISTINCT FROM v_item.reference_id
             OR NOT COALESCE(v_variant.active, false)
             OR NULLIF(btrim(COALESCE(v_variant.sku, '')), '') IS NULL THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_variant_invalid',
              'scope', 'item',
              'message', 'Variante comercial inexistente, inativa, sem SKU ou de outra referência.',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'details', jsonb_build_object('material_variant_id', v_item.material_variant_id),
              'overridable', true
            ));
          END IF;
        END IF;

        IF COALESCE(v_item.quantity, 0) > 0 THEN
          BEGIN
            v_fichas := GREATEST(COALESCE(v_item.fichas, 1), 1);
            SELECT COALESCE(
                     jsonb_object_agg(
                       g.key,
                       (COALESCE(NULLIF(g.value, '')::numeric, 0) * v_fichas)::int
                     ),
                     '{}'::jsonb
                   )
              INTO v_effective_grade
              FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
             WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) * v_fichas > 0;

            v_effective_grade := NULLIF(v_effective_grade, '{}'::jsonb);

            IF v_effective_grade IS NOT NULL THEN
              v_lines := public.calculate_order_consumption_by_grade(
                v_item.reference_id,
                v_effective_grade,
                COALESCE(v_item.color, ''),
                v_item.material_variant_id
              );
            ELSE
              v_lines := public.calculate_order_consumption(
                v_item.reference_id,
                COALESCE(v_item.quantity, 0)::numeric,
                COALESCE(v_item.color, ''),
                v_item.item_size,
                v_item.material_variant_id
              );
            END IF;

            v_lines := COALESCE(
              public.filter_caixa_by_packaging_mode(v_lines, v_so.packaging_mode),
              '[]'::jsonb
            );
          EXCEPTION WHEN OTHERS THEN
            v_lines := '[]'::jsonb;
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_plan_calculation_failed',
              'scope', 'material_plan',
              'message', SQLERRM,
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'sqlstate', SQLSTATE,
              'overridable', false
            ));
          END;
        END IF;

        IF jsonb_array_length(COALESCE(v_lines, '[]'::jsonb)) = 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'material_plan_empty',
            'scope', 'material_plan',
            'message', 'O motor de consumo não produziu linhas para o item.',
            'item_id', v_item.id,
            'reference_id', v_item.reference_id,
            'overridable', true
          ));
        END IF;

        FOR v_line IN
          SELECT value
            FROM jsonb_array_elements(COALESCE(v_lines, '[]'::jsonb)) t(value)
        LOOP
          IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_color_not_registered',
              'scope', 'material_plan',
              'message', 'Cor do componente não está cadastrada no grupo.',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'details', v_line,
              'overridable', true
            ));
          END IF;
          IF NULLIF(v_line ->> 'conversion_warning', '') IS NOT NULL THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_conversion_missing',
              'scope', 'material_plan',
              'message', v_line ->> 'conversion_warning',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'details', v_line,
              'overridable', true
            ));
          END IF;
          IF NULLIF(v_line ->> 'product_id', '') IS NULL THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'material_product_unresolved',
              'scope', 'material_plan',
              'message', 'Linha de consumo sem produto resolvido.',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'details', v_line,
              'overridable', true
            ));
          END IF;
          IF NULLIF(v_line ->> 'available', '') IS NOT NULL
             AND NULLIF(v_line ->> 'required', '') IS NOT NULL
             AND (v_line ->> 'available')::numeric < (v_line ->> 'required')::numeric THEN
            v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
              'code', 'material_stock_shortage',
              'scope', 'material_plan',
              'message', 'Estoque disponível menor que o consumo esperado; MRP/reconciliação será necessário.',
              'item_id', v_item.id,
              'reference_id', v_item.reference_id,
              'details', v_line
            ));
          END IF;
        END LOOP;
      END IF;
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item_id', v_item.id,
      'reference_id', v_item.reference_id,
      'material_variant_id', v_item.material_variant_id,
      'color', v_item.color,
      'quantity', v_item.quantity,
      'grade', v_effective_grade,
      'sheet_version', v_sheet_version,
      'product_id', v_item.product_id,
      'strap_colors', v_item.strap_colors,
      'strap_sourcing', v_item.strap_sourcing,
      'strap_sourcing_revision', v_item.strap_sourcing_revision,
      'outsourced_sectors', v_item.outsourced_sectors,
      'terceirizacao_quantities', v_item.terceirizacao_quantities,
      'selected_terceirizacao_ids', v_item.selected_terceirizacao_ids,
      'lines', COALESCE(v_lines, '[]'::jsonb)
    ));
  END LOOP;

  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sale_order_without_items',
      'scope', 'sale_order',
      'message', 'Pedido de venda não possui itens.',
      'overridable', false
    ));
  END IF;

  -- O hash identifica somente fontes materiais/técnicas. Saldo disponível,
  -- warnings e order_version são deliberadamente excluídos: uma alteração
  -- financeira/status ou outra OP consumindo estoque não muda o plano deste PV.
  SELECT COALESCE(
           jsonb_agg(
             (i.value - 'lines') || jsonb_build_object(
               'lines', COALESCE((
                 SELECT jsonb_agg(
                          l.value - ARRAY[
                            'available', 'available_qty', 'reserved',
                            'reserved_stock', 'stock_ok', 'shortage'
                          ]
                          ORDER BY
                            l.value ->> 'product_id',
                            l.value ->> 'component',
                            l.value ->> 'source',
                            l.value ->> 'color',
                            l.value ->> 'required'
                        )
                   FROM jsonb_array_elements(
                     COALESCE(i.value -> 'lines', '[]'::jsonb)
                   ) AS l(value)
               ), '[]'::jsonb)
             )
             ORDER BY i.value ->> 'item_id'
           ),
           '[]'::jsonb
         )
    INTO v_hash_items
    FROM jsonb_array_elements(v_items) AS i(value);

  v_source_hash := md5(jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'packaging_mode', v_so.packaging_mode,
    'packaging_product_id', v_so.packaging_product_id,
    'packaging_quantity', v_so.packaging_quantity,
    'box_grouping', v_so.box_grouping,
    'items', v_hash_items
  )::text);

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'order_version', v_so.order_version,
    'source_hash', v_source_hash,
    'ready', jsonb_array_length(v_blockers) = 0,
    'items', v_items,
    'blockers', v_blockers,
    'warnings', v_warnings
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Preflight/readiness e override administrativo sem expiração
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_execute_sale_order_command(
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_has_granular boolean := false;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.user_id = v_user_id
       AND ur.role::text = 'admin'
  ) THEN
    RETURN true;
  END IF;
  IF v_action NOT IN ('create', 'edit') THEN
    RETURN false;
  END IF;

  -- Espelha isActionAllowed: somente grants positivos de visualização ativam
  -- a allow-list. Sem granular, o caller preserva o RBAC legado por papel.
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND (
         -- Grant legado por módulo continua concedendo a ação inteira.
         up.module = 'vendas'
         OR (
           up.module = '/sales'
           AND CASE WHEN v_action = 'create'
             THEN up.can_create
             ELSE up.can_edit
           END
         )
       )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_sale_order_command(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_execute_sale_order_finance_command()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_granular boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF v_user_id IS NULL OR NOT public.is_approved_user() THEN
    RETURN false;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
  ) INTO v_has_granular;
  IF NOT v_has_granular THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.user_permissions up
     WHERE up.user_id = v_user_id
       AND up.can_view
       AND up.can_edit
       AND up.module IN ('financeiro', '/financeiro', '/finance')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_execute_sale_order_finance_command()
  FROM PUBLIC, anon, authenticated, service_role;

-- Resolve exatamente a mesma cadeia de preço automático usada pelos clientes
-- desktop/mobile. A lista já vem resolvida por get_client_commercial_defaults,
-- portanto inclui herança do grupo econômico. Custo nunca é preço de venda.
CREATE OR REPLACE FUNCTION public.resolve_sale_order_item_commercial_price(
  p_reference_id uuid,
  p_color text,
  p_quantity numeric,
  p_material_variant_id uuid,
  p_price_list_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  expected_price numeric,
  price_source text,
  price_rule_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list_effective boolean := false;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 'missing'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_price_list_id IS NOT NULL THEN
    SELECT pl.active
           AND pl.valid_from <= COALESCE(p_as_of, CURRENT_DATE)
           AND (
             pl.valid_to IS NULL
             OR pl.valid_to >= COALESCE(p_as_of, CURRENT_DATE)
           )
      INTO v_list_effective
      FROM public.price_lists pl
     WHERE pl.id = p_price_list_id;
    v_list_effective := COALESCE(v_list_effective, false);
  END IF;

  IF v_list_effective THEN
    RETURN QUERY
    SELECT pli.unit_price,
           CASE
             WHEN NULLIF(btrim(COALESCE(pli.color, '')), '') IS NOT NULL
               THEN 'table_color'
             ELSE 'table_reference'
           END,
           pli.id
      FROM public.price_list_items pli
     WHERE pli.price_list_id = p_price_list_id
       AND pli.reference_id = p_reference_id
       AND (
         NULLIF(btrim(COALESCE(pli.color, '')), '') IS NULL
         OR upper(btrim(pli.color)) = upper(btrim(COALESCE(p_color, '')))
       )
       AND COALESCE(pli.unit_price, 0) > 0
       AND pli.unit_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
     ORDER BY
       -- Regra por cor sempre vence a regra default da referência.
       (NULLIF(btrim(COALESCE(pli.color, '')), '') IS NOT NULL) DESC,
       -- Dentro da cor/ref, maior faixa <= quantidade. Se nenhuma faixa
       -- couber, usa a menor (preço-base), igual ao pickTier do cliente.
       (COALESCE(pli.min_quantity, 0) <= COALESCE(p_quantity, 0)) DESC,
       CASE
         WHEN COALESCE(pli.min_quantity, 0) <= COALESCE(p_quantity, 0)
           THEN COALESCE(pli.min_quantity, 0)
       END DESC NULLS LAST,
       CASE
         WHEN COALESCE(pli.min_quantity, 0) > COALESCE(p_quantity, 0)
           THEN COALESCE(pli.min_quantity, 0)
       END ASC NULLS LAST,
       pli.id
     LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  IF p_material_variant_id IS NOT NULL THEN
    RETURN QUERY
    SELECT rmv.unit_price_override,
           'material_variant'::text,
           rmv.id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND rmv.active
       AND COALESCE(rmv.unit_price_override, 0) > 0
       AND rmv.unit_price_override::text NOT IN ('NaN', 'Infinity', '-Infinity')
     LIMIT 1;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT ts.sale_price,
         'technical_sheet'::text,
         NULL::uuid
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id
     AND COALESCE(ts.sale_price, 0) > 0
     AND ts.sale_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
   LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT 0::numeric, 'missing'::text, NULL::uuid;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_sale_order_item_commercial_price(
  uuid, text, numeric, uuid, uuid, date
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preflight_sale_order_command(
  p_sale_order_id uuid,
  p_command text,
  p_expected_order_version bigint,
  p_override_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_config public.sale_order_command_config%ROWTYPE;
  v_plan jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_override public.sale_order_readiness_overrides%ROWTYPE;
  v_override_valid boolean := false;
  v_ready boolean;
  v_effective_count integer;
  v_client record;
  v_commercial record;
  v_available_credit numeric;
  v_calculated_total numeric := 0;
  v_price_issues jsonb := '[]'::jsonb;
  v_price_warnings jsonb := '[]'::jsonb;
  v_update_billing_patch jsonb := p_payload -> 'billing_patch';
  v_update_factoring_patch jsonb := p_payload -> 'factoring_patch';
  v_update_factoring_config_id uuid;
  v_target_status text := NULLIF(btrim(COALESCE(p_payload ->> 'target_status', '')), '');
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF v_command NOT IN (
    'update', 'confirm', 'promote', 'resync', 'cancel', 'transition',
    'billing', 'factoring'
  ) THEN
    RAISE EXCEPTION 'Comando de PV não suportado no preflight: %', p_command
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       (v_command = 'resync'
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']))
       OR
       (v_command = 'factoring'
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']))
       OR
       (v_command NOT IN ('resync', 'factoring')
        AND NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']))
     ) THEN
    RAISE EXCEPTION 'Papel sem permissão para preflight do comando %', v_command
      USING ERRCODE = '42501';
  END IF;

  IF v_command = 'factoring'
     AND NOT public.can_execute_sale_order_finance_command() THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /financeiro para factoring'
      USING ERRCODE = '42501';
  ELSIF v_command <> 'factoring'
        AND NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para o comando %',
      v_command
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id;
  IF NOT FOUND OR v_so.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  SELECT * INTO v_config
    FROM public.sale_order_command_config
   WHERE config_key = 'default';

  v_plan := public.build_sale_order_material_plan(p_sale_order_id);

  -- Gate comercial server-side. A tela/RouteGuard não é fronteira de
  -- autorização nem de integridade para uma função SECURITY DEFINER.
  IF v_command IN ('confirm', 'promote') THEN
    IF v_so.client_id IS NULL THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'client_required',
        'scope', 'commercial',
        'message', 'Cliente válido é obrigatório para confirmar/promover.',
        'overridable', false
      ));
    ELSE
      SELECT c.id, c.active, c.economic_group_id, c.estado, c.sales_channel
        INTO v_client
        FROM public.clients c
       WHERE c.id = v_so.client_id;

      IF NOT FOUND THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'client_not_found',
          'scope', 'commercial',
          'message', 'Cliente do PV não existe.',
          'details', jsonb_build_object('client_id', v_so.client_id),
          'overridable', false
        ));
      ELSIF NOT COALESCE(v_client.active, false) THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'client_inactive',
          'scope', 'commercial',
          'message', 'Cliente inativo não pode receber novo pedido.',
          'details', jsonb_build_object('client_id', v_so.client_id),
          'overridable', false
        ));
      ELSE
        SELECT * INTO v_commercial
          FROM public.get_client_commercial_defaults(v_so.client_id);

        IF COALESCE(v_commercial.block_new_orders, false) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'commercial_orders_blocked',
            'scope', 'commercial',
            'message', COALESCE(
              NULLIF(btrim(v_commercial.block_reason), ''),
              'Cliente/grupo econômico está bloqueado para novos pedidos.'
            ),
            'details', jsonb_build_object(
              'client_id', v_so.client_id,
              'economic_group_id', v_client.economic_group_id,
              'inherited_from', v_commercial.inherited_from
            ),
            'overridable', true
          ));
        END IF;

        IF NULLIF(btrim(COALESCE(v_so.payment_condition, '')), '') IS NULL THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'payment_condition_required',
            'scope', 'commercial',
            'message', 'Condição de pagamento é obrigatória.',
            'details', jsonb_build_object(
              'default_payment_condition', v_commercial.payment_condition
            ),
            'overridable', true
          ));
        END IF;

        IF v_commercial.price_list_id IS NULL THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'commercial_policy_required',
            'scope', 'commercial',
            'message', 'Cliente/grupo não possui política/lista de preço efetiva.',
            'overridable', true
          ));
        END IF;

        SELECT COALESCE(sum(
                 CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     THEN 0
                   ELSE COALESCE(i.quantity, 0) * COALESCE(i.unit_price, 0)
                 END
               ), 0),
               COALESCE(jsonb_agg(jsonb_build_object(
                 'code', CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     OR COALESCE(i.unit_price, 0) <= 0
                     OR COALESCE(ep.expected_price, 0) <= 0
                   THEN 'item_price_missing'
                   ELSE 'item_price_below_floor'
                 END,
                 'scope', 'commercial',
                 'message', CASE
                   WHEN i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                     OR COALESCE(i.unit_price, 0) <= 0
                     OR COALESCE(ep.expected_price, 0) <= 0
                   THEN 'Item sem preço-base comercial efetivo positivo.'
                   ELSE 'Preço manual ficou abaixo do piso comercial permitido.'
                 END,
                 'item_id', i.id,
                 'reference_id', i.reference_id,
                 'details', jsonb_build_object(
                   'unit_price', i.unit_price,
                   'effective_price', ep.expected_price,
                   'minimum_price', round(
                     ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ),
                     6
                   ),
                   'max_discount_pct', LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ),
                   'price_source', ep.price_source,
                   'price_rule_id', ep.price_rule_id
                 ),
                 'overridable', false
               )) FILTER (WHERE
                 i.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
                 OR COALESCE(i.unit_price, 0) <= 0
                 OR COALESCE(ep.expected_price, 0) <= 0
                 OR i.unit_price < ep.expected_price * (
                   1 - LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ) / 100
                 ) - 0.01
               ), '[]'::jsonb),
               COALESCE(jsonb_agg(jsonb_build_object(
                 'code', 'item_manual_price',
                 'scope', 'commercial',
                 'message', 'Preço manual aceito dentro do piso comercial.',
                 'item_id', i.id,
                 'reference_id', i.reference_id,
                 'details', jsonb_build_object(
                   'unit_price', i.unit_price,
                   'effective_price', ep.expected_price,
                   'minimum_price', round(
                     ep.expected_price * (
                       1 - LEAST(
                         100::numeric,
                         GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                       ) / 100
                     ),
                     6
                   ),
                   'max_discount_pct', LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ),
                   'price_source', ep.price_source,
                   'price_rule_id', ep.price_rule_id
                 ),
                 'overridable', false
               )) FILTER (WHERE
                 i.unit_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
                 AND COALESCE(i.unit_price, 0) > 0
                 AND COALESCE(ep.expected_price, 0) > 0
                 AND i.unit_price >= ep.expected_price * (
                   1 - LEAST(
                     100::numeric,
                     GREATEST(0::numeric, COALESCE(v_commercial.discount_pct, 0))
                   ) / 100
                 ) - 0.01
                 AND abs(i.unit_price - ep.expected_price) > 0.01
               ), '[]'::jsonb)
          INTO v_calculated_total, v_price_issues, v_price_warnings
          FROM public.sale_order_items i
          CROSS JOIN LATERAL public.resolve_sale_order_item_commercial_price(
            i.reference_id,
            i.color,
            i.quantity,
            i.material_variant_id,
            v_commercial.price_list_id,
            CURRENT_DATE
          ) ep
         WHERE i.sale_order_id = p_sale_order_id
           AND i.reference_id IS NOT NULL;
        v_blockers := v_blockers || v_price_issues;
        v_warnings := v_warnings || v_price_warnings;

        IF v_so.total::text IN ('NaN', 'Infinity', '-Infinity')
           OR abs(COALESCE(v_so.total, 0) - v_calculated_total) > 0.01 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'sale_order_total_mismatch',
            'scope', 'commercial',
            'message', 'Total do PV diverge da soma server-side dos itens.',
            'details', jsonb_build_object(
              'stored_total', COALESCE(v_so.total, 0),
              'calculated_total', v_calculated_total
            ),
            'overridable', false
          ));
        END IF;

        IF COALESCE(v_commercial.credit_limit, 0) > 0 THEN
          IF v_client.economic_group_id IS NOT NULL THEN
            SELECT egc.credit_available
              INTO v_available_credit
              FROM public.v_economic_group_credit egc
             WHERE egc.economic_group_id = v_client.economic_group_id;
          ELSE
            SELECT ce.available_credit
              INTO v_available_credit
              FROM public.v_client_credit_exposure ce
             WHERE ce.client_id = v_so.client_id;
          END IF;

          IF v_calculated_total > COALESCE(v_available_credit, 0) THEN
            v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
              'code', 'credit_limit_exceeded',
              'scope', 'commercial',
              'message', 'Valor do PV excede o crédito disponível canônico.',
              'details', jsonb_build_object(
                'sale_order_total', v_calculated_total,
                'available_credit', COALESCE(v_available_credit, 0),
                'economic_group_id', v_client.economic_group_id
              ),
              'overridable', true
            ));
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_expected_order_version IS NOT NULL
     AND p_expected_order_version <> v_so.order_version THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'stale_order_version',
      'scope', 'sale_order',
      'message', format(
        'Versão esperada %s difere da versão atual %s.',
        p_expected_order_version,
        v_so.order_version
      ),
      'details', jsonb_build_object(
        'expected', p_expected_order_version,
        'actual', v_so.order_version
      ),
      'overridable', false
    ));
  END IF;

  IF v_command = 'confirm'
     AND v_so.status NOT IN ('Rascunho', 'Pendente', 'Aprovado') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_status_transition',
      'scope', 'sale_order',
      'message', 'Confirmação aceita somente Rascunho/Pendente ou replay em Aprovado.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'promote'
        AND v_so.status NOT IN ('Rascunho', 'Pendente', 'Aprovado', 'Em Produção') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_status_transition',
      'scope', 'sale_order',
      'message', 'Promoção aceita Rascunho/Pendente/Aprovado ou replay em Em Produção.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'resync' AND NOT EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND lower(COALESCE(o.status, '')) IN ('reservado', 'em produção', 'em producao')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'no_active_order_for_resync',
      'scope', 'sale_order',
      'message', 'PV não possui OP ativa para ressincronizar.',
      'overridable', false
    ));
  ELSIF v_command = 'update'
        AND v_so.status IN (
          'Faturado', 'Expedido', 'Concluído', 'Concluido',
          'Finalizado s/ NF', 'FINALIZADO', 'Finalizado', 'Cancelado'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'terminal_sale_order',
      'scope', 'sale_order',
      'message', 'PV fechado/terminal não aceita edição.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'cancel'
        AND v_so.status NOT IN (
          'Rascunho', 'Pendente', 'Aprovado', 'Em Produção',
          'Faturado', 'Cancelado'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_cancel_transition',
      'scope', 'sale_order',
      'message', 'Status atual não permite transição para Cancelado.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'billing'
        AND v_so.status NOT IN (
          'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
        ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'billing_after_commercial_fact',
      'scope', 'commercial',
      'message', 'Planejamento de faturamento só pode mudar antes do faturamento/fechamento.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'factoring'
        AND v_so.status NOT IN ('Rascunho', 'Pendente') THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'factoring_after_financial_fact',
      'scope', 'financial',
      'message', 'Factoring só pode mudar antes da aprovação e de fatos financeiros.',
      'details', jsonb_build_object('status', v_so.status),
      'overridable', false
    ));
  ELSIF v_command = 'transition' THEN
    IF v_target_status IS NULL
       OR concat(v_so.status, '->', v_target_status) NOT IN (
         'Rascunho->Pendente',
         'Pendente->Rascunho',
         'Cancelado->Rascunho',
         'Aprovado->Rascunho',
         'Em Produção->Faturado',
         'Em Produção->Finalizado s/ NF',
         'Faturado->Expedido',
         'Expedido->Concluído'
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_status_transition',
        'scope', 'sale_order',
        'message', 'Transição de status não permitida pela máquina canônica.',
        'details', jsonb_build_object(
          'status', v_so.status,
          'target_status', v_target_status
        ),
        'overridable', false
      ));
    ELSIF v_so.status = 'Em Produção'
          AND v_target_status = 'Faturado'
          AND NOT COALESCE(v_so.nfe_required, true) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'nfe_policy_transition_mismatch',
        'scope', 'fiscal',
        'message', 'PV sem NF-e obrigatória deve usar Finalizado s/ NF.',
        'overridable', false
      ));
    ELSIF v_so.status = 'Em Produção'
          AND v_target_status = 'Finalizado s/ NF'
          AND COALESCE(v_so.nfe_required, true) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'nfe_policy_transition_mismatch',
        'scope', 'fiscal',
        'message', 'PV com NF-e obrigatória deve seguir para Faturado.',
        'overridable', false
      ));
    ELSIF v_so.status = 'Faturado'
          AND v_target_status = 'Expedido'
          AND NOT EXISTS (
            SELECT 1
              FROM public.nfe_emitidas nfe
             WHERE nfe.sale_order_id = p_sale_order_id
               AND nfe.status = 'autorizada'
          ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'authorized_nfe_required_for_shipping',
        'scope', 'fiscal',
        'message', 'Expedição exige NF-e autorizada.',
        'overridable', false
      ));
    END IF;
  END IF;

  -- Subpatches opcionais pertencem ao mesmo intent/receipt do update, mas
  -- preservam allow-list, estados e fronteiras dos commands estreitos.
  IF v_command = 'update' AND p_payload ? 'billing_patch' THEN
    IF jsonb_typeof(v_update_billing_patch) IS DISTINCT FROM 'object'
       OR v_update_billing_patch = '{}'::jsonb
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(v_update_billing_patch) AS patch_key(key)
          WHERE patch_key.key NOT IN (
            'delivery_month', 'delivery_week', 'billing_week',
            'delivery_deadline', 'manual_billing_override',
            'original_min_billing_date', 'manual_override_reason'
          )
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_billing_patch',
        'scope', 'commercial',
        'message', 'billing_patch vazio, inválido ou com campo não permitido.',
        'overridable', false
      ));
    ELSIF v_so.status NOT IN (
      'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'
    ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'billing_after_commercial_fact',
        'scope', 'commercial',
        'message', 'billing_patch só pode mudar antes do faturamento/fechamento.',
        'details', jsonb_build_object('status', v_so.status),
        'overridable', false
      ));
    ELSIF v_update_billing_patch ? 'manual_billing_override'
          AND jsonb_typeof(
            v_update_billing_patch -> 'manual_billing_override'
          ) IS DISTINCT FROM 'boolean' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_billing_patch',
        'scope', 'commercial',
        'message', 'manual_billing_override deve ser boolean.',
        'overridable', false
      ));
    ELSIF COALESCE(
            (v_update_billing_patch ->> 'manual_billing_override')::boolean,
            false
          )
          AND length(btrim(COALESCE(
            v_update_billing_patch ->> 'manual_override_reason',
            ''
          ))) < 10 THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_billing_patch',
        'scope', 'commercial',
        'message', 'Override manual de faturamento exige motivo (10+ caracteres).',
        'overridable', false
      ));
    END IF;
  END IF;

  IF v_command = 'update' AND p_payload ? 'factoring_patch' THEN
    IF jsonb_typeof(v_update_factoring_patch) IS DISTINCT FROM 'object'
       OR NOT (v_update_factoring_patch ? 'factoring_config_id')
       OR EXISTS (
         SELECT 1
           FROM jsonb_object_keys(v_update_factoring_patch) AS patch_key(key)
          WHERE patch_key.key <> 'factoring_config_id'
       ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_factoring_patch',
        'scope', 'financial',
        'message', 'factoring_patch aceita somente factoring_config_id.',
        'overridable', false
      ));
    ELSIF jsonb_typeof(v_update_factoring_patch -> 'factoring_config_id')
          NOT IN ('string', 'null')
          OR (
            NULLIF(btrim(COALESCE(
              v_update_factoring_patch ->> 'factoring_config_id',
              ''
            )), '') IS NOT NULL
            AND (v_update_factoring_patch ->> 'factoring_config_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_update_factoring_patch',
        'scope', 'financial',
        'message', 'factoring_config_id deve ser UUID ou null.',
        'overridable', false
      ));
    ELSE
      v_update_factoring_config_id := NULLIF(btrim(COALESCE(
        v_update_factoring_patch ->> 'factoring_config_id',
        ''
      )), '')::uuid;

      -- O formulário pode sempre enviar o baseline. ACL financeira, estado e
      -- causalidade só entram quando o target realmente muda.
      IF v_update_factoring_config_id IS DISTINCT FROM v_so.factoring_config_id THEN
        IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
           AND (
             NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
             OR NOT public.can_execute_sale_order_finance_command()
           ) THEN
          RAISE EXCEPTION
            'factoring_patch exige Administração/Gerência e can_edit em /financeiro'
            USING ERRCODE = '42501';
        END IF;
        IF v_so.status NOT IN ('Rascunho', 'Pendente') THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'factoring_after_financial_fact',
            'scope', 'financial',
            'message', 'factoring_patch só pode mudar antes da aprovação.',
            'details', jsonb_build_object('status', v_so.status),
            'overridable', false
          ));
        ELSIF v_update_factoring_config_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                  FROM public.factoring_config fc
                 WHERE fc.id = v_update_factoring_config_id
                   AND fc.active
              ) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'invalid_update_factoring_patch',
            'scope', 'financial',
            'message', 'Configuração de factoring inexistente/inativa.',
            'overridable', false
          ));
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_command IN ('update', 'cancel', 'billing', 'factoring') AND EXISTS (
    SELECT 1
      FROM public.nfe_emitidas nfe
     WHERE nfe.sale_order_id = p_sale_order_id
       AND nfe.status IN ('autorizada', 'processando', 'cancelando')
  ) THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'active_nfe_blocks_cancel',
      'scope', 'fiscal',
      'message', 'PV possui NF-e ativa; cancele a NF-e antes de alterar/cancelar o pedido.',
      'overridable', false
    ));
  END IF;

  IF v_command IN ('confirm', 'promote', 'resync') THEN
    v_blockers := v_blockers || COALESCE(v_plan -> 'blockers', '[]'::jsonb);
  ELSE
    -- Update precisa conseguir corrigir um plano inválido; cancel não depende
    -- da prontidão técnica. Os sinais continuam visíveis como warnings.
    v_warnings := v_warnings || COALESCE(v_plan -> 'blockers', '[]'::jsonb);
  END IF;
  v_warnings := v_warnings || COALESCE(v_plan -> 'warnings', '[]'::jsonb);

  IF p_override_id IS NOT NULL THEN
    SELECT * INTO v_override
      FROM public.sale_order_readiness_overrides ro
     WHERE ro.id = p_override_id;

    v_override_valid := FOUND
      AND v_override.sale_order_id = p_sale_order_id
      AND v_override.command_name = v_command
      AND (
        v_override.order_version = v_so.order_version
        OR (
          COALESCE(
            current_setting('app.sale_order_command_internal', true),
            ''
          ) = '1'
          AND v_override.order_version::text = COALESCE(
            current_setting(
              'app.sale_order_command_override_source_version',
              true
            ),
            ''
          )
        )
      )
      AND v_override.revoked_at IS NULL;

    IF NOT v_override_valid THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_readiness_override',
        'scope', 'sale_order',
        'message', 'Override não pertence ao comando/versão atual ou foi revogado.',
        'details', jsonb_build_object('override_id', p_override_id),
        'overridable', false
      ));
    END IF;
  END IF;

  SELECT count(*)::integer
    INTO v_effective_count
    FROM jsonb_array_elements(v_blockers) issue
   WHERE NOT (
     COALESCE((issue ->> 'overridable')::boolean, false)
     AND (
       v_override_valid
       OR NOT COALESCE(v_config.readiness_gate_enabled, true)
     )
   );

  v_ready := v_effective_count = 0;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'gate_enabled', COALESCE(v_config.readiness_gate_enabled, true),
    'sale_order_id', p_sale_order_id,
    'command', v_command,
    'status', v_so.status,
    'target_status', v_target_status,
    'order_version', v_so.order_version,
    'expected_order_version', p_expected_order_version,
    'effective_blocking_count', v_effective_count,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'override', CASE WHEN v_override_valid THEN jsonb_build_object(
      'id', v_override.id,
      'order_version', v_override.order_version,
      'justification', v_override.justification,
      'created_by', v_override.created_by,
      'created_at', v_override.created_at
    ) ELSE NULL END,
    'material_plan', v_plan,
    'config', jsonb_build_object(
      'promotion_atomicity_mode', v_config.promotion_atomicity_mode,
      'partial_promotion_enabled', v_config.partial_promotion_enabled,
      'material_plan_commit_milestone', v_config.material_plan_commit_milestone,
      'material_fact_commit_strict', v_config.material_fact_commit_strict,
      'readiness_gate_enabled', v_config.readiness_gate_enabled
    )
  );
END;
$$;

-- Compatibilidade dos callers já implantados; transições que precisam do
-- target_status usam explicitamente a assinatura de cinco argumentos.
CREATE OR REPLACE FUNCTION public.preflight_sale_order_command(
  p_sale_order_id uuid,
  p_command text,
  p_expected_order_version bigint DEFAULT NULL,
  p_override_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.preflight_sale_order_command(
    p_sale_order_id,
    p_command,
    p_expected_order_version,
    p_override_id,
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.create_sale_order_readiness_override(
  p_sale_order_id uuid,
  p_command text,
  p_justification text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_command text := lower(btrim(COALESCE(p_command, '')));
  v_version bigint;
  v_id uuid;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Somente administrador pode justificar override de readiness'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_execute_sale_order_command('edit') THEN
    RAISE EXCEPTION
      'Permission denied: usuário sem can_edit em /sales para override'
      USING ERRCODE = '42501';
  END IF;

  IF v_command NOT IN ('confirm', 'promote') THEN
    RAISE EXCEPTION 'Override permitido somente para confirm/promote'
      USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória deve ter ao menos 10 caracteres'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sale-order-command:' || p_sale_order_id::text, 0)
  );
  SELECT order_version
    INTO v_version
    FROM public.sale_orders
   WHERE id = p_sale_order_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  INSERT INTO public.sale_order_readiness_overrides(
    sale_order_id,
    command_name,
    order_version,
    justification,
    created_by
  ) VALUES (
    p_sale_order_id,
    v_command,
    v_version,
    btrim(p_justification),
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  )
  ON CONFLICT (sale_order_id, command_name, order_version)
    WHERE revoked_at IS NULL
  DO UPDATE
     SET justification = EXCLUDED.justification,
         created_by = EXCLUDED.created_by,
         created_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Interna: confirmation/promotion versionam uma proposta. O primeiro fato
-- físico configurado (picking/debit/op_start) compromete a revisão. Depois de
-- comprometida, uma fonte diferente é recusada: a correção passa a ser
-- compensatória, não reescrita do fato.
CREATE OR REPLACE FUNCTION public.persist_sale_order_material_plan_revision(
  p_sale_order_id uuid,
  p_milestone text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan jsonb;
  v_config public.sale_order_command_config%ROWTYPE;
  v_id uuid;
  v_revision bigint;
  v_is_commit boolean;
  v_current record;
BEGIN
  IF COALESCE(current_setting('app.sale_order_command_internal', true), '') <> '1' THEN
    RAISE EXCEPTION 'Função interna: use execute_sale_order_command'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-command:' || p_sale_order_id::text,
    0
  ));
  PERFORM 1
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV % não encontrado', p_sale_order_id;
  END IF;

  SELECT * INTO v_config
    FROM public.sale_order_command_config
   WHERE config_key = 'default';

  v_plan := public.build_sale_order_material_plan(p_sale_order_id);
  v_is_commit := lower(btrim(COALESCE(p_milestone, '')))
    = v_config.material_plan_commit_milestone;

  SELECT id, source_hash, status, revision_no
    INTO v_current
    FROM public.sale_order_material_plan_revisions
   WHERE sale_order_id = p_sale_order_id
     AND is_current
   ORDER BY revision_no DESC
   LIMIT 1;

  IF FOUND AND v_current.status = 'committed' THEN
    IF v_current.source_hash IS DISTINCT FROM v_plan ->> 'source_hash' THEN
      RAISE EXCEPTION
        'Plano material já comprometido no fato físico; mudança exige compensação'
        USING ERRCODE = 'PZ103';
    END IF;
    RETURN v_current.id;
  END IF;

  -- Toda mudança de vigência cria uma revisão nova, inclusive A -> B -> A.
  -- Reativar a linha A mutaria o histórico (status/committed_at/is_current) e
  -- faria o receipt novo apontar para uma revisão de um comando antigo.
  UPDATE public.sale_order_material_plan_revisions
     SET is_current = false,
         status = 'superseded'
   WHERE sale_order_id = p_sale_order_id
     AND is_current
     AND status <> 'committed';

  SELECT COALESCE(MAX(revision_no), 0) + 1
    INTO v_revision
    FROM public.sale_order_material_plan_revisions
   WHERE sale_order_id = p_sale_order_id;

  INSERT INTO public.sale_order_material_plan_revisions(
    sale_order_id,
    revision_no,
    order_version,
    source_hash,
    status,
    revision_milestone,
    plan_json,
    blockers,
    warnings,
    created_by,
    committed_at
  ) VALUES (
    p_sale_order_id,
    v_revision,
    (v_plan ->> 'order_version')::bigint,
    v_plan ->> 'source_hash',
    CASE WHEN v_is_commit THEN 'committed' ELSE 'proposed' END,
    lower(btrim(p_milestone)),
    COALESCE(v_plan -> 'items', '[]'::jsonb),
    COALESCE(v_plan -> 'blockers', '[]'::jsonb),
    COALESCE(v_plan -> 'warnings', '[]'::jsonb),
    auth.uid(),
    CASE WHEN v_is_commit THEN now() END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_commit_sale_order_material_plan_on_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_order_id uuid;
  v_sale_order_id uuid;
  v_configured text;
  v_strict boolean := false;
  v_previous_internal text;
  v_error_state text;
  v_error_message text;
  v_fact_id text;
  v_aggregate_version bigint;
BEGIN
  IF TG_TABLE_NAME = 'stock_movements' THEN
    IF TG_OP <> 'INSERT' OR NEW.movement_type <> 'out' OR NEW.order_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event := 'debit';
    v_order_id := NEW.order_id;
  ELSIF TG_TABLE_NAME = 'material_reservations' THEN
    IF TG_OP <> 'UPDATE'
       OR NEW.order_id IS NULL
       OR NOT (
         COALESCE(NEW.quantity_consumed, 0) > COALESCE(OLD.quantity_consumed, 0)
         OR (
           NEW.status IN ('consumed', 'converted')
           AND OLD.status IS DISTINCT FROM NEW.status
         )
       ) THEN
      RETURN NEW;
    END IF;
    v_event := 'picking';
    v_order_id := NEW.order_id;
  ELSIF TG_TABLE_NAME = 'order_stages' THEN
    IF TG_OP <> 'UPDATE'
       OR NOT (
         COALESCE(NEW.quantity_processed, 0) > COALESCE(OLD.quantity_processed, 0)
         OR (
           lower(COALESCE(OLD.status, '')) IN ('pendente', 'pending', '')
           AND lower(COALESCE(NEW.status, '')) NOT IN ('pendente', 'pending', '')
         )
       ) THEN
      RETURN NEW;
    END IF;
    v_event := 'op_start';
    v_order_id := NEW.order_id;
  ELSE
    RETURN NEW;
  END IF;

  SELECT material_plan_commit_milestone, material_fact_commit_strict
    INTO v_configured, v_strict
    FROM public.sale_order_command_config
   WHERE config_key = 'default';
  IF v_configured IS DISTINCT FROM v_event THEN
    RETURN NEW;
  END IF;

  SELECT o.sale_order_id
    INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = v_order_id
     AND o.deleted_at IS NULL;
  IF v_sale_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_previous_internal := current_setting('app.sale_order_command_internal', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    )) THEN
      RAISE EXCEPTION
        'Command concorrente mantém o lock do plano material do PV %',
        v_sale_order_id
        USING ERRCODE = 'PZ116';
    END IF;
    PERFORM public.persist_sale_order_material_plan_revision(
      v_sale_order_id,
      v_event
    );
    PERFORM set_config(
      'app.sale_order_command_internal',
      COALESCE(v_previous_internal, ''),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_error_state = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;

    -- Rollout fail-visible/fail-open: erro novo do builder não pode impedir
    -- baixa, picking ou apontamento legado. A outbox segue na mesma transação
    -- do fato e o diagnóstico 10500 lista esses eventos pendentes.
    v_fact_id := COALESCE(to_jsonb(NEW) ->> 'id', txid_current()::text);
    SELECT COALESCE(so.order_version, 1)
      INTO v_aggregate_version
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id;

    BEGIN
      INSERT INTO public.sale_order_command_outbox(
        sale_order_id,
        aggregate_key,
        event_type,
        aggregate_version,
        idempotency_key,
        payload
      ) VALUES (
        v_sale_order_id,
        v_sale_order_id::text,
        CASE WHEN v_error_state = 'PZ103'
          THEN 'sale_order.material_plan_compensation_required'
          ELSE 'sale_order.material_plan_commit_failed'
        END,
        COALESCE(v_aggregate_version, 1),
        concat('material-plan-fact:', TG_TABLE_NAME, ':', v_fact_id, ':', v_event),
        jsonb_build_object(
          'sale_order_id', v_sale_order_id,
          'order_id', v_order_id,
          'fact_table', TG_TABLE_NAME,
          'fact_id', v_fact_id,
          'milestone', v_event,
          'sqlstate', v_error_state,
          'message', v_error_message
        )
      )
      ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'Falha também ao registrar alerta de plano material do PV %: %',
        v_sale_order_id,
        SQLERRM;
    END;

    RAISE WARNING
      'Plano material do PV % não foi comprometido no fato % da OP % [%]: %',
      v_sale_order_id,
      v_event,
      v_order_id,
      v_error_state,
      v_error_message;

    IF COALESCE(v_strict, false) THEN
      RAISE;
    END IF;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commit_material_plan_on_debit
  ON public.stock_movements;
CREATE TRIGGER trg_commit_material_plan_on_debit
AFTER INSERT ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.tg_commit_sale_order_material_plan_on_fact();

DROP TRIGGER IF EXISTS trg_commit_material_plan_on_picking
  ON public.material_reservations;
CREATE TRIGGER trg_commit_material_plan_on_picking
AFTER UPDATE ON public.material_reservations
FOR EACH ROW
EXECUTE FUNCTION public.tg_commit_sale_order_material_plan_on_fact();

DROP TRIGGER IF EXISTS trg_commit_material_plan_on_op_start
  ON public.order_stages;
CREATE TRIGGER trg_commit_material_plan_on_op_start
AFTER UPDATE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.tg_commit_sale_order_material_plan_on_fact();

REVOKE ALL ON FUNCTION public.build_sale_order_material_plan(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_sale_order_material_plan_revision(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_commit_sale_order_material_plan_on_fact()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_record_passive_sale_order_command()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_touch_sale_order_version_from_item()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_execute_sale_order_command(text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)
  TO authenticated, service_role;

-- Wrapper temporário de quatro argumentos: somente comandos sem payload.
-- `transition` usa obrigatoriamente a assinatura completa, que recebe
-- payload.target_status e não pode ser validada por este alias vazio.
REVOKE ALL ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preflight_sale_order_command(uuid, text, bigint, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_sale_order_readiness_override(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_order_readiness_override(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.sale_order_command_config IS
  'Feature decisions reversíveis do command boundary. Promoção all_or_nothing é o default; parcial exige opt-in explícito. Compromisso físico picking/debit/op_start é configurável e inicia fail-open observável.';
COMMENT ON TABLE public.sale_order_command_receipts IS
  'Idempotência e auditoria de comandos do agregado PV. Sem acesso direto pelo cliente.';
COMMENT ON TABLE public.sale_order_material_plan_revisions IS
  'Revisões do plano material. Confirmation/promotion geram propostas substituíveis; o primeiro picking/debit/op_start configurado compromete a revisão e mudanças posteriores exigem compensação.';
COMMENT ON TABLE public.sale_order_readiness_overrides IS
  'Override administrativo permanente no tempo, com justificativa obrigatória e escopo na versão do PV. Não possui expires_at.';
COMMENT ON TABLE public.sale_order_command_outbox IS
  'Outbox transacional para financeiro, compras e integrações. Consumidores externos ainda podem permanecer em TS durante o rollout.';

COMMIT;
