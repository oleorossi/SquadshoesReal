-- ============================================================================
-- NCM auto-fill na ficha técnica baseado no solado
-- ============================================================================
-- Regra de negócio (usuário): "O NCM do produto é definido principalmente pelo
-- solado. Quando eu seleciono o solado em uma ficha técnica, deve puxar o NCM
-- da última referência cadastrada daquele solado. Aplicar nas fichas técnicas
-- existentes os NCM baseados no tipo."
--
-- Esta migration entrega:
--   1. `get_ncm_from_last_sheet_for_sole(...)` — busca o NCM mais recente já
--      registrado para um solado, com cascata de prioridades:
--        P1: mesmo solado-produto (primary_sole_id) + mesma shoe_category
--        P2: mesmo solado-produto (qualquer categoria)
--        P3: mesmo grupo de solado (sole_group_id) + mesma shoe_category
--        P4: mesmo grupo de solado (qualquer categoria)
--      Aceita `p_exclude_id` pra não auto-referenciar (essencial em backfill
--      onde a própria linha já tem NCM e seria escolhida de volta).
--   2. `suggest_ncm_for_sheet(...)` — RPC pública pro frontend; combina a
--      função acima com fallback canônico por categoria (Sandália → 64022000,
--      Infantil → 64041100, Rasteirinha → 64041900) derivado dos NCMs já
--      consistentes no banco.
--   3. Trigger `tg_autofill_ncm_from_sole` BEFORE INSERT/UPDATE em
--      `technical_sheets` que aplica a sugestão quando o NCM está vazio/inválido.
--   4. Backfill das fichas existentes sem NCM (4 Rasteirinha sem NCM ganham
--      64041900, mesmo padrão das outras Rasteirinha do mesmo solado).
-- ============================================================================

-- 1. helper de lookup
CREATE OR REPLACE FUNCTION public.get_ncm_from_last_sheet_for_sole(
  p_sole_group_id uuid,
  p_primary_sole_id uuid DEFAULT NULL,
  p_shoe_category text DEFAULT NULL,
  p_exclude_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ncm text;
  v_cat text := LOWER(TRIM(COALESCE(p_shoe_category, '')));
BEGIN
  -- P1: mesmo solado-produto + mesma categoria
  IF p_primary_sole_id IS NOT NULL AND v_cat <> '' THEN
    SELECT ts.ncm INTO v_ncm
    FROM public.technical_sheets ts
    WHERE ts.primary_sole_id = p_primary_sole_id
      AND LOWER(TRIM(ts.shoe_category)) = v_cat
      AND ts.ncm ~ '^\d{8}$'
      AND (p_exclude_id IS NULL OR ts.id <> p_exclude_id)
    ORDER BY ts.created_at DESC LIMIT 1;
    IF v_ncm IS NOT NULL THEN RETURN v_ncm; END IF;
  END IF;

  -- P2: mesmo solado-produto (qualquer categoria)
  IF p_primary_sole_id IS NOT NULL THEN
    SELECT ts.ncm INTO v_ncm
    FROM public.technical_sheets ts
    WHERE ts.primary_sole_id = p_primary_sole_id
      AND ts.ncm ~ '^\d{8}$'
      AND (p_exclude_id IS NULL OR ts.id <> p_exclude_id)
    ORDER BY ts.created_at DESC LIMIT 1;
    IF v_ncm IS NOT NULL THEN RETURN v_ncm; END IF;
  END IF;

  -- P3: mesmo grupo de solado + mesma categoria
  IF p_sole_group_id IS NOT NULL AND v_cat <> '' THEN
    SELECT ts.ncm INTO v_ncm
    FROM public.technical_sheets ts
    WHERE ts.sole_group_id = p_sole_group_id
      AND LOWER(TRIM(ts.shoe_category)) = v_cat
      AND ts.ncm ~ '^\d{8}$'
      AND (p_exclude_id IS NULL OR ts.id <> p_exclude_id)
    ORDER BY ts.created_at DESC LIMIT 1;
    IF v_ncm IS NOT NULL THEN RETURN v_ncm; END IF;
  END IF;

  -- P4: mesmo grupo de solado (qualquer categoria)
  IF p_sole_group_id IS NOT NULL THEN
    SELECT ts.ncm INTO v_ncm
    FROM public.technical_sheets ts
    WHERE ts.sole_group_id = p_sole_group_id
      AND ts.ncm ~ '^\d{8}$'
      AND (p_exclude_id IS NULL OR ts.id <> p_exclude_id)
    ORDER BY ts.created_at DESC LIMIT 1;
    IF v_ncm IS NOT NULL THEN RETURN v_ncm; END IF;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ncm_from_last_sheet_for_sole(uuid, uuid, text, uuid) TO authenticated, service_role;

-- 2. RPC público
CREATE OR REPLACE FUNCTION public.suggest_ncm_for_sheet(
  p_sole_group_id uuid DEFAULT NULL,
  p_primary_sole_id uuid DEFAULT NULL,
  p_shoe_category text DEFAULT NULL,
  p_exclude_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ncm text;
  v_cat text := LOWER(TRIM(COALESCE(p_shoe_category, '')));
BEGIN
  v_ncm := public.get_ncm_from_last_sheet_for_sole(p_sole_group_id, p_primary_sole_id, p_shoe_category, p_exclude_id);
  IF v_ncm IS NOT NULL THEN RETURN v_ncm; END IF;

  IF v_cat IN ('sandália', 'sandalia') THEN RETURN '64022000'; END IF;
  IF v_cat = 'infantil' THEN RETURN '64041100'; END IF;
  IF v_cat = 'rasteirinha' THEN RETURN '64041900'; END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_ncm_for_sheet(uuid, uuid, text, uuid) TO authenticated, service_role;

-- 3. Trigger BEFORE INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.tg_autofill_ncm_from_sole()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_suggested text;
BEGIN
  IF (NEW.ncm IS NULL OR NEW.ncm = '' OR NOT (NEW.ncm ~ '^\d{8}$'))
     AND (NEW.sole_group_id IS NOT NULL
          OR NEW.primary_sole_id IS NOT NULL
          OR NEW.shoe_category IS NOT NULL) THEN
    v_suggested := public.suggest_ncm_for_sheet(
      NEW.sole_group_id, NEW.primary_sole_id, NEW.shoe_category, NEW.id
    );
    IF v_suggested IS NOT NULL THEN
      NEW.ncm := v_suggested;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_autofill_ncm_from_sole ON public.technical_sheets;
CREATE TRIGGER tg_autofill_ncm_from_sole
  BEFORE INSERT OR UPDATE OF sole_group_id, primary_sole_id, shoe_category, ncm
  ON public.technical_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_autofill_ncm_from_sole();

-- 4. Backfill: aplica NCM nas fichas existentes sem NCM válido
UPDATE public.technical_sheets ts
SET ncm = public.suggest_ncm_for_sheet(ts.sole_group_id, ts.primary_sole_id, ts.shoe_category, ts.id)
WHERE (ts.ncm IS NULL OR ts.ncm = '' OR NOT (ts.ncm ~ '^\d{8}$'))
  AND public.suggest_ncm_for_sheet(ts.sole_group_id, ts.primary_sole_id, ts.shoe_category, ts.id) IS NOT NULL;
