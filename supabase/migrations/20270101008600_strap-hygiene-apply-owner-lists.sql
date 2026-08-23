-- Fase 2 e 3 do cadastro de tiras, lista fechada confirmada pelo dono
-- (Leonardo, 23/08/2026): "Aprovado, prosseguir".
--
-- F2b: apaga ficha de componente com largura de napa (>= 200 mm) nos grupos
--      de tira acabada da lista — Overlock 5 mm e qualquer irmão da lista que
--      tenha herdado 1370×1000. Nao normaliza para 5 mm.
-- F2a: espelha 1370 mm em products.dimensions_width das quatro napas cuja
--      ficha ja tem 1370. Sem GREATEST. Palmilha e Dublagem ficam de fora.
-- F3:  marca is_artisanal_strap nos grupos confirmados, DEPOIS de F2b, para
--      o trigger da 08500 aceitar. Overlock sai da elegibilidade de napa-base
--      e passa a governar compra/ajuste dos SKUs lineares.
--
-- TRANÇA so entra se o diagnostico de higiene a listaria por UUID (identity
-- de linha finished_product_group ou variante), nunca so pelo nome.
--
-- Identidade operacional continua por UUID. Os nomes abaixo sao a allowlist
-- nominada pelo dono nesta sessao, nao um resolvedor permanente. Nao reescreve
-- PV, nao inventa rendimento/SKU/preco, nao devolve GREATEST.

BEGIN;

-- Heranca de ficha de componente nao pode recriar geometria de napa em grupo
-- ja marcado como tira acabada. A 06100 nao olhava a flag.
CREATE OR REPLACE FUNCTION public.tg_inherit_component_sheet_on_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_model public.component_sheets%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
  v_length numeric;
  v_width numeric;
  v_thickness numeric;
  v_unit text;
