-- Inicializa o eixo selecionavel do catalogo canonico de tiras.
--
-- A tela de Range Aviamento exige familia + medida por UUID, mas o catalogo
-- chegou vazio a producao. Os registros abaixo representam somente identidades
-- cujas larguras finais ja estao explicitas no cadastro existente. Esta migration
-- NAO associa fichas, receitas, produtos ou grupos legados por nome: cada linha da
-- ficha continua exigindo a escolha humana da identidade tecnica correta.

SELECT set_config(
  'app.strap_change_reason',
  'Bootstrap das familias e medidas explicitas do catalogo canonico de tiras',
  true
);

WITH seed_types(id, name) AS (
  VALUES
    ('485a45d9-e532-479f-aed5-cad4be5b33da'::uuid, 'TIRA CHATA'),
    ('96c66bb7-c920-4f07-ad75-24d7a3795fba'::uuid, 'TIRA CHATA COSTURADA'),
    ('a69cb531-2d66-4931-9a71-8b06bec56eb0'::uuid, 'TIRA OVERLOCK'),
    ('381eb21d-2170-45f7-ab7c-3601a8857ea9'::uuid, 'TIRA STRASS'),
    ('d2bd9bde-ff40-4ae0-9361-f7c6a17e83e6'::uuid, 'MEIA CANA')
)
INSERT INTO public.artisanal_strap_types (id, name, active)
SELECT id, name, true
  FROM seed_types
ON CONFLICT ON CONSTRAINT artisanal_strap_types_name_norm_uq
DO UPDATE
   SET name = EXCLUDED.name,
       active = true;

WITH seed_measures(id, type_name, display_name, finished_width_mm) AS (
  VALUES
    ('0166b326-2023-4427-a165-aada45ee5611'::uuid, 'TIRA CHATA', '8 mm', 8::numeric),
    ('2c84a703-851c-4c56-8a72-4615d3d1fa05'::uuid, 'TIRA CHATA', '25 mm', 25::numeric),
    ('65628af5-8cb3-419a-8c54-3e2ac474ee5e'::uuid, 'TIRA CHATA COSTURADA', '11 mm', 11::numeric),
    ('06500a23-801d-4627-a927-3ce7e5ee2619'::uuid, 'TIRA OVERLOCK', '5 mm', 5::numeric),
    ('00f07325-347b-4e65-90e6-fed33f70eacc'::uuid, 'TIRA STRASS', '6 mm', 6::numeric),
    ('a487b85e-8e3d-4091-9932-41205836b5c0'::uuid, 'TIRA STRASS', '15 mm', 15::numeric),
    ('69c30596-c428-459b-ad93-128814c8b277'::uuid, 'MEIA CANA', '10 mm', 10::numeric)
), resolved_measures AS (
  SELECT seed.id,
         strap_type.id AS strap_type_id,
         seed.display_name,
         seed.finished_width_mm
    FROM seed_measures seed
    JOIN public.artisanal_strap_types strap_type
      ON strap_type.name_norm = public.normalize_strap_catalog_text(seed.type_name)
)
INSERT INTO public.artisanal_strap_measures (
  id,
  strap_type_id,
  display_name,
  finished_width_mm,
  active
)
SELECT resolved.id,
       resolved.strap_type_id,
       resolved.display_name,
       resolved.finished_width_mm,
       true
  FROM resolved_measures resolved
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.artisanal_strap_measures existing
    WHERE existing.strap_type_id = resolved.strap_type_id
      AND existing.finished_width_mm = resolved.finished_width_mm
      AND existing.active
 )
ON CONFLICT (id)
DO UPDATE
   SET strap_type_id = EXCLUDED.strap_type_id,
       display_name = EXCLUDED.display_name,
       finished_width_mm = EXCLUDED.finished_width_mm,
       active = true;

DO $$
DECLARE
  v_active_seed_count integer;
BEGIN
  SELECT count(*)
    INTO v_active_seed_count
    FROM public.artisanal_strap_measures measure
    JOIN public.artisanal_strap_types strap_type
      ON strap_type.id = measure.strap_type_id
    JOIN (
      VALUES
        ('TIRA CHATA', 8::numeric),
        ('TIRA CHATA', 25::numeric),
        ('TIRA CHATA COSTURADA', 11::numeric),
        ('TIRA OVERLOCK', 5::numeric),
        ('TIRA STRASS', 6::numeric),
        ('TIRA STRASS', 15::numeric),
        ('MEIA CANA', 10::numeric)
    ) expected(type_name, finished_width_mm)
      ON strap_type.name_norm = public.normalize_strap_catalog_text(expected.type_name)
     AND measure.finished_width_mm = expected.finished_width_mm
   WHERE strap_type.active
     AND measure.active;

  IF v_active_seed_count <> 7 THEN
    RAISE EXCEPTION
      'Bootstrap do catalogo de tiras incompleto: esperadas 7 medidas ativas, encontradas %',
      v_active_seed_count;
  END IF;
END;
$$;

-- O catalogo pode preservar uma medida ativa para historico mesmo quando sua
-- familia e arquivada. A ficha, porem, nao pode gravar essa identidade como se
-- ainda estivesse operacional. Linhas totalmente legadas continuam aceitas no
-- banco durante a revisao; ao informar um dos UUIDs canonicos, ambos passam a ser
-- obrigatorios, coerentes e ativos.
CREATE OR REPLACE FUNCTION public.tg_validate_technical_strap_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_basis text;
  v_group_id uuid;
  v_legacy_group_id uuid;
  v_measure_id uuid;
  v_strap_type_id uuid;
BEGIN
  IF NEW.strap_colors IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(NEW.strap_colors) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array JSON';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_group_id := NULL;
    v_legacy_group_id := NULL;
    v_measure_id := NULL;
    v_strap_type_id := NULL;
    v_basis := coalesce(nullif(v_line ->> 'identity_basis', ''), 'reference_base');

    IF v_basis NOT IN ('reference_base', 'finished_product_group') THEN
      RAISE EXCEPTION 'Linha tecnica possui identity_basis invalido';
    END IF;

    BEGIN
      v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid;
      v_strap_type_id := nullif(v_line ->> 'strap_type_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida canonica invalida';
    END;

    IF (v_measure_id IS NULL) <> (v_strap_type_id IS NULL) THEN
      RAISE EXCEPTION 'Linha tecnica exige familia e medida canonicas juntas';
    END IF;

    IF v_measure_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.artisanal_strap_measures measure
        JOIN public.artisanal_strap_types strap_type
          ON strap_type.id = measure.strap_type_id
       WHERE measure.id = v_measure_id
         AND measure.strap_type_id = v_strap_type_id
         AND measure.active
         AND strap_type.active
    ) THEN
      RAISE EXCEPTION 'Linha tecnica possui familia ou medida inativa ou divergente';
    END IF;

    IF v_basis = 'finished_product_group' THEN
      BEGIN
        v_group_id := nullif(v_line ->> 'identity_group_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta possui identity_group_id invalido';
      END;
      IF v_group_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_groups product_group WHERE product_group.id = v_group_id
      ) THEN
        RAISE EXCEPTION 'Linha tecnica comprada pronta exige identity_group_id existente';
      END IF;
    END IF;

    BEGIN
      v_legacy_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_legacy_group_id := NULL;
    END;
    IF public.is_buy_ready_strass_identity(NULL, v_legacy_group_id)
       AND (
         v_basis <> 'finished_product_group'
         OR v_group_id IS DISTINCT FROM v_legacy_group_id
       ) THEN
      RAISE EXCEPTION 'Linha STRASS por UUID explicito exige finished_product_group e identity_group_id exato';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
