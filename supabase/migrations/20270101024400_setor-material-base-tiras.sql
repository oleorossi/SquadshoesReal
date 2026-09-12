-- ============================================================================
-- 10º setor canônico: Material Base — tiras cortadas de napa
-- ============================================================================
-- OVERLOCK / CHATA / meia cana / trança: um grupo de tira (tipo + medida),
-- cores no grupo; a napa (Soft vs Madrid) vem da variante da ficha via
-- artisanal_strap_recipes.base_group_id / resolve_strap_base_group_id.
--
-- STRASS (identity_basis = finished_product_group, IDs nominais da mig 044)
-- é tira comprada pronta — permanece em Componente. TIRA CHATA 16MM já é
-- Cabedal e is_artisanal_strap = false — não mover.
-- ============================================================================

ALTER TABLE public.product_groups
  DROP CONSTRAINT IF EXISTS product_groups_sector_check;

ALTER TABLE public.product_groups
  ADD CONSTRAINT product_groups_sector_check
  CHECK (
    sector IN (
      'Cabedal',
      'Forração da Palmilha',
      'Palmilha',
      'Material Base',
      'Cola / Químico',
      'Componente',
      'Embalagem',
      'Solado',
      'Ferramentas',
      'Fôrma'
    )
  );

COMMENT ON CONSTRAINT product_groups_sector_check ON public.product_groups IS
  'Vocabulário canônico de product_groups.sector (= products.category). '
  'Material Base (20270101024400) é tira cortada de napa; STRASS fica em Componente.';

CREATE OR REPLACE FUNCTION public.derive_category_from_group_name(p_group_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
BEGIN
  IF p_group_name IS NULL OR length(trim(p_group_name)) = 0 THEN
    RETURN 'Componente';
  END IF;

  v_norm := lower(extensions.unaccent(p_group_name));

  -- Solado: pega 'solado/sola' e tipos de salto (saltinho, anabela, etc)
  IF v_norm ~ '(solado|sola\M|saltinho|salto|anabela|plataforma|tamanco)' THEN
    RETURN 'Solado';
  ELSIF v_norm ~ '(cabedal|napa|couro|velvet|tecido)' THEN
    RETURN 'Cabedal';
  ELSIF v_norm ~ '(palmilha|placa de palmilha|placa palmilha)' THEN
    RETURN 'Palmilha';
  ELSIF v_norm ~ '(forro|forracao)' THEN
    RETURN 'Forração da Palmilha';
  ELSIF v_norm ~ '(cola|quimico|primer|halogenante)' THEN
    RETURN 'Cola / Químico';
  ELSIF v_norm ~ '(ferramenta|navalha|faca)' THEN
    RETURN 'Ferramentas';
  ELSIF v_norm ~ '(forma)' THEN
    RETURN 'Fôrma';
  ELSIF v_norm ~ 'strass' THEN
    RETURN 'Componente';
  ELSIF v_norm ~ '(tira|tranca|meia cana)' THEN
    RETURN 'Material Base';
  END IF;

  RETURN 'Componente';
END;
$function$;

-- Backfill: artesanais que NÃO estão nos UUIDs nominais de STRASS comprada
-- pronta (src/lib/strapIdentity.ts NOMINAL_BUY_READY_STRAP_GROUP_IDS).
-- Família TIRA move se TODOS os filhos diretos estão nesse conjunto.
-- Filhos cujo pai fica em outro setor (COMPONENTES) são desvinculados.
-- Três statements: WITH no Postgres compartilha snapshot e o UPDATE de setor
-- não enxergaria o unlink do pai se viesse no mesmo comando.
--
-- A cascata tg_group_sector_cascade atualiza products.category. Tira artesanal
-- tem escritor legado congelado; o token transacional
-- app.artisanal_strap_catalog_write = 1 é o mesmo das RPCs do Hub.

WITH _write AS (
  SELECT set_config('app.artisanal_strap_catalog_write', '1', true)
),
buy_ready AS (
  SELECT unnest(ARRAY[
    'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
    '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
  ]) AS id
),
move_groups AS (
  SELECT g.id, g.parent_group_id
  FROM public.product_groups g
  WHERE g.is_artisanal_strap IS TRUE
    AND g.id NOT IN (SELECT id FROM buy_ready)
),
move_families AS (
  SELECT f.id
  FROM public.product_groups f
  WHERE coalesce(f.is_family, false)
    AND EXISTS (SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = f.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.product_groups c
      WHERE c.parent_group_id = f.id
        AND c.id NOT IN (SELECT id FROM move_groups)
    )
)
UPDATE public.product_groups g
SET parent_group_id = NULL
FROM _write
WHERE g.id IN (SELECT id FROM move_groups)
  AND g.parent_group_id IS NOT NULL
  AND g.parent_group_id NOT IN (SELECT id FROM move_families)
  AND g.parent_group_id NOT IN (SELECT id FROM move_groups);

WITH _write AS (
  SELECT set_config('app.artisanal_strap_catalog_write', '1', true)
),
buy_ready AS (
  SELECT unnest(ARRAY[
    'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
    '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
  ]) AS id
),
move_groups AS (
  SELECT g.id
  FROM public.product_groups g
  WHERE g.is_artisanal_strap IS TRUE
    AND g.id NOT IN (SELECT id FROM buy_ready)
),
move_families AS (
  SELECT f.id
  FROM public.product_groups f
  WHERE coalesce(f.is_family, false)
    AND EXISTS (SELECT 1 FROM public.product_groups c WHERE c.parent_group_id = f.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.product_groups c
      WHERE c.parent_group_id = f.id
        AND c.id NOT IN (SELECT id FROM move_groups)
    )
)
UPDATE public.product_groups
SET sector = 'Material Base'
FROM _write
WHERE id IN (SELECT id FROM move_families)
  AND sector IS DISTINCT FROM 'Material Base';

WITH _write AS (
  SELECT set_config('app.artisanal_strap_catalog_write', '1', true)
),
buy_ready AS (
  SELECT unnest(ARRAY[
    'c45ff936-5ac5-49b5-98c4-4aed5e10e82d'::uuid,
    '6e43bbda-0f1f-412c-8d4a-ec009114530d'::uuid
  ]) AS id
),
move_groups AS (
  SELECT g.id
  FROM public.product_groups g
  WHERE g.is_artisanal_strap IS TRUE
    AND g.id NOT IN (SELECT id FROM buy_ready)
)
UPDATE public.product_groups
SET sector = 'Material Base'
FROM _write
WHERE id IN (SELECT id FROM move_groups)
  AND sector IS DISTINCT FROM 'Material Base';
