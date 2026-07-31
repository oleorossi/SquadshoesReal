-- Tira a cor repetida do NOME do produto (cor é fonte única em products.color)
-- ============================================================================
-- 92 produtos ativos tinham a cor escrita no nome ("NAPA SOFT: NUDE") além de
-- gravada em `products.color`. Origem: o campo Cor tinha sido removido do
-- formulário de item, então não havia onde corrigir — e o `stripColorFromName`
-- só rodava ao ABRIR o form, nunca ao salvar. Ambos corrigidos em bd1faf3.
--
-- ⚠ GUARD — por que isto NÃO é um UPDATE cego:
-- `resolve_material_product` tenta `exact_color` e, falhando, cai em
-- `partial_name`, que casa a cor do PV contra o NOME do produto. Medido em
-- 31/07: 7 combinações de produção dependem disso como APELIDO DE COR —
-- o PV pede "OURO" e o produto é "OURO LIGHT"; pede "TAN" e o produto é
-- "NEW TAN"; pede "BRANCO" e o produto é "CRISTAL COM FUNDO BRANCO". Limpar o
-- nome desses faria a resolução cair pra `color_mismatch`, e o débito PULARIA o
-- componente marcando `erro_reserva`.
--
-- O guard abaixo deriva esses casos do DADO (não é lista fixa): protege todo
-- produto cujo nome atual contém uma cor em uso que o nome limpo perderia E que
-- não tem produto de cor exata no grupo pra assumir. Resultado medido:
-- 84 limpezas seguras, 7 protegidos.
--
-- Os 7 protegidos são dívida de cadastro, não de nome: a correção certa é o PV
-- pedir a cor exata (ou o produto ganhar a cor que o PV pede). Ficam listados
-- em audit_logs pra virar tarefa.

SET search_path TO public, extensions;

DO $$
DECLARE v_limpos integer; v_protegidos jsonb;
BEGIN
  CREATE TEMP TABLE _cores_em_uso ON COMMIT DROP AS
    select distinct btrim(color) as cor from public.sale_order_items where coalesce(btrim(color),'')<>''
    union select distinct btrim(color) from public.orders where coalesce(btrim(color),'')<>''
    union select distinct btrim(color) from public.products where active and coalesce(btrim(color),'')<>'';

  CREATE TEMP TABLE _mudam ON COMMIT DROP AS
    select p.id, p.name, p.color, g.name as grupo,
           btrim(regexp_replace(p.name,
             '\s*[:\-–]\s*' || regexp_replace(p.color, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\s*$',
             '', 'i')) as nome_limpo
      from public.products p join public.product_groups g on g.id = p.group_id
     where p.active and coalesce(btrim(p.color),'') <> '';
  DELETE FROM _mudam WHERE nome_limpo = name OR nome_limpo = '';

  CREATE TEMP TABLE _protegidos ON COMMIT DROP AS
    select distinct m.id, m.name, m.grupo, c.cor as apelido
      from _mudam m join _cores_em_uso c on true
     where lower(unaccent(m.name))       like '%'||lower(unaccent(c.cor))||'%'
       and lower(unaccent(m.nome_limpo)) not like '%'||lower(unaccent(c.cor))||'%'
       and not exists (
         select 1 from public.products p2 join public.product_groups g2 on g2.id = p2.group_id
          where p2.active and g2.name = m.grupo
            and lower(btrim(unaccent(coalesce(p2.color,'')))) = lower(btrim(unaccent(c.cor))));

  UPDATE public.products p
     SET name = m.nome_limpo, updated_at = now()
    FROM _mudam m
   WHERE p.id = m.id
     AND m.id NOT IN (SELECT id FROM _protegidos);
  GET DIAGNOSTICS v_limpos = ROW_COUNT;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'produto', name, 'grupo', grupo, 'apelido_de_cor_em_uso', apelido)), '[]'::jsonb)
    INTO v_protegidos FROM _protegidos;

  BEGIN
    INSERT INTO public.audit_logs (action, resource, resource_id, new_data, success)
    VALUES ('strip_color_from_product_names', 'products', 'migration-20261027120300',
      jsonb_build_object(
        'nomes_limpos', v_limpos,
        'protegidos', v_protegidos,
        'nota', 'Protegidos dependem de partial_name como apelido de cor. Corrigir o cadastro (PV pedir a cor exata ou produto ganhar a cor pedida) e só então limpar o nome.'),
      true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RAISE NOTICE '% nomes limpos, % protegidos pelo apelido de cor', v_limpos, jsonb_array_length(v_protegidos);
END
$$;
