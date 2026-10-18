-- Continuação de 20270101043300 (carimbo MCP alinhado).
CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  DECLARE
    v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
    v_prod_unit text; v_group_id uuid; v_is_linear boolean;
    v_has_cs boolean; v_is_area boolean;
    v_w_mm numeric; v_l_mm numeric; v_plate_dm2 numeric;
    c_roll_width_floor_mm CONSTANT numeric := 400;
  BEGIN
    SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
    SELECT dimensions_width, dimensions_length, dimensions_unit
      INTO v_width, v_length, v_dim_unit
      FROM public.component_sheets cs WHERE cs.product_id = p_product_id
      ORDER BY cs.updated_at DESC NULLS LAST LIMIT 1;
    -- Cascata: sheet do produto → sheet do grupo (com L e A quando possível).
    IF COALESCE(NULLIF(v_width, 0), 0) <= 0 AND COALESCE(NULLIF(v_length, 0), 0) <= 0 THEN
      SELECT cs.dimensions_width, cs.dimensions_length, cs.dimensions_unit
        INTO v_width, v_length, v_dim_unit
        FROM public.component_sheets cs
        WHERE cs.group_id = v_group_id
          AND (COALESCE(NULLIF(cs.dimensions_width, 0), 0) > 0
               OR COALESCE(NULLIF(cs.dimensions_length, 0), 0) > 0)
        ORDER BY
          (COALESCE(cs.dimensions_width, 0) > 0 AND COALESCE(cs.dimensions_length, 0) > 0) DESC,
          (COALESCE(cs.dimensions_width, 0) > 0) DESC,
          cs.updated_at DESC NULLS LAST, cs.id
        LIMIT 1;
    END IF;

    v_prod_unit := LOWER(trim(COALESCE(v_prod_unit, '')));
    v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm','m linear');
    v_dim := COALESCE(NULLIF(v_width, 0), NULLIF(v_length, 0), 0);

    IF v_is_linear THEN
      IF v_dim IS NOT NULL AND v_dim > 0 THEN
        IF LOWER(COALESCE(v_dim_unit, 'mm')) = 'cm' THEN v_dim := v_dim * 10;
        ELSIF LOWER(COALESCE(v_dim_unit, 'mm')) = 'dm' THEN v_dim := v_dim * 100;
        ELSIF LOWER(COALESCE(v_dim_unit, 'mm')) = 'm' THEN v_dim := v_dim * 1000; END IF;

        IF v_dim < c_roll_width_floor_mm THEN
          dm2_per_unit := 1;
          conversion_warning := NULL;
        ELSE
          dm2_per_unit := v_dim / 10;
          IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
          conversion_warning := NULL;
        END IF;
      ELSE
        dm2_per_unit := 1;
        SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                       WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id) INTO v_has_cs;
        SELECT EXISTS (
          SELECT 1 FROM public.product_groups pg
           WHERE pg.id = v_group_id
             AND (pg.sector IN ('Cabedal', 'Palmilha', 'Forração da Palmilha')
                  OR EXISTS (SELECT 1 FROM public.technical_sheets ts
                              WHERE UPPER(TRIM(ts.upper_material))  = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.lining_material)) = UPPER(TRIM(pg.name))
                                 OR UPPER(TRIM(ts.insole_material)) = UPPER(TRIM(pg.name))))
        ) INTO v_is_area;
        IF v_has_cs OR v_is_area THEN
          conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
            'Resultado pode estar 100x errado. Configure largura no grupo de estoque.';
        ELSE
          conversion_warning := NULL;
        END IF;
      END IF;
      target_unit := v_prod_unit;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Estoque de ÁREA / placa
    IF v_prod_unit IN ('placa', 'placas') THEN
      v_w_mm := COALESCE(v_width, 0);
      v_l_mm := COALESCE(v_length, 0);
      IF LOWER(COALESCE(v_dim_unit, 'mm')) = 'cm' THEN
        v_w_mm := v_w_mm * 10; v_l_mm := v_l_mm * 10;
      ELSIF LOWER(COALESCE(v_dim_unit, 'mm')) = 'dm' THEN
        v_w_mm := v_w_mm * 100; v_l_mm := v_l_mm * 100;
      ELSIF LOWER(COALESCE(v_dim_unit, 'mm')) = 'm' THEN
        v_w_mm := v_w_mm * 1000; v_l_mm := v_l_mm * 1000;
      END IF;
      IF v_w_mm > 0 AND v_l_mm > 0 THEN
        v_plate_dm2 := (v_w_mm * v_l_mm) / 10000.0;
        dm2_per_unit := v_plate_dm2;
        conversion_warning := NULL;
      ELSE
        dm2_per_unit := 1;
        conversion_warning := 'Estoque em placa sem largura×comprimento na ficha. Configure no grupo de estoque.';
      END IF;
      target_unit := 'placa';
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_prod_unit IN ('m²', 'm2') THEN
      dm2_per_unit := 100;
      target_unit := 'm²';
      conversion_warning := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    IF v_prod_unit IN ('cm²', 'cm2') THEN
      dm2_per_unit := 0.01;
      target_unit := 'cm²';
      conversion_warning := NULL;
      RETURN NEXT;
      RETURN;
    END IF;

    -- dm² / demais: identidade (estoque já em área)
    dm2_per_unit := 1;
    target_unit := CASE WHEN v_prod_unit IN ('dm2', 'dm²') THEN 'dm²' ELSE v_prod_unit END;
    conversion_warning := NULL;
    RETURN NEXT;
  END;
