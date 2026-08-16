-- =============================================================================
-- Tiras artesanais: nucleo cadastral canonico
-- Spec: specs/tiras-artesanais-unificacao.md (Reqs. 5-40, 101, 114-129)
--
-- Esta migration cria somente o catalogo e os contratos atomicos. Ela nao
-- remapeia nem reescreve dados operacionais legados. O inventario legado e
-- exposto por dry-run; toda ambiguidade permanece review_required.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Cutover de acesso explicito e favoritos para o hub canonico (Req. 129)
-- -----------------------------------------------------------------------------

-- Somente grants por ROTA sao migrados. Em especial, nao copiamos o grant
-- amplo `module = 'terceirizados'` nem inferimos acesso a partir de role/RBAC.
-- O path `/terceirizados` entra porque era um grant granular explicito para o
-- hub que continha a aba Receitas; capabilities continuam sendo o gate das
-- operacoes sensiveis no novo hub.
WITH legacy_route_grants AS (
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
    '/terceirizados?tab=recipes',
    '/terceirizados'
  )
    AND can_view
  GROUP BY user_id
)
INSERT INTO public.user_permissions (
  user_id,
  module,
  can_view,
  can_create,
  can_edit,
  can_delete
)
SELECT
  user_id,
  '/tiras-artesanais',
  can_view,
  can_create,
  can_edit,
  can_delete
FROM legacy_route_grants
ON CONFLICT (user_id, module) DO UPDATE
SET can_view = public.user_permissions.can_view OR EXCLUDED.can_view,
    can_create = public.user_permissions.can_create OR EXCLUDED.can_create,
    can_edit = public.user_permissions.can_edit OR EXCLUDED.can_edit,
    can_delete = public.user_permissions.can_delete OR EXCLUDED.can_delete;

-- Remove somente os aliases que deixaram de ser destinos concediveis. O grant
-- explicito de `/terceirizados` permanece intacto para o hub de terceiros.
DELETE FROM public.user_permissions
 WHERE module IN (
   '/calculadora-tiras',
   '/artisanal-recipes',
   '/terceirizados?tab=recipes'
 );

-- Reescreve favoritos persistidos, preserva ordem/campos extras e deduplica o
-- destino canonico. O primeiro favorito na ordem original vence.
WITH affected AS (
  SELECT user_id, favorites
    FROM public.user_menu_favorites f
   WHERE jsonb_typeof(f.favorites) = 'array'
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(f.favorites) item
        WHERE item ->> 'path' IN (
          '/calculadora-tiras',
          '/artisanal-recipes',
          '/terceirizados?tab=recipes'
        )
     )
), expanded AS (
  SELECT
    a.user_id,
    e.ordinality,
    CASE
      WHEN e.item ->> 'path' IN (
        '/calculadora-tiras',
        '/artisanal-recipes',
        '/terceirizados?tab=recipes'
      ) THEN (e.item - 'name' - 'path') || jsonb_build_object(
        'name', 'Tiras Artesanais',
        'path', '/tiras-artesanais'
      )
      ELSE e.item
    END AS item
  FROM affected a
  CROSS JOIN LATERAL jsonb_array_elements(a.favorites)
    WITH ORDINALITY AS e(item, ordinality)
), ranked AS (
  SELECT
    user_id,
    ordinality,
    item,
    row_number() OVER (
      PARTITION BY user_id, CASE
        WHEN jsonb_typeof(item) = 'object' AND item ->> 'path' IS NOT NULL
          THEN 'path:' || (item ->> 'path')
        ELSE 'ordinal:' || ordinality::text
      END
      ORDER BY ordinality
    ) AS duplicate_rank
  FROM expanded
), rebuilt AS (
  SELECT
    user_id,
    coalesce(jsonb_agg(item ORDER BY ordinality), '[]'::jsonb) AS favorites
  FROM ranked
  WHERE duplicate_rank = 1
  GROUP BY user_id
)
UPDATE public.user_menu_favorites f
   SET favorites = r.favorites,
       updated_at = now()
  FROM rebuilt r
 WHERE r.user_id = f.user_id;

-- -----------------------------------------------------------------------------
-- 1. Campos comerciais que pertencem exclusivamente ao produto comprado
-- -----------------------------------------------------------------------------

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_price numeric,
  ADD COLUMN IF NOT EXISTS material_preparation_days integer DEFAULT 2;

UPDATE public.products
   SET material_preparation_days = 2
 WHERE material_preparation_days IS NULL;

ALTER TABLE public.products
  ALTER COLUMN material_preparation_days SET DEFAULT 2,
  ALTER COLUMN material_preparation_days SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_purchase_price_positive_ck'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_purchase_price_positive_ck
      CHECK (purchase_price IS NULL OR purchase_price > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.products'::regclass
       AND conname = 'products_material_preparation_days_nonnegative_ck'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_material_preparation_days_nonnegative_ck
      CHECK (material_preparation_days >= 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.products.purchase_price IS
  'Preco comercial vigente de compra. Nao confundir com products.unit_price, que e custo medio contabil.';
COMMENT ON COLUMN public.products.material_preparation_days IS
  'Margem/preparo do material em dias corridos. Default canonico: 2 dias.';

-- Normalizacao deterministica v1. Nao e identidade operacional: serve somente
-- para unicidade de cadastro, aliases aprovados e sugestoes de migracao.
CREATE OR REPLACE FUNCTION public.normalize_strap_catalog_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

COMMENT ON FUNCTION public.normalize_strap_catalog_text(text) IS
  'Normalizacao deterministica v1 para nomes/aliases. Nunca substitui resolucao operacional por UUID.';

-- Equivalente server-side do gate canSeeFinancialValues atual: usuario aprovado
-- com ao menos um papel fora de producao/almoxarifado.
CREATE OR REPLACE FUNCTION public.can_see_strap_financial_values(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(auth.role() = 'service_role', false)
      OR (
        p_user_id IS NOT NULL
        AND public.is_approved(p_user_id)
        AND EXISTS (
          SELECT 1
            FROM public.user_roles ur
           WHERE ur.user_id = p_user_id
             AND ur.role::text NOT IN ('producao', 'almoxarifado')
        )
      );
$$;

-- -----------------------------------------------------------------------------
-- 2. Capabilities server-side (independentes de visibilidade de rota)
-- -----------------------------------------------------------------------------

CREATE TABLE public.artisanal_strap_user_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  grant_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_user_capabilities_name_ck CHECK (
    capability IN (
      'manage_strap_catalog',
      'approve_strap_recipe',
      'execute_strap_batch',
      'resolve_strap_migration'
    )
  ),
  CONSTRAINT artisanal_strap_user_capabilities_user_capability_uq
    UNIQUE (user_id, capability)
);

COMMENT ON TABLE public.artisanal_strap_user_capabilities IS
  'Capabilities explicitas do dominio de tiras. resolve_strap_migration continua exclusivo de Administrador.';

CREATE OR REPLACE FUNCTION public.has_artisanal_strap_capability(
  p_capability text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(auth.role() = 'service_role', false)
      OR (
        p_capability IN (
          'manage_strap_catalog',
          'approve_strap_recipe',
          'execute_strap_batch',
          'resolve_strap_migration'
        )
        AND p_user_id IS NOT NULL
        AND public.is_approved(p_user_id)
        AND (
          EXISTS (
            SELECT 1
              FROM public.user_roles ur
             WHERE ur.user_id = p_user_id
               AND ur.role::text = 'admin'
          )
          OR (
            p_capability <> 'resolve_strap_migration'
            AND EXISTS (
              SELECT 1
                FROM public.artisanal_strap_user_capabilities c
               WHERE c.user_id = p_user_id
                 AND c.capability = p_capability
            )
          )
        )
      );
$$;

-- -----------------------------------------------------------------------------
-- 3. Catalogo, cores, base oficial, variantes e receitas versionadas
-- -----------------------------------------------------------------------------

CREATE TABLE public.artisanal_strap_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_norm text GENERATED ALWAYS AS (public.normalize_strap_catalog_text(name)) STORED,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_types_name_not_blank_ck
    CHECK (public.normalize_strap_catalog_text(name) <> ''),
  CONSTRAINT artisanal_strap_types_name_norm_uq UNIQUE (name_norm)
);

CREATE TABLE public.artisanal_strap_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strap_type_id uuid NOT NULL REFERENCES public.artisanal_strap_types(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  finished_width_mm numeric(18,6) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_measures_display_name_not_blank_ck
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT artisanal_strap_measures_finished_width_positive_ck
    CHECK (finished_width_mm > 0)
);

CREATE UNIQUE INDEX artisanal_strap_measures_active_identity_uq
  ON public.artisanal_strap_measures (strap_type_id, finished_width_mm)
  WHERE active;

CREATE TABLE public.canonical_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_norm text GENERATED ALWAYS AS (public.normalize_strap_catalog_text(name)) STORED,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_colors_name_not_blank_ck
    CHECK (public.normalize_strap_catalog_text(name) <> ''),
  CONSTRAINT canonical_colors_name_norm_uq UNIQUE (name_norm)
);

CREATE TABLE public.color_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_color_id uuid NOT NULL REFERENCES public.canonical_colors(id) ON DELETE RESTRICT,
  alias text NOT NULL,
  alias_norm text GENERATED ALWAYS AS (public.normalize_strap_catalog_text(alias)) STORED,
  status text NOT NULL DEFAULT 'pending',
  proposed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT color_aliases_alias_not_blank_ck
    CHECK (public.normalize_strap_catalog_text(alias) <> ''),
  CONSTRAINT color_aliases_status_ck
    CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  CONSTRAINT color_aliases_approval_shape_ck CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status <> 'approved'
  )
);

