-- Materiais base / precificação de desenvolvimento
-- 1) Kits por shoe_category (admin em /engenharia/materiais-base)
-- 2) sheet_materials aceita linha-rascunho (sem product_id) + ajuste + custo fixo R$/par
-- 3) Portão: validada/publicada exige product_id em toda linha material ativa
-- 4) Linhas do kit NÃO entram no consumo/débito (include_in_consumption = false)

-- ─── Kits ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.base_material_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shoe_category text NOT NULL,
  name text NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT base_material_kits_shoe_category_unique UNIQUE (shoe_category)
);

CREATE TABLE IF NOT EXISTS public.base_material_kit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES public.base_material_kits(id) ON DELETE CASCADE,
  line_kind text NOT NULL DEFAULT 'material'
    CHECK (line_kind IN ('material', 'ajuste')),
  description text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.product_groups(id) ON DELETE SET NULL,
  unit text NOT NULL DEFAULT 'par',
  quantity_per_unit numeric NOT NULL DEFAULT 1,
  cost_mode text NOT NULL DEFAULT 'fixed_per_pair'
    CHECK (cost_mode IN ('fixed_per_pair', 'consumo_x_preco')),
  cost_per_pair numeric,
  estimated_unit_price numeric,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT base_material_kit_items_ajuste_sem_produto
    CHECK (line_kind <> 'ajuste' OR product_id IS NULL),
  CONSTRAINT base_material_kit_items_material_tem_nome
    CHECK (line_kind <> 'material' OR nullif(btrim(description), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_base_material_kit_items_kit
  ON public.base_material_kit_items (kit_id, sort_order);

ALTER TABLE public.base_material_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_material_kit_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.base_material_kits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.base_material_kit_items FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_material_kits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_material_kit_items TO authenticated;
GRANT ALL ON public.base_material_kits TO service_role;
GRANT ALL ON public.base_material_kit_items TO service_role;

DROP POLICY IF EXISTS base_material_kits_approved ON public.base_material_kits;
CREATE POLICY base_material_kits_approved ON public.base_material_kits
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

DROP POLICY IF EXISTS base_material_kit_items_approved ON public.base_material_kit_items;
CREATE POLICY base_material_kit_items_approved ON public.base_material_kit_items
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());

-- ─── sheet_materials: rascunho / ajuste / custo base ─────────────────────────

ALTER TABLE public.sheet_materials
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.sheet_materials
  ADD COLUMN IF NOT EXISTS draft_name text,
  ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'material',
  ADD COLUMN IF NOT EXISTS cost_mode text NOT NULL DEFAULT 'consumo_x_preco',
  ADD COLUMN IF NOT EXISTS cost_per_pair numeric,
  ADD COLUMN IF NOT EXISTS estimated_unit_price numeric,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_in_consumption boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS from_kit_item_id uuid REFERENCES public.base_material_kit_items(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sheet_materials_line_kind_check'
  ) THEN
    ALTER TABLE public.sheet_materials
      ADD CONSTRAINT sheet_materials_line_kind_check
      CHECK (line_kind IN ('material', 'ajuste'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sheet_materials_cost_mode_check'
  ) THEN
    ALTER TABLE public.sheet_materials
      ADD CONSTRAINT sheet_materials_cost_mode_check
      CHECK (cost_mode IN ('fixed_per_pair', 'consumo_x_preco'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sheet_materials_draft_or_product_or_ajuste'
  ) THEN
    ALTER TABLE public.sheet_materials
      ADD CONSTRAINT sheet_materials_draft_or_product_or_ajuste
      CHECK (
        line_kind = 'ajuste'
        OR product_id IS NOT NULL
        OR nullif(btrim(coalesce(draft_name, part_name, '')), '') IS NOT NULL
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sheet_materials_ajuste_sem_produto'
  ) THEN
    ALTER TABLE public.sheet_materials
      ADD CONSTRAINT sheet_materials_ajuste_sem_produto
      CHECK (line_kind <> 'ajuste' OR product_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.sheet_materials.include_in_consumption IS
  'false = só precificação (kit base / ajuste). Motores de consumo/débito devem ignorar.';
COMMENT ON COLUMN public.sheet_materials.cost_mode IS
  'fixed_per_pair = R$/par do kit; consumo_x_preco = quantity_per_unit × preço.';

-- ─── Portão validada/publicada ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_block_publish_with_draft_materials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names text;
  v_count int;
BEGIN
  IF NEW.status_ficha IS NOT DISTINCT FROM OLD.status_ficha THEN
    RETURN NEW;
  END IF;

  IF NEW.status_ficha NOT IN ('validada', 'publicada') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status_ficha, 'rascunho') IN ('validada', 'publicada')
     AND NEW.status_ficha IN ('validada', 'publicada') THEN
    RETURN NEW;
  END IF;

  SELECT count(*), string_agg(COALESCE(nullif(btrim(sm.draft_name), ''), nullif(btrim(sm.part_name), ''), 'sem nome'), ', ' ORDER BY sm.created_at)
    INTO v_count, v_names
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = NEW.id
     AND sm.is_active IS TRUE
     AND sm.line_kind = 'material'
     AND sm.product_id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Não é possível % a ficha: % material(is) ainda sem vínculo com o estoque (%). Vincule ou desative/remova as linhas-rascunho na Precificação.',
      CASE WHEN NEW.status_ficha = 'publicada' THEN 'publicar' ELSE 'validar' END,
      v_count,
      COALESCE(v_names, '')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_publish_with_draft_materials ON public.technical_sheets;
CREATE TRIGGER trg_block_publish_with_draft_materials
  BEFORE UPDATE OF status_ficha ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_block_publish_with_draft_materials();

-- ─── Aplicar kit na ficha ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_base_material_kit_to_sheet(p_sheet_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_kit_id uuid;
  v_inserted int := 0;
BEGIN
  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id é obrigatório';
  END IF;

  IF NOT public.is_approved_user() AND NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'Sem permissão para aplicar kit de materiais base';
  END IF;

  SELECT shoe_category INTO v_category
    FROM public.technical_sheets
   WHERE id = p_sheet_id;

  IF v_category IS NULL OR nullif(btrim(v_category), '') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_kit_id
    FROM public.base_material_kits
   WHERE shoe_category = v_category
     AND active IS TRUE
   LIMIT 1;

  IF v_kit_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Não duplica se a ficha já tem linhas vindas de kit
  IF EXISTS (
    SELECT 1 FROM public.sheet_materials
     WHERE sheet_id = p_sheet_id AND from_kit_item_id IS NOT NULL
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.sheet_materials (
    sheet_id,
    product_id,
    group_id,
    quantity_per_unit,
    part_name,
    draft_name,
    line_kind,
    cost_mode,
    cost_per_pair,
    estimated_unit_price,
    is_active,
    include_in_consumption,
    from_kit_item_id,
    consumption_sector,
    color, width, weight, supplier, notes, sizes
  )
  SELECT
    p_sheet_id,
    ki.product_id,
    ki.group_id,
    COALESCE(ki.quantity_per_unit, 1),
    ki.description,
    CASE WHEN ki.product_id IS NULL THEN ki.description ELSE NULL END,
    ki.line_kind,
    ki.cost_mode,
    ki.cost_per_pair,
    CASE
      WHEN ki.product_id IS NULL AND ki.line_kind = 'material'
        THEN COALESCE(ki.estimated_unit_price, ki.cost_per_pair)
      ELSE ki.estimated_unit_price
    END,
    ki.is_active,
    false, -- kit = só precificação
    ki.id,
    '',
    '', '', '', '', '', ''
  FROM public.base_material_kit_items ki
  WHERE ki.kit_id = v_kit_id
  ORDER BY ki.sort_order, ki.created_at;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_base_material_kit_to_sheet(uuid) TO authenticated, service_role;

-- ─── Seed Rasteirinha (CUSTO BASE — RASTEIRA adulto) ────────────────────────

INSERT INTO public.base_material_kits (shoe_category, name, notes)
VALUES (
  'Rasteirinha',
  'Custo base — Rasteira (adulto)',
  'Kit inicial espelhando a planilha CUSTO BASE — RASTEIRA. Linhas com custo R$/par; não debitam estoque.'
)
ON CONFLICT (shoe_category) DO UPDATE
SET name = EXCLUDED.name,
    notes = EXCLUDED.notes,
    updated_at = now();

WITH kit AS (
  SELECT id FROM public.base_material_kits WHERE shoe_category = 'Rasteirinha'
),
seed(sort_order, line_kind, description, product_name, cost_per_pair, is_active) AS (
  VALUES
    (1,  'material', 'Placa fibra',          NULL::text,                  1.07, true),
    (2,  'material', 'Solado',               NULL,                        1.90, true),
    (3,  'material', 'Forracao',             NULL,                        0.72, true),
    (4,  'material', 'EVA',                  'EVA 3MM',                   0.07, true),
    (5,  'material', 'Linha',                'LINHA 60 COR 8003',          0.02, true),
    (6,  'ajuste',   'Item +0,60',           NULL,                        0.60, true),
    (7,  'ajuste',   'Item +0,35',           NULL,                        0.35, true),
    (8,  'material', 'Cola forte',           'COLA FORTE',                0.25, true),
    (9,  'material', 'Hotmel',               'COLA  ADESIVO HOTMELT',     0.10, true)
)
INSERT INTO public.base_material_kit_items (
  kit_id, sort_order, line_kind, description, product_id,
  unit, quantity_per_unit, cost_mode, cost_per_pair,
  estimated_unit_price, is_active
)
SELECT
  kit.id,
  seed.sort_order,
  seed.line_kind,
  seed.description,
  p.id,
  'par',
  1,
  'fixed_per_pair',
  seed.cost_per_pair,
  CASE WHEN p.id IS NULL AND seed.line_kind = 'material' THEN seed.cost_per_pair ELSE NULL END,
  seed.is_active
FROM kit
CROSS JOIN seed
LEFT JOIN LATERAL (
  SELECT id FROM public.products
   WHERE active IS TRUE
     AND seed.product_name IS NOT NULL
     AND name = seed.product_name
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1
) p ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.base_material_kit_items existing
  WHERE existing.kit_id = kit.id
);
