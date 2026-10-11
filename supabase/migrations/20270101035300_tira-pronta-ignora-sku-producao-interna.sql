-- Tira comprada pronta: a busca do SKU no grupo acabado ignora SKUs de
-- produção interna (variante reference_base).
--
-- Sintoma (11/10/2026, PV novo DS20 PRETO): "ha mais de um SKU ativo da Cor
-- Principal no grupo acabado". O grupo TIRA OVERLOCK 5MM tem o SKU acabado
-- legado "Tira Overlock 5mm" PRETO e o SKU "TIRA OVERLOCK 5 mm · NAPA SOFT ·
-- PRETO", que o motor de tiras artesanais criou para a variante
-- identity_basis='reference_base' (produção interna, purchase_enabled=false).
-- A busca contava só grupo + cor, então os dois colidiam. Medido: 17 pares
-- (grupo, cor) nos grupos de tira nessa situação.
--
-- Decisão do dono: o SKU da produção interna NÃO é candidato a tira comprada
-- pronta. Filtrando por ele sobra exatamente 1 SKU em 15 dos 17 pares; nos 2
-- restantes (Tira chata 8mm NEW WHISKY / OFF WHITE, todos reference_base)
-- não sobra nenhum e a função segue o caminho que já existia para grupo sem
-- SKU: cria o SKU TP- de compra.
--
-- Patch via pg_get_functiondef, como as vizinhas 24000/28600 — não redefine
-- o corpo inteiro. As âncoras incluem o sufixo para não tocar a 3ª ocorrência
-- (ramo finished_product_group, que já filtra pela variante comercial).

DO $$
DECLARE
  v_fn regprocedure := 'public.prepare_sale_order_item_internal_straps(jsonb)'::regprocedure;
  v_src text;
  v_new text;
  v_filter constant text :=
    E'\n           AND NOT EXISTS ( -- strap_buy_ready_ignora_reference_base_20270101035300\n'
    || E'             SELECT 1 FROM public.artisanal_strap_variants rb\n'
    || E'              WHERE rb.finished_product_id = p.id\n'
    || E'                AND rb.identity_basis = ''reference_base'')';
  v_count_anchor constant text :=
    E'AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id\n      ) > 1 THEN';
  v_select_anchor constant text :=
    E'AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id\n       FOR SHARE OF p;';
BEGIN
  v_src := pg_get_functiondef(v_fn);

  IF position('strap_buy_ready_ignora_reference_base_20270101035300' IN v_src) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(v_count_anchor IN v_src) = 0 OR position(v_select_anchor IN v_src) = 0 THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps: âncora da busca buy_ready não encontrada';
  END IF;

  v_new := replace(
    v_src,
    v_count_anchor,
    E'AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id'
      || v_filter || E'\n      ) > 1 THEN'
  );
  v_new := replace(
    v_new,
    v_select_anchor,
    E'AND public.resolve_strap_canonical_color_id(p.color) = v_line_color_id'
      || v_filter || E'\n       FOR SHARE OF p;'
  );

  IF (length(v_new) - length(replace(v_new, 'strap_buy_ready_ignora_reference_base_20270101035300', '')))
     / length('strap_buy_ready_ignora_reference_base_20270101035300') <> 2 THEN
    RAISE EXCEPTION 'prepare_sale_order_item_internal_straps: esperado exatamente 2 pontos patchados';
  END IF;

  EXECUTE v_new;
END
$$;