$function$;

COMMENT ON FUNCTION public.get_material_conversion_info(uuid) IS
  'Fator dm²→estoque. Linear: bobina>=400mm converte; fita <400 =1. '
  'placa: área W×L dm²; m²=100; cm²=0.01; dm²=1. Espelha areaGeometry.ts / materialConsumption.';

-- ── 4) Gate duro: unit de área sem geometria na ficha do grupo ────────────────
-- Após backfill PL01, gaps ativos devem ser 0. UPDATE/INSERT de products.unit
-- em área exige sheet (produto ou grupo) com L×A e dimensions_unit.

CREATE OR REPLACE FUNCTION public.tg_require_area_geometry_for_area_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_unit text := lower(trim(COALESCE(NEW.unit, '')));
  v_w numeric;
  v_l numeric;
  v_u text;
BEGIN
  IF v_unit NOT IN ('m²','m2','dm²','dm2','cm²','cm2','placa','placas') THEN
    RETURN NEW;
  END IF;

  -- service_role (migrations/worker) pode passar; UI autenticada não.
  IF public.is_service_role_request_128() THEN
    RETURN NEW;
  END IF;

  IF NEW.group_id IS NULL THEN
    RAISE EXCEPTION 'Unidade "%" exige grupo de estoque com largura × comprimento. Crie/vincule o grupo antes de salvar.',
      NEW.unit;
  END IF;

  SELECT cs.dimensions_width, cs.dimensions_length, cs.dimensions_unit
    INTO v_w, v_l, v_u
    FROM public.component_sheets cs
   WHERE cs.product_id = NEW.id
      OR cs.group_id = NEW.group_id
   ORDER BY (cs.product_id = NEW.id) DESC,
            (COALESCE(cs.dimensions_width,0) > 0 AND COALESCE(cs.dimensions_length,0) > 0) DESC,
            cs.updated_at DESC NULLS LAST
   LIMIT 1;

  IF COALESCE(v_w, 0) <= 0 OR COALESCE(v_l, 0) <= 0
     OR COALESCE(nullif(trim(v_u), ''), '') = '' THEN
    -- Fallback: dims do próprio grupo (antes da sync da ficha).
    SELECT g.dimensions_width, g.dimensions_length, g.dimensions_unit
      INTO v_w, v_l, v_u
      FROM public.product_groups g
     WHERE g.id = NEW.group_id;
  END IF;

  IF COALESCE(v_w, 0) <= 0 OR COALESCE(v_l, 0) <= 0
     OR COALESCE(nullif(trim(v_u), ''), '') = '' THEN
    RAISE EXCEPTION
      'Unidade "%" exige largura × comprimento e unidade dimensional no grupo de estoque (porta única de geometria).',
      NEW.unit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_area_geometry_for_area_unit ON public.products;
CREATE TRIGGER trg_require_area_geometry_for_area_unit
  BEFORE INSERT OR UPDATE OF unit, group_id
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_area_geometry_for_area_unit();

-- Gate no RPC de dimensões do grupo: se algum SKU ativo do grupo é área, L×A obrigatório.
CREATE OR REPLACE FUNCTION public.tg_group_dims_require_length_for_area_skus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_has_area boolean;
BEGIN
  IF public.is_service_role_request_128() THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.group_id = NEW.id AND p.active
       AND lower(trim(p.unit)) IN ('m²','m2','dm²','dm2','cm²','cm2','placa','placas')
  ) INTO v_has_area;

  IF v_has_area THEN
    IF COALESCE(NEW.dimensions_width, 0) <= 0
       OR COALESCE(NEW.dimensions_length, 0) <= 0
       OR COALESCE(nullif(trim(NEW.dimensions_unit), ''), '') = '' THEN
      RAISE EXCEPTION
        'Grupo com SKU em unidade de área exige largura, comprimento e unidade dimensional.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_group_dims_require_length_for_area_skus ON public.product_groups;
CREATE TRIGGER trg_group_dims_require_length_for_area_skus
  BEFORE UPDATE OF dimensions_width, dimensions_length, dimensions_unit
  ON public.product_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_group_dims_require_length_for_area_skus();
