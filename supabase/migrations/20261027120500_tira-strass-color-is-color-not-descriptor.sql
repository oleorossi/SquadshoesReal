-- TIRA STRASS 6MM: o campo cor guarda COR, o descritor do material vai pro nome
-- ============================================================================
-- O grupo tinha as cores gravadas como "PRETO COM FUNDO PRETO",
-- "CRISTAL COM FUNDO BRANCO" e "ROSADO COM FUNDO ROSADO" — descritor de material
-- dentro do campo `color`. Como o PV pede a cor da sandália ("PRETO"),
-- `resolve_material_product` não achava `exact_color` e caía em `partial_name`,
-- casando a cor contra o NOME do produto.
--
-- Medido em 31/07, ANTES:
--   PRETO  → partial_name   (funcionava por acaso, pelo nome)
--   BRANCO → partial_name   (idem)
--   ROSADO → color_mismatch ← JÁ ESTAVA QUEBRADO: resolvia pro produto BRANCO,
--            e `hybrid_debit_stock_for_order` PULA linha com color_mismatch.
--            Ou seja, sandália rosada com tira strass não reservava a tira,
--            mesmo existindo "ROSADO COM FUNDO ROSADO" no grupo.
--
-- Das 4 cores que dependiam de apelido no cadastro inteiro, só PRETO tem demanda
-- real (126 PVs/OPs). OURO/TAN/BRANCO não aparecem em nenhum PV — eram
-- combinações hipotéticas de grupo × cor, não demanda. Por isso a correção é
-- cirúrgica: só este grupo.
--
-- Depois disso as 3 resolvem por `exact_color`, sem depender do nome.

UPDATE public.products
   SET name = 'Tira Strass 6mm Preto com fundo preto', color = 'PRETO', updated_at = now()
 WHERE active AND upper(btrim(color)) = 'PRETO COM FUNDO PRETO';

UPDATE public.products
   SET name = 'Tira Strass 6mm Cristal com fundo branco', color = 'BRANCO', updated_at = now()
 WHERE active AND upper(btrim(color)) = 'CRISTAL COM FUNDO BRANCO';

UPDATE public.products
   SET name = 'Tira Strass 6mm Rosado com fundo rosado', color = 'ROSADO', updated_at = now()
 WHERE active AND upper(btrim(color)) = 'ROSADO COM FUNDO ROSADO';