CREATE UNIQUE INDEX color_aliases_approved_alias_norm_uq
  ON public.color_aliases (alias_norm)
  WHERE status = 'approved';

CREATE INDEX color_aliases_color_idx
  ON public.color_aliases (canonical_color_id, status);

CREATE TABLE public.base_material_width_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  usable_width_mm numeric(18,6) NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  valid_from timestamptz,
  valid_to timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT base_material_width_profiles_version_positive_ck CHECK (version > 0),
  CONSTRAINT base_material_width_profiles_width_positive_ck CHECK (usable_width_mm > 0),
  CONSTRAINT base_material_width_profiles_status_ck CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'superseded', 'suspended', 'archived')
  ),
  CONSTRAINT base_material_width_profiles_validity_ck CHECK (
    valid_to IS NULL OR (valid_from IS NOT NULL AND valid_to > valid_from)
  ),
  CONSTRAINT base_material_width_profiles_approval_shape_ck CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND valid_from IS NOT NULL)
    OR status <> 'approved'
  ),
  CONSTRAINT base_material_width_profiles_base_version_uq UNIQUE (base_group_id, version)
);

CREATE UNIQUE INDEX base_material_width_profiles_current_approved_uq
  ON public.base_material_width_profiles (base_group_id)
  WHERE status = 'approved' AND valid_to IS NULL;

CREATE TABLE public.base_material_color_official_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE RESTRICT,
  color_id uuid NOT NULL REFERENCES public.canonical_colors(id) ON DELETE RESTRICT,
  official_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'review_required',
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT base_material_official_products_status_ck CHECK (
    status IN ('active', 'review_required', 'suspended', 'superseded', 'archived')
  ),
  CONSTRAINT base_material_official_products_approval_shape_ck CHECK (
    (status = 'active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status <> 'active'
  )
);

CREATE UNIQUE INDEX base_material_official_products_active_identity_uq
  ON public.base_material_color_official_products (base_group_id, color_id)
  WHERE status = 'active';

CREATE INDEX base_material_official_products_product_idx
  ON public.base_material_color_official_products (official_product_id, status);

CREATE TABLE public.artisanal_strap_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_id uuid NOT NULL REFERENCES public.artisanal_strap_measures(id) ON DELETE RESTRICT,
  base_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE RESTRICT,
  color_id uuid NOT NULL REFERENCES public.canonical_colors(id) ON DELETE RESTRICT,
  finished_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  min_stock_m numeric(20,6),
  min_stock_replenishment_mode text,
  purchase_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'review_required',
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_variants_min_stock_nonnegative_ck
    CHECK (min_stock_m IS NULL OR min_stock_m >= 0),
  CONSTRAINT artisanal_strap_variants_replenishment_mode_ck
    CHECK (min_stock_replenishment_mode IS NULL OR min_stock_replenishment_mode IN ('internal', 'buy_ready')),
  CONSTRAINT artisanal_strap_variants_status_ck
    CHECK (status IN ('active', 'review_required', 'suspended', 'archived')),
  CONSTRAINT artisanal_strap_variants_identity_uq
    UNIQUE (measure_id, base_group_id, color_id),
  CONSTRAINT artisanal_strap_variants_finished_product_uq
    UNIQUE (finished_product_id)
);

CREATE TABLE public.artisanal_strap_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measure_id uuid NOT NULL REFERENCES public.artisanal_strap_measures(id) ON DELETE RESTRICT,
  base_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE RESTRICT,
  base_width_profile_id uuid NOT NULL REFERENCES public.base_material_width_profiles(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  usable_base_width_mm_snapshot numeric(18,6) NOT NULL,
  cut_band_width_mm numeric(18,6) NOT NULL,
  theoretical_yield_m_per_m numeric(20,6)
    GENERATED ALWAYS AS (floor(usable_base_width_mm_snapshot / cut_band_width_mm)) STORED,
  confirmed_yield_m_per_m numeric(20,6) NOT NULL,
  executor_type text NOT NULL,
  default_contractor_id uuid REFERENCES public.contractors(id) ON DELETE RESTRICT,
  transformation_cost_per_m numeric(20,6) NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  valid_from timestamptz,
  valid_to timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  supersedes_recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_recipes_version_positive_ck CHECK (version > 0),
  CONSTRAINT artisanal_strap_recipes_widths_positive_ck CHECK (
    usable_base_width_mm_snapshot > 0 AND cut_band_width_mm > 0
  ),
  CONSTRAINT artisanal_strap_recipes_yield_ck CHECK (
    confirmed_yield_m_per_m > 0
    AND confirmed_yield_m_per_m <= floor(usable_base_width_mm_snapshot / cut_band_width_mm)
  ),
  CONSTRAINT artisanal_strap_recipes_executor_ck CHECK (
    (executor_type = 'factory' AND default_contractor_id IS NULL)
    OR (executor_type = 'contractor' AND default_contractor_id IS NOT NULL)
  ),
  CONSTRAINT artisanal_strap_recipes_cost_nonnegative_ck CHECK (transformation_cost_per_m >= 0),
  CONSTRAINT artisanal_strap_recipes_status_ck CHECK (
    status IN ('draft', 'pending_approval', 'approved', 'superseded', 'suspended', 'archived')
  ),
  CONSTRAINT artisanal_strap_recipes_validity_ck CHECK (
    valid_to IS NULL OR (valid_from IS NOT NULL AND valid_to > valid_from)
  ),
  CONSTRAINT artisanal_strap_recipes_approval_shape_ck CHECK (
    (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND valid_from IS NOT NULL)
    OR status <> 'approved'
  ),
  CONSTRAINT artisanal_strap_recipes_measure_base_version_uq
    UNIQUE (measure_id, base_group_id, version)
);

CREATE UNIQUE INDEX artisanal_strap_recipes_current_approved_uq
  ON public.artisanal_strap_recipes (measure_id, base_group_id)
  WHERE status = 'approved' AND valid_to IS NULL;

CREATE INDEX artisanal_strap_recipes_profile_idx
  ON public.artisanal_strap_recipes (base_width_profile_id);

CREATE UNIQUE INDEX base_material_official_products_active_product_uq
  ON public.base_material_color_official_products (official_product_id)
  WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 4. Artefatos de dry-run e identidade tecnica legada
-- -----------------------------------------------------------------------------

CREATE TABLE public.artisanal_strap_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'completed',
  report jsonb NOT NULL,
  overall_checksum text NOT NULL,
  note text,
  run_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_migration_runs_status_ck
    CHECK (status IN ('completed', 'review_required', 'failed'))
);

