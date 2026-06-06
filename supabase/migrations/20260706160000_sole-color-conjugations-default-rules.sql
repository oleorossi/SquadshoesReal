-- Regra padrão de coligação cabedal→palmilha para TODOS os solados exceto 238:
--   - cabedal PRETO  → palmilha PRETO
--   - cabedal *      → palmilha CARAMELO (default)
--
-- Pedido do user em 2026-06-06: "tirando o solado 238, todos os outros solados
-- só existem na cor preta quando o cabedal ou forração é preto. E caramelo
-- nas demais cores."
--
-- Solado 238 é exceção (mantém comportamento atual, sem regra default).
-- Aplica em todos os product_groups que têm pelo menos 1 produto ativo da
-- categoria Solado vinculado, EXCETO o grupo 238.
--
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-06-06.

-- (1) PRETO→PRETO (idempotente: só insere se não existe regra PRETO pro grupo)
INSERT INTO public.sole_color_conjugations
  (sole_group_id, cabedal_color, palmilha_color, is_default, active)
SELECT g.id, 'PRETO', 'PRETO', false, true
FROM public.product_groups g
WHERE EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.group_id = g.id
    AND p.active = true
    AND p.category ILIKE '%solado%'
)
AND g.id != 'e5e101bb-e6af-4c9a-92c7-1bbaf3be71b7'
AND NOT EXISTS (
  SELECT 1 FROM public.sole_color_conjugations c
  WHERE c.sole_group_id = g.id
    AND UPPER(c.cabedal_color) = 'PRETO'
);

-- (2) *→CARAMELO como default (idempotente: não toca grupos que já têm default)
INSERT INTO public.sole_color_conjugations
  (sole_group_id, cabedal_color, palmilha_color, is_default, active)
SELECT g.id, '*', 'CARAMELO', true, true
FROM public.product_groups g
WHERE EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.group_id = g.id
    AND p.active = true
    AND p.category ILIKE '%solado%'
)
AND g.id != 'e5e101bb-e6af-4c9a-92c7-1bbaf3be71b7'
AND NOT EXISTS (
  SELECT 1 FROM public.sole_color_conjugations c
  WHERE c.sole_group_id = g.id AND c.is_default = true
);

-- (3) Normaliza grafia do default antigo do SALTINHO BLOCO (Caramelo → CARAMELO)
UPDATE public.sole_color_conjugations
   SET palmilha_color = 'CARAMELO'
 WHERE sole_group_id = '9e1db20b-49dc-43a1-933e-63bdabc67dde'
   AND cabedal_color = '*'
   AND palmilha_color = 'Caramelo';
