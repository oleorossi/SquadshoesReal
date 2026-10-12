-- Falta de material por setor: resolver o setor pelo CADASTRO, não só pelo rótulo
-- do componente.
--
-- Contexto: a 20270101037800 introduziu list_order_sector_material_shortages para
-- a confirmação de apontamento do Kanban só perguntar no setor que consome o
-- material. Ela resolvia o setor por um mapa de COMPONENTE (cabedal, palmilha,
-- solado…). Medido em produção (PV-00195) o mapa acerta napa, forração, palmilha e
-- solado — e deixa 4 materiais em 'desconhecido', que pelo fail-safe voltam a
-- perguntar em TODO setor, inclusive Acabamento e Expedição. Ou seja: o sintoma
-- que o dono relatou continuava vivo.
--
-- A causa é o vocabulário. Os rótulos gravados não são tokens canônicos, são
-- rótulos de UI: 'Item padrão (solado)' (as 3 colas) e 'Componente Direto'
-- (fivela) não descrevem setor nenhum.
--
-- ⚠ A COLUNA CERTA EXISTE E NÃO É A QUE O MOTOR DE FICHA LÊ. São DUAS em
-- sheet_materials, e medidas em 12/10/2026 elas são opostas:
--   · `consumption_sector` → 0 de 79 linhas preenchidas. É a que
--     private.resolve_consumption_sector_context (20270101015500) lê.
--   · `sector`             → 79 de 79 preenchidas, e já na gramática de ETAPA:
--     Colagem (33, colas), Expedição (28, caixas), Costura (14, LINHANYL),
--     Aviamento (4, tiras).
-- Esta função usa `sector`. Não troque por `consumption_sector` "pra alinhar com o
-- motor de ficha": alinharia com uma coluna vazia e devolveria tudo a 'desconhecido'.
--
-- ⚠ O rótulo 'Item padrão (solado)' NÃO pode virar Solagem. É tentador (o rótulo
-- nomeia o solado), mas o cadastro das MESMAS colas diz Colagem — mapear por
-- rótulo contrariaria o cadastro. Foi o dado que desmentiu a suposição; por isso a
-- camada de cadastro vem ANTES do mapa por rótulo, e esse rótulo não entra no mapa.
--
-- ⚠ 'Costura' é grafia MORTA (split de 20261001120000) e
-- canonical_stage_name('Costura') = 'Acabamento Palmilha', não 'Costura Cabedal'.
-- Então o LINHANYL, cadastrado 'Costura', avisa na Acabamento Palmilha. Se a linha
-- é consumida na Costura Cabedal, o conserto é no CADASTRO (sheet_materials.sector),
-- não aqui: canonicalizar diferente desta função divergiria do resto do sistema.
-- Hoje não é sintoma vivo (LINHANYL não está em falta).
--
-- ⚠ PENDÊNCIA DE CADASTRO/PRODUTO herdada da 20270101037800 e NÃO decidida: o
-- forro de CABEDAL ('forração') avisa nos DOIS setores. O mapa canônico manda pro
-- Corte Cabedal, mas `corteLookahead.ts` liga 'Corte Forração' ao kind `lining` (o
-- forro do cabedal) e `buyList.ts` põe Forração e Forração Palmilha no MESMO bucket.
-- Chutar um dos dois esconde o aviso justamente de quem corta.
--
-- ⚠ O rótulo do empenho é AGREGADO: commit_sale_order_material_demand grava
-- min(d.component) sobre TODOS os componentes que consomem o SKU no PV. Por isso o
-- ramo agregado resolve o CONJUNTO de componentes pela função de demanda do PV, em
-- vez de confiar no rótulo gravado.
--
-- ⚠ Pendência de CADASTRO do dono, medida em 12/10/2026 — estes 2 seguem em
-- 'desconhecido' e, pelo fail-safe, perguntando em todo setor:
--   · COLA  ADESIVO HOTMELT — sem grupo e sem linha em sheet_materials (chega como
--     item padrão do solado). As irmãs COLA FORTE/PVC estão em Colagem.
--   · Fivela 12mm — grupo COMPONENTES DIVERSOS sem linha em bom_part_sector_map.
-- Não são inventáveis aqui: setor de consumo é dado de engenharia. Preencher
-- sheet_materials.sector (ou bom_part_sector_map do grupo) resolve sem código novo.
--
-- Precedência (primeira camada que resolve vence):
--   1. metadata->>'consumption_sector' da reserva          → 'explicito'
--   2. sheet_materials.sector do produto                   → 'cadastro'
--   3. bom_part_sector_map pelo grupo do produto           → 'cadastro'
--   4. mapa canônico por componente (rótulo)               → 'componente'
--   5. nada resolveu                                        → NULL + 'desconhecido'
--                                                             = FAIL-SAFE, avisa em
--                                                               todo setor
--
-- ⚠ A camada 2 NÃO é restrita às fichas deste PV, de propósito: COLA FORTE chega ao
-- PV como item padrão do solado, sem linha de sheet_materials na ficha dele — filtrar
-- por ficha perderia justamente o caso que motivou a migration. E material cadastrado
-- em DOIS setores avisa nos dois (é consumido nos dois), mesma semântica da 'forração'.
--
-- Leitura apenas. Setor de consumo segue sendo apresentação/rastreabilidade
-- (decisão da 20270101015500); nada aqui dispara baixa de estoque.

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure('public.canonical_stage_name(text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight: public.canonical_stage_name(text) ausente';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.list_order_sector_material_shortages(uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight: falta por setor (20270101037800) ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.sheet_materials'::regclass
       AND a.attname = 'sector' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Preflight: sheet_materials.sector ausente';
  END IF;
  IF pg_catalog.to_regclass('public.bom_part_sector_map') IS NULL THEN
    RAISE EXCEPTION 'Preflight: bom_part_sector_map ausente';
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
  -- CAMADA 1 — setor gravado na própria reserva.
  explicit_sectors AS (
    SELECT b.rid,
           public.canonical_stage_name(b.explicit_sector) AS sector,
           'explicito'::text AS source
      FROM base b
     WHERE b.explicit_sector IS NOT NULL
  ),
  -- CAMADA 2 — cadastro da linha de BOM (sheet_materials.sector, 100% preenchida).
  cadastro_bom_line AS (
    SELECT DISTINCT b.rid,
           public.canonical_stage_name(NULLIF(pg_catalog.btrim(sm.sector), '')) AS sector,
           'cadastro'::text AS source
      FROM base b
      JOIN public.sheet_materials sm ON sm.product_id = b.product_id
     WHERE b.explicit_sector IS NULL
       AND NULLIF(pg_catalog.btrim(sm.sector), '') IS NOT NULL
  ),
  -- CAMADA 3 — cadastro por grupo de material.
  cadastro_group AS (
    SELECT DISTINCT b.rid,
           public.canonical_stage_name(NULLIF(pg_catalog.btrim(m.sector), '')) AS sector,
           'cadastro'::text AS source
      FROM base b
      JOIN public.products p ON p.id = b.product_id
      JOIN public.bom_part_sector_map m ON m.group_id = p.group_id
     WHERE b.explicit_sector IS NULL
       AND NULLIF(pg_catalog.btrim(m.sector), '') IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM cadastro_bom_line c WHERE c.rid = b.rid
           )
  ),
  cadastro_resolved AS (
    SELECT c.rid FROM cadastro_bom_line c
    UNION
    SELECT c.rid FROM cadastro_group c
  ),
  -- CAMADA 4 — fallback canônico por componente, **sem** o `ELSE 'Aviamento'`:
  -- componente ausente desta tabela fica com setor NULL e avisa em todo setor.
  -- Um componente pode valer para MAIS DE UM setor (ver 'forração').
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
    -- empenho. Só para reserva que nenhuma camada de cadastro resolveu.
    SELECT DISTINCT d.product_id,
           lower(pg_catalog.btrim(COALESCE(d.component, ''))) AS component
      FROM (
        SELECT c.so_id
          FROM ctx c
         WHERE EXISTS (
                 SELECT 1 FROM base b
                  WHERE b.label_is_aggregated
                    AND b.explicit_sector IS NULL
                    AND NOT EXISTS (
                          SELECT 1 FROM cadastro_resolved cr WHERE cr.rid = b.rid
                        )
               )
      ) s
      CROSS JOIN LATERAL public.sale_order_material_demand_lines(s.so_id) d
     WHERE d.product_id IN (
             SELECT b.product_id
               FROM base b
              WHERE b.label_is_aggregated
                AND NOT EXISTS (
                      SELECT 1 FROM cadastro_resolved cr WHERE cr.rid = b.rid
                    )
           )
  ),
  line_components AS (
    -- Rótulo fino (reserva de OP): um componente, como gravado.
    SELECT b.rid, b.component
      FROM base b
     WHERE b.explicit_sector IS NULL
       AND NOT b.label_is_aggregated
       AND NOT EXISTS (SELECT 1 FROM cadastro_resolved cr WHERE cr.rid = b.rid)
    UNION
    -- Rótulo agregado: o conjunto de componentes da demanda do PV.
    SELECT b.rid, d.component
      FROM base b
      JOIN demand d ON d.product_id = b.product_id
     WHERE b.explicit_sector IS NULL
       AND b.label_is_aggregated
       AND NOT EXISTS (SELECT 1 FROM cadastro_resolved cr WHERE cr.rid = b.rid)
    UNION
    -- Agregado cujo produto não aparece mais na demanda (ex.: solado, que a
    -- função de demanda exclui): mantém o rótulo gravado.
    SELECT b.rid, b.component
      FROM base b
     WHERE b.explicit_sector IS NULL
       AND b.label_is_aggregated
       AND NOT EXISTS (SELECT 1 FROM cadastro_resolved cr WHERE cr.rid = b.rid)
       AND NOT EXISTS (SELECT 1 FROM demand d WHERE d.product_id = b.product_id)
  ),
  label_sectors AS (
    SELECT lc.rid,
           -- canonical_stage_name(NULL) = '': o não-mapeado PRECISA ficar NULL.
           CASE WHEN m.sector IS NULL THEN NULL
                ELSE public.canonical_stage_name(m.sector) END AS sector,
           'componente'::text AS source
      FROM line_components lc
      LEFT JOIN component_sector_map m ON m.component = lc.component
  ),
  resolved AS (
    SELECT e.rid, e.sector, e.source FROM explicit_sectors e
    UNION ALL
    SELECT c.rid, c.sector, c.source FROM cadastro_bom_line c
    UNION ALL
    SELECT c.rid, c.sector, c.source FROM cadastro_group c
    UNION ALL
    SELECT l.rid, l.sector, l.source FROM label_sectors l WHERE l.sector IS NOT NULL
  ),
  per_reservation AS (
    SELECT b.rid,
           EXISTS (
             SELECT 1 FROM resolved r
              WHERE r.rid = b.rid AND r.sector = (SELECT s.want FROM stage s)
           ) AS matched_want,
           -- FAIL-SAFE: nenhuma camada soube o dono → avisa em TODO setor.
           NOT EXISTS (SELECT 1 FROM resolved r WHERE r.rid = b.rid) AS has_unknown,
           EXISTS (
             SELECT 1 FROM resolved r WHERE r.rid = b.rid AND r.source = 'explicito'
           ) AS has_explicit,
           EXISTS (
             SELECT 1 FROM resolved r WHERE r.rid = b.rid AND r.source = 'cadastro'
           ) AS has_cadastro
      FROM base b
  ),
  kept AS (
    SELECT b.product_id,
           b.quantity_short,
           b.shortage_grade,
           CASE WHEN pr.matched_want THEN (SELECT s.want FROM stage s) END AS consumption_sector,
           CASE WHEN pr.has_explicit THEN 'explicito'
                WHEN pr.has_cadastro THEN 'cadastro'
                WHEN pr.matched_want THEN 'componente'
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
             WHEN bool_or(k.sector_source = 'cadastro')   THEN 'cadastro'
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
  'confirmação de apontamento do Kanban. Precedência: setor gravado na reserva > '
  'cadastro (sheet_materials.sector, depois bom_part_sector_map pelo grupo) > mapa '
  'canônico por componente — e, no empenho do PV (rótulo min(component), agregado), '
  'do CONJUNTO de componentes da demanda do PV. Nada resolveu = setor NULL e avisa '
  'em TODO setor (fail-safe). NÃO use sheet_materials.consumption_sector: está '
  'vazia (0 de 79). Leitura apenas: setor de consumo segue sendo apresentação/'
  'rastreabilidade (20270101015500), não gatilho de baixa.';

REVOKE ALL ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  TO authenticated, service_role;
