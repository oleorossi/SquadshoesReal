-- A cor das TIRAS DE STRASS passa a ser o nome comercial da tira pronta.
--
-- DECISÃO DO DONO (05/08/2026): "cristal com fundo branco é uma tira comprada pronta".
-- Tira de strass não é uma napa que se corta numa cor — é um item comprado cujo nome
-- comercial ("cristal com fundo branco") É a identidade do que se compra. Então
-- `products.color` desses grupos passa a carregar esse nome, e não uma cor-base
-- reduzida (BRANCO/PRETO/ROSADO) que não existe no catálogo do fornecedor.
--
-- O PROBLEMA QUE ISSO RESOLVE
-- Os dois grupos de strass foram cadastrados de formas opostas:
--   TIRA STRASS 6MM  → produtos com `color` preenchida (BRANCO/OFF WHITE/PRETO/ROSADO);
--                      o nome comercial ficou só no `name`.
--   TIRA STRASS 15MM → os 3 produtos com `color` VAZIA; o nome comercial é o `name`.
-- Os PVs sempre gravaram o nome comercial ("PRETO COM FUNDO PRETO"), porque é isso que
-- o operador reconhece. Como `products.color` no 6MM dizia outra coisa, a tira não
-- casava com produto nenhum.
--
-- IMPACTO MEDIDO EM PRODUÇÃO (05/08/2026), via `order_strap_needs`:
--   - 54 itens de PV no grupo 6MM ficavam com `resolved = false`: sem produto, logo
--     SEM reserva, SEM débito e SEM entrar em compra. No PV-00151 são 2 linhas de
--     64,8 m cada — 129,6 m de tira de strass invisíveis pro sistema.
--       CRISTAL COM FUNDO BRANCO → 36 itens (PV-00148/149/150 + 6 PV-2026-*)
--       ROSADO COM FUNDO ROSADO  → 14 itens (PV-00148/149/150/151)
--       PRETO COM FUNDO PRETO    →  4 itens (PV-00148/149/150/151)
--   - no grupo 15MM o efeito era PIOR que não resolver: `order_strap_needs` tem um
--     último fallback que pega `LIMIT 1` qualquer produto do grupo com cor vazia. Com
--     os 3 produtos sem cor, o PV-2026-00013 pedia "ROSA COM FUNDO ROSADO" e recebia
--     "Preto com fundo preto" — MATERIAL ERRADO, em silêncio. Preencher a cor mata
--     esse fallback arbitrário, que é o objetivo.
--
-- SEGURANÇA — verificado antes de aplicar:
--   - NENHUM PV pede BRANCO, PRETO ou ROSADO no grupo 6MM, então renomear essas três
--     cores não órfã nada (a única cor do 6MM que já resolvia é OFF WHITE, do
--     PV-00148, e ela NÃO é tocada aqui);
--   - 0 linhas de `sheet_materials` (BOM) nesses grupos;
--   - 0 regras em `component_color_defaults` nesses grupos;
--   - nenhum outro produto já usa as cores de destino (sem colisão);
--   - `products.color` não tem constraint nem índice;
--   - as 26 movimentações de estoque desses produtos referenciam `product_id`, não
--     cor — ficam intactas.
--
-- Alvo por `id`, não por nome: nome de produto não é chave e há um "TIRA STRASS 6MM"
-- genérico no mesmo grupo que NÃO deve ser tocado.
--
-- O trigger `tg_normalize_product_color` já faz UPPER(TRIM(...)); os valores abaixo
-- vão em caixa alta de propósito, pra ficarem legíveis no diff.

BEGIN;

-- ── TIRA STRASS 6MM (c45ff936-5ac5-49b5-98c4-4aed5e10e82d) ───────────────────
-- OFF WHITE (4a60b9c5-…) fica como está: é a única cor do grupo que já resolvia.

UPDATE public.products SET color = 'CRISTAL COM FUNDO BRANCO'
 WHERE id = '9962fc0e-e95c-4e0a-8162-1a21c79f64dc';  -- era BRANCO

UPDATE public.products SET color = 'PRETO COM FUNDO PRETO'
 WHERE id = 'aefd6b27-aae9-448b-918e-7d6bd3dcd5d5';  -- era PRETO