CREATE TABLE public.artisanal_strap_migration_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_run_id uuid REFERENCES public.artisanal_strap_migration_runs(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  legacy_id text NOT NULL,
  status text NOT NULL DEFAULT 'review_required',
  reason text NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution jsonb,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artisanal_strap_migration_review_status_ck
    CHECK (status IN ('review_required', 'resolved', 'rejected')),
  CONSTRAINT artisanal_strap_migration_review_resolution_ck CHECK (
    (status = 'resolved' AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  )
);

CREATE UNIQUE INDEX artisanal_strap_migration_review_open_uq
  ON public.artisanal_strap_migration_review_items (entity_type, legacy_id)
  WHERE status = 'review_required';

CREATE TABLE public.technical_strap_line_identity_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technical_sheet_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE RESTRICT,
  legacy_path text NOT NULL,
  legacy_ordinal integer NOT NULL,
  content_hash text NOT NULL,
  technical_strap_line_id uuid NOT NULL DEFAULT gen_random_uuid(),
  measure_id uuid REFERENCES public.artisanal_strap_measures(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'review_required',
  resolution_reason text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT technical_strap_line_identity_ordinal_ck CHECK (legacy_ordinal >= 0),
  CONSTRAINT technical_strap_line_identity_hash_ck CHECK (content_hash ~ '^[0-9a-f]{32}$'),
  CONSTRAINT technical_strap_line_identity_status_ck
    CHECK (status IN ('review_required', 'resolved', 'archived')),
  CONSTRAINT technical_strap_line_identity_resolution_ck CHECK (
    (status = 'resolved' AND measure_id IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  ),
  CONSTRAINT technical_strap_line_identity_source_uq
    UNIQUE (technical_sheet_id, legacy_path, legacy_ordinal, content_hash),
  CONSTRAINT technical_strap_line_identity_uuid_uq UNIQUE (technical_strap_line_id)
);

CREATE TABLE public.legacy_artisanal_recipe_map (
  legacy_recipe_id uuid PRIMARY KEY REFERENCES public.artisanal_recipes(id) ON DELETE RESTRICT,
  canonical_recipe_id uuid REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'review_required',
  resolution_reason text NOT NULL,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_artisanal_recipe_map_status_ck
    CHECK (status IN ('review_required', 'resolved', 'rejected')),
  CONSTRAINT legacy_artisanal_recipe_map_resolution_ck CHECK (
    (status = 'resolved' AND canonical_recipe_id IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  )
);

COMMENT ON TABLE public.technical_strap_line_identity_map IS
  'Mapa estavel (ficha, caminho/ordinal, hash) -> UUID tecnico. Nunca usa length+1.';
COMMENT ON TABLE public.legacy_artisanal_recipe_map IS
  'Preserva o UUID/FK da receita legada; ligacao canonica exige resolucao explicita.';

-- -----------------------------------------------------------------------------
-- 5. Validacoes cruzadas que constraints simples nao conseguem expressar
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.strap_material_product_width_mm(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    CASE lower(coalesce(cs.dimensions_unit, 'mm'))
      WHEN 'mm' THEN nullif(cs.dimensions_width, 0)
      WHEN 'cm' THEN nullif(cs.dimensions_width, 0) * 10
      WHEN 'm'  THEN nullif(cs.dimensions_width, 0) * 1000
      ELSE NULL
    END,
    CASE lower(coalesce(p.dimensions_unit, 'mm'))
      WHEN 'mm' THEN nullif(p.dimensions_width, 0)
      WHEN 'cm' THEN nullif(p.dimensions_width, 0) * 10
      WHEN 'm'  THEN nullif(p.dimensions_width, 0) * 1000
      ELSE NULL
    END,
    CASE lower(coalesce(pg.dimensions_unit, 'mm'))
      WHEN 'mm' THEN nullif(pg.dimensions_width, 0)
      WHEN 'cm' THEN nullif(pg.dimensions_width, 0) * 10
      WHEN 'm'  THEN nullif(pg.dimensions_width, 0) * 1000
      ELSE NULL
    END
  )
    FROM public.products p
    LEFT JOIN public.component_sheets cs ON cs.product_id = p.id
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
   WHERE p.id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION public.tg_validate_canonical_color_and_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'canonical_colors' THEN
    IF EXISTS (
      SELECT 1
        FROM public.color_aliases ca
       WHERE ca.status = 'approved'
         AND ca.alias_norm = public.normalize_strap_catalog_text(NEW.name)
         AND ca.canonical_color_id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Nome canonico conflita com alias aprovado de outra cor';
    END IF;
  ELSE
    IF NEW.status = 'approved' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.canonical_colors cc
         WHERE cc.id = NEW.canonical_color_id AND cc.active
      ) THEN
        RAISE EXCEPTION 'Alias nao pode ser aprovado para cor inativa';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.canonical_colors cc
         WHERE cc.name_norm = public.normalize_strap_catalog_text(NEW.alias)
           AND cc.id <> NEW.canonical_color_id
      ) THEN
        RAISE EXCEPTION 'Alias conflita com nome de outra cor canonica';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_canonical_color
  BEFORE INSERT OR UPDATE OF name, active ON public.canonical_colors
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_canonical_color_and_alias();

CREATE TRIGGER trg_validate_color_alias
  BEFORE INSERT OR UPDATE OF canonical_color_id, alias, status ON public.color_aliases
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_canonical_color_and_alias();

CREATE OR REPLACE FUNCTION public.tg_validate_base_material_official_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_width_mm numeric;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_product
    FROM public.products
   WHERE id = NEW.official_product_id;

  IF NOT FOUND OR NOT v_product.active OR v_product.group_id IS DISTINCT FROM NEW.base_group_id THEN
    RAISE EXCEPTION 'Produto-base oficial deve estar ativo e pertencer exatamente ao grupo-base';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id = NEW.official_product_id
  ) THEN
    RAISE EXCEPTION 'Produto acabado de tira nao pode ser designado como napa-base oficial';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.canonical_colors c WHERE c.id = NEW.color_id AND c.active) THEN
    RAISE EXCEPTION 'Cor canonica inativa nao pode receber produto-base oficial';
  END IF;

  SELECT * INTO v_profile
    FROM public.base_material_width_profiles wp
   WHERE wp.base_group_id = NEW.base_group_id
     AND wp.status = 'approved'
     AND wp.valid_to IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Base sem perfil de largura util vigente e aprovado';
  END IF;

  v_width_mm := public.strap_material_product_width_mm(NEW.official_product_id);
  IF v_width_mm IS NULL THEN
    RAISE EXCEPTION 'Produto-base oficial sem largura cadastrada na ficha, produto ou grupo';
  END IF;
  IF abs(v_width_mm - v_profile.usable_width_mm) > 0.000001 THEN
    RAISE EXCEPTION 'Largura do produto-base (%) diverge do perfil vigente (%)', v_width_mm, v_profile.usable_width_mm;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_base_material_official_product
  BEFORE INSERT OR UPDATE OF base_group_id, color_id, official_product_id, status
  ON public.base_material_color_official_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_base_material_official_product();

CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_recipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.base_material_width_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile
    FROM public.base_material_width_profiles
   WHERE id = NEW.base_width_profile_id;

  IF NOT FOUND OR v_profile.base_group_id <> NEW.base_group_id THEN
    RAISE EXCEPTION 'Perfil de largura nao pertence a base da receita';
  END IF;
  IF abs(v_profile.usable_width_mm - NEW.usable_base_width_mm_snapshot) > 0.000001 THEN
    RAISE EXCEPTION 'Snapshot de largura deve ser exatamente o perfil escolhido';
  END IF;

  IF NEW.status IN ('pending_approval', 'approved') THEN
    IF v_profile.status <> 'approved' OR v_profile.valid_to IS NOT NULL THEN
      RAISE EXCEPTION 'Receita pendente/aprovada exige perfil vigente aprovado';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures m
        JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
       WHERE m.id = NEW.measure_id AND m.active AND t.active
    ) THEN
      RAISE EXCEPTION 'Medida/familia inativa nao aceita receita vigente';
    END IF;
  END IF;

  IF NEW.executor_type = 'contractor' AND NOT EXISTS (
    SELECT 1 FROM public.contractors c
     WHERE c.id = NEW.default_contractor_id AND c.active
  ) THEN
    RAISE EXCEPTION 'Terceirizado padrao inexistente ou inativo';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('approved', 'superseded', 'archived') THEN
    IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'superseded', 'suspended') THEN
      RAISE EXCEPTION 'Transicao invalida de receita aprovada';
    ELSIF OLD.status IN ('superseded', 'archived') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
      RAISE EXCEPTION 'Receita superseded/archived e imutavel';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_artisanal_strap_recipe
  BEFORE INSERT OR UPDATE ON public.artisanal_strap_recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_artisanal_strap_recipe();

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
    ) OR NOT EXISTS (
      SELECT 1 FROM public.canonical_colors c
       WHERE c.id = v_variant.color_id AND c.active
    ) THEN
      RAISE EXCEPTION 'Variante ativa exige familia, medida e cor ativas';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.base_material_color_official_products op
       WHERE op.base_group_id = v_variant.base_group_id
         AND op.color_id = v_variant.color_id
         AND op.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Variante ativa exige produto-base oficial exato';
    END IF;
    IF v_variant.min_stock_replenishment_mode = 'internal' AND NOT EXISTS (
      SELECT 1 FROM public.artisanal_strap_recipes r
       WHERE r.measure_id = v_variant.measure_id
         AND r.base_group_id = v_variant.base_group_id
         AND r.status = 'approved'
         AND r.valid_to IS NULL
    ) THEN
      RAISE EXCEPTION 'Reposicao interna exige receita exata vigente e aprovada';
    END IF;
    IF v_variant.min_stock_replenishment_mode = 'buy_ready' AND NOT v_variant.purchase_enabled THEN
      RAISE EXCEPTION 'Reposicao buy_ready exige compra pronta habilitada';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_validate_artisanal_strap_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Valida apos a linha existir para compartilhar exatamente a mesma regra com
  -- RPCs e diagnosticos. Erro reverte a instrucao/transacao inteira.
  PERFORM public.validate_artisanal_strap_variant(NEW.id);
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_validate_artisanal_strap_variant
  AFTER INSERT OR UPDATE ON public.artisanal_strap_variants
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_artisanal_strap_variant();

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
         is_artisanal = true,
         unit = 'm'
   WHERE id = NEW.finished_product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_artisanal_strap_finished_product
  AFTER INSERT OR UPDATE OF finished_product_id, status
  ON public.artisanal_strap_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_artisanal_strap_finished_product();

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
       NEW.active IS DISTINCT FROM OLD.active
       OR NEW.min_stock IS DISTINCT FROM OLD.min_stock
       OR NEW.unit IS DISTINCT FROM OLD.unit
       OR NEW.is_artisanal IS DISTINCT FROM OLD.is_artisanal
     ) THEN
    RAISE EXCEPTION 'Produto acabado de tira deve ser alterado pela RPC canonica do catalogo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_artisanal_strap_finished_product
  BEFORE UPDATE OF active, min_stock, unit, is_artisanal ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_artisanal_strap_finished_product();

