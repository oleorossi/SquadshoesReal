-- =============================================================================
-- Falta de material POR SETOR — a confirmação do apontamento só pergunta ao
-- setor que consome o material em falta
-- =============================================================================
--
-- Pedido do dono (11/10/2026): hoje o Kanban pergunta "Falta 12 m de NAPA PRETO
-- — o setor vai iniciar com material parcial" em QUALQUER setor, inclusive
-- Acabamento e Expedição, que não encostam naquela napa. "Nos setores que não
-- utilizam o material deve passar sem perguntar."
--
-- O que NÃO muda:
--   * o selo "Falta material" do card e da lista de PVs continua por PV
--     (`list_sale_order_material_shortages`, mig 20270101036500, assinatura
--     intacta) — a visão do PV é a visão do dono;
--   * nada aqui debita, reserva ou move estoque. Continua valendo a decisão
--     escrita na `20270101015500_preservar_snapshot_historico_e_setor_consumo`:
--     **setor de consumo é informação de apresentação/rastreabilidade**, e a
--     baixa automática por entrada no setor NÃO foi aprovada (aquela migration
--     dropou `trg_assign_reservation_consumption_sector` e
--     `trg_ab_debit_materials_when_sector_starts`). Esta função é LEITURA: ela
--     decide a quem PERGUNTAR, não a quem DEBITAR.
--
-- Por que existe um fallback por componente:
--   a mesma 15500 registra que "somente direct_components e sheet_materials
--   possuem roteamento explícito; cabedal/forro/palmilha/solado preservam o
--   contexto legado". Na prática TODAS as reservas com `quantity_short > 0`
--   estão hoje SEM `metadata->>'consumption_sector'` — se a função exigisse o
--   setor explícito, ela devolveria vazio e o aviso simplesmente desapareceria
--   da fábrica. Então o setor é resolvido em três degraus:
--     a) `consumption_sector` explícito no metadata  → sector_source='explicito'
--     b) mapa canônico por `metadata->>'component'`  → sector_source='componente'
--     c) componente fora do mapa                     → setor NULL, 'desconhecido'
--
-- ⚠ FAIL-SAFE — a regra mais importante deste arquivo:
--   linha de setor DESCONHECIDO entra na resposta de QUALQUER setor. Nunca se
--   esconde um aviso que não se sabe de quem é. É por isso que o `ELSE
--   'Aviamento'` do fallback de `resolve_consumption_sector` foi retirado DE
--   PROPÓSITO deste mapa: chutar 'Aviamento' para 'Componente Direto' ou
--   'Item padrão (solado)' calaria o aviso exatamente em Colagem e Solagem,
--   onde esses materiais podem ser consumidos. Errar avisando demais custa um
--   clique; errar calando custa material que o chão de fábrica não tem.
--
-- ⚠ UM componente por reserva NÃO SERVE para o empenho do PV — o rótulo é
--   AGREGADO. `commit_sale_order_material_demand` (20270101035100) faz
--
--       SELECT d.product_id, sum(d.required), min(d.component)
--         FROM sale_order_material_demand_lines(pv) d GROUP BY d.product_id
--
--   e grava esse `min(component)` no metadata — inclusive quando ADOTA uma
--   reserva de OP que tinha o rótulo fino. Ou seja: uma reserva por
--   (PV, produto), com o nome de UM dos componentes que consomem aquele SKU.
--   No caso que o CLAUDE.md descreve em "Invariante anti-duplicidade"
--   (`suppressCabedalForracao`) a mesma napa é forro de cabedal E forração de
--   palmilha: `min()` escolhe 'Cabedal', e um filtro por esse rótulo único
--   esconderia a falta em 'Palmilha · Forração' — o operador começaria o corte
--   da forração sem napa, com a falta inteira anunciada no setor errado. O
--   fail-safe do NULL não protege aqui, porque o rótulo EXISTE e está no mapa.
--   Por isso, para reserva de rótulo agregado (`kind` 'pv_commitment' /
--   'atelier_prep'), o CONJUNTO de componentes vem da própria função de demanda
--   que gerou a reserva, e a linha vale para TODOS os setores do conjunto.
--   A função de demanda só é chamada quando existe reserva desse tipo em falta.
--
-- ⚠ PENDÊNCIA DE CADASTRO/PRODUTO — onde o forro de CABEDAL é cortado:
--   o fallback legado de `resolve_consumption_sector` (20261231122000) manda
--   'forração' para 'Corte Cabedal', mas o modelo da Fila de Corte diz o
--   contrário: `src/lib/corteLookahead.ts` liga o setor 'Corte Forração' ao kind
--   `lining` e o resolve por `lining_material_product_id` (o forro do CABEDAL),
--   `src/lib/buyList.ts` põe 'Forração' e 'Forração Palmilha' no MESMO bucket,
--   e o próprio `canonical_stage_name` manda o setor 'Forração' para
--   'Palmilha · Forração'. Os dois modelos nunca foram reconciliados — é
--   decisão do dono, não de engenharia. Enquanto não houver decisão, NÃO se
--   chuta: 'forração' vale nos DOIS setores (avisa no Corte Cabedal e na
--   Palmilha · Forração). Hoje é latente (nenhuma linha em falta tem esse
--   componente); vira vivo na primeira ficha com `lining_consumption_dm2` e
--   `insole_lining_consumption_dm2` preenchidos.
--
-- ⚠ O mapa emite a grafia canônica da época em que foi escrito ('Corte Fibra',
--   'Corte Forração') e o resultado passa por `canonical_stage_name`, igual ao
--   nome do setor que a tela manda. Assim o renome de setores
--   (20270101026400 / 20270101029000: 'Corte Fibra' → 'Palmilha · Fibra',
--   'Corte Forração' → 'Palmilha · Forração', 'Costura Palmilha' →
--   'Acabamento Palmilha') não transforma a comparação num mismatch silencioso
--   que esconderia o aviso do setor que de fato corta aquele material.
--   ⚠ `canonical_stage_name(NULL)` devolve '' (não NULL): o setor sem mapa é
--   mantido NULL por CASE explícito, senão o fail-safe viraria um '' que não
--   casa com setor nenhum e calaria o aviso.
-- =============================================================================

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.canonical_stage_name(text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight: public.canonical_stage_name(text) ausente';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.material_reservation_is_pv_managed(public.material_reservations)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight: predicado do motor de empenho ausente';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.sale_order_material_demand_lines(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Preflight: linhas de demanda do PV ausentes';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.list_sale_order_material_shortages(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Preflight: falta por PV (20270101036500) ausente';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.list_order_sector_material_shortages(
  p_order_id uuid,
  p_stage_name text
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  color text,
  unit text,
  quantity_short numeric,
  shortage_grade jsonb,
  consumption_sector text,
  sector_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ctx AS (
    -- A guarda de acesso mora aqui: sem ela a OP inteira vazaria por `order_id`.
    SELECT o.sale_order_id AS so_id
      FROM public.orders o
     WHERE o.id = p_order_id
       AND public.is_approved_user()
  ),
  stage AS (
    SELECT public.canonical_stage_name(p_stage_name) AS want
  ),
  base AS (
    -- Reserva da OP **e** empenho do PV (`pv_commitment` tem order_id NULL, e é
    -- justamente onde vive a falta de hoje).
    SELECT mr.id AS rid,
           mr.product_id,
           COALESCE(mr.quantity_short, 0) AS quantity_short,
           mr.metadata -> 'shortage_grade' AS shortage_grade,
           NULLIF(pg_catalog.btrim(COALESCE(mr.metadata ->> 'consumption_sector', '')), '')
             AS explicit_sector,
           lower(pg_catalog.btrim(COALESCE(mr.metadata ->> 'component', ''))) AS component,
           -- Rótulo escrito por commit_sale_order_material_demand = min() sobre
           -- TODOS os componentes do SKU no PV. Ver o aviso do topo.
           COALESCE(mr.metadata ->> 'kind', '') IN ('pv_commitment', 'atelier_prep')
             AS label_is_aggregated
      FROM public.material_reservations mr
     WHERE mr.quantity_short > 0
       AND public.material_reservation_is_pv_managed(mr)
       AND EXISTS (SELECT 1 FROM ctx)
       AND (
             mr.order_id = p_order_id
             OR (mr.sale_order_id IS NOT NULL
                 AND mr.sale_order_id = (SELECT c.so_id FROM ctx c))
           )
  ),
  -- Fallback canônico por componente (espelho de resolve_consumption_sector)
  -- **sem** o `ELSE 'Aviamento'`: componente ausente desta tabela fica com setor
  -- NULL e avisa em todo setor. Um componente pode valer para MAIS DE UM setor
  -- (ver a pendência da 'forração' no topo).
  component_sector_map (component, sector) AS (
    VALUES ('solado'::text,          'Solagem'::text),
           ('palmilha',              'Corte Fibra'),
           ('forração palmilha',     'Corte Forração'),
           ('forracao palmilha',     'Corte Forração'),
           ('cabedal',               'Corte Cabedal'),
           ('forração',              'Corte Cabedal'),
           ('forração',              'Corte Forração'),
           ('forracao',              'Corte Cabedal'),
           ('forracao',              'Corte Forração'),
           ('fachete',               'Aviamento'),
           ('tiras',                 'Aviamento'),
           ('químicos',              'Colagem'),
           ('quimicos',              'Colagem'),
           ('embalagem',             'Acabamento')
  ),
  demand AS (
    -- Componentes REAIS do SKU neste PV, para desfazer o `min(component)` do
    -- empenho. O LATERAL só executa quando a subquery de fora devolve linha —
    -- ou seja, só quando existe reserva de rótulo agregado em falta.
    SELECT DISTINCT d.product_id,
           lower(pg_catalog.btrim(COALESCE(d.component, ''))) AS component
      FROM (
        SELECT c.so_id
          FROM ctx c
         WHERE EXISTS (
                 SELECT 1 FROM base b
                  WHERE b.label_is_aggregated
                    AND b.explicit_sector IS NULL
               )
      ) s
      CROSS JOIN LATERAL public.sale_order_material_demand_lines(s.so_id) d
     WHERE d.product_id IN (
             SELECT b.product_id FROM base b WHERE b.label_is_aggregated
           )
  ),
  line_components AS (
    -- Rótulo fino (reserva de OP): um componente, como gravado.
    SELECT b.rid, b.component
      FROM base b
     WHERE b.explicit_sector IS NULL
       AND NOT b.label_is_aggregated
    UNION
    -- Rótulo agregado: o conjunto de componentes da demanda do PV.
    SELECT b.rid, d.component
      FROM base b
      JOIN demand d ON d.product_id = b.product_id
     WHERE b.explicit_sector IS NULL
       AND b.label_is_aggregated
    UNION
    -- Agregado cujo produto não aparece mais na demanda (ex.: solado, que a
    -- função de demanda exclui): mantém o rótulo gravado.
    SELECT b.rid, b.component
      FROM base b
     WHERE b.explicit_sector IS NULL
       AND b.label_is_aggregated
       AND NOT EXISTS (SELECT 1 FROM demand d WHERE d.product_id = b.product_id)
  ),
  line_sectors AS (
    SELECT b.rid,
           public.canonical_stage_name(b.explicit_sector) AS sector,
           'explicito'::text AS source
      FROM base b
     WHERE b.explicit_sector IS NOT NULL
    UNION ALL
    SELECT lc.rid,
           -- canonical_stage_name(NULL) = '': o não-mapeado PRECISA ficar NULL.
           CASE WHEN m.sector IS NULL THEN NULL
                ELSE public.canonical_stage_name(m.sector) END,
           CASE WHEN m.sector IS NULL THEN 'desconhecido' ELSE 'componente' END
      FROM line_components lc
      LEFT JOIN component_sector_map m ON m.component = lc.component
  ),
  per_reservation AS (
    SELECT ls.rid,
           COALESCE(bool_or(ls.sector = (SELECT s.want FROM stage s)), false) AS matched_want,
           COALESCE(bool_or(ls.sector IS NULL), false) AS has_unknown,
           COALESCE(bool_or(ls.source = 'explicito'), false) AS has_explicit
      FROM line_sectors ls
     GROUP BY ls.rid
  ),
  kept AS (
    -- FAIL-SAFE: setor NULL (desconhecido) avisa em TODO setor.
    SELECT b.product_id,
           b.quantity_short,
           b.shortage_grade,
           CASE WHEN pr.matched_want THEN (SELECT s.want FROM stage s) END AS consumption_sector,
           CASE WHEN pr.has_explicit  THEN 'explicito'
                WHEN pr.matched_want  THEN 'componente'
                ELSE 'desconhecido' END AS sector_source
      FROM base b
      JOIN per_reservation pr ON pr.rid = b.rid
     WHERE pr.matched_want OR pr.has_unknown
  ),
  grade_cells AS (
    SELECT k.product_id, e.key, sum(e.value::numeric) AS qty
      FROM kept k
      CROSS JOIN LATERAL jsonb_each_text(
        CASE WHEN jsonb_typeof(k.shortage_grade) = 'object'
             THEN k.shortage_grade ELSE '{}'::jsonb END) e
     WHERE e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
     GROUP BY k.product_id, e.key
    HAVING sum(e.value::numeric) > 0
  ),
  per_grade AS (
    SELECT gc.product_id, jsonb_object_agg(gc.key, gc.qty ORDER BY gc.key) AS grade
      FROM grade_cells gc
     GROUP BY gc.product_id
  ),
  per_product AS (
    -- Mesma semântica da 036500: uma linha por MATERIAL, somando as reservas.
    SELECT k.product_id,
           sum(k.quantity_short) AS quantity_short,
           -- O filtro acima já limitou os valores a {NULL, setor pedido}:
           -- max() devolve o setor quando alguma linha é dele, senão NULL.
           max(k.consumption_sector) AS consumption_sector,
           CASE
             WHEN bool_or(k.sector_source = 'explicito')  THEN 'explicito'
             WHEN bool_or(k.sector_source = 'componente') THEN 'componente'
             ELSE 'desconhecido'
           END AS sector_source
      FROM kept k
     GROUP BY k.product_id
  )
  SELECT pp.product_id,
         COALESCE(p.name, 'Material'),
         p.color,
         p.unit,
         pp.quantity_short,
         pg.grade,
         pp.consumption_sector,
         pp.sector_source
    FROM per_product pp
    LEFT JOIN public.products p ON p.id = pp.product_id
    LEFT JOIN per_grade pg ON pg.product_id IS NOT DISTINCT FROM pp.product_id
   WHERE pp.quantity_short > 0 OR pg.grade IS NOT NULL
   ORDER BY COALESCE(p.name, ''), pp.product_id;
$$;

COMMENT ON FUNCTION public.list_order_sector_material_shortages(uuid, text) IS
  'Falta de material da OP/PV filtrada pelo setor que CONSOME a linha, para a '
  'confirmação de apontamento do Kanban. Setor vem do metadata explícito, '
  'senão do mapa canônico por componente — e, no empenho do PV (rótulo '
  'min(component), agregado), do CONJUNTO de componentes da demanda do PV. '
  'Componente fora do mapa fica com setor NULL e avisa em TODO setor '
  '(fail-safe — nunca esconder aviso de dono desconhecido). Leitura apenas: '
  'setor de consumo segue sendo apresentação/rastreabilidade (20270101015500), '
  'não gatilho de baixa.';

REVOKE ALL ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  TO authenticated, service_role;
