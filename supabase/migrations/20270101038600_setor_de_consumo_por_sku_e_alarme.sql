-- Setor de consumo por SKU + alarme dos buracos de cadastro.
--
-- Decisões do dono (12/10/2026), depois de ver a medição da 20270101038200:
--   1. preencher o setor dos 2 materiais que sobraram em 'desconhecido', com o
--      valor que o dado indica;
--   2. listar esse tipo de buraco em Diagnósticos, no padrão do SoleSpecGapsPanel,
--      porque hoje o único sinal é o aviso aparecendo em setor que não usa o material.
--
-- ## Por que uma tabela por SKU, e não grupo + bom_part_sector_map
--
-- A Fivela 12mm tem grupo (COMPONENTES DIVERSOS) e entra no mapa por grupo, que é
-- a prática existente. O COLA ADESIVO HOTMELT **não tem grupo nem linha de BOM**:
-- chega ao PV como item padrão do solado (`sole_group_standard_items`).
--
-- As alternativas foram medidas e recusadas:
--   · `bom_part_sector_map` tem PK = **group_id**, então exige criar grupo e
--     atribuí-lo ao SKU — e o gatilho `tg_group_sector_cascade` cascatearia
--     `products.category` (hoje 'Componente') para a categoria do setor do grupo.
--     Raio de alcance grande demais para um ajuste de aviso.
--   · linha em `sheet_materials` **não serve**: é o BOM, e o consumo do HOTMELT já
--     vem do item padrão do solado — a linha nova somaria consumo em dobro.
--   · `sheet_materials.consumption_sector` é por LINHA de BOM, então também exige
--     a linha que não deve existir. (E está vazia: 0 de 79 — ver a 038200.)
--
-- Sobra o que faltava: "o setor deste SKU". É classe pequena e conhecida — dos 4
-- produtos que são item padrão de solado, 3 já resolvem (COLA FORTE e COLA PVC pela
-- linha de BOM, EVA 3MM pelo rótulo 'palmilha') e só o HOTMELT não.
--
-- ⚠ Esta tabela é a camada **2.5**, entre a linha de BOM e o grupo. Especificidade:
-- reserva > linha de BOM (ficha+produto) > SKU > grupo > rótulo. Não a promova
-- acima da linha de BOM: a linha é por ficha, logo mais contextual que o SKU.
--
-- ⚠ `list_material_sector_gaps` ESPELHA as 4 camadas de
-- `list_order_sector_material_shortages`. Camada nova entra nas duas, senão o
-- alarme passa a mentir — travado por contrato em
-- `src/__tests__/faltaMaterialPorSetorApontamento.contract.test.ts`.

