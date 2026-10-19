-- =============================================================================
-- Vincular SKU acabado do Hub ao grupo da medida (wizard rendimento · Q14/Q16)
-- =============================================================================
-- O writer legado reference_base cria products sem group_id/color. O wizard do
-- Hub cria o grupo TIPO NMM em strap_hub_measure_group_map e precisa colocar o
-- SKU lá — mesma cor canônica da variante (estoque = Hub).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.bind_strap_finished_product_group(
  p_product_id uuid,
  p_group_id uuid,
  p_color text,
  p_reason text DEFAULT 'Hub: SKU no grupo da medida'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := public.require_strap_change_reason(p_reason);
  v_color text := nullif(btrim(coalesce(p_color, '')), '');
  v_variant public.artisanal_strap_variants%ROWTYPE;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');

  IF p_product_id IS NULL OR p_group_id IS NULL THEN
    RAISE EXCEPTION 'Produto e grupo sao obrigatorios';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_groups g WHERE g.id = p_group_id) THEN
    RAISE EXCEPTION 'Grupo de estoque inexistente';
  END IF;

  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants av
   WHERE av.finished_product_id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto nao e acabado de variante do Hub';
  END IF;

  -- O grupo tem que ser o da medida (mapa Hub), nao a napa-base.
  IF NOT EXISTS (
    SELECT 1
      FROM public.strap_hub_measure_group_map m
     WHERE m.measure_id = v_variant.measure_id
       AND m.strap_group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'Grupo nao esta mapeado para a medida da variante';
  END IF;

  PERFORM set_config('app.strap_change_reason', v_reason, true);
  PERFORM set_config('app.artisanal_strap_catalog_write', '1', true);

  UPDATE public.products
     SET group_id = p_group_id,
         color = coalesce(v_color, color),
         category = CASE
           WHEN nullif(btrim(coalesce(category, '')), '') IS NULL
             OR category = 'Tiras Artesanais'
           THEN 'Material Base'
           ELSE category
         END,
         -- Grill Q17: saldo inicial 0 (INSERT do bundle ja grava 0; reforca).
         quantity = coalesce(quantity, 0)
   WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto inexistente';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.bind_strap_finished_product_group(uuid, uuid, text, text) IS
  'Posiciona o SKU acabado da variante no grupo da medida do Hub (TIPO NMM) com a cor canônica.';

REVOKE ALL ON FUNCTION public.bind_strap_finished_product_group(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_strap_finished_product_group(uuid, uuid, text, text)
  TO authenticated, service_role;
