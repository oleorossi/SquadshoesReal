-- A cor canônica do cadastro de tiras nasce das cores já cadastradas nos
-- produtos de material. O vínculo "produto oficial" continua separado: ele
-- decide a fonte operacional exata e exige perfil de largura aprovado.

CREATE OR REPLACE FUNCTION public.sync_canonical_color_from_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active
     AND NEW.group_id IS NOT NULL
     AND NEW.unit = 'm'
     AND nullif(public.normalize_strap_catalog_text(NEW.color), '') IS NOT NULL THEN
    INSERT INTO public.canonical_colors (name, active)
    VALUES (btrim(NEW.color), true)
    ON CONFLICT (name_norm) DO UPDATE
      SET active = true,
          updated_at = now()
      WHERE NOT public.canonical_colors.active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_canonical_color_from_product ON public.products;
CREATE TRIGGER trg_sync_canonical_color_from_product
  AFTER INSERT OR UPDATE OF color, active, group_id, unit
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_color_from_product();

-- Backfill não altera products.color nem escolhe automaticamente um produto
-- oficial. Apenas torna selecionáveis as cores que o estoque já conhece.
INSERT INTO public.canonical_colors (name, active)
SELECT source.color, true
  FROM (
    SELECT DISTINCT ON (public.normalize_strap_catalog_text(p.color))
           btrim(p.color) AS color
      FROM public.products p
     WHERE p.active
       AND p.group_id IS NOT NULL
       AND p.unit = 'm'
       AND nullif(public.normalize_strap_catalog_text(p.color), '') IS NOT NULL
     ORDER BY public.normalize_strap_catalog_text(p.color), p.created_at, p.id
  ) source
ON CONFLICT (name_norm) DO UPDATE
  SET active = true,
      updated_at = now()
  WHERE NOT public.canonical_colors.active;

COMMENT ON FUNCTION public.sync_canonical_color_from_product() IS
  'Sincroniza products.color com canonical_colors para o seletor de cor das tiras; não designa produto-base oficial.';
