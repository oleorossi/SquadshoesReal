-- Religar componente direto orfao sem depender de SQL manual
-- ============================================================================
-- Depois que um produto e apagado, technical_sheets.direct_components fica com
-- product_id morto (jsonb, sem FK — ver 20261028120000). Recadastrar NAO reata:
-- produto novo nasce com ID novo. Hoje sao 25 linhas em 24 fichas, e a unica
-- saida era alguem reescrever o jsonb na mao.
--
-- Estas duas funcoes sustentam o painel em /system-diagnostics:
--   list_orphan_direct_components() — o que esta quebrado, agrupado pelo ID
--     morto (5 grupos cobrem as 25 linhas)
--   relink_direct_component(morto, novo) — troca o vinculo em TODAS as fichas
--     daquele ID de uma vez, preservando quantidade e preco de cada linha
--
-- ⚠ Agrupa por product_id, NAO por nome: o mesmo ID aparece gravado com nomes
-- diferentes entre fichas (645bf78e e "BINOCULO 6MM" numas e "Fivela Dourada
-- 10.7mm" noutras). O nome no jsonb e um retrato do momento em que a linha foi
-- criada, nao a identidade — quem manda e o ID. O painel avisa quando isso
-- acontece, porque religar em massa pode por a peca errada em parte das fichas.

CREATE OR REPLACE FUNCTION public.list_orphan_direct_components()
 RETURNS TABLE(
   dead_product_id uuid,
   names           text[],
   sheets_count    integer,
   sheet_names     text[],
   quantities      numeric[]
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (dc ->> 'product_id')::uuid                                  AS dead_product_id,
         array_agg(DISTINCT btrim(COALESCE(dc ->> 'product_name', ''))) AS names,
         count(DISTINCT ts.id)::int                                   AS sheets_count,
         array_agg(DISTINCT COALESCE(NULLIF(btrim(ts.name), ''), ts.code)) AS sheet_names,
         array_agg(DISTINCT COALESCE((dc ->> 'quantity')::numeric, 0)) AS quantities
    FROM public.technical_sheets ts,
         LATERAL jsonb_array_elements(ts.direct_components) dc
   WHERE ts.direct_components IS NOT NULL
     AND jsonb_typeof(ts.direct_components) = 'array'
     AND dc ->> 'product_id' IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.products p
            WHERE p.id = (dc ->> 'product_id')::uuid)
   GROUP BY 1
   ORDER BY 3 DESC;
$function$;

COMMENT ON FUNCTION public.list_orphan_direct_components() IS
  'Componentes diretos cujo produto foi apagado, agrupados pelo product_id morto. '
  'names vem com MAIS DE UM valor quando o mesmo ID foi gravado com nomes '
  'diferentes entre fichas — o nome no jsonb e retrato do momento, nao identidade.';

CREATE OR REPLACE FUNCTION public.relink_direct_component(
  p_dead_product_id uuid,
  p_new_product_id  uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_name text;
  v_sheets   integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT p.name INTO v_new_name FROM public.products p WHERE p.id = p_new_product_id;
  IF v_new_name IS NULL THEN
    RAISE EXCEPTION 'Produto destino % não existe', p_new_product_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_dead_product_id) THEN
    RAISE EXCEPTION 'Produto % ainda existe — isto religa apenas vínculo órfão', p_dead_product_id;
  END IF;

  -- Troca product_id/product_name em cada elemento que aponta pro morto,
  -- PRESERVANDO quantity e unit_price da linha (sao dados da ficha, nao do
  -- produto). Reconstroi o array inteiro pra manter a ordem dos componentes.
  WITH alvo AS (
    SELECT ts.id
      FROM public.technical_sheets ts
     WHERE ts.direct_components IS NOT NULL
       AND jsonb_typeof(ts.direct_components) = 'array'
       AND ts.direct_components @> jsonb_build_array(
             jsonb_build_object('product_id', p_dead_product_id::text))
  ), novos AS (
    SELECT a.id,
           (SELECT jsonb_agg(
                     CASE WHEN dc ->> 'product_id' = p_dead_product_id::text
                          THEN dc
                               || jsonb_build_object('product_id', p_new_product_id::text)
                               || jsonb_build_object('product_name', v_new_name)
                          ELSE dc END
                     ORDER BY ord)
              FROM jsonb_array_elements(ts.direct_components) WITH ORDINALITY AS t(dc, ord)
           ) AS lista
      FROM alvo a JOIN public.technical_sheets ts ON ts.id = a.id
  ), upd AS (
    UPDATE public.technical_sheets ts
       SET direct_components = n.lista, updated_at = now()
      FROM novos n WHERE ts.id = n.id AND n.lista IS NOT NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_sheets FROM upd;

  RETURN jsonb_build_object(
    'dead_product_id', p_dead_product_id,
    'new_product_id',  p_new_product_id,
    'new_product_name', v_new_name,
    'sheets_updated',  v_sheets
  );
END;
$function$;

COMMENT ON FUNCTION public.relink_direct_component(uuid, uuid) IS
  'Aponta o componente direto orfao para um produto existente em TODAS as fichas '
  'de uma vez. Preserva quantity/unit_price de cada linha (sao da ficha) e a ordem '
  'dos componentes. Recusa se o produto "morto" ainda existir.';
