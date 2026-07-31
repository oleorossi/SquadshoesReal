-- Largura canônica no GRUPO, derivada dos itens que já concordam entre si
-- ============================================================================
-- A decisão "o grupo manda na largura" (31/07) ficou meio construída: o
-- ProductFormDialog já propaga `dimensions_*` do grupo pro item novo, e o
-- GroupCreateDialog passou a exigir a largura na criação — mas os grupos de área
-- que JÁ existiam continuaram com `product_groups.dimensions_width` vazio. Item
-- novo criado neles não herdava nada.
--
-- Backfill conservador: só preenche onde TODOS os itens do grupo já concordam
-- numa largura (`min = max`), usando GREATEST(width, length) — a mesma régua do
-- motor de consumo, que é imune a lado trocado. Grupo com itens divergindo fica
-- de fora de propósito: ali a largura é decisão humana, não dedução.
--
-- Medido em 31/07: NAPA SANTORINE (10 itens), NAPA TITANIUM (3) e
-- NEW VELVET PRETO (2), todos unânimes em 1370 mm.

UPDATE public.product_groups g
   SET dimensions_width = sub.dim,
       dimensions_unit  = COALESCE(NULLIF(g.dimensions_unit, ''), 'mm'),
       updated_at = now()
  FROM (
    SELECT p.group_id,
           MIN(GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0))) AS dim
      FROM public.products p
      JOIN public.component_sheets cs ON cs.product_id = p.id
     WHERE p.active
     GROUP BY p.group_id
    HAVING MIN(GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0)))
         = MAX(GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0)))
       AND MIN(GREATEST(COALESCE(cs.dimensions_width, 0), COALESCE(cs.dimensions_length, 0))) > 0
  ) sub
 WHERE g.id = sub.group_id
   AND g.sector IN ('Cabedal', 'Forração da Palmilha', 'Palmilha')
   AND COALESCE(g.dimensions_width, 0) = 0;

-- Os grupos de napa que JÁ tinham valor traziam o lado trocado (1370 × 1000) —
-- o mesmo defeito que a mig 20261027120200 corrigiu nas fichas de componente,
-- só que na origem. Como item novo herda o `dimensions_width` do GRUPO, deixar
-- 1000 aqui plantaria a largura errada em todo item futuro.
-- (Não afeta consumo do que já existe: o motor usa GREATEST dos dois lados.)
UPDATE public.product_groups
   SET dimensions_length = 1000, dimensions_width = 1370, dimensions_unit = 'mm', updated_at = now()
 WHERE upper(btrim(name)) IN ('NAPA SOFT', 'NAPA SUDANI', 'GLOW METALIC', 'NAPA MADRID')
   AND (COALESCE(dimensions_length, 0) <> 1000 OR COALESCE(dimensions_width, 0) <> 1370);