-- ## Advertências HERDADAS — este arquivo passa a ser o que DEFINE
-- `list_order_sector_material_shortages`, então elas moram aqui (ver 037800/038200).
--
-- ⚠ Setor de consumo é APRESENTAÇÃO/RASTREABILIDADE, decisão escrita da
-- `20270101015500` (que dropou o gatilho de débito por setor). Nada aqui dispara
-- baixa de estoque.
--
-- ⚠ PENDÊNCIA DE CADASTRO/PRODUTO não decidida: o forro de CABEDAL ('forração')
-- avisa nos DOIS setores. O mapa canônico manda pro Corte Cabedal, mas
-- `corteLookahead.ts` liga 'Corte Forração' ao kind `lining` (o forro do cabedal)
-- e `buyList.ts` põe Forração e Forração Palmilha no MESMO bucket. Chutar um dos
-- dois esconde o aviso justamente de quem corta.
--
-- ⚠ O rótulo do empenho é AGREGADO: `commit_sale_order_material_demand` grava
-- min(d.component) sobre TODOS os componentes que consomem o SKU no PV. Por isso o
-- ramo agregado resolve o CONJUNTO de componentes pela função de demanda do PV.
--
-- ⚠ 'Costura' é grafia MORTA (split de `20261001120000`) e
-- `canonical_stage_name('Costura')` devolve 'Acabamento Palmilha', não
-- 'Costura Cabedal'. O LINHANYL, cadastrado 'Costura', avisa na Acabamento
-- Palmilha. Se a linha é cortada na Costura Cabedal, o conserto é no CADASTRO —
-- canonicalizar diferente desta função divergiria do resto do sistema.
--
-- ⚠ O mapa por componente NÃO tem o `ELSE 'Aviamento'` do fallback legado, de
-- propósito: componente fora do mapa fica com setor NULL e avisa em todo setor.

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.list_order_sector_material_shortages(uuid,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight: falta por setor (20270101038200) ausente';
  END IF;
  IF pg_catalog.to_regprocedure('public.canonical_stage_order(text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight: public.canonical_stage_order(text) ausente';
  END IF;
  IF pg_catalog.to_regprocedure('public.user_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight: public.user_has_role(text) ausente';
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

-- ---------------------------------------------------------------------------
-- 1. Cadastro: setor de consumo do SKU
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.material_consumption_sector_map (
  product_id uuid PRIMARY KEY
    REFERENCES public.products(id) ON DELETE CASCADE,
  sector text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- o setor tem que ser uma etapa VIVA: canonical_stage_order devolve 99 para
  -- nome desconhecido, e grafia morta ('Costura') é aceita porque
  -- canonical_stage_name a traduz — a mesma tradução que o motor aplica.
  CONSTRAINT material_consumption_sector_map_sector_check
    CHECK (public.canonical_stage_order(sector) < 99)
);

COMMENT ON TABLE public.material_consumption_sector_map IS
  'Setor que CONSOME um SKU, para material que não tem linha de BOM nem grupo '
  'mapeado (ex.: item padrão de solado). Camada 2.5 da resolução de setor em '
  'list_order_sector_material_shortages: reserva > linha de BOM > SKU > grupo > '
  'rótulo. Apresentação/rastreabilidade — não dispara baixa de estoque.';

ALTER TABLE public.material_consumption_sector_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_consumption_sector_map_read
  ON public.material_consumption_sector_map;
CREATE POLICY material_consumption_sector_map_read
  ON public.material_consumption_sector_map
  FOR SELECT USING (public.is_approved_user());

DROP POLICY IF EXISTS material_consumption_sector_map_write
  ON public.material_consumption_sector_map;
CREATE POLICY material_consumption_sector_map_write
  ON public.material_consumption_sector_map
  FOR ALL USING (public.user_has_role('admin'))
  WITH CHECK (public.user_has_role('admin'));

-- ⚠ REVOGAR DE `authenticated` TAMBÉM — medido no banco em 12/10/2026: tabela
-- nova nasce com `anon=arwdDxtm | authenticated=arwdDxtm` pelo DEFAULT PRIVILEGES
-- do projeto, e com RLS ainda desligada. Revogar só de PUBLIC e anon deixaria o
-- `authenticated` com ALL (incluindo TRUNCATE, que RLS **não** filtra) e o GRANT
-- SELECT abaixo não tiraria nada — seria um no-op que parece uma permissão apertada.
--
-- ⚠ A ordem importa: ENABLE ROW LEVEL SECURITY vem ANTES dos grants. Entre o
-- CREATE TABLE e o ENABLE a tabela fica legível por anon.
--
-- `authenticated` fica só com LEITURA: este cadastro não tem tela (como o
-- bom_part_sector_map, é SQL), então DML pelo app não é necessário. A policy de
-- escrita por admin fica como segunda trava, para o dia em que houver tela.
REVOKE ALL ON TABLE public.material_consumption_sector_map
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.material_consumption_sector_map TO authenticated;
GRANT ALL ON TABLE public.material_consumption_sector_map TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Cadastro aprovado pelo dono (12/10/2026)
-- ---------------------------------------------------------------------------

-- HOTMELT → Colagem: é o setor das irmãs COLA FORTE e COLA PVC, cadastradas em
-- sheet_materials.sector. Não é chute de rótulo — é o cadastro das colas.
INSERT INTO public.material_consumption_sector_map (product_id, sector, note)
SELECT p.id, 'Colagem',
       'Item padrão de solado, sem grupo e sem linha de BOM. Setor igual ao das '
       || 'irmãs COLA FORTE/PVC. Decisão do dono em 12/10/2026.'
  FROM public.products p
 WHERE p.name = 'COLA  ADESIVO HOTMELT'
ON CONFLICT (product_id) DO NOTHING;

-- Fivela 12mm → Aviamento, pelo grupo (prática existente; PK = group_id).
INSERT INTO public.bom_part_sector_map (group_id, sector, part_name)
SELECT pg.id, 'Aviamento', 'Componente'
  FROM public.product_groups pg
 WHERE pg.name = 'COMPONENTES DIVERSOS'
ON CONFLICT (group_id) DO NOTHING;

DO $seed_check$
DECLARE
  v_hotmelt integer;
  v_fivela integer;
BEGIN
  SELECT count(*) INTO v_hotmelt
    FROM public.material_consumption_sector_map m
    JOIN public.products p ON p.id = m.product_id
   WHERE p.name = 'COLA  ADESIVO HOTMELT';
  SELECT count(*) INTO v_fivela
    FROM public.bom_part_sector_map m
    JOIN public.product_groups pg ON pg.id = m.group_id
   WHERE pg.name = 'COMPONENTES DIVERSOS';
  -- nome que não casa = cadastro renomeado: falhar alto, não seguir em silêncio
  IF v_hotmelt <> 1 THEN
    RAISE EXCEPTION 'Seed: COLA  ADESIVO HOTMELT não encontrada (achou %)', v_hotmelt;
  END IF;
  IF v_fivela <> 1 THEN
    RAISE EXCEPTION 'Seed: grupo COMPONENTES DIVERSOS não encontrado (achou %)', v_fivela;
  END IF;
END;
$seed_check$;

-- ---------------------------------------------------------------------------
-- 2.5. A função passa a ler o cadastro por SKU
--
-- Sem isto a tabela acima seria cadastro morto E o alarme da seção 3 mentiria:
-- ele daria o HOTMELT como resolvido enquanto a confirmação seguiria
-- perguntando em todo setor.
-- ---------------------------------------------------------------------------

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
  -- CAMADA 2.5 — cadastro do SKU, para material sem linha de BOM e sem grupo
  -- mapeado (ex.: item padrão de solado). Mig 20270101038600.
  cadastro_product AS (
    SELECT DISTINCT b.rid,
           public.canonical_stage_name(NULLIF(pg_catalog.btrim(mm.sector), '')) AS sector,
           'cadastro'::text AS source
      FROM base b
      JOIN public.material_consumption_sector_map mm
        ON mm.product_id = b.product_id
     WHERE b.explicit_sector IS NULL
       AND NULLIF(pg_catalog.btrim(mm.sector), '') IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM cadastro_bom_line c WHERE c.rid = b.rid
           )
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
       AND NOT EXISTS (
             SELECT 1 FROM cadastro_product c WHERE c.rid = b.rid
           )
  ),
  cadastro_resolved AS (
    SELECT c.rid FROM cadastro_bom_line c
    UNION
    SELECT c.rid FROM cadastro_product c
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
    SELECT c.rid, c.sector, c.source FROM cadastro_product c
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

REVOKE ALL ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_order_sector_material_shortages(uuid, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Alarme: buracos de cadastro de setor na falta viva
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_material_sector_gaps()
RETURNS TABLE (
  product_id uuid,
  product_name text,
  color text,
  unit text,
  quantity_short numeric,
  reservations integer,
  recorded_components text,
  sale_orders text[],
  fix_hint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- ESPELHO das camadas de list_order_sector_material_shortages. Uma linha aqui
  -- = material que avisa em TODO setor pelo fail-safe.
  WITH base AS (
    SELECT mr.id AS rid,
           mr.product_id,
           mr.sale_order_id,
           COALESCE(mr.quantity_short, 0) AS quantity_short,
           NULLIF(pg_catalog.btrim(COALESCE(mr.metadata ->> 'consumption_sector', '')), '')
             AS explicit_sector,
           lower(pg_catalog.btrim(COALESCE(mr.metadata ->> 'component', ''))) AS component
      FROM public.material_reservations mr
     WHERE mr.quantity_short > 0
       AND public.material_reservation_is_pv_managed(mr)
       AND public.is_approved_user()
  ),
  component_sector_map (component) AS (
    VALUES ('solado'::text), ('palmilha'), ('forração palmilha'),
           ('forracao palmilha'), ('cabedal'), ('forração'), ('forracao'),
           ('fachete'), ('tiras'), ('químicos'), ('quimicos'), ('embalagem')
  ),
  unresolved AS (
    SELECT b.*
      FROM base b
      LEFT JOIN public.products p ON p.id = b.product_id
     WHERE b.explicit_sector IS NULL
       -- camada 2: linha de BOM
       AND NOT EXISTS (
             SELECT 1 FROM public.sheet_materials sm
              WHERE sm.product_id = b.product_id
                AND NULLIF(pg_catalog.btrim(sm.sector), '') IS NOT NULL
           )
       -- camada 2.5: SKU
       AND NOT EXISTS (
             SELECT 1 FROM public.material_consumption_sector_map mm
              WHERE mm.product_id = b.product_id
           )
       -- camada 3: grupo
       AND NOT EXISTS (
             SELECT 1 FROM public.bom_part_sector_map gm
              WHERE gm.group_id = p.group_id
                AND NULLIF(pg_catalog.btrim(gm.sector), '') IS NOT NULL
           )
       -- camada 4: rótulo. O empenho grava min(component), então o rótulo pode
       -- não descrever todos os componentes — mas se ele CASA, o setor resolve e
       -- a linha não é buraco.
       AND NOT EXISTS (
             SELECT 1 FROM component_sector_map cm WHERE cm.component = b.component
           )
  )
  SELECT u.product_id,
         COALESCE(p.name, 'Material'),
         p.color,
         p.unit,
         sum(u.quantity_short) AS quantity_short,
         count(*)::integer AS reservations,
         string_agg(DISTINCT NULLIF(u.component, ''), ', ') AS recorded_components,
         array_remove(array_agg(DISTINCT so.order_number), NULL) AS sale_orders,
         CASE
           WHEN p.group_id IS NOT NULL
             THEN 'Cadastre o setor do grupo em bom_part_sector_map, ou o setor '
                  || 'do SKU em material_consumption_sector_map.'
           ELSE 'SKU sem grupo: cadastre o setor do SKU em '
                || 'material_consumption_sector_map.'
         END AS fix_hint
    FROM unresolved u
    LEFT JOIN public.products p ON p.id = u.product_id
    LEFT JOIN public.sale_orders so ON so.id = u.sale_order_id
   GROUP BY u.product_id, p.name, p.color, p.unit, p.group_id
   ORDER BY sum(u.quantity_short) DESC, COALESCE(p.name, '');
$$;

COMMENT ON FUNCTION public.list_material_sector_gaps() IS
  'Material em falta cujo setor de consumo NÃO resolve por nenhuma camada de '
  'cadastro — ou seja, que avisa em TODO setor pelo fail-safe de '
  'list_order_sector_material_shortages. ESPELHA as camadas daquela função: '
  'camada nova entra nas duas. Para /system-diagnostics → Consumo.';

REVOKE ALL ON FUNCTION public.list_material_sector_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_material_sector_gaps()
  TO authenticated, service_role;