-- -----------------------------------------------------------------------------
-- 6. Auditoria uniforme, timestamps e RLS deny-by-default para escrita direta
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_audit_artisanal_strap_catalog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_reason text := nullif(current_setting('app.strap_change_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := to_jsonb(NEW);
    v_new := jsonb_build_object('row', v_row, 'reason', coalesce(v_reason, 'system'));
  ELSIF TG_OP = 'UPDATE' THEN
    v_row := to_jsonb(NEW);
    v_old := jsonb_build_object('row', to_jsonb(OLD), 'reason', coalesce(v_reason, 'system'));
    v_new := jsonb_build_object('row', v_row, 'reason', coalesce(v_reason, 'system'));
  ELSE
    v_row := to_jsonb(OLD);
    v_old := jsonb_build_object('row', v_row, 'reason', coalesce(v_reason, 'system'));
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data, success, created_at
  ) VALUES (
    auth.uid(),
    'strap_catalog_' || lower(TG_OP),
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_old,
    v_new,
    true,
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_types',
    'artisanal_strap_measures',
    'canonical_colors',
    'color_aliases',
    'base_material_width_profiles',
    'base_material_color_official_products',
    'artisanal_strap_variants',
    'artisanal_strap_recipes',
    'artisanal_strap_migration_review_items',
    'technical_strap_line_identity_map',
    'legacy_artisanal_recipe_map'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      v_table
    );
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_user_capabilities',
    'artisanal_strap_types',
    'artisanal_strap_measures',
    'canonical_colors',
    'color_aliases',
    'base_material_width_profiles',
    'base_material_color_official_products',
    'artisanal_strap_variants',
    'artisanal_strap_recipes',
    'artisanal_strap_migration_runs',
    'artisanal_strap_migration_review_items',
    'technical_strap_line_identity_map',
    'legacy_artisanal_recipe_map'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_audit_artisanal_strap_catalog()',
      v_table
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'artisanal_strap_user_capabilities',
    'artisanal_strap_types',
    'artisanal_strap_measures',
    'canonical_colors',
    'color_aliases',
    'base_material_width_profiles',
    'base_material_color_official_products',
    'artisanal_strap_variants',
    'artisanal_strap_recipes',
    'artisanal_strap_migration_runs',
    'artisanal_strap_migration_review_items',
    'technical_strap_line_identity_map',
    'legacy_artisanal_recipe_map'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v_table);
  END LOOP;
END;
$$;

-- Leitura comum do catalogo (sem campos financeiros).
CREATE POLICY artisanal_strap_types_select_approved
  ON public.artisanal_strap_types FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY artisanal_strap_measures_select_approved
  ON public.artisanal_strap_measures FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY canonical_colors_select_approved
  ON public.canonical_colors FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY color_aliases_select_approved
  ON public.color_aliases FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY base_width_profiles_select_approved
  ON public.base_material_width_profiles FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY base_official_products_select_approved
  ON public.base_material_color_official_products FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY artisanal_strap_variants_select_approved
  ON public.artisanal_strap_variants FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

-- A tabela de receita contem custo mestre. Usuarios sem gate financeiro usam a
-- RPC list_artisanal_strap_catalog, que devolve esse campo como null.
CREATE POLICY artisanal_strap_recipes_select_financial
  ON public.artisanal_strap_recipes FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()) AND (SELECT public.can_see_strap_financial_values()));

CREATE POLICY artisanal_strap_capabilities_select_own_or_admin
  ON public.artisanal_strap_user_capabilities FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.user_has_any_role(ARRAY['admin']))
  );

CREATE POLICY artisanal_strap_migration_runs_select_admin
  ON public.artisanal_strap_migration_runs FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin'])));
CREATE POLICY artisanal_strap_migration_review_select_admin
  ON public.artisanal_strap_migration_review_items FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin'])));
CREATE POLICY technical_strap_line_identity_select_admin
  ON public.technical_strap_line_identity_map FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin'])));
CREATE POLICY legacy_artisanal_recipe_map_select_admin
  ON public.legacy_artisanal_recipe_map FOR SELECT TO authenticated
  USING ((SELECT public.user_has_any_role(ARRAY['admin'])));

GRANT SELECT ON TABLE
  public.artisanal_strap_types,
  public.artisanal_strap_measures,
  public.canonical_colors,
  public.color_aliases,
  public.base_material_width_profiles,
  public.base_material_color_official_products,
  public.artisanal_strap_variants,
  public.artisanal_strap_recipes,
  public.artisanal_strap_user_capabilities,
  public.artisanal_strap_migration_runs,
  public.artisanal_strap_migration_review_items,
  public.technical_strap_line_identity_map,
  public.legacy_artisanal_recipe_map
TO authenticated;