BEGIN
  IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.component_sheets WHERE product_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group
    FROM public.product_groups
   WHERE id = NEW.group_id;

  IF coalesce(v_group.is_artisanal_strap, false) THEN
    RETURN NEW;
  END IF;

  SELECT cs.* INTO v_model
    FROM public.component_sheets cs
    JOIN public.products sibling ON sibling.id = cs.product_id
   WHERE sibling.group_id = NEW.group_id
     AND cs.product_id <> NEW.id
     AND cs.dimensions_width > 0
   ORDER BY cs.updated_at DESC
   LIMIT 1;

  IF coalesce(v_group.dimensions_width, 0) > 0 THEN
    v_length := coalesce(v_group.dimensions_length, 0);
    v_width := v_group.dimensions_width;
    v_thickness := coalesce(v_group.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_group.dimensions_unit, ''), 'mm');
  ELSIF coalesce(v_model.dimensions_width, 0) > 0 THEN
    v_length := coalesce(v_model.dimensions_length, 0);
    v_width := v_model.dimensions_width;
    v_thickness := coalesce(v_model.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_model.dimensions_unit, ''), 'mm');
  END IF;

  IF coalesce(v_width, 0) > 0 THEN
    INSERT INTO public.component_sheets (
      product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
      dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id, notes
    ) VALUES (
      NEW.id, NEW.group_id, v_length, v_width, v_thickness, v_unit,
      CASE WHEN coalesce(v_group.shared_specs, false) THEN coalesce(v_model.yield_per_size, '{}'::jsonb) ELSE '{}'::jsonb END,
      CASE WHEN coalesce(v_group.shared_specs, false) THEN coalesce(v_model.yield_per_sole, '{}'::jsonb) ELSE '{}'::jsonb END,
      CASE WHEN coalesce(v_group.shared_specs, false) THEN v_model.default_sole_group_id ELSE NULL END,
      CASE WHEN coalesce(v_group.shared_specs, false) THEN coalesce(v_model.notes, '') ELSE '' END
    )
    ON CONFLICT (product_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_sync_component_sheet_on_product_group_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_model public.component_sheets%ROWTYPE;
  v_length numeric := 0;
  v_width numeric := 0;
  v_thickness numeric := 0;
  v_unit text := 'mm';
BEGIN
  IF NEW.group_id IS NOT DISTINCT FROM OLD.group_id THEN RETURN NEW; END IF;

  IF NEW.group_id IS NULL THEN
    UPDATE public.component_sheets
       SET group_id = NULL
     WHERE product_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT * INTO v_group
    FROM public.product_groups
   WHERE id = NEW.group_id;

  IF coalesce(v_group.is_artisanal_strap, false) THEN
    UPDATE public.component_sheets
       SET group_id = NEW.group_id
     WHERE product_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT cs.* INTO v_model
    FROM public.component_sheets cs
    JOIN public.products sibling ON sibling.id = cs.product_id
   WHERE sibling.group_id = NEW.group_id
     AND sibling.id <> NEW.id
     AND cs.dimensions_width > 0
   ORDER BY cs.updated_at DESC
   LIMIT 1;

  IF coalesce(v_group.dimensions_width, 0) > 0 THEN
    v_length := coalesce(v_group.dimensions_length, 0);
    v_width := v_group.dimensions_width;
    v_thickness := coalesce(v_group.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_group.dimensions_unit, ''), 'mm');
  ELSIF coalesce(v_model.dimensions_width, 0) > 0 THEN
    v_length := coalesce(v_model.dimensions_length, 0);
    v_width := v_model.dimensions_width;
    v_thickness := coalesce(v_model.dimensions_thickness, 0);
    v_unit := coalesce(nullif(v_model.dimensions_unit, ''), 'mm');
  END IF;

  IF v_width > 0 THEN
    UPDATE public.component_sheets cs
       SET group_id = NEW.group_id,
           dimensions_length = v_length,
           dimensions_width = v_width,
           dimensions_thickness = v_thickness,
           dimensions_unit = v_unit,
           yield_per_size = CASE
             WHEN coalesce(v_group.shared_specs, false) AND v_model.id IS NOT NULL THEN v_model.yield_per_size
             ELSE cs.yield_per_size
           END,
           yield_per_sole = CASE
             WHEN coalesce(v_group.shared_specs, false) AND v_model.id IS NOT NULL THEN v_model.yield_per_sole
             ELSE cs.yield_per_sole
           END,
           default_sole_group_id = CASE
             WHEN coalesce(v_group.shared_specs, false) AND v_model.id IS NOT NULL THEN v_model.default_sole_group_id
             ELSE cs.default_sole_group_id
           END
     WHERE cs.product_id = NEW.id;

    IF NOT FOUND THEN
      INSERT INTO public.component_sheets (
        product_id, group_id, dimensions_length, dimensions_width, dimensions_thickness,
        dimensions_unit, yield_per_size, yield_per_sole, default_sole_group_id
      ) VALUES (
        NEW.id, NEW.group_id, v_length, v_width, v_thickness, v_unit,
        CASE WHEN coalesce(v_group.shared_specs, false) THEN coalesce(v_model.yield_per_size, '{}'::jsonb) ELSE '{}'::jsonb END,
        CASE WHEN coalesce(v_group.shared_specs, false) THEN coalesce(v_model.yield_per_sole, '{}'::jsonb) ELSE '{}'::jsonb END,
        CASE WHEN coalesce(v_group.shared_specs, false) THEN v_model.default_sole_group_id ELSE NULL END
      )
      ON CONFLICT (product_id) DO NOTHING;
    END IF;
  ELSE
    UPDATE public.component_sheets
       SET group_id = NEW.group_id
     WHERE product_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_reason constant text :=
    'Migration 20270101008600: higiene de tiras aprovada pelo dono (F2+F3)';
  v_seed record;
  v_group_id uuid;
  v_overlock_id uuid;
  v_deleted integer := 0;
  v_mirrored integer := 0;
  v_flagged integer := 0;
  v_tranca_id uuid;
