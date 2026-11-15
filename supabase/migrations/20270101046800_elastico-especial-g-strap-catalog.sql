-- ELÁSTICO ESPECIAL G no catálogo canônico de tiras (Família e medida).
--
-- Sintoma: na ficha (Range Aviamento) o seletor "Família e medida canônicas"
-- só lista artisanal_strap_types/measures. O item já existia no estoque como
-- família com folhas 20/25/30MM (mig 20270101043600), mas nunca entrou no
-- catálogo — então não dava pra selecionar na TIRA.
--
-- Identidade: SKU próprio vendido a metro (como Strass) → sempre_sku_acabado.
-- As folhas de estoque ficam is_artisanal_strap pra não aparecerem como
-- napa-base. Variantes Hub NÃO são inventadas aqui: a policy da ficha resolve
-- o grupo acabado pelos SKUs lineares da folha (mesma filosofia do Strass
-- sem variante Hub, mig 45600).

SELECT set_config(
  'app.strap_change_reason',
  'Seed ELÁSTICO ESPECIAL G no catálogo canônico de tiras (ficha Range Aviamento)',
  true
);
SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

WITH seed_type(id, name) AS (
  VALUES (
    'e1a501ca-7c52-4776-958f-fb49e7835911'::uuid,
    'ELÁSTICO ESPECIAL G'
  )
)
INSERT INTO public.artisanal_strap_types (id, name, active)
SELECT id, name, true
  FROM seed_type
ON CONFLICT ON CONSTRAINT artisanal_strap_types_name_norm_uq
DO UPDATE
   SET name = EXCLUDED.name,
       active = true;

WITH seed_measures(id, type_name, display_name, finished_width_mm) AS (
  VALUES
    ('e1a52000-7c52-4776-958f-fb49e7835920'::uuid, 'ELÁSTICO ESPECIAL G', '20 mm', 20::numeric),
    ('e1a52500-7c52-4776-958f-fb49e7835925'::uuid, 'ELÁSTICO ESPECIAL G', '25 mm', 25::numeric),
    ('e1a53000-7c52-4776-958f-fb49e7835930'::uuid, 'ELÁSTICO ESPECIAL G', '30 mm', 30::numeric)
), resolved AS (
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
  active,
  origem_padrao
)
SELECT resolved.id,
       resolved.strap_type_id,
       resolved.display_name,
       resolved.finished_width_mm,
       true,
       'sempre_sku_acabado'
  FROM resolved
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
       active = true,
       origem_padrao = 'sempre_sku_acabado';

-- Garante origem buy-ready mesmo se a medida já existia sem o campo.
UPDATE public.artisanal_strap_measures measure
   SET origem_padrao = 'sempre_sku_acabado',
       active = true
  FROM public.artisanal_strap_types strap_type
 WHERE strap_type.id = measure.strap_type_id
   AND strap_type.name_norm = public.normalize_strap_catalog_text('ELÁSTICO ESPECIAL G')
   AND measure.finished_width_mm IN (20, 25, 30)
   AND measure.origem_padrao IS DISTINCT FROM 'sempre_sku_acabado';

-- Folhas de bitola do piloto 43600: tira acabada (não napa-base).
DO $$
DECLARE
  v_family_id uuid := 'c5b1b9c0-7c52-4776-958f-fb49e7835911';
  v_updated integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_groups
     WHERE id = v_family_id
       AND name = 'ELÁSTICO ESPECIAL G'
  ) THEN
    RAISE NOTICE 'Família ELÁSTICO ESPECIAL G ausente — skip flag is_artisanal_strap';
    RETURN;
  END IF;

  UPDATE public.product_groups
     SET is_artisanal_strap = true,
         auto_component_sheet = false
   WHERE parent_group_id = v_family_id
      OR id IN (
        'a20b0000-7c52-4776-958f-fb49e7835920'::uuid,
        'a25b0000-7c52-4776-958f-fb49e7835925'::uuid,
        'a30b0000-7c52-4776-958f-fb49e7835930'::uuid
      );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'ELÁSTICO ESPECIAL G: % folhas marcadas is_artisanal_strap', v_updated;
END;
$$;

DO $$
DECLARE
  v_active_count integer;
BEGIN
  SELECT count(*)
    INTO v_active_count
    FROM public.artisanal_strap_measures measure
    JOIN public.artisanal_strap_types strap_type
      ON strap_type.id = measure.strap_type_id
   WHERE strap_type.name_norm = public.normalize_strap_catalog_text('ELÁSTICO ESPECIAL G')
     AND strap_type.active
     AND measure.active
     AND measure.finished_width_mm IN (20, 25, 30)
     AND measure.origem_padrao = 'sempre_sku_acabado';

  IF v_active_count < 3 THEN
    RAISE EXCEPTION
      'Seed ELÁSTICO ESPECIAL G incompleto: esperava 3 medidas buy-ready, achei %',
      v_active_count;
  END IF;
END;
$$;
