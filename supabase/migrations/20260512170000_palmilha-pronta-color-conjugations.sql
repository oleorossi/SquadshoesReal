-- =============================================================================
-- 20260512170000 — Coligações de cor pra solados palmilha-pronta
-- =============================================================================
-- Solados "palmilha pronta" vêm com a palmilha já fixada na sola, então a cor
-- da palmilha é VISÍVEL no produto final. Hoje só temos 2 cores de palmilha
-- pronta em estoque (Preto e Caramelo), e a regra de uso é:
--   - Cabedal Preto      → Palmilha Preta
--   - Cabedal demais cor → Palmilha Caramelo (catch-all)
--
-- Schema antigo: solado 238 tinha 1 row sem cor → débito caía sempre num
-- estoque genérico que não refletia a realidade física (estoque é separado
-- por cor da palmilha).
--
-- Mudanças:
-- 1) Nova tabela sole_color_conjugations (sole_group_id, cabedal_color,
--    palmilha_color) — regra GLOBAL por grupo de solado (não por ficha).
-- 2) Backfill solado 238: rename row existente pra Caramelo (default),
--    cria variante Preto com estoque vazio.
-- 3) Seed regras pro grupo do 238.
-- 4) Atualiza debit_sole_stock_by_grade: quando solado-alvo é palmilha-pronta,
--    aplica regra de coligação ANTES de fazer o match em products.color.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sole_color_conjugations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sole_group_id uuid NOT NULL REFERENCES public.product_groups(id) ON DELETE CASCADE,
  cabedal_color text NOT NULL,
  palmilha_color text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sole_group_id, cabedal_color)
);

-- Apenas UMA regra default (catch-all) por grupo
CREATE UNIQUE INDEX IF NOT EXISTS idx_sole_color_conjugations_one_default
  ON public.sole_color_conjugations(sole_group_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_sole_color_conjugations_group_active
  ON public.sole_color_conjugations(sole_group_id, active);

ALTER TABLE public.sole_color_conjugations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users can view sole color conjugations" ON public.sole_color_conjugations;
CREATE POLICY "Approved users can view sole color conjugations"
  ON public.sole_color_conjugations FOR SELECT
  USING (is_approved_user());

DROP POLICY IF EXISTS "Approved users can manage sole color conjugations" ON public.sole_color_conjugations;
CREATE POLICY "Approved users can manage sole color conjugations"
  ON public.sole_color_conjugations FOR ALL
  USING (is_approved_user())
  WITH CHECK (is_approved_user());

-- ─── Backfill solado 238 (grupo e5e101bb-…) ──────────────────────────────────
DO $$
DECLARE
  v_group_id uuid := 'e5e101bb-e6af-4c9a-92c7-1bbaf3be71b7';
  v_existing_id uuid := 'ed44dd78-46b0-4a68-9d80-03d75f4b4ba7';
  v_existing RECORD;
  v_empty_grade jsonb;
  v_size_from int;
  v_size_to int;
  v_i int;
  v_new_id uuid;
BEGIN
  -- Garante que o solado existe e ainda não foi backfillado
  SELECT p.id, p.name, p.color, p.sku, p.category, p.sole_classification,
         p.group_id, p.stock_grade, p.unit, p.min_stock
    INTO v_existing
    FROM public.products p
   WHERE p.id = v_existing_id;

  IF v_existing.id IS NULL THEN
    RAISE NOTICE 'Solado 238 (id=%) não encontrado — skip backfill', v_existing_id;
  ELSE
    -- Constrói grade vazia respeitando o range de numeração existente
    v_size_from := COALESCE((v_existing.stock_grade->>'_size_from')::int, 35);
    v_size_to   := COALESCE((v_existing.stock_grade->>'_size_to')::int, 38);
    v_empty_grade := jsonb_build_object(
      '_size_from', v_size_from,
      '_size_to',   v_size_to
    );
    FOR v_i IN v_size_from..v_size_to LOOP
      v_empty_grade := jsonb_set(v_empty_grade, ARRAY[v_i::text], to_jsonb(0));
    END LOOP;

    -- Renomeia row existente pra Caramelo (assume estoque atual é catch-all)
    -- Só atualiza se ainda estiver sem cor (idempotente)
    UPDATE public.products
       SET color = 'Caramelo',
           updated_at = now()
     WHERE id = v_existing_id
       AND (color IS NULL OR TRIM(color) = '');

    -- Cria variante Preto com estoque zero (se ainda não existir)
    IF NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE group_id = v_group_id
         AND UPPER(TRIM(COALESCE(color,''))) = 'PRETO'
         AND active = true
    ) THEN
      INSERT INTO public.products (
        name, color, sku, category, sole_classification,
        group_id, stock_grade, quantity, unit, active, min_stock,
        created_at, updated_at
      ) VALUES (
        v_existing.name,
        'Preto',
        COALESCE(NULLIF(TRIM(v_existing.sku), ''), '238') || '-P',
        v_existing.category,
        v_existing.sole_classification,
        v_group_id,
        v_empty_grade,
        0,
        v_existing.unit,
        true,
        COALESCE(v_existing.min_stock, 0),
        now(),
        now()
      )
      RETURNING id INTO v_new_id;

      RAISE NOTICE 'Solado 238: variante Preto criada (id=%) com estoque zero', v_new_id;
    ELSE
      RAISE NOTICE 'Solado 238: variante Preto já existe — skip';
    END IF;
  END IF;

  -- Seed regras de coligação pro grupo
  INSERT INTO public.sole_color_conjugations
    (sole_group_id, cabedal_color, palmilha_color, is_default)
  VALUES
    (v_group_id, 'Preto', 'Preto', false),
    (v_group_id, '*',     'Caramelo', true)
  ON CONFLICT (sole_group_id, cabedal_color) DO NOTHING;
