-- Tira artesanal: a familia da napa-base passa a enxergar a VARIANTE do item
--
-- DEFEITO (medido 31/07/2026, ficha c5cc899e = code I90I / name I100, PV-00151):
-- strap_base_family_for_sheet le so technical_sheets.upper_material -> lining_material.
-- Item do PV com material_variant_id NAPA SOFT numa ficha cuja lining_material e
-- GLOW METALIC resolve a familia ERRADA. Como GLOW METALIC nao tem PRETO no
-- cadastro, resolve_strap_base_napa devolve block_reason e debit_strap_stock
-- levanta excecao: a OP NAO LIBERA, com NAPA SOFT PRETO (93 m) parada no estoque.
-- Compras erra igual, pelo mesmo v_family.
--
-- Cabedal, forro, palmilha e solado ja sao variant-aware desde jul/2026
-- (resolve_*_material_for_variant). A tira era o ultimo ponto cego: a spec
-- specs/tira-artesanal-fonte-unica-e-os-cabedal.md nao cita variante nenhuma vez.
--
-- Precedencia decidida com o dono em 31/07/2026:
--   grupo de cabedal da variante
--   > produto de cabedal pinado na variante (legado)
--   > grupo de forracao da variante
--   > produto de forracao pinado na variante (legado)
--   > upper_material da ficha
--   > lining_material da ficha
-- Mantem a excecao ja decidida (modelo so de tiras sai da forracao); a variante
-- apenas entra na frente.
--
-- Overload SEM DEFAULT de proposito: criar (uuid, uuid DEFAULT NULL) ao lado da
-- de 1 argumento deixaria a chamada de 1 arg AMBIGUA e quebraria os chamadores.

CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(
  p_reference_id uuid,
  p_variant_id   uuid
)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_variant_id
       AND COALESCE(rmv.active, true)
       -- Variante tem que ser DESTA ficha: variante orfa nao pode ditar familia.
       AND (p_reference_id IS NULL OR rmv.reference_id = p_reference_id)
     LIMIT 1
  )
  SELECT COALESCE(
    -- 1) Cabedal da variante (grupo, depois o pin legado de produto)
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.upper_material_group_id),
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.products p       ON p.id = v.upper_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    -- 2) Forracao da variante (modelo so de tiras cai aqui)
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.product_groups g ON g.id = v.lining_material_group_id),
    (SELECT NULLIF(btrim(g.name), '')
       FROM v JOIN public.products p       ON p.id = v.lining_material_product_id
              JOIN public.product_groups g ON g.id = p.group_id),
    -- 3) Ficha: comportamento historico, preservado intacto
    (SELECT NULLIF(btrim(ts.upper_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id),
    (SELECT NULLIF(btrim(ts.lining_material), '')
       FROM public.technical_sheets ts WHERE ts.id = p_reference_id)
  );
$function$;

COMMENT ON FUNCTION public.strap_base_family_for_sheet(uuid, uuid) IS
  'Familia de napa de que as tiras artesanais deste ITEM sao cortadas. '
  'Precedencia: grupo/pin de cabedal da variante > grupo/pin de forracao da '
  'variante > upper_material da ficha > lining_material da ficha. Variante de '
  'outra ficha e ignorada. Decidido com o dono em 31/07/2026.';

-- A de 1 argumento vira wrapper: quem nao sabe da variante mantem EXATAMENTE o
-- comportamento de hoje (OP sem vinculo com item do PV cai aqui por decisao --
-- 18 de 266 OPs tem orders.sale_order_item_id NULL).
CREATE OR REPLACE FUNCTION public.strap_base_family_for_sheet(p_reference_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public, extensions'
AS $function$
  SELECT public.strap_base_family_for_sheet(p_reference_id, NULL::uuid);
$function$;

COMMENT ON FUNCTION public.strap_base_family_for_sheet(uuid) IS
  'Familia da napa-base SEM variante conhecida (cai na ficha: cabedal, fallback '
  'forracao). Delega para strap_base_family_for_sheet(uuid, uuid).';
