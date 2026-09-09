-- Peel de napa em dublado para tiras + origem_padrao no Hub (medida) + frete no prestador.
-- Spec: specs/origem-tira-pv-hub-os.md
-- A tira NUNCA herda Soft+Massabox; usa a camada is_color_source.

CREATE OR REPLACE FUNCTION public.peel_strap_base_group_id(p_group_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_group_id IS NULL THEN NULL
    ELSE coalesce(
      (
        SELECT layer.component_group_id
          FROM public.product_group_layers layer
         WHERE layer.composite_group_id = p_group_id
           AND layer.is_color_source IS TRUE
           AND layer.component_group_id IS NOT NULL
         ORDER BY layer.display_order
         LIMIT 1
      ),
      p_group_id
    )
  END;
$function$;

COMMENT ON FUNCTION public.peel_strap_base_group_id(uuid) IS
  'Para tira: se o grupo for composto/dublado, devolve a camada de napa (is_color_source); senão o próprio UUID.';

REVOKE ALL ON FUNCTION public.peel_strap_base_group_id(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peel_strap_base_group_id(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.has_straps,
           ts.upper_material,
           ts.upper_material_group_id,
           ts.strap_base_group_id,
           ts.upper_material_product_id,
           ts.lining_material,
           ts.lining_material_product_id,
           ts.variant_drives_lining,
           coalesce(ts.has_straps, false)
             AND nullif(pg_catalog.btrim(ts.upper_material), '') IS NULL
             AND ts.upper_material_group_id IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM public.products active_upper
                WHERE active_upper.id = ts.upper_material_product_id
                  AND active_upper.active = true
             ) AS straps_follow_lining
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  ), raw AS (
    SELECT CASE
      WHEN s.straps_follow_lining THEN coalesce(
        variant_lining_product.group_id,
        v.lining_material_group_id,
        CASE WHEN coalesce(s.variant_drives_lining, false)
          THEN v.main_material_group_id END,
        sheet_lining_product.group_id,
        sheet_lining_text_group.id,
        s.strap_base_group_id
      )
      ELSE coalesce(
        variant_upper_product.group_id,
        v.upper_material_group_id,
        variant_lining_product.group_id,
        v.lining_material_group_id,
        v.main_material_group_id,
        sheet_upper_product.group_id,
        s.upper_material_group_id,
        sheet_lining_text_group.id,
        s.strap_base_group_id,
        sheet_lining_product.group_id
      )
    END AS group_id
    FROM s
    LEFT JOIN v ON true
    LEFT JOIN public.products variant_upper_product
      ON variant_upper_product.id = v.upper_material_product_id
     AND variant_upper_product.active = true
    LEFT JOIN public.products variant_lining_product
      ON variant_lining_product.id = v.lining_material_product_id
     AND variant_lining_product.active = true
    LEFT JOIN public.products sheet_upper_product
      ON sheet_upper_product.id = s.upper_material_product_id
     AND sheet_upper_product.active = true
    LEFT JOIN public.products sheet_lining_product
      ON sheet_lining_product.id = s.lining_material_product_id
     AND sheet_lining_product.active = true
    LEFT JOIN public.product_groups sheet_lining_text_group
      ON pg_catalog.lower(pg_catalog.btrim(sheet_lining_text_group.name))
        = nullif(pg_catalog.lower(pg_catalog.btrim(s.lining_material)), '')
  )
  SELECT public.peel_strap_base_group_id(raw.group_id) FROM raw;
$function$;

COMMENT ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid) IS
  'Napa-base operacional da tira (cascata cabedal/forração) com peel da camada de napa em dublados.';

REVOKE ALL ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid)
  TO authenticated, service_role;

-- Hub: origem e preços por medida
ALTER TABLE public.artisanal_strap_measures
  ADD COLUMN IF NOT EXISTS origem_padrao text NOT NULL DEFAULT 'escolhe_no_pv',
  ADD COLUMN IF NOT EXISTS preco_artesanal_per_m numeric(20,6),
  ADD COLUMN IF NOT EXISTS preco_prestador_per_m numeric(20,6);

DO $ck$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'artisanal_strap_measures_origem_padrao_ck'
  ) THEN
    ALTER TABLE public.artisanal_strap_measures
      ADD CONSTRAINT artisanal_strap_measures_origem_padrao_ck
      CHECK (origem_padrao IN ('sempre_fabrica', 'sempre_sku_acabado', 'escolhe_no_pv'));
  END IF;
END;
$ck$;

COMMENT ON COLUMN public.artisanal_strap_measures.origem_padrao IS
  'sempre_fabrica | sempre_sku_acabado | escolhe_no_pv — decide se o PV exibe seletor.';
COMMENT ON COLUMN public.artisanal_strap_measures.preco_artesanal_per_m IS
  'Custo R$/m da tira feita na fábrica (Hub).';
COMMENT ON COLUMN public.artisanal_strap_measures.preco_prestador_per_m IS
  'Mão de obra R$/m do prestador (Hub). Strass usa preço por cor no produto.';

-- Prestador: frete editável (ex.: R$70 / 1600 m)
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS strap_freight_amount numeric(20,6),
  ADD COLUMN IF NOT EXISTS strap_freight_per_meters numeric(20,6);

COMMENT ON COLUMN public.contractors.strap_freight_amount IS
  'Valor de frete de tira (R$) para o lote strap_freight_per_meters.';
COMMENT ON COLUMN public.contractors.strap_freight_per_meters IS
  'Metros de referência do frete de tira (ex.: 1600). frete/m = amount/per_meters.';

-- Sugestão Strass → sempre_sku_acabado
UPDATE public.artisanal_strap_measures measure
   SET origem_padrao = 'sempre_sku_acabado'
  FROM public.artisanal_strap_types strap_type
 WHERE strap_type.id = measure.strap_type_id
   AND measure.origem_padrao = 'escolhe_no_pv'
   AND (
     upper(strap_type.name) LIKE '%STRASS%'
     OR upper(measure.display_name) LIKE '%STRASS%'
   );