END $$;

-- ─── debit_sole_stock_by_grade: aplica coligação se palmilha-pronta ──────────
CREATE OR REPLACE FUNCTION public.debit_sole_stock_by_grade(
  p_reference_id uuid,
  p_order_id uuid,
  p_color text,
  p_order_grade jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sole_group_id          uuid;
  v_sole_material          text;
  v_mapped_sole_product_id uuid;
  v_mapped_sole_group_id   uuid;
  target_product_id        uuid;
  target_name              text;
  v_stock_grade            jsonb;
  v_size                   text;
  v_size_qty               numeric;
  v_available              numeric;
  v_new_grade              jsonb;
  v_total_debited          numeric := 0;
  v_prev_total             numeric;
  v_product_group_id       uuid;
  v_effective_grade        jsonb;
  v_conj_key               text;
  v_existing_qty           numeric;
  v_has_conjugations       boolean;
  v_is_palmilha_pronta     boolean := false;
  v_effective_color        text;
  v_palmilha_color         text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT ts.sole_group_id, ts.sole_material
    INTO v_sole_group_id, v_sole_material
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF (v_sole_group_id IS NULL AND (v_sole_material IS NULL OR v_sole_material = '')) THEN
    RETURN;
  END IF;

  IF p_order_grade IS NULL OR jsonb_typeof(p_order_grade) <> 'object' THEN
    RETURN;
  END IF;

  -- 1) Override por ficha técnica (technical_sheet_sole_colors) — vence tudo
  SELECT tsc.sole_product_id, tsc.sole_group_id
    INTO v_mapped_sole_product_id, v_mapped_sole_group_id
    FROM public.technical_sheet_sole_colors tsc
   WHERE tsc.sheet_id = p_reference_id
     AND UPPER(TRIM(tsc.product_color)) = UPPER(TRIM(COALESCE(p_color, '')))
   LIMIT 1;

  target_product_id := NULL;
  v_effective_color := COALESCE(p_color, '');

  IF v_mapped_sole_product_id IS NOT NULL THEN
    SELECT p.id, p.name, p.stock_grade
      INTO target_product_id, target_name, v_stock_grade
      FROM public.products p
     WHERE p.active = true AND p.id = v_mapped_sole_product_id
     LIMIT 1
     FOR UPDATE;
  END IF;

  -- 2) Lookup por sole_group da ficha
  IF target_product_id IS NULL AND v_mapped_sole_group_id IS NOT NULL THEN
    -- 2a) Aplica regra de coligação se grupo é palmilha-pronta
    SELECT EXISTS (
      SELECT 1 FROM public.products
       WHERE group_id = v_mapped_sole_group_id
         AND sole_classification = 'palmilha_pronta'
         AND active = true
    ) INTO v_is_palmilha_pronta;

    IF v_is_palmilha_pronta THEN
      SELECT palmilha_color INTO v_palmilha_color
        FROM public.sole_color_conjugations
       WHERE sole_group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(cabedal_color)) = UPPER(TRIM(COALESCE(p_color, '')))
         AND active = true
       LIMIT 1;
      IF v_palmilha_color IS NULL THEN
        SELECT palmilha_color INTO v_palmilha_color
          FROM public.sole_color_conjugations
         WHERE sole_group_id = v_mapped_sole_group_id
           AND is_default = true
           AND active = true
         LIMIT 1;
      END IF;
      IF v_palmilha_color IS NOT NULL THEN
        v_effective_color := v_palmilha_color;
      END IF;
    END IF;

    IF v_effective_color IS NOT NULL AND v_effective_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_mapped_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  -- 3) Lookup por sole_group_id da ficha (caminho principal sem mapping override)
  IF target_product_id IS NULL AND v_sole_group_id IS NOT NULL THEN
    -- Reaplica regra de coligação se este grupo é palmilha-pronta
    v_is_palmilha_pronta := false;
    SELECT EXISTS (
      SELECT 1 FROM public.products
       WHERE group_id = v_sole_group_id
         AND sole_classification = 'palmilha_pronta'
         AND active = true
    ) INTO v_is_palmilha_pronta;

    IF v_is_palmilha_pronta THEN
      v_palmilha_color := NULL;
      SELECT palmilha_color INTO v_palmilha_color
        FROM public.sole_color_conjugations
       WHERE sole_group_id = v_sole_group_id
         AND UPPER(TRIM(cabedal_color)) = UPPER(TRIM(COALESCE(p_color, '')))
         AND active = true
       LIMIT 1;
      IF v_palmilha_color IS NULL THEN
        SELECT palmilha_color INTO v_palmilha_color
          FROM public.sole_color_conjugations
         WHERE sole_group_id = v_sole_group_id
           AND is_default = true
           AND active = true
         LIMIT 1;
      END IF;
      IF v_palmilha_color IS NOT NULL THEN
        v_effective_color := v_palmilha_color;
      END IF;
    ELSE
      v_effective_color := COALESCE(p_color, '');
    END IF;

    IF v_effective_color IS NOT NULL AND v_effective_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(v_effective_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_sole_group_id
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  -- 4) Fallback: lookup por nome do material (legacy)
  IF target_product_id IS NULL AND v_sole_material IS NOT NULL AND v_sole_material <> '' THEN
    IF p_color IS NOT NULL AND p_color <> '' THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
         AND UPPER(TRIM(COALESCE(p.color, ''))) = UPPER(TRIM(p_color))
       LIMIT 1
       FOR UPDATE;
    END IF;
    IF target_product_id IS NULL THEN
      SELECT p.id, p.name, p.stock_grade
        INTO target_product_id, target_name, v_stock_grade
        FROM public.products p
        JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE p.active = true AND pg.name = v_sole_material
       ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id
       LIMIT 1
       FOR UPDATE;
    END IF;
  END IF;

  IF target_product_id IS NULL THEN RETURN; END IF;

  IF v_stock_grade IS NULL THEN v_stock_grade := '{}'::jsonb; END IF;

  SELECT p.group_id INTO v_product_group_id
    FROM public.products p WHERE p.id = target_product_id;

  SELECT EXISTS (
    SELECT 1 FROM sole_size_conjugations WHERE sole_group_id = v_product_group_id
  ) INTO v_has_conjugations;

  v_effective_grade := '{}'::jsonb;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric
      FROM jsonb_each_text(p_order_grade)
     WHERE value::numeric > 0
       AND left(key, 1) <> '_'
  LOOP
    IF v_size LIKE '%/%' THEN
      v_conj_key := v_size;
    ELSIF v_has_conjugations AND v_product_group_id IS NOT NULL THEN
      SELECT get_sole_size_key(v_product_group_id, v_size::integer) INTO v_conj_key;
      IF v_conj_key IS NULL THEN v_conj_key := v_size; END IF;
    ELSE
      v_conj_key := v_size;
    END IF;

    v_existing_qty := COALESCE((v_effective_grade ->> v_conj_key)::numeric, 0);
    v_effective_grade := jsonb_set(
      v_effective_grade, ARRAY[v_conj_key], to_jsonb(v_existing_qty + v_size_qty)
    );
  END LOOP;

  v_prev_total := 0;
  FOR v_size IN
    SELECT k FROM jsonb_object_keys(v_stock_grade) AS k
     WHERE left(k, 1) <> '_'
  LOOP
    v_prev_total := v_prev_total + COALESCE((v_stock_grade ->> v_size)::numeric, 0);
  END LOOP;

  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    IF v_available < v_size_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para Solado "%" tamanho %: disponível %, necessário %',
        target_name, v_size, v_available, v_size_qty;
    END IF;
  END LOOP;

  v_new_grade := v_stock_grade;
  FOR v_size, v_size_qty IN
    SELECT key, value::numeric FROM jsonb_each_text(v_effective_grade) WHERE value::numeric > 0
  LOOP
    v_available := COALESCE((v_stock_grade ->> v_size)::numeric, 0);
    v_new_grade := jsonb_set(v_new_grade, ARRAY[v_size], to_jsonb(v_available - v_size_qty));
    v_total_debited := v_total_debited + v_size_qty;
  END LOOP;

  IF v_total_debited > 0 THEN
    UPDATE public.products
       SET stock_grade = v_new_grade,
           quantity    = GREATEST(0, quantity - v_total_debited),
           updated_at  = now()
     WHERE id = target_product_id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      target_product_id,
      'out',
      v_total_debited,
      v_prev_total,
      v_prev_total - v_total_debited,
      'Débito Solado por grade (' || target_name || ')' ||
        CASE WHEN COALESCE(p_color, '') <> '' THEN ' Cabedal: ' || p_color ELSE '' END ||
        CASE WHEN v_is_palmilha_pronta AND v_palmilha_color IS NOT NULL
             THEN ' → Palmilha: ' || v_palmilha_color
             ELSE ''
        END,
      p_order_id
    );

    UPDATE public.material_reservations
       SET status            = 'consumed',
           quantity_consumed = COALESCE(quantity_reserved, 0),
           updated_at        = now()
     WHERE order_id   = p_order_id
       AND product_id = target_product_id
       AND status     = 'reserved';
  END IF;
END;
$function$;
