-- =============================================================================
-- PADRÃO: especificações técnicas (ficha de componente) são do MATERIAL/GRUPO
-- =============================================================================
-- Regra de negócio (usuário 2026-05-31): cor é variação visual; as specs técnicas
-- (largura/dimensões/perda/rendimento) são iguais para todas as cores do mesmo
-- grupo. Ao cadastrar uma cor nova, ela deve herdar a ficha de componente das
-- outras cores do grupo — sem o usuário redigitar (e sem ficar sem largura, o que
-- inflava consumo/custeio ~100x).
--
-- Mecanismo (cobre TODOS os caminhos de criação de produto, via banco):
--   • trg_inherit_component_sheet_on_product (products AFTER INSERT): cria a ficha
--     do produto novo copiando as specs de um irmão do grupo, se ainda não houver.
--   • trg_fill_component_sheet_dims_from_group (component_sheets BEFORE INS/UPD):
--     se a largura vier vazia (0/null), herda do grupo — invariante "ficha de área
--     nunca fica sem largura se o grupo tem". Não toca em valores já informados.
--   • Backfill: preenche as fichas dos produtos já existentes em grupos com largura
--     CONSISTENTE (1 valor). Grupos com larguras divergentes ficam de fora (input manual).
-- =============================================================================

-- ─── Trigger 1: cor nova herda a ficha do grupo ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_inherit_component_sheet_on_product()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_model public.component_sheets%ROWTYPE;
BEGIN
  IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.component_sheets WHERE product_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Ficha-modelo: irmão do mesmo grupo com largura preenchida (mais recente).
  SELECT cs.* INTO v_model
    FROM public.component_sheets cs
    JOIN public.products p ON p.id = cs.product_id
   WHERE p.group_id = NEW.group_id
     AND cs.product_id <> NEW.id
     AND cs.dimensions_width > 0
   ORDER BY cs.updated_at DESC
   LIMIT 1;

  IF v_model.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.component_sheets (
    product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
    dimensions_unit, waste_pct, yield_per_size, yield_per_sole, default_sole_group_id, notes
  ) VALUES (
    NEW.id, NEW.group_id, v_model.dimensions_length, v_model.dimensions_width, v_model.dimensions_thickness,
    v_model.dimensions_unit, v_model.waste_pct, v_model.yield_per_size, v_model.yield_per_sole,
    v_model.default_sole_group_id, v_model.notes
  )
  ON CONFLICT (product_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inherit_component_sheet_on_product ON public.products;
CREATE TRIGGER trg_inherit_component_sheet_on_product
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_inherit_component_sheet_on_product();


-- ─── Trigger 2: ficha gravada sem largura herda do grupo (invariante) ───────
CREATE OR REPLACE FUNCTION public.tg_fill_component_sheet_dims_from_group()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_group_id uuid;
  v_model    public.component_sheets%ROWTYPE;
BEGIN
  -- Só age quando a largura está vazia — nunca sobrescreve valor informado.
  IF NEW.dimensions_width IS NOT NULL AND NEW.dimensions_width > 0 THEN
    RETURN NEW;
  END IF;

  v_group_id := COALESCE(NEW.group_id, (SELECT group_id FROM public.products WHERE id = NEW.product_id));
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT cs.* INTO v_model
    FROM public.component_sheets cs
    JOIN public.products p ON p.id = cs.product_id
   WHERE p.group_id = v_group_id
     AND cs.product_id IS DISTINCT FROM NEW.product_id
     AND cs.dimensions_width > 0
   ORDER BY cs.updated_at DESC
   LIMIT 1;

  IF v_model.dimensions_width IS NULL THEN RETURN NEW; END IF;

  NEW.dimensions_width := v_model.dimensions_width;
  IF COALESCE(NEW.dimensions_length, 0) = 0    THEN NEW.dimensions_length := v_model.dimensions_length; END IF;
  IF COALESCE(NEW.dimensions_thickness, 0) = 0 THEN NEW.dimensions_thickness := v_model.dimensions_thickness; END IF;
  IF NEW.dimensions_unit IS NULL OR NEW.dimensions_unit = '' THEN NEW.dimensions_unit := v_model.dimensions_unit; END IF;
  IF COALESCE(NEW.waste_pct, 0) = 0            THEN NEW.waste_pct := v_model.waste_pct; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_component_sheet_dims_from_group ON public.component_sheets;
CREATE TRIGGER trg_fill_component_sheet_dims_from_group
  BEFORE INSERT OR UPDATE ON public.component_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tg_fill_component_sheet_dims_from_group();


-- ─── Backfill: produtos já existentes em grupos com largura CONSISTENTE ─────
DO $$
DECLARE v_inseridas int; v_atualizadas int;
BEGIN
  -- (a) Produtos SEM ficha → cria herdando do irmão (grupo consistente)
  WITH grupos_consistentes AS (
    SELECT p.group_id
    FROM public.component_sheets cs JOIN public.products p ON p.id = cs.product_id
    WHERE cs.dimensions_width > 0
    GROUP BY p.group_id
    HAVING count(DISTINCT cs.dimensions_width) = 1
  ),
  ins AS (
    INSERT INTO public.component_sheets (
      product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
      dimensions_unit, waste_pct, yield_per_size, yield_per_sole, default_sole_group_id, notes
    )
    SELECT p.id, p.group_id, m.dimensions_length, m.dimensions_width, m.dimensions_thickness,
           m.dimensions_unit, m.waste_pct, m.yield_per_size, m.yield_per_sole, m.default_sole_group_id, m.notes
    FROM public.products p
    JOIN grupos_consistentes gc ON gc.group_id = p.group_id
    JOIN LATERAL (
      SELECT cs.* FROM public.component_sheets cs JOIN public.products p2 ON p2.id = cs.product_id
      WHERE p2.group_id = p.group_id AND cs.dimensions_width > 0
      ORDER BY cs.updated_at DESC LIMIT 1
    ) m ON true
    WHERE p.active AND p.group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.component_sheets cs3 WHERE cs3.product_id = p.id)
    ON CONFLICT (product_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inseridas FROM ins;

  -- (b) Fichas existentes SEM largura → preenche a do grupo consistente
  WITH grupos_consistentes AS (
    SELECT p.group_id, max(cs.dimensions_width) AS w, (array_agg(cs.dimensions_unit ORDER BY cs.updated_at DESC))[1] AS u
    FROM public.component_sheets cs JOIN public.products p ON p.id = cs.product_id
    WHERE cs.dimensions_width > 0
    GROUP BY p.group_id
    HAVING count(DISTINCT cs.dimensions_width) = 1
  ),
  upd AS (
    UPDATE public.component_sheets cs
       SET dimensions_width = gc.w,
           dimensions_unit  = COALESCE(NULLIF(cs.dimensions_unit, ''), gc.u),
           updated_at = now()
      FROM public.products p
      JOIN grupos_consistentes gc ON gc.group_id = p.group_id
     WHERE cs.product_id = p.id
       AND (cs.dimensions_width IS NULL OR cs.dimensions_width = 0)
    RETURNING 1
  )
  SELECT count(*) INTO v_atualizadas FROM upd;

  RAISE NOTICE 'Backfill ficha de componente: % criadas, % preenchidas.', v_inseridas, v_atualizadas;
END;
$$;