-- Helpers de autorizacao usados por todas as RPCs de escrita abaixo.
CREATE OR REPLACE FUNCTION public.assert_artisanal_strap_capability(p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_artisanal_strap_capability(p_capability) THEN
    RAISE EXCEPTION 'Permission denied: capability % requerida', p_capability;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_strap_change_reason(
  p_reason text,
  p_default text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_reason text := nullif(btrim(coalesce(p_reason, p_default, '')), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo obrigatorio para esta alteracao';
  END IF;
  RETURN v_reason;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Capabilities e CRUD atomico do catalogo simples
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_artisanal_strap_capability(
  p_user_id uuid,
  p_capability text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador concede capability de tiras';
  END IF;
  IF p_capability = 'resolve_strap_migration' THEN
    RAISE EXCEPTION 'resolve_strap_migration e implicita e exclusiva do papel Administrador';
  END IF;
  IF p_capability NOT IN ('manage_strap_catalog', 'approve_strap_recipe', 'execute_strap_batch') THEN
    RAISE EXCEPTION 'Capability de tiras invalida';
  END IF;
  IF NOT public.is_approved(p_user_id) THEN
    RAISE EXCEPTION 'Capability exige usuario aprovado';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  INSERT INTO public.artisanal_strap_user_capabilities (
    user_id, capability, granted_by, grant_reason
  ) VALUES (
    p_user_id, p_capability, auth.uid(), v_reason
  )
  ON CONFLICT (user_id, capability) DO UPDATE
    SET granted_by = EXCLUDED.granted_by,
        grant_reason = EXCLUDED.grant_reason,
        created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_artisanal_strap_capability(
  p_user_id uuid,
  p_capability text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := public.require_strap_change_reason(p_reason);
  v_deleted boolean;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador revoga capability de tiras';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  DELETE FROM public.artisanal_strap_user_capabilities
   WHERE user_id = p_user_id AND capability = p_capability;
  v_deleted := FOUND;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_type(
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
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de familia de tira');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF p_id IS NULL THEN
    INSERT INTO public.artisanal_strap_types (name, active)
    VALUES (p_name, coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.artisanal_strap_types
       SET name = p_name,
           active = coalesce(p_active, active)
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Familia de tira inexistente'; END IF;
  END IF;

  IF NOT coalesce(p_active, true) THEN
    UPDATE public.artisanal_strap_recipes r
       SET status = 'suspended',
           review_reason = v_reason
      FROM public.artisanal_strap_measures m
     WHERE m.strap_type_id = v_id
       AND r.measure_id = m.id
       AND r.status = 'approved';
    UPDATE public.artisanal_strap_variants v
       SET status = 'suspended',
           review_reason = v_reason
      FROM public.artisanal_strap_measures m
     WHERE m.strap_type_id = v_id
       AND v.measure_id = m.id
       AND v.status = 'active';
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_measure(
  p_strap_type_id uuid,
  p_display_name text,
  p_finished_width_mm numeric,
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
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de medida de tira');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_types
     WHERE id = p_strap_type_id AND active
  ) AND coalesce(p_active, true) THEN
    RAISE EXCEPTION 'Familia inexistente ou inativa';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF p_id IS NULL THEN
    INSERT INTO public.artisanal_strap_measures (
      strap_type_id, display_name, finished_width_mm, active
    ) VALUES (
      p_strap_type_id, p_display_name, p_finished_width_mm, coalesce(p_active, true)
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.artisanal_strap_measures
       SET strap_type_id = p_strap_type_id,
           display_name = p_display_name,
           finished_width_mm = p_finished_width_mm,
           active = coalesce(p_active, active)
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Medida de tira inexistente'; END IF;
  END IF;

  IF NOT coalesce(p_active, true) THEN
    UPDATE public.artisanal_strap_recipes
       SET status = 'suspended', review_reason = v_reason
     WHERE measure_id = v_id AND status = 'approved';
    UPDATE public.artisanal_strap_variants
       SET status = 'suspended', review_reason = v_reason
     WHERE measure_id = v_id AND status = 'active';
  END IF;
  RETURN v_id;
END;
$$;

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
    UPDATE public.artisanal_strap_variants
       SET status = 'suspended', review_reason = v_reason
     WHERE color_id = v_id AND status = 'active';
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_color_alias(
  p_canonical_color_id uuid,
  p_alias text,
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
  v_reason text := public.require_strap_change_reason(p_reason, 'Sugestao de alias de cor');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF NOT EXISTS (SELECT 1 FROM public.canonical_colors WHERE id = p_canonical_color_id AND active) THEN
    RAISE EXCEPTION 'Cor canonica inexistente ou inativa';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF p_id IS NULL THEN
    INSERT INTO public.color_aliases (
      canonical_color_id, alias, status, proposed_by, review_reason
    ) VALUES (
      p_canonical_color_id, p_alias, 'pending', auth.uid(), v_reason
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.color_aliases
       SET canonical_color_id = p_canonical_color_id,
           alias = p_alias,
           status = 'pending',
           approved_by = NULL,
           approved_at = NULL,
           review_reason = v_reason
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Alias de cor inexistente'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_color_alias(
  p_alias_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alias public.color_aliases%ROWTYPE;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  -- Aprovar alias e resolver conflito de cor sao exclusivos de Administrador.
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  SELECT * INTO v_alias FROM public.color_aliases WHERE id = p_alias_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alias de cor inexistente'; END IF;
  IF v_alias.status = 'archived' THEN RAISE EXCEPTION 'Alias arquivado nao pode ser aprovado'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.color_aliases ca
     WHERE ca.alias_norm = v_alias.alias_norm
       AND ca.status = 'approved'
       AND ca.canonical_color_id <> v_alias.canonical_color_id
       AND ca.id <> v_alias.id
  ) THEN
    RAISE EXCEPTION 'Conflito: alias normalizado ja pertence a outra cor canonica';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  UPDATE public.color_aliases
     SET status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         review_reason = v_reason
   WHERE id = p_alias_id
  RETURNING * INTO v_alias;
  RETURN to_jsonb(v_alias);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Perfil de largura e produto-base oficial
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_base_material_width_profile(
  p_base_group_id uuid,
  p_usable_width_mm numeric,
  p_id uuid DEFAULT NULL,
  p_valid_from timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_version integer;
  v_status text;
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de perfil de largura da base');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF NOT EXISTS (SELECT 1 FROM public.product_groups WHERE id = p_base_group_id) THEN
    RAISE EXCEPTION 'Grupo-base inexistente';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-width:' || p_base_group_id::text, 0));
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  IF p_id IS NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.base_material_width_profiles
     WHERE base_group_id = p_base_group_id;
    INSERT INTO public.base_material_width_profiles (
      base_group_id, version, usable_width_mm, status, valid_from, review_reason
    ) VALUES (
      p_base_group_id, v_version, p_usable_width_mm, 'draft', p_valid_from, v_reason
    ) RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status
      FROM public.base_material_width_profiles
     WHERE id = p_id AND base_group_id = p_base_group_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Perfil de largura inexistente para a base'; END IF;
    IF v_status NOT IN ('draft', 'pending_approval') THEN
      RAISE EXCEPTION 'Perfil vigente/historico e imutavel; crie nova versao';
    END IF;
    UPDATE public.base_material_width_profiles
       SET usable_width_mm = p_usable_width_mm,
           status = 'draft',
           valid_from = p_valid_from,
           approved_by = NULL,
           approved_at = NULL,
           review_reason = v_reason
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

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

  UPDATE public.artisanal_strap_variants
     SET status = 'review_required',
         review_reason = 'Receita suspensa por alteracao da largura da base'
   WHERE base_group_id = v_profile.base_group_id
     AND status = 'active'
     AND min_stock_replenishment_mode = 'internal';

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

CREATE OR REPLACE FUNCTION public.designate_base_material_color_official_product(
  p_base_group_id uuid,
  p_color_id uuid,
  p_official_product_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  -- Duplicata/base ambigua e decisao exclusiva do Administrador.
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  PERFORM pg_advisory_xact_lock(
    hashtextextended('strap-official:' || p_base_group_id::text || ':' || p_color_id::text, 0)
  );
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  SELECT id INTO v_id
    FROM public.base_material_color_official_products
   WHERE base_group_id = p_base_group_id
     AND color_id = p_color_id
     AND official_product_id = p_official_product_id
     AND status = 'active'
   FOR UPDATE;

  IF v_id IS NOT NULL THEN
    UPDATE public.base_material_color_official_products
       SET approved_by = auth.uid(), approved_at = now(), review_reason = v_reason
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  UPDATE public.base_material_color_official_products
     SET status = 'superseded', review_reason = v_reason
   WHERE base_group_id = p_base_group_id
     AND color_id = p_color_id
     AND status = 'active';

  INSERT INTO public.base_material_color_official_products (
    base_group_id, color_id, official_product_id, status,
    approved_by, approved_at, review_reason
  ) VALUES (
    p_base_group_id, p_color_id, p_official_product_id, 'active',
    auth.uid(), now(), v_reason
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Rejeita unidade errada antes que o trigger de sincronizacao possa ajustar o
-- produto. A correcao de unidade precisa ser decisao explicita de cadastro.
CREATE OR REPLACE FUNCTION public.tg_precheck_artisanal_strap_variant_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.id = NEW.finished_product_id AND p.unit = 'm'
  ) THEN
    RAISE EXCEPTION 'Produto acabado inexistente ou com unidade-base diferente de m';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.base_material_color_official_products op
     WHERE op.official_product_id = NEW.finished_product_id AND op.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Produto-base oficial nao pode ser reutilizado como tira acabada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_precheck_artisanal_strap_variant_product
  BEFORE INSERT OR UPDATE OF finished_product_id ON public.artisanal_strap_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_precheck_artisanal_strap_variant_product();

-- -----------------------------------------------------------------------------
-- 9. Variante e receita versionada
-- -----------------------------------------------------------------------------

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
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_recipe(
  p_measure_id uuid,
  p_base_group_id uuid,
  p_cut_band_width_mm numeric,
  p_confirmed_yield_m_per_m numeric,
  p_executor_type text,
  p_transformation_cost_per_m numeric DEFAULT NULL,
  p_default_contractor_id uuid DEFAULT NULL,
  p_base_width_profile_id uuid DEFAULT NULL,
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
  v_profile public.base_material_width_profiles%ROWTYPE;
  v_existing public.artisanal_strap_recipes%ROWTYPE;
  v_version integer;
  v_cost numeric;
  v_supersedes uuid;
  v_reason text := public.require_strap_change_reason(p_reason, 'Cadastro de receita de tira');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  IF p_executor_type NOT IN ('factory', 'contractor') THEN
    RAISE EXCEPTION 'Executor da receita invalido';
  END IF;
  IF p_transformation_cost_per_m IS NOT NULL
     AND auth.role() <> 'service_role'
     AND NOT public.can_see_strap_financial_values() THEN
    RAISE EXCEPTION 'Permission denied: custo exige gate financeiro';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('strap-recipe:' || p_measure_id::text || ':' || p_base_group_id::text, 0)
  );

  IF p_base_width_profile_id IS NULL THEN
    SELECT * INTO v_profile
      FROM public.base_material_width_profiles
     WHERE base_group_id = p_base_group_id
       AND status = 'approved'
       AND valid_to IS NULL;
  ELSE
    SELECT * INTO v_profile
      FROM public.base_material_width_profiles
     WHERE id = p_base_width_profile_id
       AND base_group_id = p_base_group_id
       AND status NOT IN ('superseded', 'archived');
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil exato de largura da base nao encontrado'; END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  IF p_id IS NULL THEN
    IF p_transformation_cost_per_m IS NULL THEN
      RAISE EXCEPTION 'Custo de transformacao obrigatorio na nova receita';
    END IF;
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.artisanal_strap_recipes
     WHERE measure_id = p_measure_id AND base_group_id = p_base_group_id;
    SELECT id INTO v_supersedes
      FROM public.artisanal_strap_recipes
     WHERE measure_id = p_measure_id
       AND base_group_id = p_base_group_id
       AND status = 'approved'
       AND valid_to IS NULL;

    INSERT INTO public.artisanal_strap_recipes (
      measure_id, base_group_id, base_width_profile_id, version,
      usable_base_width_mm_snapshot, cut_band_width_mm,
      confirmed_yield_m_per_m, executor_type, default_contractor_id,
      transformation_cost_per_m, status, supersedes_recipe_id, review_reason
    ) VALUES (
      p_measure_id, p_base_group_id, v_profile.id, v_version,
      v_profile.usable_width_mm, p_cut_band_width_mm,
      p_confirmed_yield_m_per_m, p_executor_type, p_default_contractor_id,
      p_transformation_cost_per_m, 'draft', v_supersedes, v_reason
    ) RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_existing
      FROM public.artisanal_strap_recipes
     WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receita de tira inexistente'; END IF;
    IF v_existing.status NOT IN ('draft', 'pending_approval') THEN
      RAISE EXCEPTION 'Receita vigente/historica e imutavel; crie nova versao';
    END IF;
    v_cost := coalesce(p_transformation_cost_per_m, v_existing.transformation_cost_per_m);
    UPDATE public.artisanal_strap_recipes
       SET measure_id = p_measure_id,
           base_group_id = p_base_group_id,
           base_width_profile_id = v_profile.id,
           usable_base_width_mm_snapshot = v_profile.usable_width_mm,
           cut_band_width_mm = p_cut_band_width_mm,
           confirmed_yield_m_per_m = p_confirmed_yield_m_per_m,
           executor_type = p_executor_type,
           default_contractor_id = p_default_contractor_id,
           transformation_cost_per_m = v_cost,
           status = 'draft',
           approved_by = NULL,
           approved_at = NULL,
           valid_from = NULL,
           valid_to = NULL,
           review_reason = v_reason
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_artisanal_strap_recipe(
  p_recipe_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_reason text := public.require_strap_change_reason(p_reason, 'Receita enviada para aprovacao');
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');
  SELECT * INTO v_recipe FROM public.artisanal_strap_recipes WHERE id = p_recipe_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receita de tira inexistente'; END IF;
  IF v_recipe.status <> 'draft' THEN RAISE EXCEPTION 'Somente receita draft pode ser enviada'; END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  UPDATE public.artisanal_strap_recipes
     SET status = 'pending_approval', review_reason = v_reason
   WHERE id = p_recipe_id
  RETURNING * INTO v_recipe;
  RETURN to_jsonb(v_recipe);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_artisanal_strap_recipe(
  p_recipe_id uuid,
  p_reason text,
  p_valid_from timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('approve_strap_recipe');
  IF p_valid_from > now() THEN
    RAISE EXCEPTION 'Vigencia futura exige agendador de cutover; aprove com data atual ou passada';
  END IF;
  SELECT * INTO v_recipe FROM public.artisanal_strap_recipes WHERE id = p_recipe_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receita de tira inexistente'; END IF;
  IF v_recipe.status = 'approved' THEN RETURN to_jsonb(v_recipe); END IF;
  IF v_recipe.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Somente receita pending_approval pode ser aprovada';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('strap-recipe:' || v_recipe.measure_id::text || ':' || v_recipe.base_group_id::text, 0)
  );
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  UPDATE public.artisanal_strap_recipes
     SET status = 'superseded',
         valid_to = p_valid_from,
         review_reason = v_reason
   WHERE measure_id = v_recipe.measure_id
     AND base_group_id = v_recipe.base_group_id
     AND status = 'approved'
     AND valid_to IS NULL
     AND id <> p_recipe_id;

  UPDATE public.artisanal_strap_recipes
     SET status = 'approved',
         valid_from = p_valid_from,
         valid_to = NULL,
         approved_by = auth.uid(),
         approved_at = now(),
         review_reason = v_reason
   WHERE id = p_recipe_id
  RETURNING * INTO v_recipe;
  RETURN to_jsonb(v_recipe);
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Suspensao/arquivamento sem exclusao fisica
-- -----------------------------------------------------------------------------

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
      UPDATE public.artisanal_strap_variants
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
      UPDATE public.artisanal_strap_variants
         SET status = 'review_required', review_reason = v_reason
       WHERE base_group_id = (SELECT base_group_id FROM public.base_material_width_profiles WHERE id = p_entity_id)
         AND status = 'active' AND min_stock_replenishment_mode = 'internal';
    WHEN 'base_material_color_official_products' THEN
      PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
      IF p_status NOT IN ('suspended', 'archived') THEN RAISE EXCEPTION 'Status de produto oficial invalido'; END IF;
      UPDATE public.base_material_color_official_products
         SET status = p_status, review_reason = v_reason
       WHERE id = p_entity_id AND status <> 'superseded'
      RETURNING to_jsonb(base_material_color_official_products.*) INTO v_result;
      UPDATE public.artisanal_strap_variants
         SET status = 'review_required', review_reason = v_reason
       WHERE base_group_id = (SELECT base_group_id FROM public.base_material_color_official_products WHERE id = p_entity_id)
         AND color_id = (SELECT color_id FROM public.base_material_color_official_products WHERE id = p_entity_id)
         AND status = 'active';
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
      UPDATE public.artisanal_strap_variants
         SET status = 'review_required', review_reason = v_reason
       WHERE measure_id = (SELECT measure_id FROM public.artisanal_strap_recipes WHERE id = p_entity_id)
         AND base_group_id = (SELECT base_group_id FROM public.artisanal_strap_recipes WHERE id = p_entity_id)
         AND status = 'active' AND min_stock_replenishment_mode = 'internal';
    ELSE
      RAISE EXCEPTION 'Entidade de catalogo invalida';
  END CASE;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Registro inexistente ou estado imutavel'; END IF;
  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. Leitura unica do hub com redacao financeira no servidor
-- -----------------------------------------------------------------------------

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
       WHERE p_include_archived OR c.active
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
      SELECT jsonb_agg(to_jsonb(v) ORDER BY v.measure_id, v.base_group_id, v.color_id, v.id)
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
          'purchase_order_unit', p.purchase_order_unit,
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
      'can_see_financial_values', v_can_financial
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Resolvedores canonicos: apenas UUIDs e cardinalidade exata
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_canonical_strap_color(p_value text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT array_agg(DISTINCT q.color_id ORDER BY q.color_id)
    INTO v_ids
    FROM (
      SELECT c.id AS color_id
        FROM public.canonical_colors c
       WHERE c.active
         AND c.name_norm = public.normalize_strap_catalog_text(p_value)
      UNION ALL
      SELECT a.canonical_color_id
        FROM public.color_aliases a
        JOIN public.canonical_colors c ON c.id = a.canonical_color_id AND c.active
       WHERE a.status = 'approved'
         AND a.alias_norm = public.normalize_strap_catalog_text(p_value)
    ) q;

  IF coalesce(array_length(v_ids, 1), 0) = 0 THEN RETURN NULL; END IF;
  IF array_length(v_ids, 1) <> 1 THEN
    RAISE EXCEPTION 'Cor/alias ambiguo; resolucao administrativa obrigatoria';
  END IF;
  RETURN v_ids[1];
END;
$$;

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
  v_base_width_mm numeric;
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
  IF NOT EXISTS (
    SELECT 1 FROM public.canonical_colors c
     WHERE c.id = v_variant.color_id AND c.active
  ) THEN
    RAISE EXCEPTION 'Cor canonica da variante esta inativa';
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
    v_base_width_mm := public.strap_material_product_width_mm(v_official.official_product_id);
  END IF;
  SELECT * INTO v_recipe
    FROM public.artisanal_strap_recipes
   WHERE measure_id = p_measure_id
     AND base_group_id = p_base_group_id
     AND status = 'approved'
     AND valid_from <= now()
     AND (valid_to IS NULL OR valid_to > now());

  v_internal_available := v_recipe.id IS NOT NULL
    AND v_official.id IS NOT NULL
    AND v_base.id IS NOT NULL
    AND v_base.active
    AND v_base.group_id IS NOT DISTINCT FROM p_base_group_id
    AND v_base_width_mm IS NOT NULL
    AND abs(v_base_width_mm - v_recipe.usable_base_width_mm_snapshot) <= 0.000001;
  v_buy_available := coalesce(v_variant.purchase_enabled
    AND v_finished.purchase_price > 0
    AND nullif(btrim(coalesce(v_finished.purchase_unit, '')), '') IS NOT NULL
    AND v_finished.conversion_rate > 0
    AND (v_finished.purchase_unit <> v_finished.unit OR v_finished.conversion_rate = 1)
    AND v_finished.min_order_quantity > 0
    AND v_finished.purchase_multiple > 0
    AND v_finished.material_preparation_days >= 0, false);

  IF p_source_mode = 'internal' AND NOT v_internal_available THEN
    RAISE EXCEPTION 'Origem interna bloqueada: receita exata vigente e aprovada ausente';
  ELSIF p_source_mode = 'buy_ready' AND NOT v_buy_available THEN
    RAISE EXCEPTION 'Compra pronta bloqueada: cadastro comercial incompleto/invalido';
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

-- -----------------------------------------------------------------------------
-- 13. Bundle atomico produto + variante + receita
-- -----------------------------------------------------------------------------

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
     OR (v_recipe_payload IS NOT NULL AND jsonb_typeof(v_recipe_payload) <> 'object') THEN
    RAISE EXCEPTION 'Payload do bundle invalido';
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
      active, is_artisanal, supplier_id, purchase_unit, purchase_order_unit,
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
      v_product_payload ->> 'purchase_order_unit',
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
           purchase_order_unit = CASE WHEN v_product_payload ? 'purchase_order_unit'
                                      THEN v_product_payload ->> 'purchase_order_unit' ELSE purchase_order_unit END,
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
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v
     WHERE v.finished_product_id = NEW.id
  ) THEN
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, old_data, new_data, success, created_at
    ) VALUES (
      auth.uid(), 'strap_catalog_update', 'products', NEW.id::text,
      jsonb_build_object('row', to_jsonb(OLD), 'reason', v_reason),
      jsonb_build_object('row', to_jsonb(NEW), 'reason', v_reason),
      true, now()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_artisanal_strap_finished_product
  AFTER UPDATE OF
    name, sku, group_id, active, unit, is_artisanal, min_stock,
    supplier_id, purchase_unit, purchase_order_unit, conversion_rate,
    purchase_price, min_order_quantity, purchase_multiple,
    material_preparation_days
  ON public.products
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.tg_audit_artisanal_strap_finished_product();

-- -----------------------------------------------------------------------------
-- 14. UUID tecnico legado, dry-run conservativo e fila de revisao
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_technical_strap_line_identity(
  p_technical_sheet_id uuid,
  p_legacy_path text,
  p_legacy_ordinal integer,
  p_content jsonb,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_id uuid;
  v_hash text := md5(coalesce(p_content, 'null'::jsonb)::text);
  v_reason text := public.require_strap_change_reason(p_reason, 'Mapeamento de UUID tecnico legado');
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_artisanal_strap_capability('manage_strap_catalog')
     AND NOT public.has_artisanal_strap_capability('resolve_strap_migration') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_legacy_ordinal < 0 OR nullif(btrim(p_legacy_path), '') IS NULL THEN
    RAISE EXCEPTION 'Caminho/ordinal legado invalido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.technical_sheets WHERE id = p_technical_sheet_id) THEN
    RAISE EXCEPTION 'Ficha tecnica inexistente';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  INSERT INTO public.technical_strap_line_identity_map (
    technical_sheet_id, legacy_path, legacy_ordinal, content_hash,
    status, resolution_reason
  ) VALUES (
    p_technical_sheet_id, p_legacy_path, p_legacy_ordinal, v_hash,
    'review_required', v_reason
  )
  ON CONFLICT (technical_sheet_id, legacy_path, legacy_ordinal, content_hash)
  DO UPDATE SET updated_at = public.technical_strap_line_identity_map.updated_at
  RETURNING technical_strap_line_id INTO v_line_id;
  RETURN v_line_id;
END;
$$;

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
  v_line_id uuid;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF NOT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.id = p_measure_id AND m.active AND t.active
  ) THEN
    RAISE EXCEPTION 'Medida/familia canonica inexistente ou inativa';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  UPDATE public.technical_strap_line_identity_map
     SET measure_id = p_measure_id,
         status = 'resolved',
         resolution_reason = v_reason,
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE id = p_map_id
  RETURNING technical_strap_line_id INTO v_line_id;
  IF v_line_id IS NULL THEN RAISE EXCEPTION 'Linha tecnica mapeada inexistente'; END IF;
  RETURN v_line_id;
END;
$$;

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
  v_map public.legacy_artisanal_recipe_map%ROWTYPE;
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF NOT EXISTS (SELECT 1 FROM public.artisanal_recipes WHERE id = p_legacy_recipe_id) THEN
    RAISE EXCEPTION 'Receita legada inexistente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.artisanal_strap_recipes WHERE id = p_canonical_recipe_id) THEN
    RAISE EXCEPTION 'Receita canonica inexistente';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  INSERT INTO public.legacy_artisanal_recipe_map (
    legacy_recipe_id, canonical_recipe_id, status, resolution_reason,
    resolved_by, resolved_at
  ) VALUES (
    p_legacy_recipe_id, p_canonical_recipe_id, 'resolved', v_reason,
    auth.uid(), now()
  )
  ON CONFLICT (legacy_recipe_id) DO UPDATE
    SET canonical_recipe_id = EXCLUDED.canonical_recipe_id,
        status = 'resolved',
        resolution_reason = EXCLUDED.resolution_reason,
        resolved_by = EXCLUDED.resolved_by,
        resolved_at = EXCLUDED.resolved_at
  RETURNING * INTO v_map;
  RETURN to_jsonb(v_map);
END;
$$;

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
  v_reason text := public.require_strap_change_reason(p_reason);
BEGIN
  PERFORM public.assert_artisanal_strap_capability('resolve_strap_migration');
  IF jsonb_typeof(p_resolution) <> 'object' OR p_resolution = '{}'::jsonb THEN
    RAISE EXCEPTION 'Resolucao explicita e obrigatoria';
  END IF;
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  UPDATE public.artisanal_strap_migration_review_items
     SET status = 'resolved',
         resolution = p_resolution || jsonb_build_object('reason', v_reason),
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE id = p_review_item_id AND status = 'review_required'
  RETURNING * INTO v_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pendencia inexistente ou ja resolvida'; END IF;
  RETURN to_jsonb(v_item);
END;
$$;

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

  WITH relevant_products AS (
    SELECT DISTINCT p.*
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.is_artisanal OR coalesce(pg.is_artisanal_strap, false)
  ),
  technical_lines AS (
    SELECT ts.id AS technical_sheet_id,
           e.ordinality - 1 AS legacy_ordinal,
           e.value AS content
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
     WHERE mr.product_id IN (SELECT id FROM relevant_products)
  ),
  purchase_rows AS (
    SELECT poi.* FROM public.purchase_order_items poi
     WHERE poi.product_id IN (SELECT id FROM relevant_products)
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
    'policy', 'Nomes, maior saldo e primeira linha nunca provam identidade; ambiguos ficam review_required.',
    'checks', jsonb_build_array(
      jsonb_build_object(
        'name', 'legacy_products',
        'count', (SELECT count(*) FROM relevant_products),
        'quantity_total', (SELECT coalesce(sum(quantity), 0) FROM relevant_products),
        'reserved_total', (SELECT coalesce(sum(reserved_stock), 0) FROM relevant_products),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || coalesce(quantity, 0)::text || ':' || coalesce(reserved_stock, 0)::text,
          '|' ORDER BY id
        ), '')) FROM relevant_products)
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
        'quantity_total', (SELECT coalesce(sum(quantity), 0) FROM reservation_rows),
        'checksum', (SELECT md5(coalesce(string_agg(
          id::text || ':' || product_id::text || ':' || quantity::text || ':' || status,
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
      'legacy_recipes_name_only', (SELECT count(*) FROM public.artisanal_recipes),
      'technical_lines_without_measure_uuid', (SELECT count(*) FROM technical_lines),
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
              FROM relevant_products
             WHERE nullif(public.normalize_strap_catalog_text(color), '') IS NOT NULL
             GROUP BY public.normalize_strap_catalog_text(color)
          ) s
      ), '[]'::jsonb)
    )
  ) INTO v_report;
  RETURN v_report;
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
    status, resolution_reason
  )
  SELECT ts.id, 'strap_colors', e.ordinality - 1, md5(e.value::text),
         'review_required', 'Familia/medida/base/cor exigem revisao explicita'
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN ts.strap_colors ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS e(value, ordinality)
  ON CONFLICT (technical_sheet_id, legacy_path, legacy_ordinal, content_hash) DO NOTHING;

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
           'quantity_snapshot', p.quantity
         )
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id = p.group_id
   WHERE p.is_artisanal OR coalesce(pg.is_artisanal_strap, false)
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

-- -----------------------------------------------------------------------------
-- 15. Diagnosticos acionaveis (sem corrigir/inferir dados automaticamente)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.artisanal_strap_catalog_diagnostics()
RETURNS TABLE (
  issue_code text,
  entity_id uuid,
  details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT 'variant_product_status_divergence'::text, v.id,
         jsonb_build_object(
           'variant_status', v.status,
           'product_id', p.id,
           'product_active', p.active
         )
    FROM public.artisanal_strap_variants v
    JOIN public.products p ON p.id = v.finished_product_id
   WHERE p.active IS DISTINCT FROM (v.status = 'active')

  UNION ALL

  SELECT 'purchase_enabled_invalid_commercial_data'::text, v.id,
         jsonb_build_object(
           'finished_product_id', p.id,
           'has_purchase_price', p.purchase_price > 0,
           'has_purchase_unit', nullif(btrim(coalesce(p.purchase_unit, '')), '') IS NOT NULL,
           'conversion_valid', p.conversion_rate > 0
             AND (p.purchase_unit <> p.unit OR p.conversion_rate = 1),
           'moq_valid', p.min_order_quantity > 0,
           'multiple_valid', p.purchase_multiple > 0,
           'preparation_days_valid', p.material_preparation_days >= 0,
           'supplier_missing_allowed_only_as_provisional_po', p.supplier_id IS NULL
         )
    FROM public.artisanal_strap_variants v
    JOIN public.products p ON p.id = v.finished_product_id
   WHERE v.purchase_enabled
     AND (
       p.purchase_price IS NULL OR p.purchase_price <= 0
       OR nullif(btrim(coalesce(p.purchase_unit, '')), '') IS NULL
       OR p.conversion_rate IS NULL OR p.conversion_rate <= 0
       OR (p.purchase_unit = p.unit AND p.conversion_rate <> 1)
       OR p.min_order_quantity IS NULL OR p.min_order_quantity <= 0
       OR p.purchase_multiple IS NULL OR p.purchase_multiple <= 0
       OR p.material_preparation_days < 0
     )

  UNION ALL

  SELECT 'active_internal_variant_without_current_recipe'::text, v.id,
         jsonb_build_object('measure_id', v.measure_id, 'base_group_id', v.base_group_id)
    FROM public.artisanal_strap_variants v
   WHERE v.status = 'active'
     AND v.min_stock_replenishment_mode = 'internal'
     AND NOT EXISTS (
       SELECT 1 FROM public.artisanal_strap_recipes r
        WHERE r.measure_id = v.measure_id
          AND r.base_group_id = v.base_group_id
          AND r.status = 'approved'
          AND r.valid_from <= now()
          AND (r.valid_to IS NULL OR r.valid_to > now())
     )

  UNION ALL

  SELECT 'official_base_width_divergence'::text, op.id,
         jsonb_build_object(
           'base_group_id', op.base_group_id,
           'color_id', op.color_id,
           'official_product_id', op.official_product_id,
           'product_width_mm', public.strap_material_product_width_mm(op.official_product_id),
           'profile_width_mm', wp.usable_width_mm
         )
    FROM public.base_material_color_official_products op
    JOIN public.base_material_width_profiles wp
      ON wp.base_group_id = op.base_group_id
     AND wp.status = 'approved'
     AND wp.valid_to IS NULL
   WHERE op.status = 'active'
     AND (
       public.strap_material_product_width_mm(op.official_product_id) IS NULL
       OR abs(public.strap_material_product_width_mm(op.official_product_id) - wp.usable_width_mm) > 0.000001
     )

  UNION ALL

  SELECT 'legacy_technical_line_review_required'::text, m.id,
         jsonb_build_object(
           'technical_sheet_id', m.technical_sheet_id,
           'technical_strap_line_id', m.technical_strap_line_id,
           'legacy_path', m.legacy_path,
           'legacy_ordinal', m.legacy_ordinal
         )
    FROM public.technical_strap_line_identity_map m
   WHERE m.status = 'review_required';
END;
$$;

-- -----------------------------------------------------------------------------
-- 16. Privilegios de execucao: PUBLIC/anon nunca escrevem por RPC
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'normalize_strap_catalog_text',
         'can_see_strap_financial_values',
         'has_artisanal_strap_capability',
         'grant_artisanal_strap_capability',
         'revoke_artisanal_strap_capability',
         'strap_material_product_width_mm',
         'validate_artisanal_strap_variant',
         'assert_artisanal_strap_capability',
         'require_strap_change_reason',
         'save_artisanal_strap_type',
         'save_artisanal_strap_measure',
         'save_canonical_color',
         'save_color_alias',
         'approve_color_alias',
         'save_base_material_width_profile',
         'approve_base_material_width_profile',
         'designate_base_material_color_official_product',
         'save_artisanal_strap_variant',
         'save_artisanal_strap_recipe',
         'submit_artisanal_strap_recipe',
         'approve_artisanal_strap_recipe',
         'set_artisanal_strap_record_status',
         'list_artisanal_strap_catalog',
         'resolve_canonical_strap_color',
         'resolve_artisanal_strap_catalog',
         'save_artisanal_strap_catalog_bundle',
         'ensure_technical_strap_line_identity',
         'resolve_technical_strap_line_migration',
         'resolve_legacy_artisanal_recipe_migration',
         'resolve_artisanal_strap_migration_review_item',
         'preview_artisanal_strap_catalog_migration',
         'run_artisanal_strap_catalog_migration_dry_run',
         'artisanal_strap_catalog_diagnostics',
         'tg_validate_canonical_color_and_alias',
         'tg_validate_base_material_official_product',
         'tg_validate_artisanal_strap_recipe',
         'tg_validate_artisanal_strap_variant',
         'tg_sync_artisanal_strap_finished_product',
         'tg_guard_artisanal_strap_finished_product',
         'tg_precheck_artisanal_strap_variant_product',
         'tg_audit_artisanal_strap_finished_product',
         'tg_audit_artisanal_strap_catalog'
       ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_strap_catalog_text(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_strap_financial_values(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_artisanal_strap_capability(text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.strap_material_product_width_mm(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_artisanal_strap_variant(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.grant_artisanal_strap_capability(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_artisanal_strap_capability(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_type(text, uuid, boolean, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_measure(uuid, text, numeric, uuid, boolean, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_canonical_color(text, uuid, boolean, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_color_alias(uuid, text, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_color_alias(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_base_material_width_profile(uuid, numeric, uuid, timestamptz, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_base_material_width_profile(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.designate_base_material_color_official_product(uuid, uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_variant(
  uuid, uuid, uuid, uuid, numeric, text, boolean, text, text, uuid, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_recipe(
  uuid, uuid, numeric, numeric, text, numeric, uuid, uuid, uuid, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_artisanal_strap_recipe(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_artisanal_strap_recipe(uuid, text, timestamptz)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_artisanal_strap_record_status(text, uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_catalog_bundle(jsonb, text)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_artisanal_strap_catalog(boolean)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_strap_color(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.artisanal_strap_catalog_diagnostics()
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ensure_technical_strap_line_identity(uuid, text, integer, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_technical_strap_line_migration(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_legacy_artisanal_recipe_migration(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_artisanal_strap_migration_review_item(uuid, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_artisanal_strap_catalog_migration()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(text)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 17. Assertions de contrato da propria migration (nao inserem dados)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF public.normalize_strap_catalog_text('  CURA ÓF-WHITE  ') <> 'cura of white' THEN
    RAISE EXCEPTION 'Falha no contrato de normalizacao deterministica de aliases';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'color_aliases_approved_alias_norm_uq'
       AND indexdef ILIKE '%WHERE (status = ''approved''%'
  ) THEN
    RAISE EXCEPTION 'Indice parcial global de alias aprovado ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'material_preparation_days'
       AND is_nullable = 'NO'
       AND column_default = '2'
  ) THEN
    RAISE EXCEPTION 'Default/NOT NULL de material_preparation_days nao foi aplicado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'artisanal_strap_variants_identity_uq'
  ) THEN
    -- UNIQUE constraint aparece em pg_indexes com este nome.
    RAISE EXCEPTION 'Unicidade exata da variante nao foi criada';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.resolve_artisanal_strap_catalog(uuid, uuid, uuid, text) IS
  'Resolvedor canonico por IDs exatos. Nao usa nome, group+color ou LIMIT 1; redige custos sem gate financeiro.';
COMMENT ON FUNCTION public.save_artisanal_strap_catalog_bundle(jsonb, text) IS
  'Gravacao atomica de familia/medida/produto/variante/receita. Qualquer falha reverte o bundle inteiro.';
COMMENT ON FUNCTION public.preview_artisanal_strap_catalog_migration() IS
  'Inventario read-only com contagens, totais e checksums; nao cria vinculos nem altera legado.';
COMMENT ON FUNCTION public.run_artisanal_strap_catalog_migration_dry_run(text) IS
  'Persiste somente snapshot/checksum, UUIDs tecnicos e pendencias review_required; nao altera dados operacionais legados.';