BEGIN
  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  CREATE TEMP TABLE _strap_hygiene_owner_groups (
    kind text NOT NULL,
    expected_name text NOT NULL,
    finished_width_mm numeric,
    group_id uuid
  ) ON COMMIT DROP;

  FOR v_seed IN
    SELECT * FROM (
      VALUES
        ('strap'::text, 'TIRA OVERLOCK 5MM', 5::numeric),
        ('strap', 'TIRA CHATA 8MM', 8),
        ('strap', 'TIRA CHATA 25MM', 25),
        ('strap', 'TIRA CHATA COSTURADA 11MM', 11),
        ('strap', 'TIRA STRASS 6MM', 6),
        ('strap', 'TIRA STRASS 15MM', 15),
        ('strap', 'MEIA CANA 10MM', 10),
        ('napa', 'NAPA SOFT', NULL),
        ('napa', 'NAPA SANTORINE', NULL),
        ('napa', 'GLOW METALIC', NULL),
        ('napa', 'NAPA SUDANI', NULL)
    ) AS seed(kind, expected_name, finished_width_mm)
  LOOP
    v_group_id := NULL;
    BEGIN
      SELECT g.id
        INTO STRICT v_group_id
        FROM public.product_groups g
       WHERE public.normalize_strap_catalog_text(g.name)
           = public.normalize_strap_catalog_text(v_seed.expected_name)
         AND coalesce(g.is_family, false) = false;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION
          'Grupo confirmado pelo dono nao encontrado como folha: %',
          v_seed.expected_name;
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION
          'Nome confirmado pelo dono casa mais de um grupo-folha: %',
          v_seed.expected_name;
    END;

    INSERT INTO _strap_hygiene_owner_groups (
      kind, expected_name, finished_width_mm, group_id
    ) VALUES (
      v_seed.kind, v_seed.expected_name, v_seed.finished_width_mm, v_group_id
    );
  END LOOP;

  SELECT group_id INTO v_overlock_id
    FROM _strap_hygiene_owner_groups
   WHERE kind = 'strap'
     AND public.normalize_strap_catalog_text(expected_name)
       = public.normalize_strap_catalog_text('TIRA OVERLOCK 5MM');

  -- F2b: apagar ficha com largura de napa nos grupos de tira da lista.
  WITH doomed AS (
    SELECT cs.id,
           cs.product_id,
           p.group_id,
           og.expected_name,
           cs.dimensions_width,
           cs.dimensions_length,
           cs.dimensions_unit,
           public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) AS width_mm
      FROM public.component_sheets cs
      JOIN public.products p ON p.id = cs.product_id
      JOIN _strap_hygiene_owner_groups og ON og.group_id = p.group_id AND og.kind = 'strap'
     WHERE public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) >= 200
  ), deleted AS (
    DELETE FROM public.component_sheets cs
     USING doomed d
     WHERE cs.id = d.id
    RETURNING cs.id, d.product_id, d.group_id, d.expected_name,
              d.dimensions_width, d.dimensions_length, d.dimensions_unit, d.width_mm
  )
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data, success, created_at
  )
  SELECT NULL,
         'delete_napa_like_strap_component_sheet',
         'component_sheets',
         d.id::text,
         jsonb_build_object(
           'product_id', d.product_id,
           'group_id', d.group_id,
           'group_name', d.expected_name,
           'dimensions_width', d.dimensions_width,
           'dimensions_length', d.dimensions_length,
           'dimensions_unit', d.dimensions_unit,
           'width_mm', d.width_mm
         ),
         jsonb_build_object('deleted', true, 'reason', v_reason),
         true,
         now()
    FROM deleted d;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'F2b fichas de napa apagadas em grupo de tira: %', v_deleted;

  -- F2a: espelhar 1370 mm no produto linear cuja ficha ja tem 1370.
  WITH mirrored AS (
    UPDATE public.products p
       SET dimensions_width = CASE lower(coalesce(nullif(btrim(p.dimensions_unit), ''), 'mm'))
             WHEN 'cm' THEN 137
             WHEN 'm' THEN 1.370
             ELSE 1370
           END,
           dimensions_unit = coalesce(nullif(btrim(p.dimensions_unit), ''), 'mm'),
           updated_at = now()
     FROM _strap_hygiene_owner_groups og
    WHERE og.kind = 'napa'
      AND p.group_id = og.group_id
      AND p.unit = 'm'
      AND EXISTS (
        SELECT 1
          FROM public.component_sheets cs
         WHERE cs.product_id = p.id
           AND abs(
             coalesce(public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit), 0)
             - 1370
           ) <= 1
      )
      AND abs(
        coalesce(public.strap_hygiene_dimension_mm(p.dimensions_width, p.dimensions_unit), 0)
        - 1370
      ) > 1
    RETURNING p.id, p.group_id, og.expected_name, p.dimensions_width, p.dimensions_unit
  )
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data, success, created_at
  )
  SELECT NULL,
         'mirror_napa_product_width',
         'products',
         m.id::text,
         jsonb_build_object('group_id', m.group_id, 'group_name', m.expected_name),
         jsonb_build_object(
           'dimensions_width', m.dimensions_width,
           'dimensions_unit', m.dimensions_unit,
           'target_width_mm', 1370,
           'reason', v_reason
         ),
         true,
         now()
    FROM mirrored m;

  GET DIAGNOSTICS v_mirrored = ROW_COUNT;
  RAISE NOTICE 'F2a produtos de napa com largura espelhada para 1370 mm: %', v_mirrored;

  -- Largura do grupo/produto de tira: se ainda parece napa, grava a largura
  -- final confirmada na lista. Impede heranca e corte de rolo com 1370 mm.
  UPDATE public.product_groups g
     SET dimensions_width = og.finished_width_mm,
         dimensions_length = CASE
           WHEN coalesce(public.strap_hygiene_dimension_mm(g.dimensions_length, g.dimensions_unit), 0) >= 200
             THEN 0
           ELSE g.dimensions_length
         END,
         dimensions_unit = 'mm',
         updated_at = now()
    FROM _strap_hygiene_owner_groups og
   WHERE og.kind = 'strap'
     AND g.id = og.group_id
     AND (
       coalesce(public.strap_hygiene_dimension_mm(g.dimensions_width, g.dimensions_unit), 0) >= 200
       OR coalesce(public.strap_hygiene_dimension_mm(g.dimensions_length, g.dimensions_unit), 0) >= 200
     );

  UPDATE public.products p
     SET dimensions_width = CASE lower(coalesce(nullif(btrim(p.dimensions_unit), ''), 'mm'))
           WHEN 'cm' THEN og.finished_width_mm / 10
           WHEN 'm' THEN og.finished_width_mm / 1000
           ELSE og.finished_width_mm
         END,
         dimensions_unit = coalesce(nullif(btrim(p.dimensions_unit), ''), 'mm'),
         updated_at = now()
    FROM _strap_hygiene_owner_groups og
   WHERE og.kind = 'strap'
     AND p.group_id = og.group_id
     AND coalesce(public.strap_hygiene_dimension_mm(p.dimensions_width, p.dimensions_unit), 0) >= 200;

  -- F3: flag. O trigger recusa se ainda existir ficha >= 200 mm.
  WITH flagged AS (
    UPDATE public.product_groups g
       SET is_artisanal_strap = true,
           updated_at = now()
      FROM _strap_hygiene_owner_groups og
     WHERE og.kind = 'strap'
       AND g.id = og.group_id
       AND coalesce(g.is_artisanal_strap, false) = false
    RETURNING g.id, og.expected_name, g.auto_component_sheet
  )
  INSERT INTO public.audit_logs (
    user_id, action, resource, resource_id, old_data, new_data, success, created_at
  )
  SELECT NULL,
         'flag_finished_strap_group',
         'product_groups',
         f.id::text,
         jsonb_build_object('is_artisanal_strap', false, 'group_name', f.expected_name),
         jsonb_build_object(
           'is_artisanal_strap', true,
           'auto_component_sheet', f.auto_component_sheet,
           'reason', v_reason
         ),
         true,
         now()
    FROM flagged f;

  GET DIAGNOSTICS v_flagged = ROW_COUNT;
  RAISE NOTICE 'F3 grupos marcados como tira acabada: %', v_flagged;

  -- TRANÇA: so se o inventario de higiene a listaria por UUID, nao pelo nome.
  BEGIN
    SELECT g.id
      INTO STRICT v_tranca_id
      FROM public.product_groups g
     WHERE public.normalize_strap_catalog_text(g.name)
         = public.normalize_strap_catalog_text('TRANÇA')
       AND coalesce(g.is_family, false) = false
       AND coalesce(g.is_artisanal_strap, false) = false
       AND public.strap_finished_group_is_hygiene_candidate(g.id);
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      v_tranca_id := NULL;
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION 'Nome TRANCA casa mais de um grupo-folha; recuse marcar por nome';
  END;

  IF v_tranca_id IS NOT NULL THEN
    UPDATE public.product_groups
       SET is_artisanal_strap = true,
           updated_at = now()
     WHERE id = v_tranca_id;
    INSERT INTO public.audit_logs (
      user_id, action, resource, resource_id, old_data, new_data, success, created_at
    ) VALUES (
      NULL,
      'flag_finished_strap_group',
      'product_groups',
      v_tranca_id::text,
      jsonb_build_object('group_name', 'TRANÇA', 'is_artisanal_strap', false),
      jsonb_build_object('is_artisanal_strap', true, 'reason', v_reason, 'via', 'hygiene_candidate_uuid'),
      true,
      now()
    );
    RAISE NOTICE 'F3 TRANCA marcada via candidato de higiene';
  END IF;

  IF public.strap_base_group_is_eligible(v_overlock_id) THEN
    RAISE EXCEPTION 'TIRA OVERLOCK 5MM ainda aparece como napa-base depois da flag';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.component_sheets cs
      JOIN public.products p ON p.id = cs.product_id
      JOIN public.product_groups g ON g.id = p.group_id
     WHERE coalesce(g.is_artisanal_strap, false)
       AND public.strap_hygiene_dimension_mm(cs.dimensions_width, cs.dimensions_unit) >= 200
  ) THEN
    RAISE EXCEPTION 'Ainda existe ficha de napa em grupo de tira acabada';
  END IF;
END;
$$;

COMMIT;
