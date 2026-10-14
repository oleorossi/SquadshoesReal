-- Matriz de estoque de solado por numeração + pedidos que consomem.
--
-- Spec: specs/estoque-solado-por-numeracao.md (R1, R2, R4, R5, R6).
--
-- Problema: a aba Estoque de /solados mostrava a quantidade BRUTA por numeração.
-- Medido em 01 CARAMELO (SL01-02): o 36 tem 170 pares e 170 empenhados, o 37 tem
-- 440 e 440 empenhados — Livre = 0 nos dois, e a tela pintava os dois de verde.
-- O 38 e o 39 estavam igualmente esgotados, sem nenhum sinal.
--
-- O dado sempre existiu: Σ material_reservations.metadata->'covered_grade' por
-- numeração = 1.404 = products.reserved_stock. Nunca foi lido por numeração.
--
-- Estas duas funções são de LEITURA. Não debitam, não reservam, não criam OC.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. sole_stock_matrix — uma linha por numeração
-- ───────────────────────────────────────────────────────────────────────────
--
-- ⚠ `Empenhado` conta SÓ PV em produção (decisão do dono): é o material que
--   precisa estar dentro da fábrica agora. `Projetado carteira` é a linha que
--   olha a carteira inteira — ver nota em projetado_carteira abaixo.
CREATE OR REPLACE FUNCTION public.sole_stock_matrix(p_product_id uuid)
RETURNS TABLE (
  size_key text,
  size_ord integer,
  estoque numeric,
  empenhado numeric,
  livre numeric,
  falta numeric,
  em_compra numeric,
  projetado numeric,
  projetado_carteira numeric,
  a_pedir numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH alvo AS (
    -- A guarda de acesso mora aqui: sem ela o estoque de qualquer produto
    -- vazaria por `product_id`.
    SELECT pr.id, pr.stock_grade
      FROM public.products pr
     WHERE pr.id = p_product_id
       AND public.is_approved_user()
  ),
  abertos AS (
    SELECT so.id
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
  ),
  estoque_cte AS (
    SELECT g.key AS size_key, g.value::numeric AS qty
      FROM alvo, LATERAL jsonb_each_text(COALESCE(alvo.stock_grade, '{}'::jsonb)) g
     WHERE left(g.key, 1) <> '_'
  ),
  -- Reservas de solado dos PVs EM PRODUÇÃO deste produto.
  res AS (
    SELECT mr.metadata AS md
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
      LEFT JOIN public.sale_orders so ON so.id = COALESCE(mr.sale_order_id, o.sale_order_id)
     WHERE mr.product_id = (SELECT id FROM alvo)
       AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
       AND public.material_reservation_is_pv_managed(mr)
       AND so.status = 'Em Produção'
  ),
  empenhado_cte AS (
    SELECT g.key AS size_key, sum(g.value::numeric) AS qty
      FROM res, LATERAL jsonb_each_text(COALESCE(res.md -> 'covered_grade', '{}'::jsonb)) g
     GROUP BY g.key
  ),
  falta_cte AS (
    SELECT g.key AS size_key, sum(g.value::numeric) AS qty
      FROM res, LATERAL jsonb_each_text(COALESCE(res.md -> 'shortage_grade', '{}'::jsonb)) g
     GROUP BY g.key
  ),
  -- Em compra: mesma condição de status que product_supply_summary usa, para
  -- os dois números não divergirem. 'suggested' NÃO conta — não é compromisso.
  compra_cte AS (
    SELECT g.key AS size_key, sum(g.value::numeric) AS qty
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id,
           LATERAL jsonb_each_text(COALESCE(poi.grade, '{}'::jsonb)) g
     WHERE poi.product_id = (SELECT id FROM alvo)
       AND po.status NOT IN ('cancelled', 'received', 'suggested', 'draft')
     GROUP BY g.key
  ),
  -- Consumo da CARTEIRA ABERTA pelo motor de DEMANDA (não pela reserva): PV
  -- aprovado não tem reserva de solado, então o consumo dele só existe aqui.
  -- ⚠ Fonte ÚNICA desta linha — não somar reserva + demanda, senão um PV
  --   aprovado que ganhe reserva é contado duas vezes.
  carteira_cte AS (
    SELECT g.key AS size_key, sum(g.value::numeric) AS qty
      FROM public.compute_allocated_per_pv_purchase_need_lines(
             ARRAY(SELECT id FROM abertos),
             ARRAY(SELECT id FROM alvo)) l,
           LATERAL jsonb_each_text(COALESCE(l.grade, '{}'::jsonb)) g
     GROUP BY g.key
  ),
  keys AS (
    SELECT size_key FROM estoque_cte
    UNION SELECT size_key FROM empenhado_cte
    UNION SELECT size_key FROM falta_cte
    UNION SELECT size_key FROM compra_cte
    UNION SELECT size_key FROM carteira_cte
  )
  SELECT k.size_key,
         -- Ordena pelo PRIMEIRO número do balde: '33/34' ordena como 33, não 3334.
         NULLIF(regexp_replace(split_part(k.size_key, '/', 1), '\D', '', 'g'), '')::integer AS size_ord,
         COALESCE(e.qty, 0)  AS estoque,
         COALESCE(em.qty, 0) AS empenhado,
         COALESCE(e.qty, 0) - COALESCE(em.qty, 0) AS livre,
         COALESCE(f.qty, 0)  AS falta,
         COALESCE(c.qty, 0)  AS em_compra,
         COALESCE(e.qty, 0) - COALESCE(em.qty, 0) - COALESCE(f.qty, 0) + COALESCE(c.qty, 0) AS projetado,
         COALESCE(e.qty, 0) - COALESCE(ca.qty, 0) + COALESCE(c.qty, 0) AS projetado_carteira,
         -- A pedir: múltiplo de 10 para cima (regra do dono — o fornecedor não
         -- tem caixa fechada; o arredondamento é hábito de compra). 84 → 90.
         CASE WHEN COALESCE(f.qty, 0) > 0
              THEN ceil(COALESCE(f.qty, 0) / 10.0) * 10
              ELSE 0 END AS a_pedir
    FROM keys k
    LEFT JOIN estoque_cte   e  ON e.size_key  = k.size_key
    LEFT JOIN empenhado_cte em ON em.size_key = k.size_key
    LEFT JOIN falta_cte     f  ON f.size_key  = k.size_key
    LEFT JOIN compra_cte    c  ON c.size_key  = k.size_key
    LEFT JOIN carteira_cte  ca ON ca.size_key = k.size_key
   ORDER BY size_ord NULLS LAST, k.size_key;
$$;

COMMENT ON FUNCTION public.sole_stock_matrix(uuid) IS
  'Matriz de estoque de solado por numeração para a aba Estoque de /solados. '
  'Livre = Estoque − Empenhado (empenho SÓ de PV em produção). Projetado conta '
  'produção; Projetado carteira conta a carteira aberta inteira, pelo motor de '
  'DEMANDA (PV aprovado não tem reserva de solado). Spec: '
  'specs/estoque-solado-por-numeracao.md.';

REVOKE ALL ON FUNCTION public.sole_stock_matrix(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_stock_matrix(uuid)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. sole_stock_orders — uma linha por (PV, numeração)
-- ───────────────────────────────────────────────────────────────────────────
--
-- ⚠ A lista vem da RESERVA, não de um filtro por status: assim os dois blocos
--   da tela fecham por construção (Consumo total − Estoque = Projetado). Um
--   filtro paralelo por `sale_orders.status` divergiria em silêncio no dia em
--   que um PV fora de 'Em Produção' tivesse reserva.
CREATE OR REPLACE FUNCTION public.sole_stock_orders(p_product_id uuid)
RETURNS TABLE (
  sale_order_id uuid,
  order_number text,
  client_name text,
  pv_status text,
  billing_monday date,
  priority numeric,
  size_key text,
  size_ord integer,
  consumo numeric,
  falta numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH res AS (
    SELECT COALESCE(mr.sale_order_id, o.sale_order_id) AS so_id,
           mr.order_id,
           mr.sale_order_id AS mr_so_id,
           mr.metadata AS md
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
     WHERE mr.product_id = p_product_id
       AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
       AND public.material_reservation_is_pv_managed(mr)
       AND public.is_approved_user()
  ),
  celulas AS (
    -- `effective_grade` é a necessidade por balde; `covered_grade` +
    -- `shortage_grade` dividem esse mesmo balde (contrato da mig 20270101035100),
    -- então percorrer effective_grade cobre todas as células.
    SELECT res.so_id,
           g.key AS size_key,
           sum(g.value::numeric) AS consumo,
           sum(COALESCE(NULLIF(res.md -> 'shortage_grade' ->> g.key, '')::numeric, 0)) AS falta
      FROM res,
           LATERAL jsonb_each_text(COALESCE(res.md -> 'effective_grade', '{}'::jsonb)) g
     GROUP BY res.so_id, g.key
    HAVING sum(g.value::numeric) > 0
  ),
  prio AS (
    SELECT res.so_id,
           min(public.material_reservation_cover_priority(res.mr_so_id, res.order_id)) AS priority
      FROM res
     GROUP BY res.so_id
  )
  SELECT c.so_id,
         so.order_number,
         so.client_name,
         so.status,
         public.resolve_billing_week_for_order(c.so_id),
         p.priority,
         c.size_key,
         NULLIF(regexp_replace(split_part(c.size_key, '/', 1), '\D', '', 'g'), '')::integer,
         c.consumo,
         c.falta
    FROM celulas c
    LEFT JOIN public.sale_orders so ON so.id = c.so_id
    LEFT JOIN prio p ON p.so_id = c.so_id
   ORDER BY p.priority NULLS LAST, so.order_number,
            NULLIF(regexp_replace(split_part(c.size_key, '/', 1), '\D', '', 'g'), '')::integer NULLS LAST;
$$;

COMMENT ON FUNCTION public.sole_stock_orders(uuid) IS
  'Pedidos que consomem um solado, por numeração, para o relatório da aba '
  'Estoque de /solados. Uma linha por (PV, numeração) com consumo '
  '(effective_grade) e a parte sem lastro (shortage_grade). Ordenado pela '
  'prioridade de cobertura. Spec: specs/estoque-solado-por-numeracao.md.';

REVOKE ALL ON FUNCTION public.sole_stock_orders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sole_stock_orders(uuid)
  TO authenticated, service_role;