UPDATE public.products SET color = 'ROSADO COM FUNDO ROSADO'
 WHERE id = '9028a544-5de5-4798-a37b-edc3b51e82f3';  -- era ROSADO

-- ── TIRA STRASS 15MM (6e43bbda-0f1f-412c-8d4a-ec009114530d) ──────────────────
-- Cor vazia → nome comercial. Mata o fallback `LIMIT 1` que resolvia arbitrário.
-- ⚠ Aqui é ROSA (não ROSADO): o produto do 15MM chama "Rosa com fundo rosado".
-- A grafia é por grupo, e é a que os PVs desse grupo já pedem.

UPDATE public.products SET color = 'CRISTAL COM FUNDO BRANCO'
 WHERE id = 'e7056d1b-28a3-462a-b3af-f28d298194b8';

UPDATE public.products SET color = 'PRETO COM FUNDO PRETO'
 WHERE id = '6e958e62-fc9d-4bdd-be01-43561adc5b36';

UPDATE public.products SET color = 'ROSA COM FUNDO ROSADO'
 WHERE id = 'd47aaf48-644c-473d-b903-8f289270555b';

-- ── Verificação: falha a migration se o resultado não for o esperado ─────────
DO $$
DECLARE
  v_sem_cor   int;
  v_orfaos    int;
  v_off_white text;
BEGIN
  -- 1. nenhum produto ativo desses grupos pode continuar sem cor (senão o
  --    fallback arbitrário do order_strap_needs sobrevive)
  SELECT count(*) INTO v_sem_cor
    FROM public.products
   WHERE group_id IN ('c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
                      '6e43bbda-0f1f-412c-8d4a-ec009114530d')
     AND active IS NOT FALSE
     AND (color IS NULL OR trim(color) = '');
  IF v_sem_cor > 0 THEN
    RAISE EXCEPTION 'Ainda há % produto(s) de strass sem cor — o fallback LIMIT 1 continuaria vivo', v_sem_cor;
  END IF;

  -- 2. nenhuma cor de tira pedida nesses grupos pode continuar órfã
  SELECT count(*) INTO v_orfaos FROM (
    SELECT DISTINCT (s->>'group_id')::uuid AS gid, upper(trim(s->>'color')) AS cor
      FROM public.sale_order_items soi
      CROSS JOIN LATERAL jsonb_array_elements(soi.strap_colors) s
     WHERE soi.strap_colors IS NOT NULL
       AND jsonb_typeof(soi.strap_colors) = 'array'
       AND coalesce(s->>'color','') <> ''
       AND (s->>'group_id')::uuid IN ('c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
                                      '6e43bbda-0f1f-412c-8d4a-ec009114530d')
  ) pedidas
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.group_id = pedidas.gid
       AND p.active IS NOT FALSE
       AND upper(trim(coalesce(p.color,''))) = pedidas.cor);
  IF v_orfaos > 0 THEN
    RAISE EXCEPTION 'Restaram % cor(es) de tira de strass sem produto correspondente', v_orfaos;
  END IF;

  -- 3. OFF WHITE tem que ter sobrevivido intacta (é o vínculo do PV-00148)
  SELECT color INTO v_off_white FROM public.products
   WHERE id = '4a60b9c5-eacd-4cd8-82de-b8176ee217b2';
  IF v_off_white IS DISTINCT FROM 'OFF WHITE' THEN
    RAISE EXCEPTION 'OFF WHITE do 6MM foi alterada para %, mas deveria ficar intacta', v_off_white;
  END IF;
END $$;

COMMIT;

COMMENT ON COLUMN public.products.color IS
  'Cor/identidade do produto dentro do grupo. É a CHAVE de resolução de material '
  '(group_id + color) em order_strap_needs, resolve_material_product, '
  'check_stock_availability e cia. Para itens COMPRADOS PRONTOS — tiras de strass — '
  'carrega o nome comercial ("PRETO COM FUNDO PRETO"), não uma cor-base reduzida: '
  'é o que o PV grava e o que o fornecedor vende (decisão do dono, 05/08/2026). '
  'Deixar vazia é perigoso: order_strap_needs cai num fallback LIMIT 1 que resolve '
  'para um produto ARBITRÁRIO do grupo.';
